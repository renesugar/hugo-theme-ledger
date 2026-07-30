/* FlexSearch backend — the same adapter contract as the others.
 *
 * Two configurations, selected with `params.search.flexsearchStorage`:
 *
 *   "memory"    (default) fetch the exported index chunks and import them into
 *               an in-memory Document. Fast boot in FlexSearch's terms.
 *   "indexeddb" mount an IndexedDB-backed Document. On a first visit the chunks
 *               are still fetched and imported — a browser cannot be shipped a
 *               prepopulated IndexedDB — so what this buys is *later* visits,
 *               which read from local storage instead of the network.
 *
 * Build the index with scripts/build-flexsearch-index.js, from the same JSONL the
 * Bluge and Orama backends use.
 *
 * Grammar gaps, reported honestly in `unsupported` rather than silently dropped:
 *
 *   since:/until:  FlexSearch has no numeric range filter. Dates are in the
 *                  document store, so results are filtered after the fact, which
 *                  is correct but changes the count — so it is reported.
 *   "phrases"      no phrase operator.
 *
 * Repeated `tag:` clauses need intersecting: FlexSearch ORs several values within
 * one tag field, while the grammar ANDs them.
 */

var flex = null;
var index = null;
var loading = null;
var storage = 'memory';

export async function init(config) {
  if (index) return;
  loading = loading || load(config);
  await loading;
}

async function load(config) {
  var base = config.siteRoot || '/';
  var indexBase = config.flexsearchIndexPath || (base + 'flexsearch/');
  storage = config.flexsearchStorage || 'memory';

  var runtimeURL = config.flexsearchRuntime;
  if (!runtimeURL) {
    throw new Error('params.search.backend is "flexsearch" but no runtime URL was built');
  }
  // Own bundle, imported from a runtime URL, for the same reason as Orama: a
  // static import inlines the library into the shared search bundle for every
  // site.
  flex = await import(/* webpackIgnore: true */ runtimeURL);

  var meta = await fetch(indexBase + 'meta.json', { credentials: 'same-origin' })
    .then(function (r) {
      if (!r.ok) throw new Error('flexsearch meta returned ' + r.status);
      return r.json();
    });

  var options = {
    document: {
      id: 'id',
      index: meta.fields === 'all'
        ? [{ field: 'title', tokenize: 'forward' }, { field: 'body', tokenize: 'forward' }]
        : [{ field: 'title', tokenize: 'forward' }, { field: 'summary', tokenize: 'forward' }],
      tag: [{ field: 'category' }, { field: 'tags' }],
      store: ['title', 'summary', 'category', 'tags', 'date'],
    },
  };

  index = new flex.Document(options);

  if (storage === 'indexeddb') {
    // mount() is what makes the index live in IndexedDB. A second visit finds it
    // already populated; a first visit still has to import the chunks below.
    var db = new flex.IndexedDB('ledger-search');
    await index.mount(db);
    // Without this check the storage buys nothing: every visit re-downloads the
    // index it was supposed to have kept.
    if (await alreadyPopulated(index, meta)) return;
  }

  // One request per export key, in parallel: they are independent files.
  await Promise.all(meta.keys.map(async function (entry) {
    var response = await fetch(indexBase + entry.key + '.json', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('flexsearch chunk ' + entry.key + ' returned ' + response.status);
    var text = await response.text();
    await index.import(entry.key, text);
  }));

  if (storage === 'indexeddb' && index.commit) await index.commit();
}

/* A mounted index that already holds documents must not be re-imported, or every
   later visit pays the download the storage was supposed to avoid.

   The signal is a tag search for a value the builder recorded as present: a
   mounted IndexedDB answers it straight from storage, with no import. Two things
   that do not work — an empty tag filter matches nothing whether or not the index
   is populated, and `db.has()` throws on a store that has been mounted but not
   yet queried. */
async function alreadyPopulated(index, meta) {
  if (!meta.probeTag) return false;
  try {
    var probe = await index.search({
      query: '', tag: { tags: [meta.probeTag] }, limit: 1,
    });
    return !!(probe && probe.length && probe[0].result && probe[0].result.length);
  } catch (error) {
    return false;
  }
}

export async function search(parsed, opts) {
  var page = Math.max(1, opts.page || 1);
  var perPage = Math.max(1, opts.perPage || 6);

  var unsupported = [];
  if (parsed.phrases.length) unsupported.push('"quoted phrases"');
  if (parsed.since || parsed.until) unsupported.push('since:/until: (filtered after search, so counts are approximate)');

  var tag = {};
  if (parsed.categories.length) tag.category = [parsed.categories[0]];
  if (parsed.tags.length) tag.tags = parsed.tags;

  /* No count API: FlexSearch returns results, not totals, so the whole match set
     has to be materialised to know how many there are and to page through it.
     That is the cost of a client-side engine without a cursor — and the reason
     `total` here is honest but expensive. */
  var request = { limit: 100000, enrich: true };
  if (parsed.terms.length) request.query = parsed.terms.join(' ');
  else request.query = '';
  if (Object.keys(tag).length) request.tag = tag;

  var raw = await index.search(request);
  var merged = merge(raw);

  // Repeated tag clauses: FlexSearch ORs them within a field, the grammar ANDs.
  if (parsed.tags.length > 1) {
    merged = merged.filter(function (row) {
      var tags = (row.doc && row.doc.tags) || [];
      return parsed.tags.every(function (t) { return tags.indexOf(t) !== -1; });
    });
  }

  // Dates, after the fact, for the same reason.
  if (parsed.since || parsed.until) {
    var lower = parsed.since ? Number(parsed.since.replace(/-/g, '')) : 0;
    var upper = parsed.until ? Number(parsed.until.replace(/-/g, '')) : 99999999;
    merged = merged.filter(function (row) {
      var d = (row.doc && row.doc.date) || 0;
      return d >= lower && d < upper;
    });
  }

  // Newest first, always, matching Hugo's order and every other backend.
  merged.sort(function (a, b) {
    return ((b.doc && b.doc.date) || 0) - ((a.doc && a.doc.date) || 0);
  });

  var total = merged.length;
  var pages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(page, pages);
  var slice = merged.slice((page - 1) * perPage, page * perPage);

  return {
    total: total,
    page: page,
    pages: pages,
    results: slice.map(function (row) {
      var d = row.doc || {};
      return {
        title: d.title || row.id,
        summary: d.summary || '',
        url: row.id,
        category: d.category || '',
        tags: d.tags || [],
        date: formatDate(d.date),
        readingTime: ''
      };
    }),
    unsupported: unsupported
  };
}

/* FlexSearch returns one group per matching field, so a document matching both
   title and body appears twice. Merge on id, keeping first-seen order, which is
   FlexSearch's relevance order within each field. */
function merge(raw) {
  var seen = Object.create(null);
  var out = [];
  (raw || []).forEach(function (group) {
    (group.result || []).forEach(function (hit) {
      var id = hit && hit.id !== undefined ? hit.id : hit;
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, doc: hit && hit.doc ? hit.doc : null });
    });
  });
  return out;
}

function formatDate(number) {
  var text = String(number || '');
  if (text.length !== 8) return '';
  return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
}
