// Stage 4: HTML to Markdown with Turndown plus GitHub-flavoured tables and
// strikethrough.
import TurndownService from "turndown";
import * as gfmPlugin from "@joplin/turndown-plugin-gfm";

export const TURNDOWN_OPTIONS = Object.freeze({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  hr: "---",
});

const gfm = gfmPlugin.gfm || gfmPlugin.default?.gfm;

let shared = null;

/** A configured Turndown instance (cached). */
export function createTurndown() {
  if (shared) return shared;
  const turndown = new TurndownService({ ...TURNDOWN_OPTIONS });
  if (typeof gfm === "function") turndown.use(gfm);
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
