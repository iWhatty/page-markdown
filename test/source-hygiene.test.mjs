// No file in the repo may hold raw invisible or control characters: a tool
// that rewrites "\u" escapes can plant them without anyone seeing. Tests and
// fixtures build such characters with String.fromCodePoint or character
// references instead.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "test", "bench", "README.md", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md", "package.json"];
const SKIP_DIRS = new Set(["node_modules", ".bench"]);
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Cc}]/u;
const ALLOWED = new Set(["\n", "\r", "\t"]);

function* files(entry) {
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    yield entry;
    return;
  }
  for (const name of fs.readdirSync(entry)) {
    if (!SKIP_DIRS.has(name)) yield* files(path.join(entry, name));
  }
}

test("no file holds raw invisible or control characters", () => {
  const found = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const ch of line) {
          if (!ALLOWED.has(ch) && HIDDEN.test(ch)) {
            found.push(`${file}:${i + 1} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
          }
        }
      });
    }
  }
  assert.deepEqual(found, []);
});
