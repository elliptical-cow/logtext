use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;
use serde::Serialize;

use crate::index::page_index::markdown_with_h1;
use crate::parser::wiki_links::{
    is_markdown_code_position, parse_wiki_links, rewrite_wiki_link_targets,
};
use crate::workspace_config::{save_workspace_config, WorkspaceConfig, DEFAULT_TASK_STATES};

const REPORT_FILE: &str = ".logseq-import-report.json";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LogseqImportOptions {
    pub dry_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogseqImportReport {
    pub source: String,
    pub destination: String,
    pub dry_run: bool,
    pub pages_converted: usize,
    pub journals_converted: usize,
    pub assets_found: usize,
    pub assets_copied: usize,
    pub wiki_links_rewritten: usize,
    pub asset_links_rewritten: usize,
    pub headings_added: usize,
    pub unresolved_wiki_links: Vec<String>,
    pub unsupported: UnsupportedLogseqSyntax,
    pub mappings: Vec<ImportPathMapping>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedLogseqSyntax {
    pub block_references: usize,
    pub embeds: usize,
    pub queries: usize,
    pub macros: usize,
    pub org_files: usize,
    pub whiteboard_files: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPathMapping {
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageKind {
    Page,
    Journal,
}

#[derive(Debug, Clone)]
struct PlannedPage {
    source_absolute: PathBuf,
    source_relative: String,
    destination_relative: String,
    logical_target: String,
    kind: PageKind,
    converted_content: Option<String>,
}

#[derive(Debug)]
struct ImportPlan {
    destination: PathBuf,
    pages: Vec<PlannedPage>,
    assets: Vec<(PathBuf, String)>,
    link_targets: HashMap<String, Option<String>>,
    unresolved_link_targets: BTreeSet<String>,
    task_states: BTreeSet<String>,
    report: LogseqImportReport,
}

pub fn import_logseq_graph(
    source: &Path,
    destination: &Path,
    options: LogseqImportOptions,
) -> Result<LogseqImportReport, String> {
    let mut plan = build_import_plan(source, destination, options)?;
    convert_page_contents(&mut plan)?;

    if !options.dry_run {
        write_import(&plan)?;
    }

    Ok(plan.report)
}

fn build_import_plan(
    source: &Path,
    destination: &Path,
    options: LogseqImportOptions,
) -> Result<ImportPlan, String> {
    let source = source.canonicalize().map_err(|error| {
        format!(
            "Failed to open source graph '{}': {error}",
            source.display()
        )
    })?;
    if !source.is_dir() {
        return Err("The Logseq graph path is not a directory.".to_string());
    }

    let destination = absolute_path(destination)?;
    if destination.exists() {
        return Err(format!(
            "Destination '{}' already exists. Choose a new workspace path.",
            destination.display()
        ));
    }
    if destination.starts_with(&source) {
        return Err("The destination must not be inside the source graph.".to_string());
    }

    let config = read_logseq_config(&source)?;
    let pages_directory = config
        .as_deref()
        .and_then(|value| edn_string_setting(value, ":pages-directory"))
        .unwrap_or_else(|| "pages".to_string());
    let journals_directory = config
        .as_deref()
        .and_then(|value| edn_string_setting(value, ":journals-directory"))
        .unwrap_or_else(|| "journals".to_string());
    validate_source_directory_setting(&pages_directory, "pages-directory")?;
    validate_source_directory_setting(&journals_directory, "journals-directory")?;

    let page_root = source.join(&pages_directory);
    let journal_root = source.join(&journals_directory);
    let mut pages = Vec::new();
    collect_planned_pages(&source, &page_root, PageKind::Page, &mut pages)?;
    collect_planned_pages(&source, &journal_root, PageKind::Journal, &mut pages)?;

    if pages.is_empty() {
        if source.join("db.sqlite").is_file() {
            return Err(
                "This appears to be a Logseq DB graph. Export it as Markdown before importing."
                    .to_string(),
            );
        }
        return Err(format!(
            "No Markdown pages were found in '{}' or '{}'.",
            pages_directory, journals_directory
        ));
    }

    pages.sort_by(|left, right| left.source_relative.cmp(&right.source_relative));
    validate_destination_collisions(&pages)?;
    let link_targets = build_link_targets(&pages);
    let assets = collect_assets(&source.join("assets"))?;
    let assets_found = assets.len();
    let mut org_files = count_files_with_extension(&page_root, "org")?;
    if journal_root != page_root {
        org_files += count_files_with_extension(&journal_root, "org")?;
    }
    let unsupported = UnsupportedLogseqSyntax {
        org_files,
        whiteboard_files: count_files_with_extension(&source.join("whiteboards"), "edn")?,
        ..UnsupportedLogseqSyntax::default()
    };
    let mappings = pages
        .iter()
        .map(|page| ImportPathMapping {
            source: page.source_relative.clone(),
            destination: page.destination_relative.clone(),
        })
        .collect();
    let pages_converted = pages
        .iter()
        .filter(|page| page.kind == PageKind::Page)
        .count();
    let journals_converted = pages.len() - pages_converted;
    let mut warnings = Vec::new();
    if unsupported.org_files > 0 {
        warnings.push(format!(
            "{} Org-mode file(s) are not imported.",
            unsupported.org_files
        ));
    }
    if unsupported.whiteboard_files > 0 {
        warnings.push(format!(
            "{} Logseq whiteboard file(s) are not imported.",
            unsupported.whiteboard_files
        ));
    }

    Ok(ImportPlan {
        destination: destination.clone(),
        pages,
        assets,
        link_targets,
        unresolved_link_targets: BTreeSet::new(),
        task_states: BTreeSet::new(),
        report: LogseqImportReport {
            source: source.to_string_lossy().to_string(),
            destination: destination.to_string_lossy().to_string(),
            dry_run: options.dry_run,
            pages_converted,
            journals_converted,
            assets_found,
            assets_copied: 0,
            wiki_links_rewritten: 0,
            asset_links_rewritten: 0,
            headings_added: 0,
            unresolved_wiki_links: Vec::new(),
            unsupported,
            mappings,
            warnings,
        },
    })
}

fn collect_planned_pages(
    graph_root: &Path,
    content_root: &Path,
    kind: PageKind,
    pages: &mut Vec<PlannedPage>,
) -> Result<(), String> {
    if !content_root.exists() {
        return Ok(());
    }
    let files = collect_regular_files(content_root)?;
    for source_absolute in files {
        if !has_extension(&source_absolute, "md") {
            continue;
        }
        let relative_to_content = source_absolute
            .strip_prefix(content_root)
            .map_err(|error| {
                format!(
                    "Failed to resolve page path '{}': {error}",
                    source_absolute.display()
                )
            })?;
        let (destination_relative, logical_target) = match kind {
            PageKind::Page => page_destination(relative_to_content)?,
            PageKind::Journal => journal_destination(relative_to_content)?,
        };
        pages.push(PlannedPage {
            source_relative: slash_path(
                source_absolute
                    .strip_prefix(graph_root)
                    .map_err(|error| format!("Failed to make source page relative: {error}"))?,
            ),
            source_absolute,
            destination_relative,
            logical_target,
            kind,
            converted_content: None,
        });
    }
    Ok(())
}

fn page_destination(relative: &Path) -> Result<(String, String), String> {
    let without_extension = relative.with_extension("");
    let mut logical_segments = Vec::new();
    for component in without_extension.components() {
        let Component::Normal(segment) = component else {
            return Err(format!(
                "Invalid Logseq page path '{}'.",
                relative.display()
            ));
        };
        let decoded = percent_decode_str(&segment.to_string_lossy())
            .decode_utf8_lossy()
            .to_string();
        for namespace_segment in decoded.split("___") {
            for path_segment in namespace_segment.split('/') {
                if path_segment.is_empty() || matches!(path_segment, "." | "..") {
                    return Err(format!(
                        "Logseq page path '{}' decodes to an unsafe namespace.",
                        relative.display()
                    ));
                }
                logical_segments.push(path_segment.to_string());
            }
        }
    }
    if logical_segments.is_empty() {
        return Err(format!(
            "Invalid Logseq page path '{}'.",
            relative.display()
        ));
    }
    let logical_target = logical_segments.join("/");
    let safe_segments = logical_segments
        .iter()
        .map(|segment| safe_file_segment(segment))
        .collect::<Vec<_>>();
    Ok((format!("{}.md", safe_segments.join("/")), logical_target))
}

fn journal_destination(relative: &Path) -> Result<(String, String), String> {
    if relative.components().count() != 1 {
        return Err(format!(
            "Nested journal path '{}' is not supported.",
            relative.display()
        ));
    }
    let stem = relative
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Invalid journal filename '{}'.", relative.display()))?;
    let normalized = normalize_journal_date(stem).ok_or_else(|| {
        format!(
            "Journal '{}' does not use YYYY_MM_DD.md or YYYY-MM-DD.md.",
            relative.display()
        )
    })?;
    Ok((format!("journal/{normalized}.md"), stem.to_string()))
}

fn normalize_journal_date(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || !bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'_' || *byte == b'-',
            _ => byte.is_ascii_digit(),
        })
    {
        return None;
    }
    let year: u32 = value[0..4].parse().ok()?;
    let month: u32 = value[5..7].parse().ok()?;
    let day: u32 = value[8..10].parse().ok()?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(400) || (year.is_multiple_of(4) && !year.is_multiple_of(100)) => {
            29
        }
        2 => 28,
        _ => 31,
    }
}

fn safe_file_segment(value: &str) -> String {
    let mut safe = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*')
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    safe = safe.trim().trim_end_matches([' ', '.']).to_string();
    if safe.is_empty() {
        safe = "untitled".to_string();
    }
    let stem = safe
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if is_windows_reserved_name(&stem) {
        safe.insert(0, '_');
    }
    safe
}

fn is_windows_reserved_name(value: &str) -> bool {
    matches!(value, "CON" | "PRN" | "AUX" | "NUL")
        || value
            .strip_prefix("COM")
            .or_else(|| value.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

fn validate_destination_collisions(pages: &[PlannedPage]) -> Result<(), String> {
    let mut destinations: HashMap<String, Vec<&str>> = HashMap::new();
    for page in pages {
        destinations
            .entry(page.destination_relative.to_lowercase())
            .or_default()
            .push(&page.source_relative);
    }
    let collisions = destinations
        .into_iter()
        .filter(|(_, sources)| sources.len() > 1)
        .map(|(destination, sources)| format!("{destination}: {}", sources.join(", ")))
        .collect::<Vec<_>>();
    if collisions.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Multiple Logseq pages map to the same cross-platform path:\n{}",
            collisions.join("\n")
        ))
    }
}

fn build_link_targets(pages: &[PlannedPage]) -> HashMap<String, Option<String>> {
    let mut targets = HashMap::new();
    for page in pages {
        let destination_target = page
            .destination_relative
            .strip_suffix(".md")
            .unwrap_or(&page.destination_relative)
            .to_string();
        insert_link_target(&mut targets, &page.logical_target, &destination_target);
        let source_without_extension = page
            .source_relative
            .strip_suffix(".md")
            .unwrap_or(&page.source_relative);
        insert_link_target(&mut targets, source_without_extension, &destination_target);
        if page.kind == PageKind::Journal {
            let file_name = source_without_extension
                .rsplit('/')
                .next()
                .unwrap_or(source_without_extension);
            insert_link_target(&mut targets, file_name, &destination_target);
            insert_link_target(
                &mut targets,
                &file_name.replace('_', "-"),
                &destination_target,
            );
        }
    }
    targets
}

fn insert_link_target(
    targets: &mut HashMap<String, Option<String>>,
    source_target: &str,
    destination_target: &str,
) {
    let key = normalized_link_key(source_target);
    match targets.get(&key) {
        Some(Some(existing)) if existing != destination_target => {
            targets.insert(key, None);
        }
        Some(_) => {}
        None => {
            targets.insert(key, Some(destination_target.to_string()));
        }
    }
}

fn normalized_link_key(value: &str) -> String {
    value
        .trim()
        .strip_suffix(".md")
        .unwrap_or(value.trim())
        .replace('\\', "/")
        .to_lowercase()
}

fn convert_page_contents(plan: &mut ImportPlan) -> Result<(), String> {
    for page in &mut plan.pages {
        let original = fs::read_to_string(&page.source_absolute).map_err(|error| {
            format!(
                "Failed to read Logseq page '{}': {error}",
                page.source_relative
            )
        })?;
        collect_unsupported_syntax(&original, &mut plan.report.unsupported);
        collect_task_states(&original, &mut plan.task_states);
        for link in parse_wiki_links(&original) {
            if !plan
                .link_targets
                .get(&normalized_link_key(&link.target))
                .is_some_and(Option::is_some)
            {
                plan.unresolved_link_targets.insert(link.target);
            }
        }

        let (with_links, link_count) = rewrite_wiki_link_targets(
            &original,
            |target| link_target_replacement(&plan.link_targets, target).is_some(),
            |target| link_target_replacement(&plan.link_targets, target),
        );
        let (with_assets, asset_count) = rewrite_asset_links(&with_links);
        let heading = match page.kind {
            PageKind::Page => page.logical_target.as_str(),
            PageKind::Journal => page
                .destination_relative
                .strip_prefix("journal/")
                .and_then(|path| path.strip_suffix(".md"))
                .unwrap_or(&page.logical_target),
        };
        let final_content = if let Some(with_heading) = markdown_with_h1(&with_assets, heading) {
            plan.report.headings_added += 1;
            with_heading
        } else {
            with_assets
        };

        plan.report.wiki_links_rewritten += link_count;
        plan.report.asset_links_rewritten += asset_count;
        page.converted_content = Some(final_content);
    }
    if !plan.report.dry_run {
        plan.report.assets_copied = plan.assets.len();
    }
    plan.report.unresolved_wiki_links = plan.unresolved_link_targets.iter().cloned().collect();
    Ok(())
}

fn rewrite_asset_links(markdown: &str) -> (String, usize) {
    let mut rewritten = String::with_capacity(markdown.len());
    let mut cursor = 0;
    let mut replacements = 0;

    while let Some(offset) = markdown[cursor..].find("](") {
        let marker = cursor + offset;
        let target_start = marker + 2;
        rewritten.push_str(&markdown[cursor..target_start]);
        if is_markdown_code_position(markdown, marker) {
            cursor = target_start;
            continue;
        }
        let angle_wrapped = markdown[target_start..].starts_with('<');
        let value_start = target_start + usize::from(angle_wrapped);
        let value_end = markdown[value_start..]
            .char_indices()
            .find(|(_, character)| {
                if angle_wrapped {
                    *character == '>'
                } else {
                    *character == ')' || character.is_whitespace()
                }
            })
            .map(|(index, _)| value_start + index)
            .unwrap_or(markdown.len());
        let target = &markdown[value_start..value_end];
        if angle_wrapped {
            rewritten.push('<');
        }
        if let Some(asset_path) = logseq_asset_path(target) {
            rewritten.push_str("media/");
            rewritten.push_str(asset_path);
            replacements += 1;
        } else {
            rewritten.push_str(target);
        }
        cursor = value_end;
    }
    rewritten.push_str(&markdown[cursor..]);
    (rewritten, replacements)
}

fn logseq_asset_path(target: &str) -> Option<&str> {
    let mut candidate = target;
    while let Some(rest) = candidate.strip_prefix("../") {
        candidate = rest;
    }
    candidate.strip_prefix("assets/")
}

fn link_target_replacement(
    targets: &HashMap<String, Option<String>>,
    target: &str,
) -> Option<String> {
    let destination = targets
        .get(&normalized_link_key(target))
        .and_then(Clone::clone)?;
    (normalized_link_key(target) != normalized_link_key(&destination)).then_some(destination)
}

fn collect_unsupported_syntax(markdown: &str, unsupported: &mut UnsupportedLogseqSyntax) {
    unsupported.block_references += markdown.match_indices("((").count();
    unsupported.embeds += markdown.match_indices("{{embed").count();
    unsupported.queries += markdown.match_indices("{{query").count();
    unsupported.macros += markdown.match_indices("{{{").count();
}

fn collect_task_states(markdown: &str, states: &mut BTreeSet<String>) {
    const LOGSEQ_STATES: [&str; 9] = [
        "TODO",
        "DOING",
        "NOW",
        "LATER",
        "WAITING",
        "INPROGRESS",
        "CANCELED",
        "CANCELLED",
        "DONE",
    ];
    for line in markdown.lines() {
        let mut text = line.trim_start();
        if matches!(text.as_bytes().first(), Some(b'-' | b'*' | b'+')) {
            text = text[1..].trim_start();
        }
        for state in LOGSEQ_STATES {
            if text == state
                || text.strip_prefix(state).is_some_and(|remaining| {
                    remaining.starts_with(char::is_whitespace) || remaining.starts_with("[#")
                })
            {
                states.insert(state.to_string());
                break;
            }
        }
    }
}

fn write_import(plan: &ImportPlan) -> Result<(), String> {
    let parent = plan.destination.parent().ok_or_else(|| {
        format!(
            "Destination '{}' has no parent directory.",
            plan.destination.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create destination parent '{}': {error}",
            parent.display()
        )
    })?;
    let staging = staging_path(parent);
    fs::create_dir(&staging).map_err(|error| {
        format!(
            "Failed to create temporary import directory '{}': {error}",
            staging.display()
        )
    })?;

    let result = write_staging_contents(plan, &staging).and_then(|_| {
        fs::rename(&staging, &plan.destination).map_err(|error| {
            format!(
                "Failed to finalize imported workspace '{}': {error}",
                plan.destination.display()
            )
        })
    });
    if result.is_err() && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn write_staging_contents(plan: &ImportPlan, staging: &Path) -> Result<(), String> {
    for page in &plan.pages {
        let content = page.converted_content.as_ref().ok_or_else(|| {
            format!(
                "Imported page '{}' was not converted before writing.",
                page.source_relative
            )
        })?;
        let destination = staging.join(path_from_slash(&page.destination_relative));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create page directory '{}': {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(&destination, content).map_err(|error| {
            format!(
                "Failed to write imported page '{}': {error}",
                destination.display()
            )
        })?;
    }

    for (source, relative) in &plan.assets {
        let destination = staging.join("media").join(path_from_slash(relative));
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create media directory '{}': {error}",
                    parent.display()
                )
            })?;
        }
        fs::copy(source, &destination)
            .map_err(|error| format!("Failed to copy asset '{}': {error}", source.display()))?;
    }

    let mut config = WorkspaceConfig::default();
    if !plan.task_states.is_empty() {
        let mut imported_states = DEFAULT_TASK_STATES
            .iter()
            .filter(|state| **state != "DONE")
            .map(|state| state.to_string())
            .collect::<Vec<_>>();
        for state in &plan.task_states {
            if state != "DONE" && !imported_states.contains(state) {
                imported_states.push(state.clone());
            }
        }
        imported_states.push("DONE".to_string());
        config.task_states = imported_states;
        config.task_state_colors.clear();
    }
    save_workspace_config(staging, &config)?;
    let report = serde_json::to_string_pretty(&plan.report)
        .map_err(|error| format!("Failed to serialize import report: {error}"))?;
    fs::write(staging.join(REPORT_FILE), format!("{report}\n"))
        .map_err(|error| format!("Failed to write import report: {error}"))?;
    Ok(())
}

fn collect_assets(root: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut assets = collect_regular_files(root)?
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(root)
                .map(slash_path)
                .map_err(|error| format!("Failed to resolve asset path: {error}"))?;
            Ok((path, relative))
        })
        .collect::<Result<Vec<_>, String>>()?;
    assets.sort_by(|left, right| left.1.cmp(&right.1));
    Ok(assets)
}

fn collect_regular_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!(
                "Failed to read directory '{}': {error}",
                directory.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to read an entry in '{}': {error}",
                    directory.display()
                )
            })?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Failed to inspect '{}': {error}", entry.path().display())
            })?;
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                files.push(entry.path());
            }
        }
    }
    files.sort();
    Ok(files)
}

fn count_files_with_extension(root: &Path, extension: &str) -> Result<usize, String> {
    Ok(collect_regular_files(root)?
        .iter()
        .filter(|path| has_extension(path, extension))
        .count())
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
}

fn read_logseq_config(source: &Path) -> Result<Option<String>, String> {
    let path = source.join("logseq").join("config.edn");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))
}

fn edn_string_setting(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let line = line.trim_start();
        if line.starts_with(';') {
            return None;
        }
        let start = line.find(key)? + key.len();
        let remaining = line[start..].trim_start();
        let quoted = remaining.strip_prefix('"')?;
        let end = quoted.find('"')?;
        Some(quoted[..end].to_string())
    })
}

fn validate_source_directory_setting(value: &str, field: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "Logseq {field} must be a safe path relative to the graph root."
        ));
    }
    Ok(())
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {error}"))?
            .join(path)
    };
    if absolute.exists() {
        return absolute
            .canonicalize()
            .map_err(|error| format!("Failed to resolve '{}': {error}", absolute.display()));
    }
    let file_name = absolute
        .file_name()
        .ok_or_else(|| format!("Invalid destination '{}'.", absolute.display()))?;
    let parent = absolute
        .parent()
        .ok_or_else(|| format!("Invalid destination '{}'.", absolute.display()))?;
    let canonical_parent = parent.canonicalize().map_err(|error| {
        format!(
            "Destination parent '{}' must already exist: {error}",
            parent.display()
        )
    })?;
    Ok(canonical_parent.join(file_name))
}

fn staging_path(parent: &Path) -> PathBuf {
    let process = std::process::id();
    for sequence in 0_u32.. {
        let candidate = parent.join(format!(".logtext-import-{process}-{sequence}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn slash_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn path_from_slash(path: &str) -> PathBuf {
    path.split('/').collect()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn imports_pages_journals_links_assets_and_config_without_touching_source() {
        let root = temp_directory();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("pages")).unwrap();
        fs::create_dir_all(source.join("journals")).unwrap();
        fs::create_dir_all(source.join("assets")).unwrap();
        fs::write(
            source.join("pages/Project___Alpha.md"),
            "- TODO See [[pages/Person]]\n- ![Plan](../assets/plan.png)",
        )
        .unwrap();
        fs::write(
            source.join("pages/Person.md"),
            "# Person\n\n- ((1234))\n- {{embed [[Project/Alpha]]}}",
        )
        .unwrap();
        fs::write(
            source.join("journals/2026_09_25.md"),
            "- DOING [[Project/Alpha]]",
        )
        .unwrap();
        fs::write(source.join("assets/plan.png"), b"image").unwrap();
        let source_page_before = fs::read(source.join("pages/Project___Alpha.md")).unwrap();

        let report =
            import_logseq_graph(&source, &destination, LogseqImportOptions::default()).unwrap();

        assert_eq!(report.pages_converted, 2);
        assert_eq!(report.journals_converted, 1);
        assert_eq!(report.assets_found, 1);
        assert_eq!(report.assets_copied, 1);
        assert_eq!(report.wiki_links_rewritten, 1);
        assert_eq!(report.asset_links_rewritten, 1);
        assert_eq!(report.headings_added, 2);
        assert_eq!(report.unsupported.block_references, 1);
        assert_eq!(report.unsupported.embeds, 1);
        assert_eq!(
            fs::read_to_string(destination.join("Project/Alpha.md")).unwrap(),
            "# Project/Alpha\n\n- TODO See [[Person]]\n- ![Plan](media/plan.png)"
        );
        assert_eq!(
            fs::read_to_string(destination.join("journal/2026-09-25.md")).unwrap(),
            "# 2026-09-25\n\n- DOING [[Project/Alpha]]"
        );
        assert_eq!(
            fs::read(destination.join("media/plan.png")).unwrap(),
            b"image"
        );
        assert!(destination.join(".config").is_file());
        assert!(destination.join(REPORT_FILE).is_file());
        let config =
            crate::workspace_config::load_or_create_workspace_config(&destination).unwrap();
        assert!(config.task_states.contains(&"DOING".to_string()));
        assert_eq!(config.task_states.last().map(String::as_str), Some("DONE"));
        assert_eq!(
            fs::read(source.join("pages/Project___Alpha.md")).unwrap(),
            source_page_before
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dry_run_writes_nothing_and_reports_the_conversion() {
        let root = temp_directory();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("pages")).unwrap();
        fs::write(source.join("pages/Notes.md"), "- [[Missing]]").unwrap();

        let report =
            import_logseq_graph(&source, &destination, LogseqImportOptions { dry_run: true })
                .unwrap();

        assert!(report.dry_run);
        assert_eq!(report.pages_converted, 1);
        assert_eq!(report.assets_copied, 0);
        assert_eq!(report.unresolved_wiki_links, vec!["Missing"]);
        assert!(!destination.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_database_graphs_and_cross_platform_path_collisions() {
        let root = temp_directory();
        let database = root.join("database");
        fs::create_dir_all(&database).unwrap();
        fs::write(database.join("db.sqlite"), b"database").unwrap();
        let error = import_logseq_graph(
            &database,
            &root.join("database-output"),
            LogseqImportOptions::default(),
        )
        .unwrap_err();
        assert!(error.contains("DB graph"));

        let collision = root.join("collision");
        fs::create_dir_all(collision.join("pages")).unwrap();
        fs::create_dir_all(collision.join("pages/Alpha")).unwrap();
        fs::write(collision.join("pages/Alpha___Beta.md"), "- one").unwrap();
        fs::write(collision.join("pages/Alpha/Beta.md"), "- two").unwrap();
        let error = import_logseq_graph(
            &collision,
            &root.join("collision-output"),
            LogseqImportOptions::default(),
        )
        .unwrap_err();
        assert!(error.contains("same cross-platform path"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_custom_content_directories_and_sanitizes_windows_names() {
        let root = temp_directory();
        let source = root.join("source");
        fs::create_dir_all(source.join("logseq")).unwrap();
        fs::create_dir_all(source.join("notes")).unwrap();
        fs::create_dir_all(source.join("daily")).unwrap();
        fs::write(
            source.join("logseq/config.edn"),
            ";; :pages-directory \"ignored\"\n{:pages-directory \"notes\" :journals-directory \"daily\"}",
        )
        .unwrap();
        fs::write(source.join("notes/CON.md"), "- note").unwrap();
        fs::write(source.join("daily/2024-02-29.md"), "- leap").unwrap();

        let report = import_logseq_graph(
            &source,
            &root.join("output"),
            LogseqImportOptions { dry_run: true },
        )
        .unwrap();

        assert_eq!(report.pages_converted, 1);
        assert_eq!(report.journals_converted, 1);
        assert!(report
            .mappings
            .iter()
            .any(|mapping| mapping.destination == "_CON.md"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rewrites_only_markdown_link_asset_targets() {
        let source = "text ../assets/no.png\n![x](../../assets/a b.png \"title\")\n[x](<../assets/b.pdf>)\n`[x](../assets/code.png)`";
        let (rewritten, count) = rewrite_asset_links(source);
        assert_eq!(count, 2);
        assert_eq!(
            rewritten,
            "text ../assets/no.png\n![x](media/a b.png \"title\")\n[x](<media/b.pdf>)\n`[x](../assets/code.png)`"
        );
    }

    #[test]
    fn rejects_page_names_that_decode_to_parent_paths() {
        let root = temp_directory();
        let source = root.join("source");
        fs::create_dir_all(source.join("pages")).unwrap();
        fs::write(source.join("pages/%2E%2E%2FEscape.md"), "- unsafe").unwrap();

        let error = import_logseq_graph(
            &source,
            &root.join("output"),
            LogseqImportOptions { dry_run: true },
        )
        .unwrap_err();

        assert!(error.contains("unsafe namespace"));
        assert!(!root.join("output").exists());
        fs::remove_dir_all(root).unwrap();
    }

    fn temp_directory() -> PathBuf {
        let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "logtext-logseq-import-{}-{nanos}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
