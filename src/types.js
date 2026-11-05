/// <reference lib="dom" preserve="true" />
// Types only: nothing here exists at runtime. `npm run build:types` turns these
// and the JSDoc in the other modules into dist/types, which is what TypeScript
// consumers see.
export {};

/** @typedef {"full"|"no_links"|"text_only"} OutputMode */

/**
 * @typedef {object} SanitizeOptions
 * @property {boolean} [stripScripts]
 * @property {boolean} [stripStyles]
 * @property {boolean} [stripNoscript]
 * @property {boolean} [stripMeta]
 * @property {boolean} [stripLinkTags]
 * @property {boolean} [stripAds]
 * @property {readonly string[]} [extraStripSelectors] app-specific overlays or widgets to drop, e.g. "[data-app-overlay]"
 * @property {number} [shadowNodeLimit]
 * @property {number} [shadowCharLimit]
 * @property {number} [shadowDepthLimit]
 */

/** @typedef {NonNullable<ConstructorParameters<typeof import("@mozilla/readability").Readability<string>>[1]>} ReadabilityOptions */

/** @typedef {import("./extract.js").Extraction} Extraction */

/** @typedef {import("./extract.js").Extractor} Extractor */

/** @typedef {ReturnType<typeof import("./metadata.js").collectMetadata>} CollectedMetadata */

/**
 * @typedef {object} ExtractedMetadata
 * @property {string} [headline] the heading chosen for the capture
 * @property {string} [extractedTitle] the title the extractor reported
 * @property {string} [byline] the byline the extractor reported
 */

/** @typedef {CollectedMetadata & ExtractedMetadata} PageMarkdownMetadata */

/**
 * @typedef {object} PageMarkdownExtraction
 * @property {Extraction["method"]} method
 * @property {string} [fallbackReason] why extraction fell back to the full page or the main content
 * @property {true} [leadRecovered] a dropped lead paragraph was restored
 * @property {number} [pageFacts] how many facts `pageFacts` appended
 */

/** @typedef {"tag"|"variation_selector"|"invisible_operator"|"reserved_tag_plane"} HiddenRunKind */

/**
 * A run as text-sanctifier's findHiddenRuns reports it.
 * @typedef {object} HiddenRun
 * @property {HiddenRunKind} kind
 * @property {number} offset UTF-16 index of the first character
 * @property {number} end UTF-16 index just past the last character
 * @property {number} count code points in the run
 * @property {number} line 1-based line of the first character
 * @property {number} column 1-based column of the first character, in UTF-16 units
 * @property {string} [decoded] tag runs only: the ASCII the tags spell
 * @property {boolean} [decodedTruncated] tag runs only: true when `decoded` stops short of the run
 */

/**
 * @typedef {object} HiddenTextOmission
 * @property {`hidden_${HiddenRunKind}`} kind
 * @property {number} count runs removed from `markdown`
 * @property {number} chars code points in those runs
 * @property {string} note
 */

/**
 * Check `kind` before reading `chars`: only hidden-text omissions have it.
 * @typedef {{ kind: "shadow_content", count: number, note: string }
 *   | { kind: "json_line", count: number, note: string }
 *   | HiddenTextOmission} PageMarkdownOmission
 */

/** @typedef {ReturnType<typeof import("./standardize.js").standardizeDocument>} StandardizationStats */

/**
 * @typedef {object} PageMarkdownStats
 * @property {OutputMode} mode
 * @property {number} extractedHtmlChars
 * @property {number} convertedChars
 * @property {number} markdownChars
 * @property {StandardizationStats} standardization
 */

/**
 * @typedef {object} PageMarkdownResult
 * @property {string} version the package version that made this result
 * @property {string} markdown
 * @property {PageMarkdownMetadata} metadata
 * @property {PageMarkdownExtraction} extraction
 * @property {PageMarkdownOmission[]} omissions
 * @property {string[]} warnings
 * @property {PageMarkdownStats} stats
 * @property {string} [fullPageMarkdown] present only with `includeFullPage`
 */

/** @typedef {{ label: string, value: string }} PageFact */

/**
 * @typedef {string | string[] | ((node: HTMLElement, options: Record<string, unknown>) => boolean)} TurndownFilter
 */

/**
 * Turndown's public methods; Turndown ships no types of its own.
 * @typedef {object} TurndownInstance
 * @property {(input: string | Node) => string} turndown
 * @property {(plugin: TurndownPlugin | TurndownPlugin[]) => TurndownInstance} use
 * @property {(key: string, rule: { filter: TurndownFilter, replacement: (content: string, node: Node, options: Record<string, unknown>) => string }) => TurndownInstance} addRule
 * @property {(filter: TurndownFilter) => TurndownInstance} keep
 * @property {(filter: TurndownFilter) => TurndownInstance} remove
 * @property {(text: string) => string} escape
 */

/** @typedef {(service: TurndownInstance) => void} TurndownPlugin */
