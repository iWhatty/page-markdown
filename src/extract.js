import { DOM_GET_ATTRIBUTE, DOM_SET_ATTRIBUTE, DOM_HAS_ATTRIBUTE, DOM_REMOVE_ATTRIBUTE, DOM_QUERY_SELECTOR, DOM_QUERY_SELECTOR_ALL, DOM_TEXT_CONTENT, DOM_DOCUMENT_ELEMENT, DOM_FIRST_ELEMENT_CHILD, DOM_INNER_HTML } from "./dom.js";
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
  return el[DOM_HAS_ATTRIBUTE]("hidden") || HIDDEN_STYLE.test(el[DOM_GET_ATTRIBUTE]("style") || "");
}

function textLength(html = "") {
  return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length;
}

function bodyHtml(doc, trial) {
  if (trial) trial.select(doc.body || doc[DOM_DOCUMENT_ELEMENT]);
  return (doc.body || doc[DOM_DOCUMENT_ELEMENT])?.[DOM_INNER_HTML] || "";
}

// An accordion's answer, hidden until its button is pressed: FAQs on shop pages.
export function isCollapsedAnswer(el) {
  return Boolean(el.previousElementSibling?.matches(TOGGLE)) && (el[DOM_TEXT_CONTENT] || "").trim().length >= MIN_ANSWER_CHARS;
}

// <main> or else the body, without navigation, other page chrome or anything
// hidden, except code behind a "Show code" toggle and collapsed answers. A header
// inside <main> usually belongs to the content; one in the body doesn't.
function mainContentRoot(doc) {
  const main = doc[DOM_QUERY_SELECTOR](MAIN);
  const root = (main || doc.body || doc[DOM_DOCUMENT_ELEMENT]).cloneNode(true);
  for (const el of Array.from(root[DOM_QUERY_SELECTOR_ALL](`${PAGE_CHROME}, aside, template, [role='complementary']${main ? "" : ", header"}`))) el.remove();
  for (const el of Array.from(root[DOM_QUERY_SELECTOR_ALL]("[hidden], [style]"))) {
    if (isHiddenElement(el) && !el[DOM_QUERY_SELECTOR]("pre") && !isCollapsedAnswer(el)) el.remove();
  }
  for (const link of Array.from(root[DOM_QUERY_SELECTOR_ALL]("a[href^='#']"))) {
    if (/^\s*skip\b/i.test(link[DOM_TEXT_CONTENT] || "")) link.remove();
  }
  return removeSkippableBoxes(root);
}

const withoutSpaces = (text) => text.replace(/\s+/g, "");

// Embedded posts and media sit in a skippable box too, and are part of the text.
const SKIP_KEPT = "blockquote, iframe, video, audio, pre, table, h1";
const MAX_END_MARKER_CHARS = 60;
const MAX_SKIPPED_SHARE = 0.25;

// "Skip Most read and continue reading": a box that opens with a link to the end
// marker it closes with. The page itself says it interrupts the text (BBC's
// most-read and podcast boxes), in whatever language.
function removeSkippableBoxes(root) {
  const links = Array.from(root[DOM_QUERY_SELECTOR_ALL]("a[href^='#']"));
  if (!links.length) return root;
  const size = (el) => withoutSpaces(el[DOM_TEXT_CONTENT] || "");
  // One pass for the targets, and each box's text read once: a long article has
  // thousands of footnote links, all inside the same few boxes.
  const ends = new Map();
  for (const el of Array.from(root[DOM_QUERY_SELECTOR_ALL]("[id]"))) {
    if (!ends.has(el[DOM_GET_ATTRIBUTE]("id"))) ends.set(el[DOM_GET_ATTRIBUTE]("id"), el);
  }
  let texts = new Map();
  let total = -1;
  for (const link of links) {
    const id = link[DOM_GET_ATTRIBUTE]("href").slice(1);
    const end = id && ends.get(id);
    if (!end || end.contains(link) || !root.contains(link) || !root.contains(end)) continue;
    const label = size(link);
    const marker = size(end);
    if (!label || !marker || marker.length > MAX_END_MARKER_CHARS) continue;
    let box = link.parentElement;
    while (box && box !== root && !box.contains(end)) box = box.parentElement;
    if (!box || box === root || box.matches("main, article, body")) continue;
    if (!texts.has(box)) texts.set(box, size(box));
    const text = texts.get(box);
    if (text.length <= label.length + marker.length || !text.startsWith(label) || !text.endsWith(marker)) continue;
    if (total < 0) total = size(root).length;
    if (text.length <= total * MAX_SKIPPED_SHARE && !box[DOM_QUERY_SELECTOR](SKIP_KEPT)) {
      box.remove();
      texts = new Map();
    }
  }
  return root;
}

// An article above its comments, where Readability kept the article: what's left
// without them. null for a thread, where what Readability kept is itself a comment.
function articleWithoutComments(root, articleHtml) {
  const comments = Array.from(root[DOM_QUERY_SELECTOR_ALL](COMMENTS));
  if (!comments.length) return null;
  const kept = withoutSpaces(htmlText(articleHtml));
  const sample = kept.slice(kept.length >> 1, (kept.length >> 1) + 60);
  if (comments.some((el) => withoutSpaces(el[DOM_TEXT_CONTENT] || "").includes(sample))) return null;
  for (const el of comments) el.remove();
  return root;
}

// Readability chose a container above <main>, and the site's menu came with it.
function keptSiteMenu(doc, kept) {
  const main = doc[DOM_QUERY_SELECTOR](MAIN);
  if (!main) return false;
  const text = withoutSpaces(main[DOM_TEXT_CONTENT] || "");
  if (!kept.includes(text.slice(text.length >> 1, (text.length >> 1) + MENU_SAMPLE_CHARS))) return false;
  return Array.from(doc[DOM_QUERY_SELECTOR_ALL]("nav, [role='navigation']")).some((nav) => {
    const menu = withoutSpaces(nav[DOM_TEXT_CONTENT] || "").slice(0, MENU_SAMPLE_CHARS);
    return !main.contains(nav) && menu.length === MENU_SAMPLE_CHARS && kept.includes(menu);
  });
}

// A heading that is one link names another page, not a section of this one.
function isStoryCardTitle(h2) {
  const text = withoutSpaces(h2[DOM_TEXT_CONTENT] || "");
  return Boolean(h2.closest("a")) || Array.from(h2[DOM_QUERY_SELECTOR_ALL]("a:not([href^='#'])")).some((a) => withoutSpaces(a[DOM_TEXT_CONTENT] || "") === text);
}

function lostMostSections(root, kept) {
  const headings = Array.from(root[DOM_QUERY_SELECTOR_ALL]("h2")).filter((h2) => !isStoryCardTitle(h2)).map((h2) => withoutSpaces(h2[DOM_TEXT_CONTENT] || "")).filter(Boolean);
  return headings.length >= MIN_SECTIONS && headings.filter((heading) => !kept.includes(heading)).length * 2 > headings.length;
}

// Layout utilities, which say nothing about content: Tailwind's scroll-mt-2 and
// overflow-hidden, md:hidden.
const LAYOUT_CLASS = /^(?:\S+:)?(?:-?scroll-[mp][a-z]?-\S+|overflow(?:-[xy])?-(?:hidden|scroll)|(?<=:)hidden)$/;

// Readability scores class and id names, and removes what looks like clutter:
// Docusaurus's heading "anchorTargetHideOnScrollNavbar" matches "scroll", and so
// does the scroll-mt-2 on every code block of Docker's docs.
function withoutMisleadingNames(doc) {
  // Single-paragraph FAQ wrappers can fail Readability's link-density check.
  for (const el of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("details div")).reverse()) {
    const p = el[DOM_FIRST_ELEMENT_CHILD];
    if (p?.localName === "p" && el.children.length === 1 && el[DOM_TEXT_CONTENT] === p[DOM_TEXT_CONTENT]
      && !isHiddenElement(el) && el[DOM_GET_ATTRIBUTE]("aria-hidden") !== "true") el.replaceWith(...Array.from(el.childNodes));
  }
  for (const heading of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("h1, h2, h3, h4, h5, h6"))) {
    heading[DOM_REMOVE_ATTRIBUTE]("class");
    heading[DOM_REMOVE_ATTRIBUTE]("id");
  }
  for (const el of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("[class]"))) {
    const names = String(el[DOM_GET_ATTRIBUTE]("class")).split(/\s+/);
    const kept = names.filter((name) => !LAYOUT_CLASS.test(name));
    if (kept.length < names.length) el[DOM_SET_ATTRIBUTE]("class", kept.join(" "));
  }
  // Readability removes what's aria-hidden, and icons in table cells usually are.
  for (const icon of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("td svg[aria-hidden], th svg[aria-hidden]"))) icon[DOM_REMOVE_ATTRIBUTE]("aria-hidden");
  if (doc.body) removeSkippableBoxes(doc.body);
  return doc;
}

function copyDocument(doc) {
  const copy = doc.cloneNode(true);
  if (copy && copy.nodeType === 9 && copy[DOM_DOCUMENT_ELEMENT]) return copy;
  // Implementations whose Document.cloneNode is shallow: reparse.
  const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser;
  return new Parser().parseFromString(doc[DOM_DOCUMENT_ELEMENT].outerHTML, "text/html");
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
 *   minExtractChars?: number, minExtractShare?: number, readability?: import("./types.js").ReadabilityOptions,
 *   trial?: import('./trial.js').Trial|null }} [options]
 * @returns {Extraction}
 */
export function extractContent(doc, options = {}) {
  const mode = options.extract ?? "readable";
  const full = () => ({ html: bodyHtml(doc, options.trial), method: "full_page" });

  if (mode === "full") return full();

  const minChars = options.minExtractChars ?? DEFAULT_MIN_EXTRACT_CHARS;
  let result = null;
  let failure = "";
  try {
    if (typeof mode === "function") {
      const copy = copyDocument(doc);
      if (options.trial) options.trial.clean(copy);
      result = mode(copy);
    } else {
      const readability = { keepClasses: true, ...options.readability };
      if (options.trial) {
        const trial = options.trial;
        const serialize = readability.serializer;
        readability.serializer = el => {
          trial.select(el);
          return serialize ? serialize(el) : /** @type {Element} */ (el)[DOM_INNER_HTML];
        };
      }
      const Reader = options.trial ? options.trial.Reader : Readability;
      const article = new Reader(withoutMisleadingNames(copyDocument(doc)), readability).parse();
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
    if (typeof mode !== "function" && doc[DOM_QUERY_SELECTOR](MAIN)) {
      const root = mainContentRoot(doc);
      if (options.trial) options.trial.select(root);
      const html = root[DOM_INNER_HTML] || "";
      if (textLength(html) >= minChars) {
        return { html, method: "main_content", fallbackReason, title };
      }
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
      const available = el[DOM_INNER_HTML] || "";
      return isSmall(available) || (kept < textLength(available) * share * SECTION_SHARE_FACTOR && lostMostSections(el, keptText));
    };
    const root = mainContentRoot(doc);
    if (options.trial) options.trial.select(root);
    const html = root[DOM_INNER_HTML] || "";
    const reason = keptSiteMenu(doc, keptText) && textLength(html) >= minChars ? "extracted_site_menu"
      : isSmall(html) ? "extracted_small_share_of_page"
      : misses(root) ? "extracted_few_sections_of_page" : "";
    if (reason) {
      const article = reason === "extracted_site_menu" ? null : articleWithoutComments(root, result.html);
      if (article && !misses(article)) {
        if (options.trial) options.trial.restoreSelection();
        return { ...result, commentsOmitted: true };
      }
      return { ...result, html, method: "main_content", fallbackReason: reason };
    }
    if (options.trial) options.trial.restoreSelection();
  }
  return result;
}
