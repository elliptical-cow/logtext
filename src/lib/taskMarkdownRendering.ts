import { priorityCookieMatch, taskKeywordMatch } from "./taskKeywords.js";

export type TaskKeywordToken = {
  line: number;
  localLine: number;
  status: string;
  marker: string;
};

export type TaskPriorityToken = TaskKeywordToken & {
  priority: string;
};

export function markTaskKeywordsForRendering(
  markdownContent: string,
  states: string[],
  lineNumbers: number[],
  codeLines: Set<number>,
) {
  const taskTokens: TaskKeywordToken[] = [];
  const priorityTokens: TaskPriorityToken[] = [];
  const markdown = markdownContent
    .split("\n")
    .map((line, index) =>
      codeLines.has(index + 1)
        ? line
        : renderTaskMarkers(line, index, states, lineNumbers, taskTokens, priorityTokens),
    )
    .join("\n");

  return { markdown, taskTokens, priorityTokens };
}

function renderTaskMarkers(
  line: string,
  index: number,
  states: string[],
  lineNumbers: number[],
  taskTokens: TaskKeywordToken[],
  priorityTokens: TaskPriorityToken[],
) {
  const taskMatch = taskKeywordMatch(line, 0, states);
  if (!taskMatch) {
    return line;
  }

  const replacements = [];
  const localLine = index + 1;
  const sourceLine = lineNumbers[index] ?? localLine;
  const taskMarker = `LOGTEXT_TASK_${taskTokens.length}_TOKEN`;
  taskTokens.push({
    line: sourceLine,
    localLine,
    status: taskMatch.status,
    marker: taskMarker,
  });
  replacements.push({ from: taskMatch.from, to: taskMatch.to, marker: taskMarker });

  const priorityMatch = priorityCookieMatch(line, 0, states);
  if (priorityMatch) {
    const priorityMarker = `LOGTEXT_PRIORITY_${priorityTokens.length}_TOKEN`;
    priorityTokens.push({
      line: sourceLine,
      localLine,
      status: taskMatch.status,
      priority: priorityMatch.priority,
      marker: priorityMarker,
    });
    replacements.push({
      from: priorityMatch.from,
      to: priorityMatch.to,
      marker: priorityMarker,
    });
  }

  return replacements
    .sort((left, right) => right.from - left.from)
    .reduce(
      (markedLine, replacement) =>
        `${markedLine.slice(0, replacement.from)}${replacement.marker}${markedLine.slice(
          replacement.to,
        )}`,
      line,
    );
}
