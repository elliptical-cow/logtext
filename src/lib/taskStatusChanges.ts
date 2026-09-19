import { blockAttributeMatch, STATUS_CHANGED_AT_ATTRIBUTE } from "./blockAttributes.js";
import { parseListItemPrefix } from "./markdownPatterns.js";
import { taskKeywordMatch } from "./taskKeywords.js";
import type { TextChange } from "./textChanges.js";

export type TaskStatusContentChange = {
  changed: boolean;
  content: string;
  changes: TextChange[];
};

type ContentLine = {
  from: number;
  to: number;
  fullTo: number;
  text: string;
  eol: string;
};

export function statusChangedAtTimestamp(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function changeTaskStatusInContent(
  content: string,
  lineNumber: number,
  currentStatus: string,
  nextStatus: string,
  taskStates: string[],
  changedAt: string,
): TaskStatusContentChange {
  if (lineNumber <= 0 || currentStatus === nextStatus) {
    return { changed: false, content, changes: [] };
  }

  const lines = contentLines(content);
  const line = lines[lineNumber - 1];
  if (!line) {
    return { changed: false, content, changes: [] };
  }

  const status = taskKeywordMatch(line.text, line.from, taskStates);
  if (!status || status.status !== currentStatus) {
    return { changed: false, content, changes: [] };
  }

  const changes: TextChange[] = [
    { from: status.from, to: status.to, insert: nextStatus },
  ];
  const attributeLine = directChildAttributeLine(
    lines,
    lineNumber - 1,
    STATUS_CHANGED_AT_ATTRIBUTE,
  );

  if (attributeLine) {
    const attribute = blockAttributeMatch(attributeLine.text, attributeLine.from)!;
    changes.push({
      from: attribute.from,
      to: attribute.to,
      insert: `${STATUS_CHANGED_AT_ATTRIBUTE}:: ${changedAt}`,
    });
  } else {
    const indentation = childIndentation(lines, lineNumber - 1);
    const attribute = `${indentation}- ${STATUS_CHANGED_AT_ATTRIBUTE}:: ${changedAt}`;
    const fallbackEol = content.includes("\r\n") ? "\r\n" : "\n";
    if (line.eol) {
      changes.push({ from: line.fullTo, to: line.fullTo, insert: `${attribute}${line.eol}` });
    } else {
      changes.push({ from: line.to, to: line.to, insert: `${fallbackEol}${attribute}` });
    }
  }

  const updated = applyTextChanges(content, changes);
  return { changed: true, content: updated, changes };
}

function directChildAttributeLine(
  lines: ContentLine[],
  parentIndex: number,
  attributeName: string,
) {
  const parentIndent = indentationWidth(lines[parentIndex].text);
  const candidates: Array<{ line: ContentLine; indent: number }> = [];

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.text.trim()) {
      continue;
    }

    const indent = indentationWidth(line.text);
    if (indent <= parentIndent) {
      break;
    }
    if (parseListItemPrefix(line.text)) {
      candidates.push({ line, indent });
    }
  }

  const directIndent = Math.min(...candidates.map(({ indent }) => indent));
  return candidates.find(({ line, indent }) => {
    if (indent !== directIndent) {
      return false;
    }
    return blockAttributeMatch(line.text)?.name.toLowerCase() === attributeName.toLowerCase();
  })?.line;
}

function childIndentation(lines: ContentLine[], parentIndex: number) {
  const parent = lines[parentIndex].text;
  const parentPrefix = parseListItemPrefix(parent);
  const parentIndent = indentationWidth(parent);

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (!line.trim()) {
      continue;
    }
    const indent = indentationWidth(line);
    if (indent <= parentIndent) {
      break;
    }
    if (parseListItemPrefix(line)) {
      return line.slice(0, leadingWhitespaceLength(line));
    }
  }

  if (!parentPrefix) {
    return `${parent.slice(0, leadingWhitespaceLength(parent))}  `;
  }

  return `${parentPrefix.indentation}${" ".repeat(
    parentPrefix.listContentFrom - parentPrefix.indentation.length,
  )}`;
}

function indentationWidth(line: string) {
  return line
    .slice(0, leadingWhitespaceLength(line))
    .split("")
    .reduce((width, character) => width + (character === "\t" ? 4 : 1), 0);
}

function leadingWhitespaceLength(line: string) {
  return /^[ \t]*/.exec(line)?.[0].length ?? 0;
}

function applyTextChanges(content: string, changes: TextChange[]) {
  return [...changes]
    .sort((left, right) => right.from - left.from)
    .reduce(
      (updated, change) =>
        `${updated.slice(0, change.from)}${change.insert}${updated.slice(change.to)}`,
      content,
    );
}

function contentLines(content: string): ContentLine[] {
  const lines: ContentLine[] = [];
  let from = 0;

  while (from <= content.length) {
    const newline = content.indexOf("\n", from);
    if (newline === -1) {
      lines.push({ from, to: content.length, fullTo: content.length, text: content.slice(from), eol: "" });
      break;
    }

    const hasCarriageReturn = newline > from && content[newline - 1] === "\r";
    const to = hasCarriageReturn ? newline - 1 : newline;
    const fullTo = newline + 1;
    lines.push({
      from,
      to,
      fullTo,
      text: content.slice(from, to),
      eol: hasCarriageReturn ? "\r\n" : "\n",
    });
    from = fullTo;
  }

  return lines;
}
