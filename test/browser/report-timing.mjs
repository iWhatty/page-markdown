import { sanitizeToInertDocument } from '../../src/sanitize.js';
import { prepareConcealment } from '../../src/standardize.js';
import { pageToMarkdown } from '../../src/index.js';
import { median } from './report-score.mjs';

export const timingSteps = ['walk elements and text', 'walk plus getComputedStyle', 'walk plus display',
  'matched style-read baseline', 'sanitize and exemption preparation, detection off',
  'sanitize and exemption preparation including lift, detection on', 'full conversion off and on'];
let sink = 0;
export function walkBaseline(doc, step) {
  let node = doc.documentElement;
  while (node) {
    sink += node.nodeType;
    if (node.nodeType === 1 && step > 1 && node.localName !== 'style' && node.localName !== 'meta') {
      const raw = doc.defaultView.getComputedStyle(node);
      sink += !!raw;
      if (step > 2) sink += raw.display.length;
      if (step > 3) {
        const opacity = raw.opacity;
        sink += raw.visibility.length + opacity.length + raw.clipPath.length + raw.clip.length + raw.backgroundColor.length;
        // Match the fixture's opacity-zero candidates as well as its visible text.
        if (Number(opacity) === 0) sink += raw.transitionProperty.length + raw.transitionDuration.length
          + raw.animationName.length + raw.animationDuration.length;
        let hasText = false;
        for (let child = node.firstChild; child; child = child.nextSibling) if (child.nodeType === 3 && child.nodeValue) { hasText = true; break; }
        if (hasText) {
          sink += raw.fontSize.length;
          if (Number(opacity) !== 0) {
            sink += raw.color.length;
            if ('webkitTextFillColor' in raw) sink += raw.webkitTextFillColor.length;
          }
        }
      }
    }
    if (node.firstChild && node.localName !== 'style') { node = node.firstChild; continue; }
    while (node && !node.nextSibling) node = node.parentNode;
    node = node?.nextSibling;
  }
  return sink;
}
export function sanitizeStage(doc, enabled) {
  const capture = sanitizeToInertDocument(doc, { detectConcealedText: enabled });
  prepareConcealment(capture.document, capture.concealment);
  sink += capture.concealment.summary.chars;
  return capture.concealment.counters;
}
export function conversionStage(doc, enabled) {
  const result = pageToMarkdown(doc, { extract: 'full', includeFullPage: true, detectConcealedText: enabled });
  sink += result.markdown.length;
}
export function pairedSummary(on, off) {
  const differences = on.map((n, i) => n - off[i]);
  return { onMedianMs: median(on), offMedianMs: median(off), differences,
    overheadMs: median(differences), ratio: 1 + median(differences) / median(off) };
}
