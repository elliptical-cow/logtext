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
  openingMarker: string;
  closingMarker: string;
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
  const contentTo = lineText.endsWith("\r") ? lineText.length - 1 : lineText.length;
  const match = attributePattern.exec(lineText.slice(contentFrom, contentTo));
  if (!match) {
    return null;
  }

  const from = lineFrom + contentFrom;
  return {
    name: match[1],
    value: match[2] ?? "",
    from,
    to: lineFrom + contentTo,
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

      const openingMarker = `LOGTEXT_BLOCK_ATTRIBUTE_${tokens.length}_OPEN`;
      const closingMarker = `LOGTEXT_BLOCK_ATTRIBUTE_${tokens.length}_CLOSE`;
      tokens.push({ openingMarker, closingMarker, name: match.name });
      return [
        line.slice(0, match.nameFrom),
        openingMarker,
        line.slice(match.nameTo, match.to),
        closingMarker,
        line.slice(match.to),
      ].join("");
    })
    .join("\n");

  return { markdown, tokens };
}
