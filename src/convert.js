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

function linkDestination(node) {
  const href = node.getAttribute("href").replace(/([()])/g, "\\$1");
  const title = (node.getAttribute("title") || "").replace(/\s*\n+\s*/g, " ").replace(/"/g, '\\"');
  return `${href}${title ? ` "${title}"` : ""}`;
}

function gfmInlineRules(turndown) {
  // Link text is one line: a link around blocks would otherwise split across lines.
  turndown.addRule("pmInlineLink", {
    filter: (node) => node.nodeName === "A" && Boolean(node.getAttribute("href")),
    replacement(content, node) {
      if (node.querySelector("h1, h2, h3, h4, h5, h6")) return `\n\n${content}\n\n`;
      return `[${content.trim().replace(/\s*\n+\s*/g, " ")}](${linkDestination(node)})`;
    },
  });
  turndown.addRule("pmHeading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement(content, node) {
      content = content.trim();
      if (!content) return "";
      const link = closest(node, "A");
      if (link?.getAttribute("href")) content = `[${content.replace(/\s*\n+\s*/g, " ")}](${linkDestination(link)})`;
      return `\n\n${"#".repeat(Number(node.nodeName[1]))} ${content}\n\n`;
    },
  });
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

// Each cell's column, and the row-spanned cells that fill the slots before it
// (or at the row's end): null for the rest of a cell's column span. A span
// stops at its row group.
function tableGrid(rows) {
  const columns = new Map();
  const before = new Map();
  const after = new Map();
  let carry = [];
  let group = null;
  for (const row of rows) {
    if (row.parentNode !== group) carry = [];
    group = row.parentNode;
    let column = 0;
    let slots = [];
    const take = (gaps) => {
      while (carry[column]?.left > 0 || (gaps && column < carry.length)) {
        const entry = carry[column];
        slots.push(entry?.left > 0 ? entry.cell : null);
        if (entry?.left > 0) entry.left -= 1;
        column += 1;
      }
    };
    for (const cell of rowCells(row)) {
      slots = [];
      take();
      before.set(cell, slots);
      columns.set(cell, column);
      const left = Number.parseInt(cell.getAttribute?.("rowspan") || "1", 10) - 1;
      const span = spanOf(cell);
      for (let i = 0; i < span; i += 1) {
        if (left > 0) carry[column + i] = { cell: i ? null : cell, left };
      }
      column += span;
    }
    slots = [];
    take(true);
    after.set(row, slots);
  }
  return { columns, before, after };
}

const tables = new WeakMap();

// Worked out once per table: cell and row rules run for every cell.
function tableInfo(table) {
  let info = tables.get(table);
  if (info) return info;
  const rows = tableRows(table);
  // Layout tables (nesting, a single cell, a single column) read better as
  // blocks than as a grid.
  const layout = Boolean(table.querySelector?.("table")) || !rows.length
    || Math.max(...rows.map((row) => rowCells(row).reduce((sum, cell) => sum + spanOf(cell), 0))) <= 1;
  // A GFM cell is one line, so a data table holding code blocks is rendered as
  // blocks too, each cell under its column's header: the code stays fenced.
  const block = layout || Boolean(table.querySelector?.("pre"));
  info = { layout, block, header: columnHeaders(rows[0]), text: new Map(), ...tableGrid(rows) };
  tables.set(table, info);
  return info;
}

function isBlockCell(node) {
  const table = closest(node, "TABLE");
  return !table || tableInfo(table).block;
}

// A row-spanned cell repeats in each row, so a row reads whole by itself.
function slotsMarkdown(slots, info) {
  return slots.map((cell) => ` ${info.text.get(cell) || ""} |`).join("");
}

function labelText(cell) {
  return String(cell.textContent || "").replace(/\s+/g, " ").trim();
}

// A first row of two or more <th>: column headers. (A single spanning <th>
// is a title, not a header.)
function columnHeaders(first) {
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
  const info = table && tableInfo(table);
  if (!info || info.layout) return "";
  const row = cell.parentNode;
  const { header } = info;
  if (header) {
    if (row === header) return null;
    const column = info.columns.get(cell);
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

// An icon's straight strokes, as lists of points; null if any stroke curves.
function iconStrokes(svg) {
  const strokes = [];
  for (const shape of Array.from(svg.querySelectorAll?.("path, polyline, line") || [])) {
    const at = (name) => shape.getAttribute(name);
    const d = at("d") ?? `M${at("points") ?? `${at("x1")} ${at("y1")} ${at("x2")} ${at("y2")}`}`;
    const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) || [];
    let x = 0;
    let y = 0;
    let command = "";
    let points = [];
    for (let i = 0; i < tokens.length;) {
      if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
      const relative = command > "Z";
      const type = command.toUpperCase();
      if (!"MLHV".includes(type)) return null;
      if (type !== "V") x = Number(tokens[i++]) + (relative ? x : 0);
      if (type !== "H") y = Number(tokens[i++]) + (relative ? y : 0);
      if (type === "M") {
        points = [];
        strokes.push(points);
        command = relative ? "l" : "L";
      }
      points.push([x, y]);
    }
  }
  return strokes;
}

// What an icon's shape says, for the tick, dash and cross of comparison tables.
function iconShape(strokes) {
  const [first, second] = strokes || [];
  if (strokes?.length === 1 && first.length === 2 && first[0][1] === first[1][1]) return "\u2013";
  if (strokes?.length === 1 && first.length === 3) {
    const [a, b, c] = first;
    const arm = (p) => Math.hypot(p[0] - b[0], p[1] - b[1]);
    const ratio = Math.max(arm(a), arm(c)) / Math.min(arm(a), arm(c));
    if (b[1] > a[1] && b[1] > c[1] && (a[0] - b[0]) * (c[0] - b[0]) < 0 && ratio > 1.3) return "\u2713";
  }
  const slope = ([p, q]) => (q[0] - p[0]) * (q[1] - p[1]);
  if (strokes?.length === 2 && first.length === 2 && second.length === 2 && slope(first) * slope(second) < 0) return "\u2717";
  return "";
}

// A cell holding only an icon would be empty, and the table couldn't say which
// plan has what: its accessible name, else its shape, else that an icon is there.
function cellIcon(cell) {
  const svg = cell.querySelector?.("svg");
  if (!svg) return "";
  return svg.getAttribute("aria-label")?.trim() || svg.querySelector("title")?.textContent?.trim()
    || iconShape(iconStrokes(svg)) || "[icon]";
}

function tableRules(turndown) {
  turndown.addRule("pmTableCell", {
    filter: ["th", "td"],
    replacement(rawContent, node) {
      const content = rawContent.trim() ? rawContent : cellIcon(node);
      if (isBlockCell(node)) {
        // Header cells become the labels on the other cells.
        const label = cellLabel(node);
        if (label === null) return "";
        return label ? `\n\n**${createTurndown().escape(label)}**\n\n${content}\n\n` : `\n\n${content}\n\n`;
      }
      const info = tableInfo(closest(node, "TABLE"));
      const text = cellText(content);
      info.text.set(node, text);
      const pad = " |   ".repeat(spanOf(node) - 1);
      return `${slotsMarkdown(info.before.get(node), info)} ${text}${pad} |`;
    },
  });
  turndown.addRule("pmTableRow", {
    filter: "tr",
    replacement(content, node) {
      if (isBlockCell(node)) return `\n${content}\n`;
      const info = tableInfo(closest(node, "TABLE"));
      return `\n|${content}${slotsMarkdown(info.after.get(node), info)}`;
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
      if (tableInfo(node).block) return `\n\n${content}\n\n`;
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

/**
 * A configured Turndown instance (cached).
 * @returns {import("./types.js").TurndownInstance}
 */
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
