# page-markdown

Faithful page-to-Markdown for humans and agents. Give it a web page's DOM and
it returns clean Markdown plus metadata. It is written for browsers, for
example an extension's content script, and runs in Node with a DOM library.
It is tested in Node and in headless Chrome and Edge, but not yet in Firefox or
Safari (see [Known limits](#known-limits-v01)). It was built for WATT3D's
browser extensions.

```
live Document
  → sanitize      inert clone; open shadow DOM inlined within limits; scripts, styles, ads removed
  → standardize   <pre> → fenced code with language; heading wrappers unwrapped; empty and
                  javascript: links removed; absolute links and images; lazy images resolved
  → extract       Mozilla Readability on a copy; full-page fallback when it finds too little;
                  a dropped lead paragraph restored; a clean title heading
  → convert       Turndown + GitHub-flavoured tables, strikethrough and task lists; tables never
                  come out as raw HTML
  → clean         fence-safe; keeps short lines and <br> hard breaks; never cuts text
  → hidden text   opt-in (removeHiddenText): tag-character text, variation-selector runs and
                  invisible operators removed, fenced code included; counted in omissions
  → { markdown, metadata, extraction, omissions, warnings, stats }
```

The live page is only read, never modified.

## Install

```sh
npm install page-markdown
```

## Usage

```js
import { pageToMarkdown } from "page-markdown";

// In a browser (e.g. an extension content script)
const result = pageToMarkdown(document);
result.markdown;            // "# Title\n\n…"
result.metadata;            // { url, canonicalUrl, title, author, published, siteName, lang, … }
result.extraction.method;   // "readability" | "full_page"

// In Node, with any DOM implementation (linkedom shown)
import { parseHTML } from "linkedom";
const { document: doc } = parseHTML(html);
pageToMarkdown(doc, { url: "https://example.com/article" });
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `url` | the document's URL | Base for absolute links and images |
| `extract` | `"readable"` | `"readable"` (Readability, full-page fallback), `"full"`, or a function `(docCopy) => { html, method }` |
| `minExtractChars` | `100` | Below this, readable extraction falls back to the full page |
| `includeFullPage` | `false` | Also return `fullPageMarkdown` |
| `includeTitle` | `true` | Start readable output with `# <headline>`: the page's H1, else its title without the site name |
| `recoverLead` | `true` | Restore a lead paragraph the extractor dropped, when it matches the meta description |
| `pageFacts` | `false` | Append `## Page facts`: short label/value pairs outside the article (a sidebar's version or license, spec rows, infobox rows) that the extractor dropped. `extraction.pageFacts` counts them |
| `removeHiddenText` | `false` | Remove text hidden from people but read by models: runs of tag characters, variation selectors, invisible operators and reserved tag-plane code points, found by [text-sanctifier](https://github.com/iWhatty/text-sanctifier)'s `findHiddenRuns`. Applies to `markdown` (fenced code included), `fullPageMarkdown` and `metadata`. The England, Scotland and Wales flags and a lone emoji or text presentation selector are kept. `omissions` gets one entry per kind (`hidden_tag`, `hidden_variation_selector`, `hidden_invisible_operator`, `hidden_reserved_tag_plane`) with `count` runs and `chars` code points removed from `markdown` |
| `mode` | `"full"` | `"no_links"` keeps link text; `"text_only"` also drops structure. Fenced code is never changed |
| `sanitize` | see `DEFAULT_SANITIZE_OPTIONS` | `stripAds`, `extraStripSelectors` (e.g. `["[data-app-overlay]"]`), shadow limits |
| `readability` | `{}` | Passed to Readability |

The stages are also exported for advanced use: `sanitizeToInertDocument`,
`standardizeDocument`, `extractContent`, `htmlToMarkdown`, `cleanMarkdown`,
`applyMode`, `collectMetadata`, `collectPageFacts` and `removeHiddenText`.

### Result

`pageToMarkdown` returns:

| Field | Type | Meaning |
|---|---|---|
| `version` | `string` | The package version that made this result |
| `markdown` | `string` | The Markdown |
| `fullPageMarkdown` | `string?` | The whole page as Markdown. Present only with `includeFullPage` |
| `metadata.url`, `canonicalUrl` | `string` | The page URL; the canonical link, else the page URL |
| `metadata.documentTitle`, `title` | `string` | The `<title>`; og:title or twitter:title, else the JSON-LD headline, else the `<title>` |
| `metadata.description`, `author`, `published`, `modified`, `siteName`, `lang` | `string` | From meta tags and JSON-LD, `""` when the page doesn't state them. `siteName` falls back to the hostname |
| `metadata.headline` | `string?` | The heading chosen for the capture |
| `metadata.extractedTitle`, `byline` | `string?` | What the extractor reported |
| `extraction.method` | `string` | `"readability"`, `"full_page"`, or the name a custom extractor gave |
| `extraction.fallbackReason` | `string?` | Why extraction fell back to the full page: `extractor_found_nothing`, `extracted_text_below_minimum` or `extractor_error: …` |
| `extraction.leadRecovered` | `true?` | A dropped lead paragraph was restored |
| `extraction.pageFacts` | `number?` | How many facts `pageFacts` appended |
| `omissions[]` | `{ kind, count, note, chars? }` | What was left out or removed. `kind` is `shadow_content`, `json_line` or a `hidden_*` kind; only `hidden_*` entries have `chars` |
| `warnings[]` | `string` | Currently the full-page fallback, in words |
| `stats.mode` | `string` | The output mode used |
| `stats.extractedHtmlChars`, `convertedChars`, `markdownChars` | `number` | Sizes at each step. `markdownChars` is measured before `removeHiddenText` and the shadow omission notice |
| `stats.standardization` | `object` | Counts of what standardizing changed: `lazyImagesResolved`, `inlineImagesDropped`, `scriptLinksUnwrapped`, `emptyLinksRemoved`, `preWrapped`, `headingWidgetsRemoved`, `headingsUnwrapped` |

A `?` marks a field that is absent, not empty, when it doesn't apply.

### TypeScript

Types ship with the package, generated from the JSDoc in `src`: `pageToMarkdown`,
the stages, and `PageMarkdownOptions`, `PageMarkdownResult` and the types they use.
They bring in TypeScript's `dom` lib, so a Node project needs no `lib` change.

### Recipes

```js
// Keep both views: the readable article and the whole page.
const { markdown, fullPageMarkdown } = pageToMarkdown(document, { includeFullPage: true });

// For agents answering questions: keep facts from asides (version, price, specs).
pageToMarkdown(document, { pageFacts: true });

// Drop your own UI before capture.
pageToMarkdown(document, { sanitize: { extraStripSelectors: ["#my-extension-panel"] } });

// Plain text for prompts; code blocks stay intact.
pageToMarkdown(document, { mode: "text_only" });

// Markdown bound for a model: drop hidden instructions, and see what was dropped.
const { markdown: safe, omissions } = pageToMarkdown(document, { removeHiddenText: true });
```

## Quality

`npm test` runs the contract suite. It covers:
- golden outputs for 33 fixtures;
- regressions for known converter bugs, including dropped lead paragraphs,
  raw HTML tables, flattened code in tables, site-suffixed titles and
  unescaped table pipes;
- modes, metadata, JSON-LD and the full-page fallback;
- the shadow DOM limits and their omission notice;
- leaving the live page unmodified.

`npm run typecheck` checks `src` against its JSDoc with `tsc` and generates the
declarations in `dist/types`. It then checks those from a consumer's side
(`test/types/consumer.ts`) and against real output: it runs the pipeline over the
fixtures and fails when a result or the export list no longer matches the
declarations, in either direction.

`npm run test:browser` runs the same golden fixtures in headless Chrome (or
Edge), parsed by the browser's own DOM, with no extra dependencies. It also
checks what Node can't show:
- a live document with layout is left unmodified;
- real open shadow roots are captured, including nested roots and slotted
  children in rendered order;
- closed shadow roots stay out of the capture.

Set `PAGE_MARKDOWN_BROWSER` to choose the browser. The built page is kept at
`.browser-test/index.html` for opening by hand.

`npm run bench` scores the package against two baselines: Turndown over the page
body, and Readability then Turndown. It runs 15 fixture checks and 117 probes on
16 real pages, which `node bench/fetch-pages.mjs` fetches first, and measures word
recall against a hand-picked reference for each page. See
[bench/RESULTS.md](bench/RESULTS.md). Currently:

| Tier | page-markdown | Readability + Turndown | Turndown only |
|---|---|---|---|
| Fixtures, written with the package | 15/15 | 7/15 | 3/15 |
| Five pages the fixes were tuned on | 17/17 | 9/17 | 8/17 |
| **11 held-out pages** | **75/100** | **74/100** | **61/100** |
| Held-out word recall / precision | 77.2% / 86.6% | 85.4% / 95.6% | 98.2% / 72.1% |

The held-out row is the one to weigh. On those pages the package roughly ties
plain Readability + Turndown, and one empty output (the first failure below) puts
it behind on recall. What it fails there:

- **Empty output** when `<body>` itself carries an ad marker: `data-ad-unit` on
  heise.de makes the ad filter remove the whole body.
- **Code loses its line breaks** when a highlighter puts each line in a block
  element (Docusaurus, Starlight).
- **Most H2s dropped** on Docusaurus and Starlight, by Readability; Starlight also
  keeps "Section titled" anchor text.
- **Non-default tab panels dropped** (Starlight).
- **Comments and product grids lost**, by Readability: 36% word recall on a
  Lobsters thread, 50% on an IKEA category page.
- **Promo boxes kept** inside a BBC Arabic article.

Browser bundle: about 67 KB minified, 24 KB gzip (`npm run size`, ceiling 68 KB
minified). Readability is most of it.

`npm run ci` runs the contract suite, the type check, the browser run and the size check, and must exit 0
before a commit. It runs locally; the repo deliberately has no cloud CI.

## Known limits (v0.1)

- **Chromium only so far.** Tested in Node (linkedom) and in headless Chrome
  and Edge, but not in Firefox or Safari, and not yet inside a real extension's
  content script.
- **Some legacy markup loses paragraph breaks.** Readability can drop runs of
  `<br>` between inline elements in old HTML. The text survives; a paragraph
  break may not.
- **Hidden content stays.** The pipeline reads the static DOM, so elements
  hidden only by CSS remain unless extraction drops them.
- **`removeHiddenText` covers hidden runs only.** Zero-width spaces, bidi
  controls and look-alike spaces pass through. It also removes runs that are
  legitimate in some scripts: ideographic variation selectors in CJK names and
  the Mongolian free variation selectors.
- **Iframes and closed shadow roots are not captured.**
- **Text that spells out HTML stays literal.** `&lt;img onerror=…&gt;` in page
  text comes out as `<img onerror=…>`. Sanitize the Markdown before rendering it
  as HTML.

## Licence

page-markdown is under the WATT3D Source License: AGPL-3.0 with the Additional
Terms in [ADDITIONAL_TERMS.md](ADDITIONAL_TERMS.md) (see [LICENSE](LICENSE)).
[robots.txt](robots.txt) states the AI-crawler policy.

It bundles text-sanctifier's run finder (same licence) and Mozilla Readability
(Apache-2.0) and Turndown (MIT), whose licences are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Those notices must accompany
any distribution.
