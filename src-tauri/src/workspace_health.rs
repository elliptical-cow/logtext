//! Read-only workspace diagnostics built from the existing indexes and Markdown source.

use std::collections::BTreeMap;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::State;

use crate::app_state::{AppState, WorkspaceState};
use crate::media_cleanup::find_unused_media;
use crate::workspace::paths::resolve_workspace_relative_path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHealthReport {
    pub issues: Vec<WorkspaceHealthIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHealthIssue {
    pub kind: String,
    pub severity: String,
    pub path: Option<String>,
    pub line: Option<usize>,
    pub target: Option<String>,
    pub message: String,
    pub context: Option<String>,
}

#[tauri::command]
pub fn get_workspace_health(state: State<'_, AppState>) -> Result<WorkspaceHealthReport, String> {
    state.with_workspace(build_workspace_health_report)?
}

pub(crate) fn build_workspace_health_report(
    workspace: &WorkspaceState,
) -> Result<WorkspaceHealthReport, String> {
    let pages = workspace.pages.pages();
    let mut issues = Vec::new();

    let mut paths_by_key: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for page in &pages {
        paths_by_key.entry(&page.key).or_default().push(&page.path);
    }
    for (key, paths) in paths_by_key.iter().filter(|(_, paths)| paths.len() > 1) {
        issues.push(WorkspaceHealthIssue {
            kind: "page-key-collision".to_string(),
            severity: "error".to_string(),
            path: paths.first().map(|path| (*path).to_string()),
            line: None,
            target: Some((*key).to_string()),
            message: format!(
                "{} pages resolve to the same case-insensitive page name.",
                paths.len()
            ),
            context: Some(paths.join(", ")),
        });
    }

    let backlinks: Vec<_> = workspace.backlinks.all_backlinks().collect();
    for backlink in &backlinks {
        if workspace
            .pages
            .paths_for_key(&backlink.target_key)
            .is_empty()
        {
            issues.push(WorkspaceHealthIssue {
                kind: "missing-wiki-target".to_string(),
                severity: "warning".to_string(),
                path: Some(backlink.source_path.clone()),
                line: Some(backlink.line_start),
                target: Some(backlink.target.clone()),
                message: format!("Wiki link target '{}' does not exist.", backlink.target),
                context: Some(backlink.block_markdown.clone()),
            });
        }
    }

    let journal_prefix = format!("{}/", workspace.config.journal_folder.trim_matches('/'));
    for page in &pages {
        if page.path.starts_with(&journal_prefix) {
            continue;
        }
        let has_external_backlink = backlinks
            .iter()
            .any(|backlink| backlink.target_key == page.key && backlink.source_path != page.path);
        if !has_external_backlink {
            issues.push(WorkspaceHealthIssue {
                kind: "orphan-page".to_string(),
                severity: "info".to_string(),
                path: Some(page.path.clone()),
                line: None,
                target: None,
                message: "Page has no incoming links from another page.".to_string(),
                context: Some(page.title.clone()),
            });
        }
    }

    for page in &pages {
        let markdown = workspace
            .contents
            .get_or_read(&workspace.root, &page.path)?;
        for reference in markdown_image_references(&markdown) {
            let decoded = percent_decode_str(&reference.target)
                .decode_utf8_lossy()
                .replace('\\', "/");
            if is_external_image_target(&decoded) {
                continue;
            }
            let Some(absolute_path) = resolve_workspace_relative_path(&workspace.root, &decoded)
            else {
                continue;
            };
            if !absolute_path.is_file() {
                issues.push(WorkspaceHealthIssue {
                    kind: "missing-media".to_string(),
                    severity: "warning".to_string(),
                    path: Some(page.path.clone()),
                    line: Some(reference.line),
                    target: Some(decoded),
                    message: "Referenced local image does not exist.".to_string(),
                    context: Some(reference.markdown),
                });
            }
        }
    }

    for media in find_unused_media(workspace)? {
        issues.push(WorkspaceHealthIssue {
            kind: "unused-media".to_string(),
            severity: "info".to_string(),
            path: None,
            line: None,
            target: Some(media.path),
            message: "Image is not referenced by any Markdown page.".to_string(),
            context: Some(format!("{} bytes", media.size_bytes)),
        });
    }

    let severity_rank = |severity: &str| match severity {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    };
    issues.sort_by(|left, right| {
        severity_rank(&left.severity)
            .cmp(&severity_rank(&right.severity))
            .then(left.kind.cmp(&right.kind))
            .then(left.path.cmp(&right.path))
            .then(left.line.cmp(&right.line))
            .then(left.target.cmp(&right.target))
    });

    Ok(WorkspaceHealthReport { issues })
}

struct MarkdownImageReference {
    line: usize,
    target: String,
    markdown: String,
}

fn markdown_image_references(markdown: &str) -> Vec<MarkdownImageReference> {
    let mut references = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for (line_index, line) in markdown.lines().enumerate() {
        if let Some(marker) = markdown_fence_marker(line) {
            match fence {
                Some((open_character, open_length))
                    if marker.0 == open_character && marker.1 >= open_length =>
                {
                    fence = None;
                }
                None => fence = Some(marker),
                _ => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let mut offset = 0;
        while let Some(image_start) = line[offset..].find("![") {
            let start = offset + image_start;
            if start > 0 && line.as_bytes()[start - 1] == b'\\' {
                offset = start + 2;
                continue;
            }
            let Some(label_end) = line[start + 2..].find("](") else {
                break;
            };
            let target_start = start + 2 + label_end + 2;
            let Some(close_offset) = line[target_start..].find(')') else {
                break;
            };
            let end = target_start + close_offset;
            let raw = line[target_start..end].trim();
            let target = markdown_image_target(raw);
            if !target.is_empty() {
                references.push(MarkdownImageReference {
                    line: line_index + 1,
                    target,
                    markdown: line[start..=end].to_string(),
                });
            }
            offset = end + 1;
        }
    }
    references
}

fn markdown_fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let marker = trimmed.chars().next()?;
    if marker != '`' && marker != '~' {
        return None;
    }
    let length = trimmed
        .chars()
        .take_while(|character| *character == marker)
        .count();
    (length >= 3).then_some((marker, length))
}

fn markdown_image_target(raw: &str) -> String {
    if let Some(target) = raw
        .strip_prefix('<')
        .and_then(|value| value.split_once('>'))
    {
        return target.0.to_string();
    }
    raw.split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string()
}

fn is_external_image_target(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.starts_with("http:")
        || lower.starts_with("https:")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content_snapshot::ContentSnapshot;
    use crate::index::backlink_index::BacklinkIndex;
    use crate::index::page_index::PageIndex;
    use crate::workspace_config::WorkspaceConfig;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reports_workspace_issues_without_modifying_files() {
        let root = temp_workspace();
        fs::create_dir_all(root.join("media")).unwrap();
        fs::create_dir_all(root.join("journals")).unwrap();
        fs::write(
            root.join("Source.md"),
            "# Source\n\n- [[Missing Page]]\n- ![Missing](media/missing.png)",
        )
        .unwrap();
        fs::write(root.join("Target.md"), "# Target").unwrap();
        fs::write(root.join("target.md"), "# Duplicate").unwrap();
        fs::write(root.join("Orphan.md"), "# Orphan").unwrap();
        fs::write(root.join("journals/2026-10-07.md"), "# Journal").unwrap();
        fs::write(root.join("media/unused.png"), b"unused").unwrap();

        let workspace = indexed_workspace(&root);
        let report = build_workspace_health_report(&workspace).unwrap();

        assert!(report
            .issues
            .iter()
            .any(|issue| issue.kind == "page-key-collision"));
        assert!(report.issues.iter().any(|issue| {
            issue.kind == "missing-wiki-target"
                && issue.path.as_deref() == Some("Source.md")
                && issue.line == Some(3)
                && issue.target.as_deref() == Some("Missing Page")
        }));
        assert!(report.issues.iter().any(|issue| {
            issue.kind == "missing-media" && issue.target.as_deref() == Some("media/missing.png")
        }));
        assert!(report.issues.iter().any(|issue| {
            issue.kind == "unused-media" && issue.target.as_deref() == Some("media/unused.png")
        }));
        assert!(report.issues.iter().any(|issue| {
            issue.kind == "orphan-page" && issue.path.as_deref() == Some("Orphan.md")
        }));
        assert!(!report.issues.iter().any(|issue| {
            issue.kind == "orphan-page" && issue.path.as_deref() == Some("journals/2026-10-07.md")
        }));
        assert_eq!(
            fs::read_to_string(root.join("Source.md")).unwrap(),
            "# Source\n\n- [[Missing Page]]\n- ![Missing](media/missing.png)"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_angle_bracket_targets_and_ignores_remote_images() {
        let references = markdown_image_references(
            "![Local](<media/my image.png> \"title\") ![Remote](https://example.test/a.png)",
        );
        assert_eq!(references.len(), 2);
        assert_eq!(references[0].target, "media/my image.png");
        assert!(is_external_image_target(&references[1].target));
    }

    #[test]
    fn ignores_images_in_fenced_code_and_escaped_image_syntax() {
        let references = markdown_image_references(
            "```md\n![Example](media/example.png)\n```\n\\![Escaped](media/escaped.png)\n![Real](media/real.png)",
        );

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].target, "media/real.png");
        assert_eq!(references[0].line, 5);
    }

    fn indexed_workspace(root: &std::path::Path) -> WorkspaceState {
        let paths = [
            "Source.md",
            "Target.md",
            "target.md",
            "Orphan.md",
            "journals/2026-10-07.md",
        ];
        let mut pages = PageIndex::default();
        let mut backlinks = BacklinkIndex::default();
        let mut contents = ContentSnapshot::default();
        for path in paths {
            let content = fs::read_to_string(root.join(path)).unwrap();
            pages.insert_page(path.to_string(), &content);
            backlinks.index_page(path.to_string(), &content);
            contents.insert(path.to_string(), content);
        }
        let mut config = WorkspaceConfig::default();
        config.journal_folder = "journals".to_string();
        WorkspaceState {
            root: root.to_path_buf(),
            config,
            folders: vec!["journals".to_string(), "media".to_string()],
            pages,
            backlinks,
            contents,
        }
    }

    fn temp_workspace() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "logtext-workspace-health-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
