export function treeState(doc) {
  const shadows = [];
  function walk(root) {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) {
      shadows.push(el.shadowRoot.innerHTML); walk(el.shadowRoot);
    }
  }
  walk(doc);
  return JSON.stringify([doc.documentElement.outerHTML, shadows]);
}

export function observeResult(c, result, sourceUnchanged) {
  const omission = result.omissions.find(o => o.kind === 'concealed_text');
  return { concealmentCheck: result.concealmentCheck, concealedText: result.concealedText,
    ...(result.concealedTextTruncated ? { truncated: true } : {}), sourceUnchanged,
    omittedCount: omission?.count || 0, omittedChars: omission?.chars || 0,
    ...(c.expected.inactiveTabs !== undefined ? { inactiveTabs: result.omissions.find(o => o.kind === 'inactive_tabs')?.count || 0 } : {}),
    sentinels: Object.fromEntries(Object.keys(c.expected.sentinels).map(text => [text,
      ['markdown', 'fullPageMarkdown'].map(key => result[key].includes(text))])),
    notice: ['markdown', 'fullPageMarkdown'].map(key => result[key].includes('Concealed text omitted:')),
    noticeText: omission?.note || '', pending: result.warnings.some(w => w.includes('Pending opacity content retained')),
    ...(c.provisional ? { pendingCount: Number(result.warnings.join(' ').match(/Pending opacity content retained in (\d+) element/)?.[1] || 0) } : {}),
    ...(c.expected.firstLine !== undefined ? { firstLine: ['markdown', 'fullPageMarkdown'].map(key => result[key].split('\n')[0]) } : {}) };
}
