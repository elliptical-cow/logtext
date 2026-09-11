# Changelog

This file records notable user-facing and development changes to Logtext. The
current source version is `0.7.1`.

## Unreleased

### Added

- Added clipboard image paste for PNG, JPEG, WebP, and GIF files. Logtext stores
  validated images in a configurable workspace media folder, inserts
  workspace-root-relative Markdown targets, and renders workspace images in the
  editor live preview and all rendered views. Live-preview controls resize
  images without changing their aspect ratio, persist the chosen width in
  Markdown, and retain the existing page-width limit. A shared image context
  menu copies workspace images from the editor or rendered views to the system
  clipboard. A File-menu cleanup action lists unreferenced images and, after a
  final reference check, moves confirmed files to the operating system trash
  without falling back to permanent deletion.
- Added KaTeX rendering for inline (`$...$`) and block (`$$...$$`) LaTeX
  formulas in rendered Markdown views and the editor live preview. The editor
  restores an inline formula's source line or a complete block formula when it
  becomes active, keeping the Markdown directly editable.
- Added Page Up and Page Down navigation across journal file boundaries in the
  editor, using the same configured order as mouse-wheel navigation.
- Added independent `journalEditorContinuousScrolling` and
  `journalRightPaneContinuousScrolling` workspace settings. Both default to
  enabled for compatibility with existing workspaces.

### Changed

- Expanded the editor context menu with cut, copy, paste, select-all,
  selection-to-page-link, task, and list-block actions. Context menus now preserve
  clicked selections, position the cursor for paste, accept single-character
  selections, support keyboard opening, and restore editor focus. Undo and redo
  remain in the Edit menu and on keyboard shortcuts. Task menus contain only
  Status, Priority, and source-line navigation. Selected rendered text can also be
  copied from right-pane context menus. Matching keyboard commands are shown as
  subtle Windows-style shortcut hints.
- All local image targets now use stable `media-folder/file` paths relative to
  the workspace root, so they remain valid when copied between pages. The
  configured media folder is excluded from page indexing and protected from
  page and folder operations in the navigation tree.
- Compact `#` link completion now offers every page and automatically switches
  to `[[target]]` syntax when the selected target contains spaces.
- Round-delimited text such as `((target))` is no longer interpreted as a page
  link; `[[target]]` and compact `#target` remain the supported link syntaxes.
- Release assets now use consistent names that explicitly identify Logtext's
  version, target operating system, architecture, and Windows package variant.

### Fixed

- Inline LaTeX formulas no longer overlap preceding editor text. Live-preview
  widgets reset inherited list indentation so nested formulas remain anchored
  after their preceding text. Symmetric font-relative margins tighten the
  optical spacing between inline math and adjacent editor text.
  Inline math uses its natural baseline with surrounding editor text, while
  tall operators, limits, fractions, or roots are no longer vertically clipped.

## 0.7.1

Changes since `v0.6.7`.

### Added

- Added compact `#page` links as a whitespace-free alternative to `[[page]]`,
  including completion, rendering, navigation, backlinks, search, and link
  rewriting during page or folder moves and renames.
- Added the public repository foundation: contributor and security guidance, a
  pull-request template, reproducible CI and release workflows, architecture
  notes, performance baselines, branding assets, and a ready-to-open example
  workspace.
- Added version consistency tests for the package, Cargo, and Tauri metadata.
- Added continuous journal browsing: the editor changes date files at its
  scroll boundaries, while the right pane displays several date files as one
  progressively loaded feed. Both follow the folder's ascending or descending
  page order and require no focus clicks between transitions.

### Changed

- Renamed the product consistently to Logtext across the UI, source code,
  package metadata, documentation, repository links, application identifiers,
  internal event and storage names, and the user configuration path
  (`~/.logtext`).
- Updated the Logtext wordmark and rebuilt the desktop icon set with a
  transparent background and a larger paper mark for improved visibility.
- Branch and pull-request CI now runs frontend and Rust verification, while
  branch pushes additionally produce cross-platform artifacts independently
  from the tag-only GitHub Release workflow.
- Right-pane list markers, task checkboxes, and hierarchy guides now share a
  scalable marker axis instead of relying on platform-specific native list
  marker positioning.
- Refreshed the performance baseline with current release-build measurements
  for sparse, realistic, stress, and single-large-page workspaces.
- Made the journal folder configurable through `journalFolder` in the workspace
  `.config`; the default remains `journal`.

### Fixed

- Rendered level-one through level-three Markdown headings in the right pane
  now scale with the application font size.
- App-managed page creation, moving, and renaming now reject non-date filenames
  directly inside the configured journal folder.
- App-managed folder and page operations now prevent subfolders below the
  configured journal folder.
- Saved editor changes now refresh the matching loaded journal entry in the
  continuous right-pane feed, including entries other than its anchor page.
- Right-pane navigation now keeps the loaded path and rendered page consistent
  while another page is loading, so reopening a journal reliably rebuilds its
  continuous feed.

## 0.6.7

Changes since `v0.6.5`.

### Changed

- Aligned the application icon across macOS, Windows, PNG assets, and local
  Tauri development builds.
- Workspace scanning now ignores symbolic links and Windows reparse points,
  preserves folders that differ only by case, and sorts them deterministically.
- Full reindexing now reads each Markdown file once while building page,
  backlink, and disposable content indexes. Search and Task Overview use the
  same snapshot, while debounced external changes update affected index entries
  incrementally with a full-reindex recovery path.
- Frontend error handling now uses one conversion path for JavaScript, Tauri,
  and structured application errors. Direct native and infrastructure actions
  use a shared popup path without duplicating store-owned errors.
- Rust and TypeScript Markdown parsers now share fixtures for links, normalized
  targets, task priorities, custom task states, list markers, tabs, checkboxes,
  CRLF, mixed indentation, conflicting priority cookies, nested emphasis, and
  deeply nested blocks.
- File moves and renames validate readable content before changing its physical
  path and support capitalization-only filename changes.
- Frontend Markdown consumers now share one parser for list and checkbox
  prefixes across editing, rendering, wrapping, tasks, and undo validation.
- Native theme, Task Overview, live preview, and plain Markdown menu actions now
  describe their destination state. Block collapse uses layout-independent
  `Cmd/Ctrl+1` through `Cmd/Ctrl+4` shortcuts, including on Windows.
- The editor context menu now limits actions to the clicked link, selected text,
  task, or source line, with nested status and priority menus for tasks.
- Task Overview now toggles back to the editor when already open. Favorites and
  Recents use the same right-pane action emphasis as the file browser.
- Checkbox, task-status, and task-priority changes from rendered views and Task
  Overview now use one shared mutation policy for editor routing, saving, undo,
  refresh, and completion sound.
- Wiki-link navigation and missing-page creation now share one operation layer
  across the editor, rendered panes, backlinks, and Task Overview. Both panes
  also share back/forward history while retaining their own loading, editor
  safeguards, destination routing, and line targeting.
- A reproducible release-profile benchmark now measures full reindexing,
  workspace search, Task Overview loading, incremental reindexing, and one-file
  save recovery with generated workspace profiles.

### Fixed

- Right-pane content refreshes no longer replay an existing source-line
  highlight or scroll the highlighted line back into view.
- Rendered checkbox and task changes now respect active saves and editor
  conflicts, preserve unsaved editor text, refresh all affected views, and enter
  global undo history only after a successful editor-backed save.
- Native workspace dialogs, workspace closing, undo/redo warnings, event setup,
  and window-title failures no longer disappear as unhandled promise
  rejections.
- Failed right-pane navigation now keeps the previously rendered page and no
  longer consumes a back/forward history entry.
- Mixed editor, rendered-view, and cross-file actions now keep global history
  aligned with CodeMirror undo groups. External task changes apply localized
  edits that preserve earlier undo and redo entries.
- Watcher updates from a previously closed workspace no longer mutate the
  currently open workspace, and failed incremental updates no longer emit a
  successful index event.

### Tests

- Added regression coverage for mutation ordering, undo grouping, cross-file
  history, save conflicts, completion sound gating, minimal text changes, and
  rejected backend operations.
- Added coverage for link normalization and navigation, pane routing,
  missing-page creation, popup ownership, benchmarked saves, snapshot fallback,
  scanner exclusions, watcher batches, and incremental/full index equivalence.

## 0.6.5

Changes since `v0.6.0`.

### Added

- Added a context-menu Format submenu for selected single-line editor text.
- Added an example workspace under `docs/example_workspace`.

### Changed

- Combined editor block, link, and task actions into one context menu.
- Made the `Save`, `Open Right`, and `Open Editor` buttons compact and visually
  consistent across both themes.
- Updated the README with the example workspace and a simpler introduction.

## 0.6.0

Changes since `v0.5.0`.

### Added

- Added opening global search results in the right pane.
- Added favorite reordering from the navigation context menu.
- Added source-line navigation between the editor and right pane.
- Added editor block folding, including block collapse and expand actions.
- Added dark mode with workspace-specific persistence.

### Changed

- Moved the workspace path from the left pane into the window title.
- Added a `JOURNAL` heading to the left navigation.
- Hid quick-access row actions until hover in favorites and recent files.
- Aligned the `Open Right` and `Open Editor` pane transfer button styles.
- Tokenized core UI, live preview, folder colors, and task colors for
  theme-aware rendering.

### Fixed

- Fixed ordered-list renumbering after inserting new list items.
- Fixed rendered Markdown checkbox alignment and checkmark styling.

## 0.5.0

Changes since `v0.4.0`.

### Added

- Added substring matching for wiki-link autocomplete.
- Increased wiki-link autocomplete suggestions and made the suggestion list
  scrollable.
- Added application popup error dialogs for user-facing errors.
- Added confirmation dialog behavior for folder deletion.
- Added developer notes under `docs/dev-notes.md` with architecture and test
  concept.

### Changed

- Live preview now switches only the active editor line into source mode instead
  of rendering following blocks as source as well.
- Page filter results now show matching pages before matching blocks.
- Page toolbar actions were moved into the workspace root context menu.
- Task overview metadata now renders inline with the task text, matching the
  rendered document style more closely.
- Architecture notes, backlog, and older product/requirements documents were
  moved out of the repository into the project-level documentation area.

### Fixed

- Fixed nested folder color menu state handling.
- Fixed editor wrapping behavior for long lines.
- Fixed folder delete availability in the navigation context menu.
- Fixed nested list continuation so new list blocks are inserted before child
  blocks.
- Folder deletion is now restricted to empty folders to avoid accidental
  recursive data loss.
