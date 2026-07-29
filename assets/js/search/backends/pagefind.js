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
  await pagefind.options({ excerptLength: 30 });
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

  // A null term with filters is Pagefind's "everything matching these filters".
  var term = parsed.text ? parsed.text : null;

  // With no text there is no relevance to rank by, so order newest-first —
  // matching how Hugo lists a term's pages, which lets a server-rendered first
  // page and a searched second page belong to the same sequence.
  var request = { filters: filters };
  if (!term) request.sort = { date: 'desc' };

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
