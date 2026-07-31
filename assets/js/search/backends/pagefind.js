/* Pagefind backend.

   Implements the adapter contract (decision D4 in PLAN.md):
     init(config)                      -> Promise<void>
     search(parsed, {page, perPage})   -> Promise<{total, page, pages, results,
                                                   unsupported}>

   Pagefind covers most of the grammar: `category:`/`tag:` become filters, and
   quoted phrases are passed through because Pagefind reads quotes as an exact
   phrase itself. It has no date filter, so `since:`/`until:` are reported in
   `unsupported` — a Pagefind-hosted site tells the visitor those bounds were
   dropped rather than silently returning the unbounded set.

   Pagefind returns the full ranked id list up front and loads each result's
   data lazily. Only the current page's slice is resolved here, so the expensive
   part — fetching and decompressing per-page metadata — is proportional to
   perPage, not to the result count.

   The ranked list itself is not free: Pagefind materialises one stub per match,
   so a query matching most of the corpus costs proportionally more than a
   selective one. Paging through results is flat; broadening the query is not.
   See PERFORMANCE.md for the measured curve. */

var pagefind = null;

export async function init(config) {
  if (pagefind) return;
  // Bundled at deploy time by the `pagefind` CLI, so the path is not
  // resolvable at build time; the import specifier stays a runtime value.
  var path = config.bundlePath || '/pagefind/pagefind.js';
  pagefind = await import(/* webpackIgnore: true */ path);
  // baseUrl, or every result URL misses the site's subpath: Pagefind records
  // them relative to the directory it indexed, which is the built site's root and
  // not necessarily the domain's. A project site published at /repo/ would link
  // every result to /notes/… and 404.
  await pagefind.options({ excerptLength: 30, baseUrl: config.siteRoot || '/' });
}

export async function search(parsed, opts) {
  var page = Math.max(1, opts.page || 1);
  var perPage = Math.max(1, opts.perPage || 6);

  var filters = {};
  // One value is passed bare; several use Pagefind's `all` operator, because
  // the grammar ANDs repeated clauses and an array alone would mean "any of".
  if (parsed.categories.length) filters.category = filterValue(parsed.categories);
  if (parsed.tags.length) filters.tag = filterValue(parsed.tags);

  var unsupported = [];
  if (parsed.since) unsupported.push('since:');
  if (parsed.until) unsupported.push('until:');

  /* `OR`, negation and grouping.

     Pagefind's filters do support compound logic — `not`, `any`, `all` — but
     its text search takes one term string and strips punctuation, so `-term`
     reads as `term`. A query mixing operators with free text therefore cannot
     be expressed as one Pagefind call, and running several and merging them
     client-side is what this backend exists to avoid: at 25k notes a filter
     query already materialises one stub per match.

     So it says what it dropped rather than answering a different question, the
     same contract `since:`/`until:` use. The Bluge backend answers these in
     full. */
  (parsed.operators || []).forEach(function (operator) {
    unsupported.push(operator === '-' ? 'negation (-)' : operator);
  });

  // A null term with filters is Pagefind's "everything matching these filters".
  var term = parsed.text ? parsed.text : null;

  /* Newest first, always — not only when there is no term to rank by.
     An archive is read chronologically: results in relevance order put the most
     recent note at an unpredictable position, and deep in a long result set the
     visitor would have to page to the end to find it.

     It also makes the ordering invariant unconditional. `term.html`
     server-renders page 1 of an over-limit archive in Hugo's date order and the
     backend serves page 2; with relevance ranking on some queries those were
     slices of different sequences. Notes carry `data-pagefind-sort="date"` for
     exactly this. */
  var request = { filters: filters, sort: { date: 'desc' } };

  var response = await pagefind.search(term, request);

  var all = response.results || [];
  var total = all.length;
  var pages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(page, pages);

  var start = (page - 1) * perPage;
  var slice = all.slice(start, start + perPage);
  var data = await Promise.all(slice.map(function (r) { return r.data(); }));

  return {
    total: total,
    page: page,
    pages: pages,
    results: data.map(toResult),
    unsupported: unsupported
  };
}

function filterValue(values) {
  return values.length === 1 ? values[0] : { all: values };
}

function toResult(d) {
  var meta = d.meta || {};
  var tags = meta.tags ? String(meta.tags).split(',').filter(Boolean) : [];
  return {
    title: meta.title || d.url,
    summary: meta.summary || stripTags(d.excerpt || ''),
    url: d.url,
    category: meta.category || '',
    tags: tags,
    date: meta.date || '',
    readingTime: meta.reading || ''
  };
}

function stripTags(html) {
  var el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || '';
}
