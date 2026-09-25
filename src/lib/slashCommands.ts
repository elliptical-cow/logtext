import { listItemTextFrom, parseListItemPrefix } from "./markdownPatterns.js";

export type SlashCommandId = "date" | "today";

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

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { id: "date", label: "date", detail: "Pick and insert a date" },
  { id: "today", label: "today", detail: "Insert today's date" },
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
