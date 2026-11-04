// Probes and word-recall references for bench/compare.mjs.
//
// HELD_OUT pages: no fix in src/ was tuned on them. Their probes and reference
// roots were written from the raw HTML and committed before any engine ran on
// them, so `git log bench/probes.mjs` shows the order. A probe that later turns
// out to be wrong about the page is fixed in its own commit that says why; a
// probe is never changed because an engine fails it.
//
// REFERENCES: which part of each page counts as content. A reference is the text
// of the `roots` elements minus `drop`, chosen by reading the page's own markup.

const STRAIGHT = [[/[“”„]/g, '"'], [/[‘’]/g, "'"], [/ /g, " "]];

export function straighten(text) {
  return STRAIGHT.reduce((out, [from, to]) => out.replace(from, to), text.normalize("NFKC"));
}

// Markdown down to its prose, so a phrase probe tests the words and not whether
// an engine linked or emphasised some of them.
export function plain(md) {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, "$1")
    .replace(/\*\*|~~|`/g, "")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, "$1$2");
  return straighten(text).replace(/\s+/g, " ");
}

// Fence bodies, dedented. A fence may sit indented in a list item and may use a
// longer run of backticks to wrap shorter ones.
function fences(md) {
  const bodies = [];
  let open = null;
  for (const line of md.split("\n")) {
    const marker = line.match(/^(\s*)(`{3,})(.*)$/);
    if (!open) {
      if (marker) open = { indent: marker[1].length, ticks: marker[2].length, lines: [] };
    } else if (marker && marker[2].length >= open.ticks && !marker[3].trim()) {
      bodies.push(open.lines.join("\n"));
      open = null;
    } else {
      open.lines.push(line.slice(open.indent));
    }
  }
  return bodies;
}

const has = (phrase) => Object.assign((md) => plain(md).includes(straighten(phrase)), { phrase });
const lacks = (phrase) => Object.assign((md) => !plain(md).includes(straighten(phrase)), { phrase, absent: true });
const heading = (text) => (md) => md.split("\n").some((line) => {
  const m = line.match(/^#{1,6} (.*)$/);
  return m && plain(m[1]).trim() === straighten(text);
});
const title = (text) => (md) => plain(md.trimStart().split("\n")[0]).trim() === `# ${straighten(text)}`;
const fenced = (pattern) => (md) => fences(md).some((body) => pattern.test(body));
const fenceCount = (n) => (md) => fences(md).length >= n;
const row = (...cells) => (md) => md.split("\n").some((line) => {
  const got = line.split("|").map((c) => plain(c).trim());
  return line.trimStart().startsWith("|") && cells.every((c) => got.includes(c));
});
const matches = (pattern) => (md) => pattern.test(md);
const quoted = (phrase) => (md) => md.split("\n").some((line) => /^\s*>/.test(line) && plain(line).includes(straighten(phrase)));
const lines = (n) => (md) => md.split("\n").filter((l) => l.trim()).length >= n;

export const HELD_OUT = {
  "news-guardian": [
    ["Clean title heading", title("Nasa telescope launched in 2004 to plunge back to Earth after failed rescue mission")],
    ["Keeps the standfirst", has("is expected to re-enter Earth’s atmosphere Wednesday, burning up in the process")],
    ["Keeps the opening", has("which has spent two decades studying the most powerful explosions in the cosmos")],
    ["Keeps the middle", has("approximately 1 in 2,100")],
    ["Keeps text after the newsletter box", has("We were looking for these star-shredding events")],
    ["Keeps the end", has("comets and asteroids in our own solar system")],
    ["No newsletter box", lacks("Sign up to Headlines US")],
    ["No related-story link in the body", lacks("SpaceX rocket launch causes stunning")],
    ["No topic footer", lacks("Explore more on these topics")],
  ],
  "news-ars": [
    ["Clean title heading", title("Why large dogs age faster than small ones, and other October research highlights")],
    ["Keeps the opening", has("It’s a regrettable reality that there is never enough time")],
    ["Keeps a first-story detail", has("The authors used data from 864 dogs")],
    ["Keeps all six story headings", (md) => ["Why large dogs age faster", "Trapping an antimatter particle for months", "Invisible tattoos that show up under light", "Westminster skeleton likely a monk", "More on how Botticelli’s favorite model died", "Dating van Gogh’s Starry Night"].every((h) => heading(h)(md))],
    ["Keeps the last story's end", has("DOI: 10.1038/s41598-026-73025-5")],
    ["No text-settings widget", lacks("Minimize to nav")],
    ["No subscriber upsell", lacks("Subscribers only")],
  ],
  "commerce-books": [
    ["Clean title heading", title("A Light in the Attic")],
    ["Keeps the price", has("£51.77")],
    ["Keeps availability", has("In stock (22 available)")],
    ["Keeps the description", has("Shel, you never sounded so good")],
    ["Spec table: UPC row", row("UPC", "a897fe39b1053632")],
    ["Spec table: reviews row", row("Number of reviews", "0")],
    ["Cover image with absolute URL", matches(/!\[[^\]]*\]\(https:\/\/books\.toscrape\.com\/media\/cache\/fe\/72\//)],
    ["No site tagline", lacks("We love being scraped!")],
  ],
  "commerce-ikea": [
    ["Clean title heading", title("BILLY bookcases")],
    ["Keeps the first product", has("BILLY Bookcase, white, 31 1/2x11x79 1/2")],
    ["Keeps a product price", has("$59.00")],
    ["Keeps the last server-rendered product", has("BILLY Bookcase w hght ext ut/pnl/glss drs, white")],
    ["Product link is absolute", matches(/\]\(https:\/\/www\.ikea\.com\/us\/en\/p\/billy-bookcase-white-20522046\/?\)/)],
    ["Keeps the buying-guide heading", heading("Where to place a BILLY bookcase?")],
    ["Keeps a buying-guide list item", matches(/^\s*[-*] +Pantries for easy-to-reach spices and canned goods/m)],
    ["Keeps the end", has("design your perfect layout before you buy")],
    ["No footer", lacks("Join IKEA Family")],
  ],
  "forum-arch": [
    ["Keeps the thread subject", has("My laptop freezes when it goes into sleep mode.")],
    ["Keeps the first post", has("the system won't wake up after going to sleep")],
    ["Keeps a first reply", has("Edit your post and chose a meaningful subject")],
    ["Keeps a late reply", has("It is, you simply posted the wrong journal")],
    ["Keeps the last post", has("Does systemctl suspend command work?")],
    ["Keeps the last poster's name", has("ismailarilik")],
    ["Command in a code fence", fenced(/^sudo journalctl -b -1 \| nc termbin\.com 9999$/m)],
    ["Long journal paste stays a code block", (md) => fences(md).some((body) => body.split("\n").length >= 500)],
    ["Quote stays a blockquote", quoted("the sysrq+REISUB allwais fail, never works.")],
    ["No site navigation", lacks("GitLab")],
    ["No board-jump footer", lacks("Networking, Server, and Protection")],
  ],
  "forum-lobsters": [
    ["Keeps the story title", has("So my ISP was hijacking my DNS")],
    ["Keeps the story's outbound link", matches(/\]\(https?:\/\/karthihegde\.dev[^)]*\)/)],
    ["Keeps the first comment", has("This is a great summary of common misconceptions")],
    ["Comment link kept", matches(/https:\/\/ooni\.org\/install\//)],
    ["Keeps the middle comment", has("the ISP needs to be outed")],
    ["Keeps the last comment", has("They monitor and tamper with all DNS traffic over port 53")],
    ["Keeps commenter names", (md) => has("johnklos")(md) && has("dracarys_18")(md)],
    ["No site navigation", lacks("Moderation Log")],
  ],
  "docs-docusaurus": [
    ["Clean title heading", title("Admonitions")],
    ["Clean section heading", heading("Usage with Prettier")],
    ["Keeps a nested section heading", heading("Nested admonitions")],
    ["≥ 10 fenced code blocks", fenceCount(10)],
    ["Code keeps its line breaks", fenced(/^:::note$/m)],
    ["JSX example keeps its line breaks", fenced(/^export default function MyReactPage\(\) \{$/m)],
    ["Keeps the rendered admonition", has("The admonition container has now the id")],
    ["Keeps a non-default tab panel", has("This is a banana")],
    ["Keeps the end", has("It is your responsibility to map each admonition keyword")],
    ["No edit link", lacks("Edit this page")],
    ["No sidebar", lacks("TypeScript Support")],
  ],
  "docs-starlight": [
    ["Clean title heading", title("Authoring Content in Markdown")],
    ["Clean section heading", heading("Frontmatter")],
    ["No heading-anchor label", lacks("Section titled")],
    ["≥ 30 fenced code blocks", fenceCount(30)],
    ["Frontmatter example keeps its lines", fenced(/^title: My page title$/m)],
    ["All three package-manager tabs kept", (md) => [/^npx astro add markdoc$/m, /^pnpm astro add markdoc$/m, /^yarn astro add markdoc$/m].every((p) => fenced(p)(md))],
    ["Keeps a callout", has("(also known as \"admonitions\" or \"callouts\")")],
    ["Keeps a details block", has("Where and when is the Andromeda constellation most visible?")],
    ["Relative link made absolute", matches(/\]\(https:\/\/starlight\.astro\.build\/reference\/frontmatter\/?\)/)],
    ["Keeps the end", fenced(/extends: \[starlightMarkdoc\(\{ headingLinks: false \}\)\],/)],
    ["No skip link", lacks("Skip to content")],
    ["No edit link", lacks("Edit page")],
  ],
  "de-heise": [
    ["Clean title heading", title("Griechischer Satellit testet Laserkommunikation zur Erde")],
    ["Keeps the lead", has("Ein in Griechenland entwickelter Satellit hat erfolgreich")],
    ["Keeps the opening, umlauts intact", has("Schnelle Datenübertragung aus dem All")],
    ["Keeps the middle", has("Holomondas Optical Ground Station (HolOGS-1)")],
    ["Keeps the subheading", heading("Zusammenarbeit zwischen Industrie, Wissenschaft und Institutionen")],
    ["Keeps the end", has("Turbulenzen können die Signalqualität beeinträchtigen")],
    ["No ad label", lacks("Weiterlesen nach der Anzeige")],
    ["No paywall box", lacks("Wochenpass bestellen")],
    ["No sponsored teasers", lacks("Heizkosten sparen ohne Komfortverlust")],
    ["No newsletter box", lacks("Keine News verpassen")],
  ],
  "ja-aozora": [
    ["Clean title heading", title("走れメロス")],
    ["Keeps the opening", has("メロスは激怒した")],
    ["Ruby base text kept", has("かの邪智暴虐")],
    ["Keeps the middle", has("セリヌンティウスである")],
    ["Keeps the end", has("勇者は、ひどく赤面した。")],
    ["Keeps the closing note", has("古伝説と、シルレルの詩から。")],
    ["≥ 50 lines (paragraph breaks survive)", lines(50)],
  ],
  "ar-bbc": [
    ["Clean title heading", title("الحوثيون يعلنون استهداف مطار الرياض، وحزب الله ينفي دعمهم عسكرياً")],
    ["Keeps the opening", has("أعلنت جماعة أنصار الله الحوثية")],
    ["Keeps a section heading", heading("العليمي يتهم إيران بتعزيز دعمها للحوثيين")],
    ["Keeps the last heading", heading("حزب الله ينفي وجود خبراء له في اليمن")],
    ["Keeps the end", has("واتخاذ إجراءات لوقف تدفق الأسلحة والخبرات العسكرية إلى الحوثيين")],
    ["No most-read box", lacks("تخطى الأكثر قراءة وواصل القراءة")],
    ["No podcast promo", lacks("تخطى البودكاست وواصل القراءة")],
    ["No topic links footer", lacks("اكتشف المزيد")],
  ],
};

// Removed from every reference: never text a reader sees as content.
export const ALWAYS_DROP = "script,style,noscript,template,svg,button,select,input,textarea";

export const REFERENCES = {
  // Tuned pages. Probes for these stay in compare.mjs, unchanged.
  "mdn-abortsignal": { roots: ["main h1", "main .layout__body"], drop: "footer" },
  "wikipedia-markdown": { roots: ["#firstHeading", "#mw-content-text"], drop: ".mw-editsection,.navbox,.printfooter,.metadata,.sistersitebox" },
  "python-json-docs": { roots: ["[role=main] section#module-json"], drop: ".headerlink" },
  "pg-essay": { roots: ["font[size='2'][face='verdana']"], drop: "" },
  "github-readability": { roots: ["article.markdown-body"], drop: ".anchor,.zeroclipboard-container" },
  // Held-out pages.
  "news-guardian": { roots: ["main h1", "[data-gu-name=standfirst]", "#maincontent"], drop: "figure[data-spacefinder-role],#sign-in-gate" },
  "news-ars": { roots: ["article h1", "article .post-content"], drop: ".ad-wrapper" },
  "commerce-books": { roots: ["article.product_page"], drop: ".alert" },
  "commerce-ikea": { roots: ["main h1", ".js-product-list", ".plp-body-copy-slot-wrapper"], drop: ".plp-product-variants,.plp-checkbox--subtle,.plp-rec-carousel" },
  "forum-arch": { roots: ["#brdmain .blockpost"], drop: ".postfoot,.postsignature" },
  "forum-lobsters": { roots: ["main#inside"], drop: ".voters,.comment_folder" },
  "docs-docusaurus": { roots: [".theme-doc-markdown"], drop: ".hash-link" },
  "docs-starlight": { roots: ["main h1", ".sl-markdown-content"], drop: ".sl-anchor-link,.sr-only" },
  "de-heise": { roots: ["article#meldung h1", ".a-article-header__lead", "article#meldung .article-content"], drop: "[class*=ad-mobile-group],.ad,.a-u-inline,a-gift" },
  "ja-aozora": { roots: ["h1", ".main_text"], drop: "rt,rp" },
  "ar-bbc": { roots: ["main"], drop: "section,[class*=ReadTime]" },
};
