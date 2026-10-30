// Browser bundle size of the package (esbuild, minified, ESM). The target is
// about 60 KB minified; the hard ceiling below catches regressions. v0.1
// measured 61.7 KB (Readability is most of it).
//   node bench/size.mjs
import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const TARGET_MIN_BYTES = 60 * 1024;
// Raised from 64 KB when the bundle reached 64.8 KB: the opt-in hidden-text
// stage (text-sanctifier's run finder, about 1.5 KB) and block rendering for
// tables holding code. Raise it again only deliberately, with a reason.
const BUDGET_MIN_BYTES = 66 * 1024;

const result = await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  write: false,
  metafile: true,
  logLevel: "error",
});
const code = result.outputFiles[0].contents;
const gzip = gzipSync(code).length;
const inputs = Object.entries(result.metafile.inputs)
  .map(([file, info]) => [file.replace(/^.*node_modules[\\/]/, ""), info.bytes])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6);

console.log(`minified ${(code.length / 1024).toFixed(1)} KB, gzip ${(gzip / 1024).toFixed(1)} KB (target ~${TARGET_MIN_BYTES / 1024} KB, ceiling ${BUDGET_MIN_BYTES / 1024} KB minified)`);
for (const [file, bytes] of inputs) console.log(`  ${(bytes / 1024).toFixed(1).padStart(6)} KB source  ${file}`);
if (code.length > BUDGET_MIN_BYTES) {
  console.error("over budget");
  process.exitCode = 1;
}
