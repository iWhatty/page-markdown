import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReport } from './browser/build-report.mjs';
import { cases, FIELDS, OPTIONAL_FIELDS, SCOPE, describeExpected } from './browser/report-cases.mjs';
import { scoreReport, caseErrors } from './browser/report-score.mjs';
import { pageToMarkdown } from '../src/index.js';
import { stubFixture } from './browser/report-stub.mjs';
import { treeState, observeResult } from './browser/report-observe.mjs';

test('report builds one self-contained page with every case and no launcher imports', async () => {
  const source = fs.readFileSync('test/browser/build-report.mjs', 'utf8');
  assert.doesNotMatch(source, /safe-chromium|child_process/);
  const { output, bytes } = await buildReport();
  const html = fs.readFileSync(output, 'utf8');
  assert.equal(bytes, Buffer.byteLength(html));
  // URLs as inert bundle strings are allowed; network-bearing HTML is not.
  assert.doesNotMatch(html, /<(?:script|iframe|img|link|source)\b[^>]*\b(?:src|href)\s*=/i);
  assert.doesNotMatch(html, /@import\s|url\(\s*["']?https?:|\b(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /readonly/);
  assert.match(html, /Copy report/);
  // IDs are table-generated at runtime; bundled literals alone need not contain
  // expanded IDs. Embed a manifest in the artifact to make inventory auditable.
  for (const c of cases) assert.ok(html.includes(c.id), `missing ${c.id}`);
});

// A hand-made observation report: no converter, browser or supplied pass flag.
function passingReport() {
  const raw = ['block', 'visible', '1', '16px', 'static', 'auto', 'none', 'all', '0s', 'none', '0s', 'rgb(0, 0, 0)', 'rgba(0, 0, 0, 0)', 'none', 'border-box', 'none', null, null, null];
  const report = { schema: 1, scope: SCOPE, metadata: { userAgent: 'hand-made test report', version: '0.2.0', commit: 'a'.repeat(40), builtAt: '2026-11-13T12:00:00Z', visibility: 'visible', viewport: { width: 800, height: 600 } },
    computedProperties: [...FIELDS, ...OPTIONAL_FIELDS], computedStyles: [raw],
    frameContexts: [{ viewport: { width: 640, height: 180 }, visibility: 'visible' }],
    cases: cases.map(c => ({ id: c.id, context: 0,
      evidence: [['#target', 0, true]], ...(c.support ? { support: { syntax: c.support, supported: true } } : {}),
      actual: { concealmentCheck: c.expected.check, concealedText: c.expected.entries,
        omittedCount: c.expected.entries.length, omittedChars: c.expected.entries.reduce((n, e) => n + e.chars, 0),
        ...(c.expected.entries.some(e => e.chars > e.text.length) ? { truncated: true } : {}), sourceUnchanged: true,
        sentinels: Object.fromEntries(Object.entries(c.expected.sentinels).map(([text, present]) => [text, [present, present]])),
        notice: [!!c.expected.entries.length, !!c.expected.entries.length],
        noticeText: c.expected.entries.length ? `Concealed text omitted: ${c.expected.entries.length} block(s), ${c.expected.entries.reduce((n, e) => n + e.chars, 0)} UTF-16 units` : '',
        firstLine: [c.expected.firstLine, c.expected.firstLine],
        pending: c.expected.pending, ...(c.provisional ? { pendingCount: c.expected.pending ? 1 : 0 } : {}),
        ...(c.expected.inactiveTabs !== undefined ? { inactiveTabs: c.expected.inactiveTabs } : {}) } })),
    performance: { complete: true, backgrounded: false, on: [2, 4, 3, 5, 1], off: [1, 2, 3, 2, 4], warmups: [5, 4],
      visibility: 'visible', viewport: { width: 640, height: 180 },
      elementCount: 20006, depth: 33, sampleCount: 5,
      attributionOrder: Array.from({ length: 5 }, (_, i) => i % 2 ? [2, 1, 4, 3, 6, 5] : [1, 2, 3, 4, 5, 6]).flat(),
      counters: { styleCalls: 20005, propertyReads: 180000, recordsCreated: 198, slowPathEntries: 594, probeStyleCalls: 1, probeReads: 19, outsideStyleCalls: 0, outsideReads: 0, rereads: 0 },
      order: Array.from({ length: 5 }, (_, i) => i % 2 ? [false, true] : [true, false]).flat() } };
  report.performance.attribution = Array.from({ length: 7 }, (_, i) => ({ step: i + 1, label: `Step ${i + 1}`,
    warmups: i === 6 ? [5, 4] : [1], ...(i === 6 ? { on: report.performance.on, off: report.performance.off } : { samples: [1, 2, 3, 4, 5] }) }));
  report.performance.shallow = { ...structuredClone(report.performance), depth: 8 };
  return report;
}

test('report requires both timing trees and keeps targets outside PASS', () => {
  for (const mutate of [
    r => { delete r.performance.shallow; },
    r => { r.performance.shallow.on.pop(); },
    r => { r.performance.shallow.warmups = []; },
    r => { r.performance.shallow.backgrounded = true; },
    r => { r.performance.shallow.depth = 34; },
    r => { r.performance.shallow.elementCount--; },
    r => { r.performance.shallow.order.reverse(); },
    r => { r.performance.attribution.pop(); },
    r => { r.performance.attribution[3].samples.pop(); },
    r => { r.performance.attribution[5].warmups = []; },
    r => { delete r.performance.counters; },
  ]) {
    const report = passingReport(); mutate(report);
    assert.equal(scoreReport(report).status, 'FAIL');
  }
  const report = passingReport();
  report.performance.on = [1000, 1000, 1000, 1000, 1000];
  report.performance.attribution[6].on = report.performance.on;
  const score = scoreReport(report);
  assert.equal(score.status, 'PASS');
  assert.deepEqual(score.timing.targets, { relative: 'not met', absolute: 'not met' });
  assert.equal(score.timing.shallow.overheadMs, 1);
  assert.deepEqual(score.coverageLimits.map(c => c.id), ['C-oklch', 'C-display-p3']);
  for (const id of ['C-oklch', 'C-display-p3']) {
    const changed = passingReport();
    changed.cases.find(c => c.id === id).actual.concealedText = [{ reason: 'same_color', chars: 1, text: 'x' }];
    assert.deepEqual(scoreReport(changed).failures, [id], 'coverage limit retains its assertions');
  }
});

test('timing uses paired differences and accepts explicitly reduced complete samples', () => {
  const report = passingReport(), p = report.performance;
  p.on = [101, 2, 103, 4, 105]; p.off = [100, 100, 100, 1, 1];
  p.attribution[6].on = p.on; p.attribution[6].off = p.off;
  assert.equal(scoreReport(report).timing.overheadMs, 3);
  assert.notEqual(scoreReport(report).timing.overheadMs, 101 - 100);
  for (const tree of [p, p.shallow]) {
    tree.sampleCount = 3; tree.reducedSamples = 'Reduced to three pairs to target 85 seconds.';
    tree.on = tree.on.slice(0, 3); tree.off = tree.off.slice(0, 3);
    tree.order = tree.order.slice(0, 6);
    tree.attributionOrder = tree.attributionOrder.slice(0, 18);
    for (const row of tree.attribution.slice(0, 6)) row.samples = row.samples.slice(0, 3);
    tree.attribution[6].on = tree.on; tree.attribution[6].off = tree.off;
  }
  assert.equal(scoreReport(report).status, 'PASS');
  delete p.reducedSamples;
  assert.equal(scoreReport(report).status, 'FAIL');
});
test('score CLI recomputes a passing and failing hand-made report', () => {
  fs.mkdirSync('.browser-test', { recursive: true });
  const file = path.resolve('.browser-test/score-test.json');
  try {
    const report = passingReport();
    fs.writeFileSync(file, JSON.stringify(report));
    let result = spawnSync(process.execPath, ['test/browser/score-report.mjs', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), scoreReport(report));
    assert.equal(scoreReport(report).timing.overheadMs, 1);
    report.cases[0].actual.concealedText = [];
    report.cases[0].pass = true;
    report.cases[0].expected = {};
    report.summary = { status: 'PASS' };
    fs.writeFileSync(file, JSON.stringify(report));
    result = spawnSync(process.execPath, ['test/browser/score-report.mjs', file], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout).failures, ['A-display-none']);
  } finally { fs.unlinkSync(file); }
});
test('scoring rejects missing cases, skips, exceptions, raw gaps and incomplete/background timing', () => {
  for (const mutate of [
    r => r.cases.pop(), r => { r.cases[0].skipped = 'unexpected'; },
    r => { r.cases[0].exception = 'conversion failed'; }, r => { r.computedStyles = []; },
    r => { r.performance.on.pop(); }, r => { r.performance.backgrounded = true; },
    r => { r.performance.timedOut = true; }, r => { r.cases.find(c => c.id.startsWith('E-')).evidence = []; },
    r => { r.cases[1] = r.cases[0]; },
  ]) {
    const report = passingReport(); mutate(report);
    assert.equal(scoreReport(report).status, 'FAIL');
  }
  const report = passingReport();
  const modern = report.cases.find(c => c.id === 'C-oklch');
  modern.support.supported = false; modern.skipped = 'unsupported CSS'; delete modern.actual;
  assert.equal(scoreReport(report).status, 'PASS');
  const known = report.cases.find(c => c.id === 'E-alpha-small');
  known.actual.concealedText = [{ reason: 'transparent_text', chars: 1, text: 'x' }];
  assert.equal(scoreReport(report).status, 'PASS');
  assert.ok(scoreReport(report).knownLimits.find(r => r.id === known.id).errors.length);
});

test('raw property inventory stays aligned with concealed.js reads', () => {
  const source = fs.readFileSync('src/concealed.js', 'utf8');
  const fields = source.match(/const ALL_FIELDS = '([^']+)'\.split\(' '\);/)[1].split(' ');
  assert.deepEqual(FIELDS, fields.slice(0, 16));
  assert.deepEqual(OPTIONAL_FIELDS, fields.slice(16));
  assert.equal(cases.length, new Set(cases.map(c => c.id)).size);
  assert.deepEqual(Object.fromEntries('ABCDEFGHIJ'.split('').map(g => [g, cases.filter(c => c.group === g).length])),
    { A: 11, B: 11, C: 8, D: 12, E: 2, F: 34, G: 4, H: 1, I: 2, J: 1 });
});

test('scoring accepts reordered entry keys', () => {
  const report = passingReport();
  report.cases[0].actual.concealedText = report.cases[0].actual.concealedText.map(({ reason, text, chars }) => ({ chars, reason, text }));
  assert.equal(scoreReport(report).status, 'PASS');
});

for (const [field, value] of [['reason', 'wrong_reason'], ['text', 'wrong text'], ['chars', -1]]) {
  test(`scoring rejects changed entry ${field}`, () => {
    const report = passingReport();
    report.cases[0].actual.concealedText = report.cases[0].actual.concealedText.map(entry => ({ ...entry, [field]: value }));
    assert.deepEqual(scoreReport(report).failures, ['A-display-none']);
  });
}

test('report table expectation smoke check under linkedom + modeled styles (not a browser run)', async t => {
  const modeled = passingReport();
  modeled.computedStyles = [];
  const profiles = new Map();
  for (const c of cases) await t.test(c.id, () => {
    const doc = stubFixture(c);
    const before = treeState(doc);
    const result = pageToMarkdown(doc, { extract: 'full', includeFullPage: true, ...c.options });
    assert.equal(treeState(doc), before);
    assert.equal(result.concealmentCheck, c.expected.check);
    assert.deepEqual(result.concealedText, c.expected.entries);
    assert.equal(result.warnings.some(w => w.includes('Pending opacity content retained')), c.expected.pending);
    for (const key of ['markdown', 'fullPageMarkdown']) {
      for (const [text, present] of Object.entries(c.expected.sentinels)) assert.equal(result[key].includes(text), present, key);
      if (c.expected.firstLine !== undefined) assert.equal(result[key].split('\n')[0], c.expected.firstLine, key);
      assert.equal(result[key].includes('Concealed text omitted:'), !!c.expected.entries.length);
    }
    if (c.expected.inactiveTabs !== undefined) assert.equal(result.omissions.find(o => o.kind === 'inactive_tabs')?.count, c.expected.inactiveTabs);
    const row = modeled.cases.find(r => r.id === c.id);
    row.actual = observeResult(c, result, treeState(doc) === before);
    row.shows = c.shows; row.expected = describeExpected(c); row.pass = true;
    if (c.knownLimit) row.knownLimit = true;
    if (c.provisional) row.provisional = true;
    row.evidence = [];
    function snapshot(root, prefix = '') {
      for (const el of root.querySelectorAll('*')) {
        if (['STYLE', 'HEAD', 'META'].includes(el.tagName)) continue;
        const style = doc.defaultView.getComputedStyle(el);
        const raw = [...FIELDS, ...OPTIONAL_FIELDS].map(f => style[f] ?? null);
        const key = JSON.stringify(raw);
        if (!profiles.has(key)) { profiles.set(key, modeled.computedStyles.length); modeled.computedStyles.push(raw); }
        const name = prefix + (el.id ? `#${el.id}` : `${el.localName}:${row.evidence.length}`);
        row.evidence.push([name, profiles.get(key), ...(['target', 'inside'].includes(el.id) ? [true] : [])]);
        if (el.shadowRoot) snapshot(el.shadowRoot, `${name}::shadow/`);
      }
    }
    snapshot(doc);
  });
  modeled.summary = scoreReport(modeled);
  const errors = modeled.cases.map(row => ({ id: row.id, errors: caseErrors(cases.find(c => c.id === row.id), row, modeled) })).filter(row => row.errors.length);
  t.diagnostic(`Page observation path: ${cases.length - errors.length}/${cases.length} cases without errors; ${JSON.stringify(errors)}`);
  assert.deepEqual(errors, []);
  assert.equal(modeled.summary.status, 'PASS');
  t.diagnostic(`Modeled-style report payload: ${Buffer.byteLength(JSON.stringify(modeled))} bytes (not browser serialization or HTML build size).`);
});
