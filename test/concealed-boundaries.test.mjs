import test from 'node:test';
import assert from 'node:assert/strict';
import { stubFixture } from './browser/report-stub.mjs';
import { sanitizeToInertDocument } from '../src/trial.js';
import { prepareConcealment } from '../src/standardize.js';
import { standardizeDocument, htmlToMarkdown } from '../src/index.js';
import { pageToMarkdown, Trial, jsonCharacters } from '../src/trial.js';
import { parseHTML } from 'linkedom';
import fs from 'node:fs';
import { GOLDEN_OPTIONS, GOLDEN_DIRS } from './golden-options.mjs';

const additions = { title: false, recoveredLead: false, pageFacts: 0 };
function traced(html, transform) {
  const doc = parseHTML(`<html><head></head><body>${html}</body></html>`).document;
  const capture = sanitizeToInertDocument(doc, { diagnostics: 'trial' });
  standardizeDocument(capture.document, { trial: capture.trial });
  capture.trial.start(capture.document);
  const root = capture.document.body.cloneNode(true);
  transform(root);
  capture.trial.select(root);
  return { html: root.innerHTML, diagnostics: capture.trial.finish('disabled', false, additions) };
}

test('trial equal-text identity trace preserves source membership with unchanged Markdown', () => {
  const html = '<main><p>same</p><p>same</p></main>';
  const first = traced(html, root => root.querySelectorAll('p')[1].remove());
  const second = traced(html, root => root.querySelector('p').remove());
  assert.equal(first.html, second.html, 'identity swap leaves extracted text and Markdown unchanged');
  assert.equal(htmlToMarkdown(first.html), htmlToMarkdown(second.html), 'equal-text identity swap leaves Markdown byte-identical');
  assert.deepEqual(second.diagnostics.blocks.map(b => [b.id, b.membership, b.retained.map(r => r.locator)]), [
    ['source-locator.v1:/0/1/0/0@/0/1/0/0/0:0', 'removed', []],
    ['source-locator.v1:/0/1/0/1@/0/1/0/1/0:0', 'retained', ['/0/1/0/1/0']],
  ], 'equal-text identity membership follows the selected source sibling');
});

test('trial lost and duplicated carriers cannot establish retained membership', () => {
  const good = traced('<p>same</p><p>same</p>', () => {});
  assert.deepEqual(good.diagnostics.blocks.map(b => b.membership), ['retained', 'retained'],
    'carrier retention covers both independently labelled source ranges');
  const duplicate = traced('<p>same</p>', root => root.appendChild(root.firstChild.cloneNode(true)));
  assert.equal(duplicate.diagnostics.provenance, 'unmatched', 'duplicated carrier is unresolved');
  const lost = traced('<p>same</p>', root => root.firstChild.removeAttribute('data-page-markdown-source'));
  assert.equal(lost.diagnostics.provenance, 'unmatched', 'lost carrier with surviving text is unresolved');
  const altered = traced('<p>Aa</p>', root => { root.firstChild.textContent = 'BB'; });
  assert.equal(altered.diagnostics.provenance, 'unmatched', 'changed carrier text is unresolved without string searching');
});

test('trial partial intervals are independently labelled before concealment removal', () => {
  const doc = fixture('<p>Alpha <span style="opacity:0">Beta</span> tail</p>');
  const off = pageToMarkdown(doc, { extract: 'full', detectConcealedText: true });
  const result = pageToMarkdown(doc, { extract: 'full', detectConcealedText: true, diagnostics: 'trial' });
  const block = result.diagnostics.blocks.find(b => b.locator === '/0/1/0');
  assert.deepEqual(block.retained.map(r => [r.locator, r.start, r.end]), [
    ['/0/1/0/0', 0, 6], ['/0/1/0/2', 0, 5],
  ], 'partial retained UTF-16 intervals match the hand-labelled source');
  assert.equal(block.membership, 'partial');
  assert.deepEqual(result.diagnostics.lifted[0].ranges.map(r => [r.locator, r.start, r.end]),
    [['/0/1/0/1/0', 0, 4]], 'lifted range links to its source text');
  assert.equal(result.markdown, off.markdown);
});

test('trial pending wrappers and unsupported consulted colours are identifiable', () => {
  const doc = fixture('<div style="opacity:0;transition:opacity 1s"><p style="color:oklch(1 0 0)">Pending</p></div><p style="color:color(display-p3 1 1 1)">P3</p>');
  const result = pageToMarkdown(doc, { extract: 'full', detectConcealedText: true, diagnostics: 'trial' }).diagnostics;
  assert.deepEqual(result.pendingOpacity.map(p => [p.locator, p.blockIds]), [
    ['/0/1/0', ['source-locator.v1:/0/1/0/0@/0/1/0/0/0:0']],
  ], 'pending wrapper locator and affected block IDs are present');
  assert.deepEqual(result.unsupportedColours.map(c => [c.locator, c.property, c.syntax, c.raw]), [
    ['/0/1/0/0', 'color', 'oklch', 'oklch(1 0 0)'],
    ['/0/1/1', 'color', 'display-p3', 'color(display-p3 1 1 1)'],
  ], 'unsupported colour encounters retain consulted property and raw value');
});

test('trial pending slot projections include assigned descendants and report exhausted membership', () => {
  for (const wrapper of [false, true]) {
    const doc = fixture('<x-host id="host"><section><p>Assigned <b>descendant</b></p><p>Second block</p></section></x-host>');
    const host = doc.getElementById('host');
    host.attachShadow({ mode: 'open' }).innerHTML = wrapper
      ? '<div style="opacity:0;transition:opacity 1s"><slot></slot></div>'
      : '<slot style="opacity:0;transition:opacity 1s"></slot>';
    const slot = host.shadowRoot.querySelector('slot');
    Object.defineProperty(host.firstChild, 'assignedSlot', { value: slot });
    slot.assignedNodes = () => [host.firstChild];
    const result = pageToMarkdown(doc, { extract: 'full', detectConcealedText: true, diagnostics: 'trial' }).diagnostics;
    assert.equal(result.pendingOpacity.length, 1);
    assert.deepEqual(result.pendingOpacity[0].blockIds, result.blocks.map(b => b.id),
      'pending slot membership includes assigned source blocks through slot ancestors');
    assert.equal(result.populations.pendingOpacity.status, 'complete');

    const trial = new Trial(doc);
    trial.pendingElement(wrapper ? slot.parentElement : slot);
    trial.associate(host.firstChild, {});
    trial.reserved = 500000;
    const capped = trial.finish('computed', false, { title: false, recoveredLead: false, pageFacts: 0 });
    assert.equal(capped.populations.pendingOpacity.status, 'incomplete',
      'exhausted projection resolution cannot claim complete pending coverage');
    assert.equal(capped.status, 'incomplete');
  }
  const root = { nodeType: 9 };
  const slot = root.firstChild = { nodeType: 1, localName: 'slot' };
  let previous = slot;
  for (let i = 0; i < 99998; i++) previous = previous.nextSibling = { nodeType: 1, localName: 'i' };
  previous.assignedSlot = slot;
  const trial = new Trial(root);
  trial.associate(previous, {});
  trial.pendingElement(slot);
  const capped = trial.finish('computed', false, { title: false, recoveredLead: false, pageFacts: 0 });
  assert.equal(capped.limit, 'pending-membership', 'projection resolution has a bounded comparison budget');
  assert.equal(capped.populations.pendingOpacity.status, 'incomplete');
});

test('trial code replacement and aside replacement retain ordered source intervals', () => {
  const result = traced('<main><aside class="note"><p>Note</p></aside><pre><div>A</div><div>B</div></pre></main>', () => {});
  assert.ok(result.diagnostics.blocks.every(b => b.membership === 'retained'), 'code and aside source intervals survive replacement');
  assert.deepEqual(result.diagnostics.blocks.flatMap(b => b.retained.map(r => [r.locator, r.end])), [
    ['/0/1/0/0/0/0', 4], ['/0/1/0/1/0/0', 1], ['/0/1/0/1/1/0', 1],
  ]);
  assert.ok(!result.html.includes('data-page-markdown-source'), 'carriers stripped before conversion');
  const codeBlocks = result.diagnostics.blocks.slice(1);
  assert.deepEqual(codeBlocks[0].outputBlocks, codeBlocks[1].outputBlocks, 'code merges link both source blocks to the same output block');
});

test('trial split output links retain the original source block identity', () => {
  const result = traced('<p><span>A</span><span>B</span></p>', root => {
    const source = root.firstChild;
    for (const span of [...source.children]) {
      const p = root.ownerDocument.createElement('p');
      p.appendChild(span);
      root.appendChild(p);
    }
    source.remove();
  });
  assert.equal(result.diagnostics.blocks.length, 1);
  assert.equal(result.diagnostics.blocks[0].membership, 'retained');
  assert.deepEqual(result.diagnostics.blocks[0].outputBlocks, ['output:1', 'output:2']);
});

test('trial Readability transfers direct text and preserves child carriers through ancestor collapse', () => {
  const words = 'This repeated passage is deliberately long enough to be retained as article prose. '.repeat(12);
  const doc = parseHTML(`<html><head></head><body><main><div>${words}</div><div>\n<section><p>${words}</p></section>\n</div></main></body></html>`).document;
  const off = pageToMarkdown(doc);
  const result = pageToMarkdown(doc, { diagnostics: 'trial' });
  assert.equal(result.markdown, off.markdown);
  assert.equal(result.extraction.method, 'readability');
  assert.equal(result.diagnostics.provenance, 'complete', 'Readability transfer keeps provenance complete');
  assert.deepEqual(result.diagnostics.blocks.filter(b => b.ranges.some(r => r.end === words.length))
    .map(b => [b.id, b.membership, b.retained.map(r => r.locator)]), [
      ['source-locator.v1:/0/1/0/0@/0/1/0/0/0:0', 'retained', ['/0/1/0/0/0']],
      ['source-locator.v1:/0/1/0/1/1/0@/0/1/0/1/1/0/0:0', 'retained', ['/0/1/0/1/1/0/0']],
    ], 'Readability retains both equal-text source identities through its replacements');
});

test('trial upper-deck round trip transfers ordered ranges and reserves extraction cleanup passes', () => {
  const html = '<span class="upper-deck__text">A<em>B</em>C</span>';
  const doc = fixture(html);
  const result = pageToMarkdown(doc, { diagnostics: 'trial', extract: 'full' });
  assert.deepEqual(result.diagnostics.blocks[0].retained.map(r => [r.locator, r.end]), [
    ['/0/1/0/0', 1], ['/0/1/0/1/0', 1], ['/0/1/0/2', 1],
  ], 'upper-deck round-trip ranges follow the independently labelled text order');
  for (const count of [2, 5]) {
    const many = fixture(html.repeat(count));
    const off = pageToMarkdown(many, { extract: 'full', includeFullPage: true });
    const capped = pageToMarkdown(many, { extract: 'full', includeFullPage: true, diagnostics: 'trial' });
    assert.equal(capped.markdown, off.markdown);
    assert.equal(capped.fullPageMarkdown, off.fullPageMarkdown);
    assert.equal(capped.diagnostics.status, 'incomplete');
    assert.ok(!capped.markdown.includes('data-page-markdown-source'), 'pass exhaustion still strips carriers');
  }
});

test('trial nested blocks interrupt direct segments and preserve UTF-16 boundaries', () => {
  const doc = fixture('<div>A<p>Nested</p>B&#x1f600;</div>');
  const options = { diagnostics: 'trial', extract: 'full' };
  const one = pageToMarkdown(doc, options).diagnostics;
  const two = pageToMarkdown(doc, options).diagnostics;
  assert.deepEqual(one.blocks.map(b => b.id), two.blocks.map(b => b.id), 'unchanged source trees reproduce identities');
  assert.deepEqual(one.blocks.map(b => b.ranges.map(r => r.end)), [[1], [6], [1, 2]], 'nested blocks split direct ranges, including surrogate pairs');
});

test('trial spoofed tokens are stripped and custom output remains unmatched', () => {
  const doc = fixture('<p data-page-markdown-source="0">Same</p>');
  const result = pageToMarkdown(doc, { diagnostics: 'trial', minExtractChars: 0, extract(copy) {
    assert.equal(copy.querySelector('[data-page-markdown-source]'), null, 'custom extractor sees no carriers');
    return { html: '<p>Same</p>', method: 'custom' };
  } });
  assert.equal(doc.querySelector('p').getAttribute('data-page-markdown-source'), '0', 'live source is unchanged');
  assert.ok(result.diagnostics.blocks.every(b => b.membership === 'unmatched'));
  assert.equal(result.diagnostics.status, 'incomplete');
});

test('trial unchecked static and failed styles never claim complete detector coverage', () => {
  const staticDoc = parseHTML('<html><body><p>Static</p></body></html>').document;
  const staticResult = pageToMarkdown(staticDoc, { diagnostics: 'trial', detectConcealedText: true, extract: 'full' }).diagnostics;
  assert.equal(staticResult.computedStyleCoverage, 'static-only');
  assert.equal(staticResult.populations.unsupportedColours.status, 'not-checked');
  const doc = fixture('<p>Missing</p>');
  const original = doc.defaultView.getComputedStyle;
  doc.defaultView.getComputedStyle = el => ({ ...original(el), color: '' });
  const failed = pageToMarkdown(doc, { diagnostics: 'trial', detectConcealedText: true, extract: 'full' }).diagnostics;
  assert.equal(failed.status, 'incomplete');
  assert.equal(failed.populations.unsupportedColours.omitted, 'unknown');
  assert.equal(failed.populations.unsupportedColours.knownOmitted, 0);
});

test('trial fixtures have carrier-free Markdown and method parity with OFF goldens', () => {
  for (const dir of GOLDEN_DIRS) for (const file of fs.readdirSync(`test/fixtures/${dir}`).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(`test/fixtures/${dir}/${file}`, 'utf8');
    const options = { url: 'https://example.com/dir/page', ...GOLDEN_OPTIONS[`${dir}/${file}`], includeFullPage: true };
    const off = pageToMarkdown(parseHTML(html).document, options);
    const { diagnostics, ...trial } = pageToMarkdown(parseHTML(html).document, { ...options, diagnostics: 'trial' });
    assert.deepEqual(trial, off, `trial conversion parity: ${dir}/${file}`);
    assert.equal(diagnostics.provenance, 'complete', `built-in provenance must be provable: ${dir}/${file}`);
    assert.ok(!trial.markdown.includes('data-page-markdown-source'));
  }
});

test('trial limits reserve source units and depth before reading or allocating excess', () => {
  for (const length of [499999, 500000, 500001]) {
    let reads = 0;
    const text = { nodeType: 3, length, get nodeValue() { reads++; assert.ok(length <= 500000); return 'a'.repeat(length); } };
    const trial = new Trial({ nodeType: 9, firstChild: text });
    assert.equal(reads, length <= 500000 ? 1 : 0, 'oversized text is never requested');
    assert.equal(trial.units, length <= 500000 ? length : 0);
    assert.equal(trial.incomplete, length > 500000);
  }
  for (const depth of [256, 257]) {
    const root = { nodeType: 9 };
    let cursor = root;
    for (let i = 0; i < depth; i++) cursor = cursor.firstChild = { nodeType: 1, localName: 'i' };
    const trial = new Trial(root);
    assert.equal(trial.depth, 256);
    assert.equal(trial.incomplete, depth > 256);
  }
  for (const count of [127, 128]) {
    const root = { nodeType: 9 };
    let cursor = root, reads = 0;
    for (let i = 0; i < count; i++) {
      const fragment = { nodeType: 11 };
      cursor.firstChild = { nodeType: 1, localName: 'template', content: fragment };
      cursor = fragment;
    }
    cursor.firstChild = { nodeType: 3, length: 1, get nodeValue() { reads++; return 'A'; } };
    const trial = new Trial(root);
    assert.equal(reads, count === 127 ? 1 : 0, 'template fragments consume depth before reading text');
    assert.equal(trial.nodes, count === 127 ? 256 : 257, 'template fragments consume the unique-node budget');
    assert.ok([...trial.sources.values()].every(info => info.locator.split('/').length - 1 <= 256), 'explicit template locator steps stay within 256');
  }
  const projectedRoot = { nodeType: 9, firstChild: { nodeType: 1, localName: 'i' } };
  let slot = projectedRoot.firstChild;
  for (let depth = 1; depth < 256; depth++) slot = slot.firstChild = { nodeType: 1, localName: 'i' };
  const assigned = { nodeType: 1, localName: 'p', assignedSlot: slot };
  projectedRoot.firstChild.nextSibling = assigned;
  const projected = new Trial(projectedRoot);
  projected.associate(assigned, {});
  assert.equal(projected.projections.length, 0, 'slot projection reserves its extra locator step');
  assert.equal(projected.limit, 'locator-depth');
});

test('trial JSON character accounting charges escaping and lone surrogates exactly', () => {
  for (const value of ['"\\\n\t', String.fromCharCode(0xd800), 'a'.repeat(500000), { a: ['x', 12, true, null] }]) {
    assert.equal(jsonCharacters(value, 1000000), JSON.stringify(value).length);
  }
});

test('trial source node census stops at exactly 100000 unique nodes', () => {
  for (const count of [99999, 100000, 100001]) {
    const root = { nodeType: 9 };
    let previous;
    for (let i = 1; i < count; i++) {
      const node = { nodeType: 1, localName: 'i' };
      if (previous) previous.nextSibling = node;
      else root.firstChild = node;
      previous = node;
    }
    const trial = new Trial(root);
    assert.equal(trial.nodes, Math.min(count, 100000));
    assert.equal(trial.censusIncomplete, count > 100000);
    assert.equal(trial.finish('disabled', false, additions).census.omitted, count > 100000 ? 'unknown' : 0);
  }
});

test('trial provenance pass and output reference caps fail closed', () => {
  for (const count of [255, 256, 257]) {
    const result = traced(`<p>${'<span>x</span>'.repeat(count)}</p>`, () => {});
    assert.equal(result.diagnostics.provenance, count > 256 ? 'unmatched' : 'complete');
    assert.ok(result.diagnostics.blocks.every(b => b.retained.length <= 256));
  }
  const capture = sanitizeToInertDocument(fixture('<p>Text</p>'), { diagnostics: 'trial' });
  for (let i = 0; i < 8; i++) assert.equal(capture.trial.pass(capture.document, capture.trial.strip), true);
  assert.equal(capture.trial.pass(capture.document, capture.trial.strip), false);
  assert.equal(capture.trial.passes, 8);
  assert.equal(capture.trial.provenanceIncomplete, true);
});

test('trial exceptional caps count omissions independently and bound raw colours', () => {
  for (const count of [99, 100, 101]) {
    const doc = fixture('<div style="opacity:0;transition:opacity 1s"><p style="color:oklch(1 0 0)">Text</p></div>'.repeat(count)
      + '<p style="font-size:0">Lifted</p>'.repeat(count));
    const result = pageToMarkdown(doc, { diagnostics: 'trial', detectConcealedText: true, extract: 'full' }).diagnostics;
    for (const key of ['pendingOpacity', 'unsupportedColours', 'lifted']) {
      assert.equal(result.populations[key].recorded, Math.min(count, 100), `${key} has its own cap`);
      assert.equal(result.populations[key].omitted, Math.max(0, count - 100));
    }
    assert.equal(result.status, count > 100 ? 'incomplete' : 'complete');
    assert.ok(JSON.stringify(result).length <= 500000);
  }
  for (const length of [2047, 2048, 2049]) {
    const capture = sanitizeToInertDocument(fixture('<p>Text</p>'), { diagnostics: 'trial' });
    capture.trial.colour([...capture.trial.sources.keys()].find(n => n.localName === 'p'), 'color', 'x'.repeat(length));
    assert.equal(capture.trial.colours[0].raw.length, Math.min(length, 2048));
    assert.equal(capture.trial.colours[0].truncated, length > 2048);
  }
});

test('trial diagnostic character cap reserves before allocating records', () => {
  const capture = sanitizeToInertDocument(fixture('<p>Text</p>'), { diagnostics: 'trial' });
  const trial = capture.trial;
  const el = [...trial.sources.keys()].find(n => n.localName === 'p');
  trial.reserved = 500000 - 255 - trial.sources.get(el).locator.length * 6;
  trial.pendingElement(el);
  assert.equal(trial.pending.length, 0, 'no pending allocation without reserved character capacity');
  assert.equal(trial.pendingOmitted, 1);
  assert.equal(trial.limit, 'diagnostic-characters');
  assert.equal(trial.finish('disabled', false, additions).status, 'incomplete');
});

test('trial doctype indexes templates and shadow slot projections preserve canonical locations', () => {
  const doc = fixture('<x-host id="host"><p>Assigned</p></x-host><template><p>Template</p></template>');
  const host = doc.getElementById('host');
  host.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow</p><slot></slot>';
  const slot = host.shadowRoot.querySelector('slot');
  Object.defineProperty(host.firstChild, 'assignedSlot', { value: slot });
  slot.assignedNodes = () => [host.firstChild];
  const result = pageToMarkdown(doc, { diagnostics: 'trial', extract: 'full' }).diagnostics;
  assert.deepEqual(result.projections, [{ source: '/0/1/0/0', via: '/0/1/0/shadow/1/slot' }]);
  assert.ok(result.blocks.some(b => b.ranges.some(r => r.locator.includes('/template/'))));
  assert.ok(result.blocks.some(b => b.ranges.some(r => r.locator.includes('/shadow/'))));
  const typed = pageToMarkdown(parseHTML('<!doctype html><html><body><p>Text</p></body></html>').document,
    { diagnostics: 'trial', extract: 'full' }).diagnostics;
  assert.equal(typed.blocks[0].locator, '/1/0/0', 'doctype counts as an all-node document child');
  assert.equal(typed.blocks[0].membership, 'retained');
  const direct = pageToMarkdown(fixture('<template>Direct template text</template>'), { diagnostics: 'trial', extract: 'full' }).diagnostics;
  assert.equal(direct.blocks[0].membership, 'retained', 'template direct text has a carrier on its template element');
});

function capture(doc, root = doc) {
  const result = sanitizeToInertDocument(root, { detectConcealedText: true });
  prepareConcealment(result.document, result.concealment);
  return result;
}
function fixture(html, css = '') { return stubFixture({ html, css }); }

test('shadow node budget counts stripped children at the traversal gate', () => {
  const doc = fixture('<x-host></x-host>');
  doc.querySelector('x-host').attachShadow({ mode: 'open' }).innerHTML =
    '<div><style></style><p>Visible</p></div>';
  for (const [shadowNodeLimit, text, shadowHosts] of [[3, '', 1], [4, 'Visible', 0]]) {
    const result = sanitizeToInertDocument(doc, { detectConcealedText: true, shadowNodeLimit });
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
    const result = sanitizeToInertDocument(doc, { detectConcealedText: true, shadowCharLimit });
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
