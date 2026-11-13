import * as PageMarkdown from '../../src/index.js';
import { cases, FIELDS, OPTIONAL_FIELDS, SCOPE, describeExpected } from './report-cases.mjs';
import { scoreReport, caseErrors, median } from './report-score.mjs';
import { timingSteps, walkBaseline, sanitizeStage, conversionStage, pairedSummary } from './report-timing.mjs';
import { treeState, observeResult } from './report-observe.mjs';

const $ = id => document.getElementById(id);
const viewport = view => ({ width: view.innerWidth, height: view.innerHeight });
const report = { schema: 1, scope: SCOPE, metadata: { ...REPORT_BUILD, userAgent: navigator.userAgent,
  viewport: viewport(window), visibility: document.visibilityState },
  computedProperties: [...FIELDS, ...OPTIONAL_FIELDS], computedStyles: [], frameContexts: [], cases: [],
  encoding: { outputs: ['markdown', 'fullPageMarkdown'], evidence: ['element path', 'computedStyles index', 'target (optional)'],
    context: 'case.context indexes frameContexts (captured viewport and document visibility)',
    actualDefaults: { truncated: false }, expectedDefaults: { check: 'computed', pending: false },
    expected: 'entries are [reason, chars] in order; retained follows actual.sentinels key order; exact entry text is checked against the versioned case table' },
  truncation: { applied: false, note: 'No report strings truncated. concealedText uses the package capture caps; chars preserves original length.' } };
const profiles = new Map();
const reportStarted = performance.now();
function errorText(error) {
  return String(error?.stack || error);
}
let backgrounded = document.visibilityState !== 'visible';
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') backgrounded = true; });
// Two rendering opportunities after load. Failure to get them is an exception,
// never permission to capture a frame without rendering opportunities.
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const paint = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('rendering opportunities timed out')), 1000);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
});
async function frameFor(html, css, title) {
  if (document.visibilityState !== 'visible') throw new Error('page backgrounded; foreground rendering required');
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.width = '640'; frame.height = '180';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame load timed out')), 5000);
    frame.onload = () => { clearTimeout(timer); resolve(); };
  });
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
  $('stage').append(frame);
  try { await ready; await paint(); return frame; }
  catch (error) { frame.remove(); throw error; }
}
function evidence(doc) {
  const nodes = [];
  // Snapshot every element, rather than guessing which ancestors the converter
  // will consult. Slots, light children, hosts, html/body and background layers
  // are included. Repeated raw tuples are interned losslessly to keep JSON small.
  function walk(root, prefix = '') {
    for (const el of root.querySelectorAll('*')) {
      if (['STYLE', 'HEAD', 'META'].includes(el.tagName)) continue;
      const raw = doc.defaultView.getComputedStyle(el);
      const values = [...FIELDS, ...OPTIONAL_FIELDS].map(field => field in raw ? raw[field] : null);
      const key = JSON.stringify(values);
      if (!profiles.has(key)) { profiles.set(key, report.computedStyles.length); report.computedStyles.push(values); }
      const path = prefix + (el.id ? `#${el.id}` : `${el.localName}:${nodes.length}`);
      nodes.push([path, profiles.get(key), ...(el.id === 'target' || el.id === 'inside' ? [true] : [])]);
      if (el.shadowRoot) walk(el.shadowRoot, `${path}::shadow/`);
    }
  }
  walk(doc);
  return nodes;
}
async function runCase(c) {
  const row = { id: c.id, shows: c.shows, expected: describeExpected(c),
    ...(c.coverageLimit ? { coverageLimit: c.coverageLimit } : {}),
    ...(c.knownLimit ? { knownLimit: true } : {}), ...(c.provisional ? { provisional: true } : {}) };
  let frame;
  try {
    frame = await frameFor(c.html, c.css, c.id);
    const doc = frame.contentDocument;
    if (c.shadow) {
      doc.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = c.shadow;
      await paint();
    }
    const context = { viewport: viewport(frame.contentWindow), visibility: doc.visibilityState };
    row.context = report.frameContexts.findIndex(value => JSON.stringify(value) === JSON.stringify(context));
    if (row.context === -1) { row.context = report.frameContexts.length; report.frameContexts.push(context); }
    if (c.support) row.support = { syntax: c.support, supported: frame.contentWindow.CSS.supports(...c.support) };
    row.evidence = evidence(doc);
    if (c.allowUnsupported && !row.support.supported) {
      row.skipped = 'unsupported CSS syntax; no detector conclusion';
      return row;
    }
    const before = treeState(doc);
    const result = PageMarkdown.pageToMarkdown(doc, { extract: 'full', includeFullPage: true, ...c.options });
    row.actual = observeResult(c, result, treeState(doc) === before);
  } catch (error) { row.exception = errorText(error); }
  finally { frame?.remove(); }
  return row;
}
async function measure(levels, label) {
  const p = { label, complete: false, backgrounded, visibility: document.visibilityState,
    options: { extract: 'full', includeFullPage: true }, on: [], off: [], warmups: [], order: [],
    sampleCount: 5, attribution: [], attributionOrder: [],
    stages: 'Steps 5/6 time sanitize plus production exemption preparation and lift; later standardization is excluded. Step 7 includes every conversion stage.',
    baseline: 'Steps 1–4 traverse every element/text node; style reads exclude stripped style/meta elements. Step 4 matches the fixture’s six wrapper reads, up to three text reads and conditional opacity reads; consumed in a running checksum.',
    estimate: 'Estimated cost above the matched style-read baseline; not a lower bound or an exact decomposition.' };
  const html = '<main>' + '<div class="level">'.repeat(levels)
    + Array.from({ length: 20000 - levels }, (_, i) => `<span class="${i % 101 === 0 ? 'concealed' : 'word'}">word${i} </span>`).join('')
    + '</div>'.repeat(levels) + '</main>';
  const css = 'body{font:16px sans-serif;background:white;color:black}.level{display:block}.word{color:rgb(10,20,30)}.concealed{opacity:0}';
  let frame;
  try {
    frame = await frameFor(html, css, `timing-${label}`);
    const doc = frame.contentDocument;
    p.elementCount = doc.querySelectorAll('*').length;
    const todo = [[doc.documentElement, 1]];
    p.depth = 0;
    while (todo.length) { const [el, depth] = todo.pop(); p.depth = Math.max(p.depth, depth); for (const child of el.children) todo.push([child, depth + 1]); }
    p.viewport = viewport(frame.contentWindow);
    const operations = [null, () => walkBaseline(doc, 1), () => walkBaseline(doc, 2),
      () => walkBaseline(doc, 3), () => walkBaseline(doc, 4),
      () => sanitizeStage(doc, false), () => { p.counters = sanitizeStage(doc, true); },
      enabled => conversionStage(doc, enabled)];
    const timed = (step, enabled) => { const t = performance.now(); operations[step](enabled); return performance.now() - t; };
    // Warm every step. Reuse one rendered, unmodified fixture for matched style
    // conditions; alternate the order within each pair on successive runs.
    for (let step = 1; step <= 7; step++) p.attribution.push({ step, label: timingSteps[step - 1], samples: [], warmups: [timed(step, false)], order: [] });
    p.warmups.push(p.attribution[6].warmups[0], timed(7, true));
    p.attribution[6].warmups.push(p.warmups[1]);
    const perRun = p.attribution.reduce((sum, row) => sum + row.warmups.reduce((a, b) => a + b, 0), 0);
    const remaining = Math.max(0, 85000 - (performance.now() - reportStarted));
    p.sampleCount = Math.max(1, Math.min(5, Math.floor(remaining / (label === 'shallow' ? 2 : 1) / Math.max(1, perRun))));
    if (p.sampleCount < 5) p.reducedSamples = `Reduced to ${p.sampleCount} paired runs per step to target 85 seconds total; no steps omitted.`;
    for (let run = 0; run < p.sampleCount; run++) {
      $('progress').textContent = `measuring ${label}: attribution pair ${run + 1}/${p.sampleCount}`;
      for (const pair of [[1, 2], [3, 4], [5, 6]]) {
        for (const step of run % 2 ? [...pair].reverse() : pair) {
          p.attribution[step - 1].samples.push(timed(step));
          p.attribution[step - 1].order.push(step);
          p.attributionOrder.push(step);
        }
      }
      for (const enabled of run % 2 ? [false, true] : [true, false]) {
        const elapsed = timed(7, enabled);
        (enabled ? p.on : p.off).push(elapsed); p.order.push(enabled);
      }
      await turn();
    }
    for (const row of p.attribution.slice(0, 6)) row.medianMs = median(row.samples);
    p.attribution[6].on = p.on; p.attribution[6].off = p.off;
    Object.assign(p.attribution[6], pairedSummary(p.on, p.off));
    p.sanitize = pairedSummary(p.attribution[5].samples, p.attribution[4].samples);
    p.styleReadDifferences = p.attribution[3].samples.map((n, i) => n - p.attribution[0].samples[i]);
    p.estimatedResidualSamples = p.sanitize.differences.map((n, i) => n - p.styleReadDifferences[i]);
    p.estimatedResidualMs = median(p.estimatedResidualSamples);
    Object.assign(p, pairedSummary(p.on, p.off));
    p.complete = true;
  } catch (error) { p.exception = errorText(error); }
  finally { frame?.remove(); }
  p.backgrounded = backgrounded;
  return p;
}

function finish() {
  report.summary = scoreReport(report);
  for (const c of cases) {
    const row = report.cases.find(r => r.id === c.id);
    if (row) {
      const errors = caseErrors(c, row, report);
      if (errors.length) row.assertionErrors = errors;
      row.pass = row.skipped ? null : !errors.length;
    }
  }
  // Score first. Truncate only oversized exception stacks afterwards, keeping
  // every diagnostic field, message prefix, raw tuple and captured text entry.
  function truncateErrors(value, key = '') {
    if (typeof value === 'string' && /exception|assertionErrors|structural|errors/.test(key) && value.length > 1600) {
      report.truncation.applied = true;
      report.truncation.note = 'Exception stacks truncated after scoring at 1600 characters and marked; fields, raw evidence and captured text preserved. concealedText uses package capture caps.';
      return value.slice(0, 1600) + ' [truncated]';
    }
    if (Array.isArray(value)) return value.map(v => truncateErrors(v, key));
    if (value && typeof value === 'object') for (const k of Object.keys(value)) value[k] = truncateErrors(value[k], k);
    return value;
  }
  truncateErrors(report);
  // Keep the displayed summary identical to a later CLI recomputation even
  // when an oversized exception stack's presentation was shortened.
  report.summary = scoreReport(report);
  const json = JSON.stringify(report);
  $('report').value = json;
  $('status').textContent = `${report.summary.status} — ${report.summary.passed} passed, ${report.summary.failures.length} case failures, ${report.summary.knownLimits.length} known limits, ${report.summary.skipped.length} skipped, ${report.summary.structural.length} report errors`;
  $('coverage').textContent = report.summary.coverageLimits.map(c => `${c.id}: ${c.limit}`).join('; ');
  const timing = report.summary.timing;
  $('timing').textContent = timing ? ['shallow', 'deep'].map(label => {
    const p = label === 'deep' ? report.performance : report.performance.shallow;
    const t = label === 'deep' ? timing : timing.shallow;
    return `${label}: ${p.elementCount} elements, depth ${p.depth}; ${p.sampleCount} samples per step; ${p.reducedSamples || 'no sample reduction'}\n`
      + p.attribution.map(row => `${row.step}. ${row.label}: ${JSON.stringify(row)}`).join('\n')
      + `\n${p.stages}\n${p.baseline}\nSanitize paired differences ${JSON.stringify(p.sanitize.differences)} ms; median ${p.sanitize.overheadMs.toFixed(1)} ms`
      + `\nConversion paired differences ${JSON.stringify(t.differences)} ms; medians on ${t.onMedianMs.toFixed(1)} / off ${t.offMedianMs.toFixed(1)} ms; median paired added ${t.overheadMs.toFixed(1)} ms`
      + `\nEstimated cost above matched style-read baseline: ${p.estimatedResidualMs.toFixed(1)} ms; samples ${JSON.stringify(p.estimatedResidualSamples)}. ${p.estimate}`
      + `\nDetector counters: ${JSON.stringify(p.counters)}\nTargets (informational, outside PASS): ≤25% added: ${t.targets.relative}; ≤250 ms added: ${t.targets.absolute}`;
  }).join('\n\n') : 'Timing incomplete';
  $('progress').textContent = `Complete. ${new TextEncoder().encode(json).length} report bytes. Tuple encodings are described in JSON encoding. Raw tuples use computedProperties order; evidence[1] indexes computedStyles. Null means an optional property was not exposed.`;
  $('copy').disabled = false;
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(json); $('copy').textContent = 'Copied'; }
    catch { $('report').focus(); $('report').select(); $('copy').textContent = 'Selected — copy manually'; }
  };
}
async function main() {
  try {
    for (const c of cases) {
      $('progress').textContent = `Running ${c.id}…`;
      report.cases.push(await runCase(c));
      $('status').textContent = `FAIL — ${report.cases.length}/${cases.length} cases run; report incomplete`;
      await turn();
    }
    $('progress').textContent = 'measuring…';
    await turn();
    const shallow = await measure(4, 'shallow');
    report.performance = await measure(30, 'deep');
    report.performance.shallow = shallow;
  } catch (error) { report.exception = errorText(error); }
  finish();
}
main();
