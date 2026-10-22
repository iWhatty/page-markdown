# Changelog

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
