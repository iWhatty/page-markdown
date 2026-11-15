import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('README documents the 0.3.0 bundle figures and current size ceiling', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const size = fs.readFileSync(new URL('../bench/size.mjs', import.meta.url), 'utf8');
  const ceiling = size.match(/const BUDGET_MIN_BYTES = (\d+) \* 1024;/);
  assert.ok(ceiling, 'size gate declares its ceiling');
  assert.ok(/Browser bundle: about 86\.0 KB minified, 31\.2 KB gzip/.test(readme), 'README has the reviewed bundle figures');
  assert.ok(new RegExp(`ceiling ${ceiling[1]} KB\\s+minified\\)`).test(readme), 'README ceiling matches the size gate');
});
