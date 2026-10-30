# page-markdown

Faithful page-to-Markdown for humans and agents. Give it a web page's DOM and
it returns clean Markdown plus metadata. It is written for browsers, for
example an extension's content script, and runs in Node with a DOM library.
So far it is tested only in Node (see [Known limits](#known-limits-v01)). It
was built for WATT3D's browser extensions.

```
live Document
  → sanitize      inert clone; open shadow DOM inlined within limits; scripts, styles, ads removed
  → standardize   <pre> → fenced code with language; heading wrappers unwrapped; empty and
                  javascript: links removed; absolute links and images; lazy images resolved
  → extract       Mozilla Readability on a copy; full-page fallback when it finds too little;
                  a dropped lead paragraph restored; a clean title heading
  → convert       Turndown + GitHub-flavoured tables, strikethrough and task lists; never raw HTML
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
| `removeHiddenText` | `false` | Remove text hidden from people but read by models: runs of tag characters, variation selectors and invisible operators, found by [text-sanctifier](https://github.com/iWhatty/text-sanctifier)'s `findHiddenRuns`. Applies to `markdown` (fenced code included), `fullPageMarkdown` and `metadata`. The England, Scotland and Wales flags and a lone emoji or text presentation selector are kept. `omissions` gets one entry per kind (`hidden_tag`, `hidden_variation_selector`, `hidden_invisible_operator`) with `count` runs and `chars` code points removed from `markdown` |
| `mode` | `"full"` | `"no_links"` keeps link text; `"text_only"` also drops structure. Fenced code is never changed |
| `sanitize` | see `DEFAULT_SANITIZE_OPTIONS` | `stripAds`, `extraStripSelectors` (e.g. `["[data-app-overlay]"]`), shadow limits |
| `readability` | `{}` | Passed to Readability |

The stages are also exported for advanced use: `sanitizeToInertDocument`,
`standardizeDocument`, `extractContent`, `htmlToMarkdown`, `cleanMarkdown`,
`applyMode`, `collectMetadata`, `collectPageFacts` and `removeHiddenText`.

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
- golden outputs for 26 fixtures;
- regressions for known converter bugs, including dropped lead paragraphs,
  raw HTML tables, flattened code in tables, site-suffixed titles and
  unescaped table pipes;
- modes, metadata, JSON-LD and the full-page fallback;
- the shadow DOM limits and their omission notice;
- leaving the live page unmodified.

`npm run bench` scores the package against a naive baseline (Turndown over the
page body). It runs 15 fixture checks and 17 probes on five real pages, which
`node bench/fetch-pages.mjs` fetches first. See
[bench/RESULTS.md](bench/RESULTS.md): currently **32/32 against 11/32**.

Browser bundle: about 65 KB minified, 23 KB gzip (`npm run size`, ceiling 66 KB
minified). Readability is most of it.

`npm run ci` runs the contract suite and the size check, and must exit 0
before a commit. It runs locally; the repo deliberately has no cloud CI.

## Known limits (v0.1)

- **Node only so far.** Tested in Node with linkedom, not yet in a browser. The
  open shadow DOM path is exercised only with a stand-in host in tests.
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

## Licence

page-markdown is under the WATT3D Source License: AGPL-3.0 with the Additional
Terms in [ADDITIONAL_TERMS.md](ADDITIONAL_TERMS.md) (see [LICENSE](LICENSE)).
[robots.txt](robots.txt) states the AI-crawler policy.

It bundles text-sanctifier's run finder (same licence) and Mozilla Readability
(Apache-2.0) and Turndown (MIT), whose licences are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Those notices must accompany
any distribution.
