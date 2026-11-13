// Build only. No process execution, browser discovery, launch helper or server.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPE, requiredIds } from './report-cases.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function commitAtBuild() {
  let gitDir = path.join(root, '.git');
  if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(root, fs.readFileSync(gitDir, 'utf8').trim().replace(/^gitdir:\s*/, ''));
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  if (/^[a-f0-9]{40}$/i.test(head)) return head;
  const ref = head.replace(/^ref:\s*/, '');
  const commonFile = path.join(gitDir, 'commondir');
  const common = fs.existsSync(commonFile) ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim()) : gitDir;
  const loose = path.join(common, ref);
  const sha = fs.existsSync(loose) ? fs.readFileSync(loose, 'utf8').trim()
    : fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split(/\r?\n/).find(line => line.endsWith(` ${ref}`))?.split(' ')[0];
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Cannot resolve build commit');
  return sha;
}
export async function buildReport() {
  const metadata = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    commit: commitAtBuild(), builtAt: new Date().toISOString() };
  const bundle = await build({ absWorkingDir: root, entryPoints: ['./test/browser/report-page.mjs'], bundle: true,
    format: 'iife', platform: 'browser', write: false, logLevel: 'error',
    define: { REPORT_BUILD: JSON.stringify(metadata) } });
  const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self' about:; img-src data:; connect-src 'none'">
<title>Concealment live-style report</title><style>body{font:16px/1.5 system-ui;margin:20px}textarea{display:block;width:100%;height:24em}iframe{width:640px;height:180px;border:1px solid #aaa}#stage{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit}</style></head><body>
<p id="status" role="status">FAIL — 0/${requiredIds.length} cases run; report incomplete</p><button id="copy" disabled>Copy report</button><textarea id="report" readonly aria-label="JSON report"></textarea>
<h1>Concealment live-style report</h1><p>${SCOPE}</p><p>Keep this page in the foreground until complete. Timing is local evidence, not a general guarantee. Each tree has a 60-second budget, checked between synchronous calls; it cannot interrupt a blocked conversion.</p><p id="progress">Running…</p><h2>Named coverage limits</h2><p id="coverage"></p><h2>Local timing</h2><pre id="timing"></pre><h2>Visible fixture staging area</h2><div id="stage"></div><script type="application/json" id="case-inventory">${JSON.stringify(requiredIds)}</script><script>${script}</script></body></html>`;
  const output = path.join(root, '.browser-test/concealment-report.html');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  return { output, bytes: Buffer.byteLength(html), metadata };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildReport();
  console.log(`Built ${result.output} (${result.bytes} bytes); launched nothing.`);
}
