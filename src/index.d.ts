/// <reference lib="dom" />
// Hand-written types for the public API (src/index.js). `npm run typecheck`
// checks them against real output: test/types/real-output.mjs fails when a
// result gains, loses or changes a field, or an export is added or removed.
import type { Readability } from "@mozilla/readability";

export const VERSION: string;

export type OutputMode = "full" | "no_links" | "text_only";

// ---- Options ----

export interface SanitizeOptions {
  stripScripts?: boolean;
  stripStyles?: boolean;
  stripNoscript?: boolean;
  stripMeta?: boolean;
  stripLinkTags?: boolean;
  stripAds?: boolean;
  /** App-specific overlays or widgets to drop, e.g. "[data-app-overlay]". */
  extraStripSelectors?: readonly string[];
  shadowNodeLimit?: number;
  shadowCharLimit?: number;
  shadowDepthLimit?: number;
}

export type ReadabilityOptions = NonNullable<ConstructorParameters<typeof Readability<string>>[1]>;

/** What `extractContent` returns and a custom extractor supplies. */
export interface Extraction {
  html: string;
  /** "readability", "full_page", or the name a custom extractor gave. */
  method: "readability" | "full_page" | (string & {});
  /** Set when extraction fell back to the full page. */
  fallbackReason?: string;
  title?: string;
  byline?: string;
  published?: string;
  siteName?: string;
  lang?: string;
  excerpt?: string;
}

/**
 * Receives a copy of the standardized document. Returning nothing, empty HTML
 * or too little text falls back to the full page; so does throwing.
 */
export type Extractor = (doc: Document) => Extraction | null | undefined;

export interface PageMarkdownOptions {
  /** Base for absolute links and images. Default: the document's URL. */
  url?: string;
  /** Default: "full". */
  mode?: OutputMode;
  /** Default: "readable" (Readability, with a full-page fallback). */
  extract?: "readable" | "full" | Extractor;
  /** Below this, readable extraction falls back to the full page. Default: 100. */
  minExtractChars?: number;
  /** Also return `fullPageMarkdown`. Default: false. */
  includeFullPage?: boolean;
  /** Start readable output with "# <headline>". Default: true. */
  includeTitle?: boolean;
  /** Restore a dropped lead paragraph that matches the meta description. Default: true. */
  recoverLead?: boolean;
  /** Append "## Page facts": short label/value pairs the article left out. Default: false. */
  pageFacts?: boolean;
  /**
   * Remove tag-character text, variation-selector runs, invisible operators and
   * reserved tag-plane code points from the Markdown (fenced code included),
   * `fullPageMarkdown` and `metadata`. Default: false.
   */
  removeHiddenText?: boolean;
  sanitize?: SanitizeOptions;
  /** Passed to Readability. */
  readability?: ReadabilityOptions;
}

// ---- Result ----

/** Read from the page. A field the page doesn't state is "". */
export interface CollectedMetadata {
  url: string;
  /** The canonical link, else `url`. */
  canonicalUrl: string;
  documentTitle: string;
  /** og:title or twitter:title, else the JSON-LD headline, else the document title. */
  title: string;
  description: string;
  author: string;
  published: string;
  modified: string;
  /** Falls back to the URL's hostname. */
  siteName: string;
  lang: string;
}

export interface PageMarkdownMetadata extends CollectedMetadata {
  /** The heading chosen for the capture. */
  headline?: string;
  /** The title the extractor reported. */
  extractedTitle?: string;
  /** The byline the extractor reported. */
  byline?: string;
}

export interface PageMarkdownExtraction {
  method: Extraction["method"];
  /** Why extraction fell back to the full page. */
  fallbackReason?: string;
  /** Present and true when a dropped lead paragraph was restored. */
  leadRecovered?: true;
  /** How many facts `pageFacts` appended; absent when none. */
  pageFacts?: number;
}

export interface ContentOmission<Kind extends "shadow_content" | "json_line" = "shadow_content" | "json_line"> {
  kind: Kind;
  count: number;
  note: string;
}

export type HiddenRunKind = "tag" | "variation_selector" | "invisible_operator" | "reserved_tag_plane";

export interface HiddenTextOmission {
  kind: `hidden_${HiddenRunKind}`;
  /** Runs removed from `markdown`. */
  count: number;
  /** Code points in those runs. */
  chars: number;
  note: string;
}

/** Check `kind` before reading `chars`: only hidden-text omissions have it. */
export type PageMarkdownOmission = ContentOmission<"shadow_content"> | ContentOmission<"json_line"> | HiddenTextOmission;

export interface StandardizationStats {
  lazyImagesResolved: number;
  inlineImagesDropped: number;
  scriptLinksUnwrapped: number;
  emptyLinksRemoved: number;
  preWrapped: number;
  headingWidgetsRemoved: number;
  headingsUnwrapped: number;
}

export interface PageMarkdownStats {
  mode: OutputMode;
  extractedHtmlChars: number;
  convertedChars: number;
  markdownChars: number;
  standardization: StandardizationStats;
}

export interface PageMarkdownResult {
  /** The package version that made this result. */
  version: string;
  markdown: string;
  metadata: PageMarkdownMetadata;
  extraction: PageMarkdownExtraction;
  omissions: PageMarkdownOmission[];
  warnings: string[];
  stats: PageMarkdownStats;
  /** Present only with `includeFullPage`. */
  fullPageMarkdown?: string;
}

/**
 * Converts a page (or an element of it) to Markdown. The live document is only
 * read. Throws TypeError when `input` is neither a Document nor an Element.
 */
export function pageToMarkdown(input: Document | Element, options?: PageMarkdownOptions): PageMarkdownResult;

// ---- Stages ----

export const DEFAULT_SANITIZE_OPTIONS: Readonly<Required<SanitizeOptions>>;
export function isAdvertisementElement(node: unknown): boolean;
/** An empty HTML document unconnected to the page. */
export function createInertDocument(doc: Document): Document;
export function sanitizeToInertDocument(
  root: Document | Element,
  options?: SanitizeOptions,
): { document: Document; omissions: { shadowHosts: number } };

/** Mutates `doc`, which should be an inert copy. */
export function standardizeDocument(doc: Document, options?: { url?: string }): StandardizationStats;

export const DEFAULT_MIN_EXTRACT_CHARS: number;
export function extractContent(
  doc: Document,
  options?: { extract?: PageMarkdownOptions["extract"]; minExtractChars?: number; readability?: ReadabilityOptions },
): Extraction;

export const TURNDOWN_OPTIONS: Readonly<{
  headingStyle: "atx";
  bulletListMarker: "-";
  codeBlockStyle: "fenced";
  emDelimiter: "_";
  strongDelimiter: "**";
  linkStyle: "inlined";
  hr: "---";
}>;

type TurndownFilter = string | string[] | ((node: HTMLElement, options: Record<string, unknown>) => boolean);
type TurndownPlugin = (service: TurndownInstance) => void;

/** Turndown's public methods; Turndown ships no types of its own. */
export interface TurndownInstance {
  turndown(input: string | Node): string;
  use(plugin: TurndownPlugin | TurndownPlugin[]): this;
  addRule(key: string, rule: {
    filter: TurndownFilter;
    replacement: (content: string, node: Node, options: Record<string, unknown>) => string;
  }): this;
  keep(filter: TurndownFilter): this;
  remove(filter: TurndownFilter): this;
  escape(text: string): string;
}

/** The configured Turndown instance. It is cached and shared with `htmlToMarkdown`. */
export function createTurndown(): TurndownInstance;
export function htmlToMarkdown(html: string): string;

export function cleanMarkdown(markdown: string): { markdown: string; removedJsonLines: number };
export function applyMode(markdown: string, mode?: OutputMode): string;
/** Applies `transform` to the prose between fenced code blocks only. */
export function mapOutsideFences(markdown: string, transform: (prose: string) => string): string;

export function collectMetadata(doc: Document, options?: { url?: string }): CollectedMetadata;

export function recoverLeadParagraph(html: string, doc: Document, description: string): { html: string; recovered: boolean };
export function chooseHeadline(
  doc: Document,
  meta?: { documentTitle?: string; title?: string; siteName?: string; extractedTitle?: string },
): string;

export interface PageFact {
  label: string;
  value: string;
}
export function collectPageFacts(doc: Document, articleHtml: string): PageFact[];
/** "## Page facts" list, or "" when there are none. */
export function pageFactsMarkdown(facts: readonly PageFact[]): string;

/** A run as text-sanctifier's findHiddenRuns reports it. */
export interface HiddenRun {
  kind: HiddenRunKind;
  /** UTF-16 index of the first character. */
  offset: number;
  /** UTF-16 index just past the last character. */
  end: number;
  /** Code points in the run. */
  count: number;
  /** 1-based line of the first character. */
  line: number;
  /** 1-based column of the first character, in UTF-16 units. */
  column: number;
  /** Tag runs only: the ASCII the tags spell. */
  decoded?: string;
  /** Tag runs only: true when `decoded` stops short of the run. */
  decodedTruncated?: boolean;
}

export function removeHiddenText(text: string): { text: string; runs: HiddenRun[] };
/** One omission per kind of run. */
export function hiddenTextOmissions(runs: ReadonlyArray<Pick<HiddenRun, "kind" | "count">>): HiddenTextOmission[];
