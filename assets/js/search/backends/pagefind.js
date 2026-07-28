/* Pagefind backend.

   Implements the adapter contract (decision D4 in PLAN.md):
     init(config)                      -> Promise<void>
     search(parsed, {page, perPage})   -> Promise<{total, page, pages, results}>

   Pagefind returns the full ranked id list up front but loads each result's
   data lazily. Only the current page's slice is resolved, so cost per query is
   proportional to perPage rather than to the size of the result set — which is
   what keeps a 500k-page site responsive. */

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
  if (parsed.field === 'category') filters.category = parsed.value;
  else if (parsed.field === 'tag') filters.tag = parsed.value;

  // A null term with filters is Pagefind's "everything matching these filters".
  var term = parsed.text ? parsed.text : null;
  var response = await pagefind.search(term, { filters: filters });

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
    results: data.map(toResult)
  };
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
