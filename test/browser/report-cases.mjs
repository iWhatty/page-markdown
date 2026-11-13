// Expectations mirror the named tests in test/contract.test.mjs. Browser-only
// extensions are identified below; keep these references when changing either.
export const SCOPE = 'Synthetic browser behaviour, computed serialization and local timing only. This does not establish real-site prevalence, visual correctness, or validation of the provisional scroll-reveal rule; real-site evidence is still required. Detection is opt-in for 0.3.0; default-on is withdrawn and reconsidered after the real-site trial.';
export const FIELDS = ['display', 'visibility', 'opacity', 'fontSize', 'position', 'clip', 'clipPath', 'transitionProperty', 'transitionDuration', 'animationName', 'animationDuration', 'color', 'backgroundColor', 'backgroundImage', 'backgroundClip', 'textShadow'];
export const OPTIONAL_FIELDS = ['webkitBackgroundClip', 'webkitTextFillColor', 'webkitTextStrokeWidth'];
export const cases = [];
const entry = (reason, text) => ({ reason, text: text.slice(0, 2048), chars: text.length });
function add(group, name, css, reason = null, extra = {}) {
  const id = `${group}-${name}`;
  const text = `Sentinel${id.replaceAll('-', '')}731`;
  cases.push({ id, group, options: { detectConcealedText: true }, shows: name.replaceAll('-', ' '), css: `.target{${css}}`,
    html: `<main><p class="target" id="target">${text}</p></main>`,
    expected: { check: 'computed', entries: reason ? [entry(reason, text)] : [],
      sentinels: { [text]: !reason }, pending: false }, ...extra });
  return cases.at(-1);
}
// "concealed <reason>: source style, baseline and both outputs",
// "concealed clipping patterns, unknown values and source purity", and
// "concealed colour <label>".
for (const [name, css, reason] of [
  ['display-none', 'display:none', 'display_none'],
  ['visibility-hidden', 'visibility:hidden', 'visibility_hidden'],
  ['opacity-zero', 'opacity:0', 'opacity_zero'],
  ['font-size-zero', 'font-size:0', 'font_size_zero'],
  ['rect-zero', 'position:absolute;clip:rect(0,0,0,0)', 'clipped'],
  ['rect-one', 'position:fixed;clip:rect(1px,1px,1px,1px)', 'clipped'],
  ['inset', 'clip-path:inset(50%)', 'clipped'],
  ['circle', 'clip-path:circle(0)', 'clipped'],
  ['transparent', 'color:transparent', 'transparent_text'],
  ['own-background', 'color:white;background:white', 'same_color'],
  ['ancestor-background', 'color:white', 'same_color'],
]) {
  const c = add('A', name, css, reason);
  if (name === 'ancestor-background') c.css += 'main{background:white}';
}
// "concealed colour <label>", "concealed descendants override visibility
// and font size, never display or opacity", and legacy clip applicability.
for (const [name, css] of [
  ['gradient', 'color:transparent;background:linear-gradient(red,blue);background-clip:text'],
  ['webkit-gradient', 'color:transparent;background:linear-gradient(red,blue);-webkit-background-clip:text'],
  ['shadow', 'color:transparent;text-shadow:1px 1px black'],
  ['visible-fill', 'color:transparent;-webkit-text-fill-color:blue'],
  ['static-rect', 'position:static;clip:rect(0,0,0,0)'],
  ['near-white', 'color:rgb(254,255,255);background:white'],
  ['half-alpha', 'color:rgb(0 0 0 / .5)'],
  ['intervening-image', 'color:white'],
  ['intervening-translucent', 'color:white'],
]) {
  const c = add('B', name, css);
  if (name.includes('gradient')) c.html = c.html.replaceAll('<p ', '<h2 ').replaceAll('</p>', '</h2>');
  if (name.startsWith('intervening')) {
    c.html = c.html.replace('<main>', '<main><div id="layer">').replace('</main>', '</div></main>');
    c.css += `main{background:white}#layer{${name.endsWith('image') ? 'background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221%22 height=%221%22%3E%3Crect width=%221%22 height=%221%22 fill=%22white%22/%3E%3C/svg%3E")' : 'background:rgba(255,255,255,.5)'}}`;
  }
}
for (const inline of [false, true]) {
  // "concealed inline visibility retains a visible descendant override".
  const c = add('B', inline ? 'inline-visible-child' : 'visible-child', 'visibility:visible');
  c.html = c.html.replace('<main>', `<main><div id="hidden"${inline ? ' style="visibility:hidden"' : ''}>`).replace('</main>', '</div></main>');
  if (inline) {
    c.html = c.html.replace('class="target"', 'class="target" style="visibility:visible"').replace('style="visibility:hidden">', 'style="visibility:hidden">HiddenInline806');
    c.expected.entries = [entry('visibility_hidden', 'HiddenInline806')];
    c.expected.sentinels.HiddenInline806 = false;
  }
  else c.css += '#hidden{visibility:hidden}';
}
// "concealed colour alpha-zero/alpha-decimal/alpha-percent/own-white".
// Author syntax -> browser serialization extensions: hex, named and hsl.
for (const [name, value, reason] of [
  ['hex', '#ffffff', 'same_color'], ['named', 'white', 'same_color'],
  ['hsl', 'hsl(0 0% 100%)', 'same_color'],
  ['alpha-zero', 'rgba(1,2,3,0)', 'transparent_text'],
  ['alpha-decimal', 'rgba(1,2,3,0.0)', 'transparent_text'],
  ['alpha-percent', 'rgb(1 2 3 / 0%)', 'transparent_text'],
  ['oklch', 'oklch(1 0 0)', null], ['display-p3', 'color(display-p3 1 1 1)', null],
]) {
  const c = add('C', name, `color:${value};background:white`, reason);
  c.support = ['color', value];
  c.allowUnsupported = ['oklch', 'display-p3'].includes(name);
  if (c.allowUnsupported) c.coverageLimit = `${name === 'oklch' ? 'OKLCH' : 'Display P3'} computed colours are not parsed; white-on-white can remain`;
}
// "concealed opacity durations: <label>" and provisional opacity policy.
// Real vs undefined keyframes are browser-only extensions. Paused at time zero;
// both endpoints are zero so capture never depends on frame scheduling.
for (const [name, rule, pending] of [
  ['opacity', 'transition:opacity .6s', true],
  ['all', 'transition:all .3s', true],
  ['animation', 'animation:reveal .6s paused', true],
  ['undefined-animation', 'animation:undefinedReveal .6s paused', true],
  ['none', '', false], ['all-zero', 'transition:all 0s', false],
  ['transform', 'transition:transform .3s', false],
  ['all-then-opacity', 'transition:all 1s,opacity 0s', false],
  ['opacity-then-all', 'transition:opacity 0s,all 1s', true],
  ['duplicate-last-zero', 'transition:opacity 1s,opacity 0s', false],
  ['repeated-duration', 'transition-property:transform,opacity;transition-duration:20ms', true],
  ['excess-duration', 'transition-property:opacity;transition-duration:0s,1s', false],
]) {
  const c = add('D', name, `opacity:0;${rule}`, pending ? null : 'opacity_zero', { provisional: true });
  c.expected.pending = pending;
  if (name === 'animation') c.css += '@keyframes reveal{from{opacity:0}to{opacity:0}}';
}
// "concealed colour no-opaque"; named alpha 0.01 limit in Unreleased.
add('E', 'unknown-canvas', 'color:white', null, { knownLimit: true });
add('E', 'alpha-small', 'color:rgba(0,0,0,.01)', null, { knownLimit: true });
// Exact span-form table: "concealed source whitespace A/B <reason> <label> span".
const rows = [['space', ' ', true], ['trailing', 'Secret ', true], ['leading', ' Secret', true], ['both', ' Secret ', true], ['none', 'Secret', false], ['internal', 'Sec ret', false],
  ...['\t', '\n', '\u00a0'].flatMap((s, i) => [[`boundary-${i}-leading`, `${s}Secret`, true], [`boundary-${i}-trailing`, `Secret${s}`, true], [`boundary-${i}-only`, s, true]]),
  ['utf16', ' Secret\u{1f600} ', true], ['truncated-trailing', 'S'.repeat(2100) + ' ', true]];
for (const [kind, css, reason] of [['A', 'display:none', 'display_none'], ['B', 'visibility:hidden', 'visibility_hidden']]) {
  for (const [label, raw, boundary] of rows) {
    const c = add('F', `${kind}-${label}`, css);
    c.html = `<main>Hello<span class="target" id="target">${raw}</span>world</main>`;
    c.expected.entries = raw.trim() ? [entry(reason, raw)] : [];
    c.expected.sentinels = {};
    c.expected.firstLine = `Hello${kind === 'B' && boundary ? raw === '\u00a0' ? raw : ' ' : ''}world`;
  }
}
// "concealed ordering control: short stylesheet tab label content and counts"
// and "concealed exceptions display across full" (including long tab omission).
for (const long of [false, true]) {
  const c = add('G', long ? 'long-tab' : 'short-tab', 'display:none', long ? 'display_none' : null);
  const sentinel = Object.keys(c.expected.sentinels)[0];
  const text = long ? sentinel + ' Readable article content with enough detail to survive extraction.'.repeat(75) : sentinel;
  c.html = `<main><div role="tablist"><button role="tab" aria-controls="target">Hidden tab</button><button role="tab" aria-controls="other">Other tab</button></div><div role="tabpanel" class="target" id="target">${text}</div><div role="tabpanel" id="other">Other content</div></main>`;
  if (long) { c.expected.entries = [entry('display_none', text)]; c.expected.inactiveTabs = 1; }
}
// "concealed exceptions display across full": answer and pre exemptions.
for (const pre of [false, true]) {
  const c = add('G', pre ? 'hidden-pre' : 'collapsed-answer', 'display:none');
  const text = Object.keys(c.expected.sentinels)[0];
  c.html = `<main><button>Show answer</button><div class="target" id="target">${pre ? `<pre><code>${text}</code></pre>` : text + ' Readable answer content with enough detail to retain as a collapsed answer.'.repeat(18)}</div></main>`;
}
// "concealed spoof control: planted private mark retains text and zero counts".
const spoof = add('H', 'spoof', '');
spoof.html = spoof.html.replace('id="target"', 'id="target" data-page-markdown-concealed="display_none"');
// "concealed states, opt-out, partial failure and custom extractor marks".
const off = add('I', 'opt-out', 'opacity:0', null, { options: { detectConcealedText: false } });
off.expected.check = 'disabled';
const defaultOff = add('I', 'default-disabled', 'opacity:0', null, { options: {} });
defaultOff.expected.check = 'disabled';
// "concealed colour resolves external root, slots and shadow hosts".
const shadow = add('J', 'shadow-slot', 'color:white');
shadow.html = '<main><x-host id="host"><p id="target" class="target">SlotSecret601</p></x-host></main>';
shadow.css += 'main{background:white}';
shadow.shadow = '<style>:host{display:block}#inside{color:white}</style><slot id="slot"></slot><p id="inside">ShadowSecret602</p>';
shadow.expected.entries = [entry('same_color', 'SlotSecret601'), entry('same_color', 'ShadowSecret602')];
shadow.expected.sentinels = { SlotSecret601: false, ShadowSecret602: false };

export const requiredIds = cases.map(c => c.id);

// The exact expected entry text lives in this table and is checked by scoring;
// the report need not duplicate thousands of captured characters to describe it.
export function describeExpected(c) {
  return { entries: c.expected.entries.map(e => [e.reason, e.chars]),
    retained: Object.values(c.expected.sentinels),
    ...(c.expected.check !== 'computed' ? { check: c.expected.check } : {}),
    ...(c.expected.pending ? { pending: true } : {}),
    ...(c.expected.firstLine !== undefined ? { firstLine: c.expected.firstLine } : {}),
    ...(c.expected.inactiveTabs !== undefined ? { inactiveTabs: c.expected.inactiveTabs } : {}) };
}
