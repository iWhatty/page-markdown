// Node-only expectation smoke check. This deliberately models CSS; it is NOT
// browser evidence, a CSS implementation, or a serialization test. The live
// report never imports it. Mirrors contract.test.mjs's source-view stub.
import { parseHTML } from 'linkedom';
const names = { 'font-size': 'fontSize', 'clip-path': 'clipPath', 'transition-property': 'transitionProperty',
  'transition-duration': 'transitionDuration', 'animation-name': 'animationName', 'animation-duration': 'animationDuration',
  'background-color': 'backgroundColor', 'background-image': 'backgroundImage', 'background-clip': 'backgroundClip',
  '-webkit-background-clip': 'webkitBackgroundClip', '-webkit-text-fill-color': 'webkitTextFillColor', 'text-shadow': 'textShadow' };
function colour(v) {
  if (['white', '#ffffff', 'hsl(0 0% 100%)'].includes(v)) return 'rgb(255, 255, 255)';
  if (v === 'transparent') return 'rgba(0, 0, 0, 0)';
  if (v === 'blue') return 'rgb(0, 0, 255)';
  if (v === 'rgb(1 2 3 / 0%)') return 'rgba(1, 2, 3, 0)';
  if (v === 'rgb(0 0 0 / .5)') return 'rgba(0, 0, 0, 0.5)';
  return v;
}
export function stubFixture(c) {
  const { document: doc } = parseHTML(`<html><head><style>${c.css}</style></head><body>${c.html}</body></html>`);
  if (c.shadow) {
    // linkedom has no slot assignment; model the same provenance as the contract.
    const host = doc.getElementById('host');
    host.attachShadow({ mode: 'open' }).innerHTML = c.shadow;
    const slot = host.shadowRoot.querySelector('slot');
    const assigned = Array.from(host.childNodes);
    slot.assignedNodes = () => assigned;
    for (const node of assigned) Object.defineProperty(node, 'assignedSlot', { value: slot });
  }
  const Parser = doc.defaultView.DOMParser;
  const cache = new Map();
  function style(el) {
    if (cache.has(el)) return cache.get(el);
    const parent = el.assignedSlot || el.parentElement || el.getRootNode()?.host;
    const inherited = parent ? style(parent) : { visibility: 'visible', fontSize: '16px', color: 'rgb(0, 0, 0)', textShadow: 'none' };
    const value = { display: 'block', visibility: inherited.visibility, opacity: '1', fontSize: inherited.fontSize,
      position: 'static', clip: 'auto', clipPath: 'none', transitionProperty: 'all', transitionDuration: '0s',
      animationName: 'none', animationDuration: '0s', color: inherited.color, backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none', backgroundClip: 'border-box', textShadow: inherited.textShadow };
    const root = el.getRootNode();
    const sheets = root.querySelectorAll('style');
    function apply(declarations) {
      for (let i = 0; i < declarations.length; i++) {
        const prop = declarations[i], raw = declarations.getPropertyValue(prop).trim();
        if (prop === 'transition') {
          const entries = raw.split(',').map(s => s.trim().split(/\s+/));
          value.transitionProperty = entries.map(e => e[0]).join(', ');
          value.transitionDuration = entries.map(e => e[1]).join(', ');
        } else if (prop === 'animation') {
          const parts = raw.split(/\s+/); value.animationName = parts[0]; value.animationDuration = parts[1];
        } else if (prop === 'background') {
          if (raw.includes('gradient')) value.backgroundImage = raw;
          else value.backgroundColor = colour(raw);
        } else value[names[prop] || prop] = prop === 'font-size' && raw === '0' ? '0px' : colour(raw);
      }
    }
    for (const sheet of sheets) for (const rule of sheet.sheet.cssRules) {
      if (rule.selectorText && rule.selectorText !== ':host' && el.matches(rule.selectorText)) apply(rule.style);
    }
    if (el.hasAttribute('style')) apply(el.style);
    cache.set(el, value);
    return value;
  }
  Object.defineProperty(doc, 'defaultView', { value: { DOMParser: Parser, getComputedStyle: style } });
  return doc;
}
