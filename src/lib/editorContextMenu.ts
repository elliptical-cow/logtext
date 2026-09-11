export type EditorContextMenuKind = "link" | "selection" | "task" | "text";

type SelectionRange = {
  from: number;
  to: number;
};

export function editorContextMenuKind(
  position: number,
  selection: SelectionRange,
  hasLink: boolean,
  hasTask: boolean,
): EditorContextMenuKind {
  if (hasLink) {
    return "link";
  }

  if (editorContextMenuSelection(position, selection)) {
    return "selection";
  }

  return hasTask ? "task" : "text";
}

export function editorContextMenuSelection(
  position: number,
  selection: SelectionRange,
): SelectionRange | null {
  return selection.to > selection.from && position >= selection.from && position < selection.to
    ? { from: selection.from, to: selection.to }
    : null;
}
