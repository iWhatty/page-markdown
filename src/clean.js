// Stage 5: tidy Markdown without losing content. Code fences are never
// touched. Short lines (table cells, list items, numbers) are kept, and no
// regex spans lines, so text is never cut.

/**
 * Applies `transform` to the prose between fenced code blocks only.
 * A shorter embedded fence does not close a block; an unterminated fence
 * keeps the rest verbatim.
 * @param {string} markdown
 * @param {(prose: string) => string} transform
 */
export function mapOutsideFences(markdown, transform) {
  const blocks = [];
  let lines = [];
  let fence = null;
  let indent = 0;
  const flush = (isCode) => {
    if (!lines.length) return;
    const text = lines.join("\n");
    blocks.push(isCode ? text : transform(text));
    lines = [];
  };
  for (const line of String(markdown).split("\n")) {
    // Any indent or quote prefix: Turndown nests code in lists and blockquotes.
    const match = line.match(/^([ >]*)(`{3,}|~{3,})(.*)$/);
    if (!fence && match && !(match[2][0] === "`" && match[3].includes("`"))) {
      flush(false);
      fence = match[2];
      indent = match[1].length;
      lines.push(line);
    } else if (fence && match && match[1].length <= indent + 3 && match[2][0] === fence[0] && match[2].length >= fence.length && !match[3].trim()) {
      lines.push(line);
      flush(true);
      fence = null;
    } else {
      lines.push(line);
    }
  }
  flush(Boolean(fence));
  return blocks.join("\n");
}

// A single prose line holding a large, valid JSON document (embedded app
// state). Bounded to one line and verified by parsing, so text is never cut.
const MIN_JSON_LINE = 2000;

function isJsonLine(line) {
  const s = line.trim();
  if (s.length < MIN_JSON_LINE || !/^[[{]/.test(s)) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} markdown
 * @returns {{ markdown: string, removedJsonLines: number }}
 */
export function cleanMarkdown(markdown) {
  let removedJsonLines = 0;
  const cleaned = mapOutsideFences(markdown, (prose) => prose
    .split("\n")
    .filter((line) => {
      if (isJsonLine(line)) {
        removedJsonLines += 1;
        return false;
      }
      return true;
    })
    // Trim trailing whitespace, but keep a two-space hard break (<br>) on a
    // line with text; whitespace-only lines become empty.
    .map((line) => (/\S {2,}$/.test(line) ? line.replace(/[ \t]+$/, "  ") : line.replace(/[ \t]+$/, "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    // Blocks are joined with "\n": one blank line at most beside a fence.
    .replace(/^\n+/, "\n")
    .replace(/\n+$/, "\n"));
  return { markdown: cleaned.replace(/^\n+|\n+$/g, ""), removedJsonLines };
}

// Link text may hold escaped brackets and whole images: [![alt](img)](href)
// keeps the image, not "![alt" pointing at href.
const LINK_TARGET = String.raw`\((?:[^()\s]|\([^()]*\))+(?:\s+"[^"]*")?\)`;
const INLINE_LINK = new RegExp(String.raw`(!?)\[((?:\\.|!\[[^\]]*\]${LINK_TARGET}|[^\[\]\\])*)\]${LINK_TARGET}`);
// Replaces matches of `pattern`, leaving inline code spans as they are.
const replaceOutsideCode = (md, pattern, replace) => md.replace(
  new RegExp(`\`+[^\`\\n]*\`+|${pattern.source}`, "g"),
  (all, ...groups) => (all[0] === "`" ? all : replace(all, ...groups)),
);
const stripInlineLinks = (md) => replaceOutsideCode(md, INLINE_LINK, (all, bang, text) => (bang ? all : text));
const dropReferenceDefs = (md) => md.replace(/^\s{0,3}\[[^\]]+]:\s+\S+.*$/gm, "");
const stripStructure = (md) => md
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s*[-+*]\s+/gm, "")
  .replace(/^\s*\d+\.\s+/gm, "")
  .replace(/^\s{0,3}>\s?/gm, "")
  .replace(/^\s*([-_*])\s*(?:\1\s*){2,}$/gm, "");
const stripEmphasis = (md) => replaceOutsideCode(
  replaceOutsideCode(md, /(\*\*|__)(.+?)\1/, (all, mark, text) => text),
  /(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/,
  (all, mark, text) => text,
);
const stripImages = (md) => replaceOutsideCode(md, /!\[([^\]]*)\]\([^)]*\)/, (all, alt) => alt);

/**
 * Output modes. "no_links" keeps link text. "text_only" also drops headings,
 * list markers, emphasis and images. Both leave fenced code verbatim.
 * @param {string} markdown
 * @param {"full"|"no_links"|"text_only"} mode
 */
export function applyMode(markdown, mode = "full") {
  if (mode === "no_links") return mapOutsideFences(markdown, stripInlineLinks);
  if (mode === "text_only") {
    // Blank-line collapsing stays inside the prose transform: code keeps its own.
    return mapOutsideFences(markdown, (prose) => stripEmphasis(stripStructure(stripImages(dropReferenceDefs(stripInlineLinks(prose)))))
      .replace(/\n{3,}/g, "\n\n"))
      .trim();
  }
  return markdown;
}
