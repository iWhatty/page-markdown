# page-markdown

Faithful page-to-Markdown for humans and agents. Give it a web page's DOM and
it returns clean Markdown plus metadata. It works in any browser (Chromium,
Firefox, Safari), for example from an extension's content script, or in Node
with a DOM library. It was built for WATT3D's browser extensions.

```
live Document
  → sanitize      inert clone; open shadow DOM inlined within limits; scripts, styles, ads removed
  → standardize   <pre> → fenced code with language; heading wrappers unwrapped; empty and
                  javascript: links removed; absolute links and images; lazy images resolved
  → extract       Mozilla Readability on a copy; full-page fallback when it finds too little;
                  a dropped lead paragraph restored; a clean title heading
  → convert       Turndown + GitHub-flavoured tables, strikethrough and task lists; never raw HTML
  → clean         fence-safe; keeps short lines and <br> hard breaks; never cuts text
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
| `mode` | `"full"` | `"no_links"` keeps link text; `"text_only"` also drops structure. Fenced code is never changed |
| `sanitize` | see `DEFAULT_SANITIZE_OPTIONS` | `stripAds`, `extraStripSelectors` (e.g. `["[data-app-overlay]"]`), shadow limits |
| `readability` | `{}` | Passed to Readability |

The stages are also exported for advanced use: `sanitizeToInertDocument`,
`standardizeDocument`, `extractContent`, `htmlToMarkdown`, `cleanMarkdown`,
`applyMode`, `collectMetadata` and `collectPageFacts`.

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
```

## Quality

`npm test` runs the contract suite. It covers:
- golden outputs for 20 fixtures;
- regressions for known converter bugs, including dropped lead paragraphs,
  raw HTML tables and site-suffixed titles;
- modes, metadata, JSON-LD and the full-page fallback;
- the shadow DOM limits and their omission notice;
- leaving the live page unmodified.

`npm run bench` scores the package against a naive baseline (Turndown over the
page body). It runs 15 fixture checks and 17 probes on five real pages, which
`node bench/fetch-pages.mjs` fetches first. See
[bench/RESULTS.md](bench/RESULTS.md): currently **32/32 against 11/32**.

Browser bundle: about 60 KB minified, 21 KB gzip (`npm run size`). Readability
is most of it.

## Known limits (v0.1)

- **Node only so far.** Tested in Node with linkedom, not yet in a browser. The
  open shadow DOM path is exercised only with a stand-in host in tests.
- **Some legacy markup loses paragraph breaks.** Readability can drop runs of
  `<br>` between inline elements in old HTML. The text survives; a paragraph
  break may not.
- **Hidden content stays.** The pipeline reads the static DOM, so elements
  hidden only by CSS remain unless extraction drops them.
- **Iframes and closed shadow roots are not captured.**

## Licence

page-markdown is under the WATT3D Source License: AGPL-3.0 with the Additional
Terms in [ADDITIONAL_TERMS.md](ADDITIONAL_TERMS.md) (see [LICENSE](LICENSE)).
[robots.txt](robots.txt) states the AI-crawler policy.

It bundles Mozilla Readability (Apache-2.0) and Turndown (MIT), whose licences
are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Those notices must accompany
any distribution.
