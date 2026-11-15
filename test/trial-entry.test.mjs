import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseHTML } from 'linkedom';
import { pageToMarkdown } from 'page-markdown';
import { pageToMarkdown as trialToMarkdown } from 'page-markdown/trial';

test('main entry module graph excludes trial code', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { registerHooks } from 'node:module';
    const loaded = [];
    registerHooks({ load(url, context, next) {
      loaded.push(url);
      return next(url, context);
    } });
    await import('page-markdown');
    console.log(JSON.stringify(loaded));
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const loaded = JSON.parse(result.stdout);
  assert.ok(loaded.some(url => url.endsWith('/src/index.js')));
  assert.ok(!loaded.some(url => url.endsWith('/src/trial.js')),
    'main entry must not load trial modules');
});

test('main entry directs trial callers to the diagnostic entry', () => {
  const doc = parseHTML('<html><body><p>Source</p></body></html>').document;
  assert.throws(() => pageToMarkdown(doc, { diagnostics: 'trial' }), {
    name: 'TrialEntryRequiredError', message: /page-markdown\/trial/,
  });
  const off = pageToMarkdown(doc, { extract: 'full' });
  const { diagnostics, ...trial } = trialToMarkdown(doc, { extract: 'full', diagnostics: 'trial' });
  assert.deepEqual(trial, off);
  assert.equal(diagnostics.schema, 'page-markdown.trial.v1');
});
