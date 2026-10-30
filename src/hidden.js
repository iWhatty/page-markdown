// Optional last stage: remove characters that hide text from people but not
// from models (tag characters, variation-selector runs, invisible operators),
// found by text-sanctifier's run finder. Legitimate sequences are kept: the
// England, Scotland and Wales flags and a lone emoji or text presentation
// selector. Unlike the clean stage, this also applies inside fenced code.
import { findHiddenRuns } from "text-sanctifier/hidden";

const NOTES = {
  tag: "Hidden tag-character text removed",
  variation_selector: "Variation selector runs removed",
  invisible_operator: "Invisible operator runs removed",
};

/**
 * @param {string} text
 * @returns {{ text: string, runs: Array<{ kind: string, count: number }> }}
 */
export function removeHiddenText(text) {
  const source = String(text ?? "");
  const { runs } = findHiddenRuns(source);
  if (!runs.length) return { text: source, runs };
  let out = "";
  let at = 0;
  for (const run of runs) {
    out += source.slice(at, run.offset);
    at = run.end;
  }
  return { text: out + source.slice(at), runs };
}

/**
 * One omission per kind of run: `count` runs, `chars` code points.
 * @param {Array<{ kind: string, count: number }>} runs
 */
export function hiddenTextOmissions(runs) {
  const byKind = new Map();
  for (const run of runs) {
    const entry = byKind.get(run.kind) || { kind: `hidden_${run.kind}`, count: 0, chars: 0, note: NOTES[run.kind] };
    entry.count += 1;
    entry.chars += run.count;
    byKind.set(run.kind, entry);
  }
  return Array.from(byKind.values());
}
