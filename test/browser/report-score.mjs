import { cases, FIELDS, OPTIONAL_FIELDS, SCOPE } from './report-cases.mjs';

const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};
export const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Shared by the page and CLI. Expectations come from the versioned table,
// never from supplied expected/pass/summary fields in a pasted report.
export function caseErrors(c, r, report) {
  const errors = [];
  if (!r || r.id !== c.id) return ['missing case'];
  if (r.exception) errors.push(`exception: ${r.exception}`);
  if (r.skipped) {
    if (!(c.allowUnsupported && r.support?.supported === false && equal(r.support.syntax, c.support))) errors.push('unexpected skip');
  }
  const context = report.frameContexts?.[r.context];
  if (!Number.isInteger(r.context) || !(context?.viewport?.width > 0) || !(context?.viewport?.height > 0) || context?.visibility !== 'visible') errors.push('fixture not visibly laid out');
  if (!Array.isArray(r.evidence) || !r.evidence.length) errors.push('missing raw evidence');
  else {
    if (!r.evidence.some(e => e[2] === true)) errors.push('missing target evidence');
    for (const e of r.evidence) {
      const raw = report.computedStyles?.[e[1]];
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !Number.isInteger(e[1]) || !Array.isArray(raw) || raw.length !== FIELDS.length + OPTIONAL_FIELDS.length || raw.some((v, i) => i < FIELDS.length ? typeof v !== 'string' : v !== null && typeof v !== 'string')) errors.push('invalid raw evidence');
    }
  }
  if (c.support && (!equal(r.support?.syntax, c.support) || typeof r.support?.supported !== 'boolean')) errors.push('missing CSS support result');
  if (r.skipped) return errors;
  const a = r.actual;
  if (!a || typeof a !== 'object') return [...errors, 'missing actual'];
  if (a.sourceUnchanged !== true) errors.push('source changed');
  if (a.concealmentCheck !== c.expected.check) errors.push('concealmentCheck');
  if (!equal(a.concealedText, c.expected.entries)) errors.push('concealedText');
  const count = c.expected.entries.length;
  const chars = c.expected.entries.reduce((sum, e) => sum + e.chars, 0);
  if (a.omittedCount !== count || a.omittedChars !== chars) errors.push('omission totals');
  if (a.noticeText !== (count ? `Concealed text omitted: ${count} block(s), ${chars} UTF-16 units` : '')) errors.push('notice text');
  if ((a.truncated ?? false) !== c.expected.entries.some(e => e.chars > e.text.length)) errors.push('capture truncation');
  for (const [i, key] of ['markdown', 'fullPageMarkdown'].entries()) {
    if (!a.notice || a.notice[i] !== (count > 0)) errors.push(`${key} notice`);
    for (const [text, present] of Object.entries(c.expected.sentinels)) {
      if (a.sentinels?.[text]?.[i] !== present) errors.push(`${key} sentinel ${text}`);
    }
    if (c.expected.firstLine !== undefined && a.firstLine?.[i] !== c.expected.firstLine) errors.push(`${key} spacing`);
  }
  if (a.pending !== c.expected.pending) errors.push('pending warning');
  if (c.provisional && a.pendingCount !== (c.expected.pending ? 1 : 0)) errors.push('pending count');
  if (c.expected.inactiveTabs !== undefined && a.inactiveTabs !== c.expected.inactiveTabs) errors.push('inactive tabs');
  return errors;
}
export function scoreReport(report) {
  const structural = [];
  if (report?.schema !== 1 || report?.scope !== SCOPE) structural.push('schema/scope');
  if (!report?.metadata?.userAgent || !report.metadata.version || !/^[a-f0-9]{40}$/i.test(report.metadata.commit || '') || !Number.isFinite(Date.parse(report.metadata.builtAt))) structural.push('build/browser metadata');
  if (report?.metadata?.visibility !== 'visible' || !(report?.metadata?.viewport?.width > 0) || !(report?.metadata?.viewport?.height > 0)) structural.push('page visibility/viewport');
  if (!equal(report?.computedProperties, [...FIELDS, ...OPTIONAL_FIELDS])) structural.push('computed property schema');
  const rows = Array.isArray(report?.cases) ? report.cases : [];
  if (rows.length !== cases.length || new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r => !cases.some(c => c.id === r.id))) structural.push('case inventory');
  const observations = cases.map(c => ({ id: c.id, knownLimit: !!c.knownLimit, provisional: !!c.provisional,
    skipped: !!rows.find(r => r.id === c.id)?.skipped, errors: caseErrors(c, rows.find(r => r.id === c.id), report || {}) }));
  // A known limit's mismatch is informational. Missing evidence, exceptions,
  // skips or missing rows remain structural failures even for known limits.
  for (const c of cases.filter(c => c.knownLimit)) {
    const row = rows.find(r => r.id === c.id);
    const infrastructureErrors = caseErrors(c, row, report || {}).filter(e => !['concealedText', 'omission totals', 'capture truncation', 'pending warning', 'notice text'].includes(e) && !e.includes(' sentinel ') && !e.endsWith(' notice'));
    if (!row || row.exception || row.skipped || infrastructureErrors.length) structural.push(`incomplete known limit ${c.id}: ${infrastructureErrors.join(', ')}`);
  }
  const p = report?.performance;
  const validSamples = list => Array.isArray(list) && list.length === 5 && list.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
  let timing = null;
  const validTiming = (tree, minDepth, maxDepth) => tree?.complete === true && tree?.backgrounded === false && !tree?.exception && !tree?.timedOut && validSamples(tree?.on) && validSamples(tree?.off)
    && Array.isArray(tree.warmups) && tree.warmups.length === 2 && tree.warmups.every(n => Number.isFinite(n) && n > 0)
    && Number.isInteger(tree.elementCount) && tree.elementCount >= 19000 && tree.elementCount <= 21000 && Number.isInteger(tree.depth) && tree.depth >= minDepth && tree.depth <= maxDepth
    && tree.visibility === 'visible' && tree.viewport?.width > 0 && tree.viewport?.height > 0
    && equal(tree.order, [true, false, ...Array.from({ length: 5 }, () => [true, false]).flat()]);
  const summarize = tree => {
    const on = median(tree.on), off = median(tree.off);
    return { onMedianMs: on, offMedianMs: off, ratio: on / off, overheadMs: on - off };
  };
  if (!validTiming(p, 28, 35) || !validTiming(p?.shallow, 6, 10) || p.elementCount !== p.shallow.elementCount) structural.push('incomplete/invalid timing');
  else {
    timing = { ...summarize(p), shallow: summarize(p.shallow) };
    timing.targets = { relative: timing.ratio <= 1.25 ? 'met' : 'not met', absolute: timing.overheadMs <= 250 ? 'met' : 'not met' };
  }
  if (report?.exception) structural.push(`page exception: ${report.exception}`);
  const failures = observations.filter(r => !r.knownLimit && r.errors.length).map(r => r.id);
  const skipped = observations.filter(r => r.skipped).map(r => r.id);
  return { status: failures.length || structural.length ? 'FAIL' : 'PASS', total: cases.length,
    passed: observations.filter(r => !r.knownLimit && !r.skipped && !r.errors.length).length,
    failures, skipped, knownLimits: observations.filter(r => r.knownLimit),
    coverageLimits: cases.filter(c => c.coverageLimit).map(c => ({ id: c.id, limit: c.coverageLimit })),
    provisional: observations.filter(r => r.provisional), structural, timing };
}
