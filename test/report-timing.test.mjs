import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { walkBaseline, pairedSummary, sanitizeStage } from './browser/report-timing.mjs';

test('matched style-read baseline consumes each fixture property once', () => {
  const { document } = parseHTML('<html><head></head><body><p>Visible</p><div></div></body></html>');
  const defaults = { display: 'block', visibility: 'visible', opacity: '1', clipPath: 'none', clip: 'auto',
    backgroundColor: 'rgb(255, 255, 255)', fontSize: '16px', color: 'rgb(0, 0, 0)', webkitTextFillColor: 'rgb(0, 0, 0)' };
  const reads = new Map();
  const DOMParser = document.defaultView.DOMParser;
  Object.defineProperty(document, 'defaultView', { value: { DOMParser, getComputedStyle(el) {
    reads.set(el, []);
    return new Proxy(defaults, { get(target, field) { reads.get(el).push(field); return target[field]; } });
  } } });
  assert.ok(Number.isFinite(walkBaseline(document, 4)));
  assert.equal(reads.size, 5);
  for (const [el, fields] of reads) {
    assert.equal(new Set(fields).size, fields.length, 'matched baseline reads no property twice');
    assert.equal(fields.length, el.localName === 'p' ? 9 : 6);
  }
});

test('sanitize timing includes production tab exemptions and lift', () => {
  const { document } = parseHTML('<html><head></head><body><div role="tabpanel" style="display:none">Visible tab</div></body></html>');
  const DOMParser = document.defaultView.DOMParser;
  const defaults = { display: 'block', visibility: 'visible', opacity: '1', clipPath: 'none', clip: 'auto',
    backgroundColor: 'rgba(0, 0, 0, 0)', fontSize: '16px', color: 'rgb(0, 0, 0)', position: 'static',
    transitionProperty: 'all', transitionDuration: '0s', animationName: 'none', animationDuration: '0s',
    backgroundImage: 'none', backgroundClip: 'border-box', textShadow: 'none' };
  Object.defineProperty(document, 'defaultView', { value: { DOMParser, getComputedStyle: el => ({ ...defaults, display: el.style.display || 'block' }) } });
  const counters = sanitizeStage(document, true);
  assert.equal(counters.recordsCreated, 1);
  assert.equal(counters.styleCalls - counters.probeStyleCalls, 4);
  assert.deepEqual(pairedSummary([101, 2, 103, 4, 105], [100, 100, 100, 1, 1]).differences, [1, -98, 3, 3, 104]);
});
