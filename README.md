# Ledger

A Hugo theme for a personal knowledge base. One shell on every page: a top nav,
a resizable sidebar of paginated categories and tags, and a content panel.
Search is the primary way in — taxonomy terms above a configurable size stop
behaving like lists and start behaving like queries.

Built to stay fast on large sites. Measured at 100,000 notes; see
[PERFORMANCE.md](PERFORMANCE.md).

- Three themes — light, dark, high contrast — applied before first paint
- Pagefind search rendered **in the page**, not in a popup
- Swappable search backend: Pagefind (static) or Bluge (server)
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
---
```

Without `image`, the post shows the design's striped placeholder — that is the
intended fallback, not a missing asset.

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

  [params.search]
    backend = "pagefind"        # pagefind | bluge
    bundlePath = "/pagefind/pagefind.js"
    endpoint = "/api/search"    # bluge only

  [params.scale]
    maxHomePagerPages = 500     # cap on generated /page/N/ directories

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

### `maxHomePagerPages`

The home view lists every note. At 500k notes and 6 per page that is 83,000
generated directories, so the list is truncated to this many pages and the rest
are reachable through search. Raise it if your site is small and you want the
whole archive crawlable.

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

Query grammar:

| query | meaning |
|---|---|
| `category:Recipes` | exact category match; names may contain spaces |
| `tag:sourdough` | exact tag match |
| `category:All notes` | everything (matches `sidebar.allNotesLabel`) |
| anything else | free text over title, summary and body |

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
