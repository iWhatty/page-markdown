// What a TypeScript consumer writes. Imports by package name, so this also
// proves the `types` condition in package.json. Checked, never run.
import {
  VERSION,
  pageToMarkdown,
  sanitizeToInertDocument,
  standardizeDocument,
  extractContent,
  htmlToMarkdown,
  createTurndown,
  cleanMarkdown,
  applyMode,
  mapOutsideFences,
  collectMetadata,
  collectPageFacts,
  pageFactsMarkdown,
  removeHiddenText,
  hiddenTextOmissions,
  DEFAULT_SANITIZE_OPTIONS,
  DEFAULT_MIN_EXTRACT_CHARS,
  TURNDOWN_OPTIONS,
} from "page-markdown";
import type { Extractor, PageMarkdownOptions, PageMarkdownResult } from "page-markdown";

declare const page: Document;
declare const element: Element;

export const version: string = VERSION;

const result: PageMarkdownResult = pageToMarkdown(page);
pageToMarkdown(element, { url: "https://example.com/", mode: "no_links" });

const options: PageMarkdownOptions = {
  mode: "text_only",
  extract: "readable",
  minExtractChars: 50,
  includeFullPage: true,
  includeTitle: false,
  recoverLead: false,
  pageFacts: true,
  removeHiddenText: true,
  detectConcealedText: false,
  sanitize: { stripAds: false, extraStripSelectors: ["#panel"], shadowNodeLimit: 10 },
  readability: { charThreshold: 100, keepClasses: false },
};
pageToMarkdown(page, options);

const extractor: Extractor = (doc) => {
  const main = doc.querySelector("main");
  return main ? { html: main.innerHTML, method: "main_element", title: doc.title } : null;
};
pageToMarkdown(page, { extract: extractor });

// Result fields.
export const strings: string[] = [
  result.version,
  result.markdown,
  result.metadata.url,
  result.metadata.canonicalUrl,
  result.metadata.documentTitle,
  result.metadata.title,
  result.metadata.description,
  result.metadata.author,
  result.metadata.published,
  result.metadata.modified,
  result.metadata.siteName,
  result.metadata.lang,
  result.extraction.method,
  ...result.warnings,
];
export const counts: number[] = [
  result.stats.extractedHtmlChars,
  result.stats.convertedChars,
  result.stats.markdownChars,
  result.stats.standardization.preWrapped,
  result.stats.standardization.invalidLinksUnwrapped,
];
export const mode: "full" | "no_links" | "text_only" = result.stats.mode;

// Optional fields have to be checked before use.
export const fullPage: string = result.fullPageMarkdown ?? "";
export const headline: string | undefined = result.metadata.headline;
export const facts: number | undefined = result.extraction.pageFacts;
export const recovered: true | undefined = result.extraction.leadRecovered;
// @ts-expect-error fullPageMarkdown is absent without includeFullPage
export const unchecked: string = result.fullPageMarkdown;

// Omissions narrow on `kind`; only hidden-text ones count code points.
for (const omission of result.omissions) {
  if (omission.kind === "shadow_content" || omission.kind === "json_line" || omission.kind === "inactive_tabs" || omission.kind === "comments") {
    // @ts-expect-error no chars on this kind
    omission.chars;
  } else if (omission.kind === "concealed_text") {
    const chars: number = omission.chars;
    console.log(chars);
  } else {
    const chars: number = omission.chars;
    console.log(chars, omission.kind satisfies "hidden_tag" | "hidden_variation_selector" | "hidden_invisible_operator" | "hidden_reserved_tag_plane");
  }
}

export const concealment: "computed" | "static-only" | "disabled" | "incomplete" = result.concealmentCheck;
export const truncated: boolean = result.concealedTextTruncated;
for (const entry of result.concealedText) {
  const reason: "display_none" | "visibility_hidden" | "opacity_zero" | "font_size_zero" | "clipped" = entry.reason;
  console.log(reason, entry.chars satisfies number, entry.text satisfies string);
}

// Stages, in pipeline order.
const { document: inert, omissions } = sanitizeToInertDocument(page, DEFAULT_SANITIZE_OPTIONS);
export const shadowHosts: number = omissions.shadowHosts;
export const preWrapped: number = standardizeDocument(inert, { url: "https://example.com/" }).preWrapped;
const extraction = extractContent(inert, { extract: extractor, minExtractChars: DEFAULT_MIN_EXTRACT_CHARS });
const converted: string = htmlToMarkdown(extraction.html);
const { markdown, removedJsonLines } = cleanMarkdown(converted);
export const removed: number = removedJsonLines;
const plain: string = applyMode(markdown, "text_only");
const upper: string = mapOutsideFences(plain, (prose) => prose.toUpperCase());
export const author: string = collectMetadata(page).author;
export const factList: string = pageFactsMarkdown(collectPageFacts(inert, extraction.html));
const { text, runs } = removeHiddenText(upper);
export const cleaned: string = text;
export const firstOffset: number | undefined = runs[0]?.offset;
export const notes: string[] = hiddenTextOmissions(runs).map((omission) => omission.note);
createTurndown().remove("aside").addRule("x", { filter: "u", replacement: (content) => content }).turndown("<p>x</p>");
export const dash: "-" = TURNDOWN_OPTIONS.bulletListMarker;

// Wrong calls are refused.
// @ts-expect-error a Document or Element, not a string
pageToMarkdown("<p>x</p>");
// @ts-expect-error not a mode
pageToMarkdown(page, { mode: "plain" });
// @ts-expect-error not an option
pageToMarkdown(page, { includeTitles: true });
// @ts-expect-error extractors are synchronous
pageToMarkdown(page, { extract: async () => ({ html: "", method: "x" }) });
// @ts-expect-error an extractor names its method
pageToMarkdown(page, { extract: () => ({ html: "" }) });
// @ts-expect-error not a sanitize option
pageToMarkdown(page, { sanitize: { stripImages: true } });
