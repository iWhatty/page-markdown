// Fetches the benchmark pages listed in bench/pages.txt as static HTML into
// .bench/pages (gitignored). Third-party HTML is never committed; each page gets
// a <name>.json recording its URL, fetch date and hash, which RESULTS.md prints
// so a score can be tied to the bytes behind it. A failed fetch keeps the last
// good copy and makes the run exit 1.
//   node bench/fetch-pages.mjs [name ...]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(".bench/pages");
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36";

// Header first, then the page's own declaration, as a browser does. Without
// this a Shift_JIS page reaches the engines as mojibake.
function decode(bytes, contentType) {
  const sniffed = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const label = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
    || sniffed.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
    || "utf-8";
  return { label: label.toLowerCase(), html: new TextDecoder(label).decode(bytes) };
}

const only = process.argv.slice(2);
const lines = fs.readFileSync("bench/pages.txt", "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
let failed = 0;
for (const line of lines) {
  const [name, url] = line.trim().split(/\s+/);
  if (only.length && !only.includes(name)) continue;
  try {
    const response = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { label, html } = decode(bytes, response.headers.get("content-type") || "");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    fs.writeFileSync(path.join(OUT, `${name}.html`), html);
    fs.writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify({ url, finalUrl: response.url, fetched: new Date().toISOString().slice(0, 10), charset: label, sha256 }, null, 2)}\n`);
    console.log(`${response.status} ${name} ${html.length} chars (${label})`);
  } catch (error) {
    failed += 1;
    console.error(`FAILED ${name}: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
