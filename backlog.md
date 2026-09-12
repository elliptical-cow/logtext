# Backlog

## Recently implemented

- [x] Render fenced Mermaid diagrams in the right pane, continuous journal feed,
  and right-pane linked references. Rendering is secure, theme-aware, lazy-loaded,
  bounded, compatible with older WebKit desktop views, and protected against
  stale asynchronous results; invalid diagrams retain their escaped source while
  the middle editor remains unchanged.
- [x] Publish an additional `linux-x86_64-thin.tar.gz` release asset containing
  the native stripped Logtext executable, runtime guidance, and license. The
  package reuses the Ubuntu 22.04 Linux build and expects system-provided
  WebKitGTK 4.1, GTK 3, and related runtime libraries; `.deb` and AppImage remain
  available as integrated and portable alternatives.
- [x] Compose the editor context menu from cut, copy, paste, select-all, and
  applicable selection, wiki-link, task, and list-block actions. Single-character
  selections, cursor placement, clipboard text and image paste, keyboard opening,
  and focus restoration now follow normal editor expectations while reusing the
  existing CodeMirror and task mutation paths. Task menus stay focused on Status,
  Priority, and source-line navigation; selected right-pane text can also be copied.
  Link menus offer both link following and source-line navigation to the opposite
  pane. Exact keyboard equivalents appear as subtle Windows-style shortcut hints.
- [x] Render inline and block LaTeX formulas in the CodeMirror live preview.
  Inactive formulas use reusable KaTeX widgets, while the active inline line or
  complete block source remains directly editable. Fenced code, invalid LaTeX,
  multiple selections, and large-page widget reuse retain predictable behavior.
  Inline widgets reset inherited list indentation, use compact font-relative
  spacing, and follow the surrounding text's natural baseline.
- [x] Paste supported clipboard images into the editor, store them in a
  configurable workspace media folder, render standard local Markdown images
  in live preview and rendered views, and use stable `media-folder/file` targets
  relative to the workspace root so paths remain valid across pages and moves.
  Editor controls can resize their persisted display width without changing the
  aspect ratio or exceeding the pane width, and a context-menu action copies
  workspace images to the system clipboard. File > Clean Media lists
  unreferenced supported images in a scrollable confirmation dialog and moves
  confirmed candidates to the operating system trash after a fresh safety
  check, without a permanent-delete fallback.
