# Performance at scale

The theme targets sites with 100k+ pages. This records what was actually
measured, on what, and which design decisions the numbers justify.

**Headline: the build scales fine to 100k. Pagefind's filter queries do not —
but the paths visitors actually take no longer use them.** Opening a category or
tag is server-rendered and instant at any size. Deep paging and hand-typed
`category:`/`tag:` queries stay slow, so a search-led site past ~25k notes wants
the Bluge backend — which is what the swappable search interface exists for.

## Method

```bash
scripts/bench.sh 10000 100000
```

`scripts/gen-corpus.js` writes a synthetic corpus; `scripts/bench.sh` builds it,
runs Pagefind over the output, and appends a row to `bench/out/results.tsv`.
Query latency is measured separately with `scripts/query-latency.js`, pasted
into the console of the built site's `/search/` page.

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
| 100,000 | 349.7 s | 3.6 GB | 3.7 GB | 118,256 | 22 KB | 20 KB |

Build time grew 14.8× for 10× the notes — roughly O(n^1.17). Mildly
superlinear, and nothing like the O(n²) signature of a per-page partial
filtering `site.RegularPages`. Peak RSS grew only 5.3×.

Extrapolating the same exponent, 500k notes is around 30 minutes and 12 GB.
That tier has not been run.

## Indexing

| notes | Pagefind time | Pagefind index | Bluge time | Bluge index |
|---|---|---|---|---|
| 10,000 | 56 s | 47 MB | — | — |
| 100,000 | 605 s | 451 MB | 116 s | 111 MB |

Pagefind indexing is ~5× slower than Bluge and produces a ~4× larger index on
this corpus.

One caveat on index size: the synthetic notes are ~180 words drawn randomly
from a large vocabulary, with almost no phrase repetition between documents.
That is close to worst case for an inverted index. Real prose repeats itself
and should compress better, so 451 MB per 100k notes is a pessimistic figure.

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

| corpus | backend |
|---|---|
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

**Generated page count must stay bounded.** At 100k notes:

- home generated exactly **500** pager pages — the `maxHomePagerPages` cap.
  Uncapped that would have been 16,667.
- over-limit tags emit `index.html` and **no `page/` directory** — decision D2
  keeping a 3,455-note term from paginating
- under-limit tags do get pagers, so the split is working in both directions
