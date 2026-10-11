//! Lifecycle adapter for an externally installed `cryptomator-cli`.
//!
//! The CLI owns encryption and the OS-native WebDAV mount. Logtext only waits
//! for the reported local mount path and then uses its ordinary filesystem
//! workspace implementation.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::app_state::AppState;

const READY_MARKER: &str = "Unlocked and mounted vault successfully to ";
const UNMOUNT_FAILED_MARKER: &str = "GRACEFUL UNMOUNT FAILED";
const START_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_TIMEOUT: Duration = Duration::from_secs(30);
const LOG_LINE_LIMIT: usize = 200;

#[cfg(target_os = "macos")]
const REQUIRED_MOUNTER: &str = "org.cryptomator.frontend.webdav.mount.MacAppleScriptMounter";
#[cfg(target_os = "windows")]
const REQUIRED_MOUNTER: &str = "org.cryptomator.frontend.webdav.mount.WindowsMounter";
#[cfg(target_os = "linux")]
const REQUIRED_MOUNTER: &str = "org.cryptomator.frontend.webdav.mount.LinuxGioMounter";
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
const REQUIRED_MOUNTER: &str = "";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptomatorCliInfoDto {
    pub executable_path: String,
    pub version: String,
    pub mounter: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptomatorExitEvent {
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum CloseWorkspaceResultDto {
    Closed,
    TimedOut { detail: String },
    UnmountFailed { detail: String },
}

#[derive(Debug, Clone)]
pub struct ManagedCryptomator {
    child: Arc<Mutex<Child>>,
    expected_exit: Arc<AtomicBool>,
    output: Arc<Mutex<OutputLog>>,
    output_threads: Arc<Mutex<Vec<thread::JoinHandle<()>>>>,
    mount_path: PathBuf,
    pid: u32,
}

#[derive(Debug, Default)]
struct OutputLog {
    lines: VecDeque<String>,
}

impl OutputLog {
    fn push(&mut self, line: String) {
        if self.lines.len() == LOG_LINE_LIMIT {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    fn text(&self) -> String {
        self.lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

pub fn probe_cli(
    candidate_path: Option<&str>,
    configured_path: Option<&str>,
) -> Result<CryptomatorCliInfoDto, String> {
    if REQUIRED_MOUNTER.is_empty() {
        return Err("Cryptomator workspaces are not supported on this platform.".to_string());
    }

    let mut errors = Vec::new();
    for candidate in cli_candidates(candidate_path, configured_path) {
        match probe_candidate(&candidate) {
            Ok(info) => return Ok(info),
            Err(error) => errors.push(format!("{}: {error}", candidate.display())),
        }
    }

    let detail = if errors.is_empty() {
        String::new()
    } else {
        format!(" Tried: {}", errors.join("; "))
    };
    Err(format!(
        "Could not find a usable cryptomator-cli installation.{detail}"
    ))
}

pub fn mount_vault(
    cli_path: &Path,
    vault_path: &Path,
    password: String,
) -> Result<(ManagedCryptomator, PathBuf), String> {
    if !vault_path.is_dir() || !vault_path.join("vault.cryptomator").is_file() {
        return Err("Select a Cryptomator vault containing vault.cryptomator.".to_string());
    }

    let mut command = Command::new(cli_path);
    command
        .arg("unlock")
        .arg("--password:stdin")
        .arg(format!("--mounter={REQUIRED_MOUNTER}"))
        .arg("--loopbackPort=0")
        .arg(format!("--volumeId={}", Uuid::new_v4()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    command.arg(format!(
        "--volumeName={}",
        volume_name(vault_path, Uuid::new_v4())
    ));

    command.arg(vault_path);
    configure_process(&mut command)?;

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start cryptomator-cli: {error}"))?;
    let pid = child.id();

    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            terminate_spawned_child(pid, &mut child);
            return Err("Failed to open cryptomator-cli stdin.".to_string());
        }
    };
    let password = Zeroizing::new(password);
    if let Err(error) = stdin
        .write_all(password.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
    {
        drop(stdin);
        terminate_spawned_child(pid, &mut child);
        return Err(format!("Failed to send the vault password: {error}"));
    }
    drop(stdin);
    drop(password);

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_spawned_child(pid, &mut child);
            return Err("Failed to capture cryptomator-cli stdout.".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            terminate_spawned_child(pid, &mut child);
            return Err("Failed to capture cryptomator-cli stderr.".to_string());
        }
    };
    let child = Arc::new(Mutex::new(child));
    let output = Arc::new(Mutex::new(OutputLog::default()));
    let (line_sender, line_receiver) = mpsc::sync_channel(256);
    let output_threads = Arc::new(Mutex::new(vec![
        read_output(stdout, line_sender.clone(), Arc::clone(&output)),
        read_output(stderr, line_sender, Arc::clone(&output)),
    ]));

    let mount_path = match wait_for_mount(&child, line_receiver, START_TIMEOUT) {
        Ok(path) => path,
        Err(error) => {
            terminate_failed_start(pid, &child);
            finish_output_readers(&output_threads);
            return Err(with_output(error, &output));
        }
    };

    if !mount_path.is_dir() {
        terminate_failed_start(pid, &child);
        finish_output_readers(&output_threads);
        return Err(format!(
            "cryptomator-cli reported an unavailable mount directory: {}",
            mount_path.display()
        ));
    }

    let managed = ManagedCryptomator {
        child,
        expected_exit: Arc::new(AtomicBool::new(false)),
        output,
        output_threads,
        mount_path: mount_path.clone(),
        pid,
    };
    Ok((managed, mount_path))
}

impl ManagedCryptomator {
    pub fn start_exit_monitor(&self, app_handle: AppHandle) {
        let process = self.clone();
        thread::spawn(move || loop {
            let exited = process
                .child
                .lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok().flatten())
                .is_some();
            if exited {
                finish_output_readers(&process.output_threads);
                if !process.expected_exit.load(Ordering::SeqCst) {
                    let state = app_handle.state::<AppState>();
                    if state
                        .mark_cryptomator_disconnected(process.pid)
                        .unwrap_or(false)
                    {
                        let _ = app_handle.emit(
                            "cryptomator-process-exited",
                            CryptomatorExitEvent {
                                message: with_output(
                                    "cryptomator-cli exited unexpectedly.".to_string(),
                                    &process.output,
                                ),
                            },
                        );
                    }
                }
                break;
            }
            thread::sleep(Duration::from_millis(500));
        });
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn is_running(&self) -> bool {
        self.child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .is_none()
    }

    pub fn stop(&self, force: bool) -> CloseWorkspaceResultDto {
        self.expected_exit.store(true, Ordering::SeqCst);
        if !self.is_running() {
            return self.completed_stop_result();
        }
        let signal_result = if force {
            self.child
                .lock()
                .map_err(|_| "Failed to lock cryptomator-cli process.".to_string())
                .and_then(|mut child| {
                    child
                        .kill()
                        .map_err(|error| format!("Failed to terminate cryptomator-cli: {error}"))
                })
        } else {
            send_graceful_signal(self.pid)
        };

        if let Err(error) = signal_result {
            return CloseWorkspaceResultDto::TimedOut { detail: error };
        }

        if !wait_for_exit(&self.child, STOP_TIMEOUT) {
            return CloseWorkspaceResultDto::TimedOut {
                detail: "cryptomator-cli did not exit within 30 seconds.".to_string(),
            };
        }

        self.completed_stop_result()
    }

    fn completed_stop_result(&self) -> CloseWorkspaceResultDto {
        finish_output_readers(&self.output_threads);

        let output = self
            .output
            .lock()
            .map(|output| output.text())
            .unwrap_or_default();
        if output.contains(UNMOUNT_FAILED_MARKER) {
            return CloseWorkspaceResultDto::UnmountFailed { detail: output };
        }

        if self.mount_path.is_dir() {
            return CloseWorkspaceResultDto::UnmountFailed {
                detail: format!(
                    "cryptomator-cli exited, but the mount path still exists: {}",
                    self.mount_path.display()
                ),
            };
        }

        CloseWorkspaceResultDto::Closed
    }
}

fn probe_candidate(candidate: &Path) -> Result<CryptomatorCliInfoDto, String> {
    let version_output = Command::new(candidate)
        .arg("--version")
        .output()
        .map_err(|error| error.to_string())?;
    if !version_output.status.success() {
        return Err("--version returned an error".to_string());
    }
    let version = combined_output(&version_output.stdout, &version_output.stderr);

    let mounter_output = Command::new(candidate)
        .args(["list-mounters", "--withDisplayName"])
        .output()
        .map_err(|error| format!("list-mounters failed: {error}"))?;
    if !mounter_output.status.success() {
        return Err("list-mounters returned an error".to_string());
    }
    let mounters = combined_output(&mounter_output.stdout, &mounter_output.stderr);
    if !mounters
        .lines()
        .any(|line| line.starts_with(REQUIRED_MOUNTER))
    {
        return Err(format!(
            "required WebDAV mounter is unavailable: {REQUIRED_MOUNTER}"
        ));
    }

    Ok(CryptomatorCliInfoDto {
        executable_path: candidate.to_string_lossy().to_string(),
        version: version.trim().to_string(),
        mounter: REQUIRED_MOUNTER.to_string(),
    })
}

fn cli_candidates(candidate_path: Option<&str>, configured_path: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(candidate) = candidate_path.filter(|path| !path.trim().is_empty()) {
        push_cli_candidate(&mut candidates, PathBuf::from(candidate));
    }
    if let Some(candidate) = configured_path.filter(|path| !path.trim().is_empty()) {
        push_cli_candidate(&mut candidates, PathBuf::from(candidate));
    }

    // Command names use the inherited PATH without reproducing shell lookup.
    candidates.push(PathBuf::from(cli_executable_name()));
    for candidate in platform_cli_locations() {
        push_cli_candidate(&mut candidates, candidate);
    }
    candidates
}

fn push_cli_candidate(candidates: &mut Vec<PathBuf>, selected_path: PathBuf) {
    for candidate in expand_cli_candidate(selected_path) {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
}

/// Accepts either the executable itself or the root produced by the official
/// archive. On macOS, Finder presents the app bundle as one selectable item.
fn expand_cli_candidate(selected_path: PathBuf) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    if selected_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    {
        return vec![selected_path.join("Contents/MacOS/cryptomator-cli")];
    }

    let executable_name = cli_executable_name();
    if !selected_path.is_dir()
        && selected_path
            .file_name()
            .is_some_and(|name| name == std::ffi::OsStr::new(executable_name))
    {
        return vec![selected_path];
    }

    let mut expanded = vec![selected_path.clone()];
    expanded.push(selected_path.join(executable_name));
    expanded.push(selected_path.join("cryptomator-cli").join(executable_name));
    #[cfg(target_os = "macos")]
    expanded.push(
        selected_path
            .join("cryptomator-cli.app")
            .join("Contents/MacOS/cryptomator-cli"),
    );
    expanded
}

fn cli_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "cryptomator-cli.exe"
    } else {
        "cryptomator-cli"
    }
}

fn platform_cli_locations() -> Vec<PathBuf> {
    let mut locations = Vec::new();

    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(directory) = current_executable.parent() {
            locations.push(directory.to_path_buf());
        }
    }

    #[cfg(target_os = "macos")]
    {
        locations.extend([
            PathBuf::from("/Applications/cryptomator-cli.app"),
            PathBuf::from("/Applications/Cryptomator CLI.app"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            let applications = PathBuf::from(home).join("Applications");
            locations.push(applications.join("cryptomator-cli.app"));
            locations.push(applications.join("Cryptomator CLI.app"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(directory) = std::env::var_os(variable) {
                let directory = PathBuf::from(directory);
                locations.push(directory.join("cryptomator-cli"));
                locations.push(directory.join("Cryptomator CLI"));
            }
        }
        if let Some(directory) = std::env::var_os("LOCALAPPDATA") {
            let programs = PathBuf::from(directory).join("Programs");
            locations.push(programs.join("cryptomator-cli"));
            locations.push(programs.join("Cryptomator CLI"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        locations.extend([
            PathBuf::from("/usr/local/bin/cryptomator-cli"),
            PathBuf::from("/usr/bin/cryptomator-cli"),
            PathBuf::from("/opt/cryptomator-cli"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            locations.push(PathBuf::from(home).join(".local/bin/cryptomator-cli"));
        }
    }

    locations
}

fn read_output(
    reader: impl Read + Send + 'static,
    sender: mpsc::SyncSender<String>,
    output: Arc<Mutex<OutputLog>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Ok(mut output) = output.lock() {
                output.push(line.clone());
            }
            let _ = sender.send(line);
        }
    })
}

fn finish_output_readers(readers: &Arc<Mutex<Vec<thread::JoinHandle<()>>>>) {
    let handles = readers
        .lock()
        .map(|mut readers| std::mem::take(&mut *readers))
        .unwrap_or_default();
    for handle in handles {
        let _ = handle.join();
    }
}

fn wait_for_mount(
    child: &Arc<Mutex<Child>>,
    lines: mpsc::Receiver<String>,
    timeout: Duration,
) -> Result<PathBuf, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match lines.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                if let Some(path) = mount_path_from_line(&line)? {
                    return Ok(path);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        let exited = child
            .lock()
            .map_err(|_| "Failed to lock cryptomator-cli process.".to_string())?
            .try_wait()
            .map_err(|error| format!("Failed to inspect cryptomator-cli: {error}"))?
            .is_some();
        if exited {
            return Err("cryptomator-cli exited before mounting the vault.".to_string());
        }
    }
    Err("Timed out while waiting for cryptomator-cli to mount the vault.".to_string())
}

fn mount_path_from_line(line: &str) -> Result<Option<PathBuf>, String> {
    let Some((_, value)) = line.split_once(READY_MARKER) else {
        return Ok(None);
    };
    let uri = value
        .split_whitespace()
        .next()
        .ok_or_else(|| "cryptomator-cli reported an empty mount URI.".to_string())?;
    let uri = Url::parse(uri)
        .map_err(|error| format!("cryptomator-cli reported an invalid mount URI: {error}"))?;
    if uri.scheme() != "file" {
        return Err(format!(
            "The selected Cryptomator mounter did not provide a local filesystem path: {uri}"
        ));
    }
    uri.to_file_path()
        .map(Some)
        .map_err(|_| format!("Could not convert the mount URI to a local path: {uri}"))
}

fn wait_for_exit(child: &Arc<Mutex<Child>>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if child
            .lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .is_some()
        {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn terminate_failed_start(pid: u32, child: &Arc<Mutex<Child>>) {
    let _ = send_graceful_signal(pid);
    if !wait_for_exit(child, Duration::from_secs(5)) {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
        let _ = wait_for_exit(child, Duration::from_secs(5));
    }
}

fn terminate_spawned_child(pid: u32, child: &mut Child) {
    let _ = send_graceful_signal(pid);
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn with_output(message: String, output: &Arc<Mutex<OutputLog>>) -> String {
    let detail = output
        .lock()
        .map(|output| output.text())
        .unwrap_or_default();
    if detail.trim().is_empty() {
        message
    } else {
        format!("{message}\n\ncryptomator-cli output:\n{detail}")
    }
}

fn combined_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout = String::from_utf8_lossy(stdout);
    let stderr = String::from_utf8_lossy(stderr);
    match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{}\n{}", stdout.trim(), stderr.trim()),
        (false, true) => stdout.trim().to_string(),
        (true, false) => stderr.trim().to_string(),
        (true, true) => String::new(),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn volume_name(vault_path: &Path, id: Uuid) -> String {
    let name = vault_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Vault")
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '_'))
        .take(32)
        .collect::<String>();
    let name = if name.trim().is_empty() {
        "Vault"
    } else {
        name.trim()
    };
    format!("Logtext-{name}-{}", &id.to_string()[..8])
}

#[cfg(unix)]
fn configure_process(_command: &mut Command) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn send_graceful_signal(pid: u32) -> Result<(), String> {
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to signal cryptomator-cli: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
fn configure_process(command: &mut Command) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Console::{
        AllocConsole, GetConsoleWindow, SetConsoleCtrlHandler,
    };
    use windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    unsafe {
        if GetConsoleWindow().is_null() {
            if AllocConsole() == 0 {
                return Err(format!(
                    "Failed to allocate a control console: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let window = GetConsoleWindow();
            if !window.is_null() {
                ShowWindow(window, SW_HIDE);
            }
        }
        SetConsoleCtrlHandler(None, 1);
    }
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    Ok(())
}

#[cfg(windows)]
fn send_graceful_signal(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};

    let result = unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) };
    if result != 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to signal cryptomator-cli: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(any(unix, windows)))]
fn configure_process(_command: &mut Command) -> Result<(), String> {
    Err("Cryptomator workspaces are not supported on this platform.".to_string())
}

#[cfg(not(any(unix, windows)))]
fn send_graceful_signal(_pid: u32) -> Result<(), String> {
    Err("Cryptomator workspaces are not supported on this platform.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ChunkedReader {
        bytes: Vec<u8>,
        offset: usize,
        chunk_size: usize,
    }

    impl Read for ChunkedReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.offset == self.bytes.len() {
                return Ok(0);
            }
            let count = self
                .chunk_size
                .min(buffer.len())
                .min(self.bytes.len() - self.offset);
            buffer[..count].copy_from_slice(&self.bytes[self.offset..self.offset + count]);
            self.offset += count;
            Ok(count)
        }
    }

    #[test]
    fn parses_file_mount_uri_with_encoded_spaces() {
        let path = mount_path_from_line(
            "INFO Unlocked and mounted vault successfully to file:///tmp/Logtext%20Vault/",
        )
        .unwrap()
        .unwrap();

        assert_eq!(path, PathBuf::from("/tmp/Logtext Vault/"));
    }

    #[test]
    fn ignores_unrelated_output() {
        assert_eq!(mount_path_from_line("INFO Starting").unwrap(), None);
    }

    #[test]
    fn rejects_non_file_mount_uri() {
        let error = mount_path_from_line(
            "Unlocked and mounted vault successfully to http://localhost:1234/vault/",
        )
        .unwrap_err();

        assert!(error.contains("local filesystem path"));
    }

    #[test]
    fn reconstructs_readiness_lines_split_across_reads() {
        let reader = ChunkedReader {
            bytes: b"Unlocked and mounted vault successfully to file:///tmp/vault/\n".to_vec(),
            offset: 0,
            chunk_size: 3,
        };
        let output = Arc::new(Mutex::new(OutputLog::default()));
        let (sender, receiver) = mpsc::sync_channel(2);

        let output_thread = read_output(reader, sender, Arc::clone(&output));

        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
            "Unlocked and mounted vault successfully to file:///tmp/vault/"
        );
        output_thread.join().unwrap();
    }

    #[test]
    fn prefers_path_lookup_before_platform_locations() {
        let candidates = cli_candidates(None, None);

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from(cli_executable_name()))
        );
    }

    #[test]
    fn expands_an_extracted_app_image_directory() {
        let root = test_directory("app-image");
        let package = root.join("cryptomator-cli");
        std::fs::create_dir_all(&package).unwrap();

        let candidates = expand_cli_candidate(package.clone());

        assert!(candidates.contains(&package.join(cli_executable_name())));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolves_a_selected_macos_app_bundle() {
        let bundle = PathBuf::from("/tmp/cryptomator-cli.app");

        assert_eq!(
            expand_cli_candidate(bundle.clone()),
            vec![bundle.join("Contents/MacOS/cryptomator-cli")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn probes_mounts_and_stops_a_fake_cli_without_exposing_password() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let root = test_directory("lifecycle");
        let vault = root.join("vault");
        let mount = root.join("mount");
        let executable = root.join("cryptomator-cli");
        fs::create_dir_all(&vault).unwrap();
        fs::create_dir_all(&mount).unwrap();
        fs::write(vault.join("vault.cryptomator"), "test").unwrap();
        let mount_uri = Url::from_directory_path(&mount).unwrap().to_string();
        let script = format!(
            "#!/bin/sh\ncase \"$1\" in\n  --version) printf 'cryptomator-cli 0.7.0\\n'; exit 0 ;;\n  list-mounters) printf '{} | Native WebDAV\\n'; exit 0 ;;\n  unlock)\n    for argument in \"$@\"; do\n      [ \"$argument\" != 'top secret' ] || exit 41\n    done\n    IFS= read -r supplied\n    [ \"$supplied\" = 'top secret' ] || exit 42\n    trap \"rmdir {} 2>/dev/null; exit 0\" TERM INT\n    printf 'Unlocked and mounted vault successfully to {}\\n' >&2\n    while :; do sleep 1; done ;;\n  *) exit 43 ;;\nesac\n",
            REQUIRED_MOUNTER,
            shell_quote(&mount),
            mount_uri,
        );
        fs::write(&executable, script).unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&executable, permissions).unwrap();

        let info = probe_cli(executable.to_str(), None).unwrap();
        assert_eq!(info.executable_path, executable.to_string_lossy());

        let (process, mounted_path) =
            mount_vault(&executable, &vault, "top secret".to_string()).unwrap();
        assert_eq!(mounted_path, mount);
        assert!(!process.output.lock().unwrap().text().contains("top secret"));
        assert!(matches!(
            process.stop(false),
            CloseWorkspaceResultDto::Closed
        ));
        assert!(!mount.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn stops_a_windows_console_process_group_with_ctrl_break() {
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-Command",
                "$handler = [ConsoleCancelEventHandler]{ param($sender, $eventArgs); exit 0 }; [Console]::CancelKeyPress += $handler; while ($true) { Start-Sleep -Milliseconds 100 }",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_process(&mut command).unwrap();
        let child = command.spawn().unwrap();
        let process = ManagedCryptomator {
            pid: child.id(),
            child: Arc::new(Mutex::new(child)),
            expected_exit: Arc::new(AtomicBool::new(false)),
            output: Arc::new(Mutex::new(OutputLog::default())),
            output_threads: Arc::new(Mutex::new(Vec::new())),
            mount_path: std::env::temp_dir().join(Uuid::new_v4().to_string()),
        };
        thread::sleep(Duration::from_millis(500));

        assert!(matches!(
            process.stop(false),
            CloseWorkspaceResultDto::Closed
        ));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn sanitizes_volume_name() {
        let id = Uuid::parse_str("12345678-1234-1234-1234-123456789012").unwrap();
        assert_eq!(
            volume_name(Path::new("/tmp/My: Vault!?"), id),
            "Logtext-My Vault-12345678"
        );
    }

    #[cfg(unix)]
    fn shell_quote(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
    }

    fn test_directory(label: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("logtext-cryptomator-{label}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
}
