/* Orama backend — the same adapter contract as pagefind.js and bluge.js.
 *
 * Orama is an in-memory engine: the whole index is fetched, deserialized, and
 * held in the browser. That is the opposite of Pagefind's design, where only the
 * chunks a query touches are fetched, and it is the reason this adapter exists —
 * to measure whether trading bytes-up-front for fast queries pays off on a large
 * archive. See PERFORMANCE.md for the answer.
 *
 * Build the index with scripts/build-orama-index.js, which reads the same JSONL
 * the Bluge backend indexes, so results differ only by engine.
 *
 * Config:
 *   indexPath   defaults to <siteRoot>orama/index.json
 *
 * Grammar coverage: categories, repeated tags (ANDed), free text, and date
 * bounds. Phrases are reported unsupported — Orama has no phrase operator, and
 * silently dropping the quotes would return every note containing the words
 * separately.
 */

var db = null;
var loading = null;
var orama = null;

export async function init(config) {
  if (db) return;
  loading = loading || load(config);
  await loading;
}

async function load(config) {
  var base = config.siteRoot || '/';
  var indexPath = config.oramaIndexPath || (base + 'orama/index.json');

  /* The library comes from its own bundle, at a URL the template supplies, so
     the import specifier is a runtime value that esbuild cannot follow. A static
     import here would inline Orama into the shared search bundle — 8.9 KB to
     88.2 KB, paid by every site including the ones using Pagefind.

     It exports Orama's own load(), not @orama/plugin-data-persistence: the
     plugin's entry point pulls in Node's `stream` for its persistToFile half,
     which a browser bundle cannot resolve. load() accepts exactly what the
     plugin's `persist` writes, so the file format is unchanged. */
  var runtimeURL = config.oramaRuntime;
  if (!runtimeURL) throw new Error('params.search.backend is "orama" but no runtime URL was built');
  orama = await import(/* webpackIgnore: true */ runtimeURL);

  var response = await fetch(indexPath, { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('orama index ' + indexPath + ' returned ' + response.status);
  }
  // The schema comes from meta.json, not from the payload: a persisted Orama
  // database does not carry its schema, and guessing it would silently mis-type
  // fields whenever the index was built with a different --fields setting.
  var metaPath = config.oramaMetaPath || (base + 'orama/meta.json');
  var meta = await fetch(metaPath, { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) throw new Error('orama meta ' + metaPath + ' returned ' + r.status);
    return r.json();
  });

  var serialized = await response.json();
  db = orama.create({ schema: meta.schema });
  orama.load(db, serialized);
}

export async function search(parsed, opts) {
  var page = Math.max(1, opts.page || 1);
  var perPage = Math.max(1, opts.perPage || 6);

  var where = {};
  // enum with { eq }: a bare equality filter on an enum field is rejected.
  if (parsed.categories.length) where.category = { eq: parsed.categories[0] };
  // enum[] with containsAll: repeated tag clauses are ANDed, which is what the
  // grammar means by repeating one.
  if (parsed.tags.length) where.tags = { containsAll: parsed.tags };

  // Dates are indexed as YYYYMMDD numbers because Orama has no date type.
  // `until` is exclusive in the grammar, so the range stops a day earlier.
  if (parsed.since || parsed.until) {
    var lower = parsed.since ? Number(parsed.since.replace(/-/g, '')) : 0;
    var upper = parsed.until ? Number(parsed.until.replace(/-/g, '')) - 1 : 99999999;
    where.date = { between: [lower, upper] };
  }

  var unsupported = [];
  if (parsed.phrases.length) unsupported.push('"quoted phrases"');

  var request = {
    term: parsed.terms.join(' '),
    limit: perPage,
    offset: (page - 1) * perPage,
  };
  if (Object.keys(where).length) request.where = where;
  // With nothing to rank by, newest-first — the order Hugo lists a term's pages
  // in, so a server-rendered first page and a searched second page are slices of
  // one sequence.
  if (!request.term) request.sortBy = { property: 'date', order: 'DESC' };

  var response = await orama.search(db, request);
  var total = response.count || 0;
  var pages = Math.max(1, Math.ceil(total / perPage));

  return {
    total: total,
    page: Math.min(page, pages),
    pages: pages,
    results: (response.hits || []).map(function (hit) {
      var d = hit.document || {};
      return {
        title: d.title || d.id,
        summary: d.summary || '',
        url: d.id,
        category: d.category || '',
        tags: (d.tags || []).filter(function (t) { return t !== '(none)'; }),
        date: formatDate(d.date),
        readingTime: ''
      };
    }),
    unsupported: unsupported
  };
}

function formatDate(number) {
  var text = String(number || '');
  if (text.length !== 8) return '';
  return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
}
