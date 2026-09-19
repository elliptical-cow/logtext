import { listItemTextFrom, parseListItemPrefix } from "./markdownPatterns.js";

export const STATUS_CHANGED_AT_ATTRIBUTE = "status-changed-at";

export type BlockAttributeMatch = {
  name: string;
  value: string;
  from: number;
  to: number;
  nameFrom: number;
  nameTo: number;
};

export type BlockAttributeToken = {
  marker: string;
  name: string;
};

const attributePattern = /^([A-Za-z][A-Za-z0-9_-]*)::(?:[ \t]*(.*))?$/;

export function blockAttributeMatch(
  lineText: string,
  lineFrom = 0,
): BlockAttributeMatch | null {
  const prefix = parseListItemPrefix(lineText);
  if (!prefix || prefix.checkbox) {
    return null;
  }

  const contentFrom = listItemTextFrom(prefix);
  const match = attributePattern.exec(lineText.slice(contentFrom));
  if (!match) {
    return null;
  }

  const from = lineFrom + contentFrom;
  return {
    name: match[1],
    value: match[2] ?? "",
    from,
    to: lineFrom + lineText.length,
    nameFrom: from,
    nameTo: from + match[1].length + 2,
  };
}

export function markBlockAttributesForRendering(
  markdownContent: string,
  codeLines: Set<number>,
) {
  const tokens: BlockAttributeToken[] = [];
  const markdown = markdownContent
    .split("\n")
    .map((line, index) => {
      if (codeLines.has(index + 1)) {
        return line;
      }

      const match = blockAttributeMatch(line);
      if (!match) {
        return line;
      }

      const marker = `LOGTEXT_BLOCK_ATTRIBUTE_${tokens.length}_TOKEN`;
      tokens.push({ marker, name: match.name });
      return `${line.slice(0, match.nameFrom)}${marker}${line.slice(match.nameTo)}`;
    })
    .join("\n");

  return { markdown, tokens };
}
