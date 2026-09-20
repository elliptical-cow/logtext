import { blockAttributeMatch, STATUS_CHANGED_AT_ATTRIBUTE } from "./blockAttributes.js";
import { parseListItemPrefix } from "./markdownPatterns.js";
import { taskKeywordMatch } from "./taskKeywords.js";
import type { TextChange } from "./textChanges.js";

export type TaskStatusContentChange = {
  changed: boolean;
  content: string;
  changes: TextChange[];
  previousStatusChangedAtSource: string | null;
  statusChangedAtSource: string | null;
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
  return setTaskStatusInContent(
    content,
    lineNumber,
    currentStatus,
    nextStatus,
    taskStates,
    `${STATUS_CHANGED_AT_ATTRIBUTE}:: ${changedAt}`,
  );
}

export function restoreTaskStatusInContent(
  content: string,
  lineNumber: number,
  currentStatus: string,
  nextStatus: string,
  taskStates: string[],
  statusChangedAtSource: string | null,
): TaskStatusContentChange {
  return setTaskStatusInContent(
    content,
    lineNumber,
    currentStatus,
    nextStatus,
    taskStates,
    statusChangedAtSource,
  );
}

export function statusChangedAtSourceInContent(content: string, lineNumber: number) {
  if (lineNumber <= 0) {
    return null;
  }

  const lines = contentLines(content);
  const attributeLine = directChildAttributeLine(
    lines,
    lineNumber - 1,
    STATUS_CHANGED_AT_ATTRIBUTE,
  );
  if (!attributeLine) {
    return null;
  }

  const attribute = blockAttributeMatch(attributeLine.text, attributeLine.from);
  return attribute ? content.slice(attribute.from, attribute.to) : null;
}

function setTaskStatusInContent(
  content: string,
  lineNumber: number,
  currentStatus: string,
  nextStatus: string,
  taskStates: string[],
  statusChangedAtSource: string | null,
): TaskStatusContentChange {
  if (lineNumber <= 0 || currentStatus === nextStatus) {
    return unchangedStatusChange(content, statusChangedAtSource);
  }

  const lines = contentLines(content);
  const line = lines[lineNumber - 1];
  if (!line) {
    return unchangedStatusChange(content, statusChangedAtSource);
  }

  const status = taskKeywordMatch(line.text, line.from, taskStates);
  if (!status || status.status !== currentStatus) {
    return unchangedStatusChange(content, statusChangedAtSource);
  }

  const listPrefix = parseListItemPrefix(line.text);
  const changes: TextChange[] = [
    { from: status.from, to: status.to, insert: `${listPrefix ? "" : "- "}${nextStatus}` },
  ];
  const attributeLine = directChildAttributeLine(
    lines,
    lineNumber - 1,
    STATUS_CHANGED_AT_ATTRIBUTE,
  );
  let previousStatusChangedAtSource: string | null = null;

  if (attributeLine) {
    const attribute = blockAttributeMatch(attributeLine.text, attributeLine.from)!;
    previousStatusChangedAtSource = content.slice(attribute.from, attribute.to);
    if (statusChangedAtSource === null) {
      changes.push(attributeLineRemoval(content, attributeLine));
    } else {
      changes.push({
        from: attribute.from,
        to: attribute.to,
        insert: statusChangedAtSource,
      });
    }
  } else if (statusChangedAtSource !== null) {
    const indentation = childIndentation(lines, lineNumber - 1);
    const attribute = `${indentation}- ${statusChangedAtSource}`;
    changes.push(attributeLineInsertion(content, lines, lineNumber - 1, attribute));
  }

  const updated = applyTextChanges(content, changes);
  return {
    changed: true,
    content: updated,
    changes,
    previousStatusChangedAtSource,
    statusChangedAtSource,
  };
}

function unchangedStatusChange(
  content: string,
  statusChangedAtSource: string | null,
): TaskStatusContentChange {
  return {
    changed: false,
    content,
    changes: [],
    previousStatusChangedAtSource: null,
    statusChangedAtSource,
  };
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

function attributeLineInsertion(
  content: string,
  lines: ContentLine[],
  parentIndex: number,
  attribute: string,
): TextChange {
  const parentIndent = indentationWidth(lines[parentIndex].text);
  const fallbackEol = content.includes("\r\n") ? "\r\n" : "\n";

  for (let index = parentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.text.trim()) {
      continue;
    }

    const indent = indentationWidth(line.text);
    const startsChildBlock = indent > parentIndent && parseListItemPrefix(line.text) !== null;
    if (indent <= parentIndent || startsChildBlock) {
      return {
        from: line.from,
        to: line.from,
        insert: `${attribute}${fallbackEol}`,
      };
    }
  }

  if (content.endsWith("\n")) {
    return {
      from: content.length,
      to: content.length,
      insert: `${attribute}${fallbackEol}`,
    };
  }

  return {
    from: content.length,
    to: content.length,
    insert: `${fallbackEol}${attribute}`,
  };
}

function attributeLineRemoval(content: string, line: ContentLine): TextChange {
  if (line.eol) {
    return { from: line.from, to: line.fullTo, insert: "" };
  }

  let from = line.from;
  if (from > 0 && content[from - 1] === "\n") {
    from -= 1;
    if (from > 0 && content[from - 1] === "\r") {
      from -= 1;
    }
  }
  return { from, to: line.to, insert: "" };
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
