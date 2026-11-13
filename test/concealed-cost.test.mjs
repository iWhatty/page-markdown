import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { sanitizeToInertDocument } from '../src/sanitize.js';

function measure(depth) {
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
  const Parser = document.defaultView.DOMParser;
  Object.defineProperty(document, 'defaultView', { value: { DOMParser: Parser, getComputedStyle(el) {
    calls.set(el, (calls.get(el) || 0) + 1);
    if (!reads.has(el)) reads.set(el, new Map());
    return new Proxy(defaults, { get(target, field) {
      const counts = reads.get(el);
      counts.set(field, (counts.get(field) || 0) + 1);
      return target[field];
    } });
  } } });
  const capture = sanitizeToInertDocument(document);
  capture.concealment.lift(capture.document);
  assert.equal(capture.concealment.check, 'computed');
  assert.deepEqual(capture.concealment.entries, []);
  assert.equal(document.querySelectorAll('*').length, 2000);
  assert.equal(calls.size, 2000, 'the whole fixed fixture was checked');
  return { ordinary: [...document.querySelectorAll('span')].map(el => [...reads.get(el).values()].reduce((a, b) => a + b, 0)),
    calls: [...calls.values()], reads: [...reads.values()].flatMap(m => [...m.values()]),
    total: [...reads.values()].reduce((sum, m) => sum + [...m.values()].reduce((a, b) => a + b, 0), 0) };
}

test('concealed style calls and property reads stay bounded on both depth fixtures', t => {
  // Before slice 3: 2,000 getComputedStyle calls and 76,000 property reads
  // at BOTH depths (19 exposed fields, each read twice per element).
  // Before this round: 27,829 reads at depth 30; 27,973 at depth 6 (14 per text element).
  // After this round: 19,949 at depth 30; 19,997 at depth 6 (10 per text element).
  // Bound includes the full capability probe; depth may vary reads by <=1%.
  // These counts do not bound JavaScript ancestry work: the old code also
  // had identical read counts at both depths.
  const totals = [];
  for (const depth of [30, 6]) {
    const result = measure(depth);
    t.diagnostic(`depth ${depth}: ${result.calls.length} elements, ${result.total} property reads; max reads ${Math.max(...result.reads)}`);
    assert.ok(result.calls.every(n => n <= 1), 'one getComputedStyle per element');
    assert.ok(result.reads.every(n => n <= 1), 'no computed property read twice per element');
    assert.ok(result.ordinary.every(n => n === 10), 'ordinary contrasting text reads ten properties');
    assert.ok(result.total <= 20000, 'at most 20000 property reads for 2000 elements');
    totals.push(result.total);
  }
  assert.ok(Math.max(...totals) / Math.min(...totals) <= 1.01, 'depth changes reads by at most 1%');
});
