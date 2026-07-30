# Performance at scale

The theme targets sites with 100k+ pages. This records what was actually
measured, on what, and which design decisions the numbers justify.

**Headline: the build scales to 500k, though not cheaply — 80 minutes and
13 GB. Pagefind's filter queries do not — but the paths visitors actually take no
longer use them.** Opening a category or tag is server-rendered and instant at any
size, and paging is flat. Hand-typed `category:`/`tag:` queries are the exception,
and they are worse than "slow": at 200,000 notes the first one downloads **103 MB
over 2,200 requests**, and a warm query matching a quarter of the corpus takes
**132 seconds**. A search-led site past ~25k notes wants the Bluge backend, which
answers the same filter in 44 ms — which is what the swappable search interface
exists for.

## Method

```bash
scripts/bench.sh 10000 25000 100000 200000 500000
```

`scripts/gen-corpus.js` writes a synthetic corpus; `scripts/bench.sh` builds it,
runs Pagefind over the output, and appends a row to `bench/out/results.tsv`.
Query latency is measured separately with `scripts/query-latency.js`, pasted
into the console of the built site's `/search/` page.

**Bytes are counted at the server, not in the browser.**
`scripts/serve-counting.js` is a static file server that tallies what it serves,
because Pagefind fetches its index from a SharedWorker and a worker's requests
never appear in the page's Resource Timing entries. An in-page byte count reports
zero for Pagefind while correctly counting a backend that fetches from the page —
which would flatter Pagefind in exactly the comparison this harness exists to
make. Reset with `/__bytes?reset=1`, drive the page, read `/__bytes`.

The corpus shape is deliberate:

- **Words are Zipf-sampled from an 8,000-word vocabulary**, so term selectivity
  spans what real prose has — a handful of words in nearly every note, a long
  tail in a fraction of a percent. An early version drew from 35 words, which
  made every free-text query match the whole corpus and produced meaningless
  (and pathologically slow) search timings.
- **Tags are Zipf-distributed too, and tag count grows with the corpus** (100 at
  10k, 1,000 at 100k). A flat distribution would put every term on the same side
  of `taxonomyPageLimit` and never exercise the over/under-limit split the whole
  design turns on. The large tier also pushes past `sidebar.maxTerms` (200).

### Machine

| | |
|---|---|
| CPU | 8 cores |
| RAM | 62 GB |
| Disk | NVMe SSD |
| Hugo | 0.164.0 extended · Pagefind 1.5.2 · Node 26.3.0 · Go 1.26.5 |

Absolute times are machine-specific; the scaling between tiers is what
transfers.

## Build

| notes | build | peak RSS | public | HTML files | home page | note page |
|---|---|---|---|---|---|---|
| 10,000 | 23.7 s | 668 MB | 384 MB | 12,294 | 23 KB | 20 KB |
| 25,000 | 58.3 s | 1.3 GB | 838 MB | 26,285 | 23 KB | 20 KB |
| 100,000 | 304.7 s | 3.7 GB | 3.7 GB | 118,256 | 22 KB | 20 KB |
| 200,000 | 631.0 s | 6.2 GB | 6.5 GB | 203,224 | 23 KB | 20 KB |
| 500,000 | **4,819.5 s** (80 min) | **13.2 GB** | 18.0 GB | 589,904 | 23 KB | 20 KB |

The 25k and 200k rows were measured with `maxSectionPagerPages` in place, and
they show what it is worth: 200,000 notes produce **203,224** HTML files, where
the uncapped 500k build produced 589,904 for 500,000 — about 1.18 files per note
against 1.02. Both pager caps bind at both tiers (500 each), and 200k carries
2,001 tag terms.

200k → 500k is 2.5× the notes for 7.6× the build time. Between 25k and 200k the
exponent is milder: 8× the notes for 10.8× the time, ~1.18.

**The 10k, 100k and 500k rows predate `maxSectionPagerPages`.** Without that cap
`/notes/` paginates the whole corpus, so those builds also emitted a pager
directory per six notes — about 83,000 of them at 500k, unnoticed at the time.
Rows measured after the cap (25k and 200k) do not, which makes them cheaper than
a straight comparison with the older rows suggests. The `home_pagers`,
`section_pagers` and `term_dirs` columns in `bench/out/results.tsv` exist so this
is visible rather than inferred.

**Build time is superlinear, and the exponent worsens with size.** 10k → 100k
grew 12.8×, an exponent of ~1.11. 100k → 500k grew 15.8× for 5× the notes — an
exponent of ~1.72. An earlier revision of this file extrapolated the first
exponent and predicted ~30 minutes for 500k; the real figure is 80. Do not
extrapolate past a tier you have measured.

This is still not the O(n²) signature of a per-page partial filtering
`site.RegularPages` — that would have been ~25× — but it does mean a 500k build
is a coffee break, not a pause. Corpus generation alone took another 3 minutes.

Everything else scales cleanly:

| | 100k → 500k | exponent |
|---|---|---|
| peak RSS | 3.6× | 0.80 (sublinear) |
| Pagefind index time | 5.4× | 1.04 (linear) |
| output size | 5.0× | 1.00 (linear) |
| HTML files | 5.0× | 1.00 (linear) |

## Indexing

| notes | Pagefind time | Pagefind index | Bluge time | Bluge index |
|---|---|---|---|---|
| 10,000 | 56 s | 47 MB | — | — |
| 25,000 | 141 s | 114 MB | — | — |
| 100,000 | 547 s | 452 MB | 116 s | 111 MB |
| 200,000 | 1,086 s (18 min) | 901 MB | — | — |
| 500,000 | 2,938 s (49 min) | 2.2 GB | — | — |

Pagefind indexing is ~5× slower than Bluge and produces a ~4× larger index on
this corpus.

**The Bluge figures above predate phrase search.** They were measured with an
index carrying no term positions on `title`, `summary` or `body`. Supporting
`"quoted phrase"` requires positions, which makes the index larger — the 111 MB
at 100k is a floor, not the current size, and anything that depends on it (a
deployment target with a bundle-size cap, for instance) needs re-measuring.

One caveat on index size: the synthetic notes are ~180 words drawn randomly
from a large vocabulary, with almost no phrase repetition between documents.
That is close to worst case for an inverted index. Real prose repeats itself
and should compress better, so 451 MB per 100k notes is a pessimistic figure.

## Where Pagefind's bytes go — 25k and 200k

This is the measurement the byte-counting server was added for, and it is the
sharpest result in this file. Every row is one **cold page load** followed by one
query, with nothing cached:

| cold load | matches | Pagefind bytes | requests |
|---|---|---|---|
| `?q=baridck` — free text | 2,327 | **369 KB** | 17 |
| `?q=tag:baridck` — filter | 39 | **13,637 KB** | 443 |
| `/search/` — no query (matchAll, date-sorted) | 25,000 | 13,497 KB | many |

**A filtered query costs 37× the bytes of a free-text one, and it does not depend
on how selective the filter is.** Thirty-nine matches cost the same 13.6 MB as
twenty-five thousand.

**The cause is the null search term, not the filter.** An earlier revision of this
section blamed the filter index; that was wrong, and these four cold page loads say
why — each one is a fresh page with nothing cached:

| cold load | term | matches | Pagefind bytes | requests |
|---|---|---|---|---|
| `/search/` — no query at all | null | 25,000 | 13,503 KB | 442 |
| `?q=category:Recipes` | null | 1,787 | 13,559 KB | 443 |
| `?q=tag:baridck` | null | 39 | 13,637 KB | 443 |
| `?q=category:Recipes baridck` | **"baridck"** | 175 | **425 KB** | **18** |
| `?q=baridck` | **"baridck"** | 2,327 | **369 KB** | **17** |

A `matchAll` with no filter at all costs the same 13 MB as a tag filter, and
driving Pagefind's API directly with `search(null, {})` — no filters, no sort —
still costs 13,154 KB over 426 requests. Meanwhile *adding a text term to the very
same filter* takes it from 13,559 KB to 425 KB.

So: `pagefind.search(null, …)` means "everything, then filter", and Pagefind pays
for it by touching ~440 chunks. `pagefind.search("word", …)` starts from a term
posting list and touches ~18. The sort makes no difference either way.

That is the same wall hypothesis 4 below hit from the other side, where warming
the filters explicitly took 106 seconds.

Once loaded, queries are cheap. Warm, on the same page:

| query | matches | latency | bytes |
|---|---|---|---|
| `category:"All notes"` | 25,000 | 7,398 ms | 6 KB |
| `tag:babreck` | 8,924 | 6,006 ms | 139 KB |
| `tag:baclack` | 497 | 223 ms | 5 KB |
| `tag:baridck` | 39 | 76 ms | 6 KB |
| `baridck` — free text | 2,327 | 1,348 ms | 6 KB |
| jump to the last page | 25,000 | 2 ms | 0 KB |

So Pagefind's shape at 25k is: **a large fixed cost to filter at all, a small
marginal cost per query afterwards, and flat paging.** Peak JS heap stayed
between 6 and 31 MB throughout — an index on disk, fetched in fragments, is not
an index in memory.

Two things follow for the theme:

- The design already avoids the expensive path for the navigation people actually
  use: an over-limit term archive is server-rendered and issues no query at all
  (hypothesis 1 below). What remains expensive is a *hand-typed* filter query.
- **Visiting `/search/` with no query is the most expensive request the site can
  make**: an empty query is a null-term matchAll, so it costs 13.5 MB and 442
  requests at 25k. `category:"All notes"` is byte-for-byte the same query — the
  grammar defines that label as meaning everything, so it parses to exactly the
  same shape as an empty box.

  A per-category default in the same style — Joplin's model, where an empty query
  lists the current notebook — would cost the same, because `category:X` with no
  term is also a null-term query (13,559 KB measured). Selectivity does not help.
  The theme already renders that view for free: `/categories/x/` is server-rendered
  by `term.html` and issues no search request at all. The fix for the search page's
  resting state is therefore not a cheaper query but no query.

### The same measurement at 200,000 notes

| cold load | matches | Pagefind bytes | requests | time |
|---|---|---|---|---|
| `?q=badrond` — free text | 2,782 | **1,759 KB** | 18 | ~1 s |
| `?q=tag:badrond` — filter | 33 | **105,811 KB** | **2,200** | **55.9 s** |

**A hand-typed `tag:` query on a 200k-note site downloads 103 MB over 2,200
requests and takes almost a minute.** That is the filter index again, and it
scales with the number of tag values rather than with the query: 250 tags cost
13.6 MB and 443 requests, 2,000 tags cost 103 MB and 2,200 requests — about
52 KB and 1.1 requests per tag value, at both tiers.

Free text scales far better than the corpus: 369 KB at 25k to 1,759 KB at 200k,
4.8× for 8× the notes.

Warm, with the filter index already cached, bytes stop mattering and match count
takes over completely:

| warm query at 200k | matches | latency | bytes |
|---|---|---|---|
| `tag:baclack tag:badrock` | 27 | 227 ms | 5 KB |
| `tag:baclack` | 2,962 | 8.0 s | 6 KB |
| `badrond` — free text | 2,782 | 11.6 s | 6 KB |
| `tag:babreck` | 54,854 | **132.5 s** | 6 KB |

Two minutes and twelve seconds, for six kilobytes. That is `pagefind.search()`
materialising one stub per match — the mechanism identified at 100k, now visible
in the large: latency is a function of how many notes match, not of how much data
crosses the wire. A query that matches a quarter of a 200k corpus is not a query
anyone will wait for.

So Pagefind's shape has two independent limits, and it is worth being precise
about which one bites:

| cost | scales with | at 200k |
|---|---|---|
| cold bytes for a **null-term** query (filter-only or matchAll) | corpus size | 103 MB, 2,200 requests |
| warm latency | number of matches | 132 s for 54,854 matches |
| warm bytes | nothing much | 5–6 KB |
| paging | nothing | 2 ms |

The theme's design keeps both off the path a browsing visitor takes: an
over-limit archive is server-rendered and issues no query at all, and its pager
is flat. What remains expensive is a hand-typed broad or filtered query, which is
exactly what the Bluge backend exists for — it answered the equivalent filter in
44 ms at 100k.

These are also the numbers any candidate backend has to be judged against, and
they are why bytes and heap are measured at all. A backend that restores a whole
serialized index into memory has to beat 369 KB at 25k — which nothing that works
that way can.

## Query latency at 100k notes

Measured through the UI (submit → results count updated) and, for the
breakdowns, directly against the Pagefind API.

**These numbers vary a lot between runs, and that is itself a finding.** The
same filtered query was observed at 3.0 s, 6.1 s and 13.1 s warm, and at 53.7 s
and 91.6 s cold. Treat them as order-of-magnitude.

| query | matches | Pagefind | Bluge |
|---|---|---|---|
| first query on a fresh page load (text) | — | ~21,000 ms | n/a |
| **first _filtered_ query, cold** | 7,258 | **53,700–91,600 ms** | 44 ms |
| filtered query, warm | 7,258 | 3,000–13,100 ms | 44 ms |
| free text, ~600 matches | 605 | 70 ms | 3 ms |
| free text, ~2.3k matches | 2,288 | 248 ms | 6 ms |
| free text, ~4.5k matches | 4,518 | 754–4,700 ms | 13 ms |
| free text, ~20k matches | 20,624 | ~19,600 ms | 42 ms |
| page 1,000 of a filtered set | 7,258 | — | 72 ms |

An earlier revision of this file reported filtered queries at 8.5–9.7 s. That
was measured in a partially warm state and understated the cold case; the range
above supersedes it.

### What this means

**Resolving the current page is free; building the match list is not.** Fetching
data for the 6 visible results costs 4–9 ms regardless of how many matched. The
cost is entirely inside `pagefind.search()`, which materialises a stub per
match. Paging is flat; broadening the query is not.

**Bluge is 100–1000× faster on filters and stays flat**, including at page 1,000
of a large result set, because paging happens server-side.

## Orama — refuted at 25k

`@orama/orama` 3.1.18, measured on the same 25,000-note corpus as the Pagefind
baseline above, indexed from the same JSONL so the documents are identical and
only the engine differs. Adapter in `assets/js/search/backends/orama.js`, index
built by `scripts/build-orama-index.js`.

Orama is an in-memory engine: the whole index is fetched, deserialized and held
in the browser. The question was whether paying bytes up front buys enough query
speed to be worth it.

| | Pagefind | Orama, full text | Orama, titles+summaries |
|---|---|---|---|
| index on disk | 114 MB | 223 MB | 33 MB |
| **bytes before the first result** | **0.37 MB** free text, 13.6 MB filtered | **223 MB** | **33.4 MB** |
| time to first result, cold | ~1 s free text, 6.3 s filtered | **18.9 s** | **11.2 s** |
| JS heap after loading | 6–31 MB | 364 MB | 82 MB |
| warm, 497 matches | 223 ms | 102 ms | 19 ms |
| warm, 8,924 matches | 6,006 ms | — | **35 ms** |
| free text finds | title, summary, body | title, summary, body | **title and summary only** |

**Orama's queries are magnificent and its loading is disqualifying.** Warm, it
answers a filter over 8,924 of 25,000 notes in 35 ms where Pagefind takes 6
seconds — 170× faster. But every visitor pays 33–223 MB and 11–19 seconds before
the first result, against Pagefind's 369 KB and about a second.

Against the promotion rule fixed before any of this was measured:

| criterion | result |
|---|---|
| cold time to first result no worse than Pagefind | ❌ 11.2–18.9 s vs ~1 s |
| first-result download within ~1.5× Pagefind's | ❌ 90× (summary) to 600× (full) |
| warm filter query under 500 ms | ✅ 19–102 ms |
| peak heap under ~500 MB | ✅ 82 MB / 364 MB — but on a desktop with a 4 GB heap |

Two of four fail, and they are the two the rule exists for. **Not promoted.**

Things that were tried before concluding that, so they are not retried:

- **Dropping body text from the index** is Orama's only real lever, and it works
  as arithmetic: 223 MB → 33 MB. But it changes what search means. The free-text
  query `baridck` returns 2,327 notes with bodies indexed and **214** without —
  91% of the matches are gone. That is the same trade Pagefind hypothesis 5
  rejected, for the same reason.
- **A more compact serialization.** `persist(db, 'binary')` produced a *larger*
  payload than JSON on this data, and `'dpack'` throws
  `"length" is outside of buffer bounds` in 3.1.18. JSON is the best format
  available.
- **Keeping the library out of the shared bundle.** A static
  `import '@orama/orama'` in the adapter made esbuild inline it, taking the search
  bundle from **8.9 KB to 88.2 KB for every site** — including Pagefind sites that
  never call Orama. It is built as its own asset and imported from a runtime URL,
  the way `pagefind.js` loads the Pagefind bundle, and only when a site selects
  the backend. The bundle is 10.6 KB with the adapter registered.

### 100k and 200k were not measured

Deliberately. The index is linear in corpus size, so 200k projects to **~1.8 GB**
full-text or ~267 MB summary-only, and the Node builder needed 1.8 GB of RSS for
25k — about 14 GB at 200k. A browser cannot download 1.8 GB to answer a query, and
the 25k result already fails the promotion rule by two orders of magnitude on the
criterion that scales *against* Orama. Measuring the larger tiers would cost about
an hour and could not change the decision.

That projection is arithmetic, not measurement, and is labelled as such. What was
measured is the 25k row above.

### What Orama would be good for

Not nothing: a site of a few thousand notes, where a 3–8 MB index is an
acceptable one-time cost, would get sub-30 ms queries — including the date bounds
Pagefind cannot express at all. The two engines have complementary gaps: Pagefind
does phrases natively but not `since:`/`until:`, Orama does date ranges but has no
phrase operator, so the adapter reports quoted phrases as unsupported.

The adapter is left in the theme, registered and documented, for that case. It is
not a candidate for a 100k-note archive, which is what this theme is for.

## FlexSearch — refuted at 25k, in both configurations

FlexSearch 0.8.212, same 25,000-note corpus, same JSONL. Adapter in
`assets/js/search/backends/flexsearch.js`, index built by
`scripts/build-flexsearch-index.js`. Two configurations were measured, because the
persistent one was the only shape in this comparison that could plausibly avoid
loading everything.

### Index size

| index | 25k notes | chunks |
|---|---|---|
| title + body | **342.7 MB** | 5 (the body map alone is 319 MB) |
| title + summary | **74.4 MB** | 5 |
| *Pagefind, for comparison* | 114 MB on disk, **0.37 MB fetched** | — |

FlexSearch's full-text index is larger than Orama's 223 MB and three times
Pagefind's. Everything below uses the 74.4 MB summary-only index — the smaller,
more favourable case.

### `flexsearchStorage = "memory"` — fetch and import

| | |
|---|---|
| bytes before first result | **74.5 MB** |
| time to first result, cold | **13.1 s** |
| JS heap after loading | 133 MB |
| warm, 8,924 matches | 109 ms |
| warm, 214 matches | 46 ms |
| warm, 7 matches | 17 ms |

### `flexsearchStorage = "indexeddb"` — mount and persist

| | first visit | second visit |
|---|---|---|
| bytes served | **74.5 MB** | **136 KB** (0 from the index) |
| time to first result | **24.3 s** | **14.8 s** |
| JS heap | 4 MB | 16 MB |
| IndexedDB usage | 40 MB | 40 MB |
| warm, 8,924 matches | — | 1,313 ms |
| warm, 214 matches | — | 138 ms |
| warm, 7 matches | — | 383 ms |

**The persistent configuration does exactly what it promises, and it is still not
enough.** Repeat visits download nothing, and the JS heap drops to 4–16 MB — the
lowest of any backend measured, Pagefind included. But:

- The **first** visit still transfers the whole index. A browser cannot be shipped
  a prepopulated IndexedDB, so the data has to arrive over the wire once whatever
  the storage.
- **Time to first result does not improve.** 14.8 s on a repeat visit, because
  reading 40 MB back out of IndexedDB is not free. Pagefind answers in about a
  second, every visit, with no local storage at all.
- **Queries get slower, not faster**: 1,313 ms for the query the in-memory
  configuration answered in 109 ms, because every query now goes through
  IndexedDB.

So the trade is: 74 MB once, then 15 s per page load and about a second per broad
query — against Pagefind's 369 KB and ~1 s on every visit with nothing stored.

### Against the promotion rule

| criterion | memory | indexeddb |
|---|---|---|
| cold time to first result ≤ Pagefind | ❌ 13.1 s | ❌ 24.3 s, then 14.8 s |
| first-result download within ~1.5× | ❌ 200× (930× full-text) | ❌ same |
| warm filter query < 500 ms | ✅ 17–109 ms | ❌ 1,313 ms broad |
| peak heap < ~500 MB | ✅ 133 MB | ✅ **4–16 MB** |

**Not promoted**, in either configuration.

### Grammar gaps, and what they cost

FlexSearch needed more adapter work than Orama, and still covers less:

- **No count API.** It returns results, not totals, so the adapter materialises the
  whole match set (`limit: 100000`) to know how many there are and to page. That is
  where the 1,313 ms goes on a broad query.
- **Repeated `tag:` clauses are ORed**, not ANDed; the adapter intersects them
  itself, from the stored documents.
- **No numeric range filter**, so `since:`/`until:` are applied after searching and
  reported as approximate. A date-only query returns nothing, because there is no
  term or tag to search on first.
- **No phrase operator.** Reported unsupported.

Compare Pagefind, which does phrases natively and needs none of that.

### Two implementation traps worth recording

- **Detecting an already-populated IndexedDB is not obvious, and getting it wrong
  silently costs everything.** The first attempt probed with an empty tag filter,
  which matches nothing whether or not the index is populated, so every visit
  re-imported the full 74.5 MB — the storage bought nothing while appearing to
  work. `db.has(id)` is not usable either: it throws on a store that has been
  mounted but not yet queried. What works is a tag search for a value the builder
  records in `meta.json` as known-present; a mounted index answers it from storage
  with no import at all.
- **The library must not be imported statically.** Same as Orama: a static import
  inlines it into the shared search bundle for every site. Both adapters load their
  runtime from a URL the template builds, and only when a site selects them. With
  both registered the shared bundle is 13.4 KB, against 8.9 KB with neither.

## Attempts to make Pagefind viable at this scale

Five hypotheses were tested against the 100k corpus. One worked.

### ✅ 1. Server-render the first page of an over-limit archive

Hugo already knows which notes carry a term, so the first page is rendered from
that instead of searched. `first N .Pages` is O(1) per term, so it stays inside
decision D2's bound.

**Result: the primary navigation no longer touches Pagefind at all.** Opening an
over-limit archive issues zero requests to `/pagefind/`. This is the single
biggest win available, and it works by not searching rather than by searching
faster.

It required making Pagefind's ordering match Hugo's, or page 1 and page 2 would
have been slices of different sequences. Notes carry `data-pagefind-sort="date"`
and filter-only queries request a date sort. That sort costs about 2× on the
queries that still happen (3.0 s → 5.9 s), which is a worthwhile trade now that
those queries are the exception rather than the common path.

### ❌ 2. Avoid the filter-only code path

The bundle branches on `filter_only = term === null`. Hypothesis: that branch is
the slow one.

| query | matches | median |
|---|---|---|
| filter only | 7,258 | 3,073 ms |
| filter + text term | 373 | 2,298 ms |
| text term alone | 4,518 | 4,671 ms |

**Refuted.** Cost tracks match count plus a fixed filter overhead, not the
branch. Adding a term helps only by narrowing the match set 12× — and even then
halves the time rather than eliminating it.

### ⚠️ 3. Worker-boundary serialisation

Results are marshalled out of a SharedWorker. **Not testable through the public
API**: `useWorker` is set from `workerAvailable`, and `options()` accepts only
`baseUrl`, `indexWeight`, `excerptLength`, `mergeFilter`, `highlightParam`,
`ranking`, `exactDiacritics` and `metaCacheTag`. Confirming it would mean
patching a vendored bundle, which is not a maintainable thing for a theme to
ship. Unresolved.

### ❌ 4. Warm the filter chunks with `pagefind.filters()`

**Refuted, emphatically.** `filters()` took **106 seconds** to load every filter
chunk across 1,000 tag values, and the first filtered query after it still took
31.8 s. Warming costs far more than it saves.

### ❌ 5. Shrink the index by not indexing note bodies

Reindexed the same built HTML with `--exclude-selectors ".ledger-prose"`.

| | full | bodies excluded |
|---|---|---|
| index size | 447 MB | 407 MB (−9%) |
| index time | 547 s | 318 s (−42%) |
| filtered query, cold | 53.7 s | 91.6 s |
| filtered query, warm | 5.9 s | 6.1 s |

**Refuted.** The index is dominated by per-page metadata, not body text — 100k
pages carry ~4 KB each regardless of content. Latency is unchanged, and the
price is losing full-text search entirely. Not worth exposing as an option.

## Recommendation

Hypothesis 1 changes the shape of this recommendation: it matters *which*
interaction you are doing, not just how large the site is.

| interaction | Pagefind at 100k |
|---|---|
| open an over-limit category or tag | **instant** — server-rendered, no query |
| read the first page of any archive | **instant** — same |
| free-text search, reasonably selective | 0.1–1 s, fine |
| free-text search matching a large share of the corpus | seconds |
| page past the first page of a large term | 3–13 s warm, up to 90 s cold |
| type `category:X` or `tag:X` by hand | same as above |

So the honest recommendation:

Two client-side engines were built and measured against this baseline and both
were rejected; see the Orama and FlexSearch sections above. The short version:
every in-browser index has to cross the wire at least once, and at 25,000 notes
that is 33–343 MB against Pagefind's 0.37 MB for a free-text query. FlexSearch over
IndexedDB removes the *repeat* download and drops the heap to 4–16 MB, but leaves
time-to-first-result at ~15 s and makes queries slower.

| corpus | backend |
|---|---|
| up to a few thousand notes | Pagefind, or Orama if `since:`/`until:` matter |
| up to ~25k notes | Pagefind — everything is comfortable |
| 25k–100k, browsing-led | Pagefind is usable, because the paths people actually take are server-rendered — but deep paging and hand-typed filter queries are slow |
| beyond ~25k with search-led use, or any size where filter queries must be fast | Bluge — see `search-server/README.md` |

The crossover was not measured precisely; ~25k is an interpolation from the 10k
and 100k tiers and is worth checking against your own content. The synthetic
corpus is close to worst case for index size (see the caveat above), so real
content may do better.

Attempts 2–5 above are recorded so they are not retried. The remaining
unexplored lever is upstream: Pagefind's per-match cost in `search()`, which a
theme cannot reach from outside.

## What the build numbers are checking

**Per-page HTML must not grow with the corpus.** The shell — header, sidebar,
footer — repeats on every page, so anything scaling with term count multiplies
by page count. A note page measured **20 KB at both tiers** while tag count went
100 → 1,000. Verified further at 100k:

- the sidebar is byte-identical between `/` and `/notes/note-99999/`
- 16 term rows inlined per page, regardless of the 1,000 tags that exist
- the shared terms asset is capped at 200 entries (22 KB)

**Generated page count must stay bounded.** Re-verified at **500k notes**, with
5,000 tags — 50× the tag count of the 10k tier:

- a note page is **20 KB**, the same as at 10k and 100k
- the sidebar is byte-identical between `/` and `/notes/note-499999/`
- 16 term rows inlined per page; the shared terms asset holds 200 entries
  (21.9 KB) regardless of the 5,000 tags that exist
- home generated exactly **500** pager pages — the `maxHomePagerPages` cap.
  Uncapped that would have been 83,333.
- **4,816 of 5,000 tags are over limit and emit no `page/` directory at all**;
  only the 184 under-limit tags paginate. That is decision D2 doing the single
  largest piece of work in the build — without it those 4,816 terms would each
  have paginated their whole membership.
