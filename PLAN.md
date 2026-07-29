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

**Contrast: resolved.** The handoff's `--faint` measured 2.67:1 (light) and
3.58:1 (dark) on `--panel`, and `--accent` on `--sel` measured 4.27:1 — all
below WCAG AA. The palette was corrected rather than documented as a known
failure:

| token | was | now | effect |
|---|---|---|---|
| `--faint` light | `#9a9fa5` | `#6b7079` | 2.67 → 4.98 on `--panel`, 4.52 on `--bg` |
| `--faint` dark | `#71767d` | `#868b92` | 3.58 → 4.77 |
| `--accent` light | `oklch(0.55 …)` | `oklch(0.53 …)` | accent-on-`--sel` 4.27 → 4.65; white-on-accent 4.86 → 5.29 |

Hue and chroma are unchanged; only lightness moved. A sweep of every
text-bearing element in the shell — 32 of them, in all three themes — now finds
nothing below 4.5:1.

`--bg` turned out to be the binding constraint, not `--panel`: the results
"Page N of M" line sits directly on the content-panel background, so a value
that cleared AA on `--panel` alone was not enough.

### 12. Bluge adapter
`bluge.js` against the documented JSON contract, plus a reference Go server
sketch and swap instructions.

### 13. Scale test harness  ✅
`scripts/gen-corpus.js`, `scripts/bench.sh`, `scripts/query-latency.js`.
Results in `PERFORMANCE.md`.

All three tiers measured: 10k, 100k and 500k. The 500k build takes 80 minutes
and 13.2 GB peak RSS — the earlier extrapolation from the 10k→100k exponent
predicted 30 minutes and was wrong, because the exponent itself worsens with
size (~1.11 then ~1.72). Every structural guarantee holds at 500k: a note page
is still 20 KB with 5,000 tags in play, and 4,816 of those tags emit no pager
at all.

The headline finding changes the theme's guidance rather than its code: the
build scales fine to 100k, but Pagefind's filter path costs 8–10 s there, and
`category:`/`tag:` routing is the design's primary navigation. Bluge answers the
same queries in 33–44 ms. Recommend Pagefind up to ~25k notes and Bluge beyond;
this is exactly what decision D4's swappable interface was for.

### 14. Pagefind performance investigation  ✅
Five hypotheses tested against the 100k corpus; full write-up in
`PERFORMANCE.md`.

| # | hypothesis | outcome |
|---|---|---|
| 1 | server-render page 1 of an over-limit archive | ✅ primary navigation now issues zero search queries |
| 2 | avoid the `filter_only` branch | ❌ cost tracks match count, not the branch |
| 3 | worker-boundary serialisation | ⚠️ no public toggle; would need a patched bundle |
| 4 | warm filter chunks via `pagefind.filters()` | ❌ costs 106 s and does not help |
| 5 | shrink the index by excluding note bodies | ❌ index is metadata-dominated; 9% smaller, latency unchanged |

Only 1 worked, and it works by not searching rather than by searching faster.
The recommendation is now interaction-shaped rather than purely size-shaped:
browsing is fast at 100k, hand-typed filter queries and deep paging are not.

Also corrected the step 13 filter latencies, which were measured partially warm
and understated the cold case.

### 15. Docs  ✅
`AGENTS.md` — orientation for coding agents: the scale invariants that are
invisible from any single file, the search adapter contract, and the traps
already hit in this repo.

`README.md` — install, required config, content model, full `[params]`
reference, both search backends and how to choose, development and
benchmarking, accessibility.
