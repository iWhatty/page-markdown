// Run explicitly, never alongside other tests: each mutation restores bytes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const paths = ['src/concealed.js', 'src/sanitize.js', 'src/standardize.js', 'src/trial.js', 'src/extract.js', 'src/index.js'];
export const controls = [
  { name: 'main imports trial', file: paths[5], from: "// Ordinary entry:", to: "import './trial.js'; // Ordinary entry:",
    test: 'main entry module graph', suite: 'test/trial-entry.test.mjs', assertion: /main entry must not load trial modules/ },
  { name: 'Readability carrier transfer', file: paths[3], from: "if (single && (tag === 'P' || tag === 'DIV' || tag === 'SECTION')) {", to: 'if (false) {',
    test: 'trial Readability transfers', suite: 'test/concealed-boundaries.test.mjs', assertion: /Readability transfer keeps provenance complete/ },
  { name: 'equal-text identity swap', file: paths[3], from: 'const block = this.#blocks[range.block];', to: 'const block = this.#blocks[range.block ^ 1];',
    test: 'trial equal-text identity', suite: 'test/concealed-boundaries.test.mjs', assertion: /equal-text identity membership follows the selected source sibling/ },
  { name: 'lost carrier', file: paths[3], from: "dom(node, 'setAttribute').call(node, SOURCE_MARK, token);", to: 'void token;',
    test: 'trial lost and duplicated carriers', suite: 'test/concealed-boundaries.test.mjs', assertion: /carrier retention covers both independently labelled source ranges/ },
  { name: 'duplicated carrier', file: paths[3], from: 'carrier.seen++;', to: 'carrier.seen += 2;',
    test: 'trial lost and duplicated carriers', suite: 'test/concealed-boundaries.test.mjs', assertion: /carrier retention covers both independently labelled source ranges/ },
  { name: 'partial interval', file: paths[3], from: 'block.retained.push(range);', to: 'block.retained.push({ ...range, end: range.end - 1 });',
    test: 'trial partial intervals', suite: 'test/concealed-boundaries.test.mjs', assertion: /partial retained UTF-16 intervals match the hand-labelled source/ },
  { name: 'omitted pending record', file: paths[0], from: 'if (trial && !pending.has(el)) trial.pendingElement(el);', to: 'void el;',
    test: 'trial pending wrappers', suite: 'test/concealed-boundaries.test.mjs', assertion: /pending wrapper locator and affected block IDs are present/ },
  { name: 'omitted colour record', file: paths[0], from: 'trial.colour(trial.element, ALL_FIELDS[field], original, value);', to: 'void original;',
    test: 'trial pending wrappers', suite: 'test/concealed-boundaries.test.mjs', assertion: /unsupported colour encounters retain consulted property and raw value/ },
  { name: 'ordinary OFF allocation', file: paths[1], from: 'const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options };', to: 'const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options }; new Map();',
    test: 'trial cost OFF', suite: 'test/concealed-cost.test.mjs', assertion: /OFF incremental reads allocations and collection writes are zero/ },
  { name: 'ordinary OFF DOM read', file: paths[1], from: 'function shallow(node) {', to: 'function shallow(node) { void node.nodeType;',
    test: 'trial cost OFF matches', suite: 'test/concealed-cost.test.mjs', assertion: /OFF entire-pipeline DOM read, explicit allocation and collection-write increment is zero/ },
  { name: 'pending slot membership', file: paths[3], from: 'info.projectedVia = via;', to: 'void via;',
    test: 'trial pending slot projections', suite: 'test/concealed-boundaries.test.mjs', assertion: /pending slot membership includes assigned source blocks through slot ancestors/ },
  { name: 'collection write', file: paths[0], from: 'const raw = declaration(el);\n    const display',
    to: 'images.set(el, 0);\n    const raw = declaration(el);\n    const display',
    test: 'varied opaque visible colours', suite: 'test/concealed-cost.test.mjs', assertion: /ordinary detector collection writes must be zero/ },
  { name: 'double-read', file: paths[0], from: 'value = raw?.[ALL_FIELDS[field]];', to: 'value = raw?.[ALL_FIELDS[field]]; void raw?.[ALL_FIELDS[field]];',
    test: 'concealed style calls and property reads', suite: 'test/concealed-cost.test.mjs', assertion: /no computed property read twice per element/ },
  { name: 'colour', file: paths[0], from: 'if (color !== work[3]) {', to: 'if (false) {',
    test: 'concealed colour near-white', suite: 'test/contract.test.mjs', assertion: /near-white text and colour counts/ },
  { name: 'spoof', file: paths[1], from: 'if (attr.name.toLowerCase() === CONCEALED_MARK) continue;', to: 'if (false) continue;',
    test: 'concealed spoof control:', suite: 'test/contract.test.mjs', assertion: /spoof retained text and zero concealment counts/ },
  { name: 'ordering', file: paths[2], from: '  for (const panel of panels) {', to: '  concealment?.lift(doc);\n  for (const panel of panels) {',
    test: 'concealed ordering control:', suite: 'test/contract.test.mjs', assertion: /ordering short tab label content and counts/ },
  { name: 'separator', file: paths[0], from: 'if (!removesWhitespace && /^\\s|\\s$/.test(text))', to: 'if (!removesWhitespace)',
    test: 'concealed source whitespace B opacity_zero none span', suite: 'test/contract.test.mjs', assertion: /markdown source whitespace/ },
];
export function checkAnchors(sources) {
  const missing = controls.filter(control => !sources.get(control.file)?.toString().replace(/\r\n/g, '\n').includes(control.from));
  assert.equal(missing.length, 0, `missing mutation anchors: ${missing.map(control => control.name).join(', ')}`);
}

function run() {
  const originals = new Map(paths.map(p => [p, fs.readFileSync(p)]));
  // Validate every control before writing any source; a stale anchor exits non-zero.
  checkAnchors(originals);
  try {
    for (const control of controls) {
      let source = originals.get(control.file).toString().replace(/\r\n/g, '\n');
      assert.ok(source.includes(control.from), `missing mutation anchor: ${control.name}`);
      source = source.replace(control.from, control.to);
      fs.writeFileSync(control.file, source);
      try {
        const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', control.test, control.suite], { encoding: 'utf8' });
        const output = result.stdout + result.stderr;
        assert.equal(result.status, 1, `${control.name} survived: ${output}`);
        assert.match(output, control.assertion, `${control.name} did not fail its named assertion: ${output}`);
      } finally { fs.writeFileSync(control.file, originals.get(control.file)); }
      for (const [p, bytes] of originals) assert.ok(fs.readFileSync(p).equals(bytes), `restore failed: ${p}`);
      console.log(`${control.name}: named assertion failed; exact bytes restored`);
    }
  } finally {
    for (const [p, bytes] of originals) fs.writeFileSync(p, bytes);
  }
  console.log('All mutation controls restored exact bytes.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
