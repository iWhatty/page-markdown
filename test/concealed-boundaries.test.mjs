import test from 'node:test';
import assert from 'node:assert/strict';
import { stubFixture } from './browser/report-stub.mjs';
import { sanitizeToInertDocument } from '../src/sanitize.js';
import { prepareConcealment } from '../src/standardize.js';

function capture(doc, root = doc) {
  const result = sanitizeToInertDocument(root);
  prepareConcealment(result.document, result.concealment);
  return result;
}
function fixture(html, css = '') { return stubFixture({ html, css }); }

test('shadow node budget counts stripped children at the traversal gate', () => {
  const doc = fixture('<x-host></x-host>');
  doc.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML =
    '<div><style></style><p>Visible</p></div>';
  for (const [shadowNodeLimit, text, shadowHosts] of [[3, '', 1], [4, 'Visible', 0]]) {
    const result = sanitizeToInertDocument(doc, { shadowNodeLimit });
    prepareConcealment(result.document, result.concealment);
    assert.equal(result.document.querySelector('x-host').textContent, text);
    assert.deepEqual(result.omissions, { shadowHosts });
    assert.equal(result.document.querySelector('style'), null);
  }
});

test('shadow character budget includes computed hidden compatibility attributes', () => {
  const doc = fixture('<x-host></x-host>');
  doc.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML =
    '<p style="display:none">Secret</p>';
  for (const [shadowCharLimit, entries, shadowHosts] of [
    [65, [], 1],
    [71, [{ reason: 'display_none', text: 'Secret', chars: 6 }], 0],
  ]) {
    const result = sanitizeToInertDocument(doc, { shadowCharLimit });
    prepareConcealment(result.document, result.concealment);
    assert.deepEqual(result.concealment.entries, entries);
    assert.deepEqual(result.omissions, { shadowHosts });
  }
});

test('fast path preserves empty text before nonempty siblings, including whitespace', () => {
  for (const text of ['Secret', ' ']) {
    const doc = fixture('<main><p id="target"></p></main>', '#target{font-size:0}');
    const p = doc.getElementById('target');
    p.append(doc.createTextNode(''), doc.createTextNode(text));
    const result = capture(doc);
    assert.equal(result.concealment.counters.recordsCreated, 2);
    assert.equal(result.document.querySelector('p').childNodes.length, 0);
    assert.deepEqual(result.concealment.entries, text.trim() ? [{ reason: 'font_size_zero', text, chars: text.length }] : []);
  }
});

test('visible descendant cleanup survives without concealed-text records', () => {
  const doc = fixture('<main style="visibility:hidden"><p style="visibility:visible">Visible</p></main>');
  const result = capture(doc);
  assert.equal(result.concealment.counters.recordsCreated, 0);
  assert.equal(result.document.querySelector('main').style.visibility, undefined);
  assert.deepEqual(result.concealment.entries, []);
});

test('template fragments reset source ancestry and remain ordered run boundaries', () => {
  const doc = fixture('<main style="opacity:0">Before<template><p>TemplateVisible</p></template>After</main>');
  const result = capture(doc);
  assert.deepEqual(result.concealment.entries.map(e => e.text), ['Before', 'After']);
  const template = result.document.querySelector('template');
  assert.match((template.content || template).querySelector('p').textContent, /TemplateVisible/);
});

test('flattened slots preserve omitted slot carriers and direct text font size', () => {
  for (const direct of [false, true]) {
    const doc = fixture(`<main><x-host id="host">${direct ? 'Secret' : '<p>Secret</p>'}</x-host></main>`);
    const host = doc.getElementById('host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>#inner{opacity:0;font-size:0}</style><slot id="outer"><slot id="inner"></slot></slot>';
    const outer = shadow.querySelector('#outer'), inner = shadow.querySelector('#inner');
    const assigned = host.firstChild;
    Object.defineProperty(assigned, 'assignedSlot', { value: inner });
    outer.assignedNodes = () => [assigned];
    inner.assignedNodes = () => [assigned];
    const result = capture(doc);
    assert.deepEqual(result.concealment.entries, [{ reason: 'opacity_zero', text: 'Secret', chars: 6 }]);
  }
});

test('assigned text alone does not broaden actual-childNodes colour eligibility', () => {
  const doc = fixture('<main><x-host id="host">Visible</x-host></main>');
  const host = doc.getElementById('host'), assigned = host.firstChild;
  host.attachShadow({ mode: 'open' }).innerHTML = '<style>slot{color:transparent}</style><slot></slot>';
  const slot = host.shadowRoot.querySelector('slot');
  Object.defineProperty(assigned, 'assignedSlot', { value: slot });
  slot.assignedNodes = () => [assigned];
  assert.deepEqual(capture(doc).concealment.entries, []);
});

test('background images stop at provider inclusive and candidate rereads are cached', () => {
  for (const css of ['main{background-image:linear-gradient(red,blue)}', 'section{background-image:linear-gradient(red,blue)}']) {
    const doc = fixture('<main><section><p>One</p><p>Two</p></section></main>',
      'section{background-color:rgb(255, 255, 255)}p{color:rgb(255, 255, 255)}' + css);
    const result = capture(doc);
    assert.equal(result.concealment.entries.length, css.startsWith('main') ? 2 : 0);
    assert.equal(result.concealment.counters.rereads, 3);
  }
});

test('outside-root work and probe are separately accounted', () => {
  const doc = fixture('<main style="opacity:0"><p>Secret</p></main>');
  const result = capture(doc, doc.querySelector('p'));
  assert.equal(result.concealment.entries[0].reason, 'opacity_zero');
  const c = result.concealment.counters;
  assert.equal(c.probeStyleCalls, 1);
  assert.equal(c.outsideStyleCalls, 3);
  assert.equal(c.styleCalls - c.probeStyleCalls - c.outsideStyleCalls, 1);
});

test('fractional channels and noncanonical strings retain exact comparisons', () => {
  for (const [color, background, hidden] of [
    ['rgb(1.25, 2.5, 3.75)', 'rgb(1.25, 2.5, 3.75)', true],
    ['rgb(1.25, 2.5, 3.75)', 'rgb(1.26, 2.5, 3.75)', false],
    ['rgb(1.000000000001, 2, 3)', 'rgb(1, 2, 3)', false],
    ['rgb(0.10000000000000001, 2, 3)', 'rgb(0.1, 2, 3)', true],
    [' RGB(1.25 2.5 3.75 / 100%) ', 'rgba(1.25,2.5,3.75,1)', true],
  ]) {
    const doc = fixture('<p id="target">Secret</p>');
    const original = doc.defaultView.getComputedStyle;
    doc.defaultView.getComputedStyle = el => ({ ...original(el), ...(el.id === 'target' ? { color, backgroundColor: background } : {}) });
    assert.equal(capture(doc).concealment.entries.length, hidden ? 1 : 0);
  }
});

test('tiny fractional alpha remains nonzero and never becomes transparent text', () => {
  const doc = fixture('<p id="target">Visible</p>');
  const original = doc.defaultView.getComputedStyle;
  doc.defaultView.getComputedStyle = el => ({ ...original(el), color: `rgba(1, 2, 3, 0.${'0'.repeat(308)}1)` });
  assert.deepEqual(capture(doc).concealment.entries, []);
});
