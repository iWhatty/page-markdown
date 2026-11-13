import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { sanitizeToInertDocument } from '../src/sanitize.js';
import { createConcealmentWalk } from '../src/concealed.js';

function measure(depth, concealed = false, varied = false, options = { detectConcealedText: true }) {
  const containers = depth - 3;
  const leaves = 2000 - 3 - containers;
  const { document } = parseHTML('<html><head></head><body>' + '<div>'.repeat(containers)
    + '<span>Visible words </span>'.repeat(leaves) + '</div>'.repeat(containers) + '</body></html>');
  const defaults = { display: 'block', visibility: 'visible', opacity: '1', fontSize: '16px', position: 'static',
    clip: 'auto', clipPath: 'none', transitionProperty: 'all', transitionDuration: '0s', animationName: 'none',
    animationDuration: '0s', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
    backgroundClip: 'border-box', textShadow: 'none', webkitBackgroundClip: 'border-box',
    webkitTextFillColor: 'rgb(0, 0, 0)', webkitTextStrokeWidth: '0px' };
  const calls = new Map(), reads = new Map();
  const palette = new Map([...document.querySelectorAll('*')].map((el, i) => [el, `rgb(${i % 200}, ${210 + i % 40}, ${240 + i % 15})`]));
  const Parser = document.defaultView.DOMParser;
  Object.defineProperty(document, 'defaultView', { value: { DOMParser: Parser, getComputedStyle(el) {
    calls.set(el, (calls.get(el) || 0) + 1);
    if (!reads.has(el)) reads.set(el, new Map());
    return new Proxy(defaults, { get(target, field) {
      const counts = reads.get(el);
      counts.set(field, (counts.get(field) || 0) + 1);
      if (concealed && el === document.querySelector('span') && field === 'opacity') return '0';
      if (varied && field === 'backgroundColor') return palette.get(el);
      return target[field];
    } });
  } } });
  let writes = 0;
  const set = Map.prototype.set, add = Set.prototype.add;
  // Observe the immediate caller, independently of the detector's counters.
  // Stub and clone-walk collections are outside the detector's allocation rule.
  function detectorWrite() { if (new Error().stack.split('\n')[3]?.includes('/src/concealed.js:')) writes++; }
  Map.prototype.set = function(...args) { detectorWrite(); return set.apply(this, args); };
  Set.prototype.add = function(...args) { detectorWrite(); return add.apply(this, args); };
  let capture;
  try {
    capture = sanitizeToInertDocument(document, options);
    capture.concealment.lift(capture.document);
  } finally { Map.prototype.set = set; Set.prototype.add = add; }
  if (capture.concealment.check === 'disabled') return {
    check: capture.concealment.check, counters: capture.concealment.counters, writes,
    calls: calls.size, reads: reads.size,
  };
  assert.equal(capture.concealment.check, 'computed');
  assert.equal(capture.concealment.entries.length, concealed ? 1 : 0);
  assert.equal(document.querySelectorAll('*').length, 2000);
  assert.equal(calls.size, 2000, 'the whole fixed fixture was checked');
  // The full capability probe is separate from per-element processing.
  const probe = reads.get(document.documentElement);
  for (const field of Object.keys(defaults)) probe.set(field, probe.get(field) - 1);
  calls.set(document.documentElement, calls.get(document.documentElement) - 1);
  return { counters: capture.concealment.counters, writes,
    ordinary: [...document.querySelectorAll('span')].slice(concealed ? 1 : 0).map(el => [...reads.get(el).values()].reduce((a, b) => a + b, 0)),
    containers: [...document.querySelectorAll('html,head,body,div')].map(el => [...reads.get(el).values()].reduce((a, b) => a + b, 0)),
    calls: [...calls.values()], reads: [...reads.values()].flatMap(m => [...m.values()]),
    total: [...reads.values()].reduce((sum, m) => sum + [...m.values()].reduce((a, b) => a + b, 0), 0) };
}

test('default disabled detector makes zero style calls, reads, ancestry reads or collection writes', () => {
  for (const depth of [6, 30]) for (const options of [{}, { detectConcealedText: false }]) {
    const result = measure(depth, true, false, options);
    assert.equal(result.check, 'disabled');
    assert.equal(result.calls, 0);
    assert.equal(result.reads, 0);
    assert.equal(result.writes, 0);
    assert.ok(Object.values(result.counters).every(n => n === 0));
  }
  const { document } = parseHTML('<html><body><span>Visible words</span></body></html>');
  let ancestryReads = 0;
  // Count independently of detector counters, including inherit()'s early path.
  for (const enabled of [undefined, false]) {
    const walk = createConcealmentWalk(document, enabled);
    for (const source of [document.querySelector('span'), document.querySelector('span').firstChild]) {
      const child = new Proxy(source, { get(target, field) {
        if (['assignedSlot', 'parentElement', 'getRootNode'].includes(field)) ancestryReads++;
        return Reflect.get(target, field, target);
      } });
      const work = walk.initial(child);
      walk.inherit(work, child);
    }
  }
  assert.equal(ancestryReads, 0, 'disabled detector makes zero ancestry reads');
});

test('concealed style calls and property reads stay bounded on both depth fixtures', t => {
  // Before slice 4 (probe included): depth 30 = 19,949; depth 6 = 19,997.
  // After (probe separate): depth 30 = 17,910; depth 6 = 17,982.
  // One probe adds one call and 19 reads; no outside ancestors or rereads here.
  const totals = [];
  for (const depth of [30, 6]) {
    const result = measure(depth);
    t.diagnostic(`depth ${depth}: ${result.calls.length} elements, ${result.total} property reads; max reads ${Math.max(...result.reads)}`);
    assert.ok(result.calls.every(n => n <= 1), 'one getComputedStyle per element');
    assert.ok(result.reads.every(n => n <= 1), 'no computed property read twice per element');
    assert.ok(result.ordinary.every(n => n <= 9), 'ordinary contrasting text reads at most nine properties');
    assert.ok(result.containers.every(n => n <= 6), 'ordinary wrappers read at most six properties');
    assert.equal(result.counters.recordsCreated, 0, 'visible text creates zero records');
    assert.equal(result.counters.slowPathEntries, 0, 'ordinary elements enter no slow path');
    assert.equal(result.writes, 0, 'ordinary detector collection writes must be zero');
    assert.equal(result.counters.styleCalls - result.counters.probeStyleCalls, 2000);
    assert.ok(result.total <= 18000, 'at most 18000 ordinary property reads for 2000 elements');
    totals.push(result.total);
  }
  assert.ok(Math.max(...totals) / Math.min(...totals) <= 1.01, 'depth changes reads by at most 1%');
});

test('varied opaque visible colours allocate no detector collection entries', () => {
  for (const depth of [6, 30]) {
    const result = measure(depth, false, true);
    assert.equal(result.counters.recordsCreated, 0);
    assert.equal(result.counters.slowPathEntries, 0);
    assert.equal(result.writes, 0, 'ordinary detector collection writes must be zero');
  }
});

test('one concealed paragraph has proportional records and slow work', t => {
  for (const depth of [6, 30]) {
    const result = measure(depth, true);
    t.diagnostic(`depth ${depth}: ${JSON.stringify(result.counters)}; collection writes ${result.writes}`);
    assert.equal(result.counters.recordsCreated, 1);
    assert.ok(result.counters.slowPathEntries <= 4);
    assert.ok(result.writes <= 10);
  }
});
