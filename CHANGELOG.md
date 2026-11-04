# Changelog

## Unreleased

- **TypeScript types.** Declarations for `pageToMarkdown`, its options, the full
  result and every stage export are generated from the JSDoc in `src` into
  `dist/types`, through a `types` condition in `exports`. The result is
  documented in a README table. `npm run typecheck` is part of `npm run ci`: it
  checks `src` against its JSDoc, checks a consumer file with `tsc`, and checks
  the declarations against real output from every fixture, in both directions.
  Only comments change in the existing modules; the bundle is the same size.
- **Browser run.** `npm run test:browser` runs the 26 golden fixtures in
  headless Chrome or Edge, with the browser's own DOM, and checks what Node
  can't show:
  - the live document is left unmodified;
  - real open shadow roots are captured, nested roots and slotted children
    included;
  - closed shadow roots stay out.

  It is part of `npm run ci` and needs no new dependencies. All 31 checks pass
  in Chrome 156 and Edge 156 with no code changes, so the package's output in
  a browser matches its Node output.

## 0.1.4 — 2026-11-02

- **text-sanctifier 1.3.8** (was 1.3.3). `removeHiddenText` now also removes
  runs of reserved tag-plane code points (U+E0080–U+E00FF, U+E01F0–U+E0FFF),
  which 1.3.3 did not find, and reports them as `hidden_reserved_tag_plane`.
  The browser bundle grows to about 65.6 KB minified.
- A test checks that every run kind text-sanctifier can report has an
  omission note, so a new kind fails `npm run ci` instead of reaching users
  with no note.
- A test fails when any source, test, fixture or doc file holds a raw
  invisible or control character. A test regex in 0.1.3 held four, written
  by an editing tool that expanded `\u` escapes; they never shipped, since
  tests are not in the package.

## 0.1.3 — 2026-10-30

First release on npm. `npm run ci` (contract suite and size check) is the
local gate before a commit; there is no cloud CI. The size ceiling is 66 KB
minified.

Content-fidelity fixes:

- **Title heading kept beside shell comments.** A `# comment` line in fenced
  code no longer counts as the article's top-level heading, which had
  suppressed the `# <headline>` line.
- **Every pipe in a table cell is escaped.** `a || b` escaped only its first
  pipe, which added a column and broke the table.
- **Images beside a heading survive.** A heading wrapper that also holds an
  image (or picture, video, audio) is no longer unwrapped to the bare heading.
- **`no_links` keeps linked images intact.** `[![alt](img)](href)` became
  `![alt](href)`, an image pointing at the link target; the image is now kept
  as it was.
- **Code in tables stays fenced.** A GFM cell is one line, so a data table
  holding `<pre>` code (Wikipedia's syntax examples) was flattened to inline
  code, losing its line breaks and indentation. Such a table is now rendered
  as blocks: each cell under a bold label from its column header (or its row
  header, for infoboxes), with code as verbatim fences. Tables without code
  are still GFM grids.
- Code language from MediaWiki's `mw-highlight-lang-*` class.
- At most one blank line beside a fenced block.
- Five new regression fixtures, one per fix.

Hidden text (opt-in):

- **`removeHiddenText: true`** removes runs of tag characters, variation
  selectors and invisible operators, which people can't see but models read
  (hidden prompt instructions). It applies to the Markdown, fenced code
  included, and to `fullPageMarkdown` and `metadata`. The England, Scotland
  and Wales flags and a lone emoji or text presentation selector are kept.
  `omissions` gets `hidden_tag`, `hidden_variation_selector` and
  `hidden_invisible_operator` entries with `count` (runs) and `chars` (code
  points). `removeHiddenText` is exported. Default output is unchanged.
- New runtime dependency: text-sanctifier 1.3.3 (first-party, no
  dependencies), for its `text-sanctifier/hidden` run finder. About 1.5 KB
  minified in the browser bundle.
- New contract fixture `hidden-text.html`, written with character references
  so it holds no raw hidden characters.

## 0.1.2 — 2026-10-23

- **Page facts (opt-in).** `pageFacts: true` appends a `## Page facts` list
  of short label/value pairs that sit outside the extracted article: a
  package sidebar's version, license and downloads, spec and price rows,
  infobox rows. Readability drops these asides, which suits reading but
  loses the answer to "which version?". Pairs come from a heading followed by
  a short value, `<dt>`/`<dd>`, and two-cell table rows. Values already in
  the article, sentences, link lists, lone non-data links and anything in
  navigation, header, footer or forms are skipped. `extraction.pageFacts`
  counts them; `collectPageFacts` is exported. Default output is unchanged.
- New regression fixture: a package page whose version lives only in the
  sidebar.

## 0.1.1 — 2026-10-22

Fixes from the first in-browser comparison (MDN, Wikipedia, the Python docs,
GitHub):

- **Tables never come out as raw HTML.** Own GFM table rules replace the
  plugin's:
  - a header row is used even when the table has none;
  - colspans are padded with empty cells;
  - cell content is flattened to one line (code, lists, line breaks);
  - pipes are escaped;
  - layout and nested tables are rendered as blocks.
- **Dropped lead paragraph restored.** When the extractor leaves out a
  paragraph that matches the meta description (MDN's heading-less first
  section), it is put back first. `extraction.leadRecovered` reports it, and
  `recoverLead: false` turns it off.
- **Clean title heading.** The page's own H1 (permalink sign removed) when
  the title contains it, else `og:title` or the title, without a site-name
  segment at either end. It is exposed as `metadata.headline`.
- **Smaller bundle.** Strikethrough and task-list rules are now built in, and
  `@joplin/turndown-plugin-gfm` is no longer a dependency. The browser bundle
  is 60.2 KB minified, down from 61.7 KB.

## 0.1.0 — 2026-10-22

First release.

- `pageToMarkdown(document, options)`: sanitize → standardize → extract →
  convert → clean, returning Markdown, metadata, extraction details,
  omissions, warnings and stats.
- **Sanitize.** Builds an inert clone and inlines open shadow DOM within node,
  character and depth limits, with an omission notice past them. Removes
  scripts, styles, `noscript`, meta and link tags, and ads, plus any
  `extraStripSelectors`.
- **Standardize.**
  - Turns `<pre>` into fenced code, with the language from
    `language-`/`lang-`/`highlight-` classes or `data-lang`.
  - Unwraps heading wrappers and removes edit and permalink widgets.
  - Removes empty and `javascript:` links.
  - Makes links and images absolute and resolves lazy images; drops inline
    `data:` images.
- **Extract.** Mozilla Readability on a copy of the clone, falling back to the
  full page when it finds nothing or too little. Optionally restores the title
  heading.
- **Convert.** Turndown with GitHub-flavoured tables and strikethrough.
- **Clean.** Fence-safe. Keeps short lines and `<br>` hard breaks, removes only
  verified single-line JSON documents, and offers `full`, `no_links` and
  `text_only` modes.
- **Metadata.** Meta tags, JSON-LD (`@graph` included), canonical URL and
  language.
