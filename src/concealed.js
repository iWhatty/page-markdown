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
const LOCAL_TEXT = ["visibility_hidden", "font_size_zero", "transparent_text", "same_color"];

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
  const rect = /^rect\(\s*((?:-?(?:\d*\.)?\d+px|0)(?:[\s,]+(?:-?(?:\d*\.)?\d+px|0)){3})\s*\)$/.exec(style.clip || "");
  const edges = rect?.[1].split(/[\s,]+/).map(parseFloat);
  return (["absolute", "fixed"].includes(style.position) && edges && (edges[0] === edges[2] || edges[1] === edges[3]))
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
  /** @type {import('./types.js').ConcealedText[]} */
  const entries = [];
  const summary = { count: 0, chars: 0, truncated: false };

  function style(el) {
    if (styles.has(el)) return styles.get(el);
    const result = {};
    try {
      const raw = view?.getComputedStyle(el);
      // Capability requires a callable source-view method returning nonempty
      // strings for every property used. Partial reads are incomplete, and
      // only successfully read, recognized values can establish concealment.
      // Unsupported prefixed properties cannot paint text. Read them only if
      // exposed; an exposed but unavailable value still makes this incomplete.
      for (const field of [...FIELDS, ...OPTIONAL_FIELDS.filter((field) => raw && field in raw)]) {
        try {
          result[field] = typeof raw?.[field] === "string" ? raw[field].trim().toLowerCase() : "";
        } catch { result[field] = ""; }
        if (!result[field]) check = "incomplete";
      }
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
    if (!s.backgroundClip || s.backgroundClip.split(/\s*,\s*/).includes("text")
      || s.webkitBackgroundClip === "" || s.webkitBackgroundClip?.split(/\s*,\s*/).includes("text")
      || s.textShadow !== "none"
      || (s.webkitTextStrokeWidth !== undefined && !/^0(?:\.0+)?px$/.test(s.webkitTextStrokeWidth))) return;
    const c = colour(s.color);
    if (!c) return;
    const fill = s.webkitTextFillColor === undefined ? c : colour(s.webkitTextFillColor);
    if (!fill || (fill[3] !== 0 && !equalColour(c, fill))) return;
    if (fill[3] === 0) return "transparent_text";
    if (equalColour(c, background(el))) return "same_color";
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
    if (/^0(?:\.0+)?px$/.test(s.fontSize || "")) reasons.push("font_size_zero");
    if (clipped(s)) reasons.push("clipped");
    // Colour belongs to this element's own text, never its overriding children.
    if (Array.from(el.childNodes || []).some((node) => node.nodeType === 3 && node.nodeValue)) {
      const reason = textColour(el, s);
      if (reason) reasons.push(reason);
    }
    localReasons.set(el, reasons);
    return reasons;
  }

  function copy(live, clone) {
    if (!active) return;
    if (live.nodeType === 1) {
      copies.set(live, clone);
      const reasons = local(live);
      if (reasons.length) clone.setAttribute(CONCEALED_MARK, reasons.join(" "));
      if (reasons.some((r) => r === "display_none" || r === "visibility_hidden") && !clone.hasAttribute("hidden")) {
        clone.setAttribute("hidden", "");
        computedHidden.add(clone);
      }
    } else if (live.nodeType === 3) {
      if (live.parentElement?.closest("head")) return; // metadata is outside this check
      const chain = [];
      const seen = new Set();
      for (let el = live.assignedSlot || live.parentElement; el && !seen.has(el); el = parent(el)) {
        seen.add(el);
        const reasons = local(el).filter((r) => chain.length === 0 || !LOCAL_TEXT.includes(r));
        chain.push({ el, reasons });
      }
      records.set(clone, chain);
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
      const chain = records.get(clone);
      const reasons = [];
      for (const { el, reasons: detected } of chain) {
        const carrier = copies.get(el);
        // Read the private mark as well as external ancestor provenance. The
        // sanitizer must strip every incoming mark before adding our own.
        const signals = carrier ? (carrier.getAttribute(CONCEALED_MARK) || "").split(" ") : detected;
        for (const reason of signals) {
          if (!detected.includes(reason) && carrier && !REASONS.includes(reason)) continue;
          if (chain[0].el !== el && LOCAL_TEXT.includes(reason)) continue;
          if (exemptions.has(carrier) && ["display_none", "visibility_hidden"].includes(reason)) continue;
          // Computed visibility is inherited. Attribute the uninterrupted
          // hidden chain to its outermost hidden ancestor, so the existing
          // panel/answer exception also preserves inherited hidden text.
          if (reason === "visibility_hidden") {
            let origin = el;
            for (let next = parent(origin); next && ["hidden", "collapse"].includes(style(next).visibility); next = parent(origin)) origin = next;
            if (exemptions.has(copies.get(origin))) continue;
          }
          reasons.push(reason);
        }
      }
      const reason = REASONS.find((r) => reasons.includes(r));
      if (!reason) {
        // Clear inline hiding only along an actually visible descendant's
        // path, except fallback carriers whose text retains extraction rules.
        if (style(chain[0].el).visibility === "visible") {
          for (const { el } of chain.slice(1)) {
            const carrier = copies.get(el);
            if (!exemptions.has(carrier) && ["hidden", "collapse"].includes(style(el).visibility)) carrier?.style?.removeProperty("visibility");
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
    for (const el of copies.values()) el.removeAttribute(CONCEALED_MARK);
  }
  return { copy, exempt, lift, entries, summary, get check() { return check; }, get pendingOpacity() { return pending.size; } };
}
