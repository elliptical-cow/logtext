# Backlog

## Recently implemented

- [x] Render inline and block LaTeX formulas in the CodeMirror live preview.
  Inactive formulas use reusable KaTeX widgets, while the active inline line or
  complete block source remains directly editable. Fenced code, invalid LaTeX,
  multiple selections, and large-page widget reuse retain predictable behavior.
  Editor widgets use HTML-only KaTeX output with accessible source labels so an
  embedded webview cannot misplace an additional MathML paint layer, and reset
  inherited list indentation to keep nested inline formulas correctly anchored.
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
