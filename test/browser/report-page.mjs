import * as PageMarkdown from '../../src/index.js';
import { cases, FIELDS, OPTIONAL_FIELDS, SCOPE, describeExpected } from './report-cases.mjs';
import { scoreReport, caseErrors, median } from './report-score.mjs';
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
async function measure() {
  const p = { label: 'Local synthetic timing; not a general guarantee', complete: false, backgrounded,
    visibility: document.visibilityState, options: { extract: 'full', includeFullPage: true },
    budgetMs: 60000, limit: 'Checked between synchronous calls; cannot interrupt a blocked call',
    on: [], off: [], warmups: [], order: [] };
  const start = performance.now();
  // 30 nested containers + 19,970 siblings, with actual stylesheet matching.
  const html = '<main>' + '<div class="level">'.repeat(30)
    + Array.from({ length: 19970 }, (_, i) => `<span class="${i % 101 === 0 ? 'concealed' : 'word'}">word${i} </span>`).join('')
    + '</div>'.repeat(30) + '</main>';
  const css = 'body{font:16px sans-serif;background:white;color:black}.level{display:block}.word{color:rgb(10,20,30)}.concealed{opacity:0}';
  const order = [true, false, ...Array.from({ length: 5 }, () => [true, false]).flat()];
  try {
    for (const [i, enabled] of order.entries()) {
      if (performance.now() - start >= 60000) { p.timedOut = true; break; }
      $('progress').textContent = `measuring… ${Math.max(0, i - 1)}/10 samples complete`;
      let frame;
      try {
        frame = await frameFor(html, css, `timing-${i}`);
        const doc = frame.contentDocument;
        if (i === 0) {
          p.elementCount = doc.querySelectorAll('*').length;
          const todo = [[doc.documentElement, 1]];
          p.depth = 0;
          while (todo.length) { const [el, depth] = todo.pop(); p.depth = Math.max(p.depth, depth); for (const child of el.children) todo.push([child, depth + 1]); }
          p.viewport = viewport(frame.contentWindow);
        }
        if (performance.now() - start >= 60000) { p.timedOut = true; break; }
        const options = { extract: 'full', includeFullPage: true, detectConcealedText: enabled };
        const t = performance.now();
        PageMarkdown.pageToMarkdown(doc, options);
        const elapsed = performance.now() - t;
        p.order.push(enabled);
        if (i < 2) p.warmups.push(elapsed); else (enabled ? p.on : p.off).push(elapsed);
        if (performance.now() - start >= 60000) { p.timedOut = true; break; }
      } finally { frame?.remove(); }
      await turn();
    }
    p.complete = p.order.length === 12 && !p.timedOut;
  } catch (error) { p.exception = errorText(error); }
  p.backgrounded = backgrounded;
  if (p.on.length === 5 && p.off.length === 5) {
    p.onMedianMs = median(p.on); p.offMedianMs = median(p.off);
    p.ratio = p.onMedianMs / p.offMedianMs; p.overheadMs = p.onMedianMs - p.offMedianMs;
  }
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
    report.performance = await measure();
  } catch (error) { report.exception = errorText(error); }
  finish();
}
main();
