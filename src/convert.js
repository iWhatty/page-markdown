// Stage 4: HTML to Markdown with Turndown plus GitHub-flavoured rules:
// strikethrough, task-list checkboxes and tables. Every data table becomes a
// GFM table, never raw HTML.
import TurndownService from "turndown";

export const TURNDOWN_OPTIONS = Object.freeze({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  hr: "---",
});

function gfmInlineRules(turndown) {
  turndown.addRule("pmStrikethrough", {
    filter: ["del", "s", "strike"],
    replacement: (content) => `~~${content}~~`,
  });
  // A checkbox at the start of a list item (directly, or in a label or span).
  turndown.addRule("pmTaskListItem", {
    filter(node) {
      const isCheckbox = (node.nodeName === "INPUT" && String(node.getAttribute("type")).toLowerCase() === "checkbox")
        || node.getAttribute?.("role") === "checkbox";
      if (!isCheckbox) return false;
      const parent = node.parentNode;
      return parent?.nodeName === "LI"
        || (["LABEL", "SPAN"].includes(parent?.nodeName) && parent.parentNode?.nodeName === "LI");
    },
    replacement(content, node) {
      const checked = node.nodeName === "INPUT"
        ? Boolean(node.checked) || node.hasAttribute?.("checked")
        : node.getAttribute("aria-checked") === "true";
      return checked ? "[x] " : "[ ] ";
    },
  });
}

function closest(node, name) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent.nodeName === name) return parent;
  }
  return null;
}

function tableRows(table) {
  const rows = [];
  const walk = (node) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeName === "TR") rows.push(child);
      else if (["THEAD", "TBODY", "TFOOT"].includes(child.nodeName)) walk(child);
    }
  };
  walk(table);
  return rows;
}

function rowCells(row) {
  return Array.from(row.childNodes || []).filter((node) => node.nodeName === "TD" || node.nodeName === "TH");
}

function spanOf(cell) {
  const span = Number.parseInt(cell.getAttribute?.("colspan") || "1", 10);
  return Number.isFinite(span) && span > 1 ? Math.min(span, 50) : 1;
}

// Layout tables (nesting, a single cell, a single column) read better as
// blocks than as a grid.
function isLayoutTable(table) {
  if (table.querySelector?.("table")) return true;
  const rows = tableRows(table);
  if (!rows.length) return true;
  const widest = Math.max(...rows.map((row) => rowCells(row).reduce((sum, cell) => sum + spanOf(cell), 0)));
  return widest <= 1;
}

// A GFM cell is one line, so a data table holding code blocks is rendered as
// blocks too, each cell under its column's header: the code stays fenced.
function isBlockTable(table) {
  return isLayoutTable(table) || Boolean(table.querySelector?.("pre"));
}

function isBlockCell(node) {
  const table = closest(node, "TABLE");
  return !table || isBlockTable(table);
}

function labelText(cell) {
  return String(cell.textContent || "").replace(/\s+/g, " ").trim();
}

// A first row of two or more <th>: column headers. (A single spanning <th>
// is a title, not a header.)
function columnHeaders(table) {
  const first = tableRows(table)[0];
  const cells = first ? rowCells(first) : [];
  return cells.length > 1 && cells.every((cell) => cell.nodeName === "TH") ? first : null;
}

function rowHeader(row) {
  const [first, ...rest] = rowCells(row);
  return first?.nodeName === "TH" && rest.length ? first : null;
}

// The label for a cell of a block-rendered data table: its column's header
// (colspans counted), else its row's header. null when the cell is itself a
// label; "" for layout tables and unlabelled cells.
function cellLabel(cell) {
  const table = closest(cell, "TABLE");
  if (!table || isLayoutTable(table)) return "";
  const row = cell.parentNode;
  const header = columnHeaders(table);
  if (header) {
    if (row === header) return null;
    let column = 0;
    for (const other of rowCells(row)) {
      if (other === cell) break;
      column += spanOf(other);
    }
    let start = 0;
    for (const th of rowCells(header)) {
      if (column < start + spanOf(th)) return labelText(th);
      start += spanOf(th);
    }
    return "";
  }
  const th = rowHeader(row);
  if (!th) return "";
  return cell === th ? null : labelText(th);
}

// A GFM cell is one line: collapse breaks and block structure to spaces,
// and escape pipes.
function cellText(content) {
  const text = String(content)
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Every pipe: Turndown escapes a literal backslash as "\\", so "\|" in the
  // content is not an escaped pipe.
  return text.replace(/\|/g, "\\|");
}

function tableRules(turndown) {
  turndown.addRule("pmTableCell", {
    filter: ["th", "td"],
    replacement(content, node) {
      if (isBlockCell(node)) {
        // Header cells become the labels on the other cells.
        const label = cellLabel(node);
        if (label === null) return "";
        return label ? `\n\n**${createTurndown().escape(label)}**\n\n${content}\n\n` : `\n\n${content}\n\n`;
      }
      const pad = " |   ".repeat(spanOf(node) - 1);
      return ` ${cellText(content)}${pad} |`;
    },
  });
  turndown.addRule("pmTableRow", {
    filter: "tr",
    replacement(content, node) {
      if (isBlockCell(node)) return `\n${content}\n`;
      return `\n|${content}`;
    },
  });
  turndown.addRule("pmTableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement(content) {
      return content;
    },
  });
  turndown.addRule("pmTable", {
    filter: "table",
    replacement(content, node) {
      if (isBlockTable(node)) return `\n\n${content}\n\n`;
      const lines = content.split("\n").filter((line) => line.startsWith("|"));
      if (!lines.length) return "\n\n";
      const width = Math.max(...lines.map((line) => line.split(/(?<!\\)\|/).length - 2));
      const padded = lines.map((line) => {
        const cells = line.split(/(?<!\\)\|/).length - 2;
        return cells < width ? `${line}${" |".repeat(width - cells)}` : line;
      });
      // GFM needs a header row; the first row serves when the table has none.
      const separator = `|${" --- |".repeat(width)}`;
      const caption = node.querySelector?.("caption")?.textContent?.trim();
      const body = [padded[0], separator, ...padded.slice(1)].join("\n");
      return `\n\n${caption ? `${cellText(caption)}\n\n` : ""}${body}\n\n`;
    },
  });
  turndown.addRule("pmTableCaption", {
    filter: "caption",
    replacement() {
      return "";
    },
  });
}

let shared = null;

/** A configured Turndown instance (cached). */
export function createTurndown() {
  if (shared) return shared;
  const turndown = new TurndownService({ ...TURNDOWN_OPTIONS });
  gfmInlineRules(turndown);
  tableRules(turndown);
  // Elements that never carry readable text. (Buttons stay: accordions put
  // headings in them.)
  turndown.remove(["script", "style", "noscript", "template", "iframe", "svg", "canvas"]);
  shared = turndown;
  return turndown;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  return createTurndown().turndown(String(html || ""));
}
