use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use tauri::State;

use crate::app_state::AppState;
use crate::dto::{workspace_state, WorkspaceStateDto};
use crate::page_ops::is_valid_journal_file_name;
use crate::query::list_tasks_in_workspace;
use crate::workspace::paths::resolve_workspace_relative_path;
use crate::workspace::scanner::scan_workspace;
use crate::workspace_config::{
    apply_workspace_preferences, normalize_backlink_view_config, normalize_expanded_folders,
    normalize_folder_colors, normalize_folder_page_sort, normalize_last_opened_at,
    normalize_manual_page_order, normalize_navigation_layout_config, normalize_optional_page_path,
    normalize_page_path_list, normalize_page_sort, normalize_task_overview_config,
    normalize_theme_mode, save_workspace_config, BacklinkViewConfig, NavigationLayoutConfig,
    TaskOverviewConfig, WorkspacePreferences, DEFAULT_PAGE_SORT,
};
use crate::workspace_index::{apply_workspace_index, build_workspace_index};

#[tauri::command]
pub fn save_workspace_preferences(
    preferences: WorkspacePreferences,
    state: State<'_, AppState>,
) -> Result<WorkspaceStateDto, String> {
    state.with_workspace_mut(|workspace| {
        let next_config = apply_workspace_preferences(&workspace.config, preferences)?;
        validate_removed_task_states(workspace, &next_config.task_states)?;

        validate_journal_folder_contents(&workspace.root, &next_config.journal_folder)?;
        validate_media_folder_target(&workspace.root, &next_config.media_folder)?;

        let next_index = (next_config.media_folder != workspace.config.media_folder)
            .then(|| build_workspace_index(&workspace.root, &next_config.media_folder))
            .transpose()?;

        save_workspace_config(&workspace.root, &next_config)?;
        workspace.config = next_config;
        if let Some(next_index) = next_index {
            apply_workspace_index(workspace, next_index);
        }

        Ok(workspace_state(workspace))
    })?
}

fn validate_removed_task_states(
    workspace: &crate::app_state::WorkspaceState,
    next_states: &[String],
) -> Result<(), String> {
    let removed: BTreeSet<&str> = workspace
        .config
        .task_states
        .iter()
        .map(String::as_str)
        .filter(|state| !next_states.iter().any(|candidate| candidate == state))
        .collect();
    if removed.is_empty() {
        return Ok(());
    }

    let mut used = BTreeMap::<String, usize>::new();
    for task in list_tasks_in_workspace(workspace)? {
        if removed.contains(task.status.as_str()) {
            *used.entry(task.status).or_default() += 1;
        }
    }
    if used.is_empty() {
        return Ok(());
    }

    let summary = used
        .into_iter()
        .map(|(state, count)| format!("{state} ({count})"))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Task states still in use cannot be removed or renamed: {summary}. Update those Markdown tasks first."
    ))
}

fn validate_journal_folder_contents(root: &Path, journal_folder: &str) -> Result<(), String> {
    let path = resolve_workspace_relative_path(root, journal_folder)
        .ok_or_else(|| format!("Invalid journal folder '{journal_folder}'"))?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect journal folder '{}': {error}",
                path.display()
            ))
        }
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "Journal folder '{journal_folder}' must be a regular directory inside the workspace."
        ));
    }

    for entry in fs::read_dir(&path).map_err(|error| {
        format!(
            "Failed to read journal folder '{}': {error}",
            path.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!("Failed to read an entry in journal folder '{journal_folder}': {error}")
        })?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect '{}': {error}", entry.path().display()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !file_type.is_file() || !is_valid_journal_file_name(&name) {
            return Err(format!(
                "Journal folder '{journal_folder}' may contain only valid YYYY-MM-DD.md files and no subfolders. Invalid entry: '{name}'."
            ));
        }
    }
    Ok(())
}

fn validate_media_folder_target(root: &Path, media_folder: &str) -> Result<(), String> {
    let path = resolve_workspace_relative_path(root, media_folder)
        .ok_or_else(|| format!("Invalid media folder '{media_folder}'"))?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
            return Err(format!(
                "Media folder '{media_folder}' must be a regular directory inside the workspace."
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to inspect media folder '{}': {error}",
                path.display()
            ));
        }
    }

    let hidden_pages = if path.is_dir() {
        scan_workspace(&path)?.markdown_files.len()
    } else {
        0
    };
    if hidden_pages > 0 {
        return Err(format!(
            "Media folder '{media_folder}' contains {hidden_pages} Markdown page(s). Choose a folder without Markdown pages."
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn save_expanded_folders(
    expanded_folders: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.with_workspace_mut(|workspace| {
        workspace.config.expanded_folders = Some(normalize_expanded_folders(expanded_folders));
        save_workspace_config(&workspace.root, &workspace.config)
    })?
}

#[tauri::command]
pub fn save_task_overview_config(
    task_overview: TaskOverviewConfig,
    expected_workspace_root: String,
    state: State<'_, AppState>,
) -> Result<TaskOverviewConfig, String> {
    state.with_workspace_mut(|workspace| {
        save_task_overview_config_in_workspace(workspace, &expected_workspace_root, task_overview)
    })?
}

fn save_task_overview_config_in_workspace(
    workspace: &mut crate::app_state::WorkspaceState,
    expected_workspace_root: &str,
    task_overview: TaskOverviewConfig,
) -> Result<TaskOverviewConfig, String> {
    if workspace.root.to_string_lossy() != expected_workspace_root {
        return Err("Workspace changed before task overview settings could be saved".to_string());
    }

    let normalized = normalize_task_overview_config(task_overview);
    let mut next_config = workspace.config.clone();
    next_config.task_overview = normalized.clone();
    save_workspace_config(&workspace.root, &next_config)?;
    workspace.config = next_config;
    Ok(normalized)
}

#[tauri::command]
pub fn save_backlink_view_config(
    backlink_view: BacklinkViewConfig,
    state: State<'_, AppState>,
) -> Result<BacklinkViewConfig, String> {
    state.with_workspace_mut(|workspace| {
        let backlink_view = normalize_backlink_view_config(backlink_view);
        workspace.config.backlink_view = backlink_view.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok(backlink_view)
    })?
}

#[tauri::command]
pub fn save_theme_config(theme_mode: String, state: State<'_, AppState>) -> Result<String, String> {
    state.with_workspace_mut(|workspace| {
        let theme_mode = normalize_theme_mode(theme_mode);
        workspace.config.theme_mode = theme_mode.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok(theme_mode)
    })?
}

#[tauri::command]
pub fn save_page_sort_config(
    default_page_sort: String,
    folder_page_sort: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(String, HashMap<String, String>), String> {
    state.with_workspace_mut(|workspace| {
        let default_page_sort = normalize_page_sort(default_page_sort, DEFAULT_PAGE_SORT);
        let folder_page_sort = normalize_folder_page_sort(folder_page_sort, &default_page_sort);
        workspace.config.default_page_sort = default_page_sort.clone();
        workspace.config.folder_page_sort = folder_page_sort.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok((default_page_sort, folder_page_sort))
    })?
}

#[tauri::command]
pub fn save_manual_page_order_config(
    manual_page_order: HashMap<String, Vec<String>>,
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<String>>, String> {
    state.with_workspace_mut(|workspace| {
        let manual_page_order = normalize_manual_page_order(manual_page_order);
        workspace.config.manual_page_order = manual_page_order.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok(manual_page_order)
    })?
}

#[tauri::command]
pub fn save_folder_colors_config(
    folder_colors: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    state.with_workspace_mut(|workspace| {
        let folder_colors = normalize_folder_colors(folder_colors);
        workspace.config.folder_colors = folder_colors.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok(folder_colors)
    })?
}

#[tauri::command]
pub fn save_workspace_session_config(
    last_editor_path: Option<String>,
    last_right_pane_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.with_workspace_mut(|workspace| {
        workspace.config.last_editor_path = normalize_optional_page_path(last_editor_path);
        workspace.config.last_right_pane_path = normalize_optional_page_path(last_right_pane_path);
        save_workspace_config(&workspace.root, &workspace.config)
    })?
}

#[tauri::command]
pub fn save_navigation_config(
    page_favorites: Vec<String>,
    recent_pages: Vec<String>,
    last_opened_at: HashMap<String, u64>,
    state: State<'_, AppState>,
) -> Result<(Vec<String>, Vec<String>, HashMap<String, u64>), String> {
    state.with_workspace_mut(|workspace| {
        let page_favorites = normalize_page_path_list(page_favorites, usize::MAX);
        let recent_pages = normalize_page_path_list(recent_pages, 10);
        let last_opened_at = merge_last_opened_at(workspace, last_opened_at)?;
        workspace.config.page_favorites = page_favorites.clone();
        workspace.config.recent_pages = recent_pages.clone();
        workspace.config.last_opened_at = last_opened_at.clone();
        save_workspace_config(&workspace.root, &workspace.config)?;
        Ok((page_favorites, recent_pages, last_opened_at))
    })?
}

fn merge_last_opened_at(
    workspace: &crate::app_state::WorkspaceState,
    submitted: HashMap<String, u64>,
) -> Result<HashMap<String, u64>, String> {
    let mut merged = workspace.config.last_opened_at.clone();
    for (path, timestamp) in normalize_last_opened_at(submitted) {
        let entry = merged.entry(path).or_default();
        *entry = (*entry).max(timestamp);
    }

    let mut current_paths: HashMap<String, u64> = HashMap::new();
    for (path, timestamp) in normalize_last_opened_at(merged) {
        if let Some(canonical_path) = workspace.pages.resolve_path(&path)? {
            let entry = current_paths.entry(canonical_path).or_default();
            *entry = (*entry).max(timestamp);
        }
    }
    Ok(current_paths)
}

#[tauri::command]
pub fn record_page_opened(
    path: String,
    opened_at: u64,
    state: State<'_, AppState>,
) -> Result<(Vec<String>, HashMap<String, u64>), String> {
    state.with_workspace_mut(|workspace| {
        if opened_at == 0 {
            return Err("Page open timestamp must be greater than zero".to_string());
        }
        let path = normalize_optional_page_path(Some(path))
            .ok_or_else(|| "Invalid page path for open history".to_string())?;
        let path = workspace
            .pages
            .resolve_path(&path)?
            .ok_or_else(|| format!("Page '{path}' is not part of the workspace"))?;

        let mut next_config = workspace.config.clone();
        let recent_pages = normalize_page_path_list(
            std::iter::once(path.clone())
                .chain(next_config.recent_pages.iter().cloned())
                .collect(),
            10,
        );
        next_config.recent_pages = recent_pages.clone();
        let timestamp = next_config.last_opened_at.entry(path).or_default();
        *timestamp = (*timestamp).max(opened_at);
        save_workspace_config(&workspace.root, &next_config)?;
        workspace.config = next_config;

        Ok((recent_pages, workspace.config.last_opened_at.clone()))
    })?
}

#[tauri::command]
pub fn save_navigation_layout_config(
    navigation_layout: NavigationLayoutConfig,
    state: State<'_, AppState>,
) -> Result<NavigationLayoutConfig, String> {
    state.with_workspace_mut(|workspace| {
        let navigation_layout = normalize_navigation_layout_config(navigation_layout);
        let mut next_config = workspace.config.clone();
        next_config.navigation_layout = navigation_layout.clone();
        save_workspace_config(&workspace.root, &next_config)?;
        workspace.config = next_config;
        Ok(navigation_layout)
    })?
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::app_state::WorkspaceState;
    use crate::content_snapshot::ContentSnapshot;
    use crate::index::backlink_index::BacklinkIndex;
    use crate::index::page_index::PageIndex;
    use crate::workspace_config::WorkspaceConfig;
    use crate::workspace_index::reindex_workspace;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn journal_folder_accepts_dates_and_rejects_other_entries() {
        let root = temp_workspace();
        let journal = root.join("daily");
        fs::create_dir(&journal).unwrap();
        fs::write(journal.join("2024-02-29.md"), "# Leap day").unwrap();
        assert!(validate_journal_folder_contents(&root, "daily").is_ok());

        fs::write(journal.join("notes.md"), "# Notes").unwrap();
        let error = validate_journal_folder_contents(&root, "daily").unwrap_err();
        assert!(error.contains("notes.md"));

        fs::remove_file(journal.join("notes.md")).unwrap();
        fs::create_dir(journal.join("nested")).unwrap();
        let error = validate_journal_folder_contents(&root, "daily").unwrap_err();
        assert!(error.contains("nested"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn media_folder_rejects_a_target_that_contains_markdown_pages() {
        let root = temp_workspace();
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/Page.md"), "# Page").unwrap();
        let error = validate_media_folder_target(&root, "notes").unwrap_err();

        assert!(error.contains("1 Markdown page"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removing_a_used_task_state_is_blocked() {
        let root = temp_workspace();
        fs::write(root.join("Tasks.md"), "# Tasks\n\n- TODO Keep this").unwrap();
        let workspace = indexed_workspace(root.clone());

        let error = validate_removed_task_states(&workspace, &["DONE".to_string()]).unwrap_err();

        assert!(error.contains("TODO (1)"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removing_an_unused_task_state_is_allowed() {
        let root = temp_workspace();
        fs::write(root.join("Tasks.md"), "# Tasks\n\n- TODO Keep this").unwrap();
        let workspace = indexed_workspace(root.clone());

        assert!(validate_removed_task_states(
            &workspace,
            &["TODO".to_string(), "DONE".to_string()]
        )
        .is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn task_overview_save_rejects_a_stale_workspace_root() {
        let root = temp_workspace();
        let mut workspace = indexed_workspace(root.clone());
        let original = workspace.config.task_overview.clone();

        let error = save_task_overview_config_in_workspace(
            &mut workspace,
            "/another/workspace",
            TaskOverviewConfig {
                text_filter: "stale".to_string(),
                ..TaskOverviewConfig::default()
            },
        )
        .unwrap_err();

        assert!(error.contains("Workspace changed"));
        assert_eq!(workspace.config.task_overview, original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn task_overview_save_preserves_unrelated_workspace_config() {
        let root = temp_workspace();
        let mut workspace = indexed_workspace(root.clone());
        workspace.config.page_favorites = vec!["Keep.md".to_string()];
        let expected_root = root.to_string_lossy().to_string();

        let saved = save_task_overview_config_in_workspace(
            &mut workspace,
            &expected_root,
            TaskOverviewConfig {
                text_filter: "owner".to_string(),
                group_mode: "attribute".to_string(),
                group_attribute_name: "owner".to_string(),
                ..TaskOverviewConfig::default()
            },
        )
        .unwrap();

        assert_eq!(saved.text_filter, "owner");
        assert_eq!(workspace.config.task_overview, saved);
        assert_eq!(workspace.config.page_favorites, vec!["Keep.md"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn merging_open_history_keeps_newer_values_and_drops_missing_pages() {
        let root = temp_workspace();
        fs::write(root.join("Alpha.md"), "# Alpha").unwrap();
        fs::write(root.join("Beta.md"), "# Beta").unwrap();
        let mut workspace = indexed_workspace(root.clone());
        workspace.config.last_opened_at = HashMap::from([
            ("Alpha.md".to_string(), 300),
            ("Deleted.md".to_string(), 500),
        ]);

        let merged = merge_last_opened_at(
            &workspace,
            HashMap::from([("Alpha.md".to_string(), 100), ("Beta.md".to_string(), 200)]),
        )
        .unwrap();

        assert_eq!(merged.get("Alpha.md"), Some(&300));
        assert_eq!(merged.get("Beta.md"), Some(&200));
        assert!(!merged.contains_key("Deleted.md"));
        fs::remove_dir_all(root).unwrap();
    }

    fn indexed_workspace(root: std::path::PathBuf) -> WorkspaceState {
        let mut workspace = WorkspaceState {
            root,
            config: WorkspaceConfig::default(),
            folders: Vec::new(),
            pages: PageIndex::default(),
            backlinks: BacklinkIndex::default(),
            contents: ContentSnapshot::default(),
        };
        reindex_workspace(&mut workspace).unwrap();
        workspace
    }

    fn temp_workspace() -> std::path::PathBuf {
        let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "logtext-preferences-test-{}-{nanos}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
