// Page metadata from the original document (read-only): meta tags, JSON-LD,
// canonical link and language. The sanitized clone has no <meta> or scripts.

function clean(value, limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function meta(doc, selectors) {
  for (const selector of selectors) {
    const value = doc.querySelector?.(selector)?.getAttribute?.("content");
    if (value && value.trim()) return clean(value);
  }
  return "";
}

function absolute(value, base) {
  const raw = clean(value, 2000);
  if (!raw) return "";
  try {
    return base ? new URL(raw, base).href : raw;
  } catch {
    return raw;
  }
}

function jsonLdNodes(doc) {
  const nodes = [];
  for (const script of Array.from(doc.querySelectorAll?.('script[type="application/ld+json"]') || [])) {
    try {
      const data = JSON.parse(script.textContent || "");
      const queue = Array.isArray(data) ? [...data] : [data];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        nodes.push(node);
        if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      }
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  }
  return nodes;
}

function nameOf(value) {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(", ");
  return clean(value.name || "");
}

const ARTICLE_TYPES = /Article|BlogPosting|NewsArticle|Report|TechArticle|WebPage|ScholarlyArticle/i;

/**
 * @param {Document} doc the original page document
 * @param {{ url?: string }} [options]
 */
export function collectMetadata(doc, options = {}) {
  const url = options.url || doc.URL || doc.location?.href || "";
  const ld = jsonLdNodes(doc);
  const article = ld.find((node) => ARTICLE_TYPES.test(String(node["@type"] || ""))) || {};
  const canonicalHref = doc.querySelector?.("link[rel='canonical']")?.getAttribute?.("href") || "";
  let hostname = "";
  try { hostname = url ? new URL(url).hostname : ""; } catch { /* keep empty */ }

  return {
    url,
    canonicalUrl: absolute(canonicalHref, url) || url,
    documentTitle: clean(doc.title || doc.querySelector?.("title")?.textContent || ""),
    title: meta(doc, ["meta[property='og:title']", "meta[name='twitter:title']"]) || clean(article.headline || "") || clean(doc.title || ""),
    description: meta(doc, ["meta[name='description']", "meta[property='og:description']", "meta[name='twitter:description']"]),
    author: meta(doc, ["meta[name='author']", "meta[property='article:author']", "meta[name='byl']"]) || nameOf(article.author),
    published: meta(doc, ["meta[property='article:published_time']", "meta[name='date']", "meta[itemprop='datePublished']"]) || clean(article.datePublished || ""),
    modified: meta(doc, ["meta[property='article:modified_time']", "meta[itemprop='dateModified']", "meta[name='last-modified']"]) || clean(article.dateModified || ""),
    siteName: meta(doc, ["meta[property='og:site_name']", "meta[name='application-name']"]) || nameOf(article.publisher) || hostname,
    lang: clean(doc.documentElement?.getAttribute?.("lang") || "", 40),
  };
}
