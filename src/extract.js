// Stage 3: pick the readable content. Default: Mozilla Readability on a copy
// of the standardized clone, falling back to the whole body when it finds
// nothing or too little.
// The class only: skips isProbablyReaderable, which the pipeline does not use.
import Readability from "@mozilla/readability/Readability.js";

export const DEFAULT_MIN_EXTRACT_CHARS = 100;

function textLength(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

function bodyHtml(doc) {
  return (doc.body || doc.documentElement)?.innerHTML || "";
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
 *   minExtractChars?: number, readability?: import("./types.js").ReadabilityOptions }} [options]
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
      const article = new Readability(copyDocument(doc), { keepClasses: true, ...options.readability }).parse();
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
  return result;
}
