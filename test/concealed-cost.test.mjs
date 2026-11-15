import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML, Node } from 'linkedom';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';

// Instrument explicit allocation sites and reads independently of production
// counters. This transformed module exists only in this test process.
let meter = null;
const sourceRoot = new URL('../src/', import.meta.url).href;
let explicitAllocations = null;
let explicitCollections = null;
let ordinaryReads = null;
// Observe receivers without consulting any DOM property. Both versions use the
// same linkedom Node class, including newly created inert documents and Attrs.
globalThis.__ordinaryRead = (receiver, key) => {
  if (ordinaryReads !== null && receiver instanceof Node) {
    ordinaryReads[key] = (ordinaryReads[key] || 0) + 1;
  }
  return receiver;
};
globalThis.__explicitAllocation = (count = 1) => { if (explicitAllocations !== null) explicitAllocations += count; };
globalThis.__explicitCollection = (method, count) => {
  if (!explicitCollections) return;
  if (method === 'push') explicitCollections.entries += count;
  else explicitCollections.writes++;
};

// Instrument object/array/new/function expressions throughout BOTH versions of
// the package. This also catches allocations outside the diagnostic factories.
function instrumentAllocations(source, url) {
  const file = ts.createSourceFile(url, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const transformed = ts.transform(file, [context => {
    const count = n => ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__explicitAllocation'), undefined,
      [ts.factory.createNumericLiteral(n)]);
    const visit = node => {
      let result = ts.visitEachChild(node, visit, context);
      const assignmentPattern = node.parent && ts.isBinaryExpression(node.parent) && node.parent.left === node && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (!assignmentPattern && (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node)
        || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
        const methods = ts.isObjectLiteralExpression(node) ? node.properties.filter(p => ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)).length : 0;
        result = ts.factory.createParenthesizedExpression(ts.factory.createCommaListExpression([count(1 + methods), result]));
      }
      if (ts.isBlock(node)) {
        const declarations = node.statements.filter(ts.isFunctionDeclaration).length;
        if (declarations) result = ts.factory.updateBlock(result, [ts.factory.createExpressionStatement(count(declarations)), ...result.statements]);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['push', 'set', 'add', 'clear'].includes(node.expression.name.text)) {
        const call = ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__explicitCollection'), undefined,
          [ts.factory.createStringLiteral(node.expression.name.text), ts.factory.createNumericLiteral(node.arguments.length)]);
        result = ts.factory.createParenthesizedExpression(ts.factory.createCommaListExpression([call, result]));
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const parent = node.parent;
        const write = (ts.isBinaryExpression(parent) && parent.left === node
          && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) || ts.isDeleteExpression(parent);
        if (!write && node.expression.kind !== ts.SyntaxKind.SuperKeyword && !ts.isPrivateIdentifier(node.name ?? node)) {
          const key = ts.isPropertyAccessExpression(node) ? ts.factory.createStringLiteral(node.name.text)
            : ts.isIdentifier(node.argumentExpression) || ts.isStringLiteral(node.argumentExpression) ? result.argumentExpression : ts.factory.createStringLiteral('*');
          const receiver = ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__ordinaryRead'), undefined,
            [result.expression, key]);
          result = ts.isPropertyAccessExpression(node)
            ? ts.factory.updatePropertyAccessExpression(result, receiver, result.name)
            : ts.factory.updateElementAccessExpression(result, receiver, result.argumentExpression);
        }
      }
      return result;
    };
    return root => ts.visitNode(root, visit);
  }]);
  try { return ts.createPrinter().printFile(transformed.transformed[0]); }
  finally { transformed.dispose(); }
}
globalThis.__trialMeter = (operation, node, key) => {
  if (!meter) return;
  if (operation === 'fingerprint') { meter.fingerprintUnits += node.length; return; }
  if (operation === 'array-clear') { meter.entries += node; return; }
  if (operation === 'addition') { meter.allocations++; meter.finish++; return; }
  if (operation === 'locator') {
    meter.locators++; meter.locatorDepth = Math.max(meter.locatorDepth, key);
    if (!key) return; // the root uses a literal empty string, not a new locator
  }
  if (operation === 'dom') {
    const counts = meter.dom.get(node) || {};
    counts[key] = (counts[key] || 0) + 1;
    meter.dom.set(node, counts);
    if (new Error().stack.includes('Trial.census') || new Error().stack.includes('Trial.associate')) {
      meter.sourceReads.set(node, (meter.sourceReads.get(node) || 0) + 1);
    }
  } else {
    meter.allocations++;
    const stack = new Error().stack;
    const category = stack.includes('Trial.census') ? 'source' : stack.includes('new Trial') ? 'setup'
      : stack.includes('Trial.finish') ? 'finish' : 'provenance';
    meter[category]++;
    if (category === 'source' && operation === 'record') meter.sourceRecords++;
  }
};
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  const suffix = context.parentURL?.endsWith('?baseline-cost') ? '?baseline-cost'
    : context.parentURL?.endsWith('?current-cost') ? '?current-cost' : '';
  if (suffix && result.url.startsWith(sourceRoot)) return { ...result, url: `${result.url}${suffix}` };
  return result;
}, load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (!url.startsWith(sourceRoot)) return result;
  let source = result.source.toString();
  if (url.endsWith('?baseline-cost')) {
    const path = `src/${new URL(url).pathname.split('/').pop()}`;
    const baseline = spawnSync('git', ['show', `5927f28:${path}`], { encoding: 'utf8' });
    assert.equal(baseline.status, 0, `read published baseline ${path}: ${baseline.stderr}`);
    source = baseline.stdout;
  }
  if (url.endsWith('/src/sanitize.js')) source = source.replaceAll('new Map()', "(globalThis.__trialMeter('allocation'), new Map())");
  if (url.endsWith('/src/pipeline.js')) source = source.replace('if (trial) result.diagnostics = trial.finish',
    "if (trial) globalThis.__trialMeter('addition');\n  if (trial) result.diagnostics = trial.finish");
  if (!url.endsWith('/src/trial.js')) return { ...result, source: instrumentAllocations(source, url) };
  for (const anchor of ['function record(value) {', 'function list() {', 'function table() {', 'constructor(root) {']) {
    source = source.replace(anchor, `${anchor} globalThis.__trialMeter('${anchor.includes('record') ? 'record' : 'allocation'}');`);
  }
  source = source.replace('function dom(node, key) {', "function dom(node, key) { globalThis.__trialMeter('dom', node, key);");
  source = source.replace('function hash(text, value = 0) {', "function hash(text, value = 0) { globalThis.__trialMeter('fingerprint', text);");
  source = source.replace('census(node, locator, depth, owner, blockLocator) {', "census(node, locator, depth, owner, blockLocator) { globalThis.__trialMeter('locator', null, depth);");
  for (const anchor of ['const token = String(this.#carriers.size);', 'carrier.output = `output:${output}`;', "text += info.text;", "text += dom(child, 'nodeValue') || '';", 'this.#blocks.push(record({ id:']) {
    source = source.replaceAll(anchor, `globalThis.__trialMeter('string'); ${anchor}`);
  }
  for (const array of ['block.retained', 'block.removed', 'block.outputBlocks', 'this.#rewrite']) {
    source = source.replaceAll(`${array}.length = 0;`, `globalThis.__trialMeter('array-clear', ${array}.length); ${array}.length = 0;`);
  }
  return { ...result, source: instrumentAllocations(source, url) };
} });
const { sanitizeToInertDocument } = await import('../src/trial.js');
const { createConcealmentWalk } = await import('../src/concealed.js');
const { pageToMarkdown } = await import('../src/trial.js');

test('trial cost OFF matches published baseline reads and explicit allocation sites across the entire pipeline', async t => {
  const baseline = await import('../src/index.js?baseline-cost');
  const current = await import('../src/index.js?current-cost');
  for (const depth of [6, 30]) {
    const containers = depth - 3, leaves = 2000 - 3 - containers;
    const html = '<html><head></head><body>' + '<div>'.repeat(containers)
      + '<span>Visible words </span>'.repeat(leaves) + '</div>'.repeat(containers) + '</body></html>';
    const measureAllocations = (convert, diagnostics) => {
      const doc = parseHTML(html).document;
      explicitCollections = { writes: 0, entries: 0 };
      explicitAllocations = 0;
      ordinaryReads = Object.create(null);
      try { convert(doc, { extract: 'full', diagnostics }); return { reads: ordinaryReads, allocations: explicitAllocations, ...explicitCollections }; }
      finally { explicitAllocations = null; explicitCollections = null; ordinaryReads = null; }
    };
    const before = measureAllocations(baseline.pageToMarkdown, undefined);
    assert.deepEqual(measureAllocations(current.pageToMarkdown, undefined), before, 'OFF entire-pipeline DOM read, explicit allocation and collection-write increment is zero');
    const warmBefore = measureAllocations(baseline.pageToMarkdown, 'off');
    assert.deepEqual(measureAllocations(current.pageToMarkdown, 'off'), warmBefore, 'OFF entire-pipeline DOM read, explicit allocation and collection-write increment is zero');
    t.diagnostic(`OFF depth ${depth}: entire-pipeline ${JSON.stringify(before)} before/after; increment 0 (warm ${JSON.stringify(warmBefore)})`);
  }
});

test('trial baseline exposes a source frame independently of detection', () => {
  const { document } = parseHTML('<html><body><p>same</p><p>same</p></body></html>');
  const off = pageToMarkdown(document, { extract: 'full' });
  assert.equal('diagnostics' in off, false, 'OFF has no diagnostics result');
  const trial = pageToMarkdown(document, { extract: 'full', diagnostics: 'trial' });
  assert.ok(trial.diagnostics, 'trial source frame is present');
  assert.equal(trial.diagnostics.detection, 'disabled');
  assert.equal(trial.diagnostics.computedStyleCoverage, 'not-checked');
  assert.equal(trial.diagnostics.blocks.length, 2);
  assert.ok(trial.diagnostics.blocks.every(b => b.membership === 'retained'), 'trial retained carriers are complete');
  assert.notEqual(trial.diagnostics.blocks[0].id, trial.diagnostics.blocks[1].id);
  assert.equal(trial.markdown, off.markdown);
});

function trialMeasure(depth, diagnostics) {
  const containers = depth - 3, leaves = 2000 - 3 - containers;
  const { document } = parseHTML('<html><head></head><body>' + '<div>'.repeat(containers)
    + '<span>Visible words </span>'.repeat(leaves) + '</div>'.repeat(containers) + '</body></html>');
  meter = { dom: new Map(), sourceReads: new Map(), sourceRecords: 0, locators: 0, locatorDepth: 0, fingerprintUnits: 0,
    allocations: 0, setup: 0, source: 0, provenance: 0, finish: 0, writes: 0, entries: 0 };
  const current = meter;
  const set = Map.prototype.set, add = Set.prototype.add, clear = Map.prototype.clear, push = Array.prototype.push, sort = Array.prototype.sort;
  function fromTrial() { return new Error().stack.split('\n')[3]?.includes('/src/trial.js:'); }
  Map.prototype.set = function(...args) { if (fromTrial()) current.writes++; return set.apply(this, args); };
  Set.prototype.add = function(...args) { if (fromTrial()) current.writes++; return add.apply(this, args); };
  Map.prototype.clear = function(...args) { if (fromTrial()) current.writes++; return clear.apply(this, args); };
  Array.prototype.push = function(...args) { if (fromTrial()) current.entries += args.length; return push.apply(this, args); };
  Array.prototype.sort = function(...args) { if (fromTrial()) current.entries += this.length; return sort.apply(this, args); };
  let result;
  try { result = pageToMarkdown(document, { extract: 'full', diagnostics }); }
  finally { Map.prototype.set = set; Set.prototype.add = add; Map.prototype.clear = clear; Array.prototype.push = push; Array.prototype.sort = sort; meter = null; }
  return { ...current, result, nodes: document.querySelectorAll('*').length + leaves + 1,
    reads: [...current.dom.values()].reduce((n, fields) => n + Object.values(fields).reduce((a, b) => a + b, 0), 0) };
}

test('trial cost OFF adds zero reads allocations and collection writes including setup and finish', t => {
  for (const depth of [6, 30]) for (const diagnostics of [undefined, 'off']) {
    const result = trialMeasure(depth, diagnostics);
    assert.deepEqual([result.reads, result.allocations, result.writes, result.entries], [0, 0, 0, 0],
      'OFF incremental reads allocations and collection writes are zero');
    assert.equal(result.result.diagnostics, undefined);
    t.diagnostic(`OFF depth ${depth}: reads ${result.reads}, allocations ${result.allocations}, writes ${result.writes}, array entries ${result.entries}`);
  }
});

test('trial cost stays within counted source and inert-pass budgets on shallow and deep fixtures', t => {
  for (const depth of [6, 30]) {
    const result = trialMeasure(depth, 'trial');
    assert.ok(result.setup <= 16, 'trial setup at most sixteen allocations');
    assert.ok(result.sourceRecords <= result.nodes * 2, 'at most two source records per admitted node');
    assert.ok([...result.sourceReads.values()].every(n => n <= 16), 'at most sixteen source DOM reads per node');
    assert.ok(result.locators <= result.nodes, 'one locator per source node');
    assert.ok(result.locatorDepth <= 256, 'locators have at most 256 steps');
    assert.ok(result.fingerprintUnits <= result.result.diagnostics.census.sourceUnits * 2, 'at most two fingerprint scans per admitted source unit');
    assert.ok(result.reads <= result.nodes * (16 + 8 * 16), 'bounded source and eight inert pass reads');
    assert.ok(result.writes <= result.nodes * (2 + 8 * 4), 'bounded independent Map/Set writes');
    assert.ok(result.entries <= result.nodes * (4 + 8 * 4), 'bounded independent array entries');
    assert.ok(JSON.stringify(result.result.diagnostics).length <= 500000, 'serialized diagnostics character limit');
    t.diagnostic(`TRIAL depth ${depth}: nodes ${result.nodes}, reads ${result.reads}, allocations ${result.allocations} (setup ${result.setup}, source ${result.source}, provenance ${result.provenance}, finish ${result.finish}), Map/Set writes ${result.writes}, array entries ${result.entries}`);
  }
});

function measure(depth, concealed = false, varied = false, options = { detectConcealedText: true }) {
  const containers = depth - 3;
  const leaves = 2000 - 3 - containers;
  const { document } = parseHTML('<html><head></head><body>' + '<div>'.repeat(containers)
    + '<span>Visible words </span>'.repeat(leaves) + '</div>'.repeat(containers) + '</body></html>');
  const defaults = { display: 'block', visibility: 'visible', opacity: '1', fontSize: '16px', position: 'static',
    clip: 'auto', clipPath: 'none', transitionProperty: 'all', transitionDuration: '0s', animationName: 'none',
    animationDuration: '0s', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
    backgroundClip: 'border-box', textShadow: 'none', webkitBackgroundClip: 'border-box',
    webkitTextFillColor: 'rgb(0, 0, 0)', webkitTextStrokeWidth: '0px' };
  const calls = new Map(), reads = new Map();
  const palette = new Map([...document.querySelectorAll('*')].map((el, i) => [el, `rgb(${i % 200}, ${210 + i % 40}, ${240 + i % 15})`]));
  const Parser = document.defaultView.DOMParser;
  Object.defineProperty(document, 'defaultView', { value: { DOMParser: Parser, getComputedStyle(el) {
    calls.set(el, (calls.get(el) || 0) + 1);
    if (!reads.has(el)) reads.set(el, new Map());
    return new Proxy(defaults, { get(target, field) {
      const counts = reads.get(el);
      counts.set(field, (counts.get(field) || 0) + 1);
      if (concealed && el === document.querySelector('span') && field === 'opacity') return '0';
      if (varied && field === 'backgroundColor') return palette.get(el);
      return target[field];
    } });
  } } });
  let writes = 0;
  const set = Map.prototype.set, add = Set.prototype.add;
  // Observe the immediate caller, independently of the detector's counters.
  // Stub and clone-walk collections are outside the detector's allocation rule.
  function detectorWrite() { if (new Error().stack.split('\n')[3]?.includes('/src/concealed.js:')) writes++; }
  Map.prototype.set = function(...args) { detectorWrite(); return set.apply(this, args); };
  Set.prototype.add = function(...args) { detectorWrite(); return add.apply(this, args); };
  let capture;
  try {
    capture = sanitizeToInertDocument(document, options);
    capture.concealment.lift(capture.document);
  } finally { Map.prototype.set = set; Set.prototype.add = add; }
  if (capture.concealment.check === 'disabled') return {
    check: capture.concealment.check, counters: capture.concealment.counters, writes,
    calls: calls.size, reads: reads.size,
  };
  assert.equal(capture.concealment.check, 'computed');
  assert.equal(capture.concealment.entries.length, concealed ? 1 : 0);
  assert.equal(document.querySelectorAll('*').length, 2000);
  assert.equal(calls.size, 2000, 'the whole fixed fixture was checked');
  // The full capability probe is separate from per-element processing.
  const probe = reads.get(document.documentElement);
  for (const field of Object.keys(defaults)) probe.set(field, probe.get(field) - 1);
  calls.set(document.documentElement, calls.get(document.documentElement) - 1);
  return { counters: capture.concealment.counters, writes,
    ordinary: [...document.querySelectorAll('span')].slice(concealed ? 1 : 0).map(el => [...reads.get(el).values()].reduce((a, b) => a + b, 0)),
    containers: [...document.querySelectorAll('html,head,body,div')].map(el => [...reads.get(el).values()].reduce((a, b) => a + b, 0)),
    calls: [...calls.values()], reads: [...reads.values()].flatMap(m => [...m.values()]),
    total: [...reads.values()].reduce((sum, m) => sum + [...m.values()].reduce((a, b) => a + b, 0), 0) };
}

test('default disabled detector makes zero style calls, reads, ancestry reads or collection writes', () => {
  for (const depth of [6, 30]) for (const options of [{}, { detectConcealedText: false }]) {
    const result = measure(depth, true, false, options);
    assert.equal(result.check, 'disabled');
    assert.equal(result.calls, 0);
    assert.equal(result.reads, 0);
    assert.equal(result.writes, 0);
    assert.ok(Object.values(result.counters).every(n => n === 0));
  }
  const { document } = parseHTML('<html><body><span>Visible words</span></body></html>');
  let ancestryReads = 0;
  // Count independently of detector counters, including inherit()'s early path.
  for (const enabled of [undefined, false]) {
    const walk = createConcealmentWalk(document, enabled);
    for (const source of [document.querySelector('span'), document.querySelector('span').firstChild]) {
      const child = new Proxy(source, { get(target, field) {
        if (['assignedSlot', 'parentElement', 'getRootNode'].includes(field)) ancestryReads++;
        return Reflect.get(target, field, target);
      } });
      const work = walk.initial(child);
      walk.inherit(work, child);
    }
  }
  assert.equal(ancestryReads, 0, 'disabled detector makes zero ancestry reads');
});

test('concealed style calls and property reads stay bounded on both depth fixtures', t => {
  // Before slice 4 (probe included): depth 30 = 19,949; depth 6 = 19,997.
  // After (probe separate): depth 30 = 17,910; depth 6 = 17,982.
  // One probe adds one call and 19 reads; no outside ancestors or rereads here.
  const totals = [];
  for (const depth of [30, 6]) {
    const result = measure(depth);
    t.diagnostic(`depth ${depth}: ${result.calls.length} elements, ${result.total} property reads; max reads ${Math.max(...result.reads)}`);
    assert.ok(result.calls.every(n => n <= 1), 'one getComputedStyle per element');
    assert.ok(result.reads.every(n => n <= 1), 'no computed property read twice per element');
    assert.ok(result.ordinary.every(n => n <= 9), 'ordinary contrasting text reads at most nine properties');
    assert.ok(result.containers.every(n => n <= 6), 'ordinary wrappers read at most six properties');
    assert.equal(result.counters.recordsCreated, 0, 'visible text creates zero records');
    assert.equal(result.counters.slowPathEntries, 0, 'ordinary elements enter no slow path');
    assert.equal(result.writes, 0, 'ordinary detector collection writes must be zero');
    assert.equal(result.counters.styleCalls - result.counters.probeStyleCalls, 2000);
    assert.ok(result.total <= 18000, 'at most 18000 ordinary property reads for 2000 elements');
    totals.push(result.total);
  }
  assert.ok(Math.max(...totals) / Math.min(...totals) <= 1.01, 'depth changes reads by at most 1%');
});

test('varied opaque visible colours allocate no detector collection entries', () => {
  for (const depth of [6, 30]) {
    const result = measure(depth, false, true);
    assert.equal(result.counters.recordsCreated, 0);
    assert.equal(result.counters.slowPathEntries, 0);
    assert.equal(result.writes, 0, 'ordinary detector collection writes must be zero');
  }
});

test('one concealed paragraph has proportional records and slow work', t => {
  for (const depth of [6, 30]) {
    const result = measure(depth, true);
    t.diagnostic(`depth ${depth}: ${JSON.stringify(result.counters)}; collection writes ${result.writes}`);
    assert.equal(result.counters.recordsCreated, 1);
    assert.ok(result.counters.slowPathEntries <= 4);
    assert.ok(result.writes <= 10);
  }
});

test('trial observations add zero detector style calls and property reads', t => {
  for (const depth of [6, 30]) {
    const off = measure(depth);
    const trial = measure(depth, false, false, { detectConcealedText: true, diagnostics: 'trial' });
    assert.deepEqual(trial.counters, off.counters, 'trial leaves detector work unchanged');
    assert.equal(trial.total, off.total);
    assert.equal(trial.writes, 0, 'trial ordinary detector collection writes must be zero');
    assert.ok(trial.ordinary.every(n => n <= 9));
    assert.ok(trial.containers.every(n => n <= 6));
    t.diagnostic(`trial detector depth ${depth}: 2000 calls + 1 probe, ${trial.total} reads + 19 probe reads; incremental style work 0`);
  }
});
