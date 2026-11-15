import Readability from '@mozilla/readability/Readability.js';
import { runPipeline } from './pipeline.js';
import { sanitizeToInertDocument as sanitize } from './sanitize.js';

// Trial-only source observations. Callers must branch BEFORE constructing this
// object. No live DOM writes, style reads, text searches or extra parse passes.
export const SOURCE_MARK = 'data-page-markdown-source';
const BLOCK = /^(?:address|article|aside|blockquote|body|dd|div|dl|dt|figcaption|figure|h[1-6]|li|main|ol|p|pre|section|table|td|th|tr|ul)$/;
const NODE_LIMIT = 100000, DEPTH_LIMIT = 256, TEXT_LIMIT = 500000;
const JSON_LIMIT = 500000, ENTRY_LIMIT = 100, RANGE_LIMIT = 256, PASS_LIMIT = 8;
const NODE_TYPE = 'nodeType', FIRST_CHILD = 'firstChild', NEXT_SIBLING = 'nextSibling';
const NODE_VALUE = 'nodeValue', LOCAL_NAME = 'localName';

// Explicit allocation sites are factories so tests can independently instrument
// them (and DOM reads) with Node's loader hooks; production has no observer.
function record(value) { return value; }
/** @returns {any[]} */
function list() { return []; }
function table() { return new Map(); }
function dom(node, key) { return node?.[key]; }
function hash(text, value = 0) {
  for (let i = 0; i < text.length; i++) value = (Math.imul(value, 16777619) + text.charCodeAt(i)) >>> 0;
  return value;
}
function combine(value, suffix, length) {
  let power = 1, factor = 16777619;
  for (; length; length = Math.floor(length / 2), factor = Math.imul(factor, factor)) if (length % 2) power = Math.imul(power, factor);
  return (Math.imul(value, power) + suffix) >>> 0;
}
function sourceOrder(a, b) { return a.order - b.order || a.start - b.start; }

function population(entries, omitted, check, incomplete) {
  return record({ recorded: entries.length, omitted: check === 'incomplete' ? 'unknown' : omitted,
    knownOmitted: omitted, status: check === 'disabled' || check === 'static-only' ? 'not-checked'
      : check === 'incomplete' || omitted || incomplete ? 'incomplete' : 'complete' });
}

// JSON character accounting, including escaping, without stringify, temporary
// per-character strings or a copied/encoded body. Not the HELIOS bridge preflight.
export function jsonCharacters(value, remaining = JSON_LIMIT) {
  let count = 0;
  if (typeof value === 'string') {
    count = 2;
    for (let i = 0; i < value.length && count <= remaining; i++) {
      const c = value.charCodeAt(i);
      count += c === 34 || c === 92 ? 2 : c < 32 ? (c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6)
        : c >= 0xd800 && c <= 0xdbff ? (value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff ? (++i, 2) : 6)
        : c >= 0xdc00 && c <= 0xdfff ? 6 : 1;
    }
    return count;
  }
  if (value === null) return 4;
  if (typeof value === 'boolean') return value ? 4 : 5;
  if (typeof value === 'number') return String(value).length;
  count = 2;
  let first = true;
  for (const key in value) {
    if (count > remaining) break;
    if (!first) count++;
    first = false;
    if (!Array.isArray(value)) count += jsonCharacters(key, remaining - count) + 1;
    count += jsonCharacters(value[key], remaining - count);
  }
  return count;
}

// Readability 0.6.0 unwraps a single P without copying its parent's attributes,
// and copies DIV/SECTION ancestor attributes over the child's attributes. Its
// predicate proves those discarded parents contain only surrounding whitespace.
// Preserve the child's carrier, or transfer direct text newly wrapped in P.
// This changes only our inert attribute, never markup, scoring or page text.
class TrialReadability extends /** @type {any} */ (Readability) {
  _hasSingleTagInsideElement(element, tag) {
    const single = super._hasSingleTagInsideElement(element, tag);
    if (single && (tag === 'P' || tag === 'DIV' || tag === 'SECTION')) {
      const token = element.getAttribute(SOURCE_MARK);
      if (token !== null) {
        const child = element.firstElementChild;
        if (tag === 'P' && !child.hasAttribute(SOURCE_MARK)) child.setAttribute(SOURCE_MARK, token);
        element.removeAttribute(SOURCE_MARK);
      }
    }
    return single;
  }
}

export class Trial {
  get Reader() { return TrialReadability; }
  get sourceMark() { return SOURCE_MARK; }

  // Capture-local state; public diagnostic records keep their schema names.
  #startedAt; #sources; #copies; #carriers; #outputs; #admitted;
  #blocks; #pending; #colours; #lifted; #projections; #rewrite; #rewriteIndex;
  #nodes; #depth; #units; #syntheticUnits; #reserved; #passes;
  #incomplete; #limit; #censusIncomplete; #provenanceIncomplete;
  #pendingOmitted; #colourOmitted; #liftedOmitted; #colourTruncated;
  #stampIncomplete; #previousIncomplete; #passNodes; #passUnits; #outputSequence;

  // The cap fixtures inspect these observations and reserve boundary capacity.
  get units() { return this.#units; }
  get incomplete() { return this.#incomplete; }
  get depth() { return this.#depth; }
  get nodes() { return this.#nodes; }
  get sources() { return this.#sources; }
  get projections() { return this.#projections; }
  get limit() { return this.#limit; }
  get censusIncomplete() { return this.#censusIncomplete; }
  get passes() { return this.#passes; }
  get provenanceIncomplete() { return this.#provenanceIncomplete; }
  get colours() { return this.#colours; }
  get reserved() { return this.#reserved; }
  set reserved(value) { this.#reserved = value; }
  get pending() { return this.#pending; }
  get pendingOmitted() { return this.#pendingOmitted; }

  constructor(root) {
    this.#startedAt = Date.now();
    this.titleAdded = false;
    this.#sources = table();
    this.#copies = table();
    this.#carriers = table();
    this.#outputs = table();
    this.#admitted = table();
    /** @type {import('./types.js').TrialBlock[]} */
    this.#blocks = list();
    this.#pending = list();
    this.#colours = list();
    this.#lifted = list();
    this.#projections = list();
    this.#rewrite = list();
    this.#rewriteIndex = 0;
    this.#nodes = 0;
    this.#depth = 0;
    this.#units = 0;
    this.#syntheticUnits = 0;
    this.#reserved = 4096;
    this.#passes = 0;
    this.#incomplete = false;
    this.#limit = '';
    this.#censusIncomplete = false;
    this.#pendingOmitted = this.#colourOmitted = this.#liftedOmitted = 0;
    this.#provenanceIncomplete = false;
    this.#stampIncomplete = false;
    this.#previousIncomplete = false;
    this.#passNodes = 0;
    this.#passUnits = 0;
    this.#colourTruncated = false;
    this.element = null;
    this.#outputSequence = 0;
    this.census(dom(root, NODE_TYPE) === 9 ? root : dom(root, 'ownerDocument'), '', 0, -1, '');
    this.#censusIncomplete = this.#incomplete;
  }
  #reserve(chars) {
    if (this.#reserved + chars > JSON_LIMIT) { this.#incomplete = true; this.#limit ||= 'diagnostic-characters'; return false; }
    this.#reserved += chars;
    return true;
  }
  census(node, locator, depth, owner, blockLocator) {
    if (this.#incomplete) return;
    if (this.#nodes === NODE_LIMIT || depth > DEPTH_LIMIT) {
      this.#incomplete = true;
      this.#limit ||= this.#nodes === NODE_LIMIT ? 'source-nodes' : 'source-depth';
      return;
    }
    const kind = dom(node, NODE_TYPE);
    const name = kind === 1 ? dom(node, LOCAL_NAME) : '';
    const info = record({ locator, order: this.#nodes++, last: 0, owner, range: null, depth });
    this.#depth = Math.max(depth, this.#depth);
    this.#sources.set(node, info);
    if (BLOCK.test(name)) { owner = -1; blockLocator = locator; }
    // A block's own direct content is a segment. A nested block interrupts it.
    let segment = owner;
    if (kind === 3) {
      const length = dom(node, 'length');
      if (length > TEXT_LIMIT - this.#units) { this.#incomplete = true; this.#limit ||= 'source-units'; return; }
      if (!this.#reserve(100 + locator.length)) return;
      if (segment < 0) {
        if (!this.#reserve(300 + locator.length * 2 + blockLocator.length * 2)) return;
        segment = this.#blocks.length;
        this.#blocks.push(record({ id: `source-locator.v1:${blockLocator}@${locator}:0`, locator: blockLocator,
          fingerprint: 0, ranges: list(), membership: 'unmatched', retained: list(), removed: list(), outputBlocks: list() }));
      }
      const text = dom(node, NODE_VALUE) || '';
      info.text = text;
      const block = this.#blocks[segment];
      info.value = hash(text);
      info.length = length;
      block.fingerprint = combine(block.fingerprint, info.value, length);
      info.range = record({ locator, start: 0, end: length, block: segment, order: info.order });
      info.owner = segment;
      block.ranges.push(info.range);
      this.#units += length;
    } else {
      const content = kind === 1 && name === 'template' ? dom(node, 'content') : null;
      if (content) {
        if (depth === DEPTH_LIMIT || this.#nodes === NODE_LIMIT) {
          this.#incomplete = true;
          this.#limit ||= depth === DEPTH_LIMIT ? 'source-depth' : 'source-nodes';
        } else {
          const templateLocator = `${locator}/template`;
          this.census(content, templateLocator, depth + 1, -1, templateLocator);
        }
        segment = -1;
      } else {
        // linkedom's DocumentType.nextSibling is null even when the document
        // contains an HTML sibling. Indexed document children preserve all-node
        // root indexes in both native DOM and that static DOM implementation.
        const documentChildren = kind === 9 ? dom(node, 'childNodes') : null;
        let index = 0;
        for (let child = documentChildren ? documentChildren[index] : dom(node, FIRST_CHILD); child && !this.#incomplete;
          child = documentChildren ? documentChildren[index] : dom(child, NEXT_SIBLING)) {
          if (this.#nodes === NODE_LIMIT) { this.#incomplete = true; this.#limit ||= 'source-nodes'; break; }
          if (depth === DEPTH_LIMIT) { this.#incomplete = true; this.#limit ||= 'source-depth'; break; }
          const childBlock = dom(child, NODE_TYPE) === 1 && BLOCK.test(dom(child, LOCAL_NAME));
          if (childBlock) segment = -1;
          this.census(child, `${locator}/${index++}`, depth + 1, segment, blockLocator);
          const childInfo = this.#sources.get(child);
          if (!childBlock && childInfo) segment = childInfo.owner;
          else segment = -1;
        }
      }
      const shadow = kind === 1 ? dom(node, 'shadowRoot') : null;
      if (shadow) {
        if (depth === DEPTH_LIMIT || this.#nodes === NODE_LIMIT) {
          this.#incomplete = true;
          this.#limit ||= depth === DEPTH_LIMIT ? 'source-depth' : 'source-nodes';
        } else if (!this.#incomplete) {
          const shadowLocator = `${locator}/shadow`;
          this.census(shadow, shadowLocator, depth + 1, -1, shadowLocator);
        }
      }
      info.owner = segment;
    }
    info.last = this.#nodes;
  }
  associate(live, copy) {
    const info = this.#sources.get(live);
    if (info) {
      this.#copies.set(copy, info);
      const slot = dom(live, 'assignedSlot');
      if (slot && !info.projected) {
        const via = this.#sources.get(slot);
        if (via?.depth === DEPTH_LIMIT) { this.#exhaust('locator-depth'); return; }
        if (via && this.#reserve(100 + info.locator.length + via.locator.length)) {
          this.#projections.push(record({ source: info.locator, via: `${via.locator}/slot` }));
          info.projectedVia = via;
          info.projected = true;
        } else this.#provenanceIncomplete = true;
      }
    } else {
      this.#provenanceIncomplete = this.#incomplete = this.#censusIncomplete = true;
      this.#limit ||= 'source-association';
    }
  }
  generated(node, text, origin) {
    if (!node || this.#censusIncomplete || this.#limit === 'diagnostic-characters' || !this.#copies.has(origin) || text.length > TEXT_LIMIT - this.#units - this.#syntheticUnits) {
      this.#provenanceIncomplete = true;
      return;
    }
    this.#syntheticUnits += text.length;
    this.#copies.set(node, record({ ranges: list(), text, length: text.length }));
  }
  #exhaust(limit) {
    this.#incomplete = this.#provenanceIncomplete = true;
    this.#limit ||= limit;
  }
  pendingElement(el) {
    if (this.#pending.length === ENTRY_LIMIT) { this.#pendingOmitted++; return; }
    const info = this.#sources.get(el);
    if (!info || !this.#reserve(256 + info.locator.length * 6)) { this.#pendingOmitted++; return; }
    this.#pending.push(record({ locator: info.locator, blockIds: list(), first: info.order, last: info.last }));
  }
  colour(el, property, raw, normalized = raw) {
    if (this.#colours.length === ENTRY_LIMIT) { this.#colourOmitted++; return; }
    const info = this.#sources.get(el);
    const length = Math.min(raw.length, 2048);
    if (!info || !this.#reserve(256 + info.locator.length * 6 + length * 6)) { this.#colourOmitted++; return; }
    if (raw.length > length) this.#colourTruncated = true;
    this.#colours.push(record({ locator: info.locator, property, raw: raw.slice(0, length), truncated: raw.length > length,
      syntax: normalized.startsWith('oklch(') ? 'oklch' : normalized.startsWith('color(display-p3 ') ? 'display-p3' : 'other' }));
  }
  lift(nodes, reason, entry) {
    if (this.#lifted.length === ENTRY_LIMIT) { this.#liftedOmitted++; return; }
    if (!this.#reserve(128)) { this.#liftedOmitted++; return; }
    const ranges = list();
    for (const node of nodes) {
      const info = this.#copies.get(node);
      if (!info?.range || ranges.length === RANGE_LIMIT || !this.#reserve(128 + info.range.locator.length * 6)) {
        this.#provenanceIncomplete = true; break;
      }
      ranges.push(info.range);
    }
    this.#lifted.push(record({ entry, reason, ranges }));
  }
  // The existing code-text walk supplies exact transformation order. Synthetic
  // line breaks are additions, not source ranges. No extra text scan/pass.
  codeRange(node, trace) {
    const info = this.#copies.get(node);
    if (info?.range) {
      if (trace.ranges.length < RANGE_LIMIT && this.#reserve(64)) trace.ranges.push(info.range);
      else this.#exhaust('output-range-references');
      trace.value = combine(trace.value, info.value, info.length);
      trace.length += info.length;
    }
  }
  codeBoundary(trace) { trace.value = (Math.imul(trace.value, 16777619) + 10) >>> 0; trace.length++; }
  codeStart(pre) {
    if (this.#censusIncomplete || this.#limit === 'diagnostic-characters' || !this.#copies.has(pre)) {
      this.#provenanceIncomplete = true;
      return null;
    }
    return record({ ranges: list(), value: 0, length: 0 });
  }
  codeEnd(node, trace, text) {
    trace.text = text;
    if (node) this.#copies.set(node, trace);
  }
  #rememberText(node) {
    if (dom(node, NODE_TYPE) !== 3) return;
    const info = this.#copies.get(node);
    if (!info) { this.#provenanceIncomplete = true; return; }
    this.#rewrite.push(info);
  }
  #rebindText(node) {
    if (dom(node, NODE_TYPE) !== 3) return;
    const info = this.#rewrite[this.#rewriteIndex++];
    const length = dom(node, 'length');
    if (!info || length !== info.length || length > TEXT_LIMIT - this.#passUnits) { this.#provenanceIncomplete = true; return; }
    this.#passUnits += length;
    if (dom(node, NODE_VALUE) !== info.text) { this.#provenanceIncomplete = true; return; }
    this.#copies.set(node, info);
  }
  beforeRewrite(root) {
    // Keep five passes available for stamp, both extraction candidates, a
    // possible full fallback, and final carrier cleanup.
    if (this.#censusIncomplete || this.#limit === 'diagnostic-characters' || this.#passes + 2 + 5 > PASS_LIMIT) { this.#exhaust('inert-passes'); return false; }
    this.#rewrite.length = 0;
    this.#rewriteIndex = 0;
    return this.pass(root, this.#rememberText);
  }
  afterRewrite(root) {
    this.pass(root, this.#rebindText);
    if (this.#rewriteIndex !== this.#rewrite.length) this.#provenanceIncomplete = true;
    this.#rewrite.length = 0;
  }
  // Bounded cursor walk: no child-list spreads or per-node traversal frames.
  #admit(node, depth) {
    if (depth > DEPTH_LIMIT) { this.#exhaust('inert-depth'); return false; }
    if (this.#admitted.has(node)) return true;
    if (this.#passNodes === NODE_LIMIT) { this.#exhaust('inert-nodes'); return false; }
    this.#admitted.set(node, true);
    this.#passNodes++;
    return true;
  }
  #walk(node, action, depth = 0, output = -1) {
    if (!this.#admit(node, depth)) return;
    if (action === this.#observe && dom(node, NODE_TYPE) === 1 && BLOCK.test(dom(node, LOCAL_NAME))) output = this.#outputSequence++;
    const content = dom(node, 'content');
    if (content && !this.#admit(content, depth + 1)) return;
    action.call(this, node, output, depth, content || node, depth + (content ? 2 : 1));
    if (content) { this.#walk(content, action, depth + 1, output); return; }
    for (let child = dom(node, FIRST_CHILD); child; child = dom(child, NEXT_SIBLING)) {
      if (!this.#admit(child, depth + 1)) break;
      this.#walk(child, action, depth + 1, output);
    }
  }
  pass(root, action) {
    if (this.#passes === PASS_LIMIT) { this.#exhaust('inert-passes'); return false; }
    this.#passes++;
    this.#passNodes = 0;
    this.#passUnits = 0;
    this.#admitted.clear();
    this.#walk(dom(root, NODE_TYPE) === 9 ? dom(root, 'documentElement') : root, action);
    return true;
  }
  #stamp(node, output, depth, target, childDepth) {
    if (dom(node, NODE_TYPE) !== 1) return;
    let ranges = null, text = '', length = 0;
    for (let child = dom(target, FIRST_CHILD); child; child = dom(child, NEXT_SIBLING)) {
      if (!this.#admit(child, childDepth)) return;
      if (dom(child, NODE_TYPE) !== 3) continue;
      const size = dom(child, 'length');
      if (size > TEXT_LIMIT - this.#passUnits) { this.#exhaust('source-units'); return; }
      this.#passUnits += size;
      if (!ranges) ranges = list();
      const info = this.#copies.get(child);
      if (!info) {
        this.#provenanceIncomplete = true;
        return;
      }
      if (info.range) {
        if (ranges.length === RANGE_LIMIT) { this.#exhaust('output-range-references'); return; }
        ranges.push(info.range);
      } else for (const range of info.ranges) {
        if (ranges.length === RANGE_LIMIT) { this.#exhaust('output-range-references'); return; }
        ranges.push(range);
      }
      text += info.text;
      length += size;
    }
    if (!ranges) return;
    const token = String(this.#carriers.size);
    this.#carriers.set(token, record({ ranges, text, length, seen: 0 }));
    dom(node, 'setAttribute').call(node, SOURCE_MARK, token);
  }
  start(inert) {
    if (this.#limit === 'diagnostic-characters') { this.#provenanceIncomplete = true; return; }
    this.pass(inert, this.#stamp);
    this.#stampIncomplete = this.#provenanceIncomplete;
  }
  #observe(node, output, depth, target, childDepth) {
    if (dom(node, NODE_TYPE) !== 1) return;
    const token = dom(node, 'getAttribute').call(node, SOURCE_MARK);
    if (token === null) {
      // An extractor may unwrap or replace a carrier while retaining its text.
      // Without a surviving token that text has no verified source membership.
      for (let child = dom(target, FIRST_CHILD); child; child = dom(child, NEXT_SIBLING)) {
        if (!this.#admit(child, childDepth)) break;
        if (dom(child, NODE_TYPE) === 3 && dom(child, 'length')) { this.#provenanceIncomplete = true; break; }
      }
      return;
    }
    const carrier = this.#carriers.get(token);
    dom(node, 'removeAttribute').call(node, SOURCE_MARK);
    if (!carrier) { this.#provenanceIncomplete = true; return; }
    carrier.seen++;
    const references = this.#outputs.get(output) || 0;
    if (references + carrier.ranges.length > RANGE_LIMIT) { this.#exhaust('output-range-references'); return; }
    this.#outputs.set(output, references + carrier.ranges.length);
    if (!this.#reserve(32)) { this.#provenanceIncomplete = true; return; }
    carrier.output = `output:${output}`;
    let text = '', length = 0;
    for (let child = dom(target, FIRST_CHILD); child; child = dom(child, NEXT_SIBLING)) {
      if (!this.#admit(child, childDepth)) return;
      if (dom(child, NODE_TYPE) !== 3) continue;
      const size = dom(child, 'length');
      if (size > TEXT_LIMIT - this.#passUnits) { this.#exhaust('source-units'); return; }
      if (size > carrier.length - length) { this.#provenanceIncomplete = true; return; }
      this.#passUnits += size;
      text += dom(child, NODE_VALUE) || '';
      length += size;
    }
    if (text !== carrier.text || length !== carrier.length || carrier.seen !== 1) {
      this.#provenanceIncomplete = true;
      return;
    }
  }
  // Observing selected DOM happens inside its existing serialization. Attributes
  // never reach conversion/custom extraction. Candidate collection is deferred
  // until extraction has chosen its final result.
  select(root) {
    if (!this.#carriers.size) return;
    this.#previousIncomplete = this.#provenanceIncomplete;
    this.#provenanceIncomplete = this.#stampIncomplete;
    this.#outputs.clear();
    this.#outputSequence = 0;
    for (const carrier of this.#carriers.values()) {
      carrier.previousSeen = carrier.seen;
      carrier.previousOutput = carrier.output;
      carrier.seen = 0;
    }
    this.pass(root, this.#observe);
  }
  restoreSelection() {
    this.#provenanceIncomplete = this.#previousIncomplete;
    for (const carrier of this.#carriers.values()) {
      carrier.seen = carrier.previousSeen;
      carrier.output = carrier.previousOutput;
    }
  }
  strip(node) { if (dom(node, NODE_TYPE) === 1) dom(node, 'removeAttribute').call(node, SOURCE_MARK); }
  clean(root) { if (this.#carriers.size) this.pass(root, this.strip); }
  /**
   * @param {import('./types.js').ConcealmentCheck} check
   * @param {boolean} custom
   * @param {{title: boolean, recoveredLead: boolean, pageFacts: number}} additions
   * @param {boolean} [liftedTextTruncated]
   * @returns {import('./types.js').TrialDiagnostics}
   */
  finish(check, custom, additions, liftedTextTruncated = false) {
    // Map tokens back to source ranges, never by searching equal text.
    for (const carrier of this.#carriers.values()) {
      if (carrier.seen !== 1 || custom) continue;
      for (const range of carrier.ranges) {
        // This table lookup is populated during source census, not an ancestor
        // search or a text match.
        const block = this.#blocks[range.block];
        if (block.retained.length === RANGE_LIMIT || !this.#reserve(100 + range.locator.length)) {
          this.#provenanceIncomplete = true; break;
        }
        block.retained.push(range);
        const link = carrier.output;
        if (!block.outputBlocks.includes(link)) block.outputBlocks.push(link);
      }
    }
    // A slot (or its shadow ancestor) affects assigned source subtrees outside
    // its census interval. Expand intervals through projections, including
    // forwarded slots, with a shared work budget and bounded interval storage.
    let pendingWork = 0;
    for (const pending of this.#pending) {
      const regions = list();
      regions.push(pending);
      for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        const first = region.order ?? region.first;
        for (const info of this.#sources.values()) {
          if (++pendingWork > NODE_LIMIT) { this.#exhaust('pending-membership'); break; }
          if (info.range && info.order >= first && info.order < region.last) {
            const id = this.#blocks[info.owner].id;
            if (!pending.blockIds.includes(id)) {
              if (pending.blockIds.length === RANGE_LIMIT || !this.#reserve(id.length * 6 + 4)) { this.#exhaust('pending-membership'); break; }
              pending.blockIds.push(id);
            }
          }
          const via = info.projectedVia;
          if (via && via.order >= first && via.order < region.last && !regions.includes(info)) {
            if (regions.length === RANGE_LIMIT || !this.#reserve(64)) { this.#exhaust('pending-membership'); break; }
            regions.push(info);
          }
        }
        if (pendingWork > NODE_LIMIT || this.#limit === 'diagnostic-characters' || this.#limit === 'pending-membership') break;
      }
      delete pending.first;
      delete pending.last;
    }
    for (const block of this.#blocks) {
      if (!custom && !this.#provenanceIncomplete && !this.#censusIncomplete) for (const range of block.ranges) {
        if (!block.retained.includes(range)) {
          if (!this.#reserve(100 + range.locator.length)) { this.#provenanceIncomplete = true; break; }
          block.removed.push(range);
        }
      }
    }
    for (const block of this.#blocks) {
      block.retained.sort(sourceOrder);
      block.membership = custom || this.#provenanceIncomplete || this.#censusIncomplete ? 'unmatched'
        : block.retained.length === block.ranges.length ? 'retained' : block.retained.length ? 'partial' : 'removed';
      if (block.membership === 'unmatched') { block.retained.length = 0; block.removed.length = 0; block.outputBlocks.length = 0; }
    }
    return record({ schema: 'page-markdown.trial.v1', locatorSchema: 'source-locator.v1',
      detection: check, computedStyleCoverage: check === 'disabled' ? 'not-checked' : check,
      status: check === 'incomplete' || this.#incomplete || this.#provenanceIncomplete || custom || liftedTextTruncated || this.#colourTruncated || this.#pendingOmitted || this.#colourOmitted || this.#liftedOmitted ? 'incomplete' : 'complete',
      liftedTextTruncated,
      observedAt: record({ startedAt: this.#startedAt, finishedAt: Date.now() }),
      limit: this.#limit || (this.#provenanceIncomplete ? 'provenance' : null),
      census: record({ nodes: this.#nodes, maxDepth: this.#depth, sourceUnits: this.#units, omitted: this.#censusIncomplete ? 'unknown' : 0 }),
      blocks: this.#blocks, lifted: this.#lifted, pendingOpacity: this.#pending, unsupportedColours: this.#colours,
      projections: this.#projections,
      populations: record({ lifted: population(this.#lifted, this.#liftedOmitted, check, liftedTextTruncated || this.#provenanceIncomplete),
        blocks: record({ recorded: this.#blocks.length, omitted: this.#censusIncomplete ? 'unknown' : 0,
          status: this.#censusIncomplete ? 'incomplete' : 'complete' }),
        pendingOpacity: population(this.#pending, this.#pendingOmitted, check, this.#incomplete || this.#provenanceIncomplete),
        unsupportedColours: population(this.#colours, this.#colourOmitted, check, this.#colourTruncated) }),
      provenance: this.#provenanceIncomplete || this.#censusIncomplete || custom ? 'unmatched' : 'complete', additions,
      limits: record({ sourceNodes: NODE_LIMIT, sourceDepth: DEPTH_LIMIT, sourceUnits: TEXT_LIMIT,
        diagnosticCharacters: JSON_LIMIT, exceptionalRecords: ENTRY_LIMIT, rawColourUnits: 2048,
        inertPasses: PASS_LIMIT, outputRangeReferences: RANGE_LIMIT,
        liftedBlockUnits: 2048, liftedTotalUnits: 16384, liftedEntries: 100 }),
      plannerProtection: 'deferred: HELIOS planner can still receive concealed text' });
  }
}

/** @typedef {import('./pipeline.js').PageMarkdownOptions} PageMarkdownOptions */
/** @typedef {import('./types.js').PageMarkdownResult} PageMarkdownResult */
/** @typedef {import('./types.js').TrialDiagnostics} TrialDiagnostics */

/**
 * Diagnostic conversion; instrumented captures must be excluded from timings.
 * @param {Document|Element} input
 * @param {PageMarkdownOptions} [options]
 * @returns {PageMarkdownResult}
 */
export function pageToMarkdown(input, options = {}) {
  return runPipeline(input, options, options.diagnostics === 'trial' ? new Trial(input) : null);
}

/**
 * @param {Document|Element} input
 * @param {import('./types.js').SanitizeOptions & {diagnostics?: 'off'|'trial'}} [options]
 */
export function sanitizeToInertDocument(input, options = {}) {
  return sanitize(input, options, options.diagnostics === 'trial' ? new Trial(input) : null);
}
