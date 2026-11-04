// Runs the golden fixtures and live-DOM checks in a real browser: headless
// Chrome or Edge, no extra dependencies. Builds one self-contained page
// (bundle, harness and fixtures inline, so file:// works), loads it with
// --dump-dom and reads the results back.
//   npm run test:browser
//   PAGE_MARKDOWN_BROWSER=/path/to/chrome npm run test:browser
// The built page stays at .browser-test/index.html for opening by hand.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GOLDEN_OPTIONS, GOLDEN_DIRS } from "../golden-options.mjs";

const FIXTURES = "test/fixtures";
const OUT_DIR = ".browser-test";
const URL_BASE = "https://example.com/dir/page";

const CANDIDATES = [
  process.env.PAGE_MARKDOWN_BROWSER,
  ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].flatMap((v) => process.env[v]
    ? [path.join(process.env[v], "Google/Chrome/Application/chrome.exe"), path.join(process.env[v], "Microsoft/Edge/Application/msedge.exe")]
    : []),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "google-chrome", "chromium", "chromium-browser", "microsoft-edge",
].filter(Boolean);

const fixtures = GOLDEN_DIRS.flatMap((dir) => fs.readdirSync(path.join(FIXTURES, dir))
  .filter((f) => f.endsWith(".html"))
  .map((f) => {
    const file = `${dir}/${f}`;
    const golden = fs.readFileSync(path.join(FIXTURES, "golden", `${dir}--${f.replace(/\.html$/, "")}.md`), "utf8")
      .replace(/\r\n/g, "\n").replace(/\n$/, "");
    return { file, html: fs.readFileSync(path.join(FIXTURES, file), "utf8"), golden, options: GOLDEN_OPTIONS[file] || {} };
  }));

const bundle = await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "iife",
  globalName: "PageMarkdown",
  platform: "browser",
  write: false,
  logLevel: "error",
});

// An inline script ends at the first "</script"; in JavaScript that can only
// sit in a string, template or regex, where "<\/" means the same.
const inline = (code) => code.replace(/<\/script/gi, "<\\/script");
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>page-markdown browser run</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:16px}li{white-space:pre-wrap;font-family:ui-monospace,monospace}.fail{color:#b00020}#stage{position:absolute;left:-9999px}</style>
</head><body>
<h1>page-markdown browser run</h1>
<p id="summary">running</p>
<ul id="list"></ul>
<div id="stage"></div>
<pre id="results" hidden></pre>
<script>addEventListener("error", (e) => { document.getElementById("summary").textContent = "error: " + e.message; });</script>
<script type="application/json" id="data">${JSON.stringify({ fixtures, url: URL_BASE }).replace(/</g, "\\u003c")}</script>
<script>${inline(bundle.outputFiles[0].text)}</script>
<script>${inline(fs.readFileSync("test/browser/harness.js", "utf8"))}</script>
</body></html>
`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const pagePath = path.resolve(OUT_DIR, "index.html");
fs.writeFileSync(pagePath, page);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "page-markdown-browser-"));
const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--dump-dom", pathToFileURL(pagePath).href];
let dom = null;
let used = null;
for (const browser of CANDIDATES) {
  if (path.isAbsolute(browser) && !fs.existsSync(browser)) continue;
  const run = spawnSync(browser, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  if (run.error?.code === "ENOENT") continue;
  dom = run.stdout;
  used = browser;
  break;
}
fs.rmSync(profile, { recursive: true, force: true });

if (!used) {
  console.error("no Chrome or Edge found; set PAGE_MARKDOWN_BROWSER to a Chromium-based browser");
  process.exit(1);
}
const match = dom?.match(/<pre id="results" hidden="">([^<]*)<\/pre>/);
if (!match?.[1]) {
  console.error(`no results from ${used}; open ${pagePath} to see why`);
  process.exit(1);
}
const { userAgent, results } = JSON.parse(decodeURIComponent(match[1]));
const failed = results.filter((r) => !r.ok);
for (const r of failed) console.error(`FAIL ${r.name}\n${r.error}\n`);
console.log(`browser: ${userAgent}`);
console.log(`${results.length - failed.length}/${results.length} passed (${fixtures.length} goldens, ${results.length - fixtures.length} live-DOM checks)`);
if (failed.length) process.exitCode = 1;
