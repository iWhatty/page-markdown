// Runs inside the page that test/browser/run.mjs builds, after the bundle has
// defined the PageMarkdown global. Checks the golden fixtures against the
// browser's own DOM, then what linkedom cannot show: a live document with
// layout, real open shadow roots with slots, and closed shadow roots.
// Results go into #results, URI-encoded JSON, for run.mjs to read.
(function () {
  const { pageToMarkdown } = PageMarkdown;
  const dataNode = document.getElementById("data");
  const { fixtures, url } = JSON.parse(dataNode.textContent);
  dataNode.remove();
  const results = [];

  function check(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: String(error?.message || error) });
    }
  }

  function firstDifference(actual, expected) {
    const a = actual.split("\n");
    const e = expected.split("\n");
    for (let i = 0; i < Math.max(a.length, e.length); i += 1) {
      if (a[i] !== e[i]) return `line ${i + 1}\n  expected: ${JSON.stringify(e[i])}\n  actual:   ${JSON.stringify(a[i])}`;
    }
    return "";
  }

  function ok(value, message) {
    if (!value) throw new Error(message);
  }

  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  for (const fixture of fixtures) {
    check(`golden: ${fixture.file}`, () => {
      const { markdown } = pageToMarkdown(parse(fixture.html), { url, ...fixture.options });
      ok(markdown === fixture.golden, `${fixture.file} differs from its golden at ${firstDifference(markdown, fixture.golden)}`);
    });
  }

  const stage = document.getElementById("stage");

  check("the live document is not modified, and its ads are dropped", () => {
    const source = fixtures.find((f) => f.file === "contract/ads-overlays.html");
    stage.innerHTML = parse(source.html).body.innerHTML;
    const before = document.documentElement.outerHTML;
    const { markdown } = pageToMarkdown(document, { url });
    ok(document.documentElement.outerHTML === before, "the live document changed");
    ok(markdown.includes("After the ads."), "article text missing from the live-page capture");
    ok(!/sponsored/i.test(markdown), "ad text reached the live-page capture");
    stage.textContent = "";
  });

  function shadowHost(mode, shadowHtml, lightHtml = "") {
    const host = document.createElement("custom-card");
    host.innerHTML = lightHtml;
    host.attachShadow({ mode }).innerHTML = shadowHtml;
    stage.appendChild(host);
    return host;
  }

  const filler = `<p>${"Light text that makes the page long enough to read. ".repeat(4)}</p>`;

  check("open shadow roots are captured, with slotted light children in place", () => {
    stage.innerHTML = filler;
    shadowHost(
      "open",
      "<h2>Shadow heading</h2><slot name=\"lead\"></slot><p>Shadow paragraph.</p><slot></slot>",
      "<p slot=\"lead\">Slotted lead.</p><p>Default slot text.</p>",
    );
    const { markdown, omissions } = pageToMarkdown(stage, { url, extract: "full" });
    const order = ["Shadow heading", "Slotted lead.", "Shadow paragraph.", "Default slot text."].map((t) => markdown.indexOf(t));
    ok(order.every((i) => i >= 0), `shadow or slotted text missing:\n${markdown}`);
    ok(order.every((i, n) => n === 0 || i > order[n - 1]), `rendered order lost:\n${markdown}`);
    ok(omissions.length === 0, "unexpected omission");
    stage.textContent = "";
  });

  check("nested open shadow roots are captured", () => {
    stage.innerHTML = filler;
    const outer = shadowHost("open", "<p>Outer shadow.</p><inner-card></inner-card>");
    outer.shadowRoot.querySelector("inner-card").attachShadow({ mode: "open" }).innerHTML = "<p>Inner shadow.</p>";
    const { markdown } = pageToMarkdown(stage, { url, extract: "full" });
    ok(markdown.includes("Outer shadow.") && markdown.includes("Inner shadow."), `nested shadow text missing:\n${markdown}`);
    stage.textContent = "";
  });

  check("shadow content over the limit is omitted with a notice", () => {
    stage.innerHTML = filler;
    shadowHost("open", "<p>One.</p><p>Two.</p><p>Three.</p>");
    const { markdown, omissions } = pageToMarkdown(stage, { url, extract: "full", sanitize: { shadowNodeLimit: 2 } });
    ok(!markdown.includes("Three."), "over-limit shadow text captured");
    ok(omissions[0]?.kind === "shadow_content", "no shadow_content omission");
    ok(/Open shadow content omitted: capture limit \(1 host\(s\)\)\./.test(markdown), "no omission notice");
    stage.textContent = "";
  });

  check("slotted page content isn't charged to the shadow limit", () => {
    stage.innerHTML = filler;
    shadowHost("open", "<slot></slot><p>After the slot.</p>", "<p>One.</p><p>Two.</p><p>Three.</p>");
    const { markdown, omissions } = pageToMarkdown(stage, { url, extract: "full", sanitize: { shadowNodeLimit: 3 } });
    ok(markdown.includes("Three.") && markdown.includes("After the slot."), `slotted text lost:\n${markdown}`);
    ok(omissions.length === 0, "unexpected omission");
    stage.textContent = "";
  });

  check("a host among slotted content has its own budget", () => {
    stage.innerHTML = filler;
    const outer = shadowHost("open", "<slot></slot><p>After the slot.</p>", "<p>Slotted.</p>");
    const inner = document.createElement("inner-card");
    inner.attachShadow({ mode: "open" }).innerHTML = "<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>";
    outer.appendChild(inner);
    const { markdown, omissions } = pageToMarkdown(stage, { url, extract: "full", sanitize: { shadowNodeLimit: 3 } });
    ok(markdown.includes("One.") && !markdown.includes("Four."), `inner host not cut at its limit:\n${markdown}`);
    ok(markdown.includes("After the slot."), `the outer host was cut off:\n${markdown}`);
    ok(omissions[0]?.count === 1, "the cut wasn't counted once");
    stage.textContent = "";
  });

  check("closed shadow roots are not captured", () => {
    stage.innerHTML = filler;
    shadowHost("closed", "<p>Closed shadow secret.</p>");
    const { markdown } = pageToMarkdown(stage, { url, extract: "full" });
    ok(!markdown.includes("Closed shadow secret."), "closed shadow text captured");
    stage.textContent = "";
  });

  const passed = results.filter((r) => r.ok).length;
  document.getElementById("summary").textContent = `${passed}/${results.length} passed in ${navigator.userAgent}`;
  const list = document.getElementById("list");
  for (const r of results) {
    const item = document.createElement("li");
    item.textContent = `${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : `\n${r.error}`}`;
    if (!r.ok) item.className = "fail";
    list.appendChild(item);
  }
  document.getElementById("results").textContent = encodeURIComponent(JSON.stringify({ userAgent: navigator.userAgent, results }));
})();
