// Fixtures whose golden pins an opt-in behaviour. Shared by the Node contract
// suite and the browser run.
export const GOLDEN_OPTIONS = {
  "regression/package-sidebar.html": { pageFacts: true },
  "regression/linked-images.html": { mode: "no_links" },
  "contract/hidden-text.html": { removeHiddenText: true },
};

export const GOLDEN_DIRS = ["contract", "source-capture", "regression"];
