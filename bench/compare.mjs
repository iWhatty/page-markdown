// Scores page-markdown against a naive baseline (Turndown over the page body,
// as many converters do) on the contract fixtures and the fetched real pages.
// No browser.
//   node bench/fetch-pages.mjs                 (once)
//   node bench/compare.mjs [--write bench/RESULTS.md]
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { pageToMarkdown, TURNDOWN_OPTIONS } from "../src/index.js";

const PAGES = path.resolve(".bench/pages");
const FIXTURE_URL = "https://example.com/dir/page";

const naive = new TurndownService({ ...TURNDOWN_OPTIONS });
naive.remove(["script", "style", "noscript"]);

const ENGINES = {
  "turndown-only": (html) => naive.turndown(parseHTML(html).document.body?.innerHTML || ""),
  "page-markdown": (html, url) => pageToMarkdown(parseHTML(html).document, { url }).markdown,
};

function fixture(file) {
  return fs.readFileSync(path.resolve("test/fixtures", file), "utf8");
}

function fence(md, lang) {
  return md.match(new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```"))?.[1] ?? null;
}

// Raw HTML table markup that must never reach the Markdown.
const RAW_HTML_TABLE = /<\/?(table|tr|td|th|tbody|div)\b|joplin-table-wrapper/i;

// One row per behaviour the package guarantees.
const FIXTURE_CHECKS = [
  ["Code block verbatim, with language", "contract/code-fidelity.html", (md) => fence(md, "py") === "def f():\n    x = 1\n\n\n\n\n    y = 2\n}"],
  ["`<pre>` without `<code>` fenced; JSON-like text kept", "regression/pre-without-code.html", (md) => Boolean(fence(md, "python")) && /\{"key": "value"\} form/.test(md) && /object_hook=as_complex/.test(md)],
  ["GFM table with short cells", "contract/table.html", (md) => /^\| A \| 1 \|$/m.test(md)],
  ["Complex tables as GFM, never raw HTML", "regression/complex-tables.html", (md) => !RAW_HTML_TABLE.test(md) && /^\| Filename extensions \|/m.test(md)],
  ["Short list items kept", "contract/nested-lists.html", (md) => /deep1/.test(md) && /^\s*1\.\s+first$/m.test(md)],
  ["Short article trimmed of chrome", "source-capture/article.html", (md) => /Electric motorcycles/.test(md) && !/Subscribe|Sponsored gear|Copyright/.test(md)],
  ["Long article trimmed of chrome", "contract/article-chrome.html", (md) => /Headline/.test(md) && !/\(c\) Footer/.test(md)],
  ["Headline from the page's H1, no site suffix", "regression/title-suffix.html", (md) => /^# widgets — Widget toolkit\n/.test(md)],
  ["Absolute links", "contract/links.html", (md) => /\]\(https:\/\/example\.com\/rel\/path\?x=1\)/.test(md)],
  ["javascript: links removed", "contract/links.html", (md) => !/javascript:/.test(md)],
  ["Lazy images resolved", "contract/images.html", (md) => /lazy\.png/.test(md)],
  ["Ads removed", "contract/ads-overlays.html", (md) => !/ADSENSE|ADSLOT|PLACEMENT|SPONSOREDLABEL/.test(md)],
  ["Heading wrappers and [edit] links cleaned", "regression/heading-wrappers.html", (md) => /^## History$/m.test(md) && !/\[edit\]/.test(md)],
  ["Empty anchor links removed", "regression/empty-anchors.html", (md) => !/\[\]\(/.test(md)],
  ["Script/style/template text removed", "contract/hidden.html", (md) => !/SCRIPTTEXT|STYLETEXT|NOSCRIPTTEXT|TEMPLATETEXT/.test(md)],
];

// Content preservation and chrome probes per real page.
const PAGE_CHECKS = {
  "mdn-abortsignal": [
    ["Keeps the definition paragraph", (md) => /interface represents a signal object/.test(md)],
    ["Clean title heading", (md) => /^# AbortSignal\n/.test(md)],
    ["Keeps AbortSignal.timeout()", (md) => /AbortSignal\.timeout\(\)/.test(md)],
    ["≥ 8 fenced code blocks", (md) => (md.match(/^```/gm) || []).length / 2 >= 8],
    ["No 'In this article' chrome", (md) => !/In this article/.test(md)],
  ],
  "wikipedia-markdown": [
    ["No raw HTML tables", (md) => !RAW_HTML_TABLE.test(md)],
    ["≥ 10 section headings", (md) => (md.match(/^#{2,4} /gm) || []).length >= 10],
    ["No [edit] links", (md) => !/\[edit\]/i.test(md)],
    ["Keeps 'John Gruber'", (md) => /John Gruber/.test(md)],
  ],
  "python-json-docs": [
    ["Clean title heading", (md) => /^# json — JSON encoder and decoder\n/.test(md)],
    ["Code fenced", (md) => /^```/m.test(md) && /^>>> import json$/m.test(md)],
    ["JSON example intact", (md) => /\{"bar": \["baz", null, 1\.0, 2\]\}/.test(md)],
    ["object_hook text kept", (md) => /object_hook/.test(md)],
  ],
  "pg-essay": [
    ["Keeps the opening", (md) => /If you collected lists of techniques for doing great work/.test(md)],
    ["Keeps the end", (md) => /Thanks(\*\*)? to Trevor Blackwell/.test(md)],
  ],
  "github-readability": [
    ["No repository navigation", (md) => !/Repository navigation|Pull requests\d/.test(md)],
    ["Install command in a code fence", (md) => /```[a-z]*\nnpm install @mozilla\/readability\n```/.test(md)],
  ],
};

function relativeLinks(md) {
  return [...md.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)/g)].filter((m) => !/^(https?:|mailto:|#)/.test(m[1])).length;
}

const rows = [];
const score = Object.fromEntries(Object.keys(ENGINES).map((e) => [e, 0]));
let total = 0;

for (const [label, file, check] of FIXTURE_CHECKS) {
  const html = fixture(file);
  const row = { label, file };
  for (const [engine, run] of Object.entries(ENGINES)) {
    let ok = false;
    try { ok = Boolean(check(run(html, FIXTURE_URL))); } catch { ok = false; }
    row[engine] = ok;
    if (ok) score[engine] += 1;
  }
  total += 1;
  rows.push(row);
}

const pageRows = [];
const pageStats = [];
if (fs.existsSync(PAGES)) {
  for (const [name, checks] of Object.entries(PAGE_CHECKS)) {
    const htmlFile = path.join(PAGES, `${name}.html`);
    if (!fs.existsSync(htmlFile)) continue;
    const html = fs.readFileSync(htmlFile, "utf8");
    const url = fs.readFileSync(path.join(PAGES, `${name}.url`), "utf8").trim();
    const outputs = {};
    for (const [engine, run] of Object.entries(ENGINES)) {
      const t0 = performance.now();
      outputs[engine] = run(html, url);
      pageStats.push({ page: name, engine, chars: outputs[engine].length, relativeLinks: relativeLinks(outputs[engine]), ms: Math.round(performance.now() - t0) });
    }
    for (const [label, check] of checks) {
      const row = { label: `${name}: ${label}` };
      for (const engine of Object.keys(ENGINES)) {
        row[engine] = Boolean(check(outputs[engine]));
        if (row[engine]) score[engine] += 1;
      }
      total += 1;
      pageRows.push(row);
    }
  }
}

const mark = (ok) => (ok ? "✅" : "❌");
const engines = Object.keys(ENGINES);
const lines = [];
lines.push(`| Check | ${engines.join(" | ")} |`, `|---|${engines.map(() => "---").join("|")}|`);
for (const row of [...rows, ...pageRows]) lines.push(`| ${row.label} | ${engines.map((e) => mark(row[e])).join(" | ")} |`);
lines.push(`| **Total** | ${engines.map((e) => `**${score[e]}/${total}**`).join(" | ")} |`);
if (pageStats.length) {
  lines.push("", "| Page | Engine | Chars | Relative links | ms |", "|---|---|---|---|---|");
  for (const s of pageStats) lines.push(`| ${s.page} | ${s.engine} | ${s.chars} | ${s.relativeLinks} | ${s.ms} |`);
} else {
  lines.push("", "_Real pages skipped: run `node bench/fetch-pages.mjs` first._");
}
const table = lines.join("\n");
console.log(table);

const writeIndex = process.argv.indexOf("--write");
if (writeIndex > -1) {
  const out = process.argv[writeIndex + 1] || "bench/RESULTS.md";
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const date = new Date().toISOString().slice(0, 10);
  const header = [
    "# Benchmark results",
    "",
    `Generated by \`bench/compare.mjs\` on ${date}: page-markdown ${version} against a naive`,
    "baseline (Turndown over the page body, with the same options and no extraction).",
    "Node with linkedom, no browser. Real pages are fetched as static HTML by",
    "`bench/fetch-pages.mjs` and are not committed.",
  ].join("\n");
  fs.writeFileSync(out, `${header}\n\n${table}\n`);
  console.log(`\nwrote ${out}`);
}
