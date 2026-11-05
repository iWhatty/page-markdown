// Stage 3: pick the readable content. Default: Mozilla Readability on a copy
// of the standardized clone, falling back to the whole body when it finds
// nothing or too little, and to the page's main content when it keeps only a
// small share of that (forum threads, product grids).
// The class only: skips isProbablyReaderable, which the pipeline does not use.
import Readability from "@mozilla/readability/Readability.js";

export const DEFAULT_MIN_EXTRACT_CHARS = 100;
export const DEFAULT_MIN_EXTRACT_SHARE = 0.4;
// A small share of a short page may be all there is: don't fall back for less.
const MIN_MISSED_CHARS = 500;
export const PAGE_CHROME = "nav, footer, form, [role='navigation'], [role='banner'], [role='contentinfo'], [role='search']";

function textLength(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

function bodyHtml(doc) {
  return (doc.body || doc.documentElement)?.innerHTML || "";
}

// <main> or else the body, without navigation and other page chrome. A header
// inside <main> usually belongs to the content; one in the body doesn't.
function mainContentHtml(doc) {
  const main = doc.querySelector("main, [role='main']");
  const root = (main || doc.body || doc.documentElement).cloneNode(true);
  for (const el of Array.from(root.querySelectorAll(`${PAGE_CHROME}, aside, [role='complementary']${main ? "" : ", header"}`))) el.remove();
  for (const link of Array.from(root.querySelectorAll("a[href^='#']"))) {
    if (/^\s*skip\b/i.test(link.textContent || "")) link.remove();
  }
  return root.innerHTML || "";
}

// Readability scores class and id names, and removes headings whose names look
// like clutter: Docusaurus's "anchorTargetHideOnScrollNavbar" matches "scroll".
function withoutHeadingNames(doc) {
  for (const heading of Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    heading.removeAttribute("class");
    heading.removeAttribute("id");
  }
  return doc;
}

function copyDocument(doc) {
  const copy = doc.cloneNode(true);
  if (copy && copy.nodeType === 9 && copy.documentElement) return copy;
  // Implementations whose Document.cloneNode is shallow: reparse.
  const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser;
  return new Parser().parseFromString(doc.documentElement.outerHTML, "text/html");
}

/**
 * @typedef {{ html: string, method: "readability"|"full_page"|(string & {}), fallbackReason?: string, title?: string,
 *   byline?: string, published?: string, siteName?: string, lang?: string, excerpt?: string }} Extraction
 */

/**
 * Receives a copy of the standardized document. Returning nothing, empty HTML
 * or too little text falls back to the full page; so does throwing.
 * @typedef {(doc: Document) => Extraction|null|undefined} Extractor
 */

/**
 * @param {Document} doc standardized inert document (not mutated)
 * @param {{ extract?: "readable"|"full"|Extractor,
 *   minExtractChars?: number, minExtractShare?: number, readability?: import("./types.js").ReadabilityOptions }} [options]
 * @returns {Extraction}
 */
export function extractContent(doc, options = {}) {
  const mode = options.extract ?? "readable";
  const full = () => ({ html: bodyHtml(doc), method: "full_page" });

  if (mode === "full") return full();

  const minChars = options.minExtractChars ?? DEFAULT_MIN_EXTRACT_CHARS;
  let result = null;
  let failure = "";
  try {
    if (typeof mode === "function") {
      result = mode(copyDocument(doc));
    } else {
      const article = new Readability(withoutHeadingNames(copyDocument(doc)), { keepClasses: true, ...options.readability }).parse();
      result = article && {
        html: article.content || "",
        method: "readability",
        title: article.title || "",
        byline: article.byline || "",
        published: article.publishedTime || "",
        siteName: article.siteName || "",
        lang: article.lang || "",
        excerpt: article.excerpt || "",
      };
    }
  } catch (error) {
    failure = `extractor_error: ${/** @type {any} */ (error)?.message || error}`;
  }

  if (!result?.html) return { ...full(), fallbackReason: failure || "extractor_found_nothing" };
  if (textLength(result.html) < minChars) {
    return { ...full(), fallbackReason: "extracted_text_below_minimum", title: result.title };
  }
  if (result.method === "readability") {
    const html = mainContentHtml(doc);
    const kept = textLength(result.html);
    const available = textLength(html);
    if (kept < available * (options.minExtractShare ?? DEFAULT_MIN_EXTRACT_SHARE) && available - kept >= MIN_MISSED_CHARS) {
      return { ...result, html, method: "main_content", fallbackReason: "extracted_small_share_of_page" };
    }
  }
  return result;
}
