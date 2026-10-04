/**
 * Registry and pure text generation for editor slash commands.
 *
 * Commands replace only the active, whitespace-delimited slash expression;
 * surrounding text, list markers, and indentation remain ordinary Markdown.
 */

import { listItemTextFrom, parseListItemPrefix } from "./markdownPatterns.js";
import { formatLocalDate, formatLocalTime } from "./calendarDates.js";
import { DEFAULT_TASK_STATES } from "./taskKeywords.js";
import type { SlashCommandSortMode } from "./types.js";

export type SlashCommandId =
  | "checkbox"
  | "code"
  | "date"
  | "math"
  | "mermaid"
  | "task"
  | "time"
  | "today"
  | "tomorrow"
  | "yesterday";

export type SlashCommandUsage = Partial<Record<SlashCommandId, number>>;

export type SlashCommandDefinition = {
  id: SlashCommandId;
  label: string;
  detail: string;
};

export type SlashCommandMatch = {
  commandFrom: number;
  queryFrom: number;
  query: string;
};

export type SlashCommandInsertion = {
  text: string;
  cursorOffset: number;
};

export type SlashCommandInsertionOptions = {
  blockPrefix?: string;
  continuationIndent?: string;
  now?: Date;
  taskStates?: readonly string[];
};

export type SlashCommandBlockLayout = {
  blockPrefix: string;
  continuationIndent: string;
};

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { id: "date", label: "date", detail: "Pick and insert a date" },
  { id: "today", label: "today", detail: "Insert today's date" },
  { id: "tomorrow", label: "tomorrow", detail: "Insert tomorrow's date" },
  { id: "yesterday", label: "yesterday", detail: "Insert yesterday's date" },
  { id: "time", label: "time", detail: "Insert the current local time" },
  { id: "task", label: "task", detail: "Insert the first configured task state" },
  { id: "checkbox", label: "checkbox", detail: "Insert an unchecked checkbox" },
  { id: "code", label: "code", detail: "Insert a fenced code block" },
  { id: "mermaid", label: "mermaid", detail: "Insert a Mermaid diagram block" },
  { id: "math", label: "math", detail: "Insert a block formula" },
];

export function matchSlashCommand(
  textBeforeCursor: string,
  cursorPosition: number,
): SlashCommandMatch | null {
  const listPrefix = parseListItemPrefix(textBeforeCursor);
  const contentFrom = listPrefix ? listItemTextFrom(listPrefix) : 0;
  const match = /(?:^|[\t ])\/([a-z]*)$/i.exec(textBeforeCursor.slice(contentFrom));
  if (!match) return null;

  const query = match[1];
  const commandFrom = cursorPosition - query.length - 1;
  return {
    commandFrom,
    queryFrom: commandFrom + 1,
    query,
  };
}

export function slashCommandsForQuery(
  query: string,
  sortMode: SlashCommandSortMode = "alphabetical",
  usage: SlashCommandUsage = {},
) {
  const normalized = query.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.label.startsWith(normalized)).sort(
    (left, right) => {
      if (sortMode === "frequency") {
        const usageDifference = (usage[right.id] ?? 0) - (usage[left.id] ?? 0);
        if (usageDifference !== 0) return usageDifference;
      }
      return left.label.localeCompare(right.label);
    },
  );
}

export function slashCommandBlockLayout(linePrefix: string): SlashCommandBlockLayout {
  const listPrefix = parseListItemPrefix(linePrefix);
  const contentFrom = listPrefix
    ? listItemTextFrom(listPrefix)
    : /^[\t ]*/.exec(linePrefix)?.[0].length ?? 0;
  const continuationIndent = linePrefix.slice(0, contentFrom).replace(/[^\t]/g, " ");
  const hasBlockContent = linePrefix.slice(contentFrom).trim().length > 0;
  return {
    blockPrefix: hasBlockContent ? `\n${continuationIndent}` : "",
    continuationIndent,
  };
}

export function slashCommandInsertion(
  command: SlashCommandId,
  {
    blockPrefix = "",
    continuationIndent = "",
    now = new Date(),
    taskStates = DEFAULT_TASK_STATES,
  }: SlashCommandInsertionOptions = {},
): SlashCommandInsertion | null {
  switch (command) {
    case "date":
      return null;
    case "today":
      return inlineInsertion(formatLocalDate(now));
    case "tomorrow":
      return inlineInsertion(formatLocalDate(relativeLocalDate(now, 1)));
    case "yesterday":
      return inlineInsertion(formatLocalDate(relativeLocalDate(now, -1)));
    case "time":
      return inlineInsertion(formatLocalTime(now));
    case "task":
      return inlineInsertion(`${taskStates[0] ?? DEFAULT_TASK_STATES[0]} `);
    case "checkbox":
      return inlineInsertion("[ ] ");
    case "code":
      return blockInsertion("```", "```", blockPrefix, continuationIndent);
    case "mermaid":
      return blockInsertion(
        "```mermaid",
        "```",
        blockPrefix,
        continuationIndent,
        ["graph TD", "  A[Start] --> B[End]"],
      );
    case "math":
      return blockInsertion("$$", "$$", blockPrefix, continuationIndent);
  }
}

function inlineInsertion(text: string): SlashCommandInsertion {
  return { text, cursorOffset: text.length };
}

function relativeLocalDate(date: Date, dayOffset: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
}

function blockInsertion(
  opening: string,
  closing: string,
  blockPrefix: string,
  continuationIndent: string,
  content: readonly string[] = [""],
): SlashCommandInsertion {
  const body = content.map((line) => `${continuationIndent}${line}`).join("\n");
  const text = `${blockPrefix}${opening}\n${body}\n${continuationIndent}${closing}`;
  return {
    text,
    cursorOffset: blockPrefix.length + opening.length + 1 + body.length,
  };
}
