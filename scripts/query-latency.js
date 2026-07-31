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
 *
 * It also reports two things that matter more than warm latency when comparing
 * search backends:
 *
 *   kb     — bytes the query required. Pagefind's whole design is that this stays
 *            small, because only the chunks a query touches are fetched; an
 *            in-memory engine restoring a serialized index pays it all up front
 *            instead. Comparing backends on warm latency alone flatters whichever
 *            one already has the corpus in RAM.
 *   heapMB — JS heap after the query, when the browser exposes it. The other
 *            half of the same question: an index held in memory is memory the
 *            visitor's device has to have.
 *
 * Both are why `ledgerFirstResultCost()` exists: on a fresh page load it
 * measures what answering the *first* query costs, which is what a visitor
 * actually waits for.
 */
window.ledgerQueryLatency = async function (queries) {
  const input = document.querySelector('[data-ledger-search-input]');
  const form = document.querySelector('[data-ledger-search-form]');
  const countEl = document.querySelector('[data-ledger-result-count]');
  if (!input || !form || !countEl) throw new Error('not on a Ledger search view');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Bytes a query required, over every request rather than a guessed list of
     index paths: a backend may fetch from anywhere and the comparison has to
     count all of it.

     encodedBodySize, not transferSize: transferSize is 0 for a cache hit, so a
     second run of the same query would report zero bytes and flatter every
     backend equally. The question is how many bytes answering the query needs,
     not whether this particular browser already had them. */
  const bytesSoFar = () =>
    performance.getEntriesByType('resource')
      .reduce((total, entry) => total + (entry.encodedBodySize || entry.transferSize || 0), 0);

  const heapMB = () =>
    performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null;

  async function once(q, budgetMs = 120000) {
    countEl.textContent = '';
    const bytesBefore = bytesSoFar();
    input.value = q;
    const started = performance.now();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const deadline = started + budgetMs;
    while (!countEl.textContent.trim()) {
      if (performance.now() > deadline) return { query: q, ms: null, note: 'timed out' };
      await wait(10);
    }
    const ms = Math.round(performance.now() - started);
    // Resource timings land slightly after the response is used.
    await wait(50);
    const text = countEl.textContent.trim();
    const matches = parseInt((text.match(/^[\d,]+/) || ['0'])[0].replace(/,/g, ''), 10);
    return {
      query: q,
      ms: ms,
      matches: matches,
      kb: Math.round((bytesSoFar() - bytesBefore) / 1024),
      heapMB: heapMB()
    };
  }

  const list = queries && queries.length ? queries : [
    'category:Recipes', 'category:"All notes"',
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

/* What the first query on a fresh page load costs.
 *
 * This is the measurement that decides between search backends, and the one the
 * warm table above cannot give: reload the page, run one query, and report the
 * time, the bytes and the heap. A backend that keeps the whole index in memory
 * looks excellent warm and can still be unusable here.
 *
 * Reload first, then:
 *
 *   await ledgerFirstResultCost('category:"All notes"');
 *
 * Quote a value containing a space: the grammar tokenises on whitespace, so
 * `category:All notes` is the category "All" plus the term "notes".
 */
window.ledgerFirstResultCost = async function (query) {
  const input = document.querySelector('[data-ledger-search-input]');
  const form = document.querySelector('[data-ledger-search-form]');
  const countEl = document.querySelector('[data-ledger-result-count]');
  if (!input || !form || !countEl) throw new Error('not on a Ledger search view');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const isSearchAsset = (name) =>
    /pagefind|orama|flexsearch|api\/search|api\/health|\.pf_|ledger-search/.test(name);

  // encodedBodySize for the same reason as above: cache-independent.
  const size = (e) => e.encodedBodySize || e.transferSize || 0;
  const bytesAll = () => performance.getEntriesByType('resource')
    .reduce((t, e) => t + size(e), 0);
  const bytesSearch = () => performance.getEntriesByType('resource')
    .filter((e) => isSearchAsset(e.name))
    .reduce((t, e) => t + size(e), 0);

  const beforeAll = bytesAll();
  const beforeSearch = bytesSearch();
  const heapBefore = performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;

  countEl.textContent = '';
  input.value = query || 'category:"All notes"';
  const started = performance.now();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  while (!countEl.textContent.trim()) {
    if (performance.now() - started > 300000) break;
    await wait(10);
  }
  const ms = Math.round(performance.now() - started);
  await wait(100);

  const result = {
    query: input.value,
    firstResultMs: ms,
    // Split out because a page's own assets are not the backend's cost.
    searchKB: Math.round((bytesSearch() - beforeSearch) / 1024),
    totalKB: Math.round((bytesAll() - beforeAll) / 1024),
    heapBeforeMB: heapBefore,
    heapAfterMB: performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    requests: performance.getEntriesByType('resource').filter((e) => isSearchAsset(e.name)).length,
    count: countEl.textContent.trim()
  };
  console.table([result]);
  return result;
};
