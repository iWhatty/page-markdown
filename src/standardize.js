import { DOM_GET_ATTRIBUTE, DOM_SET_ATTRIBUTE, DOM_REMOVE_ATTRIBUTE, DOM_QUERY_SELECTOR, DOM_QUERY_SELECTOR_ALL, DOM_TEXT_CONTENT, DOM_FIRST_ELEMENT_CHILD, DOM_INNER_HTML, DOM_CREATE_ELEMENT } from "./dom.js";
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
    const cls = node[DOM_GET_ATTRIBUTE]?.("class") || "";
    for (const pattern of LANGUAGE_CLASS) {
      const match = cls.match(pattern);
      if (match) {
        const lang = match[1].toLowerCase();
        if (!NON_LANGUAGES.has(lang)) return LANGUAGE_ALIASES[lang] || lang;
      }
    }
    const dataLang = node[DOM_GET_ATTRIBUTE]?.("data-lang") || node[DOM_GET_ATTRIBUTE]?.("data-language");
    if (dataLang && !NON_LANGUAGES.has(dataLang.toLowerCase())) return dataLang.toLowerCase();
  }
  return "";
}

function hasMeaningfulContent(el) {
  if ((el[DOM_TEXT_CONTENT] || "").trim()) return true;
  return Boolean(el[DOM_QUERY_SELECTOR]?.("img, svg title"));
}

/**
 * Lazy images: copy a lazy-load attribute into src when src is missing or a
 * data: placeholder. Then drop images that are still inline data.
 */
function standardizeImages(doc, base, stats) {
  const squash = (text) => (text || "").replace(/\s+/g, " ").trim();
  for (const element of doc[DOM_QUERY_SELECTOR_ALL]("picture, .ars-lightbox, figcaption, .caption, .ars-gallery-caption")) {
    if (element.localName === "picture") {
      // Spaces between void sources indent the image into a code block.
      for (const node of Array.from(element.childNodes)) if (node.nodeType === 3 && !node.nodeValue.trim()) node.remove();
      continue;
    }
    if (element.matches(".ars-lightbox")) {
      const seen = new Set();
      for (const caption of element[DOM_QUERY_SELECTOR_ALL](".ars-gallery-caption")) {
        const text = squash(caption[DOM_TEXT_CONTENT]);
        if (text && seen.has(text)) caption.remove();
        else seen.add(text);
      }
      // Readability drops leading whitespace when it changes these wrappers to paragraphs.
      for (const wrapper of element[DOM_QUERY_SELECTOR_ALL](".ars-lightbox-item, .ars-gallery-caption-content")) {
        const first = wrapper.firstChild;
        if (first?.nodeType === 3 && !first.nodeValue.trim()) first.remove();
      }
      continue;
    }
    if (!element.parentElement) continue;
    const caption = squash(element[DOM_TEXT_CONTENT]);
    if (!caption || element.closest(".pswp-caption-content") || isHiddenElement(element)) continue;
    const figure = element.closest("figure");
    // PhotoSwipe's copy is hidden by CSS; galleries may have only that copy.
    for (const copy of (figure || element.closest(".ars-lightbox") || element.parentElement?.parentElement)?.[DOM_QUERY_SELECTOR_ALL](".pswp-caption-content") || []) {
      if (squash(copy[DOM_TEXT_CONTENT]) === caption) copy.remove();
    }
    for (const img of figure?.[DOM_QUERY_SELECTOR_ALL]("img") || []) {
      for (const attr of ["alt", "title"]) {
        if (squash(img[DOM_GET_ATTRIBUTE](attr)) === caption) img[DOM_REMOVE_ATTRIBUTE](attr);
      }
    }
  }
  for (const img of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("img"))) {
    const src = img[DOM_GET_ATTRIBUTE]("src") || "";
    if (!src || src.startsWith("data:")) {
      const lazy = LAZY_SRC_ATTRS.map((attr) => img[DOM_GET_ATTRIBUTE](attr)).find((v) => v && !v.startsWith("data:"));
      if (lazy) {
        img[DOM_SET_ATTRIBUTE]("src", lazy);
        stats.lazyImagesResolved += 1;
      }
    }
    const current = img[DOM_GET_ATTRIBUTE]("src") || "";
    if (!current || isUnsafeUrl(current)) {
      img.remove();
      stats.inlineImagesDropped += 1;
      continue;
    }
    img[DOM_SET_ATTRIBUTE]("src", resolveUrl(current, base));
  }
}

function standardizeLinks(doc, base, stats) {
  for (const a of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("a"))) {
    const href = a[DOM_GET_ATTRIBUTE]("href") || "";
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
        const target = new URL(href, base);
        // Some browser URL parsers accept percent-encoded spaces in a host.
        // Special-scheme hosts cannot contain ASCII whitespace or controls.
        if (/^(?:https?|ftp|wss?):$/.test(target.protocol)
          && /[\x00-\x20\x7f]/.test(decodeURIComponent(target.hostname))) throw new TypeError("Invalid link host");
      } catch {
        a.replaceWith(...Array.from(a.childNodes));
        stats.invalidLinksUnwrapped += 1;
        continue;
      }
    }
    if (href) a[DOM_SET_ATTRIBUTE]("href", resolveUrl(href, base));
  }
}

/** Text of a code block, with <br> and block-level lines as line breaks. */
function codeText(root, trial, ranges) {
  let text = "";
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        text += child.nodeValue;
        if (ranges) trial.codeRange(child, ranges);
      }
      else if (child.nodeType !== 1) continue;
      else if (child.localName === "br") { text += "\n"; if (ranges) trial.codeBoundary(ranges); }
      else {
        const block = CODE_LINE_ELEMENTS.has(child.localName);
        if (block && text && !text.endsWith("\n")) { text += "\n"; if (ranges) trial.codeBoundary(ranges); }
        walk(child);
        if (block && text && !text.endsWith("\n")) { text += "\n"; if (ranges) trial.codeBoundary(ranges); }
      }
    }
  };
  walk(root);
  return text;
}

/** <pre> without <code> (and code without a language) gets a language-tagged <code>. */
function standardizeCode(doc, stats, trial) {
  for (const pre of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("pre"))) {
    for (const button of Array.from(pre[DOM_QUERY_SELECTOR_ALL]("button"))) button.remove();
    const inner = pre[DOM_QUERY_SELECTOR]("code");
    const lang = languageFrom(inner || pre, inner ? 4 : 3);
    // One <code> and only whitespace around it: that <code> is the block.
    const sole = pre.children.length === 1 && pre[DOM_FIRST_ELEMENT_CHILD] === inner
      && !(pre[DOM_TEXT_CONTENT] || "").replace(inner[DOM_TEXT_CONTENT] || "", "").trim();
    const code = sole ? inner : doc[DOM_CREATE_ELEMENT]("code");
    if (!sole) stats.preWrapped += 1;
    // Turndown reads textContent, so lines kept apart by markup become text.
    const ranges = trial ? trial.codeStart(pre) : null;
    const text = codeText(sole ? inner : pre, trial, ranges);
    code[DOM_TEXT_CONTENT] = text;
    if (ranges) trial.codeEnd(code.firstChild, ranges, text);
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    pre.appendChild(code);
    if (lang && !/(?:^|\s)language-/.test(code[DOM_GET_ATTRIBUTE]("class") || "")) {
      code[DOM_SET_ATTRIBUTE]("class", `${code[DOM_GET_ATTRIBUTE]("class") || ""} language-${lang}`.trim());
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
  const id = heading[DOM_GET_ATTRIBUTE]("id");
  if (!id) return;
  const title = (heading[DOM_TEXT_CONTENT] || "").trim();
  const inside = Array.from(heading[DOM_QUERY_SELECTOR_ALL]("[href]"));
  for (const link of [...inside, heading.previousElementSibling, heading.nextElementSibling]) {
    if (link?.[DOM_GET_ATTRIBUTE]("href") !== `#${id}`) continue;
    if (inside.includes(link) && (link[DOM_TEXT_CONTENT] || "").trim() === title) link.replaceWith(...Array.from(link.childNodes));
    else link.remove();
    stats.headingWidgetsRemoved += 1;
  }
}

/**
 * Headings wrapped with edit/permalink widgets (Wikipedia's div.mw-heading,
 * Sphinx headerlinks): drop the widgets, then replace a wrapper whose only
 * remaining element is the heading with the heading itself.
 */
function standardizeHeadings(doc, stats, trial) {
  // An upper-deck kicker belongs with the title, not ordinary body prose.
  for (const label of doc[DOM_QUERY_SELECTOR_ALL](".upper-deck__text")) {
    const trace = trial ? trial.beforeRewrite(label) : false;
    label[DOM_INNER_HTML] = `<strong>${label[DOM_INNER_HTML]}</strong>`;
    if (trace) trial.afterRewrite(label[DOM_FIRST_ELEMENT_CHILD]);
  }
  for (const widget of Array.from(doc[DOM_QUERY_SELECTOR_ALL](EDIT_WIDGETS))) {
    if (!(widget[DOM_TEXT_CONTENT] || "").trim() || widget.matches?.(ALWAYS_REMOVED_WIDGETS)) {
      widget.remove();
      stats.headingWidgetsRemoved += 1;
    }
  }
  for (const heading of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("h1, h2, h3, h4, h5, h6"))) {
    removeOwnPermalinks(heading, stats);
    const parent = heading.parentElement;
    if (!parent || parent.localName !== "div") continue;
    const others = Array.from(parent.children).filter((el) => el !== heading);
    const hasBareText = Array.from(parent.childNodes).some((node) => node.nodeType === 3 && node.nodeValue.trim());
    if (!hasBareText && others.every((el) => !(el[DOM_TEXT_CONTENT] || "").trim() && !el.matches?.(MEDIA) && !el[DOM_QUERY_SELECTOR]?.(MEDIA))) {
      parent.replaceWith(heading);
      stats.headingsUnwrapped += 1;
    }
  }
}

function isInactivePanel(panel) {
  if (isHiddenElement(panel) || panel[DOM_GET_ATTRIBUTE]("aria-hidden") === "true" || panel.classList.contains("hidden")) return true;
  // Custom elements that mark only the group: <sp-tabs selected="overview">.
  const value = panel[DOM_GET_ATTRIBUTE]("value");
  const selected = value && panel.parentElement?.closest("[selected]")?.[DOM_GET_ATTRIBUTE]("selected");
  return Boolean(selected) && selected !== value;
}

function tabOf(panel, tabs) {
  const id = panel[DOM_GET_ATTRIBUTE]("id");
  const labelledBy = panel[DOM_GET_ATTRIBUTE]("aria-labelledby");
  const value = panel[DOM_GET_ATTRIBUTE]("value") || panel[DOM_GET_ATTRIBUTE]("name");
  const named = tabs.find((tab) => (labelledBy && tab[DOM_GET_ATTRIBUTE]("id") === labelledBy)
    || (id && (tab[DOM_GET_ATTRIBUTE]("aria-controls") === id || tab[DOM_GET_ATTRIBUTE]("href") === `#${id}`))
    || (value && (tab[DOM_GET_ATTRIBUTE]("value") === value || tab[DOM_GET_ATTRIBUTE]("panel") === value)));
  if (named) return named;
  // Docusaurus ties them by position alone.
  const parent = panel.parentElement;
  const index = Array.from(parent?.children || []).filter((el) => el.matches?.(TAB_PANELS)).indexOf(panel);
  for (let node = parent, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
    const list = node[DOM_QUERY_SELECTOR]("[role='tablist']");
    if (list) return list[DOM_QUERY_SELECTOR_ALL]("[role='tab']")[index];
  }
  return null;
}

/**
 * Tabs read as one document: inactive panels are shown, each under its tab's
 * name, in place of a tab strip that points nowhere. A long inactive panel is
 * left out, and named in stats.omittedTabs.
 */
export function prepareConcealment(doc, concealment) {
  // Docker's docs write aria-role, and call a panel a tab: only the strip's is right.
  for (const list of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("[aria-role='tablist']"))) {
    list[DOM_SET_ATTRIBUTE]("role", "tablist");
    for (const tab of Array.from(list.children)) tab[DOM_SET_ATTRIBUTE]("role", "tab");
    for (const panel of Array.from(list.nextElementSibling?.children || [])) panel[DOM_SET_ATTRIBUTE]("role", "tabpanel");
  }
  const panels = Array.from(doc[DOM_QUERY_SELECTOR_ALL](TAB_PANELS));
  const hasProvenance = concealment && ["computed", "incomplete"].includes(concealment.check);
  const inactive = new Map(panels.map((panel) => [panel, isInactivePanel(panel)]));
  const panelLengths = new Map(panels.map((panel) => [panel, (panel[DOM_TEXT_CONTENT] || "").replace(/\s+/g, " ").trim().length]));
  // Resolve short-panel exceptions before lifting, but copy labels only after
  // lifting: concealed label text must never become a new visible heading.
  for (const panel of panels) {
    if (hasProvenance && inactive.get(panel) && panelLengths.get(panel) <= MAX_INACTIVE_PANEL_CHARS) {
      concealment?.exempt(panel);
    }
  }
  concealment?.lift(doc);
  return { panels, hasProvenance, inactive, panelLengths };
}

function standardizeTabPanels(doc, stats, concealment, trial) {
  const { panels, hasProvenance, inactive, panelLengths } = prepareConcealment(doc, concealment);
  if (!panels.length) return;
  const tabs = Array.from(doc[DOM_QUERY_SELECTOR_ALL](TABS));
  for (const panel of panels) {
    const label = (tabOf(panel, tabs)?.[DOM_TEXT_CONTENT] || "").replace(/\s+/g, " ").trim().slice(0, MAX_TAB_LABEL_CHARS);
    const text = (panel[DOM_TEXT_CONTENT] || "").replace(/\s+/g, " ").trim();
    if (hasProvenance ? inactive.get(panel) : isInactivePanel(panel)) {
      if ((hasProvenance ? panelLengths.get(panel) : text.length) > MAX_INACTIVE_PANEL_CHARS) {
        stats.omittedTabs.push(label);
        panel.remove();
        continue;
      }
      for (const attr of ["hidden", "aria-hidden", "style"]) panel[DOM_REMOVE_ATTRIBUTE](attr);
      panel.classList.remove("hidden");
    }
    if (label && panels.length > 1 && !text.toLowerCase().startsWith(label.toLowerCase())) {
      const heading = doc[DOM_CREATE_ELEMENT]("p");
      const strong = heading.appendChild(doc[DOM_CREATE_ELEMENT]("strong"));
      strong[DOM_TEXT_CONTENT] = label;
      if (trial) trial.generated(strong.firstChild, label, panel);
      panel.insertBefore(heading, panel.firstChild);
    }
  }
  for (const el of Array.from(doc[DOM_QUERY_SELECTOR_ALL](`[role='tablist'], ${TABS}`))) el.remove();
}

function standardizeAsides(doc) {
  for (const aside of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("main aside, article aside, [role='main'] aside"))) {
    const name = `${aside[DOM_GET_ATTRIBUTE]("class") || ""} ${aside[DOM_GET_ATTRIBUTE]("aria-label") || ""} ${aside[DOM_GET_ATTRIBUTE]("role") || ""}`;
    if (!NOTE_ASIDE.test(name) || OTHER_ASIDE.test(name)) continue;
    const quote = doc[DOM_CREATE_ELEMENT]("blockquote");
    quote.append(...Array.from(aside.childNodes));
    aside.replaceWith(quote);
  }
  // Readability treats "header" as clutter, even when it labels a warning.
  for (const header of Array.from(doc[DOM_QUERY_SELECTOR_ALL]("blockquote .admonition-header"))) {
    const p = doc[DOM_CREATE_ELEMENT]("p");
    const strong = doc[DOM_CREATE_ELEMENT]("strong");
    strong.append(...Array.from(header.childNodes));
    p.append(strong);
    header.replaceWith(p);
  }
}

/**
 * @param {Document} doc the inert clone (mutated in place)
 * @param {{ url?: string, concealment?: ReturnType<typeof import('./concealed.js').createConcealmentWalk>, trial?: import('./trial.js').Trial|null }} [options]
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
  standardizeTabPanels(doc, stats, options.concealment, options.trial);
  standardizeAsides(doc);
  standardizeHeadings(doc, stats, options.trial);
  standardizeCode(doc, stats, options.trial);
  standardizeImages(doc, base, stats);
  standardizeLinks(doc, base, stats);
  return stats;
}
