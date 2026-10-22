// page-markdown: a page's DOM in, clean Markdown and metadata out.
// sanitize → standardize → extract → convert → clean (→ mode)
import { sanitizeToInertDocument } from "./sanitize.js";
import { standardizeDocument } from "./standardize.js";
import { extractContent } from "./extract.js";
import { htmlToMarkdown } from "./convert.js";
import { cleanMarkdown, applyMode } from "./clean.js";
import { collectMetadata } from "./metadata.js";
import { recoverLeadParagraph, chooseHeadline } from "./refine.js";

export const VERSION = "0.1.1";

export { sanitizeToInertDocument, DEFAULT_SANITIZE_OPTIONS, isAdvertisementElement, createInertDocument } from "./sanitize.js";
export { standardizeDocument } from "./standardize.js";
export { extractContent, DEFAULT_MIN_EXTRACT_CHARS } from "./extract.js";
export { htmlToMarkdown, createTurndown, TURNDOWN_OPTIONS } from "./convert.js";
export { cleanMarkdown, applyMode, mapOutsideFences } from "./clean.js";
export { collectMetadata } from "./metadata.js";
export { recoverLeadParagraph, chooseHeadline } from "./refine.js";

function documentOf(input) {
  if (input?.nodeType === 9) return input;
  if (input?.nodeType === 1) return input.ownerDocument;
  throw new TypeError("page-markdown: expected a Document or Element");
}

function toMarkdown(html, mode) {
  const converted = htmlToMarkdown(html);
  const { markdown, removedJsonLines } = cleanMarkdown(converted);
  return { markdown: applyMode(markdown, mode), removedJsonLines, convertedChars: converted.length };
}

/**
 * @typedef {object} PageMarkdownOptions
 * @property {string} [url] page URL for absolute links (default: the document's URL)
 * @property {"full"|"no_links"|"text_only"} [mode="full"]
 * @property {"readable"|"full"|((doc: Document) => object|null)} [extract="readable"]
 *   "readable": Readability with full-page fallback; "full": the whole body;
 *   or a custom extractor receiving a copy of the standardized document.
 * @property {number} [minExtractChars=100] below this, fall back to the full page
 * @property {boolean} [includeFullPage=false] also return the full-page Markdown
 * @property {boolean} [includeTitle=true] start readable output with "# <headline>"
 * @property {boolean} [recoverLead=true] restore a dropped lead paragraph that matches the meta description
 * @property {object} [sanitize] see DEFAULT_SANITIZE_OPTIONS
 * @property {object} [readability] options passed to Readability
 */

/**
 * Converts a page (or an element of it) to Markdown.
 * Pure with respect to the input: the live document is only read.
 *
 * @param {Document|Element} input
 * @param {PageMarkdownOptions} [options]
 */
export function pageToMarkdown(input, options = {}) {
  const doc = documentOf(input);
  const url = options.url || doc.URL || doc.location?.href || "";
  const mode = options.mode || "full";
  const warnings = [];

  const { document: inert, omissions } = sanitizeToInertDocument(input, options.sanitize);
  const standardization = standardizeDocument(inert, { url });
  const extraction = extractContent(inert, {
    extract: options.extract,
    minExtractChars: options.minExtractChars,
    readability: options.readability,
  });
  if (extraction.fallbackReason) warnings.push(`extraction fell back to the full page: ${extraction.fallbackReason}`);

  const pageMetadata = collectMetadata(doc, { url });
  let extractedHtml = extraction.html;
  let leadRecovered = false;
  if (extraction.method !== "full_page" && options.recoverLead !== false) {
    ({ html: extractedHtml, recovered: leadRecovered } = recoverLeadParagraph(extractedHtml, inert, pageMetadata.description));
  }
  const headline = chooseHeadline(inert, { ...pageMetadata, extractedTitle: extraction.title });

  const main = toMarkdown(extractedHtml, mode);
  // Readability lifts the article's H1 out as its title; put a clean heading
  // back so the capture stands alone, unless the body still has a top-level one.
  if (options.includeTitle !== false && extraction.method === "readability" && mode !== "text_only") {
    if (headline && !/^# \S/m.test(main.markdown)) main.markdown = `# ${headline}\n\n${main.markdown}`;
  }
  const omissionList = [];
  if (omissions.shadowHosts) {
    omissionList.push({ kind: "shadow_content", count: omissions.shadowHosts, note: "Open shadow content omitted: capture limit" });
  }
  if (main.removedJsonLines) {
    omissionList.push({ kind: "json_line", count: main.removedJsonLines, note: "Large single-line JSON documents removed" });
  }

  const result = {
    version: VERSION,
    markdown: main.markdown,
    metadata: {
      ...pageMetadata,
      ...(headline ? { headline } : {}),
      ...(extraction.title ? { extractedTitle: extraction.title } : {}),
      ...(extraction.byline ? { byline: extraction.byline } : {}),
    },
    extraction: {
      method: extraction.method,
      ...(extraction.fallbackReason ? { fallbackReason: extraction.fallbackReason } : {}),
      ...(leadRecovered ? { leadRecovered: true } : {}),
    },
    omissions: omissionList,
    warnings,
    stats: {
      mode,
      extractedHtmlChars: extraction.html.length,
      convertedChars: main.convertedChars,
      markdownChars: main.markdown.length,
      standardization,
    },
  };

  if (options.includeFullPage) {
    const full = extraction.method === "full_page"
      ? main
      : toMarkdown((inert.body || inert.documentElement).innerHTML || "", mode);
    result.fullPageMarkdown = full.markdown;
  }
  if (omissions.shadowHosts) {
    result.markdown += `\n\n_Open shadow content omitted: capture limit (${omissions.shadowHosts} host(s))._`;
  }
  return result;
}
