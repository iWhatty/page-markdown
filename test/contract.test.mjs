// Conversion contract for page-markdown. Each test states behaviour the
// package guarantees; golden files pin whole outputs. Fixtures cover common
// page shapes (contract/), small article, docs and product pages
// (source-capture/), and regressions for bugs found in earlier converters
// (regression/).
//
// Regenerate goldens after an intended change:
//   PAGE_MARKDOWN_UPDATE_GOLDEN=1 npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";

import { pageToMarkdown } from "../src/index.js";

const FIXTURES = "test/fixtures";
const URL_BASE = "https://example.com/dir/page";
const UPDATE = process.env.PAGE_MARKDOWN_UPDATE_GOLDEN === "1";

function load(file) {
  return parseHTML(fs.readFileSync(path.join(FIXTURES, file), "utf8")).document;
}

function run(file, options = {}) {
  return pageToMarkdown(load(file), { url: URL_BASE, ...options });
}

function fencedBlock(markdown, language) {
  const match = markdown.match(new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```"));
  return match ? match[1] : null;
}

function golden(name, actual) {
  const file = path.join(FIXTURES, "golden", `${name}.md`);
  if (UPDATE || !fs.existsSync(file)) {
    assert.ok(UPDATE, `missing golden ${file}; run with PAGE_MARKDOWN_UPDATE_GOLDEN=1`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${actual}\n`);
    return;
  }
  const expected = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");
  assert.equal(actual, expected, `${name} changed; review, then regenerate if intended`);
}

// Fixtures whose golden pins an opt-in behaviour.
const GOLDEN_OPTIONS = {
  "regression/package-sidebar.html": { pageFacts: true },
  "regression/linked-images.html": { mode: "no_links" },
};

for (const dir of ["contract", "source-capture", "regression"]) {
  for (const file of fs.readdirSync(path.join(FIXTURES, dir)).filter((f) => f.endsWith(".html"))) {
    test(`golden: ${dir}/${file}`, () => {
      golden(`${dir}--${file.replace(/\.html$/, "")}`, run(`${dir}/${file}`, GOLDEN_OPTIONS[`${dir}/${file}`]).markdown);
    });
  }
}

test("fenced code is verbatim, with its language", () => {
  const { markdown } = run("contract/code-fidelity.html");
  assert.equal(fencedBlock(markdown, "py"), "def f():\n    x = 1\n\n\n\n\n    y = 2\n}");
  assert.equal(fencedBlock(markdown, "js"), "const a = 1;\nif (a) { console.log(a); }");
  assert.match(markdown, /Use `npm install` now\./);
});

test("<pre> without <code> becomes fenced code, and JSON-like text is never deleted", () => {
  const { markdown } = run("regression/pre-without-code.html");
  const code = fencedBlock(markdown, "python");
  assert.ok(code, "a python fence");
  assert.match(code, /^>>> import json$/m);
  assert.match(code, /'\["foo", \{"bar": \["baz", null, 1\.0, 2\]\}\]'/);
  assert.match(code, /^\{"a": 0, "b": 0, "c": 0\}$/m);
  // A greedy multi-line JSON-blob regex once deleted from here to the next backtick.
  assert.match(markdown, /the \{"key": "value"\} form shown in the reference/);
  assert.match(markdown, /`object_hook=as_complex` stays visible/);
});

test("tables become GFM tables, short cells included", () => {
  const { markdown } = run("contract/table.html");
  assert.match(markdown, /^\| Name \| Qty \|$/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| A \| 1 \|$/m);
  assert.match(markdown, /Wide cell/);
});

test("short lines are kept", () => {
  const { markdown } = run("contract/nested-lists.html");
  for (const item of ["one", "one-a", "deep1", "deep2", "two", "first", "second"]) {
    assert.match(markdown, new RegExp(`^\\s*(?:-|\\d+\\.)\\s+${item}$`, "m"), item);
  }
});

test("the readable article is chosen, page chrome dropped", () => {
  const long = run("contract/article-chrome.html");
  assert.equal(long.extraction.method, "readability");
  assert.match(long.markdown, /Headline/);
  assert.doesNotMatch(long.markdown, /Home|About|Related link|\(c\) Footer/);
});

test("a short article (182 chars) is still trimmed of chrome", () => {
  const { markdown, extraction } = run("source-capture/article.html");
  assert.equal(extraction.method, "readability");
  assert.match(markdown, /Electric motorcycles are becoming practical city machines\./);
  assert.match(markdown, /\[full specs\]\(https:\/\/example\.com\/specs\)/);
  assert.doesNotMatch(markdown, /Subscribe|Sponsored gear|Copyright/);
});

test("links are absolute; javascript: links keep only their text", () => {
  const { markdown } = run("contract/links.html");
  assert.match(markdown, /\[relative\]\(https:\/\/example\.com\/rel\/path\?x=1\)/);
  assert.match(markdown, /\[absolute\]\(https:\/\/example\.org\/abs "Abs title"\)/);
  assert.match(markdown, /\[sibling\]\(https:\/\/example\.com\/dir\/rel2\.html\)/);
  assert.doesNotMatch(markdown, /javascript:/);
  assert.match(markdown, /script link/);
});

test("lazy images resolve; inline data: images are dropped", () => {
  const images = run("contract/images.html").markdown;
  assert.match(images, /!\[Alt A\]\(https:\/\/example\.com\/img\/a\.png "Image title"\)/);
  assert.match(images, /!\[Lazy\]\(https:\/\/example\.com\/lazy\.png\)/);
  assert.doesNotMatch(images, /data:image/);
  const placeholder = run("regression/lazy-placeholder.html").markdown;
  assert.match(placeholder, /!\[The real photo\]\(https:\/\/example\.com\/photos\/real\.jpg\)/);
  assert.doesNotMatch(placeholder, /data:image|Inline only\]/);
});

test("ads and product overlays are removed", () => {
  const { markdown } = run("contract/ads-overlays.html", { sanitize: { extraStripSelectors: ["[data-app-overlay]"] } });
  for (const marker of ["ADSENSE", "ADSLOT", "PLACEMENT", "SPONSOREDLABEL", "OVERLAY"]) {
    assert.doesNotMatch(markdown, new RegExp(marker), marker);
  }
  assert.match(markdown, /After the ads\./);
});

test("script, style, noscript and template text never appears", () => {
  const { markdown } = run("contract/hidden.html");
  for (const marker of ["SCRIPTTEXT", "STYLETEXT", "NOSCRIPTTEXT", "TEMPLATETEXT"]) {
    assert.doesNotMatch(markdown, new RegExp(marker), marker);
  }
  assert.match(markdown, /visible/);
});

test("heading wrappers and edit links are standardized", () => {
  const { markdown } = run("regression/heading-wrappers.html");
  assert.match(markdown, /^## History$/m);
  assert.match(markdown, /^### Variants$/m);
  assert.doesNotMatch(markdown, /\[edit\]|action=edit/);
});

test("empty permalink anchors are removed; code language from wrapper class", () => {
  const { markdown } = run("regression/empty-anchors.html");
  assert.match(markdown, /^## Installation$/m);
  assert.doesNotMatch(markdown, /\[\]\(/);
  assert.equal(fencedBlock(markdown, "shell"), "npm install @mozilla/readability");
  assert.match(markdown, /\[usage guide\]\(https:\/\/example\.com\/docs\/usage\)/);
});

test("the <title> text is not duplicated into the body", () => {
  const { markdown } = run("contract/article-chrome.html");
  assert.doesNotMatch(markdown, /^Fixture$/m);
});

test("metadata comes from the original document", () => {
  const { metadata } = pageToMarkdown(load("source-capture/article.html"), { url: "https://example.com/riding-future" });
  assert.equal(metadata.canonicalUrl, "https://example.com/riding-future");
  assert.equal(metadata.siteName, "Example Journal");
  assert.equal(metadata.author, "Ada Rider");
  assert.equal(metadata.published, "2026-04-15");
  assert.equal(metadata.documentTitle, "Riding Into The Future");
});

test("JSON-LD fills author, dates and publisher", () => {
  const html = `<!doctype html><html lang="en"><head><title>T</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","headline":"Real Headline","author":[{"@type":"Person","name":"A. Writer"}],"datePublished":"2026-01-02","dateModified":"2026-01-03","publisher":{"@type":"Organization","name":"The Paper"}}]}</script>
    </head><body><article><p>${"Story text. ".repeat(40)}</p></article></body></html>`;
  const { metadata } = pageToMarkdown(parseHTML(html).document, { url: "https://news.example/a" });
  assert.equal(metadata.author, "A. Writer");
  assert.equal(metadata.published, "2026-01-02");
  assert.equal(metadata.modified, "2026-01-03");
  assert.equal(metadata.siteName, "The Paper");
  assert.equal(metadata.lang, "en");
});

test("long pages are not truncated", () => {
  const paragraphs = Array.from({ length: 4000 }, (_, i) => `<p>Paragraph ${i} lorem ipsum dolor sit amet.</p>`).join("");
  const { markdown } = pageToMarkdown(parseHTML(`<!doctype html><html><body><main>${paragraphs}</main></body></html>`).document, { url: URL_BASE });
  assert.match(markdown, /Paragraph 0 lorem/);
  assert.match(markdown, /Paragraph 3999 lorem/);
});

test("extraction falls back to the full page when the article is too small", () => {
  const html = "<!doctype html><html><body><nav><a href='/'>Home</a></nav><p>Tiny.</p></body></html>";
  const result = pageToMarkdown(parseHTML(html).document, { url: URL_BASE });
  assert.equal(result.extraction.method, "full_page");
  assert.ok(result.extraction.fallbackReason);
  assert.match(result.markdown, /Tiny\./);
  assert.equal(result.warnings.length, 1);
});

test("includeFullPage returns both views (readable + full page)", () => {
  const result = run("contract/article-chrome.html", { includeFullPage: true });
  assert.doesNotMatch(result.markdown, /\(c\) Footer/);
  assert.match(result.fullPageMarkdown, /\(c\) Footer/);
});

test("modes: no_links keeps link text; text_only strips structure; code stays verbatim", () => {
  const noLinks = run("contract/links.html", { mode: "no_links" }).markdown;
  assert.match(noLinks, /relative absolute/);
  assert.doesNotMatch(noLinks, /\]\(/);
  const textOnly = run("contract/article-chrome.html", { mode: "text_only" }).markdown;
  assert.match(textOnly, /^Headline$/m);
  const code = run("contract/code-fidelity.html", { mode: "text_only" }).markdown;
  assert.equal(fencedBlock(code, "py"), "def f():\n    x = 1\n\n\n\n\n    y = 2\n}");
});

test("the live document is not modified", () => {
  const doc = load("contract/ads-overlays.html");
  const before = doc.documentElement.outerHTML;
  pageToMarkdown(doc, { url: URL_BASE });
  assert.equal(doc.documentElement.outerHTML, before);
});

// A host with a defined shadowRoot fragment stands in for attachShadow, which
// linkedom lacks; the sanitizer walks host.shadowRoot.childNodes the same way.
function shadowHost(doc, count) {
  const host = doc.createElement("custom-card");
  const root = doc.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const p = doc.createElement("p");
    p.textContent = `Shadow paragraph ${i} with enough words to count as readable content here.`;
    root.appendChild(p);
  }
  Object.defineProperty(host, "shadowRoot", { value: root, configurable: true });
  doc.querySelector("main").appendChild(host);
}

test("open shadow content is captured; over the limit it is omitted with a notice", () => {
  const { document } = parseHTML(`<!doctype html><html><body><main><p>${"Light text. ".repeat(20)}</p></main></body></html>`);
  shadowHost(document, 2);
  const within = pageToMarkdown(document, { url: URL_BASE, extract: "full" });
  assert.match(within.markdown, /Shadow paragraph 1/);
  assert.equal(within.omissions.length, 0);

  const over = pageToMarkdown(document, { url: URL_BASE, extract: "full", sanitize: { shadowNodeLimit: 2 } });
  assert.doesNotMatch(over.markdown, /Shadow paragraph/);
  assert.equal(over.omissions[0].kind, "shadow_content");
  assert.match(over.markdown, /Open shadow content omitted: capture limit \(1 host\(s\)\)\./);
});

test("the article title heading is kept (Readability lifts it out)", () => {
  const { markdown } = run("source-capture/article.html");
  assert.match(markdown, /^# Riding Into The Future\n/);
  const without = run("source-capture/article.html", { includeTitle: false }).markdown;
  assert.doesNotMatch(without, /^# Riding/);
  // Readability demotes in-article <h1> to <h2>, so the output reads as one
  // "# <title>" over "##" sections, like a reader view.
  const structured = run("contract/article-chrome.html").markdown;
  assert.match(structured, /^# Fixture\n\n## Headline\n/);
  assert.equal((structured.match(/^# /gm) || []).length, 1);
});

test("<br> hard breaks survive cleaning", async () => {
  const { htmlToMarkdown } = await import("../src/convert.js");
  const { cleanMarkdown } = await import("../src/clean.js");
  const { markdown } = cleanMarkdown(htmlToMarkdown("<p>line one<br>line two</p><p>next   </p>"));
  assert.equal(markdown, "line one  \nline two\n\nnext");
});

// Readability drops MDN's heading-less lead section on the real page; an
// extractor that keeps only the headed sections stands in for that here.
function sectionsOnly(doc) {
  const html = Array.from(doc.querySelectorAll("section[aria-labelledby]")).map((s) => s.outerHTML).join("\n");
  return { html, method: "sections_only", title: "ExampleSignal - Web APIs | Example Docs" };
}

test("a lead paragraph the extractor dropped is restored from the meta description", () => {
  const result = run("regression/lead-section.html", { extract: sectionsOnly });
  assert.equal(result.extraction.leadRecovered, true);
  assert.match(result.markdown, /^The \*\*`ExampleSignal`\*\* interface represents a signal object/);
  assert.equal((result.markdown.match(/represents a signal object/g) || []).length, 1);
  assert.match(result.markdown, /## Instance properties/);
  const off = run("regression/lead-section.html", { extract: sectionsOnly, recoverLead: false });
  assert.equal(off.extraction.leadRecovered, undefined);
  assert.doesNotMatch(off.markdown, /represents a signal object/);
});

test("lead recovery never duplicates a paragraph the extractor kept", () => {
  const kept = run("regression/lead-section.html");
  assert.equal(kept.extraction.method, "readability");
  assert.equal(kept.extraction.leadRecovered, undefined);
  assert.equal((kept.markdown.match(/represents a signal object/g) || []).length, 1);
  assert.equal(run("source-capture/article.html").extraction.leadRecovered, undefined);
});

test("lead recovery needs a real description match", async () => {
  const { recoverLeadParagraph } = await import("../src/refine.js");
  const doc = load("regression/lead-section.html");
  assert.equal(recoverLeadParagraph("<p>Other</p>", doc, "Too short").recovered, false);
  assert.equal(recoverLeadParagraph("<p>Other</p>", doc, "A description that appears nowhere in this page at all, long enough.").recovered, false);
});

test("tables never come out as raw HTML", () => {
  const { markdown } = run("regression/complex-tables.html");
  assert.doesNotMatch(markdown, /<\/?(table|tr|td|th|tbody|div)\b|joplin-table-wrapper|data-mw/i);
  assert.match(markdown, /^\| Markdown \|/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| Filename extensions \| `\.md`, `\.markdown`/m);
  assert.match(markdown, /^\| Type of format \| .*Markup language.*Plain text.* \|$/m);
  assert.match(markdown, /^\| Syntax note \| Use a \\| b for alternatives \|$/m);
  assert.match(markdown, /^\| Example \| `# Heading \*emphasis\*` \|$/m);
  // A layout table (one containing a table) becomes blocks, not a grid.
  assert.match(markdown, /Side text in a layout table\./);
  assert.match(markdown, /John Gruber/);
});

test("the headline is the page's H1 without its permalink sign", () => {
  const { markdown, metadata } = run("regression/title-suffix.html");
  assert.equal(metadata.headline, "widgets — Widget toolkit");
  assert.match(markdown, /^# widgets — Widget toolkit\n/);
  assert.doesNotMatch(markdown.split("\n")[0], /documentation|¶/);
});

test("headline falls back to the title without a site segment at either end", async () => {
  const { chooseHeadline } = await import("../src/refine.js");
  const empty = parseHTML("<!doctype html><html><body><p>x</p></body></html>").document;
  assert.equal(chooseHeadline(empty, { documentTitle: "Release notes | Example Blog", siteName: "Example Blog" }), "Release notes");
  assert.equal(chooseHeadline(empty, { documentTitle: "GitHub - owner/repo: A tool", title: "GitHub - owner/repo: A tool", siteName: "GitHub" }), "owner/repo: A tool");
  const logo = parseHTML("<!doctype html><html><body><h1>Example Blog</h1></body></html>").document;
  assert.equal(chooseHeadline(logo, { documentTitle: "Post title - Example Blog", siteName: "Example Blog" }), "Post title");
});

test("strikethrough and task-list checkboxes use GFM syntax", async () => {
  const { htmlToMarkdown } = await import("../src/convert.js");
  const markdown = htmlToMarkdown("<p><del>old</del> and <s>gone</s></p><ul><li><input type=\"checkbox\" checked> done</li><li><input type=\"checkbox\"> todo</li></ul>");
  assert.match(markdown, /~~old~~ and ~~gone~~/);
  assert.match(markdown, /^-\s+\[x\]\s+done$/m);
  assert.match(markdown, /^-\s+\[ \]\s+todo$/m);
});

test("pageFacts keeps sidebar facts the article dropped, and nothing else", () => {
  const plain = run("regression/package-sidebar.html");
  assert.equal(plain.extraction.method, "readability");
  assert.doesNotMatch(plain.markdown, /4\.2\.0|Page facts/);

  const { markdown, extraction } = run("regression/package-sidebar.html", { pageFacts: true });
  const facts = markdown.slice(markdown.indexOf("## Page facts"));
  assert.match(markdown, /^## Page facts$/m);
  for (const line of ["- Version: 4.2.0", "- Weekly Downloads: 527,786", "- Unpacked Size: 38.4 MB", "- Last publish: 3 days ago", "- Total Files: 4,812"]) {
    assert.ok(facts.includes(line), line);
  }
  // Already in the article (ISC), navigation lists, page chrome.
  assert.doesNotMatch(facts, /License|Collaborators|Support|Company|Package Sidebar/);
  assert.equal(extraction.pageFacts, facts.split("\n").filter((l) => l.startsWith("- ")).length);
  // Articles without asides are unchanged.
  for (const file of ["contract/article-chrome.html", "source-capture/article.html", "regression/lead-section.html"]) {
    assert.equal(run(file, { pageFacts: true }).markdown, run(file).markdown, file);
  }
});

test("a '# comment' in fenced code does not suppress the title heading", () => {
  const { markdown } = run("regression/code-comment-title.html");
  assert.match(markdown, /^# Install Guide\n/);
  assert.equal(fencedBlock(markdown, "bash"), "# Install dependencies\nnpm install");
});

test("every pipe in a table cell is escaped, so rows keep their width", () => {
  const { markdown } = run("regression/table-pipes.html");
  const rows = markdown.split("\n").filter((line) => line.startsWith("|"));
  for (const row of rows) assert.equal(row.split(/(?<!\\)\|/).length - 2, 2, row);
  assert.ok(rows.includes("| `a \\|\\| b` | logical or |"));
  assert.ok(rows.includes("| `a \\| b` | bitwise or |"));
});

test("a heading wrapper holding an image keeps the image", () => {
  const { markdown, stats } = run("regression/heading-with-image.html");
  assert.match(markdown, /^## Diagram$/m);
  assert.match(markdown, /!\[Pipeline diagram\]\(https:\/\/example\.com\/img\/diagram\.png\)/);
  assert.equal(stats.standardization.headingsUnwrapped, 1);
});

test("no_links keeps linked images pointing at the image", () => {
  const { markdown } = run("regression/linked-images.html", { mode: "no_links" });
  assert.match(markdown, /^!\[First photo\]\(https:\/\/example\.com\/img\/1\.jpg\) opens the full size\.$/m);
  assert.match(markdown, /^See !\[second\]\(https:\/\/example\.com\/img\/2\.jpg\) here for more\.$/m);
  assert.match(markdown, /^A plain about link keeps its text\.$/m);
  assert.doesNotMatch(markdown, /\/photos\/|\/about/);
});
