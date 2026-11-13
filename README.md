# page-markdown

Faithful page-to-Markdown for humans and agents. Give it a web page's DOM and
it returns clean Markdown plus metadata. It is written for browsers, for
example an extension's content script, and runs in Node with a DOM library.
It is tested in Node, in headless Chrome and Edge, and in a real extension
(HELIOS, in Brave), but not yet in Firefox or Safari (see
[Known limits](#known-limits-v02)). It was built for WATT3D's
browser extensions.

```
live Document
  → sanitize      inert clone; open shadow DOM inlined within limits; scripts, styles, ads removed
  → standardize   <pre> → fenced code with language; heading wrappers unwrapped; empty and
                  javascript: links removed; absolute links and images; lazy images resolved
  → extract       Mozilla Readability on a copy; full-page fallback when it finds too little;
                  main-content fallback when it keeps only a small share of the page;
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

Free for personal, non-commercial academic and fully open-source use. Other
commercial use needs a licence: see [Licence](#licence).

## Usage

```js
import { pageToMarkdown } from "page-markdown";

// In a browser (e.g. an extension content script)
const result = pageToMarkdown(document);
result.markdown;            // "# Title\n\n…"
result.metadata;            // { url, canonicalUrl, title, author, published, siteName, lang, … }
result.extraction.method;   // "readability" | "main_content" | "full_page" | custom method

// In Node, with any DOM implementation (linkedom shown)
import { parseHTML } from "linkedom";
const { document: doc } = parseHTML(html);
pageToMarkdown(doc, { url: "https://example.com/article" });
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `url` | the document's URL | Base for absolute links and images |
| `extract` | `"readable"` | `"readable"` (Readability with main-content or full-page fallback), `"full"`, or a function `(docCopy) => { html, method }` |
| `minExtractChars` | `100` | Below this, Readability falls back to a sufficiently long `<main>` or `[role="main"]`, else the full page; custom extractors fall back to the full page |
| `minExtractShare` | `0.4` | When Readability keeps less than this share of the page's main content (and misses at least 500 characters), the main content is used instead: forum threads and product grids. `0` turns it off |
| `includeFullPage` | `false` | Also return `fullPageMarkdown` |
| `includeTitle` | `true` | Add `# <headline>` to Readability or main-content output when no H1 remains; skipped in `text_only` mode |
| `recoverLead` | `true` | Restore a lead paragraph the extractor dropped, when it matches the meta description |
| `pageFacts` | `false` | Append `## Page facts`: short label/value pairs outside the article (a sidebar's version or license, spec rows, infobox rows) that the extractor dropped. `extraction.pageFacts` counts them |
| `removeHiddenText` | `false` | Remove text hidden from people but read by models: runs of tag characters, variation selectors, invisible operators and reserved tag-plane code points, found by [text-sanctifier](https://github.com/iWhatty/text-sanctifier)'s `findHiddenRuns`. Applies to `markdown` (fenced code included), `fullPageMarkdown` and `metadata`. The England, Scotland and Wales flags and a lone emoji or text presentation selector are kept. `omissions` gets one entry per kind (`hidden_tag`, `hidden_variation_selector`, `hidden_invisible_operator`, `hidden_reserved_tag_plane`) with `count` runs and `chars` code points removed from `markdown` |
| `mode` | `"full"` | `"no_links"` keeps link text; `"text_only"` also drops structure. Fenced code is never changed |
| `sanitize` | see `DEFAULT_SANITIZE_OPTIONS` | `stripAds`, `extraStripSelectors` (e.g. `["[data-app-overlay]"]`), shadow limits, which apply per host in the page's own tree and don't charge slotted page content |
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
| `extraction.method` | `string` | `"readability"`, `"main_content"`, `"full_page"`, or the name a custom extractor gave |
| `extraction.fallbackReason` | `string?` | Why extraction fell back: `extracted_small_share_of_page`, `extracted_site_menu` or `extracted_few_sections_of_page` use the main content; `extractor_found_nothing`, `extracted_text_below_minimum` or `extractor_error: ...` use a sufficiently long main-content region for Readability, else the full page. Custom extractors fall back to the full page |
| `extraction.leadRecovered` | `true?` | A dropped lead paragraph was restored |
| `extraction.pageFacts` | `number?` | How many facts `pageFacts` appended |
| `omissions[]` | `{ kind, count, note, chars? }` | What was left out or removed. `kind` is `shadow_content`, `json_line`, `inactive_tabs`, `comments` or a `hidden_*` kind; only `hidden_*` entries have `chars`. All but `hidden_*` also add a closing line to `markdown`, as a fallback does, so a caller that passes on only the Markdown still says so |
| `warnings[]` | `string` | Read these before trusting a capture: a fallback, or shadow content cut off at the capture limit, in which case the main content may be missing |
| `stats.mode` | `string` | The output mode used |
| `stats.extractedHtmlChars`, `convertedChars`, `markdownChars` | `number` | Sizes at each step. `markdownChars` is the returned Markdown's length |
| `stats.pageTextChars` | `number` | Whitespace-normalized text length of the standardized page at capture time |
| `stats.standardization` | `object` | Counts of what standardizing changed: `lazyImagesResolved`, `inlineImagesDropped`, `scriptLinksUnwrapped`, `invalidLinksUnwrapped`, `emptyLinksRemoved`, `preWrapped`, `headingWidgetsRemoved`, `headingsUnwrapped`; `omittedTabs` lists labels of inactive panels left out |

A `?` marks a field that is absent, not empty, when it doesn't apply.

### Concealed text (opt-in)

Detection is off by default. Enable it for a live document:

```js
const result = pageToMarkdown(document, {
  detectConcealedText: true,
  includeFullPage: true,
});
```

Supported computed styles separate concealed DOM text from the article and
return it in `concealedText` as `{ reason, chars, text }` blocks. Text is capped
at 2,048 UTF-16 units per block, 16,384 total and 100 entries;
`concealedTextTruncated` reports capping. Omission counts and character totals
are uncapped. A `Concealed text omitted:` notice appears in both `markdown`
and `fullPageMarkdown` when text is captured.

The seven reasons are `display_none`, `visibility_hidden`, `opacity_zero`,
`font_size_zero`, `clipped`, `transparent_text` and `same_color`. Supported
clips are zero-area legacy rectangles on absolute/fixed elements,
`inset(50%)` and zero-radius circles. Colour checks compare computed sRGB
rgb()/rgba() values for an element's own text against its own or nearest
declared opaque background.

`concealmentCheck` is `disabled` by default (no computed-style calls),
`static-only` when enabled without a computed-style API, `computed` after a
successful check, or `incomplete` if the capability probe or a consulted
property fails. Detection applies to live documents only; enabled static
input retains its previous output. A top-level `detectConcealedText` option
takes precedence over `sanitize.detectConcealedText`, then the default false.

Limits include white text with no declared opaque background, non-zero alpha,
near-colour matches, and unparsed OKLCH and Display P3 colours. Intervening
images or translucent backgrounds and uncertain text painting effects prevent
colour equality detection. Existing short inactive tab, collapsed answer and
code wrapper exceptions remain; independent concealment reasons still apply.
Off-screen or covered text, attributes, metadata and custom-extractor output
are outside this check.

The scroll-reveal rule is **provisional**: zero-opacity content with an
opacity-applicable transition or named animation of nonzero duration stays
in place with a warning. A declaration does not prove it will appear, and a
page can use one to evade detection. Real-site validation is still required.
Chrome is the only browser tested; Firefox and Safari are untested.

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
- golden outputs for 51 fixtures;
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

It launches a browser, so it runs only when a person sets
`PAGE_MARKDOWN_ALLOW_BROWSER_LAUNCH=1` in their own shell; agents must not set it.
Without the flag it builds `.browser-test/index.html`, which you can open in a
browser that is already running, and exits with an error. Set
`PAGE_MARKDOWN_BROWSER` to choose the browser.

`npm run bench` scores the package against two baselines: Turndown over the page
body, and Readability then Turndown. It runs 15 fixture checks and 117 probes on
16 real pages, which `node bench/fetch-pages.mjs` fetches first, and measures word
recall against a hand-picked reference for each page. `npm run bench` only prints;
`npm run bench:write` also updates [bench/RESULTS.md](bench/RESULTS.md). Currently:

| Tier | page-markdown | Readability + Turndown | Turndown only |
|---|---|---|---|
| Fixtures, written with the package | 15/15 | 7/15 | 3/15 |
| Five pages the fixes were tuned on | 17/17 | 9/17 | 8/17 |
| **11 pages, once held out** | **98/100** | **74/100** | **61/100** |
| Their word recall / precision | 97.6% / 89.1% | 85.4% / 95.6% | 98.2% / 72.1% |

Don't read 98 as a score on unseen pages. These probes were written before any
engine ran and the package first scored 75/100, but most of the gain since comes
from fixes for these same pages' failures. New pages are the real test.

It gains recall (97.6% against 85.4%) by keeping more, and pays in precision
(89.1% against 95.6%). The cost is mostly on the IKEA category page: 29.7% precision,
because the main-content fallback keeps the page's banners and filters along with
its products. What it still fails on these pages:

- **Promo boxes kept** inside a BBC Arabic article.

Browser bundle: about 86.0 KB minified, 31.2 KB gzip (`npm run size`, ceiling 86 KB
minified). Readability is most of it.

`npm run ci` runs the contract suite, the type check and the size check, and must
exit 0 before a commit. It launches no browser, so run the browser check yourself
before a release when the DOM handling has changed. It runs locally; the repo
deliberately has no cloud CI.

## Known limits (v0.2)

- **Chromium only so far.** Tested in Node (linkedom), in headless Chrome and
  Edge, and on live pages in a real extension (HELIOS, in Brave), but not
  in Firefox or Safari.
- **Extraction can still be wrong without saying so.** The main-content fallback
  and its warning catch a small share of the page, a kept site menu and lost
  sections, not every wrong choice. If Readability picks the wrong part of a page
  and that part is large, nothing flags it. No closing line doesn't mean nothing
  was lost. A short post among long replies can be dropped: a Mastodon status lost
  the post itself, and its cause isn't known yet.
- **Answers hidden on an ordinary article can be lost.** Collapsed FAQ answers are
  kept by the main-content fallback only; Readability removes hidden text.
- **Bylines and dates can be missing from the Markdown.** Readability often leaves
  them out of the article. Look in `metadata.author` and `metadata.published`.
- **Some legacy markup loses paragraph breaks.** Readability can drop runs of
  `<br>` between inline elements in old HTML. The text survives; a paragraph
  break may not.
- **A capture is a snapshot.** It reads the DOM as it is at call time, and it
  can't tell whether the page has finished rendering. A page read too early looks
  like a normal, short result. To wait, re-capture until `stats.pageTextChars`
  settles.
- **Captures hold whatever is in the DOM,** including text that other extensions
  add. Use `sanitize.extraStripSelectors` for what you know about.
- **Hidden content stays where only CSS hides it.** The pipeline reads the static
  DOM. The `hidden` attribute and inline `display: none` are understood; a tab
  panel hidden by a stylesheet alone is kept unless its group names the selected
  one. Tabs marked with neither `role` nor `aria-role` and hidden with
  `class="hidden"` can be lost, with no closing line.
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

In short (the licence files govern, and this is not legal advice):

| Use | Terms |
|---|---|
| Personal, non-commercial | Free |
| Non-commercial academic research | Free |
| Commercial use, including inside a for-profit company | Only if everything you own or operate is open source under a licence at least as protective as AGPL-3.0; otherwise you need a commercial licence |
| AI training, fine-tuning or a RAG corpus built from this software | Counts as commercial use, and the resulting model must be released with open weights |

AGPL-3.0 applies throughout, including its source-sharing duties for networked
services. For a commercial licence, write to
[WATT3D@protonmail.com](mailto:WATT3D@protonmail.com).

It bundles text-sanctifier's run finder (same licence) and Mozilla Readability
(Apache-2.0) and Turndown (MIT), whose licences are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Those notices must accompany
any distribution.
