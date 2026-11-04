// Fixtures whose golden pins an opt-in behaviour. Shared by the Node contract
// suite and the browser run.
export const GOLDEN_OPTIONS = {
  "regression/package-sidebar.html": { pageFacts: true },
  "regression/linked-images.html": { mode: "no_links" },
  "contract/hidden-text.html": { removeHiddenText: true },
  "regression/code-line-markup.html": { extract: "full" },
  "regression/heading-with-text.html": { extract: "full" },
  "regression/table-rowspan.html": { extract: "full" },
  "regression/list-code-text-only.html": { extract: "full", mode: "text_only" },
  "regression/link-schemes.html": { extract: "full" },
  "regression/base-href.html": { extract: "full" },
};

export const GOLDEN_DIRS = ["contract", "source-capture", "regression"];
