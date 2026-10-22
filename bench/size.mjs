// Browser bundle size of the package (esbuild, minified, ESM). The target is
// about 60 KB minified; the hard ceiling below catches regressions. v0.1
// measured 61.7 KB (Readability is most of it).
//   node bench/size.mjs
import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const TARGET_MIN_BYTES = 60 * 1024;
const BUDGET_MIN_BYTES = 64 * 1024;

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
