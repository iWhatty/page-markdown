import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { controls, checkAnchors } from './concealed-mutations.mjs';

const sources = new Map(controls.map(({ file }) => [file, fs.readFileSync(new URL(`../${file}`, import.meta.url))]));

test('every mutation anchor exists without applying a mutation', () => {
  checkAnchors(sources);
});

for (const control of controls) {
  test(`missing ${control.name} anchor fails loudly without mutating source`, () => {
    const missing = new Map(sources);
    missing.set(control.file, sources.get(control.file).toString().replace(/\r\n/g, '\n').replaceAll(control.from, ''));
    assert.throws(() => checkAnchors(missing), error => {
      assert.match(error.message, /missing mutation anchors:/);
      assert.ok(error.message.includes(control.name));
      return true;
    });
  });
}

test('missing mutation anchors exit non-zero', () => {
  const runner = new URL('./concealed-mutations.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { checkAnchors } from ${JSON.stringify(runner)}; checkAnchors(new Map());`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing mutation anchors:/);
  for (const { name } of controls) assert.ok(result.stderr.includes(name));
});
