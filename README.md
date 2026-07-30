# Ledger

A Hugo theme for a personal knowledge base. One shell on every page: a top nav,
a resizable sidebar of paginated categories and tags, and a content panel.
Search is the primary way in — taxonomy terms above a configurable size stop
behaving like lists and start behaving like queries.

Built to stay fast on large sites. Measured at 10k, 100k and 500,000 notes;
see [PERFORMANCE.md](PERFORMANCE.md).

- Three themes — light, dark, high contrast — applied before first paint
- Pagefind search rendered **in the page**, not in a popup
- Swappable search backend: Pagefind (static), Bluge (server), or auto
- Resizable, collapsible sidebar with independent pagination per panel
- No images, no icon fonts, no JavaScript dependencies

## Requirements

| | |
|---|---|
| Hugo | **0.146+ extended** (uses the current template layout). Tested on 0.164.0 |
| Node | only for Pagefind, via `npx` |
| Go | only if you use the Bluge backend |

## Install

As a Hugo module:

```bash
hugo mod init github.com/you/your-site
```

```toml
# hugo.toml
[module]
  [[module.imports]]
    path = "github.com/renesugar/hugo-theme-ledger"
```

Or as a submodule:

```bash
git submodule add https://github.com/renesugar/hugo-theme-ledger themes/hugo-theme-ledger
```

```toml
theme = "hugo-theme-ledger"
```

## Minimum configuration

Two things are not optional:

```toml
# Terms are used verbatim in search queries (tag:sourdough), so they must not
# be title-cased for display.
capitalizeListTitles = false

[taxonomies]
  category = "categories"
  tag = "tags"
```

The theme treats pages in `mainSections` as notes; everything else (an About
page, the search page) is excluded from counts and from the search index. Hugo
infers `mainSections` from your largest section, or set it explicitly:

```toml
[params]
  mainSections = ["notes"]
```

## Content

```yaml
---
title: "Sourdough starter maintenance"
date: 2026-06-14
summary: "A starter is a schedule, not a recipe."
categories: ["Recipes"]      # one; the first is used
tags: ["sourdough", "baking"]
readingTime: 7               # optional; falls back to Hugo's .ReadingTime
image: "cover.svg"           # optional hero: bundle resource, path, or URL
imageAlt: "..."              # optional
ledgerHideTitle: false       # optional; see below
ledgerHideMeta: false        # optional
---
```

`summary` is the standfirst under the title. It is not generated: a note without
one shows no standfirst, because Hugo's automatic summary is the first words of
the body, which on a post page sit directly below it. Result cards do fall back
to it, where an excerpt is useful.

Without `image`, the post shows the design's striped placeholder — that is the
intended fallback, not a missing asset. Turn it off site-wide with
`params.post.heroPlaceholder = false`, which a generated archive of short notes
wants: a placeholder on 100k pages is noise rather than design.

`ledgerHideTitle` and `ledgerHideMeta` are for notes imported from a source that
already carries its own heading and timestamp in the body — a Twitter/X archive,
say — which would otherwise show both twice. `ledgerHideTitle` keeps the `h1` in
the document outline for assistive technology and takes it off the screen;
`ledgerHideMeta` drops the category/date row. They are per-note, because a vault
usually holds a mix.

Two standalone pages opt into their own layouts:

```yaml
# content/about.md           # content/search.md
layout: "about"              layout: "search"
url: "/about/"               url: "/search/"
```

## Configuration

All under `[params]`. Every value shown is the default.

```toml
[params]
  defaultTheme = "light"        # light | dark | contrast
  siteBlurb = ""                # footer counts line; generated when empty
  googleFonts = true            # false to self-host Manrope / IBM Plex Mono

  # Above this many notes, a category or tag stops rendering a browsable
  # archive and starts behaving as a search query. The single most important
  # number in the theme.
  taxonomyPageLimit = 25

  [params.pagination]           # every surface sized independently
    home = 6
    term = 6
    search = 6
    tagsGrid = 18               # server-rendered, so no mobile variant
    sidebarCategories = 7
    sidebarCategoriesMobile = 6
    sidebarTags = 9
    sidebarTagsMobile = 8

  [params.sidebar]
    width = 282                 # visitor's drag is persisted
    minWidth = 190
    maxWidth = 460
    order = "count"             # count | alpha
    allNotesLabel = "All notes" # synthetic first category; "" removes it
    maxTerms = 200              # cap on terms in the shared sidebar asset

  [params.post]
    heroPlaceholder = true      # striped stand-in when a note has no `image`

  [params.search]
    backend = "pagefind"        # pagefind | bluge | auto | orama | flexsearch
    flexsearchStorage = "memory"    # flexsearch only: memory | indexeddb
    bundlePath = "/pagefind/pagefind.js"
    endpoint = "/api/search"        # bluge only
    healthEndpoint = "/api/health"  # auto only

  [params.scale]
    maxHomePagerPages = 500     # cap on generated /page/N/ directories
    maxSectionPagerPages = 500  # same cap for /notes/ and other sections

  [params.footer]
    rss = true
    sourceURL = ""

  [params.taxonomy]
    categoryPlural = "categories"
    tagPlural = "tags"
```

### `taxonomyPageLimit`

Below it, a term gets a normal archive with real `/page/N/` URLs. Above it, the
archive renders its first page from Hugo and hands further pages to search, and
sidebar rows and tag-grid cells for that term link straight to
`/search/?q=category:Name`. Over-limit rows are marked `⌕`.

This is what keeps builds bounded: without it, one term holding 200k notes would
generate tens of thousands of pager directories.

### `maxHomePagerPages` and `maxSectionPagerPages`

The home view lists every note. At 500k notes and 6 per page that is 83,000
generated directories, so the list is truncated to this many pages and the rest
are reachable through search. A section page (`/notes/`) can hold the whole
corpus too, and is capped the same way. Raise either if your site is small and
you want the whole archive crawlable; set it to `0` to remove the cap.

## Search

### Pagefind (default)

Pagefind indexes the **built HTML**, so it runs after Hugo:

```bash
hugo
npx pagefind --site public
```

`hugo server` does not build an index, so search will not work under it. Use:

```bash
npm run preview      # hugo + pagefind + static serve
```

### Query grammar

One grammar, parsed once in `assets/js/search/query.js` and handed to whichever
backend is configured:

| query | meaning |
|---|---|
| `category:Recipes` | exact category match |
| `tag:sourdough` | exact tag match; repeat it to require several |
| `category:"Field notes"` | a value containing a space must be quoted |
| `category:All notes` | everything (matches `sidebar.allNotesLabel`) |
| `"pinch of salt"` | exact phrase |
| `since:2026-06-01` | on or after that date |
| `until:2026-07-01` | strictly before it, so one day is `since:D until:D+1` |
| an empty query | everything, exactly as `category:All notes` |
| anything else | free text over title, summary and body |

Clauses are ANDed, and anything that does not fit the grammar — `foo:bar`,
`since:yesterday`, a URL — is searched as text.

**Every query returns results newest first**, not only the filter-only ones —
an archive is read by date, and ranking would leave the most recent note at an
unpredictable position. `category:All notes` is discarded by the parser, so it
and an empty query are the same request. The search page issues nothing until a
query is submitted; on a Pagefind site that arrival used to be its single most
expensive request.

**Not every backend implements all of it.** Pagefind has filters and phrases but
no date range, so a `since:`/`until:` query there returns the unbounded set and
the results view says which clauses were ignored. Bluge implements the whole
grammar.

Values with spaces have to be quoted, so the theme generates every clause it
puts in a link through `layouts/_partials/search-clause.html`, which quotes only
when needed. If you generate a query yourself, use that partial.

### Bluge (for large or search-led sites)

Pagefind is static and needs no server, but its filter queries get slow on big
corpora. See [PERFORMANCE.md](PERFORMANCE.md) for numbers and
[search-server/README.md](search-server/README.md) for the swap, which is a
config change plus running the included Go server:

```toml
[params.search]
  backend = "bluge"
  endpoint = "/api/search"
```

Any service answering that JSON contract can replace it; the query grammar is
parsed client-side and is never re-implemented in a backend.

## Which backend?

At 100k notes, opening a category or tag is instant on either — the first page
of every archive is server-rendered and issues no query at all. The difference
shows up in search itself:

| | Pagefind | Bluge |
|---|---|---|
| infrastructure | none | a running process |
| free-text search | fine when selective | 3–13 ms |
| `category:` / `tag:` query | seconds, occasionally a minute cold | ~40 ms |
| deep paging | slow | flat |

Up to ~25k notes, Pagefind is comfortable. Past that, stay on Pagefind if people
mostly browse, and move to Bluge if they mostly search.

### `orama`

`backend = "orama"` searches an [Orama](https://docs.orama.com/) index held in
memory in the browser. Build it after Hugo, from the same JSONL the Bluge backend
uses:

```bash
hugo   # with the ledgersearch output enabled — see search-server/README.md
node scripts/build-orama-index.js \
  --source public/search-source.jsonl --out public/orama
```

Queries are very fast — tens of milliseconds, including filters that take Pagefind
seconds — and it answers `since:`/`until:`, which Pagefind cannot. It has no
phrase operator, so quoted phrases are reported unsupported.

**Use it only on small sites.** The whole index is downloaded before the first
result: 33 MB titles-and-summaries, or 223 MB with bodies, for 25,000 notes. At a
few thousand notes that is a few megabytes and a fine trade; at 25,000 it is
disqualifying, and [PERFORMANCE.md](PERFORMANCE.md) has the measurements. Add
`--fields summary` to index titles and summaries only, at the cost of most
free-text matches.

### `flexsearch`

`backend = "flexsearch"` searches a [FlexSearch](https://github.com/nextapps-de/flexsearch)
index in the browser, built after Hugo from the same JSONL:

```bash
node scripts/build-flexsearch-index.js \
  --source public/search-source.jsonl --out public/flexsearch
```

`flexsearchStorage = "indexeddb"` keeps the index in IndexedDB instead of memory:
repeat visits download nothing and the JS heap stays under 20 MB, at the cost of
slower queries and no improvement to time-to-first-result.

**Also a small-site option, and it covers less of the grammar than the others.**
FlexSearch has no count API, no numeric range filter and no phrase operator, so the
adapter materialises whole match sets, applies date bounds after searching (reported
as approximate), intersects repeated tags itself, and reports phrases unsupported.
At 25,000 notes its index is 74 MB without bodies or 343 MB with them; see
[PERFORMANCE.md](PERFORMANCE.md).

### `auto`

`backend = "auto"` picks Bluge when a server answers `/api/health` and Pagefind
when nothing does. It is for one build that has to work both ways — a generated
archive published as static files *and* served locally by the Go server — and it
needs both indexes present.

The probe runs once per page load, with a 1.5 s timeout, and the answer is
cached; a site that is always one or the other should name that backend and skip
the probe. If the server stops answering mid-session, the first failing query
falls back to Pagefind for the rest of the session, and nothing re-probes.

## Development

```bash
npm run dev              # hugo server (no search index)
npm run build            # hugo
npm run preview          # hugo + pagefind + serve — use this for search
npm run build:indexed    # hugo + pagefind, no server
```

The example site under `exampleSite/` doubles as the test fixture: it is sized
so that both the over- and under-limit taxonomy states, the sidebar mini-pager,
and every hero-image source are exercised on an ordinary build.

### Benchmarking

```bash
scripts/bench.sh 10000 100000     # appends to bench/out/results.tsv
                                  # 500000 takes ~2¼ hours and ~21 GB
```

`scripts/gen-corpus.js` writes a synthetic corpus with Zipf-distributed words
and tags; `scripts/query-latency.js` is a console snippet for measuring query
latency on a built, indexed site.

## Accessibility

`aria-current` on the active nav item and current page, `aria-expanded` on the
theme menu and panel toggles, a `role="separator"` split bar with arrow-key
resizing, focus trapped in the mobile drawer, an `aria-live` results count, a
visible skip link, and a focus ring on every interactive element.

Every text-bearing element clears WCAG AA (4.5:1) in all three themes, verified
by sweeping the rendered DOM rather than by inspecting the palette. This
required raising `--faint` and darkening `--accent` slightly from the values in
the original design; hue and chroma are unchanged. See [PLAN.md](PLAN.md) for
the before/after numbers.

## Credits

Design: the "Ledger" handoff. Fonts: [Manrope](https://manropefont.com) and
[IBM Plex Mono](https://www.ibm.com/plex/), loaded from Google Fonts unless
`googleFonts = false`. Search: [Pagefind](https://pagefind.app) and
[Bluge](https://github.com/blugelabs/bluge).

## License

Apache 2.0 — see [LICENSE](LICENSE).
