# Performance at scale

The theme targets sites with 100k+ pages. This records what was actually
measured, on what, and which design decisions the numbers justify.

**Headline: the build scales fine to 100k. Pagefind does not.** Past roughly
25k notes, move to the Bluge backend — that is what the swappable search
interface exists for.

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

Median of three trials, measured through the UI (submit → results count
updated), after a warm-up query.

| query | matches | Pagefind | Bluge |
|---|---|---|---|
| first query on a fresh page load | — | **21,432 ms** | n/a |
| free text, ~600 matches | 605 | 70 ms | 3 ms |
| free text, ~2.3k matches | 2,288 | 248 ms | 6 ms |
| free text, ~4.5k matches | 4,518 | 754 ms | 13 ms |
| free text, ~20k matches | 20,624 | ~19,600 ms | 42 ms |
| `tag:` filter | 3,455 | **8,483 ms** | 33 ms |
| `category:` filter | 7,258 | **9,717 ms** | 44 ms |
| page 1,000 of a filtered set | 7,258 | — | 72 ms |

### What this means

**Resolving the current page is free; building the match list is not.** A
breakdown confirmed the adapter's lazy slicing works as intended — fetching data
for the 6 visible results costs 4–9 ms regardless of how many matched. The cost
is entirely inside `pagefind.search()`, which materialises a stub per match.
Paging is flat; broadening the query is not.

**Pagefind's filter path is the worst case, and it is the path this design
leans on hardest.** The theme routes every over-limit category and tag to
`category:`/`tag:` queries, so at 100k notes the primary navigation costs 8–10
seconds. Free text at a comparable match count costs under a second, so this is
specific to filters rather than to result volume.

**Cold start is 21 seconds** on a 451 MB index — the first query on a fresh page
load pays for the bundle and index entry chunk.

**Bluge is 200–300× faster on filters and stays flat**, including at page 1,000
of a large result set, because paging happens server-side.

## Recommendation

| corpus | backend |
|---|---|
| up to ~25k notes | Pagefind — static, no server, no infrastructure |
| beyond ~25k notes | Bluge — see `search-server/README.md` |

The 10k tier is comfortable on Pagefind. 100k is not. The crossover was not
measured precisely; ~25k is an interpolation and worth checking against your own
content before committing.

If you want to stay on Pagefind at larger sizes, the lever is index size:
indexing titles, summaries and taxonomy rather than full note bodies would
shrink it substantially, at the cost of full-text search. The theme does not
currently expose that as an option.

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
