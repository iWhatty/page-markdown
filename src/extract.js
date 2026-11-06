// Stage 3: pick the readable content. Default: Mozilla Readability on a copy
// of the standardized clone, falling back to the whole body when it finds
// nothing or too little, and to the page's main content when it keeps only a
// small share of that (forum threads, product grids).
// The class only: skips isProbablyReaderable, which the pipeline does not use.
import Readability from "@mozilla/readability/Readability.js";
import { htmlText } from "./refine.js";

export const DEFAULT_MIN_EXTRACT_CHARS = 100;
export const DEFAULT_MIN_EXTRACT_SHARE = 0.4;
// A small share of a short page may be all there is: don't fall back for less.
const MIN_MISSED_CHARS = 500;
export const PAGE_CHROME = "nav, footer, form, [role='navigation'], [role='banner'], [role='contentinfo'], [role='search']";
const MAIN = "main, [role='main']";
const COMMENTS = "#comments, #disqus_thread, .comments, .commentlist, .comment-list, .comment, [id^='comment-']";
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;

// As far as a clone can tell, with no stylesheets. Not aria-hidden: shops put
// the price people see in it, beside a longer one for screen readers.
export function isHiddenElement(el) {
  return el.hasAttribute("hidden") || HIDDEN_STYLE.test(el.getAttribute("style") || "");
}

function textLength(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

function bodyHtml(doc) {
  return (doc.body || doc.documentElement)?.innerHTML || "";
}

// <main> or else the body, without navigation, other page chrome or anything
// hidden, except code behind a "Show code" toggle. A header inside <main> usually
// belongs to the content; one in the body doesn't.
function mainContentRoot(doc) {
  const main = doc.querySelector(MAIN);
  const root = (main || doc.body || doc.documentElement).cloneNode(true);
  for (const el of Array.from(root.querySelectorAll(`${PAGE_CHROME}, aside, template, [role='complementary']${main ? "" : ", header"}`))) el.remove();
  for (const el of Array.from(root.querySelectorAll("[hidden], [style]"))) {
    if (isHiddenElement(el) && !el.querySelector("pre")) el.remove();
  }
  for (const link of Array.from(root.querySelectorAll("a[href^='#']"))) {
    if (/^\s*skip\b/i.test(link.textContent || "")) link.remove();
  }
  return root;
}

const withoutSpaces = (text) => text.replace(/\s+/g, "");

// An article above its comments, where Readability kept the article: what's left
// without them. null for a thread, where what Readability kept is itself a comment.
function articleWithoutComments(root, articleHtml) {
  const comments = Array.from(root.querySelectorAll(COMMENTS));
  if (!comments.length) return null;
  const kept = withoutSpaces(htmlText(articleHtml));
  const sample = kept.slice(kept.length >> 1, (kept.length >> 1) + 60);
  if (comments.some((el) => withoutSpaces(el.textContent || "").includes(sample))) return null;
  for (const el of comments) el.remove();
  return root;
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
 * @typedef {{ html: string, method: "readability"|"main_content"|"full_page"|(string & {}), fallbackReason?: string, title?: string,
 *   byline?: string, published?: string, siteName?: string, lang?: string, excerpt?: string, commentsOmitted?: boolean }} Extraction
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

  // Too little from the default extractor: the page's own <main>, if it marks
  // one and it holds enough, beats a full page that opens with site navigation.
  const tooLittle = (fallbackReason, title) => {
    if (typeof mode !== "function" && doc.querySelector(MAIN)) {
      const html = mainContentRoot(doc).innerHTML || "";
      if (textLength(html) >= minChars) return { html, method: "main_content", fallbackReason, title };
    }
    return { ...full(), fallbackReason, ...(title === undefined ? {} : { title }) };
  };

  if (!result?.html) return tooLittle(failure || "extractor_found_nothing");
  if (textLength(result.html) < minChars) return tooLittle("extracted_text_below_minimum", result.title);
  if (result.method === "readability") {
    const share = options.minExtractShare ?? DEFAULT_MIN_EXTRACT_SHARE;
    const kept = textLength(result.html);
    const isSmall = (html) => {
      const available = textLength(html);
      return kept < available * share && available - kept >= MIN_MISSED_CHARS;
    };
    const root = mainContentRoot(doc);
    const html = root.innerHTML || "";
    if (isSmall(html)) {
      const article = articleWithoutComments(root, result.html);
      if (article && !isSmall(article.innerHTML || "")) return { ...result, commentsOmitted: true };
      return { ...result, html, method: "main_content", fallbackReason: "extracted_small_share_of_page" };
    }
  }
  return result;
}
