// page-markdown: a page's DOM in, clean Markdown and metadata out.
// sanitize → standardize → extract → convert → clean (→ mode) (→ hidden text)
import { sanitizeToInertDocument } from "./sanitize.js";
import { standardizeDocument } from "./standardize.js";
import { extractContent } from "./extract.js";
import { htmlToMarkdown } from "./convert.js";
import { cleanMarkdown, applyMode, mapOutsideFences } from "./clean.js";
import { collectMetadata } from "./metadata.js";
import { recoverLeadParagraph, chooseHeadline } from "./refine.js";
import { collectPageFacts, pageFactsMarkdown } from "./facts.js";
import { removeHiddenText, hiddenTextOmissions } from "./hidden.js";

export const VERSION = "0.1.5";

export { sanitizeToInertDocument, DEFAULT_SANITIZE_OPTIONS, isAdvertisementElement, createInertDocument } from "./sanitize.js";
export { standardizeDocument } from "./standardize.js";
export { extractContent, DEFAULT_MIN_EXTRACT_CHARS, DEFAULT_MIN_EXTRACT_SHARE } from "./extract.js";
export { htmlToMarkdown, createTurndown, TURNDOWN_OPTIONS } from "./convert.js";
export { cleanMarkdown, applyMode, mapOutsideFences } from "./clean.js";
export { collectMetadata } from "./metadata.js";
export { recoverLeadParagraph, chooseHeadline } from "./refine.js";
export { collectPageFacts, pageFactsMarkdown } from "./facts.js";
export { removeHiddenText, hiddenTextOmissions } from "./hidden.js";
export * from "./types.js";

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

// What relative links resolve against: the page's <base href>, else its URL.
function baseUrl(doc, url) {
  const href = doc.querySelector?.("base[href]")?.getAttribute("href");
  try {
    return href ? new URL(href, url || undefined).href : url;
  } catch {
    return url;
  }
}

// A top-level heading in the prose; a "# comment" line in fenced code is not one.
function hasTopHeading(markdown) {
  let found = false;
  mapOutsideFences(markdown, (prose) => {
    found ||= /^# \S/m.test(prose);
    return prose;
  });
  return found;
}

/**
 * @typedef {object} PageMarkdownOptions
 * @property {string} [url] page URL for absolute links (default: the document's URL)
 * @property {"full"|"no_links"|"text_only"} [mode="full"]
 * @property {"readable"|"full"|import("./extract.js").Extractor} [extract="readable"]
 *   "readable": Readability with full-page fallback; "full": the whole body;
 *   or a custom extractor receiving a copy of the standardized document.
 * @property {number} [minExtractChars=100] below this, fall back to the full page
 * @property {number} [minExtractShare=0.4] when Readability keeps less than this
 *   share of the page's main content, use the main content instead; 0 turns it off
 * @property {boolean} [includeFullPage=false] also return the full-page Markdown
 * @property {boolean} [includeTitle=true] start readable output with "# <headline>"
 * @property {boolean} [recoverLead=true] restore a dropped lead paragraph that matches the meta description
 * @property {boolean} [pageFacts=false] append "## Page facts": short label/value pairs
 *   (sidebar versions, prices, spec rows) that the extracted article left out
 * @property {boolean} [removeHiddenText=false] remove tag-character text,
 *   variation-selector runs and invisible operators from the Markdown (fenced
 *   code included), fullPageMarkdown and metadata; omissions count the runs
 *   removed from the Markdown
 * @property {import("./types.js").SanitizeOptions} [sanitize] see DEFAULT_SANITIZE_OPTIONS
 * @property {import("./types.js").ReadabilityOptions} [readability] options passed to Readability
 */

/**
 * Converts a page (or an element of it) to Markdown.
 * Pure with respect to the input: the live document is only read.
 *
 * @param {Document|Element} input
 * @param {PageMarkdownOptions} [options]
 * @returns {import("./types.js").PageMarkdownResult}
 */
export function pageToMarkdown(input, options = {}) {
  const doc = documentOf(input);
  const url = options.url || doc.URL || doc.location?.href || "";
  const mode = options.mode || "full";
  /** @type {string[]} */
  const warnings = [];

  const { document: inert, omissions } = sanitizeToInertDocument(input, options.sanitize);
  const standardization = standardizeDocument(inert, { url: baseUrl(doc, url) });
  const extraction = extractContent(inert, {
    extract: options.extract,
    minExtractChars: options.minExtractChars,
    minExtractShare: options.minExtractShare,
    readability: options.readability,
  });
  if (extraction.fallbackReason) {
    const target = extraction.method === "main_content" ? "the main content" : "the full page";
    warnings.push(`extraction fell back to ${target}: ${extraction.fallbackReason}`);
  }
  if (omissions.shadowHosts) warnings.push(`shadow content cut off at the capture limit in ${omissions.shadowHosts} host(s); the page's main content may be missing`);

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
  if (options.includeTitle !== false && ["readability", "main_content"].includes(extraction.method) && mode !== "text_only") {
    if (headline && !hasTopHeading(main.markdown)) main.markdown = `# ${headline}\n\n${main.markdown}`;
  }
  let pageFacts = [];
  if (options.pageFacts && extraction.method !== "full_page" && mode !== "text_only") {
    pageFacts = collectPageFacts(inert, extractedHtml);
    if (pageFacts.length) main.markdown = `${main.markdown}\n\n${pageFactsMarkdown(pageFacts)}`;
  }
  /** @type {import("./types.js").PageMarkdownOmission[]} */
  const omissionList = [];
  if (omissions.shadowHosts) {
    omissionList.push({ kind: "shadow_content", count: omissions.shadowHosts, note: "Open shadow content omitted: capture limit" });
  }
  if (main.removedJsonLines) {
    omissionList.push({ kind: "json_line", count: main.removedJsonLines, note: "Large single-line JSON documents removed" });
  }

  /** @type {import("./types.js").PageMarkdownResult} */
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
      ...(pageFacts.length ? { pageFacts: pageFacts.length } : {}),
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
  if (options.removeHiddenText) {
    const cleaned = removeHiddenText(result.markdown);
    result.markdown = cleaned.text;
    result.omissions.push(...hiddenTextOmissions(cleaned.runs));
    if (result.fullPageMarkdown !== undefined) result.fullPageMarkdown = removeHiddenText(result.fullPageMarkdown).text;
    for (const [key, value] of Object.entries(result.metadata)) {
      if (typeof value === "string") result.metadata[key] = removeHiddenText(value).text;
    }
  }
  if (omissions.shadowHosts) {
    result.markdown += `\n\n_Open shadow content omitted: capture limit (${omissions.shadowHosts} host(s))._`;
  }
  result.stats.markdownChars = result.markdown.length;
  return result;
}
