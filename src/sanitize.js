// Stage 1: clone the page into an inert document, inline open shadow roots
// within limits, and strip non-content. The live page is never modified.

export const DEFAULT_SANITIZE_OPTIONS = Object.freeze({
  stripScripts: true,
  stripStyles: true,
  stripNoscript: true,
  stripMeta: true,
  stripLinkTags: true,
  stripAds: true,
  // App-specific overlays or widgets to drop, e.g. "[data-app-overlay]".
  extraStripSelectors: [],
  shadowNodeLimit: 5000,
  shadowCharLimit: 500000,
  shadowDepthLimit: 128,
});

const STRIP_RULES = {
  stripScripts: "script",
  stripStyles: "style",
  stripNoscript: "noscript",
  stripMeta: "meta",
  stripLinkTags: "link",
};

// Advertising placements: explicit ad markup, plus custom elements named for ad
// slots (e.g. MDN's <mdn-placement-sidebar>).
const AD_SELECTOR = [
  "ins.adsbygoogle", ".adsbygoogle", ".advertisement",
  "[data-ad-slot]", "[data-ad-client]", "[data-ad-unit]",
  "[aria-label='Advertisement' i]", "[aria-label='Advertisements' i]", "[aria-label='Sponsored' i]",
  "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication.com']", "iframe[id^='google_ads_iframe']",
].join(", ");
const AD_ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:placement|advert|advertisement|ads?|sponsor|sponsored)(?:-[a-z0-9]+)*$/;

/** @param {any} node */
export function isAdvertisementElement(node) {
  if (node?.nodeType !== 1) return false;
  if (AD_ELEMENT_NAME.test(node.localName || "")) return true;
  try {
    return Boolean(node.matches?.(AD_SELECTOR));
  } catch {
    // DOM implementations without case-insensitive attribute selectors.
    return Boolean(node.matches?.(AD_SELECTOR.replace(/ i\]/g, "]")));
  }
}

function stripSelectors(options) {
  const selectors = Object.entries(STRIP_RULES)
    .filter(([flag]) => options[flag])
    .map(([, selector]) => selector);
  for (const extra of options.extraStripSelectors || []) {
    if (typeof extra === "string" && extra.trim()) selectors.push(extra.trim());
  }
  return selectors;
}

function isStripped(node, selectors, options) {
  if (node.nodeType !== 1) return false;
  if (selectors.some((selector) => node.matches?.(selector))) return true;
  return Boolean(options.stripAds && isAdvertisementElement(node));
}

/**
 * Creates an empty HTML document unconnected to the page: no scripts run and
 * no custom elements upgrade in it.
 * @param {Document} doc
 */
export function createInertDocument(doc) {
  const impl = doc?.implementation;
  if (typeof impl?.createHTMLDocument === "function") return impl.createHTMLDocument("");
  const Parser = doc?.defaultView?.DOMParser || globalThis.DOMParser;
  if (typeof Parser === "function") {
    return new Parser().parseFromString("<!doctype html><html><head></head><body></body></html>", "text/html");
  }
  throw new Error("page-markdown: cannot create an inert document (no createHTMLDocument or DOMParser)");
}

const SHADOW_LIMIT = Symbol("shadow limit");

function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`page-markdown: ${name} must be a positive integer`);
  }
  return value;
}

/**
 * Clones `root` (a Document or Element) into a new inert document.
 * Open shadow roots replace their host's light children (native slots supply
 * assigned children). Limits apply only to shadow content; a host over the
 * limit is emptied and counted as an omission.
 *
 * @param {Document|Element} root
 * @param {Partial<typeof DEFAULT_SANITIZE_OPTIONS>} [options]
 * @returns {{ document: Document, omissions: { shadowHosts: number } }}
 */
export function sanitizeToInertDocument(root, options = {}) {
  const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options };
  const limits = {
    nodes: positiveLimit(opts.shadowNodeLimit, "shadowNodeLimit"),
    chars: positiveLimit(opts.shadowCharLimit, "shadowCharLimit"),
    depth: positiveLimit(opts.shadowDepthLimit, "shadowDepthLimit"),
  };
  const selectors = stripSelectors(opts);
  const sourceDoc = root.nodeType === 9 ? root : root.ownerDocument;
  const source = root.nodeType === 9 ? root.documentElement : root;
  const inert = createInertDocument(sourceDoc);

  function shallow(node) {
    if (node.nodeType !== 1) return inert.importNode(node, false);
    const name = node.prefix ? `${node.prefix}:${node.localName}` : node.localName;
    const copy = node.namespaceURI
      ? inert.createElementNS(node.namespaceURI, name)
      : inert.createElement(name);
    for (const attr of Array.from(node.attributes || [])) {
      // HTML allows colon-bearing names without a namespace (framework
      // directives); setAttributeNS rejects those.
      if (attr.namespaceURI) copy.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      else copy.setAttribute(attr.name, attr.value);
    }
    return copy;
  }

  let nodes = 0;
  let chars = 0;
  let shadowHosts = 0;

  function isAssigningSlot(node) {
    return node.nodeType === 1 && node.localName === "slot"
      && typeof node.assignedNodes === "function" && Boolean(node.getRootNode?.().host);
  }

  function shadowNode(node, depth) {
    if (++nodes > limits.nodes || depth > limits.depth) throw SHADOW_LIMIT;
    if (isStripped(node, selectors, opts)) return inert.createDocumentFragment();
    const copy = shallow(node);
    chars += node.nodeType === 1 ? (copy.outerHTML || "").length : (node.nodeValue || "").length * 6;
    if (chars > limits.chars) throw SHADOW_LIMIT;
    let children = node.childNodes;
    let target = copy;
    if (isAssigningSlot(node)) {
      const assigned = node.assignedNodes({ flatten: true });
      children = assigned.length ? assigned : node.childNodes;
      target = inert.createDocumentFragment();
    } else if (node.shadowRoot) {
      children = node.shadowRoot.childNodes;
    } else if (node.nodeType === 1 && node.localName === "template" && node.content) {
      children = node.content.childNodes;
      target = copy.content || copy;
    }
    for (const child of Array.from(children || [])) target.appendChild(shadowNode(child, depth + 1));
    return isAssigningSlot(node) ? target : copy;
  }

  const clone = shallow(source);
  // Iterative light-DOM walk: ordinary pages get no depth limit.
  const pending = [[source, clone]];
  while (pending.length) {
    const [live, copy] = pending.pop();
    if (live.shadowRoot) {
      const fragment = inert.createDocumentFragment();
      try {
        for (const child of Array.from(live.shadowRoot.childNodes)) fragment.appendChild(shadowNode(child, 1));
        while (copy.firstChild) copy.removeChild(copy.firstChild);
        copy.appendChild(fragment);
      } catch (error) {
        if (error !== SHADOW_LIMIT) throw error;
        while (copy.firstChild) copy.removeChild(copy.firstChild);
        shadowHosts += 1;
      }
      continue;
    }
    const children = live.content?.childNodes || live.childNodes;
    const target = copy.content || copy;
    const pairs = [];
    for (const child of Array.from(children || [])) {
      if (isStripped(child, selectors, opts)) continue;
      const childCopy = shallow(child);
      target.appendChild(childCopy);
      pairs.push([child, childCopy]);
    }
    for (let i = pairs.length - 1; i >= 0; i -= 1) pending.push(pairs[i]);
  }

  if (clone.localName === "html") {
    inert.removeChild(inert.documentElement);
    inert.appendChild(clone);
  } else {
    inert.body.appendChild(clone);
  }
  return { document: inert, omissions: { shadowHosts } };
}
