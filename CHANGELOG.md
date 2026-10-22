# Changelog

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
