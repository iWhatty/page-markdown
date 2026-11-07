# Changelog

## Unreleased

Fixes for silent content loss, found by the first live run in a real extension
(HELIOS, 13 pages): four pages lost their main content and reported a normal
extraction.

- **Threads and product grids keep their content.** When Readability keeps less
  than `minExtractShare` (default 0.4) of the page's main content and misses at
  least 500 characters, the main content is used, without navigation, asides and
  forms. `extraction.method` is then `main_content`, `fallbackReason` is
  `extracted_small_share_of_page`, and `warnings` says so. Word recall on a Lobsters
  thread goes from 36% to 100%, and on an IKEA category page from 50% to 95%. These
  pages keep more clutter: IKEA's precision falls from 92% to 30%.
- **Layout class names no longer cost a block its place.** Readability's clutter
  list matches "scroll" and "hidden" in Tailwind's `scroll-mt-2`, `overflow-hidden`
  and `md:hidden`, and it removed what carried them: every code block in Docker's
  install guide and the plan cards on Tailscale's pricing page. Reproduced and fixed
  from the served pages, not yet re-run live.
- **Icon-only table cells say something.** A cell holding only an SVG came out
  empty, so a comparison table couldn't say which plan has what. It now shows the
  icon's accessible name, else `✓`, `–` or `✗` for those simple shapes, else
  `[icon]`. On Tailscale, 114 ticks and 25 dashes where there were empty cells.
- **More cases fall back to the main content,** and say so with their own
  `fallbackReason`. `extracted_site_menu`: Readability chose a container above
  `<main>` and kept the site's menu (BBC News). `extracted_few_sections_of_page`:
  it kept under 1.5 times `minExtractShare` of the main content and lost most of the
  page's h2 sections, as on Adafruit's product page, which lost its price, stock and
  technical details. The product page keeps more clutter this way, including its
  "May We Also Suggest" list.
- **The fallback keeps collapsed answers.** Hidden text of 40 characters or more
  straight after a button or summary is kept, so an FAQ isn't lost when a page
  hides its answers with inline styles. Inferred from Allbirds' markup, whose
  framework should hide them that way once it runs; not yet seen live.
- **Shadow limits no longer erase a whole host.** A host over the limit keeps what
  fits, limits apply per host in the page's own tree so a large site header can't
  use up the article's budget, and `warnings` now reports the cut.
- **Slotted page content no longer counts against the shadow limit.** Material Web
  puts its whole article in one host's slot, so the limit cut it off partway
  through. Proven live on Material Web, Adobe Spectrum and Red Hat (no cut), though
  no live page has yet gone over the limit.
- **Headings survive clutter-like names.** Readability removed headings named like
  Docusaurus's `anchorTargetHideOnScrollNavbar`. Permalink text ("Section titled",
  "Direct link to") goes too.
- **Permalinks are recognised by where they point.** A link to a heading's own id,
  inside or beside it, is removed whatever its class or wording. Short headings
  beside one ("Types", "Usage") were being dropped by Readability as clutter:
  five on Material Web's button page.
- **Page facts skip more junk:** headings inside or holding a link (another story's
  teaser), values holding form controls, and cookie settings.
- **An article above its comments stays an article.** Comments outweighing the
  article made the main-content fallback fire, four times the length on a real
  page. Readability's result now stands when what it kept isn't itself a comment,
  and `omissions` gets `comments`.
- **Hidden text no longer counts or comes through in the fallback,** except code
  behind a "Show code" toggle.
- **Tabs read as one document.** Inactive panels are kept under their tab's name,
  in place of a tab strip of dead links. A panel over 5,000 characters is left out
  and named (`stats.standardization.omittedTabs`, `omissions` kind `inactive_tabs`).
- **Note asides survive,** as blockquotes: Readability removes every `<aside>`.
- **What changes the content says so in the Markdown too:** a fallback, a removed
  JSON line, left-out tabs and comments each add a closing line, since a caller may
  pass on only the Markdown. The shadow notice stays last.
- **Too little from Readability uses the page's `<main>`,** when it marks one with
  enough text, before the full page.
- **`stats.pageTextChars`** counts the page's text. A capture is a snapshot of the
  DOM at call time: a caller can re-capture until the number settles.
- **Headlines:** a site-wide `og:title` no longer replaces the page's H1, and a badge
  after an H1's title is dropped. A heading that is wholly a link to itself becomes
  plain text.
- A link around block content stays on one line, and `.ad-label` counts as an ad.
- The browser bundle grows to about 72.7 KB minified; the size ceiling is now
  74 KB.
- **The browser run no longer launches by default.** Launching browsers from agent
  sessions has crashed this machine. `npm run test:browser` now needs
  `PAGE_MARKDOWN_ALLOW_BROWSER_LAUNCH=1`, set by a person in their own shell;
  without it the run builds its page, launches nothing and exits with an error.
  It is no longer part of `npm run ci` or `prepublishOnly`.

## 0.1.5 — 2026-11-04

Content-fidelity fixes, each with a new fixture run in Node and in the browser:

- **Code blocks keep their lines.** Lines marked up with `<br>` or block
  elements (Docusaurus and similar highlighters) came out joined on one line.
- **Copy buttons stay out of code.** A `<button>` inside `<pre>` leaked its
  label into the code and lost the language. Whitespace around the `<code>`
  no longer loses the fence.
- **Text beside a heading is kept.** A `<div>` holding a heading and bare text
  was replaced by the heading, deleting the text.
- **Row spans keep columns aligned.** Later cells shifted left. A spanned cell
  now repeats in each row of a GFM table, and block-rendered tables label cells
  by their true column.
- **Large tables no longer freeze the page.** Table checks ran once per cell,
  so time grew with the square of the size: 500 rows took about 8 seconds in
  Chrome.
- **Modes leave more code alone.** Fences in list items and blockquotes, and
  inline code, were edited by `no_links`, `text_only` and blank-line cleanup.
- **A lead paragraph is no longer doubled** when it starts with a link or holds
  an entity such as `&lt;`.
- **Script links are caught however they are written.** `javascript:` with an
  embedded newline, tab or control character got through, as did `vbscript:`
  and `data:`. These links keep only their text. Images with such a source are
  dropped.
- **`<base href>` is respected** for links and images.
- **A linked image with empty alt is kept.**
- **An ad marker on `<body>` no longer empties the page.** Sites put page-wide ad
  settings there (`data-ad-unit` on heise.de), and the ad filter removed the whole
  body. `<html>` and `<body>` are never treated as ads; ads inside them still are.
- `stats.markdownChars` now matches the returned Markdown.
- The browser bundle grows to about 67.2 KB minified; the size ceiling is now
  68 KB.

- **TypeScript types.** Declarations for `pageToMarkdown`, its options, the full
  result and every stage export are generated from the JSDoc in `src` into
  `dist/types`, through a `types` condition in `exports`. The result is
  documented in a README table. `npm run typecheck` is part of `npm run ci`: it
  checks `src` against its JSDoc, checks a consumer file with `tsc`, and checks
  the declarations against real output from every fixture, in both directions.
  Only comments change in the existing modules; the bundle is the same size.
- **Bench.** `npm run bench` adds a Readability + Turndown baseline, word recall
  and precision, and 11 held-out pages whose probes were committed before any
  engine ran on them. The headline changes from 32/32 against 11/32 to 84/100
  against 74/100 and 61/100 on the held-out pages; see `bench/RESULTS.md` for the
  failures. `bench/fetch-pages.mjs` now decodes by declared charset and keeps the
  last good copy when a fetch fails. `npm run bench:write` updates
  `bench/RESULTS.md`; `npm run bench` only prints.
- **Licence summary.** The README now says in plain words who can use the package
  free and who needs a commercial licence, and how to ask for one. The licence
  itself is unchanged.
- **Browser run.** `npm run test:browser` runs the golden fixtures in
  headless Chrome or Edge, with the browser's own DOM, and checks what Node
  can't show:
  - the live document is left unmodified;
  - real open shadow roots are captured, nested roots and slotted children
    included;
  - closed shadow roots stay out.

  It is part of `npm run ci` and needs no new dependencies. The package's output
  in Chrome and Edge matches its Node output.

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
