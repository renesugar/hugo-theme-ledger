/* Bluge backend — the same adapter contract as pagefind.js, over HTTP.

   Swapping search engines is a one-line config change (params.search.backend)
   because the grammar is parsed before this point and the return shape is
   fixed. Anything that speaks the contract below can be dropped in beside
   these two files.

   Expected endpoint response:

     GET {endpoint}?q=<text>&category=<name>&tag=<name>&page=<n>&per=<n>

     {
       "total":   1234,
       "results": [
         { "title": "...", "summary": "...", "url": "/notes/x/",
           "category": "Recipes", "tags": ["sourdough"],
           "date": "2026-06-14", "readingTime": 7 }
       ]
     }

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
  if (parsed.text) params.set('q', parsed.text);
  if (parsed.field === 'category') params.set('category', parsed.value);
  else if (parsed.field === 'tag') params.set('tag', parsed.value);
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
    })
  };
}
