/**
 * Registry and pure text generation for editor slash commands.
 *
 * Commands replace only the slash expression at the start of block content;
 * list markers and indentation remain ordinary Markdown owned by the editor.
 */

import { listItemTextFrom, parseListItemPrefix } from "./markdownPatterns.js";
import { formatLocalDate, formatLocalTime } from "./calendarDates.js";
import { DEFAULT_TASK_STATES } from "./taskKeywords.js";

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
  continuationIndent?: string;
  now?: Date;
  taskStates?: readonly string[];
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
  const contentFrom = listPrefix
    ? listItemTextFrom(listPrefix)
    : /^[\t ]*/.exec(textBeforeCursor)?.[0].length ?? 0;
  const match = /^\/([a-z]*)$/i.exec(textBeforeCursor.slice(contentFrom));
  if (!match) return null;

  const query = match[1];
  const commandFrom = cursorPosition - query.length - 1;
  return {
    commandFrom,
    queryFrom: commandFrom + 1,
    query,
  };
}

export function slashCommandsForQuery(query: string) {
  const normalized = query.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.label.startsWith(normalized));
}

export function slashCommandInsertion(
  command: SlashCommandId,
  {
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
      return blockInsertion("```", "```", continuationIndent);
    case "mermaid":
      return blockInsertion("```mermaid", "```", continuationIndent);
    case "math":
      return blockInsertion("$$", "$$", continuationIndent);
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
  continuationIndent: string,
): SlashCommandInsertion {
  const text = `${opening}\n${continuationIndent}\n${continuationIndent}${closing}`;
  return {
    text,
    cursorOffset: opening.length + 1 + continuationIndent.length,
  };
}
