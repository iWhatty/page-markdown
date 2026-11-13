// Stage-1 style provenance; consumed before standardization copies any text.
// No geometry reads; getComputedStyle can itself trigger style/layout work.
import { isCollapsedAnswer } from "./extract.js";
export const CONCEALED_MARK = "data-page-markdown-concealed";
export const CONCEALED_BLOCK_LIMIT = 2048;
export const CONCEALED_TOTAL_LIMIT = 16384;
export const CONCEALED_ENTRY_LIMIT = 100;
// UTF-16 units, without whitespace normalization. A block is a consecutive
// run of concealed text with one reason in the nearest BLOCK ancestor; visible
// text, another block or another reason ends it. Each captured text node is
// visited once, so nested signals never double-count. Precedence is below.
/** @type {import('./types.js').ConcealmentReason[]} */
const REASONS = ["display_none", "visibility_hidden", "opacity_zero", "font_size_zero", "clipped", "transparent_text", "same_color"];
const BLOCK = /^(?:address|article|aside|blockquote|body|dd|div|dl|dt|figcaption|figure|h[1-6]|li|main|ol|p|pre|section|table|td|th|tr|ul)$/;
// Fixed read/probe indices: 0..15 required, 16..18 optional prefixed fields.
const ALL_FIELDS = 'display visibility opacity fontSize position clip clipPath transitionProperty transitionDuration animationName animationDuration color backgroundColor backgroundImage backgroundClip textShadow webkitBackgroundClip webkitTextFillColor webkitTextStrokeWidth'.split(' ');
const [NONE, VISIBLE, HIDDEN, AUTO, INCOMPLETE] = /** @type {['none', 'visible', 'hidden', 'auto', 'incomplete']} */ ('none visible hidden auto incomplete'.split(' '));
const SPACE = /\s/;
const NORMALIZE = /[A-Z]|^[^\x21-\x7e]|[^\x21-\x7e]$/;
const ZERO_PX = /^0(?:\.0+)?px$/;

export function isText(node) { return node[DOM_NODE_TYPE] === 3; }
export function isElement(node) { return node[DOM_NODE_TYPE] === 1; }

// Shared DOM property names keep the browser bundle within its size ceiling.
// This dictionary is allocated once, never per captured element.
export const [DOM_PARENT_ELEMENT, DOM_LOCAL_NAME, DOM_GET_ROOT_NODE, DOM_CHILD_NODES, DOM_FIRST_CHILD, DOM_NEXT_SIBLING, DOM_NODE_VALUE, DOM_SHADOW_ROOT, DOM_CONTENT, DOM_APPEND_CHILD, DOM_NODE_TYPE] = 'parentElement localName getRootNode childNodes firstChild nextSibling nodeValue shadowRoot content appendChild nodeType'.split(' ');

// Provisional scroll-reveal policy. A named animation may affect opacity; its
// name is not evidence of its keyframes or that content will ever appear.
export function keepPendingOpacity(style) {
  return pendingOpacity(style.transitionProperty, style.transitionDuration, style.animationName, style.animationDuration);
}
function pendingOpacity(properties, transitions, names, animations) {
  const applies = (names, durations, transition = false) => {
    const times = (durations || "").split(",");
    const entries = (names || "").split(",");
    // Transitions use the last matching property; animations may overlap.
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i].trim();
      if (transition ? name === 'all' || name === 'opacity' : name && name !== NONE) {
        const time = times[i % times.length].trim();
        if (/^(?:\d*\.)?\d+(?:ms|s)$/.test(time) && parseFloat(time) > 0) return true;
        if (transition) return false;
      }
    }
    return false;
  };
  return applies(properties, transitions, true) || applies(names, animations);
}

function parent(el) {
  return el.assignedSlot || el[DOM_PARENT_ELEMENT] || el[DOM_GET_ROOT_NODE]?.().host || null;
}

// Supported clips only: zero-area legacy rect (unitless zero or px,
// comma/space separated), inset(50%) and circle(0 [at ...]), zero px or
// percent radius. No geometry, polygons, masks, overflow or off-screen tests.
/** @param {string} clipPath @param {string} [clip] @param {string} [position] */
function clipped(clipPath, clip = AUTO, position) {
  const positioned = position === 'absolute' || position === 'fixed';
  const rect = positioned && /^rect\(\s*((?:-?(?:\d*\.)?\d+px|0)(?:[\s,]+(?:-?(?:\d*\.)?\d+px|0)){3})\s*\)$/.exec(clip);
  const edges = rect?.[1]?.split(/[\s,]+/).map(parseFloat);
  return (edges && (edges[0] === edges[2] || edges[1] === edges[3]))
    || /^inset\(\s*50%\s*\)$/.test(clipPath)
    || /^circle\(\s*0(?:px|%)?(?:\s+at\s+[^)]+)?\s*\)$/.test(clipPath);
}

// Work items belong to the clone walk. Slots 2..8 carry primitives or a
// shared exceptional provenance link: persistent, background, provider, head,
// visibility origin, cleanup chain, and the source element represented.
/** @param {Document} doc @param {boolean} enabled */
export function createConcealmentWalk(doc, enabled) {
  const view = doc.defaultView;
  const active = enabled && typeof view?.getComputedStyle === "function";
  /** @type {import('./types.js').ConcealmentCheck} */
  let check = !enabled ? "disabled" : active ? "computed" : "static-only";
  const exemptions = new Set(), computedHidden = new Set(), records = new Map();
  const cleanups = new Map(), planted = new Set(), images = new Map(), colours = new Map();
  const pending = new Set();
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  // Counter indices follow the names exposed by the counters getter below.
  const optional = [];
  let probed = false;
  let outside = false;
  /** @type {import('./types.js').ConcealedText[]} */
  const entries = [];
  const summary = { count: 0, chars: 0, truncated: false };

  function slow() { counts[3]++; }
  function declaration(el) {
    counts[0]++;
    if (outside) counts[6]++;
    try { return view?.getComputedStyle(el); } catch { check = INCOMPLETE; return null; }
  }
  function read(raw, field) {
    counts[1]++;
    if (outside) counts[7]++;
    let value;
    try { value = raw?.[ALL_FIELDS[field]]; } catch { /* consulted failure */ }
    if (typeof value !== "string" || !value) { check = INCOMPLETE; return ""; }
    // Canonical computed strings need no normalization or replacement string.
    if (NORMALIZE.test(value)) { slow(); value = value.trim().toLowerCase(); }
    if (!value) check = INCOMPLETE;
    return value;
  }
  function probe(el) {
    if (probed) return;
    probed = true;
    const raw = declaration(el);
    for (let i = 0; i < ALL_FIELDS.length; i++) {
      if (i < 16 || (optional[i] = !!raw && ALL_FIELDS[i] in raw)) read(raw, i);
    }
    counts[4] = 1;
    counts[5] = counts[1];
  }
  function maybe(raw, field) {
    return optional[field] || raw && ALL_FIELDS[field] in raw ? read(raw, field) : undefined;
  }

  // Parse canonical computed rgb/rgba without arrays, matches, or cache writes.
  // Fractional channels remain doubles, never rounded to eight-bit channels.
  let red = 0, green = 0, blue = 0, alpha = 0;
  function rgb(value) {
    if (value === "rgba(0, 0, 0, 0)") { red = green = blue = alpha = 0; return true; }
    if (value === "rgb(0, 0, 0)") { red = green = blue = 0; alpha = 1; return true; }
    const rgba = value.startsWith('rgba(');
    let i = rgba ? 5 : value.startsWith('rgb(') ? 4 : 0;
    if (!i) return false;
    let comma;
    alpha = 1;
    for (let channel = 0; channel < 4; channel++) {
      while (SPACE.test(value[i])) i++;
      const begin = i;
      let scale = 0, n = 0;
      for (; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code === 46 && !scale) scale = 1;
        else if (code >= 48 && code <= 57) {
          n = n * 10 + code - 48;
          if (scale) scale *= 10;
        } else break;
      }
      if (i === begin || value[i - 1] === '.') return false;
      // Division matches decimal conversion while numerator and denominator
      // are exact integers. Unusually long tokens use exact JS conversion.
      if (n < 9e15 && scale <= 1e22) n /= scale || 1;
      else { slow(); n = Number(value.slice(begin, i)); }
      if (channel === 3 && value[i] === '%') { n /= 100; i++; }
      if (n > (channel === 3 ? 1 : 255)) return false;
      if (channel === 0) red = n;
      else if (channel === 1) green = n;
      else if (channel === 2) blue = n;
      else alpha = n;
      const end = i;
      while (SPACE.test(value[i])) i++;
      if (channel === 0) comma = value[i] === ',';
      if (channel < 2) {
        if (comma ? value[i++] !== ',' : end === i || rgba) return false;
      } else {
        if (value[i] === ')') return (!rgba || channel === 3) && i + 1 === value.length;
        if (channel === 3 || (comma ? !rgba || value[i++] !== ',' : rgba || value[i++] !== '/')) return false;
      }
    }
  }
  function parsed(value) {
    let result = colours.get(value);
    if (!result) { rgb(value); colours.set(value, result = [red, green, blue, alpha]); }
    return result;
  }
  function same(a, b) {
    if (a === b) return true;
    const c = parsed(a), d = parsed(b);
    return c.every((n, i) => n === d[i]);
  }
  function backgroundSafe(el, provider) {
    if (!el) return false;
    const cached = images.get(el);
    if (cached?.[0] === provider) return cached[1];
    counts[8]++;
    const safe = read(declaration(el), 13) === NONE
      && (el === provider || backgroundSafe(parent(el), provider));
    images.set(el, [provider, safe]);
    return safe;
  }
  function initial(source) {
    if (active) probe(source);
    outside = true;
    const work = inherit([,, 0, 0, 0, false, 0, 0, null], source);
    outside = false;
    return work;
  }
  function inherit(work, child, clone) {
    // Flattened assignments can omit slot carriers; templates break the source
    // parent relation. Only those exceptional edges reconstruct a source path.
    const actual = active && (isText(child) ? child.assignedSlot || child[DOM_PARENT_ELEMENT] : parent(child));
    if (!active || actual === work[8]) return work;
    slow();
    const adjusted = [,, 0, 0, 0, false, 0, 0, null];
    const path = [];
    for (let el = actual; el && el !== work[8] && !path.includes(el); el = parent(el)) path.push(el);
    if (path.length && parent(path[path.length - 1]) === work[8]) {
      for (let i = 2; i <= 8; i++) adjusted[i] = work[i];
    }
    for (let i = path.length - 1; i >= 0; i--) process(path[i], null, adjusted,
      i === 0 && isText(child) && clone ? [[child, clone]] : null);
    return adjusted;
  }
  function textSignal(el, raw, work) {
    const color = read(raw, 11);
    if (!rgb(color)) return 0;
    const fill = maybe(raw, 17) ?? color;
    if (!rgb(fill)) { slow(); return 0; }
    if (fill !== color) slow();
    let candidate = alpha === 0 ? 32 : 0;
    if (!candidate) {
      if (!same(color, fill) || !work[3]) return 0;
      if (color !== work[3]) {
        // A successful same() leaves the channels equal to color and fill.
        const r = red, g = green, b = blue, a = alpha;
        if (!rgb(work[3]) || r !== red || g !== green || b !== blue || a !== alpha) return 0;
        slow();
      }
      candidate = 64;
    }
    slow();
    if (candidate === 64 && !backgroundSafe(el, work[4])) return 0;
    const clip = read(raw, 14), webkit = maybe(raw, 16);
    const shadow = read(raw, 15), stroke = maybe(raw, 18);
    return clip && !clip.split(/\s*,\s*/).includes('text')
      && webkit !== '' && !webkit?.split(/\s*,\s*/).includes('text')
      && shadow === NONE && (stroke === undefined || ZERO_PX.test(stroke)) ? candidate : 0;
  }
  function process(el, copy, work, pairs) {
    if (!active || !isElement(el)) return;
    const raw = declaration(el);
    const display = read(raw, 0), visibility = read(raw, 1);
    const opacity = read(raw, 2), clipPath = read(raw, 6);
    let mask = display === NONE ? 1 : 0;
    const hidden = visibility === HIDDEN || visibility === 'collapse';
    if (hidden) mask |= 2;
    if (opacity && +opacity === 0) {
      slow();
      if (pendingOpacity(read(raw, 7), read(raw, 8), read(raw, 9), read(raw, 10))) pending.add(el);
      else mask |= 4;
    }
    if (clipPath !== NONE) {
      slow();
      if (clipped(clipPath)) mask |= 16;
    }
    if (!(mask & 16)) {
      const clip = read(raw, 5);
      if (clip !== AUTO) {
        slow();
        if (clipped(clipPath, clip, read(raw, 4))) mask |= 16;
      }
    }
    const bg = read(raw, 12);
    if (rgb(bg)) {
      if (alpha === 1) { work[3] = bg; work[4] = el; }
      else if (alpha !== 0) { work[3] = work[4] = 0; }
    } else { slow(); work[3] = work[4] = 0; }
    work[5] = work[5] || el[DOM_LOCAL_NAME] === 'head';
    let hasText = false, actualText = false;
    for (let child = el[DOM_FIRST_CHILD]; child; child = child[DOM_NEXT_SIBLING]) {
      if (isText(child) && child[DOM_NODE_VALUE]) { hasText = actualText = true; break; }
    }
    if (!hasText && pairs) for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0][DOM_NODE_TYPE] === 3 && pairs[i][0][DOM_NODE_VALUE]) { hasText = true; break; }
    }
    if (hasText) {
      const fontSize = read(raw, 3);
      if (ZERO_PX.test(fontSize)) mask |= 8;
      if (actualText && !(mask & (4 | 8 | 16))) {
        mask |= textSignal(el, raw, work);
      }
    }
    if (copy?.hasAttribute(CONCEALED_MARK)) {
      slow();
      const marks = (copy.getAttribute(CONCEALED_MARK) || '').split(' ');
      planted.add(copy);
      for (let i = 0; i < REASONS.length; i++) if (marks.includes(REASONS[i])) mask |= 1 << i;
    }
    if (mask & (1 | 2 | 4 | 16)) {
      slow();
      // Carrier: copy, mask, persistent predecessor, visibility cleanup predecessor.
      const carrier = [copy, mask, work[2], work[7]];
      if (mask & (1 | 4 | 16)) work[2] = carrier;
      if (hidden) { work[6] ||= carrier; work[7] = carrier; }
      if (copy && mask & 3 && !copy.hasAttribute(HIDDEN)) { copy.setAttribute(HIDDEN, ''); computedHidden.add(copy); }
    }
    if (!hidden) work[6] = 0;
    if (pairs && !work[5]) for (let i = 0; i < pairs.length; i++) {
      const live = pairs[i][0], clone = pairs[i][1];
      if (!clone || (live.assignedSlot || live[DOM_PARENT_ELEMENT]) !== el) continue;
      if (!isText(live)) continue;
      if (mask || work[2]) {
        slow();
        // Text record: chain, mask, copy, visibility origin, cleanup, visible.
        records.set(clone, [work[2], mask, copy, work[6], work[7], visibility === VISIBLE]);
        counts[2]++;
      } else if (work[7] && visibility === VISIBLE) {
        slow();
        cleanups.set(clone, work[7]);
      }
    }
    work[8] = el;
  }
  function exempt(el) { exemptions.add(el); }
  function lift(inert) {
    if (!active || !records.size && !computedHidden.size && !cleanups.size && !planted.size) return;
    for (const el of inert.querySelectorAll('[hidden], [style]')) {
      if (el.querySelector('pre') || isCollapsedAnswer(el)) exemptions.add(el);
    }
    function reason(record) {
      let mask = record[1] & (4 | 8 | 16 | 32 | 64);
      for (let link = record[0]; link; link = link[2]) {
        mask |= link[1] & (4 | 16);
        if (link[1] & 1 && !exemptions.has(link[0])) mask |= 1;
      }
      if (record[1] & 2 && !exemptions.has(record[2]) && !exemptions.has(record[3]?.[0])) mask |= 2;
      return REASONS.find((_, i) => mask & 1 << i);
    }
    const cleared = new Set();
    function clear(link) {
      for (; link && !cleared.has(link); link = link[3]) {
        cleared.add(link);
        if (!exemptions.has(link[0])) link[0]?.style?.removeProperty('visibility');
      }
    }
    /** @type {0 | [any, import('./types.js').ConcealmentReason, string, Text[]]} */
    let previous = 0;
    const groups = [];
    // Ordered, allocation-free traversal of ordinary inert nodes. The stack is
    // only needed at template fragments, whose parent is not the template.
    const resumes = [];
    let node = inert.documentElement;
    while (node) {
      if (isText(node)) {
        const record = records.get(node);
        const selected = record && reason(record);
        if (!selected) {
          if (record?.[5]) clear(record[4]);
          clear(cleanups.get(node));
          previous = 0;
        } else {
          let block = node[DOM_PARENT_ELEMENT];
          while (block?.[DOM_PARENT_ELEMENT] && !BLOCK.test(block[DOM_LOCAL_NAME])) block = block[DOM_PARENT_ELEMENT];
          if (!previous || previous[0] !== block || previous[1] !== selected) {
            previous = [block, selected, '', /** @type {Text[]} */ ([])];
            groups.push(previous);
          }
          previous[2] += node[DOM_NODE_VALUE] || '';
          previous[3].push(node);
        }
      }
      if (node[DOM_CONTENT]?.[DOM_FIRST_CHILD]) { resumes.push(node); node = node[DOM_CONTENT][DOM_FIRST_CHILD]; continue; }
      if (node[DOM_FIRST_CHILD] && node[DOM_LOCAL_NAME] !== 'head') { node = node[DOM_FIRST_CHILD]; continue; }
      while (node && !node[DOM_NEXT_SIBLING]) {
        node = node.parentNode;
        if (node?.[DOM_NODE_TYPE] === 11) node = resumes.pop();
      }
      node = node?.[DOM_NEXT_SIBLING];
    }
    let stored = 0;
    for (const [, reason, text, nodes] of groups) {
      const chars = text.length;
      // Use the selected reason and raw run boundaries before report capping.
      // A removes all source whitespace; B preserves whitespace-only runs and
      // replaces substantive runs with one space only at a source boundary.
      const removesWhitespace = reason === REASONS[0] || reason === REASONS[3];
      const substantive = !!text.trim();
      if (!removesWhitespace && !substantive) continue;
      if (!removesWhitespace && /^\s|\s$/.test(text)) nodes[0].before(inert.createTextNode(" "));
      for (const node of nodes) node.remove();
      if (!substantive) continue;
      summary.count += 1;
      summary.chars += chars;
      const captured = text.slice(0, Math.min(CONCEALED_BLOCK_LIMIT, CONCEALED_TOTAL_LIMIT - stored));
      if (entries.length < CONCEALED_ENTRY_LIMIT) {
        entries.push({ reason, chars, text: captured });
        stored += captured.length;
      } else summary.truncated = true;
      if (captured.length < chars) summary.truncated = true;
    }
    for (const el of computedHidden) el.removeAttribute(HIDDEN);
    // Includes template contents, which Document.querySelectorAll omits.
    for (const el of planted) el.removeAttribute(CONCEALED_MARK);
  }
  return { process, initial, inherit, exempt, lift, entries, summary,
    get counters() { return Object.fromEntries('styleCalls propertyReads recordsCreated slowPathEntries probeStyleCalls probeReads outsideStyleCalls outsideReads rereads'.split(' ').map((name, i) => [name, counts[i]])); },
    get check() { return check; }, get pendingOpacity() { return pending.size; } };
}

// Adapter for internal callers that copy one node at a time. Keeping this
// separate lets browser bundles omit the deferred-copy compatibility walk.
/** @param {Document} doc @param {boolean} enabled */
export function createConcealment(doc, enabled) {
  const capture = createConcealmentWalk(doc, enabled);
  const deferred = new Map();
  const lift = capture.lift;
  return Object.assign(capture, {
    copy(live, clone) { if (capture.check !== 'disabled' && capture.check !== 'static-only') deferred.set(live, clone); },
    lift(inert) {
      const states = new Map();
      for (const [live, clone] of deferred) {
        if (!isElement(live)) continue;
        const work = [...(states.get(parent(live)) || capture.initial(live))];
        const pairs = [];
        for (let child = live[DOM_FIRST_CHILD]; child; child = child[DOM_NEXT_SIBLING]) pairs.push([child, deferred.get(child)]);
        capture.process(live, clone, work, pairs);
        states.set(live, work);
      }
      deferred.clear();
      lift(inert);
    },
  });
}
