import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import {
  DEFAULT_TASK_STATES,
  priorityCookieMatch,
  taskKeywordMatch,
} from "./taskKeywords.js";
import { taskColorStyle } from "./taskColors.js";
import { wikiLinkColorStyle } from "./folderColors.js";
import { parseCheckboxListItem } from "./markdownPatterns.js";
import { wikiLinkDisplayLabel, wikiLinksInText } from "./wikiLinks.js";
import { isWorkspaceImageTarget, workspaceImageUrl } from "./mediaPaths.js";
import {
  imageTitleWithLogtextWidth,
  logtextImageWidth,
  nextImageWidth,
  type ImageResizeDirection,
} from "./imageSizing.js";
import type { FolderColors, PageSummary, TaskStateColors } from "./types.js";

export type EditorMode = "source" | "live-preview";

export type WikiLinkAtPosition = {
  from: number;
  to: number;
  target: string;
  label: string;
};

export type TaskKeywordAtPosition = {
  from: number;
  to: number;
  status: string;
};

type PreviewDecoration = {
  from: number;
  to: number;
  decoration: Decoration;
};

export type LatexSourceSpan = {
  start: number;
  end: number;
};

export type MarkdownImageMatch = {
  from: number;
  to: number;
  alt: string;
  target: string;
  title: string | null;
  titleFrom: number | null;
  titleTo: number | null;
};

type CheckboxAtPosition = {
  from: number;
  to: number;
  checked: boolean;
};

const hiddenMarkdown = Decoration.replace({});
const strongText = Decoration.mark({ class: "cm-live-strong" });
const emphasisText = Decoration.mark({ class: "cm-live-emphasis" });
const taskPriority = Decoration.mark({ class: "cm-live-priority" });
const latexSource = Decoration.mark({ class: "cm-live-latex-source" });
const latexBlockLine = Decoration.line({ class: "cm-live-latex-block" });

export function livePreviewExtension(
  taskStates = DEFAULT_TASK_STATES,
  taskStateColors: TaskStateColors = {},
  pages: PageSummary[] = [],
  folderColors: FolderColors = {},
  onImageContextMenu: (event: MouseEvent, image: HTMLImageElement) => void = () => {},
) {
  return [
    livePreviewField(
      taskStates,
      taskStateColors,
      pages,
      folderColors,
      onImageContextMenu,
    ),
    livePreviewTheme,
  ];
}

export function previewDecorationsForLine(
  lineText: string,
  lineFrom = 0,
  taskStates = DEFAULT_TASK_STATES,
  taskStateColors: TaskStateColors = {},
  pages: PageSummary[] = [],
  folderColors: FolderColors = {},
): PreviewDecoration[] {
  const decorations: PreviewDecoration[] = [];

  if (isTableRow(lineText)) {
    return decorations;
  }

  addHeadingDecorations(lineText, lineFrom, decorations);
  addCheckboxDecorations(lineText, lineFrom, decorations);
  addTaskDecorations(lineText, lineFrom, decorations, taskStates, taskStateColors);
  addWikiLinkDecorations(lineText, lineFrom, decorations, pages, folderColors);
  addStrongDecorations(lineText, lineFrom, decorations);
  addEmphasisDecorations(lineText, lineFrom, decorations);

  const latexSpans = inlineLatexSourceSpans(lineText);
  const markdownDecorations = decorations.filter(
    ({ from, to }) =>
      !latexSpans.some(
        ({ start, end }) => from < lineFrom + end && to > lineFrom + start,
      ),
  );
  addLatexSourceDecorations(lineFrom, latexSpans, markdownDecorations);

  return markdownDecorations.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function wikiLinkAtPosition(
  lineText: string,
  lineFrom: number,
  position: number,
): WikiLinkAtPosition | null {
  const linePosition = position - lineFrom;
  if (
    inlineLatexSourceSpans(lineText).some(
      ({ start, end }) => linePosition >= start && linePosition <= end,
    )
  ) {
    return null;
  }

  for (const match of wikiLinksInText(lineText)) {
    if (linePosition < match.from || linePosition > match.to) {
      continue;
    }

    return {
      from: lineFrom + match.from,
      to: lineFrom + match.to,
      target: match.target,
      label: match.syntax === "compact" ? `#${match.target}` : match.alias || match.target,
    };
  }

  return null;
}

export function wikiLinkAtDocumentPosition(state: EditorState, position: number) {
  const lineNumber = state.doc.lineAt(position).number;
  if (
    isPositionInsideFencedCode(state, position) ||
    latexBlockLineNumbers(state.doc.toString()).has(lineNumber)
  ) {
    return null;
  }

  const line = state.doc.lineAt(position);
  return wikiLinkAtPosition(line.text, line.from, position);
}

export function taskKeywordAtDocumentPosition(
  state: EditorState,
  position: number,
  taskStates = DEFAULT_TASK_STATES,
): TaskKeywordAtPosition | null {
  if (isPositionInsideFencedCode(state, position)) {
    return null;
  }

  const line = state.doc.lineAt(position);
  const match = taskKeywordMatch(line.text, line.from, taskStates);
  if (!match) {
    return null;
  }

  if (position >= match.from && position <= match.to) {
    return match;
  }

  const priority = priorityCookieMatch(line.text, line.from, taskStates);
  if (priority && position >= priority.from && position <= priority.to) {
    return match;
  }

  return null;
}

export function checkboxAtDocumentPosition(
  state: EditorState,
  position: number,
): CheckboxAtPosition | null {
  if (isPositionInsideFencedCode(state, position)) {
    return null;
  }

  const line = state.doc.lineAt(position);
  return checkboxAtLinePosition(line.text, line.from, position);
}

function checkboxAtLinePosition(
  lineText: string,
  lineFrom: number,
  position: number,
): CheckboxAtPosition | null {
  const parsed = parseCheckboxListItem(lineText);
  if (!parsed) {
    return null;
  }

  const from = lineFrom + parsed.checkbox.from;
  const to = lineFrom + parsed.checkbox.to;
  if (position < from || position > to) {
    return null;
  }

  return {
    from,
    to,
    checked: parsed.checkbox.checked,
  };
}

function livePreviewField(
  taskStates: string[],
  taskStateColors: TaskStateColors,
  pages: PageSummary[],
  folderColors: FolderColors,
  onImageContextMenu: (event: MouseEvent, image: HTMLImageElement) => void,
) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildLivePreviewDecorations(
        state,
        taskStates,
        taskStateColors,
        pages,
        folderColors,
        onImageContextMenu,
      );
    },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildLivePreviewDecorations(
          transaction.state,
          taskStates,
          taskStateColors,
          pages,
          folderColors,
          onImageContextMenu,
        );
      }

      return decorations.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const livePreviewTheme = EditorView.baseTheme({
  ".cm-live-heading-1": {
    fontSize: "1.45em",
    fontWeight: "700",
    lineHeight: "1.8",
  },
  ".cm-live-heading-2": {
    fontSize: "1.25em",
    fontWeight: "700",
    lineHeight: "1.7",
  },
  ".cm-live-heading-3": {
    fontSize: "1.1em",
    fontWeight: "700",
    lineHeight: "1.65",
  },
  ".cm-live-wiki-link": {
    color: "var(--wiki-link-text)",
    backgroundColor: "var(--wiki-link-bg)",
    borderBottom: "1px solid var(--wiki-link-border)",
    borderRadius: "4px",
    padding: "0 2px",
  },
  ".cm-live-strong": {
    fontWeight: "700",
  },
  ".cm-live-emphasis": {
    fontStyle: "italic",
  },
  ".cm-live-latex-source": {
    borderRadius: "3px",
    backgroundColor: "var(--code-bg)",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
  ".cm-live-latex-block": {
    backgroundColor: "var(--code-bg)",
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
  ".cm-live-checkbox": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    boxSizing: "border-box",
    width: "0.92em",
    height: "0.92em",
    marginRight: "0.35em",
    border: "1px solid var(--editor-checkbox-border)",
    borderRadius: "3px",
    lineHeight: "1",
    verticalAlign: "-0.08em",
  },
  ".cm-live-checkbox-checked": {
    borderColor: "var(--editor-checkbox-checked-text)",
    backgroundColor: "var(--editor-checkbox-checked-bg)",
  },
  ".cm-live-checkbox-check": {
    position: "absolute",
    left: "50%",
    top: "43%",
    width: "0.3em",
    height: "0.52em",
    borderRight: "2px solid var(--editor-checkbox-checked-text)",
    borderBottom: "2px solid var(--editor-checkbox-checked-text)",
    boxSizing: "border-box",
    transform: "translate(-50%, -50%) rotate(45deg)",
    transformOrigin: "center",
  },
  ".cm-live-task": {
    borderRadius: "4px",
    padding: "0 4px",
    fontSize: "0.92em",
    fontWeight: "700",
  },
  ".cm-live-task-todo": {
    color: "var(--editor-task-todo-text)",
    backgroundColor: "var(--editor-task-todo-bg)",
  },
  ".cm-live-task-done": {
    color: "var(--editor-task-done-text)",
    backgroundColor: "var(--editor-task-done-bg)",
  },
  ".cm-live-priority": {
    color: "var(--editor-priority-text)",
    backgroundColor: "var(--editor-priority-bg)",
    borderRadius: "4px",
    padding: "0 4px",
    fontSize: "0.92em",
    fontWeight: "700",
  },
});

function buildLivePreviewDecorations(
  state: EditorState,
  taskStates: string[],
  taskStateColors: TaskStateColors,
  pages: PageSummary[],
  folderColors: FolderColors,
  onImageContextMenu: (event: MouseEvent, image: HTMLImageElement) => void,
) {
  const builder = new RangeSetBuilder<Decoration>();
  const activeLines = activeBlockLineNumbers(state);
  const latexBlockLines = latexBlockLineNumbers(state.doc.toString());
  const imageMatches = markdownImagesInState(state);
  let inFencedCode = false;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const trimmed = line.text.trimStart();
    const startsFence = trimmed.startsWith("```") || trimmed.startsWith("~~~");

    if (latexBlockLines.has(lineNumber)) {
      addLatexBlockLine(builder, line.from, line.to);
      continue;
    }

    if (startsFence) {
      inFencedCode = !inFencedCode;
      continue;
    }

    if (inFencedCode) {
      continue;
    }

    if (activeLines.has(lineNumber)) {
      for (const { from, to, decoration } of latexSourceDecorationsForLine(
        line.text,
        line.from,
      )) {
        builder.add(from, to, decoration);
      }
      continue;
    }

    const latexSpans = inlineLatexSourceSpans(line.text);
    const lineImages = imageMatches.filter((image) => {
      if (image.from < line.from || image.to > line.to) {
        return false;
      }
      return !latexSpans.some(
        ({ start, end }) => image.from < line.from + end && image.to > line.from + start,
      );
    });
    const imageDecorations = lineImages.map((image) => ({
      from: image.from,
      to: image.to,
      decoration: Decoration.replace({
        widget: new MarkdownImageWidget(
          workspaceImageUrl(image.target),
          image.alt,
          logtextImageWidth(image.title),
          image.from,
          isWorkspaceImageTarget(image.target) ? onImageContextMenu : null,
        ),
      }),
    }));
    const lineDecorations = previewDecorationsForLine(
      line.text,
      line.from,
      taskStates,
      taskStateColors,
      pages,
      folderColors,
    ).filter(
      (decoration) =>
        !lineImages.some((image) => decoration.from < image.to && decoration.to > image.from),
    );
    for (const { from, to, decoration } of [...imageDecorations, ...lineDecorations].sort(
      (left, right) => left.from - right.from || left.to - right.to,
    )) {
      builder.add(from, to, decoration);
    }
  }

  return builder.finish();
}

export function markdownImagesInState(state: EditorState): MarkdownImageMatch[] {
  const matches: MarkdownImageMatch[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Image") {
        return;
      }
      const imageNode = node.node;
      const urlNode = imageNode.getChild("URL");
      if (!urlNode) {
        return;
      }
      const prefix = state.sliceDoc(imageNode.from, urlNode.from);
      const altEnd = prefix.lastIndexOf("](");
      const titleNode = imageNode.getChild("LinkTitle");
      matches.push({
        from: imageNode.from,
        to: imageNode.to,
        alt: altEnd >= 2 ? prefix.slice(2, altEnd) : "",
        target: state.sliceDoc(urlNode.from, urlNode.to),
        title: titleNode ? markdownLinkTitle(state.sliceDoc(titleNode.from, titleNode.to)) : null,
        titleFrom: titleNode?.from ?? null,
        titleTo: titleNode?.to ?? null,
      });
    },
  });
  return matches;
}

export function latexBlockLineNumbers(source: string) {
  const blockLines = new Set<number>();
  const lines = source.split(/\r?\n/);
  let inFencedCode = false;
  let inLatexBlock = false;

  for (const [index, lineText] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = lineText.trimStart();

    if (inLatexBlock) {
      blockLines.add(lineNumber);
      if (trimmed.trimEnd().endsWith("$$")) {
        inLatexBlock = false;
      }
      continue;
    }

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFencedCode = !inFencedCode;
      continue;
    }

    if (inFencedCode || !trimmed.startsWith("$$")) {
      continue;
    }

    blockLines.add(lineNumber);
    inLatexBlock = !trimmed.slice(2).trimEnd().endsWith("$$");
  }

  return blockLines;
}

function addLatexBlockLine(
  builder: RangeSetBuilder<Decoration>,
  lineFrom: number,
  lineTo: number,
) {
  builder.add(lineFrom, lineFrom, latexBlockLine);
  if (lineTo > lineFrom) {
    builder.add(lineFrom, lineTo, latexSource);
  }
}

function latexSourceDecorationsForLine(lineText: string, lineFrom: number) {
  const decorations: PreviewDecoration[] = [];
  addLatexSourceDecorations(lineFrom, inlineLatexSourceSpans(lineText), decorations);
  return decorations;
}

function addLatexSourceDecorations(
  lineFrom: number,
  spans: LatexSourceSpan[],
  decorations: PreviewDecoration[],
) {
  for (const { start, end } of spans) {
    decorations.push({
      from: lineFrom + start,
      to: lineFrom + end,
      decoration: latexSource,
    });
  }
}

export function inlineLatexSourceSpans(lineText: string): LatexSourceSpan[] {
  const spans: LatexSourceSpan[] = [];

  for (let start = 0; start < lineText.length; start += 1) {
    if (
      lineText[start] !== "$" ||
      lineText[start - 1] === "$" ||
      lineText[start + 1] === "$" ||
      isEscaped(lineText, start) ||
      isInsideInlineCode(lineText, start) ||
      isWhitespace(lineText[start + 1])
    ) {
      continue;
    }

    for (let end = start + 1; end < lineText.length; end += 1) {
      if (
        lineText[end] !== "$" ||
        lineText[end - 1] === "$" ||
        lineText[end + 1] === "$" ||
        isEscaped(lineText, end)
      ) {
        continue;
      }

      if (!isWhitespace(lineText[end - 1]) && !/[0-9]/.test(lineText[end + 1] ?? "")) {
        spans.push({ start, end: end + 1 });
        start = end;
      }
      break;
    }
  }

  return spans;
}

function isInsideInlineCode(lineText: string, position: number) {
  let openLength: number | null = null;

  for (let index = 0; index < position; ) {
    if (lineText[index] !== "`" || isEscaped(lineText, index)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (lineText[end] === "`") {
      end += 1;
    }
    const runLength = end - index;
    openLength = openLength === runLength ? null : openLength ?? runLength;
    index = end;
  }

  return openLength !== null;
}

function isEscaped(value: string, position: number) {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function activeBlockLineNumbers(state: EditorState) {
  const lines = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let line = startLine; line <= endLine; line += 1) {
      lines.add(line);
    }
  }

  return new Set([...lines].sort((left, right) => left - right));
}

function isPositionInsideFencedCode(state: EditorState, position: number) {
  const currentLine = state.doc.lineAt(position).number;
  let inFencedCode = false;

  for (let lineNumber = 1; lineNumber <= currentLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const trimmed = line.text.trimStart();
    const startsFence = trimmed.startsWith("```") || trimmed.startsWith("~~~");

    if (!startsFence) {
      continue;
    }

    if (lineNumber === currentLine) {
      return false;
    }

    inFencedCode = !inFencedCode;
  }

  return inFencedCode;
}

function isTableRow(lineText: string) {
  const trimmed = lineText.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|", 1);
}

function addHeadingDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
) {
  const match = /^(#{1,3})\s+/.exec(lineText);
  if (!match) {
    return;
  }

  decorations.push({
    from: lineFrom,
    to: lineFrom,
    decoration: Decoration.line({ class: `cm-live-heading-${match[1].length}` }),
  });
  decorations.push({
    from: lineFrom,
    to: lineFrom + match[0].length,
    decoration: hiddenMarkdown,
  });
}

function addTaskDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
  taskStates: string[],
  taskStateColors: TaskStateColors,
) {
  const match = taskKeywordMatch(lineText, lineFrom, taskStates);
  if (!match) {
    return;
  }

  decorations.push({
    from: match.from,
    to: match.to,
    decoration: Decoration.mark({
      class: `cm-live-task cm-live-task-${safeTaskClass(match.status)}`,
      attributes: { style: taskColorStyle(match.status, taskStateColors) },
    }),
  });

  const priority = priorityCookieMatch(lineText, lineFrom, taskStates);
  if (priority) {
    decorations.push({
      from: priority.from,
      to: priority.to,
      decoration: taskPriority,
    });
  }
}

function safeTaskClass(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function addCheckboxDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
) {
  const parsed = parseCheckboxListItem(lineText);
  if (!parsed) {
    return;
  }

  const markerStart = parsed.checkbox.from;
  const markerEnd = parsed.checkbox.to;
  const checked = parsed.checkbox.checked;

  decorations.push({
    from: lineFrom + markerStart,
    to: lineFrom + markerEnd,
    decoration: Decoration.replace({ widget: new CheckboxWidget(checked) }),
  });
}

function addWikiLinkDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
  pages: PageSummary[],
  folderColors: FolderColors,
) {
  for (const match of wikiLinksInText(lineText)) {
    const { alias, from: start, raw: full, target } = match;
    const decoration = Decoration.mark({
      class: "cm-live-wiki-link",
      attributes: { style: wikiLinkColorStyle(target, pages, folderColors) },
    });

    if (match.syntax === "compact") {
      const label = `#${wikiLinkDisplayLabel(target, pages)}`;
      decorations.push({
        from: lineFrom + start,
        to: lineFrom + match.to,
        decoration:
          label === full
            ? decoration
            : Decoration.replace({
                widget: new WikiLinkLabelWidget(
                  label,
                  wikiLinkColorStyle(target, pages, folderColors),
                ),
              }),
      });
      continue;
    }

    if (alias) {
      const aliasSeparator = full.indexOf("|", 2);
      const aliasStart = start + aliasSeparator + 1;
      const aliasEnd = start + full.length - 2;
      decorations.push({
        from: lineFrom + start,
        to: lineFrom + aliasStart,
        decoration: hiddenMarkdown,
      });
      decorations.push({
        from: lineFrom + aliasStart,
        to: lineFrom + aliasEnd,
        decoration,
      });
      decorations.push({
        from: lineFrom + start + full.length - 2,
        to: lineFrom + start + full.length,
        decoration: hiddenMarkdown,
      });
    } else {
      const targetStart = start + 2;
      const targetEnd = start + full.length - 2;
      const rawTarget = full.slice(2, -2);
      const label = wikiLinkDisplayLabel(target, pages);
      decorations.push({
        from: lineFrom + start,
        to: lineFrom + targetStart,
        decoration: hiddenMarkdown,
      });
      decorations.push({
        from: lineFrom + targetStart,
        to: lineFrom + targetEnd,
        decoration:
          label === rawTarget
            ? decoration
            : Decoration.replace({
                widget: new WikiLinkLabelWidget(label, wikiLinkColorStyle(target, pages, folderColors)),
              }),
      });
      decorations.push({
        from: lineFrom + start + full.length - 2,
        to: lineFrom + start + full.length,
        decoration: hiddenMarkdown,
      });
    }
  }
}

function addStrongDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
) {
  const matcher = /\*\*([^*\n]+)\*\*/g;

  for (const match of lineText.matchAll(matcher)) {
    const start = match.index ?? 0;
    const contentStart = start + 2;
    const contentEnd = contentStart + match[1].length;

    decorations.push({
      from: lineFrom + start,
      to: lineFrom + contentStart,
      decoration: hiddenMarkdown,
    });
    decorations.push({
      from: lineFrom + contentStart,
      to: lineFrom + contentEnd,
      decoration: strongText,
    });
    decorations.push({
      from: lineFrom + contentEnd,
      to: lineFrom + contentEnd + 2,
      decoration: hiddenMarkdown,
    });
  }
}

function addEmphasisDecorations(
  lineText: string,
  lineFrom: number,
  decorations: PreviewDecoration[],
) {
  for (const match of emphasisSpans(lineText)) {
    const contentStart = match.start + 1;
    const contentEnd = match.end;

    decorations.push({
      from: lineFrom + match.start,
      to: lineFrom + contentStart,
      decoration: hiddenMarkdown,
    });
    decorations.push({
      from: lineFrom + contentStart,
      to: lineFrom + contentEnd,
      decoration: emphasisText,
    });
    decorations.push({
      from: lineFrom + contentEnd,
      to: lineFrom + contentEnd + 1,
      decoration: hiddenMarkdown,
    });
  }
}

type EmphasisSpan = {
  start: number;
  end: number;
};

export function emphasisSpans(lineText: string): EmphasisSpan[] {
  const spans: EmphasisSpan[] = [];

  for (let start = 0; start < lineText.length; start += 1) {
    const marker = lineText[start];
    if (marker !== "*" && marker !== "_") {
      continue;
    }
    if (!canOpenEmphasis(lineText, start, marker)) {
      continue;
    }

    const end = closingEmphasisIndex(lineText, start + 1, marker);
    if (end === -1) {
      continue;
    }

    spans.push({ start, end });
    start = end;
  }

  return spans;
}

function closingEmphasisIndex(lineText: string, from: number, marker: string) {
  for (let end = from; end < lineText.length; end += 1) {
    if (lineText[end] === marker && canCloseEmphasis(lineText, end, marker)) {
      return end;
    }
  }

  return -1;
}

function canOpenEmphasis(lineText: string, index: number, marker: string) {
  return (
    !isPartOfStrongDelimiter(lineText, index, marker) &&
    !isWhitespace(lineText[index + 1]) &&
    lineText[index + 1] !== marker
  );
}

function canCloseEmphasis(lineText: string, index: number, marker: string) {
  return (
    !isPartOfStrongDelimiter(lineText, index, marker) &&
    !isWhitespace(lineText[index - 1]) &&
    lineText[index - 1] !== marker
  );
}

function isPartOfStrongDelimiter(lineText: string, index: number, marker: string) {
  return lineText[index - 1] === marker || lineText[index + 1] === marker;
}

function isWhitespace(char: string | undefined) {
  return char === undefined || /\s/.test(char);
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  toDOM() {
    const checkbox = document.createElement("span");
    checkbox.className = this.checked
      ? "cm-live-checkbox cm-live-checkbox-checked"
      : "cm-live-checkbox";
    checkbox.setAttribute("aria-hidden", "true");
    if (this.checked) {
      checkbox.appendChild(liveCheckboxCheckElement());
    }
    return checkbox;
  }
}

export function liveCheckboxCheckElement() {
  const check = document.createElement("span");
  check.className = liveCheckboxCheckClass();
  return check;
}

export function liveCheckboxCheckClass() {
  return "cm-live-checkbox-check";
}

class WikiLinkLabelWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly style: string,
  ) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-wiki-link";
    span.setAttribute("style", this.style);
    span.textContent = this.label;
    return span;
  }
}

class MarkdownImageWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
    private readonly configuredWidth: number | null,
    private readonly imageFrom: number,
    private readonly onContextMenu: ((event: MouseEvent, image: HTMLImageElement) => void) | null,
  ) {
    super();
  }

  eq(other: MarkdownImageWidget) {
    return (
      this.source === other.source &&
      this.alt === other.alt &&
      this.configuredWidth === other.configuredWidth &&
      this.imageFrom === other.imageFrom &&
      this.onContextMenu === other.onContextMenu
    );
  }

  ignoreEvent(event: Event) {
    return event.target instanceof HTMLButtonElement;
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    container.className = "cm-live-image-widget";
    container.setAttribute("contenteditable", "false");
    const image = document.createElement("img");
    image.className = "cm-live-image";
    if (this.onContextMenu) {
      image.crossOrigin = "anonymous";
    }
    image.src = this.source;
    image.alt = this.alt;
    image.loading = "lazy";
    if (this.onContextMenu) {
      image.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onContextMenu?.(event, image);
      });
    }
    if (this.configuredWidth !== null) {
      image.style.width = `${this.configuredWidth}px`;
    }
    container.append(image);

    const controls = document.createElement("span");
    controls.className = "cm-live-image-controls";
    controls.setAttribute("aria-label", "Image size");
    controls.append(
      this.resizeButton(view, image, "smaller", "−", "Make image smaller"),
      this.resizeButton(view, image, "larger", "+", "Make image larger"),
    );
    container.append(controls);
    return container;
  }

  private resizeButton(
    view: EditorView,
    image: HTMLImageElement,
    direction: ImageResizeDirection,
    label: string,
    title: string,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-live-image-resize";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const renderedWidth = image.getBoundingClientRect().width || image.naturalWidth;
      const width = nextImageWidth(this.configuredWidth, renderedWidth, direction);
      resizeMarkdownImage(view, this.imageFrom, width);
    });
    return button;
  }
}

function resizeMarkdownImage(view: EditorView, imageFrom: number, width: number) {
  const image = markdownImagesInState(view.state).find((candidate) => candidate.from === imageFrom);
  if (!image) {
    return;
  }
  const title = `"${escapeMarkdownLinkTitle(imageTitleWithLogtextWidth(image.title, width))}"`;
  const changes =
    image.titleFrom !== null && image.titleTo !== null
      ? { from: image.titleFrom, to: image.titleTo, insert: title }
      : { from: image.to - 1, to: image.to - 1, insert: ` ${title}` };
  view.dispatch({ changes, userEvent: "input" });
}

function markdownLinkTitle(source: string) {
  if (source.length < 2) {
    return source;
  }
  return source.slice(1, -1).replace(/\\([\\"'])/g, "$1");
}

function escapeMarkdownLinkTitle(title: string) {
  return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
