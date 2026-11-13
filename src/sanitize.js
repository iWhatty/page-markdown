// Stage 1: clone the page into an inert document, inline open shadow roots
// within limits, and strip non-content. The live page is never modified.
import { CONCEALED_MARK, createConcealment } from "./concealed.js";

/** @type {Readonly<Required<import("./types.js").SanitizeOptions>>} */
export const DEFAULT_SANITIZE_OPTIONS = Object.freeze({
  stripScripts: true,
  stripStyles: true,
  stripNoscript: true,
  stripMeta: true,
  stripLinkTags: true,
  stripAds: true,
  detectConcealedText: true,
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
  "ins.adsbygoogle", ".adsbygoogle", ".advertisement", ".ad-label",
  "[data-ad-slot]", "[data-ad-client]", "[data-ad-unit]",
  "[aria-label='Advertisement' i]", "[aria-label='Advertisements' i]", "[aria-label='Sponsored' i]",
  "iframe[src*='doubleclick.net']", "iframe[src*='googlesyndication.com']", "iframe[id^='google_ads_iframe']",
].join(", ");
const AD_ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:placement|advert|advertisement|ads?|sponsor|sponsored)(?:-[a-z0-9]+)*$/;

/** @param {any} node */
export function isAdvertisementElement(node) {
  if (node?.nodeType !== 1) return false;
  // Sites put page-wide ad settings on <body> (heise.de's data-ad-unit).
  if (node.localName === "html" || node.localName === "body") return false;
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

function positiveLimit(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`page-markdown: ${name} must be a positive integer`);
  }
  return value;
}

/**
 * Clones `root` (a Document or Element) into a new inert document.
 * Open shadow roots replace their host's light children (native slots supply
 * assigned children). Limits apply only to shadow content, per host in the
 * page's own tree, so slotted page content is not charged: docs sites put a
 * whole article in one host's slot. A host over the limit keeps what fits and
 * is counted as an omission.
 *
 * @param {Document|Element} root
 * @param {import("./types.js").SanitizeOptions} [options]
 */
export function sanitizeToInertDocument(root, options = {}) {
  const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options };
  const limits = {
    nodes: positiveLimit(opts.shadowNodeLimit, "shadowNodeLimit"),
    chars: positiveLimit(opts.shadowCharLimit, "shadowCharLimit"),
    depth: positiveLimit(opts.shadowDepthLimit, "shadowDepthLimit"),
  };
  const selectors = stripSelectors(opts);
  const sourceDoc = /** @type {Document} */ (root.nodeType === 9 ? root : root.ownerDocument);
  const source = root.nodeType === 9 ? /** @type {Document} */ (root).documentElement : root;
  const inert = createInertDocument(sourceDoc);
  const concealment = createConcealment(sourceDoc, opts.detectConcealedText);

  function shallow(node) {
    if (node.nodeType !== 1) {
      const copy = inert.importNode(node, false);
      concealment.copy(node, copy);
      return copy;
    }
    const name = node.prefix ? `${node.prefix}:${node.localName}` : node.localName;
    const copy = node.namespaceURI
      ? inert.createElementNS(node.namespaceURI, name)
      : inert.createElement(name);
    for (const attr of Array.from(node.attributes || [])) {
      if (attr.name.toLowerCase() === CONCEALED_MARK) continue;
      // HTML allows colon-bearing names without a namespace (framework
      // directives); setAttributeNS rejects those.
      if (attr.namespaceURI) copy.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      else copy.setAttribute(attr.name, attr.value);
    }
    concealment.copy(node, copy);
    return copy;
  }

  let nodes = 0;
  let chars = 0;
  let overLimit = false;
  let shadowHosts = 0;

  function isAssigningSlot(node) {
    return node.nodeType === 1 && node.localName === "slot"
      && typeof node.assignedNodes === "function" && Boolean(node.getRootNode?.().host);
  }

  function copyShadowRoot(host, target, depth) {
    const outer = [nodes, chars];
    nodes = 0;
    chars = 0;
    for (const child of Array.from(host.shadowRoot.childNodes)) {
      const childCopy = shadowNode(child, depth);
      if (childCopy) target.appendChild(childCopy);
      if (overLimit) break;
    }
    if (overLimit) shadowHosts += 1;
    overLimit = false;
    [nodes, chars] = outer;
  }

  function shadowNode(node, depth) {
    const inPage = node.getRootNode?.().nodeType === 9;
    if (depth > limits.depth || (!inPage && ++nodes > limits.nodes)) {
      overLimit = true;
      return null;
    }
    if (isStripped(node, selectors, opts)) return inert.createDocumentFragment();
    const copy = shallow(node);
    if (inPage && node.shadowRoot) {
      copyShadowRoot(node, copy, depth + 1);
      return copy;
    }
    if (!inPage) chars += node.nodeType === 1 ? (copy.outerHTML || "").length : (node.nodeValue || "").length * 6;
    if (chars > limits.chars) {
      overLimit = true;
      return null;
    }
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
    for (const child of Array.from(children || [])) {
      const childCopy = shadowNode(child, depth + 1);
      if (childCopy) target.appendChild(childCopy);
      if (overLimit) break;
    }
    return isAssigningSlot(node) ? target : copy;
  }

  const clone = shallow(source);
  // Iterative light-DOM walk: ordinary pages get no depth limit.
  const pending = [[source, clone]];
  while (pending.length) {
    const [live, copy] = /** @type {any[]} */ (pending.pop());
    if (live.shadowRoot) {
      copyShadowRoot(live, copy, 1);
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
  return { document: inert, omissions: { shadowHosts }, concealment };
}
