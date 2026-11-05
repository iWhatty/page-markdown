// Scores page-markdown against two baselines on the contract fixtures and the
// fetched real pages: Turndown over the page body, and the stock recipe of
// Readability then Turndown. Probes say whether specific things survived; word
// recall and precision (see REFERENCES in probes.mjs) say how much of the page's
// content came through and how much else came with it. No browser.
//   node bench/fetch-pages.mjs                 (once)
//   npm run bench                              (prints only)
//   npm run bench:write                        (also writes bench/RESULTS.md)
import fs from "node:fs";
import path from "node:path";
import Readability from "@mozilla/readability/Readability.js";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { pageToMarkdown, TURNDOWN_OPTIONS } from "../src/index.js";
import { ALWAYS_DROP, HELD_OUT, plain, REFERENCES, straighten } from "./probes.mjs";

const PAGES = path.resolve(".bench/pages");
const FIXTURE_URL = "https://example.com/dir/page";

const naive = new TurndownService({ ...TURNDOWN_OPTIONS });
naive.remove(["script", "style", "noscript"]);

function bodyMarkdown(document) {
  return naive.turndown(document.body?.innerHTML || "");
}

// What a careful caller writes from the two packages' READMEs: a title heading
// from Readability, its content through Turndown, and the body when Readability
// gives up. baseURI is set because a browser would have it and linkedom does not.
function readabilityTurndown(html, url) {
  const { document } = parseHTML(html);
  Object.defineProperty(document, "baseURI", { value: url });
  Object.defineProperty(document, "documentURI", { value: url });
  const fallback = parseHTML(html).document;
  const article = new Readability(document).parse();
  if (!article?.content) return { markdown: bodyMarkdown(fallback), method: "full_page" };
  const title = article.title ? `# ${article.title}\n\n` : "";
  return { markdown: `${title}${naive.turndown(article.content)}`, method: "readability" };
}

const ENGINES = {
  "turndown-only": (html) => ({ markdown: bodyMarkdown(parseHTML(html).document), method: "full_page" }),
  "readability+turndown": readabilityTurndown,
  "page-markdown": (html, url) => {
    const result = pageToMarkdown(parseHTML(html).document, { url });
    return { markdown: result.markdown, method: result.extraction.method };
  },
};
const engines = Object.keys(ENGINES);

function runEngine(engine, html, url) {
  try {
    return ENGINES[engine](html, url);
  } catch (error) {
    return { markdown: "", method: `crashed: ${error.message}` };
  }
}

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

const segmenter = new Intl.Segmenter("und", { granularity: "word" });

// Counted word tokens, by Unicode segmentation so Japanese and Arabic count too.
function wordCounts(text) {
  const counts = new Map();
  const clean = straighten(text).toLowerCase().replace(/\p{Cf}/gu, "");
  for (const { segment, isWordLike } of segmenter.segment(clean)) {
    if (isWordLike) counts.set(segment, (counts.get(segment) || 0) + 1);
  }
  return counts;
}

function referenceElements(html, name) {
  const { roots, drop } = REFERENCES[name];
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll(drop ? `${ALWAYS_DROP},${drop}` : ALWAYS_DROP)) el.remove();
  return roots.map((root) => [...document.querySelectorAll(root)]);
}

function referenceText(html, name) {
  return referenceElements(html, name).flat().map((el) => el.textContent).join(" ");
}

// Bag-of-words overlap with the reference. Recall alone would reward dumping the
// whole page, so precision is reported beside it.
function wordScores(reference, md) {
  const output = wordCounts(plain(md.replace(/^```.*$/gm, "")));
  const size = (counts) => [...counts.values()].reduce((sum, n) => sum + n, 0);
  let shared = 0;
  for (const [word, n] of reference) shared += Math.min(n, output.get(word) || 0);
  return { recall: shared / size(reference), precision: size(output) ? shared / size(output) : 0 };
}

// Probes checked against the raw page alone, so none is vacuous or contradicts
// its reference. Runs no engine.
function probeProblems(name, html, checks) {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script,style,noscript,template")) el.remove();
  const squeeze = (text) => straighten(text).replace(/\s+/g, " ");
  const page = squeeze(document.documentElement.textContent);
  const reference = squeeze(referenceText(html, name));
  const problems = referenceElements(html, name).flatMap((hits, i) => (hits.length ? [] : [`${name}: reference root \`${REFERENCES[name].roots[i]}\` matches nothing`]));
  for (const [label, check] of checks) {
    if (!check.phrase) continue;
    const phrase = squeeze(check.phrase);
    if (!page.includes(phrase)) problems.push(`${name}: "${label}" phrase is not on the page`);
    else if (check.absent === reference.includes(phrase)) problems.push(`${name}: "${label}" contradicts the reference`);
  }
  return problems;
}

const tiers = {
  fixtures: { label: "Contract fixtures (written with the package)", rows: [] },
  tuned: { label: "Tuned pages (fixes were developed on these)", rows: [], pages: [] },
  heldOut: { label: "Held-out pages (probes written before any engine ran)", rows: [], pages: [] },
};

for (const [label, file, check] of FIXTURE_CHECKS) {
  const html = fixture(file);
  const row = { label };
  for (const engine of engines) {
    let ok = false;
    try { ok = Boolean(check(runEngine(engine, html, FIXTURE_URL).markdown)); } catch { ok = false; }
    row[engine] = ok;
  }
  tiers.fixtures.rows.push(row);
}

const missing = [];
const pageStats = [];
const snapshots = [];
const problems = [];

function scorePage(tier, name, checks) {
  const htmlFile = path.join(PAGES, `${name}.html`);
  const metaFile = path.join(PAGES, `${name}.json`);
  if (!fs.existsSync(htmlFile) || !fs.existsSync(metaFile)) {
    missing.push(name);
    return;
  }
  const html = fs.readFileSync(htmlFile, "utf8");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  snapshots.push({ name, ...meta });
  problems.push(...probeProblems(name, html, checks));
  const reference = wordCounts(referenceText(html, name));
  const page = { name, referenceWords: [...reference.values()].reduce((sum, n) => sum + n, 0), scores: {} };
  const outputs = {};
  for (const engine of engines) {
    const t0 = performance.now();
    const { markdown, method } = runEngine(engine, html, meta.finalUrl);
    const ms = Math.round(performance.now() - t0);
    outputs[engine] = markdown;
    page.scores[engine] = wordScores(reference, markdown);
    pageStats.push({ page: name, engine, chars: markdown.length, relativeLinks: relativeLinks(markdown), method, ms });
  }
  tier.pages.push(page);
  for (const [label, check] of checks) {
    const row = { label: `${name}: ${label}` };
    for (const engine of engines) row[engine] = Boolean(check(outputs[engine]));
    tier.rows.push(row);
  }
}

for (const [name, checks] of Object.entries(PAGE_CHECKS)) scorePage(tiers.tuned, name, checks);
for (const [name, checks] of Object.entries(HELD_OUT)) scorePage(tiers.heldOut, name, checks);

const mark = (ok) => (ok ? "✅" : "❌");
const percent = (x) => `${(x * 100).toFixed(1)}%`;
const passes = (rows, engine) => rows.filter((row) => row[engine]).length;
const mean = (pages, engine, key) => pages.reduce((sum, p) => sum + p.scores[engine][key], 0) / pages.length;
const allTiers = Object.values(tiers);
const allRows = allTiers.flatMap((t) => t.rows);
const allPages = allTiers.flatMap((t) => t.pages || []);
const tableHead = (first) => [`| ${first} | ${engines.join(" | ")} |`, `|---|${engines.map(() => "---").join("|")}|`];

const lines = ["## Summary", "", ...tableHead("Probes passed")];
for (const tier of allTiers) lines.push(`| ${tier.label} | ${engines.map((e) => `${passes(tier.rows, e)}/${tier.rows.length}`).join(" | ")} |`);
lines.push(`| **All probes** | ${engines.map((e) => `**${passes(allRows, e)}/${allRows.length}**`).join(" | ")} |`);
for (const tier of allTiers.filter((t) => t.pages?.length)) {
  lines.push(`| Mean word recall / precision: ${tier.label.split(" (")[0].toLowerCase()} | ${engines.map((e) => `${percent(mean(tier.pages, e, "recall"))} / ${percent(mean(tier.pages, e, "precision"))}`).join(" | ")} |`);
}
if (missing.length) lines.push("", `**Pages missing, not scored: ${missing.join(", ")}.** Run \`node bench/fetch-pages.mjs\`.`);
if (problems.length) lines.push("", "**Probe self-check problems:**", "", ...problems.map((p) => `- ${p}`));

const failures = allTiers.flatMap((tier) => tier.rows).filter((row) => !row["page-markdown"]);
lines.push("", "## page-markdown failures", "");
if (failures.length) lines.push(...failures.map((row) => `- ${row.label}`));
else lines.push("None.");

lines.push("", "## Word recall per page", "", "Recall / precision against each page's reference.", "", `| Page | Reference words | ${engines.join(" | ")} |`, `|---|---|${engines.map(() => "---").join("|")}|`);
for (const page of allPages) lines.push(`| ${page.name} | ${page.referenceWords} | ${engines.map((e) => `${percent(page.scores[e].recall)} / ${percent(page.scores[e].precision)}`).join(" | ")} |`);

lines.push("", "## All probes");
for (const tier of allTiers) {
  lines.push("", `### ${tier.label}`, "", ...tableHead("Check"));
  for (const row of tier.rows) lines.push(`| ${row.label} | ${engines.map((e) => mark(row[e])).join(" | ")} |`);
  lines.push(`| **Total** | ${engines.map((e) => `**${passes(tier.rows, e)}/${tier.rows.length}**`).join(" | ")} |`);
}

lines.push("", "## Output stats", "", "| Page | Engine | Chars | Relative links | Extraction | ms |", "|---|---|---|---|---|---|");
for (const s of pageStats) lines.push(`| ${s.page} | ${s.engine} | ${s.chars} | ${s.relativeLinks} | ${s.method} | ${s.ms} |`);

lines.push("", "## Snapshots", "", "Scores belong to these bytes; a live page can change.", "", "| Page | URL | Fetched | SHA-256 |", "|---|---|---|---|");
for (const s of snapshots) lines.push(`| ${s.name} | ${s.finalUrl} | ${s.fetched} | \`${s.sha256.slice(0, 12)}\` |`);

const report = lines.join("\n");
console.log(report);

const writeIndex = process.argv.indexOf("--write");
if (writeIndex > -1) {
  if (missing.length) {
    console.error(`\nnot writing: ${missing.length} page(s) missing would shrink the denominator`);
    process.exit(1);
  }
  const out = process.argv[writeIndex + 1] || "bench/RESULTS.md";
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const date = new Date().toISOString().slice(0, 10);
  const header = [
    "# Benchmark results",
    "",
    `Generated by \`bench/compare.mjs\` on ${date}: page-markdown ${version} against two baselines.`,
    "`turndown-only` is Turndown over the page body. `readability+turndown` is a title",
    "heading from Readability plus its content through Turndown, falling back to the body.",
    "Neither has `turndown-plugin-gfm`, so they lose table probes they might pass with it.",
    "",
    "Read the tiers separately. The maintainers wrote the fixtures and tuned the package on",
    "the tuned pages, so only the held-out tier approximates pages it has not seen. Even",
    "those probes were written for this package, though before any engine ran. One later",
    "commit fixed how the probes parse fences; no expectation changed. Probes test presence,",
    "not quality.",
    "",
    "The held-out tier is no longer unseen. It first scored 75/100, and most of the gain since",
    "comes from fixes for its own failures: code line breaks, the ad marker on heise.de's body,",
    "lost headings, and the main-content fallback for Lobsters and IKEA. New pages are the real test.",
    "",
    "Word recall is the share of a page's reference words found in the output, counted as a",
    "bag of words after Unicode segmentation. The reference is the text of hand-picked",
    "content elements of the raw HTML (`REFERENCES` in `bench/probes.mjs`), chosen from the",
    "markup and not from any engine's output. Precision is the share of output words that",
    "are in the reference. Word order and structure are not measured, and a judgement call",
    "on what counts as content moves both numbers.",
    "",
    "Node with linkedom, no browser: pages are static HTML from `bench/fetch-pages.mjs`, not",
    "committed, so content rendered by JavaScript is out of scope and live pages can drift.",
    "To reproduce: `pnpm install`, `node bench/fetch-pages.mjs`, `npm run bench:write`.",
  ].join("\n");
  fs.writeFileSync(out, `${header}\n\n${report}\n`);
  console.log(`\nwrote ${out}`);
}
