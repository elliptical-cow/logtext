//! Process-wide state for the active workspace and optional Cryptomator mount.
//!
//! One mutex owns the related runtime resources. This keeps workspace,
//! watcher, lifecycle phase, and child process transitions atomic and avoids a
//! lock-order contract between otherwise inseparable pieces of state.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::app_error::{AppError, AppResult};
use crate::content_snapshot::ContentSnapshot;
use crate::cryptomator::ManagedCryptomator;
use crate::index::backlink_index::BacklinkIndex;
use crate::index::page_index::{Page, PageIndex};
use crate::watcher::WorkspaceWatcher;
use crate::workspace::paths::resolve_workspace_relative_path;
use crate::workspace::scanner::file_modified_at_millis;
use crate::workspace_config::WorkspaceConfig;

pub struct AppState {
    runtime: Mutex<RuntimeState>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceSource {
    Folder,
    Cryptomator { vault_path: PathBuf },
}

#[derive(Debug)]
pub struct WorkspaceState {
    pub root: PathBuf,
    pub source: WorkspaceSource,
    pub config: WorkspaceConfig,
    pub folders: Vec<String>,
    pub pages: PageIndex,
    pub backlinks: BacklinkIndex,
    pub contents: ContentSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimePhase {
    Idle,
    Opening,
    Open,
    Closing,
    Disconnected,
}

struct RuntimeState {
    workspace: Option<WorkspaceState>,
    watcher: Option<WorkspaceWatcher>,
    cryptomator: Option<ManagedCryptomator>,
    phase: RuntimePhase,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(RuntimeState {
                workspace: None,
                watcher: None,
                cryptomator: None,
                phase: RuntimePhase::Idle,
            }),
        }
    }
}

impl WorkspaceState {
    pub fn index_page_content(&mut self, path: String, content: String) -> Option<Page> {
        let modified_at = resolve_workspace_relative_path(&self.root, &path)
            .and_then(|absolute_path| file_modified_at_millis(&absolute_path).ok())
            .unwrap_or_default();
        if self.pages.get_by_path(&path).is_some() {
            self.pages
                .update_content_metadata(&path, &content, modified_at);
        } else {
            self.pages
                .insert_page_with_modified_at(path.clone(), &content, modified_at)?;
        }
        self.backlinks.index_page(path.clone(), &content);
        self.contents.insert(path.clone(), content);
        self.pages.get_by_path(&path).cloned()
    }

    pub fn remove_indexed_page(&mut self, path: &str) -> Option<Page> {
        let page = self.pages.remove_path(path);
        self.backlinks.remove_page(path);
        self.contents.remove(path);
        page
    }
}

impl AppState {
    pub fn begin_open(&self) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        if runtime.phase != RuntimePhase::Idle {
            return Err("Close the current workspace before opening another one.".to_string());
        }
        runtime.phase = RuntimePhase::Opening;
        Ok(())
    }

    pub fn finish_open(
        &self,
        workspace: WorkspaceState,
        watcher: WorkspaceWatcher,
        cryptomator: Option<ManagedCryptomator>,
    ) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        if runtime.phase != RuntimePhase::Opening {
            return Err("Workspace opening was interrupted.".to_string());
        }
        runtime.workspace = Some(workspace);
        runtime.watcher = Some(watcher);
        runtime.cryptomator = cryptomator;
        runtime.phase = RuntimePhase::Open;
        Ok(())
    }

    pub fn abort_open(&self) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        if runtime.phase == RuntimePhase::Opening {
            runtime.phase = RuntimePhase::Idle;
        }
        Ok(())
    }

    pub fn retain_failed_open_process(&self, process: ManagedCryptomator) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        if runtime.phase != RuntimePhase::Opening {
            return Err("Cryptomator cleanup could not take ownership of the process.".to_string());
        }
        runtime.workspace = None;
        runtime.watcher = None;
        runtime.cryptomator = Some(process);
        runtime.phase = RuntimePhase::Closing;
        Ok(())
    }

    /// Kept for focused unit tests that install a detached workspace directly.
    pub fn set_workspace(&self, workspace: WorkspaceState) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        runtime.workspace = Some(workspace);
        runtime.phase = RuntimePhase::Open;
        Ok(())
    }

    pub fn with_workspace<T>(
        &self,
        callback: impl FnOnce(&WorkspaceState) -> T,
    ) -> Result<T, String> {
        let runtime = self.lock_runtime()?;
        if runtime.phase != RuntimePhase::Open {
            return Err(workspace_unavailable_message(runtime.phase));
        }
        let workspace = runtime
            .workspace
            .as_ref()
            .ok_or_else(|| "No workspace is open".to_string())?;
        Ok(callback(workspace))
    }

    pub fn with_workspace_mut<T>(
        &self,
        callback: impl FnOnce(&mut WorkspaceState) -> T,
    ) -> Result<T, String> {
        let mut runtime = self.lock_runtime()?;
        if runtime.phase != RuntimePhase::Open {
            return Err(workspace_unavailable_message(runtime.phase));
        }
        let workspace = runtime
            .workspace
            .as_mut()
            .ok_or_else(|| "No workspace is open".to_string())?;
        Ok(callback(workspace))
    }

    pub fn with_workspace_mut_app<T>(
        &self,
        callback: impl FnOnce(&mut WorkspaceState) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::state_lock("Failed to lock app state"))?;
        if runtime.phase != RuntimePhase::Open {
            return Err(AppError::not_found(workspace_unavailable_message(
                runtime.phase,
            )));
        }
        let workspace = runtime
            .workspace
            .as_mut()
            .ok_or_else(|| AppError::not_found("Open a workspace before using this action."))?;
        callback(workspace)
    }

    pub fn take_for_close(&self) -> Result<Option<ManagedCryptomator>, String> {
        let mut runtime = self.lock_runtime()?;
        match runtime.phase {
            RuntimePhase::Idle => return Ok(None),
            RuntimePhase::Opening => {
                return Err("Wait for the workspace to finish opening.".to_string())
            }
            RuntimePhase::Open | RuntimePhase::Disconnected => {
                runtime.phase = RuntimePhase::Closing;
                runtime.watcher = None;
                runtime.workspace = None;
            }
            RuntimePhase::Closing if runtime.cryptomator.is_none() => {
                return Err("The workspace is already closing.".to_string())
            }
            RuntimePhase::Closing => {}
        }
        Ok(runtime.cryptomator.take())
    }

    pub fn retain_closing_process(&self, process: ManagedCryptomator) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        runtime.cryptomator = Some(process);
        runtime.phase = RuntimePhase::Closing;
        Ok(())
    }

    pub fn finish_close(&self) -> Result<(), String> {
        let mut runtime = self.lock_runtime()?;
        runtime.workspace = None;
        runtime.watcher = None;
        runtime.cryptomator = None;
        runtime.phase = RuntimePhase::Idle;
        Ok(())
    }

    pub fn mark_cryptomator_disconnected(&self, pid: u32) -> Result<bool, String> {
        let mut runtime = self.lock_runtime()?;
        let is_current = runtime
            .cryptomator
            .as_ref()
            .is_some_and(|process| process.pid() == pid);
        if !is_current || runtime.phase != RuntimePhase::Open {
            return Ok(false);
        }
        runtime.watcher = None;
        runtime.cryptomator = None;
        runtime.phase = RuntimePhase::Disconnected;
        Ok(true)
    }

    fn lock_runtime(&self) -> Result<std::sync::MutexGuard<'_, RuntimeState>, String> {
        self.runtime
            .lock()
            .map_err(|_| "Failed to lock app state".to_string())
    }
}

fn workspace_unavailable_message(phase: RuntimePhase) -> String {
    match phase {
        RuntimePhase::Idle => "No workspace is open".to_string(),
        RuntimePhase::Opening => "The workspace is still opening.".to_string(),
        RuntimePhase::Open => "No workspace is open".to_string(),
        RuntimePhase::Closing => "The workspace is closing.".to_string(),
        RuntimePhase::Disconnected => "The Cryptomator workspace is no longer mounted.".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::backlink_index::BacklinkIndex;
    use crate::index::page_index::PageIndex;
    use crate::workspace_config::WorkspaceConfig;

    #[test]
    fn rejects_parallel_open_and_close_transitions() {
        let state = AppState::default();

        state.begin_open().unwrap();
        assert!(state.begin_open().is_err());
        assert!(state.take_for_close().is_err());
        state.abort_open().unwrap();

        state.set_workspace(empty_workspace()).unwrap();
        assert!(state.take_for_close().unwrap().is_none());
        assert!(state.take_for_close().is_err());
        state.finish_close().unwrap();
        state.begin_open().unwrap();
    }

    fn empty_workspace() -> WorkspaceState {
        WorkspaceState {
            root: PathBuf::from("/tmp/logtext-app-state-test"),
            source: WorkspaceSource::Folder,
            config: WorkspaceConfig::default(),
            folders: Vec::new(),
            pages: PageIndex::default(),
            backlinks: BacklinkIndex::default(),
            contents: ContentSnapshot::default(),
        }
    }
}
