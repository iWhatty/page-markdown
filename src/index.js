// Ordinary entry: the observer implementation is imported only by /trial.
import { runPipeline } from './pipeline.js';
export { VERSION } from './pipeline.js';
export { sanitizeToInertDocument, DEFAULT_SANITIZE_OPTIONS, isAdvertisementElement, createInertDocument } from "./sanitize.js";
export { standardizeDocument } from "./standardize.js";
export { extractContent, DEFAULT_MIN_EXTRACT_CHARS, DEFAULT_MIN_EXTRACT_SHARE } from "./extract.js";
export { htmlToMarkdown, createTurndown, TURNDOWN_OPTIONS } from "./convert.js";
export { cleanMarkdown, applyMode, mapOutsideFences } from "./clean.js";
export { collectMetadata } from "./metadata.js";
export { recoverLeadParagraph, chooseHeadline } from "./refine.js";
export { collectPageFacts, pageFactsMarkdown } from "./facts.js";
export { removeHiddenText, hiddenTextOmissions } from "./hidden.js";
export * from "./types.js";

/** @typedef {import('./pipeline.js').PageMarkdownOptions} PageMarkdownOptions */

/**
 * @param {Document|Element} input
 * @param {PageMarkdownOptions} [options]
 * @returns {import('./types.js').PageMarkdownResult}
 */
export function pageToMarkdown(input, options = {}) {
  if (options.diagnostics === 'trial') {
    const error = new Error('Trial diagnostics require importing page-markdown/trial');
    error.name = 'TrialEntryRequiredError';
    throw error;
  }
  return runPipeline(input, options);
}
