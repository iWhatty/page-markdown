// Fetches the benchmark pages listed in bench/pages.txt as static HTML into
// .bench/pages (gitignored). Third-party HTML is never committed.
//   node bench/fetch-pages.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(".bench/pages");
fs.mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36";

const lines = fs.readFileSync("bench/pages.txt", "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
for (const line of lines) {
  const [name, url] = line.trim().split(/\s+/);
  const response = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  const html = await response.text();
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  fs.writeFileSync(path.join(OUT, `${name}.url`), `${url}\n`);
  console.log(`${response.status} ${name} ${html.length} chars`);
}
