// Stage 2: normalise markup on the inert clone so extraction and conversion
// see consistent structure. Runs before extraction.

const LAZY_SRC_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-lazy", "data-url"];
const LANGUAGE_CLASS = [
  /(?:^|\s)(?:language|lang)-([\w+#.-]+)/i,
  /(?:^|\s)highlight-(?:source-)?([\w+#.-]+)/i,
  /(?:^|\s)mw-highlight-lang-([\w+#.-]+)/i,
  /(?:^|\s)brush:\s*([\w+#.-]+)/i,
];
// Only normalise names that are clearly the same language; keep site names otherwise.
const LANGUAGE_ALIASES = { python3: "python", py3: "python" };
const NON_LANGUAGES = new Set(["default", "none", "text", "plain", "plaintext", "nohighlight", "notranslate"]);
// Wrappers sites put around a heading next to "edit" or permalink widgets.
const EDIT_WIDGETS = ".mw-editsection, .headerlink, .anchor, .heading-anchor, a.anchor, [aria-hidden='true'] a";
// Content without text that a heading wrapper may still hold.
const MEDIA = "img, picture, video, audio";

function resolveUrl(value, base) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("#") || /^(mailto|tel|data):/i.test(raw)) return raw;
  try {
    return base ? new URL(raw, base).href : raw;
  } catch {
    return raw;
  }
}

function languageFrom(el, maxDepth = 3) {
  for (let node = el, depth = 0; node && node.nodeType === 1 && depth <= maxDepth; node = node.parentElement, depth += 1) {
    const cls = node.getAttribute?.("class") || "";
    for (const pattern of LANGUAGE_CLASS) {
      const match = cls.match(pattern);
      if (match) {
        const lang = match[1].toLowerCase();
        if (!NON_LANGUAGES.has(lang)) return LANGUAGE_ALIASES[lang] || lang;
      }
    }
    const dataLang = node.getAttribute?.("data-lang") || node.getAttribute?.("data-language");
    if (dataLang && !NON_LANGUAGES.has(dataLang.toLowerCase())) return dataLang.toLowerCase();
  }
  return "";
}

function hasMeaningfulContent(el) {
  if ((el.textContent || "").trim()) return true;
  return Boolean(el.querySelector?.("img[alt]:not([alt='']), svg title"));
}

/**
 * Lazy images: copy a lazy-load attribute into src when src is missing or a
 * data: placeholder. Then drop images that are still inline data.
 */
function standardizeImages(doc, base, stats) {
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) {
      const lazy = LAZY_SRC_ATTRS.map((attr) => img.getAttribute(attr)).find((v) => v && !v.startsWith("data:"));
      if (lazy) {
        img.setAttribute("src", lazy);
        stats.lazyImagesResolved += 1;
      }
    }
    const current = img.getAttribute("src") || "";
    if (!current || current.startsWith("data:")) {
      img.remove();
      stats.inlineImagesDropped += 1;
      continue;
    }
    img.setAttribute("src", resolveUrl(current, base));
  }
}

function standardizeLinks(doc, base, stats) {
  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const href = a.getAttribute("href") || "";
    if (/^\s*javascript:/i.test(href)) {
      a.replaceWith(...Array.from(a.childNodes));
      stats.scriptLinksUnwrapped += 1;
      continue;
    }
    if (!hasMeaningfulContent(a)) {
      a.remove();
      stats.emptyLinksRemoved += 1;
      continue;
    }
    if (href) a.setAttribute("href", resolveUrl(href, base));
  }
}

/** <pre> without <code> (and code without a language) gets a language-tagged <code>. */
function standardizeCode(doc, stats) {
  for (const pre of Array.from(doc.querySelectorAll("pre"))) {
    const lang = languageFrom(pre);
    let code = Array.from(pre.children || []).length === 1 && pre.firstElementChild?.localName === "code"
      ? pre.firstElementChild
      : null;
    if (!code) {
      code = doc.createElement("code");
      code.textContent = pre.textContent || "";
      while (pre.firstChild) pre.removeChild(pre.firstChild);
      pre.appendChild(code);
      stats.preWrapped += 1;
    }
    if (lang && !/(?:^|\s)language-/.test(code.getAttribute("class") || "")) {
      code.setAttribute("class", `${code.getAttribute("class") || ""} language-${lang}`.trim());
    }
  }
}

/**
 * Headings wrapped with edit/permalink widgets (Wikipedia's div.mw-heading,
 * Sphinx headerlinks): drop the widgets, then replace a wrapper whose only
 * remaining element is the heading with the heading itself.
 */
function standardizeHeadings(doc, stats) {
  for (const widget of Array.from(doc.querySelectorAll(EDIT_WIDGETS))) {
    if (!(widget.textContent || "").trim() || widget.matches?.(".mw-editsection")) {
      widget.remove();
      stats.headingWidgetsRemoved += 1;
    }
  }
  for (const heading of Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    const parent = heading.parentElement;
    if (!parent || parent.localName !== "div") continue;
    const others = Array.from(parent.children).filter((el) => el !== heading);
    if (others.every((el) => !(el.textContent || "").trim() && !el.matches?.(MEDIA) && !el.querySelector?.(MEDIA))) {
      parent.replaceWith(heading);
      stats.headingsUnwrapped += 1;
    }
  }
}

/**
 * @param {Document} doc the inert clone (mutated in place)
 * @param {{ url?: string }} [options]
 */
export function standardizeDocument(doc, options = {}) {
  const base = options.url || "";
  const stats = {
    lazyImagesResolved: 0,
    inlineImagesDropped: 0,
    scriptLinksUnwrapped: 0,
    emptyLinksRemoved: 0,
    preWrapped: 0,
    headingWidgetsRemoved: 0,
    headingsUnwrapped: 0,
  };
  standardizeHeadings(doc, stats);
  standardizeCode(doc, stats);
  standardizeImages(doc, base, stats);
  standardizeLinks(doc, base, stats);
  return stats;
}
