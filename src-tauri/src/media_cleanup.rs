use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::State;

use crate::app_state::{AppState, WorkspaceState};
use crate::dto::{MediaCleanupCandidateDto, MediaTrashFailureDto, MediaTrashResultDto};
use crate::workspace::paths::resolve_workspace_relative_path;
use crate::workspace::scanner::scan_workspace_excluding;

const SUPPORTED_IMAGE_EXTENSIONS: &[&str] = &["gif", "jpeg", "jpg", "png", "webp"];

#[tauri::command]
pub fn list_unused_media(
    state: State<'_, AppState>,
) -> Result<Vec<MediaCleanupCandidateDto>, String> {
    state.with_workspace(find_unused_media)?
}

#[tauri::command]
pub fn move_unused_media_to_trash(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<MediaTrashResultDto, String> {
    state.with_workspace(|workspace| {
        move_unused_media_to_trash_in_workspace(workspace, &paths, |path| {
            trash::delete(path).map_err(|error| error.to_string())
        })
    })?
}

pub(crate) fn find_unused_media(
    workspace: &WorkspaceState,
) -> Result<Vec<MediaCleanupCandidateDto>, String> {
    let Some(media_root) = canonical_media_root(workspace)? else {
        return Ok(Vec::new());
    };
    let canonical_workspace = workspace
        .root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace path: {error}"))?;
    let candidates = scan_media_files(&canonical_workspace, &media_root)?;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let reference_corpus = markdown_reference_corpus(workspace)?;
    Ok(candidates
        .into_iter()
        .filter(|candidate| !reference_corpus.contains(&candidate.path.to_lowercase()))
        .collect())
}

fn move_unused_media_to_trash_in_workspace(
    workspace: &WorkspaceState,
    requested_paths: &[String],
    mut move_to_trash: impl FnMut(&Path) -> Result<(), String>,
) -> Result<MediaTrashResultDto, String> {
    let Some(media_root) = canonical_media_root(workspace)? else {
        return Ok(MediaTrashResultDto {
            moved_paths: Vec::new(),
            skipped_paths: requested_paths.to_vec(),
            failures: Vec::new(),
        });
    };
    let current_unused: HashSet<String> = find_unused_media(workspace)?
        .into_iter()
        .map(|candidate| candidate.path)
        .collect();
    let mut requested = requested_paths.to_vec();
    requested.sort();
    requested.dedup();

    let mut result = MediaTrashResultDto {
        moved_paths: Vec::new(),
        skipped_paths: Vec::new(),
        failures: Vec::new(),
    };

    for path in requested {
        if !current_unused.contains(&path) {
            result.skipped_paths.push(path);
            continue;
        }

        let Some(absolute_path) = resolve_workspace_relative_path(&workspace.root, &path) else {
            result.skipped_paths.push(path);
            continue;
        };
        let canonical_path = match absolute_path.canonicalize() {
            Ok(path) if path.starts_with(&media_root) && path.is_file() => path,
            _ => {
                result.skipped_paths.push(path);
                continue;
            }
        };

        match move_to_trash(&canonical_path) {
            Ok(()) => result.moved_paths.push(path),
            Err(message) => result.failures.push(MediaTrashFailureDto { path, message }),
        }
    }

    Ok(result)
}

fn canonical_media_root(workspace: &WorkspaceState) -> Result<Option<PathBuf>, String> {
    let configured =
        resolve_workspace_relative_path(&workspace.root, &workspace.config.media_folder)
            .ok_or_else(|| "Invalid configured media folder".to_string())?;
    if !configured.exists() {
        return Ok(None);
    }
    let metadata = fs::symlink_metadata(&configured)
        .map_err(|error| format!("Failed to inspect media folder: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Configured media folder must be a regular directory".to_string());
    }

    let canonical_workspace = workspace
        .root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve workspace path: {error}"))?;
    let canonical_media = configured
        .canonicalize()
        .map_err(|error| format!("Failed to resolve media folder: {error}"))?;
    if !canonical_media.starts_with(canonical_workspace) {
        return Err("Configured media folder resolves outside the workspace".to_string());
    }
    Ok(Some(canonical_media))
}

fn scan_media_files(
    workspace_root: &Path,
    media_root: &Path,
) -> Result<Vec<MediaCleanupCandidateDto>, String> {
    let mut candidates = Vec::new();
    let mut visited = HashSet::new();
    scan_media_directory(
        workspace_root,
        media_root,
        media_root,
        &mut visited,
        &mut candidates,
    )?;
    candidates.sort_by_cached_key(|candidate| candidate.path.to_lowercase());
    Ok(candidates)
}

fn scan_media_directory(
    workspace_root: &Path,
    media_root: &Path,
    directory: &Path,
    visited: &mut HashSet<PathBuf>,
    candidates: &mut Vec<MediaCleanupCandidateDto>,
) -> Result<(), String> {
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| format!("Failed to resolve media directory: {error}"))?;
    if !canonical_directory.starts_with(media_root) || !visited.insert(canonical_directory) {
        return Ok(());
    }

    for entry in fs::read_dir(directory).map_err(|error| {
        format!(
            "Failed to read media directory '{}': {error}",
            directory.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to read media entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect '{}': {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            scan_media_directory(
                workspace_root,
                media_root,
                &entry.path(),
                visited,
                candidates,
            )?;
            continue;
        }
        if !file_type.is_file() || !is_supported_image_path(&entry.path()) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("Failed to inspect '{}': {error}", entry.path().display()))?;
        let relative = entry
            .path()
            .strip_prefix(workspace_root)
            .map_err(|error| format!("Failed to create workspace-relative media path: {error}"))?
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        candidates.push(MediaCleanupCandidateDto {
            path: relative,
            size_bytes: metadata.len(),
        });
    }

    Ok(())
}

fn is_supported_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            SUPPORTED_IMAGE_EXTENSIONS
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn markdown_reference_corpus(workspace: &WorkspaceState) -> Result<String, String> {
    let markdown_files =
        scan_workspace_excluding(&workspace.root, Some(&workspace.config.media_folder))?
            .markdown_files;
    let mut corpus = String::new();

    for path in markdown_files {
        let absolute_path = resolve_workspace_relative_path(&workspace.root, &path)
            .ok_or_else(|| format!("Invalid Markdown path '{path}'"))?;
        let content = fs::read_to_string(&absolute_path)
            .map_err(|error| format!("Failed to inspect media references in '{path}': {error}"))?;
        let decoded = percent_decode_str(&content).decode_utf8_lossy();
        corpus.push_str(&decoded.replace('\\', "/").to_lowercase());
        corpus.push('\n');
    }

    Ok(corpus)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_snapshot::ContentSnapshot;
    use crate::index::backlink_index::BacklinkIndex;
    use crate::index::page_index::PageIndex;
    use crate::workspace_config::WorkspaceConfig;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn lists_only_unreferenced_supported_images() {
        let (root, workspace) = temp_workspace();
        fs::write(root.join("media/used image.png"), b"used").unwrap();
        fs::write(root.join("media/unused.jpg"), b"unused").unwrap();
        fs::write(root.join("media/readme.txt"), b"text").unwrap();
        fs::write(root.join("Notes.md"), "![Used](media/used%20image.png)").unwrap();

        assert_eq!(
            find_unused_media(&workspace).unwrap(),
            vec![MediaCleanupCandidateDto {
                path: "media/unused.jpg".to_string(),
                size_bytes: 6,
            }]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rechecks_references_and_never_falls_back_to_permanent_deletion() {
        let (root, workspace) = temp_workspace();
        fs::write(root.join("media/keep.png"), b"keep").unwrap();
        fs::write(root.join("media/fail.png"), b"fail").unwrap();
        fs::write(root.join("Notes.md"), "![Keep](media/keep.png)").unwrap();

        let result = move_unused_media_to_trash_in_workspace(
            &workspace,
            &["media/keep.png".to_string(), "media/fail.png".to_string()],
            |_| Err("system trash unavailable".to_string()),
        )
        .unwrap();

        assert_eq!(result.skipped_paths, vec!["media/keep.png"]);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(result.failures[0].path, "media/fail.png");
        assert!(root.join("media/fail.png").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn moves_only_the_requested_current_candidates() {
        let (root, workspace) = temp_workspace();
        fs::write(root.join("media/unused.png"), b"unused").unwrap();
        let mut moved = Vec::new();

        let result = move_unused_media_to_trash_in_workspace(
            &workspace,
            &["media/unused.png".to_string(), "outside.png".to_string()],
            |path| {
                moved.push(path.to_path_buf());
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(result.moved_paths, vec!["media/unused.png"]);
        assert_eq!(result.skipped_paths, vec!["outside.png"]);
        assert_eq!(
            moved,
            vec![root.join("media/unused.png").canonicalize().unwrap()]
        );
        fs::remove_dir_all(root).unwrap();
    }

    fn temp_workspace() -> (PathBuf, WorkspaceState) {
        let root = std::env::temp_dir().join(format!(
            "logtext-media-cleanup-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("media")).unwrap();
        fs::write(root.join("Notes.md"), "# Notes").unwrap();
        let workspace = WorkspaceState {
            root: root.clone(),
            config: WorkspaceConfig::default(),
            folders: Vec::new(),
            pages: PageIndex::default(),
            backlinks: BacklinkIndex::default(),
            contents: ContentSnapshot::default(),
        };
        (root, workspace)
    }
}
