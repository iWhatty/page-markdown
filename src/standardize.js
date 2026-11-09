// Stage 2: normalise markup on the inert clone so extraction and conversion
// see consistent structure. Runs before extraction.
import { isHiddenElement } from "./extract.js";

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
// Removed whatever their text: "edit", "Section titled ...", a zero-width space.
const ALWAYS_REMOVED_WIDGETS = ".mw-editsection, .hash-link, .sl-anchor-link";
const EDIT_WIDGETS = `${ALWAYS_REMOVED_WIDGETS}, .headerlink, .anchor, .heading-anchor, a.anchor, [aria-hidden='true'] a`;
// Content without text that a heading wrapper may still hold.
const MEDIA = "img, picture, video, audio";
// Highlighters mark up each code line with one of these.
const CODE_LINE_ELEMENTS = new Set(["div", "p", "li", "tr", "section"]);
const TAB_PANELS = "[role='tabpanel'], sp-tab-panel, sl-tab-panel";
const TABS = "[role='tab'], sp-tab, sl-tab";
// Longer than this, an inactive panel is a page of its own (an API or change log
// tab), not a variant of the one shown (pnpm, Yarn).
const MAX_INACTIVE_PANEL_CHARS = 5000;
const MAX_TAB_LABEL_CHARS = 40;
// Asides that are part of the text: notes and warnings. Readability drops every <aside>.
const NOTE_ASIDE = /(?:^|[\s_-])(?:aside|admonition|callout|note|tip|caution|warning|danger)(?:$|[\s_-])/i;
const OTHER_ASIDE = /related|sidebar|share|promo|newsletter|toc\b/i;
// As URL parsers read a scheme: control characters and spaces don't count.
const isUnsafeUrl = (value) => /^(?:javascript|vbscript|data):/i.test(String(value).replace(/[\x00-\x20]+/g, ""));

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
  return Boolean(el.querySelector?.("img, svg title"));
}

/**
 * Lazy images: copy a lazy-load attribute into src when src is missing or a
 * data: placeholder. Then drop images that are still inline data.
 */
function standardizeImages(doc, base, stats) {
  const squash = (text) => (text || "").replace(/\s+/g, " ").trim();
  for (const element of doc.querySelectorAll("figcaption, .caption")) {
    const caption = squash(element.textContent);
    if (!caption || element.closest(".pswp-caption-content") || isHiddenElement(element)) continue;
    const figure = element.closest("figure");
    // PhotoSwipe's copy is hidden by CSS; galleries may have only that copy.
    for (const copy of (figure || element.parentElement?.parentElement)?.querySelectorAll(".pswp-caption-content") || []) {
      if (squash(copy.textContent) === caption) copy.remove();
    }
    for (const img of figure?.querySelectorAll("img") || []) {
      for (const attr of ["alt", "title"]) {
        if (squash(img.getAttribute(attr)) === caption) img.removeAttribute(attr);
      }
    }
  }
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
    if (!current || isUnsafeUrl(current)) {
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
    if (isUnsafeUrl(href)) {
      a.replaceWith(...Array.from(a.childNodes));
      stats.scriptLinksUnwrapped += 1;
      continue;
    }
    if (!hasMeaningfulContent(a)) {
      a.remove();
      stats.emptyLinksRemoved += 1;
      continue;
    }
    if (base && href) {
      try {
        new URL(href, base);
      } catch {
        a.replaceWith(...Array.from(a.childNodes));
        stats.invalidLinksUnwrapped += 1;
        continue;
      }
    }
    if (href) a.setAttribute("href", resolveUrl(href, base));
  }
}

/** Text of a code block, with <br> and block-level lines as line breaks. */
function codeText(root) {
  let text = "";
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) text += child.nodeValue;
      else if (child.nodeType !== 1) continue;
      else if (child.localName === "br") text += "\n";
      else {
        const block = CODE_LINE_ELEMENTS.has(child.localName);
        if (block && text && !text.endsWith("\n")) text += "\n";
        walk(child);
        if (block && text && !text.endsWith("\n")) text += "\n";
      }
    }
  };
  walk(root);
  return text;
}

/** <pre> without <code> (and code without a language) gets a language-tagged <code>. */
function standardizeCode(doc, stats) {
  for (const pre of Array.from(doc.querySelectorAll("pre"))) {
    for (const button of Array.from(pre.querySelectorAll("button"))) button.remove();
    const inner = pre.querySelector("code");
    const lang = languageFrom(inner || pre, inner ? 4 : 3);
    // One <code> and only whitespace around it: that <code> is the block.
    const sole = pre.children.length === 1 && pre.firstElementChild === inner
      && !(pre.textContent || "").replace(inner.textContent || "", "").trim();
    const code = sole ? inner : doc.createElement("code");
    if (!sole) stats.preWrapped += 1;
    // Turndown reads textContent, so lines kept apart by markup become text.
    code.textContent = codeText(sole ? inner : pre);
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    pre.appendChild(code);
    if (lang && !/(?:^|\s)language-/.test(code.getAttribute("class") || "")) {
      code.setAttribute("class", `${code.getAttribute("class") || ""} language-${lang}`.trim());
    }
  }
}

/**
 * A link to the heading's own id, inside it or right beside it, is a permalink
 * whatever its class or wording ("Link to ...", "Section titled ...", "#"). A
 * heading whose whole text is that link keeps the text. Left in place, the link
 * makes a short heading's wrapper look like clutter to Readability.
 */
function removeOwnPermalinks(heading, stats) {
  const id = heading.getAttribute("id");
  if (!id) return;
  const title = (heading.textContent || "").trim();
  const inside = Array.from(heading.querySelectorAll("[href]"));
  for (const link of [...inside, heading.previousElementSibling, heading.nextElementSibling]) {
    if (link?.getAttribute("href") !== `#${id}`) continue;
    if (inside.includes(link) && (link.textContent || "").trim() === title) link.replaceWith(...Array.from(link.childNodes));
    else link.remove();
    stats.headingWidgetsRemoved += 1;
  }
}

/**
 * Headings wrapped with edit/permalink widgets (Wikipedia's div.mw-heading,
 * Sphinx headerlinks): drop the widgets, then replace a wrapper whose only
 * remaining element is the heading with the heading itself.
 */
function standardizeHeadings(doc, stats) {
  // An upper-deck kicker belongs with the title, not ordinary body prose.
  for (const label of doc.querySelectorAll(".upper-deck__text")) {
    label.innerHTML = `<strong>${label.innerHTML}</strong>`;
  }
  for (const widget of Array.from(doc.querySelectorAll(EDIT_WIDGETS))) {
    if (!(widget.textContent || "").trim() || widget.matches?.(ALWAYS_REMOVED_WIDGETS)) {
      widget.remove();
      stats.headingWidgetsRemoved += 1;
    }
  }
  for (const heading of Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    removeOwnPermalinks(heading, stats);
    const parent = heading.parentElement;
    if (!parent || parent.localName !== "div") continue;
    const others = Array.from(parent.children).filter((el) => el !== heading);
    const hasBareText = Array.from(parent.childNodes).some((node) => node.nodeType === 3 && node.nodeValue.trim());
    if (!hasBareText && others.every((el) => !(el.textContent || "").trim() && !el.matches?.(MEDIA) && !el.querySelector?.(MEDIA))) {
      parent.replaceWith(heading);
      stats.headingsUnwrapped += 1;
    }
  }
}

function isInactivePanel(panel) {
  if (isHiddenElement(panel) || panel.getAttribute("aria-hidden") === "true" || panel.classList.contains("hidden")) return true;
  // Custom elements that mark only the group: <sp-tabs selected="overview">.
  const value = panel.getAttribute("value");
  const selected = value && panel.parentElement?.closest("[selected]")?.getAttribute("selected");
  return Boolean(selected) && selected !== value;
}

function tabOf(panel, tabs) {
  const id = panel.getAttribute("id");
  const labelledBy = panel.getAttribute("aria-labelledby");
  const value = panel.getAttribute("value") || panel.getAttribute("name");
  const named = tabs.find((tab) => (labelledBy && tab.getAttribute("id") === labelledBy)
    || (id && (tab.getAttribute("aria-controls") === id || tab.getAttribute("href") === `#${id}`))
    || (value && (tab.getAttribute("value") === value || tab.getAttribute("panel") === value)));
  if (named) return named;
  // Docusaurus ties them by position alone.
  const parent = panel.parentElement;
  const index = Array.from(parent?.children || []).filter((el) => el.matches?.(TAB_PANELS)).indexOf(panel);
  for (let node = parent, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
    const list = node.querySelector("[role='tablist']");
    if (list) return list.querySelectorAll("[role='tab']")[index];
  }
  return null;
}

/**
 * Tabs read as one document: inactive panels are shown, each under its tab's
 * name, in place of a tab strip that points nowhere. A long inactive panel is
 * left out, and named in stats.omittedTabs.
 */
function standardizeTabPanels(doc, stats) {
  // Docker's docs write aria-role, and call a panel a tab: only the strip's is right.
  for (const list of Array.from(doc.querySelectorAll("[aria-role='tablist']"))) {
    list.setAttribute("role", "tablist");
    for (const tab of Array.from(list.children)) tab.setAttribute("role", "tab");
    for (const panel of Array.from(list.nextElementSibling?.children || [])) panel.setAttribute("role", "tabpanel");
  }
  const panels = Array.from(doc.querySelectorAll(TAB_PANELS));
  if (!panels.length) return;
  const tabs = Array.from(doc.querySelectorAll(TABS));
  for (const panel of panels) {
    const label = (tabOf(panel, tabs)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TAB_LABEL_CHARS);
    const text = (panel.textContent || "").replace(/\s+/g, " ").trim();
    if (isInactivePanel(panel)) {
      if (text.length > MAX_INACTIVE_PANEL_CHARS) {
        stats.omittedTabs.push(label);
        panel.remove();
        continue;
      }
      for (const attr of ["hidden", "aria-hidden", "style"]) panel.removeAttribute(attr);
      panel.classList.remove("hidden");
    }
    if (label && panels.length > 1 && !text.toLowerCase().startsWith(label.toLowerCase())) {
      const heading = doc.createElement("p");
      heading.appendChild(doc.createElement("strong")).textContent = label;
      panel.insertBefore(heading, panel.firstChild);
    }
  }
  for (const el of Array.from(doc.querySelectorAll(`[role='tablist'], ${TABS}`))) el.remove();
}

function standardizeAsides(doc) {
  for (const aside of Array.from(doc.querySelectorAll("main aside, article aside, [role='main'] aside"))) {
    const name = `${aside.getAttribute("class") || ""} ${aside.getAttribute("aria-label") || ""} ${aside.getAttribute("role") || ""}`;
    if (!NOTE_ASIDE.test(name) || OTHER_ASIDE.test(name)) continue;
    const quote = doc.createElement("blockquote");
    quote.append(...Array.from(aside.childNodes));
    aside.replaceWith(quote);
  }
  // Readability treats "header" as clutter, even when it labels a warning.
  for (const header of Array.from(doc.querySelectorAll("blockquote .admonition-header"))) {
    const p = doc.createElement("p");
    const strong = doc.createElement("strong");
    strong.append(...Array.from(header.childNodes));
    p.append(strong);
    header.replaceWith(p);
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
    invalidLinksUnwrapped: 0,
    emptyLinksRemoved: 0,
    preWrapped: 0,
    headingWidgetsRemoved: 0,
    headingsUnwrapped: 0,
    omittedTabs: /** @type {string[]} */ ([]),
  };
  standardizeTabPanels(doc, stats);
  standardizeAsides(doc);
  standardizeHeadings(doc, stats);
  standardizeCode(doc, stats);
  standardizeImages(doc, base, stats);
  standardizeLinks(doc, base, stats);
  return stats;
}
