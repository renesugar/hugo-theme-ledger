/* Query-latency probe.
 *
 * Paste into the browser console on the theme's /search/ page of a built,
 * indexed site. Reports milliseconds from submit until the results count
 * updates, alongside how many notes each query matched — latency only means
 * something next to selectivity.
 *
 *   await ledgerQueryLatency();
 *   await ledgerQueryLatency(['tag:babreck', 'cedroft']);
 *
 * Kept as a console snippet rather than a test runner so measuring needs no
 * dependency beyond a browser and a served site.
 */
window.ledgerQueryLatency = async function (queries) {
  const input = document.querySelector('[data-ledger-search-input]');
  const form = document.querySelector('[data-ledger-search-form]');
  const countEl = document.querySelector('[data-ledger-result-count]');
  if (!input || !form || !countEl) throw new Error('not on a Ledger search view');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function once(q, budgetMs = 120000) {
    countEl.textContent = '';
    input.value = q;
    const started = performance.now();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const deadline = started + budgetMs;
    while (!countEl.textContent.trim()) {
      if (performance.now() > deadline) return { query: q, ms: null, note: 'timed out' };
      await wait(10);
    }
    const text = countEl.textContent.trim();
    const matches = parseInt((text.match(/^[\d,]+/) || ['0'])[0].replace(/,/g, ''), 10);
    return { query: q, ms: Math.round(performance.now() - started), matches };
  }

  const list = queries && queries.length ? queries : [
    'category:Recipes', 'category:All notes',
  ];

  // One untimed pass first: the first query pays for loading the Pagefind
  // bundle and its entry chunk, which is a page-load cost, not a query cost.
  await once(list[0]);

  const rows = [];
  for (const q of list) rows.push(await once(q));

  // Paging is measured separately: it should not depend on match count.
  const pager = document.querySelectorAll('.ledger-page-number');
  if (pager.length > 1) {
    const last = pager[pager.length - 1];
    const started = performance.now();
    last.click();
    while (!document.querySelectorAll('.ledger-card').length) await wait(10);
    rows.push({ query: '(jump to last page)', ms: Math.round(performance.now() - started), matches: null });
  }

  console.table(rows);
  return rows;
};
