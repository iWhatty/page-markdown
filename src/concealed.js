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
const FIELDS = ["display", "visibility", "opacity", "fontSize", "position", "clip", "clipPath", "transitionProperty", "transitionDuration", "animationName", "animationDuration", "color", "backgroundColor", "backgroundImage", "backgroundClip", "textShadow"];
const OPTIONAL_FIELDS = ["webkitBackgroundClip", "webkitTextFillColor", "webkitTextStrokeWidth"];

// No reusable colour parser in this package or its installed dependencies.
// Computed sRGB only; reject unsupported syntax rather than guessing a colour.
function colour(value) {
  const match = /^(rgb|rgba)\(([^()]+)\)$/.exec(value || "");
  if (!match) return null;
  const comma = match[2].includes(",");
  const parts = comma ? match[2].split(/\s*,\s*/).map((part) => part.trim())
    : match[2].trim().replace(/\s*\/\s*/g, " / ").split(/\s+/);
  if (!comma && parts.length === 5 && parts[3] === "/") parts.splice(3, 1);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (comma ? parts.length !== (match[1] === "rgba" ? 4 : 3)
    : match[1] !== "rgb" || (parts.length === 4 && !match[2].includes("/"))) return null;
  if (parts.some((part, i) => !(i === 3 ? /^(?:\d*\.)?\d+%?$/ : /^(?:\d*\.)?\d+$/).test(part))) return null;
  const values = parts.map((part, i) => parseFloat(part) / (i === 3 && part.endsWith("%") ? 100 : 1));
  if (values.some((n, i) => n < 0 || n > (i === 3 ? 1 : 255))) return null;
  if (values.length === 3) values.push(1);
  return values;
}
function equalColour(a, b) {
  return !!a && !!b && a.every((n, i) => n === b[i]);
}

// Provisional scroll-reveal policy. A named animation may affect opacity; its
// name is not evidence of its keyframes or that content will ever appear.
export function keepPendingOpacity(style) {
  const applies = (names, durations, accepts, lastOnly = false) => {
    const times = (durations || "").split(",");
    const entries = (names || "").split(",");
    // Transitions use the last matching property; animations may overlap.
    const last = lastOnly ? entries.findLastIndex((name) => accepts(name.trim())) : -1;
    return entries.some((name, i) => {
      if (lastOnly && i !== last) return false;
      const time = times[i % times.length].trim();
      return accepts(name.trim()) && /^(?:\d*\.)?\d+(?:ms|s)$/.test(time) && parseFloat(time) > 0;
    });
  };
  return applies(style.transitionProperty, style.transitionDuration, (name) => name === "all" || name === "opacity", true)
    || applies(style.animationName, style.animationDuration, (name) => name && name !== "none");
}

function parent(el) {
  return el.assignedSlot || el.parentElement || el.getRootNode?.().host || null;
}

// Supported clips only: zero-area legacy rect (unitless zero or px,
// comma/space separated), inset(50%) and circle(0 [at ...]), zero px or
// percent radius. No geometry, polygons, masks, overflow or off-screen tests.
function clipped(style) {
  const positioned = ["absolute", "fixed"].includes(style.position);
  const rect = positioned && /^rect\(\s*((?:-?(?:\d*\.)?\d+px|0)(?:[\s,]+(?:-?(?:\d*\.)?\d+px|0)){3})\s*\)$/.exec(style.clip || "");
  const edges = rect?.[1]?.split(/[\s,]+/).map(parseFloat);
  return (edges && (edges[0] === edges[2] || edges[1] === edges[3]))
    || /^inset\(\s*50%\s*\)$/.test(style.clipPath)
    || /^circle\(\s*0(?:px|%)?(?:\s+at\s+[^)]+)?\s*\)$/.test(style.clipPath);
}

/** @param {Document} doc @param {boolean} enabled */
export function createConcealment(doc, enabled) {
  const view = doc.defaultView;
  /** @type {import('./types.js').ConcealmentCheck} */
  let check = !enabled ? "disabled" : typeof view?.getComputedStyle === "function" ? "computed" : "static-only";
  const active = check === "computed";
  const styles = new Map();
  const backgrounds = new Map();
  const localReasons = new Map();
  const copies = new Map();
  const exemptions = new Set();
  const computedHidden = new Set();
  const records = new Map();
  const pending = new Set();
  let probed = false;
  /** @type {import('./types.js').ConcealedText[]} */
  const entries = [];
  const summary = { count: 0, chars: 0, truncated: false };

  function style(el) {
    if (styles.has(el)) return styles.get(el);
    const result = {};
    try {
      const raw = view?.getComputedStyle(el);
      // The one-time probe establishes that this document's view can return
      // every field, including exposed prefixed fields. On later elements,
      // incomplete means a CONSULTED value was empty or threw; unread,
      // irrelevant values are not checked. Computed means no such failure.
      // Unknown values never establish concealment. Cache even failed reads.
      for (const field of [...FIELDS, ...OPTIONAL_FIELDS.filter((field) => raw && field in raw)]) {
        Object.defineProperty(result, field, { configurable: true, get() {
          let value = "";
          try {
            const read = raw?.[field];
            value = typeof read === "string" ? read.trim().toLowerCase() : "";
          } catch { /* unavailable property */ }
          if (!value) check = "incomplete";
          Object.defineProperty(result, field, { value });
          return value;
        } });
      }
      if (!probed) { probed = true; for (const field of Object.getOwnPropertyNames(result)) void result[field]; }
    } catch { check = "incomplete"; }
    styles.set(el, result);
    return result;
  }

  function background(el, seen = new Set()) {
    if (!el || seen.has(el)) return null; // no assumed root canvas
    if (backgrounds.has(el)) return backgrounds.get(el);
    seen.add(el);
    const s = style(el);
    const c = colour(s.backgroundColor);
    const resolved = s.backgroundImage !== "none" || !c ? null
      : c[3] === 1 ? c : c[3] === 0 ? background(parent(el), seen) : null;
    backgrounds.set(el, resolved);
    return resolved;
  }

  function textColour(el, s) {
    const c = colour(s.color);
    if (!c) return;
    const fill = s.webkitTextFillColor === undefined ? c : colour(s.webkitTextFillColor);
    if (!fill || (fill[3] !== 0 && !equalColour(c, fill))) return;
    const reason = fill[3] === 0 ? "transparent_text" : equalColour(c, background(el)) ? "same_color" : null;
    if (!reason) return;
    if (!s.backgroundClip || s.backgroundClip.split(/\s*,\s*/).includes("text")
      || s.webkitBackgroundClip === "" || s.webkitBackgroundClip?.split(/\s*,\s*/).includes("text")
      || s.textShadow !== "none"
      || (s.webkitTextStrokeWidth !== undefined && !/^0(?:\.0+)?px$/.test(s.webkitTextStrokeWidth))) return;
    return reason;
  }

  function local(el) {
    if (localReasons.has(el)) return localReasons.get(el);
    const s = style(el);
    const reasons = [];
    if (s.display === "none") reasons.push("display_none");
    if (["hidden", "collapse"].includes(s.visibility)) reasons.push("visibility_hidden");
    if (s.opacity && Number(s.opacity) === 0) {
      if (keepPendingOpacity(s)) pending.add(el);
      else reasons.push("opacity_zero");
    }
    // Also applies to text assigned directly to a slot, whose childNodes need
    // not contain that text. Font size is local, never a persistent reason.
    if (/^0(?:\.0+)?px$/.test(s.fontSize || "")) reasons.push("font_size_zero");
    if (clipped(s)) reasons.push("clipped");
    // Colour belongs to this element's own text, never its overriding children.
    if (Array.from(el.childNodes || []).some((node) => node.nodeType === 3 && node.nodeValue)) {
      if (!reasons.some(r => ["opacity_zero", "font_size_zero", "clipped"].includes(r))) {
        const reason = textColour(el, s);
        if (reason) reasons.push(reason);
      }
    }
    localReasons.set(el, reasons);
    return reasons;
  }

  function copy(live, clone) {
    if (!active) return;
    if (live.nodeType === 1) {
      copies.set(live, clone);
      const reasons = local(live);
      if (reasons.some((r) => r === "display_none" || r === "visibility_hidden") && !clone.hasAttribute("hidden")) {
        clone.setAttribute("hidden", "");
        computedHidden.add(clone);
      }
    } else if (live.nodeType === 3) {
      if (live.parentElement?.closest("head")) return; // metadata is outside this check
      records.set(clone, live.assignedSlot || live.parentElement);
    }
  }

  function exempt(el) { exemptions.add(el); }

  function lift(inert) {
    if (!active) return;
    // Existing fallback exceptions apply to these carriers only. They never
    // erase opacity/font/clip reasons or a descendant's independent signal.
    for (const el of inert.querySelectorAll("[hidden], [style]")) {
      if (el.querySelector("pre") || isCollapsedAnswer(el)) exemptions.add(el);
    }
    // No generated attributes: provenance lives in Maps. Incoming private
    // marks must still be stripped by every sanitizer copy path. Include any
    // surviving planted signal here so the spoof control exercises that gate.
    const planted = new Map();
    const roots = [inert];
    while (roots.length) for (const el of roots.pop().querySelectorAll(`[${CONCEALED_MARK}], template`)) {
      if (el.localName === "template" && el.content) roots.push(el.content);
      if (el.hasAttribute(CONCEALED_MARK)) planted.set(el, (el.getAttribute(CONCEALED_MARK) || "").split(" "));
    }
    const effective = new Map();
    function state(el) {
      if (effective.has(el)) return effective.get(el);
      const path = [], seen = new Set();
      for (let next = el; next && !effective.has(next) && !seen.has(next); next = parent(next)) {
        seen.add(next); path.push(next);
      }
      for (const node of path.reverse()) {
        const inherited = effective.get(parent(node));
        const s = style(node), carrier = copies.get(node);
        const signals = [...local(node), ...(planted.get(carrier) || []).filter(r => REASONS.includes(r))];
        const hidden = ["hidden", "collapse"].includes(s.visibility);
        const origin = hidden ? inherited?.origin || node : null;
        const persistent = [...(inherited?.persistent || [])];
        for (const r of ["display_none", "opacity_zero", "clipped"]) {
          if (signals.includes(r) && !(r === "display_none" && exemptions.has(carrier)) && !persistent.includes(r)) persistent.push(r);
        }
        const reasons = [...persistent, ...signals.filter(r => ["font_size_zero", "transparent_text", "same_color"].includes(r))];
        if (signals.includes("visibility_hidden") && !exemptions.has(carrier) && !exemptions.has(copies.get(origin))) reasons.push("visibility_hidden");
        effective.set(node, { persistent, origin, reason: REASONS.find(r => reasons.includes(r)) });
      }
      return effective.get(el);
    }
    const cleared = new Set();
    let previous = null;
    const groups = [];
    // Walk the completed captured tree, not clone-allocation order. This also
    // excludes shadow nodes allocated but rejected by the capture budget.
    const ordered = [];
    const todo = [inert.documentElement];
    while (todo.length) {
      const node = todo.pop();
      if (records.has(node)) ordered.push(node);
      const children = Array.from(node.content?.childNodes || node.childNodes || []);
      for (let i = children.length - 1; i >= 0; i -= 1) todo.push(children[i]);
    }
    for (const clone of ordered) {
      const el = records.get(clone);
      const reason = state(el)?.reason;
      if (!reason) {
        // Clear inline hiding only along an actually visible descendant's
        // path, except fallback carriers whose text retains extraction rules.
        if (style(el).visibility === "visible") {
          for (let next = parent(el); next && !cleared.has(next); next = parent(next)) {
            cleared.add(next);
            const carrier = copies.get(next);
            if (!exemptions.has(carrier) && ["hidden", "collapse"].includes(style(next).visibility)) carrier?.style?.removeProperty("visibility");
          }
        }
        previous = null;
        continue;
      }
      let block = clone.parentElement;
      while (block?.parentElement && !BLOCK.test(block.localName)) block = block.parentElement;
      if (!previous || previous.block !== block || previous.reason !== reason) {
        previous = { block, reason, text: "", nodes: /** @type {Text[]} */ ([]) };
        groups.push(previous);
      }
      previous.text += clone.nodeValue || "";
      previous.nodes.push(clone);
    }
    let stored = 0;
    for (const { reason, text, nodes } of groups) {
      // Use the selected reason and raw run boundaries before report capping.
      // A removes all source whitespace; B preserves whitespace-only runs and
      // replaces substantive runs with one space only at a source boundary.
      const removesWhitespace = reason === "display_none" || reason === "font_size_zero";
      const substantive = !!text.trim();
      if (!removesWhitespace && !substantive) continue;
      if (!removesWhitespace && /^\s|\s$/.test(text)) nodes[0].before(inert.createTextNode(" "));
      for (const node of nodes) node.remove();
      if (!substantive) continue;
      summary.count += 1;
      summary.chars += text.length;
      const captured = text.slice(0, Math.min(CONCEALED_BLOCK_LIMIT, CONCEALED_TOTAL_LIMIT - stored));
      if (entries.length < CONCEALED_ENTRY_LIMIT) {
        entries.push({ reason, chars: text.length, text: captured });
        stored += captured.length;
      } else summary.truncated = true;
      if (captured.length < text.length) summary.truncated = true;
    }
    for (const el of computedHidden) el.removeAttribute("hidden");
    // Includes template contents, which Document.querySelectorAll omits.
    for (const el of planted.keys()) el.removeAttribute(CONCEALED_MARK);
  }
  return { copy, exempt, lift, entries, summary, get check() { return check; }, get pendingOpacity() { return pending.size; } };
}
