// Ties the declarations generated from src's JSDoc to what the code really returns. Runs the pipeline over
// every fixture and some built pages, then writes .types-test/real-output.ts,
// which `tsc -p test/types` checks:
// - each output as a literal of its declared type, so an undeclared field, a
//   missing required field or a wrong value type fails;
// - the fields seen against the fields declared, so a declared field that no
//   output produces fails too;
// - the module's runtime exports against the declared exports.
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";

import * as api from "../../src/index.js";

const OUT = ".types-test/real-output.ts";
const FIXTURES = "test/fixtures";
const URL_BASE = "https://example.com/dir/page";
const LOREM = "A sentence long enough to count as readable article content for the extractor. ".repeat(12);
const LEAD = "This lead paragraph is the page's own summary, and the meta description repeats it word for word.";
const cp = (...points) => String.fromCodePoint(...points);

const parse = (html) => parseHTML(html).document;

const ARTICLE = `<html lang="en"><head><title>Headline - Site</title></head>
  <body><article><h1>Headline</h1><p>${LOREM}</p></article><aside><dl><dt>Version</dt><dd>1.2.3</dd></dl></aside></body></html>`;

// Outputs the fixtures don't reach, including every optional field and kind.
function builtPages() {
  const shadow = parse(`<html><body><main><p>${LOREM}</p><div id="host"></div></main></body></html>`);
  const root = shadow.createDocumentFragment();
  root.appendChild(shadow.createElement("p")).textContent = "In the shadow.";
  Object.defineProperty(shadow.getElementById("host"), "shadowRoot", { value: root });
  const hidden = `${cp(0xE0041, 0xE0042)} ${cp(0xFE00, 0xFE01, 0xFE02, 0xFE03)} ${cp(0x2061, 0x2062, 0x2063)} ${cp(0xE0080, 0xE0081)}`;
  const json = JSON.stringify({ a: 1, b: "x".repeat(2000) });
  return [
    [shadow, { extract: "full", sanitize: { shadowNodeLimit: 1 } }],
    [parse(`<html><body><p>${LOREM}</p><p>${json}</p></body></html>`), { extract: "full" }],
    [parse(`<html><body><p>${LOREM} ${hidden}</p></body></html>`), { extract: "full", removeHiddenText: true, includeFullPage: true }],
    [parse("<html><body><p>Too little.</p></body></html>"), {}],
    [parse(ARTICLE), { extract: () => ({ html: `<p>${LOREM}</p>`, method: "custom", title: "Custom title", byline: "Ann Author" }) }],
    [parse(ARTICLE), { extract: () => { throw new Error("nope"); } }],
    [parse(ARTICLE), { minExtractChars: 1e6 }],
    [parse(`<html><body><main><article><h1>H</h1><p>${LOREM}</p></article><div class="comment">${"A long reply from a reader, going on at some length. ".repeat(60)}</div></main></body></html>`), {}],
    [parse(`<html><body><main><h1>H</h1><p>${LOREM}</p><div role="tablist"><a role="tab" id="t">Long</a></div><div role="tabpanel" aria-labelledby="t" hidden>${LOREM.repeat(6)}</div></main></body></html>`), {}],
    [parse(`<html><head><title>T</title><meta name="description" content="${LEAD}"></head><body><section><p>${LEAD}</p></section></body></html>`),
      { extract: () => ({ html: `<p>${LOREM}</p>`, method: "custom" }) }],
  ];
}

const FIXTURE_OPTIONS = [{}, { includeFullPage: true }, { extract: "full" }, { pageFacts: true }, { removeHiddenText: true }, { mode: "no_links" }, { mode: "text_only" }];

function allResults() {
  const results = [];
  for (const dir of fs.readdirSync(FIXTURES)) {
    if (dir === "golden") continue;
    for (const file of fs.readdirSync(path.join(FIXTURES, dir)).filter((f) => f.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(FIXTURES, dir, file), "utf8");
      for (const options of FIXTURE_OPTIONS) results.push(api.pageToMarkdown(parse(html), { url: URL_BASE, ...options }));
    }
  }
  for (const [doc, options] of builtPages()) results.push(api.pageToMarkdown(doc, { url: URL_BASE, ...options }));
  return results;
}

// Long strings only add size here: their type is all that matters.
const shorten = (_, value) => (typeof value === "string" && value.length > 40 ? value.slice(0, 40) : value);
const union = (values) => [...new Set(values)].sort().map((value) => JSON.stringify(value)).join(" | ") || "never";

const lines = [
  `import type * as api from "page-markdown";`,
  "type KeysOf<U> = U extends unknown ? keyof U : never;",
  "type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;",
  "declare function same<A, B>(check: Same<A, B>): void;",
];
let index = 0;
const literal = (type, value) => lines.push(`export const v${index++}: ${type} = ${JSON.stringify(value, shorten)};`);
const sameAs = (type, values) => lines.push(`same<${type}, ${union(values)}>(true);`);
const fields = (type, objects) => sameAs(`KeysOf<${type}>`, objects.flatMap((object) => Object.keys(object)));

const results = allResults();
for (const result of results) literal("api.PageMarkdownResult", result);

fields("api.PageMarkdownResult", results);
fields("api.PageMarkdownMetadata", results.map((r) => r.metadata));
fields("api.PageMarkdownExtraction", results.map((r) => r.extraction));
fields("api.PageMarkdownStats", results.map((r) => r.stats));
fields("api.StandardizationStats", results.map((r) => r.stats.standardization));
fields("api.PageMarkdownOmission", results.flatMap((r) => r.omissions));
sameAs(`api.PageMarkdownOmission["kind"]`, results.flatMap((r) => r.omissions.map((o) => o.kind)));
sameAs(`api.PageMarkdownStats["mode"]`, results.map((r) => r.stats.mode));

// The stages, one page each: their shapes don't vary with the input as a result's do.
const stage = (name, value, select = "") => literal(`ReturnType<typeof api.${name}>${select}`, value);
const inert = api.sanitizeToInertDocument(parse(ARTICLE));
stage("sanitizeToInertDocument", inert.omissions, `["omissions"]`);
stage("standardizeDocument", api.standardizeDocument(inert.document, { url: URL_BASE }));
const extraction = api.extractContent(inert.document);
stage("extractContent", extraction);
stage("extractContent", api.extractContent(inert.document, { extract: "full" }));
stage("htmlToMarkdown", api.htmlToMarkdown(extraction.html));
stage("cleanMarkdown", api.cleanMarkdown("# x"));
stage("applyMode", api.applyMode("[a](b)", "no_links"));
stage("mapOutsideFences", api.mapOutsideFences("x", (prose) => prose));
stage("collectMetadata", api.collectMetadata(parse(ARTICLE), { url: URL_BASE }));
stage("recoverLeadParagraph", api.recoverLeadParagraph(extraction.html, inert.document, LEAD));
stage("chooseHeadline", api.chooseHeadline(inert.document, { documentTitle: "Headline - Site" }));
const facts = api.collectPageFacts(inert.document, "");
if (!facts.length) throw new Error("expected a page fact to check");
stage("collectPageFacts", facts);
stage("pageFactsMarkdown", api.pageFactsMarkdown(facts));
stage("isAdvertisementElement", api.isAdvertisementElement(inert.document.body));
const hidden = api.removeHiddenText(`a${cp(0xE0041, 0xE0042)}b`);
stage("removeHiddenText", hidden);
stage("hiddenTextOmissions", api.hiddenTextOmissions(hidden.runs));
lines.push(`same<api.HiddenRun, import("text-sanctifier/hidden").HiddenRun>(true);`);

for (const name of ["VERSION", "DEFAULT_MIN_EXTRACT_CHARS", "DEFAULT_SANITIZE_OPTIONS", "TURNDOWN_OPTIONS"]) literal(`typeof api.${name}`, api[name]);
sameAs("keyof typeof api.DEFAULT_SANITIZE_OPTIONS", Object.keys(api.DEFAULT_SANITIZE_OPTIONS));
sameAs("keyof typeof api.TURNDOWN_OPTIONS", Object.keys(api.TURNDOWN_OPTIONS));

// Turndown ships no types, so the declared methods are checked against the object.
const turndown = api.createTurndown();
for (const method of ["turndown", "use", "addRule", "keep", "remove", "escape"]) {
  if (typeof turndown[method] !== "function") throw new Error(`Turndown has no ${method}()`);
}

sameAs("keyof typeof api", Object.keys(api));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${lines.join("\n")}\n`);
console.log(`${results.length} results written to ${OUT}`);
