// Short label/value facts the extractor left out: package sidebars (version,
// license, downloads), price and spec boxes, definition lists, two-column
// tables. Readability keeps the article and drops these asides, which is right
// for reading and wrong when the question is "which version?". Opt-in.

const MAX_FACTS = 24;
const MAX_LABEL_CHARS = 40;
const MAX_VALUE_CHARS = 100;
const CHROME = "nav, footer, header, form, [role='navigation'], [role='contentinfo'], [role='banner'], [role='search']";

function squash(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// A sentence is prose, not a fact: "Returns a signal that aborts later."
function isSentence(text) {
  return /[.!?]$/.test(text) && text.split(" ").length >= 4;
}

function shortValue(el) {
  if (!el || el.querySelector("h1, h2, h3, h4, h5, h6, table, pre")) return "";
  // A list of links is navigation, not a fact.
  const links = el.tagName === "A" ? [el] : el.querySelectorAll("a");
  if (links.length > 1) return "";
  const text = squash(el.textContent);
  // So is a lone link, unless its text is data: a domain, path or number.
  if (links.length === 1 && squash(links[0].textContent) === text && !/[\d./@]/.test(text)) return "";
  return text.length <= MAX_VALUE_CHARS && !isSentence(text) ? text : "";
}

function* candidatePairs(doc) {
  // Heading followed by a short value: <h3>Version</h3><p>1.2.3</p>.
  for (const h of doc.querySelectorAll("h2, h3, h4, h5, h6")) {
    yield [h.textContent, shortValue(h.nextElementSibling), h];
  }
  for (const dt of doc.querySelectorAll("dt")) {
    const dd = dt.nextElementSibling;
    if (dd?.tagName === "DD") yield [dt.textContent, shortValue(dd), dt];
  }
  // Two-cell rows: | Label | Value |.
  for (const row of doc.querySelectorAll("tr")) {
    const cells = Array.from(row.children).filter((c) => c.tagName === "TH" || c.tagName === "TD");
    if (cells.length === 2) yield [cells[0].textContent, shortValue(cells[1]), row];
  }
}

// "1.0.1 December 17, 2004 [5]" and "1.0.1December 17, 2004" compare equal.
function compact(text) {
  return text.replace(/\[\d+\]/g, "").replace(/\s+/g, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {Document} doc standardized clone
 * @param {string} articleHtml the extracted article
 * @returns {Array<{ label: string, value: string }>} facts absent from the article
 */
export function collectPageFacts(doc, articleHtml) {
  const article = squash(String(articleHtml || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  const articleCompact = compact(article);
  const pairs = Array.from(candidatePairs(doc), ([label, value, el]) => [squash(label).replace(/\s*[:：¶#§]\s*$/, ""), value, el]);
  // A "value" that is the next section's label is a heading run, not a fact.
  const labels = new Set(pairs.map(([label]) => label));
  const facts = [];
  const seen = new Set();
  for (const [label, value, el] of pairs) {
    if (!label || !value || label.length > MAX_LABEL_CHARS || label === value || labels.has(value)) continue;
    if (el.closest(CHROME)) continue;
    const key = `${label}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Already in the article: short values as a whole word, longer ones
    // ignoring spacing and citation marks.
    const bare = compact(value);
    if (bare.length >= 6 ? articleCompact.includes(bare)
      : new RegExp(`(^|[^\\w])${escapeRegExp(value)}($|[^\\w])`).test(article)) continue;
    facts.push({ label, value });
    if (facts.length >= MAX_FACTS) break;
  }
  return facts;
}

function escapeMarkdown(text) {
  return text.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

/** "## Page facts" list, or "" when there are none. */
export function pageFactsMarkdown(facts) {
  if (!facts.length) return "";
  const lines = facts.map(({ label, value }) => `- ${escapeMarkdown(label)}: ${escapeMarkdown(value)}`);
  return `## Page facts\n\n${lines.join("\n")}`;
}
