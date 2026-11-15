// Node/stub end-to-end timing: cloning, stub work, JIT and GC are included.
// This does not measure browser style cost or isolate bookkeeping.
import { parseHTML } from 'linkedom';
import { sanitizeToInertDocument } from '../src/sanitize.js';
const defaults = { display: 'block', visibility: 'visible', opacity: '1', fontSize: '16px', position: 'static',
  clip: 'auto', clipPath: 'none', transitionProperty: 'all', transitionDuration: '0s', animationName: 'none',
  animationDuration: '0s', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  backgroundClip: 'border-box', textShadow: 'none', webkitBackgroundClip: 'border-box',
  webkitTextFillColor: 'rgb(0, 0, 0)', webkitTextStrokeWidth: '0px' };
for (const depth of [6, 30]) {
  const { document } = parseHTML('<html><head></head><body>' + '<div>'.repeat(depth - 3)
    + '<span>Visible words </span>'.repeat(20000 - depth) + '</div>'.repeat(depth - 3) + '</body></html>');
  const DOMParser = document.defaultView.DOMParser;
  Object.defineProperty(document, 'defaultView', { value: { DOMParser, getComputedStyle: () => defaults } });
  const on = [], off = [];
  for (let i = -1; i < 5; i++) for (const enabled of i % 2 ? [false, true] : [true, false]) {
    const start = performance.now();
    const capture = sanitizeToInertDocument(document, { detectConcealedText: enabled });
    capture.concealment.lift(capture.document);
    const elapsed = performance.now() - start;
    if (i >= 0) (enabled ? on : off).push(elapsed);
  }
  const median = a => [...a].sort((a, b) => a - b)[2];
  console.log(JSON.stringify({ depth, on, off, onMedian: median(on), offMedian: median(off) }));
}
