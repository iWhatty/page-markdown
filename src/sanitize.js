// Stage 1: clone the page into an inert document, inline open shadow roots
// within limits, and strip non-content. The live page is never modified.
import { CONCEALED_MARK, createConcealmentWalk, isText, isElement, DOM_LOCAL_NAME, DOM_GET_ROOT_NODE, DOM_CHILD_NODES, DOM_NODE_VALUE, DOM_SHADOW_ROOT, DOM_CONTENT, DOM_APPEND_CHILD, DOM_NODE_TYPE} from "./concealed.js";

/** @type {Readonly<Required<import("./types.js").SanitizeOptions>>} */
export const DEFAULT_SANITIZE_OPTIONS = Object.freeze({
  stripScripts: true,
  stripStyles: true,
  stripNoscript: true,
  stripMeta: true,
  stripLinkTags: true,
  stripAds: true,
  detectConcealedText: false,
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
  if (node?.[DOM_NODE_TYPE] !== 1) return false;
  // Sites put page-wide ad settings on <body> (heise.de's data-ad-unit).
  if (node[DOM_LOCAL_NAME] === "html" || node[DOM_LOCAL_NAME] === "body") return false;
  if (AD_ELEMENT_NAME.test(node[DOM_LOCAL_NAME] || "")) return true;
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
  if (!isElement(node)) return false;
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
  const limits = [
    positiveLimit(opts.shadowNodeLimit, "shadowNodeLimit"),
    positiveLimit(opts.shadowCharLimit, "shadowCharLimit"),
    positiveLimit(opts.shadowDepthLimit, "shadowDepthLimit"),
  ];
  const selectors = stripSelectors(opts);
  const sourceDoc = /** @type {Document} */ (root[DOM_NODE_TYPE] === 9 ? root : root.ownerDocument);
  const source = root[DOM_NODE_TYPE] === 9 ? /** @type {Document} */ (root).documentElement : root;
  const inert = createInertDocument(sourceDoc);
  const concealment = createConcealmentWalk(sourceDoc, opts.detectConcealedText);

  function shallow(node) {
    if (!isElement(node)) {
      const copy = inert.importNode(node, false);
      return copy;
    }
    const name = node.prefix ? `${node.prefix}:${node[DOM_LOCAL_NAME]}` : node[DOM_LOCAL_NAME];
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
    return copy;
  }

  let nodes = 0;
  let chars = 0;
  let overLimit = false;
  let shadowHosts = 0;
  function carry(work, pair) {
    for (let i = 2; i <= 8; i++) pair[i] = work[i];
    return pair;
  }

  function isAssigningSlot(node) {
    return isElement(node) && node[DOM_LOCAL_NAME] === "slot"
      && typeof node.assignedNodes === "function" && !!node[DOM_GET_ROOT_NODE]?.().host;
  }

  function shadowNode(work, depth, lightHost) {
    const [node, allocated] = work;
    const inPage = lightHost || node[DOM_GET_ROOT_NODE]?.()[DOM_NODE_TYPE] === 9;
    if (depth > limits[2] || (!inPage && ++nodes > limits[0])) {
      overLimit = true;
      return null;
    }
    if (!lightHost && isStripped(node, selectors, opts)) return inert.createDocumentFragment();
    const copy = allocated || shallow(node);
    work = concealment.inherit(work, node, copy);
    const host = inPage && node[DOM_SHADOW_ROOT];
    const outer = host && [nodes, chars];
    let elementChars = 0;
    if (host) nodes = chars = 0;
    else {
      if (!inPage) chars += isElement(node) ? (elementChars = (copy.outerHTML || "").length) : (node[DOM_NODE_VALUE] || "").length * 6;
      if (chars > limits[1]) { overLimit = true; return null; }
    }
    let children = node[DOM_CHILD_NODES];
    let target = copy;
    if (host) children = host[DOM_CHILD_NODES];
    else if (isAssigningSlot(node)) {
      const assigned = node.assignedNodes({ flatten: true });
      children = assigned.length ? assigned : node[DOM_CHILD_NODES];
      target = inert.createDocumentFragment();
    } else if (node[DOM_SHADOW_ROOT]) {
      children = node[DOM_SHADOW_ROOT][DOM_CHILD_NODES];
    } else if (isElement(node) && node[DOM_LOCAL_NAME] === "template" && node[DOM_CONTENT]) {
      children = node[DOM_CONTENT][DOM_CHILD_NODES];
      target = copy[DOM_CONTENT] || copy;
    }
    const pairs = [];
    let textAllocations = 0;
    for (const child of Array.from(children || [])) {
      // Stripped children still pass through the recursive node-budget gate.
      // Only direct text must exist while this element's declaration is
      // local. Element allocation stays behind the recursive budget gate.
      const pageText = child[DOM_GET_ROOT_NODE]?.()[DOM_NODE_TYPE] === 9;
      const allocateText = isText(child) && (pageText || ++textAllocations <= limits[0] - nodes);
      pairs.push([child, allocateText ? shallow(child) : null]);
    }
    concealment.process(node, copy, work, host ? null : pairs);
    if (!inPage && isElement(node)) {
      // Detection may add the compatibility hidden attribute. Charge it before
      // accepting children, just as when detection ran during shallow cloning.
      chars += (copy.outerHTML || "").length - elementChars;
      if (chars > limits[1]) { overLimit = true; return null; }
    }
    for (const pair of pairs) {
      const childCopy = shadowNode(carry(work, pair), depth + 1);
      if (childCopy) target[DOM_APPEND_CHILD](childCopy);
      if (overLimit) break;
    }
    if (host) {
      if (overLimit) shadowHosts++;
      overLimit = false;
      [nodes, chars] = outer;
      return copy;
    }
    return isAssigningSlot(node) ? target : copy;
  }

  const clone = shallow(source);
  const initial = concealment.initial(source);
  // Iterative light-DOM walk: ordinary pages get no depth limit.
  const pending = [carry(initial, [source, clone])];
  while (pending.length) {
    const work = /** @type {any[]} */ (pending.pop());
    const [live, copy] = work;
    if (live[DOM_SHADOW_ROOT]) {
      shadowNode(work, 0, true);
      continue;
    }
    const children = live[DOM_CONTENT]?.[DOM_CHILD_NODES] || live[DOM_CHILD_NODES];
    const target = copy[DOM_CONTENT] || copy;
    const pairs = [];
    for (const child of Array.from(children || [])) {
      if (isStripped(child, selectors, opts)) continue;
      const childCopy = shallow(child);
      target[DOM_APPEND_CHILD](childCopy);
      pairs.push([child, childCopy]);
    }
    concealment.process(live, copy, work, pairs);
    for (let i = pairs.length - 1; i >= 0; i -= 1) {
      const pair = pairs[i];
      if (!isElement(pair[0])) continue;
      pending.push(carry(concealment.inherit(work, pair[0]), pair));
    }
  }

  if (clone[DOM_LOCAL_NAME] === "html") {
    inert.removeChild(inert.documentElement);
    inert[DOM_APPEND_CHILD](clone);
  } else {
    inert.body[DOM_APPEND_CHILD](clone);
  }
  return { document: inert, omissions: { shadowHosts }, concealment };
}
