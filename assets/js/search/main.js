/* Search controller: owns the URL, the backend adapter, and rendering.

   It knows nothing about how results are found — it parses the query, hands the
   parsed shape to whichever adapter the config names, and renders the fixed
   result shape that comes back. */

import { parseQuery } from './query.js';
import { windowPages } from './paging.js';
import * as pagefind from './backends/pagefind.js';
import * as bluge from './backends/bluge.js';

var BACKENDS = { pagefind: pagefind, bluge: bluge };

var root = document.querySelector('[data-ledger-search]');
if (root) init(root);

function init(root) {
  var configEl = root.querySelector('[data-ledger-search-config]');
  var config = JSON.parse(configEl.textContent);

  var backend = BACKENDS[config.backend] || pagefind;
  var form = root.querySelector('[data-ledger-search-form]');
  var input = root.querySelector('[data-ledger-search-input]');
  var resultsEl = root.querySelector('[data-ledger-search-results]');
  var pagerEl = root.querySelector('[data-ledger-search-pagination]');
  var metaEl = root.querySelector('[data-ledger-search-meta]');
  var countEl = root.querySelector('[data-ledger-result-count]');
  var pageEl = root.querySelector('[data-ledger-result-page]');
  var emptyEl = root.querySelector('[data-ledger-search-empty]');
  var emptyTitle = emptyEl.querySelector('.ledger-empty-title');

  // On an over-limit term archive the query belongs to the page, not the URL,
  // so it is never written back into the query string.
  var pinned = root.getAttribute('data-pinned') === 'true';
  var pinnedQuery = root.getAttribute('data-initial-query') || '';

  // The server already rendered page 1 (and the count that goes with it), so
  // the backend is not consulted until the visitor asks for something else.
  var prerendered = root.getAttribute('data-prerendered') === 'true';
  var prerenderedTotal = parseInt(root.getAttribute('data-total'), 10) || 0;

  var token = 0;   // guards against out-of-order responses

  function currentQuery() {
    if (pinned) return pinnedQuery;
    return new URLSearchParams(location.search).get('q') || '';
  }

  function currentPage() {
    return parseInt(new URLSearchParams(location.search).get('page'), 10) || 1;
  }

  function writeURL(query, page, replace) {
    var params = new URLSearchParams(location.search);
    if (!pinned) {
      if (query) params.set('q', query); else params.delete('q');
    }
    if (page > 1) params.set('page', String(page)); else params.delete('page');
    var qs = params.toString();
    var url = location.pathname + (qs ? '?' + qs : '');
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
  }

  async function run(query, page, opts) {
    opts = opts || {};
    var mine = ++token;

    if (!opts.skipURL) writeURL(query, page, !!opts.replace);
    if (input && input.value !== query) input.value = query;

    var parsed = parseQuery(query, config.allNotesLabel);

    var response;
    try {
      await backend.init(config);
      response = await backend.search(parsed, { page: page, perPage: config.perPage });
    } catch (error) {
      if (mine !== token) return;
      renderError(error);
      return;
    }
    if (mine !== token) return;   // a newer query already answered

    render(query, response);
  }

  function render(query, response) {
    metaEl.hidden = false;
    countEl.textContent = response.total.toLocaleString() +
      (response.total === 1 ? ' result' : ' results') +
      (query ? ' for ' + query : '');
    pageEl.textContent = response.pages > 1
      ? 'Page ' + response.page + ' of ' + response.pages.toLocaleString()
      : '';

    resultsEl.textContent = '';
    pagerEl.textContent = '';

    if (!response.total) {
      emptyTitle.textContent = query
        ? 'No notes match “' + query + '”'
        : 'No notes match that query';
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    var frag = document.createDocumentFragment();
    response.results.forEach(function (r) { frag.appendChild(card(r)); });
    resultsEl.appendChild(frag);

    if (response.pages > 1) pagerEl.appendChild(pager(query, response));
  }

  function renderError(error) {
    metaEl.hidden = false;
    countEl.textContent = 'Search is unavailable';
    pageEl.textContent = '';
    resultsEl.textContent = '';
    pagerEl.textContent = '';
    emptyEl.hidden = true;
    if (window.console) {
      console.error('[ledger] search failed:', error);
      console.info('[ledger] `hugo server` does not build a Pagefind index. ' +
        'Run `npm run preview` (hugo build + pagefind + static serve) to exercise search.');
    }
  }

  /* Mirrors _partials/result-card.html. textContent throughout — titles,
     summaries and tags are author content, never markup. */
  function card(r) {
    var a = el('a', 'ledger-card');
    a.href = r.url;
    a.setAttribute('data-card', '');

    a.appendChild(text(el('h2', 'ledger-card-title'), r.title));
    if (r.summary) a.appendChild(text(el('p', 'ledger-card-summary'), r.summary));

    var meta = el('div', 'ledger-card-meta');
    if (r.category) meta.appendChild(text(el('span', 'ledger-chip-category'), r.category));
    (r.tags || []).slice(0, 4).forEach(function (t) {
      meta.appendChild(text(el('span', 'ledger-chip-tag'), '#' + t));
    });

    var spacer = el('span', 'ledger-spacer');
    spacer.style.minWidth = '8px';
    meta.appendChild(spacer);

    var bits = [];
    if (r.date) bits.push(r.date);
    if (r.readingTime) bits.push(r.readingTime + ' min');
    meta.appendChild(text(el('span', 'ledger-card-date'), bits.join(' · ')));

    a.appendChild(meta);
    return a;
  }

  function pager(query, response) {
    var nav = el('nav', 'ledger-pagination');
    nav.setAttribute('aria-label', 'Pagination');

    nav.appendChild(step('‹ Prev', response.page - 1, response.page <= 1, query));

    windowPages(response.page, response.pages).forEach(function (n) {
      if (n === null) {
        var gap = text(el('span', 'ledger-page-gap'), '…');
        gap.setAttribute('aria-hidden', 'true');
        nav.appendChild(gap);
        return;
      }
      var b = text(el('button', 'ledger-page-number'), String(n));
      b.type = 'button';
      if (n === response.page) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', function () { run(query, n); scrollTop(); });
      nav.appendChild(b);
    });

    nav.appendChild(step('Next ›', response.page + 1, response.page >= response.pages, query));
    return nav;
  }

  function step(label, target, disabled, query) {
    if (disabled) {
      var span = text(el('span', 'ledger-page-step'), label);
      span.setAttribute('aria-disabled', 'true');
      return span;
    }
    var b = text(el('button', 'ledger-page-step'), label);
    b.type = 'button';
    b.addEventListener('click', function () { run(query, target); scrollTop(); });
    return b;
  }

  function scrollTop() {
    var main = document.getElementById('ledger-main');
    if (main) main.scrollTo({ top: 0, behavior: 'auto' });
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    node.className = className;
    return node;
  }

  function text(node, value) {
    node.textContent = value;
    return node;
  }

  /* Build the pager for the server-rendered first page without searching for
     it. Everything else — clicking a page, editing the query — goes through the
     normal path, so this is only ever a first-paint shortcut. */
  function adoptPrerendered(query) {
    var pages = Math.max(1, Math.ceil(prerenderedTotal / config.perPage));
    if (pages > 1) {
      pagerEl.appendChild(pager(query, {
        page: 1, pages: pages, total: prerenderedTotal, results: []
      }));
    }
  }

  form.addEventListener('submit', function (event) {
    // On a pinned term archive the query belongs to that URL, so editing it is
    // a request to leave: let the form navigate to /search/ natively.
    if (pinned) return;
    event.preventDefault();
    run(input.value.trim(), 1);   // a new query always resets to page 1
  });

  window.addEventListener('popstate', function () {
    run(currentQuery(), currentPage(), { skipURL: true });
  });

  if (prerendered && currentPage() === 1) {
    adoptPrerendered(currentQuery());
  } else {
    run(currentQuery(), currentPage(), { replace: true });
  }
}
