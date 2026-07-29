/* Bluge backend — the same adapter contract as pagefind.js, over HTTP.

   Swapping search engines is a one-line config change (params.search.backend)
   because the grammar is parsed before this point and the return shape is
   fixed. Anything that speaks the contract below can be dropped in beside
   these two files.

   Expected endpoint request and response:

     GET {endpoint}?q=<free text>
                   &phrase=<exact phrase>   (repeatable)
                   &category=<name>         (repeatable)
                   &tag=<name>              (repeatable)
                   &since=YYYY-MM-DD&until=YYYY-MM-DD
                   &page=<n>&per=<n>

     {
       "total":   1234,
       "page":    1,
       "per":     6,
       "results": [
         { "title": "...", "summary": "...", "url": "/notes/x/",
           "category": "Recipes", "tags": ["sourdough"],
           "date": "2026-06-14", "readingTime": 7 }
       ]
     }

   Repeated parameters are ANDed. The server never re-parses `category:` or
   `tag:` prefixes or quotes: the grammar is parsed once, client-side, in
   query.js, and arrives here already split into fields.

   `offset`/`limit` are accepted by the reference server as an alternative to
   `page`/`per`, for callers that are not this adapter.

   Paging is server-side here — the endpoint receives page/per and returns only
   that slice, so a large corpus never crosses the wire. See PLAN.md step 12 for
   the reference Go server built on blugelabs/bluge. */

var endpoint = '/api/search';

export async function init(config) {
  if (config.endpoint) endpoint = config.endpoint;
}

export async function search(parsed, opts) {
  var page = Math.max(1, opts.page || 1);
  var perPage = Math.max(1, opts.perPage || 6);

  var params = new URLSearchParams();
  // Free terms travel as one `q`; phrases travel separately so the server does
  // not have to know the quoting rules.
  if (parsed.terms.length) params.set('q', parsed.terms.join(' '));
  parsed.phrases.forEach(function (p) { params.append('phrase', p); });
  parsed.categories.forEach(function (c) { params.append('category', c); });
  parsed.tags.forEach(function (t) { params.append('tag', t); });
  if (parsed.since) params.set('since', parsed.since);
  if (parsed.until) params.set('until', parsed.until);
  params.set('page', String(page));
  params.set('per', String(perPage));

  var response = await fetch(endpoint + '?' + params.toString(), {
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  if (!response.ok) throw new Error('search backend returned ' + response.status);

  var body = await response.json();
  var total = body.total || 0;
  var pages = Math.max(1, Math.ceil(total / perPage));

  return {
    total: total,
    page: Math.min(page, pages),
    pages: pages,
    results: (body.results || []).map(function (r) {
      return {
        title: r.title || r.url,
        summary: r.summary || '',
        url: r.url,
        category: r.category || '',
        tags: r.tags || [],
        date: r.date || '',
        readingTime: r.readingTime || ''
      };
    }),
    unsupported: []
  };
}
