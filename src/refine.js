// Corrections after extraction, using the standardized clone and the page's
// metadata: restore a lead paragraph the extractor dropped, and choose a clean
// title heading.

const MIN_LEAD_CHARS = 40;
const MATCH_CHARS = 60;
const SEPARATORS = [" | ", " – ", " — ", " - ", " · ", " :: ", " » "];

/** Lowercase, collapse whitespace, drop a trailing ellipsis. */
function norm(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/(\.\.\.|…)\s*$/, "").trim().toLowerCase();
}

/** The text of serialized HTML: tags to spaces, the entities serializers write decoded. */
export function htmlText(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

// Tags became spaces in htmlText, so "<a>Foo</a>, the" reads "Foo , the".
const withoutSpaces = (text) => text.replace(/\s+/g, "");

function startsAlike(a, b) {
  const n = Math.min(MATCH_CHARS, a.length, b.length);
  return n >= MIN_LEAD_CHARS && a.slice(0, n) === b.slice(0, n);
}

/**
 * Many sites state their summary as both the meta description and the first
 * paragraph. Extractors can drop that paragraph when it sits in a section
 * without a heading (MDN). If the description matches a paragraph in the page
 * that the extracted HTML lacks, put that paragraph first.
 *
 * @param {string} html extracted HTML
 * @param {Document} doc standardized clone
 * @param {string} description meta description
 * @returns {{ html: string, recovered: boolean }}
 */
export function recoverLeadParagraph(html, doc, description) {
  const lead = norm(description);
  if (lead.length < MIN_LEAD_CHARS) return { html, recovered: false };
  const extracted = withoutSpaces(norm(htmlText(html)));
  const paragraphs = Array.from(doc.querySelectorAll?.("p") || []).slice(0, 300);
  for (const p of paragraphs) {
    const text = norm(p.textContent);
    if (text.length < MIN_LEAD_CHARS || !startsAlike(text, lead)) continue;
    if (extracted.includes(withoutSpaces(text.slice(0, 80)))) return { html, recovered: false };
    return { html: `${p.outerHTML}\n${html}`, recovered: true };
  }
  return { html, recovered: false };
}

function cleanHeading(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s*[¶#§]\s*$/, "")
    .trim();
}

function firstHeading(doc) {
  const scoped = doc.querySelector?.("main h1, article h1, [role='main'] h1");
  return cleanHeading((scoped || doc.querySelector?.("h1"))?.textContent);
}

// Drops site-name segments at either end: "Page | Site", "Site - Page".
function stripSiteSuffix(title, siteName) {
  let result = String(title || "").trim();
  const site = norm(siteName);
  if (!site) return result;
  const isSite = (segment) => {
    const value = norm(segment);
    return Boolean(value) && (value.includes(site) || site.includes(value));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const separator of SEPARATORS) {
      const last = result.lastIndexOf(separator);
      if (last > 0 && isSite(result.slice(last + separator.length))) {
        result = result.slice(0, last).trim();
        changed = true;
      }
      const first = result.indexOf(separator);
      if (first > 0 && isSite(result.slice(0, first))) {
        result = result.slice(first + separator.length).trim();
        changed = true;
      }
    }
  }
  return result;
}

/**
 * The heading for the capture: the page's own H1 when the document title or
 * og:title contains it (and it is not just the site name); otherwise og:title;
 * otherwise the title without a trailing site-name segment.
 *
 * @param {Document} doc standardized clone
 * @param {{ documentTitle?: string, title?: string, siteName?: string, extractedTitle?: string }} [meta]
 */
export function chooseHeadline(doc, meta = {}) {
  const h1 = firstHeading(doc);
  const titles = [meta.documentTitle, meta.title, meta.extractedTitle].map(norm).filter(Boolean);
  if (h1 && h1.length <= 200 && norm(h1) !== norm(meta.siteName) && titles.some((t) => t.includes(norm(h1)))) {
    return h1;
  }
  const og = String(meta.title || "").trim();
  if (og && og !== String(meta.documentTitle || "").trim()) return stripSiteSuffix(og, meta.siteName);
  return stripSiteSuffix(meta.extractedTitle || meta.documentTitle || og, meta.siteName);
}
