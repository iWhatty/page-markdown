// Stage 3: pick the readable content. Default: Mozilla Readability on a copy
// of the standardized clone, falling back to the whole body when it finds
// nothing or too little, and to the page's main content when it keeps only a
// small share of that (forum threads, product grids), brings the site's menu
// along, or keeps too few of its sections (product pages).
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
const TOGGLE = "button, summary, [aria-expanded]";
// Shorter hidden text beside a button is a status message ("Added"), not an answer.
const MIN_ANSWER_CHARS = 40;
const MENU_SAMPLE_CHARS = 30;
// Fewer h2s than this, and a page has no sections to lose.
const MIN_SECTIONS = 3;
const SECTION_SHARE_FACTOR = 1.5;

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

// An accordion's answer, hidden until its button is pressed: FAQs on shop pages.
function isCollapsedAnswer(el) {
  return Boolean(el.previousElementSibling?.matches(TOGGLE)) && (el.textContent || "").trim().length >= MIN_ANSWER_CHARS;
}

// <main> or else the body, without navigation, other page chrome or anything
// hidden, except code behind a "Show code" toggle and collapsed answers. A header
// inside <main> usually belongs to the content; one in the body doesn't.
function mainContentRoot(doc) {
  const main = doc.querySelector(MAIN);
  const root = (main || doc.body || doc.documentElement).cloneNode(true);
  for (const el of Array.from(root.querySelectorAll(`${PAGE_CHROME}, aside, template, [role='complementary']${main ? "" : ", header"}`))) el.remove();
  for (const el of Array.from(root.querySelectorAll("[hidden], [style]"))) {
    if (isHiddenElement(el) && !el.querySelector("pre") && !isCollapsedAnswer(el)) el.remove();
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

// Readability chose a container above <main>, and the site's menu came with it.
function keptSiteMenu(doc, kept) {
  const main = doc.querySelector(MAIN);
  if (!main) return false;
  const text = withoutSpaces(main.textContent || "");
  if (!kept.includes(text.slice(text.length >> 1, (text.length >> 1) + MENU_SAMPLE_CHARS))) return false;
  return Array.from(doc.querySelectorAll("nav, [role='navigation']")).some((nav) => {
    const menu = withoutSpaces(nav.textContent || "").slice(0, MENU_SAMPLE_CHARS);
    return !main.contains(nav) && menu.length === MENU_SAMPLE_CHARS && kept.includes(menu);
  });
}

// A heading that is one link names another page, not a section of this one.
function isStoryCardTitle(h2) {
  const text = withoutSpaces(h2.textContent || "");
  return Boolean(h2.closest("a")) || Array.from(h2.querySelectorAll("a:not([href^='#'])")).some((a) => withoutSpaces(a.textContent || "") === text);
}

function lostMostSections(root, kept) {
  const headings = Array.from(root.querySelectorAll("h2")).filter((h2) => !isStoryCardTitle(h2)).map((h2) => withoutSpaces(h2.textContent || "")).filter(Boolean);
  return headings.length >= MIN_SECTIONS && headings.filter((heading) => !kept.includes(heading)).length * 2 > headings.length;
}

// Layout utilities, which say nothing about content: Tailwind's scroll-mt-2 and
// overflow-hidden, md:hidden.
const LAYOUT_CLASS = /^(?:\S+:)?(?:-?scroll-[mp][a-z]?-\S+|overflow(?:-[xy])?-(?:hidden|scroll)|(?<=:)hidden)$/;

// Readability scores class and id names, and removes what looks like clutter:
// Docusaurus's heading "anchorTargetHideOnScrollNavbar" matches "scroll", and so
// does the scroll-mt-2 on every code block of Docker's docs.
function withoutMisleadingNames(doc) {
  for (const heading of Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    heading.removeAttribute("class");
    heading.removeAttribute("id");
  }
  for (const el of Array.from(doc.querySelectorAll("[class]"))) {
    const names = String(el.getAttribute("class")).split(/\s+/);
    const kept = names.filter((name) => !LAYOUT_CLASS.test(name));
    if (kept.length < names.length) el.setAttribute("class", kept.join(" "));
  }
  // Readability removes what's aria-hidden, and icons in table cells usually are.
  for (const icon of Array.from(doc.querySelectorAll("td svg[aria-hidden], th svg[aria-hidden]"))) icon.removeAttribute("aria-hidden");
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
      const article = new Readability(withoutMisleadingNames(copyDocument(doc)), { keepClasses: true, ...options.readability }).parse();
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
    const keptText = withoutSpaces(htmlText(result.html));
    // Section loss counts only where it takes more of the page than a related-links block.
    const misses = (el) => {
      const available = el.innerHTML || "";
      return isSmall(available) || (kept < textLength(available) * share * SECTION_SHARE_FACTOR && lostMostSections(el, keptText));
    };
    const root = mainContentRoot(doc);
    const html = root.innerHTML || "";
    const reason = keptSiteMenu(doc, keptText) && textLength(html) >= minChars ? "extracted_site_menu"
      : isSmall(html) ? "extracted_small_share_of_page"
      : misses(root) ? "extracted_few_sections_of_page" : "";
    if (reason) {
      const article = reason === "extracted_site_menu" ? null : articleWithoutComments(root, result.html);
      if (article && !misses(article)) return { ...result, commentsOmitted: true };
      return { ...result, html, method: "main_content", fallbackReason: reason };
    }
  }
  return result;
}
