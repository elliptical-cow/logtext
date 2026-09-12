import { checkboxLines } from "./checkboxes.js";

export function renderCheckboxItems(html: string, markdown = "", sourceLineNumbers: number[] = []) {
  const lines = checkboxLines(markdown);
  let checkboxIndex = 0;

  return html.replaceAll(
    /<li([^>]*)>(\s*<p>)?\[([ xX])\]\s*/g,
    (_match, attributes: string, paragraphOpen: string | undefined, marker: string) => {
      const checked = marker.toLowerCase() === "x";
      const localLine = lines[checkboxIndex++]?.lineNumber;
      const renderedLine = sourceLineAttribute(attributes);
      const line = renderedLine ?? (localLine ? (sourceLineNumbers[localLine - 1] ?? localLine) : "");
      const checkedAttribute = checked ? " checked" : "";
      const label = checked ? "Checked task" : "Unchecked task";

      return `${liOpenWithClass(attributes, "task-list-item")}${paragraphOpen ?? ""}<input class="task-list-checkbox" type="checkbox"${checkedAttribute} data-line="${line}" aria-label="${label}" /> `;
    },
  );
}

function sourceLineAttribute(attributes: string) {
  const match = /\sdata-source-line=(["'])(\d+)\1/.exec(attributes);
  return match ? Number(match[2]) : null;
}

function liOpenWithClass(attributes: string, className: string) {
  if (/\sclass=/.test(attributes)) {
    return `<li${attributes.replace(/\sclass=(["'])(.*?)\1/, ` class=$1$2 ${className}$1`)}>`;
  }

  return `<li${attributes} class="${className}">`;
}
