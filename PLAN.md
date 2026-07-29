# Implementation plan — "Ledger" Hugo theme

Source of truth for design: `/home/renes/projects/design_handoff_hugo_ledger_theme/`
(`README.md` for specified values, `HugoShell.dc.html` for markup/measurements).
The prototype's `support.js` is a mockup runtime and is **not** ported.

## Working agreement

- One step per session. Each step leaves the repo in a building, committed state.
- `hugo --source exampleSite --themesDir ../..` must succeed at the end of every step.
- Commit after each step; the step number goes in the commit subject.

## Verification

Every step is exercised in a real browser before it is committed — not just
built and eyeballed in the markup. A step is not done until each branch of the
behaviour it adds has been driven and observed.

**The example site is the test fixture.** Where a feature has branches, the
corpus carries content that reaches each one, so a regression shows up on an
ordinary build instead of only in production:

| Fixture | Exercises |
|---|---|
| `taxonomyPageLimit = 6` with Recipes at 7 | over- and under-limit routing on every surface |
| "All notes" synthetic category | the `matchAll` rule in the query grammar |
| 18 tags against a 9/page sidebar | mini-pager windowing, ranges, mobile page size |
| 16 notes at 6/page | multi-page pagination, disabled ends |
| `proxmox-backup-rotation/` page bundle + `cover.svg` | hero image from a bundle resource |
| `zfs-scrub-schedule` + `/img/hero-sample.svg` | hero image from a site-relative path |
| every other note | the striped hero fallback |

Branches that cannot ship in the corpus — the absolute-URL hero, the home pager
ceiling, larger per-page sizes — are verified by temporarily changing config or
front matter, confirming the result, and reverting. Search must be verified
against `npm run preview`, since `hugo server` builds no Pagefind index.

---

## Architectural decisions

### D1 — Scale vs. server-rendered pagination

The handoff asks for real crawlable URLs on every pager page. At 500k notes and
`paginate = 6` the home view alone would emit ~83k pager pages, and Hugo would
spend most of a build writing them. Resolution:

| Surface | Set size | Pagination |
|---|---|---|
| Term archive (`/categories/x/`, `/tags/x/`) | bounded by `taxonomyPageLimit` (25) | fully server-rendered, real URLs |
| Tags grid (`/tags/`) | bounded by tag count | fully server-rendered, real URLs |
| Home (`/`, `/page/N/`) | unbounded | server-rendered up to `params.scale.maxHomePagerPages`, then a "refine with search" terminal card |
| Search (`/search/`) | unbounded | client-side, no pages generated |

### D2 — Over-limit taxonomy terms

A term whose count exceeds `taxonomyPageLimit` must not render a *server*-
paginated archive — that is the O(n) blowup the design avoids, and at 200k
notes in one term it would emit ~33k pager directories for that term alone.

Instead its term page renders the **search view with the query pre-filled**
(`category:Recipes`), so the URL returns real, paginated results rather than a
dead end telling the visitor to go and search. Paging there is client-side, so
exactly one page is generated per term no matter how many notes it holds.

Sidebar rows and tag-grid cells for over-limit terms continue to link to
`/search/?q=…`; both surfaces now show the same thing, so the routing is a
convenience rather than a difference in behaviour.

Under-limit terms keep the server-rendered archive with real `/page/N/` URLs,
which stays bounded by `taxonomyPageLimit`.

### D3 — No unbounded per-page queries

The sidebar is identical on every page. It is built once via `partialCached` with
a constant key, from a single pass over `site.Taxonomies` (which Hugo has already
indexed) — never from `where site.RegularPages`. No template may range over
`site.RegularPages` inside a per-page partial.

### D4 — Swappable search backend

`assets/js/search/` defines one adapter interface:

```js
init(config) -> Promise<void>
search(query, { page, perPage }) -> Promise<{ total, page, pages, results[] }>
```

`results[]` items are `{ title, summary, url, category, tags, date, readingTime }`.
`pagefind.js` implements it over the Pagefind bundle (using Pagefind filters for
`category:` / `tag:`); `bluge.js` implements it over an HTTP endpoint returning
the same JSON shape, following the pattern in
`/home/renes/projects/movenotes-v3/obsidian2site.py`. `params.search.backend`
picks one at build time. The query grammar is parsed once, backend-agnostically,
in `query.js`.

### D5 — Search results are in-page

The search page is a real Hugo page. Results render into the content panel,
replacing the result list — never a modal or overlay.

---

## Steps

### 1. Scaffold, build harness, config, design tokens  ✅
`theme.toml`, directory layout, `.gitignore`, `package.json` (Pagefind),
`exampleSite/` with enough content to exercise every view, full `[params]`
schema, `assets/css/_tokens.css` with all three themes, pre-paint theme +
sidebar-width script. Blank shell that builds.

### 2. Shell chrome — header, theme selector, footer
Desktop and mobile headers, brand, nav with `aria-current`, the three-theme
dropdown with `localStorage` persistence and `aria-expanded`, footer with
generated `siteBlurb` counts.

### 3. Sidebar
Bounded term data via `partialCached`; categories and tags sections; row glyphs,
over-limit `⌕` marker, count badges; collapse toggles (persisted); client-side
mini-pager with the documented number windowing; mobile drawer + backdrop; split
bar with drag, `role="separator"`, arrow-key resize, persisted width.

### 4. Shared content partials
Result card, content-panel pagination (with windowing, real `<a href>`s,
`aria-current`), empty-results state, search bar.

### 5. Home view
Primed `category:<first>` search bar, server-rendered result list, pagination
capped per D1.

### 6. Term archive + over-limit handling  ✅
`term.html` with the eyebrow/h1/meta heading block. Over-limit terms shipped an
interim stub; step 8 replaces it with the pre-filled results view now that D2
calls for real results at that URL.

### 7. Tags grid page
`/tags/` flat-rectangle grid, server-paginated, over/under-limit routing.

### 8. Search page + Pagefind
`search.html`, query parser, adapter interface, Pagefind adapter, in-page
results, URL `?q=` and `?page=` sync, `aria-live` count, empty state. Also
converts the over-limit term archive from step 6's stub into the same results
view with its query pre-filled, per D2.

### 9. Single post view  ✅
Back link, meta row, standfirst, front-matter hero image with the striped
fallback, body prose, tag footer with over-limit routing. All four hero
branches — bundle resource, site-relative path, absolute URL, no image —
verified.

### 10. About view + Markdown prose theming
Article card, `content/about.md` eyebrow, list-item `—` markers, blockquote
treatment; applies to all rendered Markdown.

### 11. Accessibility pass  ✅
Focus rings, `prefers-reduced-motion`, keyboard paths for drawer/dropdown/split
bar, screen-reader labels, document outline, and a measured contrast audit of
all three themes.

**Outstanding — a design decision, not a code change.** Two token pairs measure
below WCAG AA and were left as specified, since the handoff calls the colours
final:

| Pair | Light | Dark | Contrast | Used by |
|---|---|---|---|---|
| `--faint` on `--panel` | 2.67 | 3.58 | 8.80 | card dates, panel eyebrows, mini-pager range, footer meta |
| `--accent` on `--sel` | 4.27 | 5.72 | 6.95 | category chip, active nav, current page number |

`--faint` is the significant one: it fails AA (4.5:1) in light and dark for the
small mono metadata it carries. Roughly `#767b82` (light) and `#8b9199` (dark)
would clear 4.5:1 while staying recognisably faint. The `contrast` theme already
passes everything, which is arguably the point of shipping it.

### 12. Bluge adapter
`bluge.js` against the documented JSON contract, plus a reference Go server
sketch and swap instructions.

### 13. Scale test harness  ✅ (500k tier outstanding)
`scripts/gen-corpus.js`, `scripts/bench.sh`, `scripts/query-latency.js`.
Results in `PERFORMANCE.md`.

10k and 100k are measured. **500k has not been run** — extrapolating the
measured O(n^1.17) build exponent puts it near 30 minutes and 12 GB peak RSS.

The headline finding changes the theme's guidance rather than its code: the
build scales fine to 100k, but Pagefind's filter path costs 8–10 s there, and
`category:`/`tag:` routing is the design's primary navigation. Bluge answers the
same queries in 33–44 ms. Recommend Pagefind up to ~25k notes and Bluge beyond;
this is exactly what decision D4's swappable interface was for.

### 14. Pagefind performance investigation

Step 13 measured `category:`/`tag:` filters at 8.5–9.7 s and a 21 s cold start
at 100k notes. Since those filters are the theme's primary navigation, it is
worth attempting to move the Pagefind crossover before settling for "use Bluge
past ~25k".

**Already ruled out.** Batching results and lazily resolving `.data()` for only
the current page — the obvious suggestion — has been in `backends/pagefind.js`
since step 8, and measurement shows it works: resolving the six visible results
costs 4–9 ms whether 605 or 20,624 notes matched. The cost is inside
`pagefind.search()`, before any theme code runs. Confirmed against the generated
bundle: the browser API has no `limit`/`offset`, so a query cannot be asked for
less than its whole match set.

Hypotheses to test, cheapest and most certain first:

1. **Server-render page 1 of an over-limit archive.** Independent of Pagefind.
   Hugo already knows the term's pages; rendering the first 6 cards is O(1) per
   term and stays inside D2's bound. The common path — click a tag, read the
   first page — would never call search at all. Expected to remove the 8–10 s
   from primary navigation whether or not 2–4 pan out.

2. **Avoid the filter-only code path.** The bundle branches on
   `filter_only = term === null`, which is exactly what the theme sends for a
   bare `category:`/`tag:` query. Measure a filtered search with a term against
   filter-only at equal match counts.

3. **Worker-boundary serialisation.** Results are marshalled out of a
   SharedWorker with `result.data` rebound per result. 20k stubs through
   structured clone would explain cost tracking match count. Compare worker and
   non-worker paths.

4. **Filter chunk warming.** `pagefind.filters()` bulk-loads every filter index
   chunk. If filtered-query cost is chunk loading rather than compute, warming
   once per session fixes it; if not, it rules the theory out.

5. **Index size.** 451 MB drives the 21 s cold start. A
   `params.search.indexBody = false` option would index titles, summaries and
   taxonomy only — much smaller and faster, at the cost of full-text search.
   A trade-off to expose, not to impose.

Each hypothesis is measured on the 100k corpus and recorded in
`PERFORMANCE.md`, including the ones that fail. If none moves the crossover
materially, the outcome is the documented recommendation already in place —
which is a legitimate result, not a failure.

### 15. Docs
`AGENTS.md`, full `README.md` (install, dev, config reference, search-backend
swap, testing).
