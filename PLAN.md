# Implementation plan — "Ledger" Hugo theme

Source of truth for design: `/home/renes/projects/design_handoff_hugo_ledger_theme/`
(`README.md` for specified values, `HugoShell.dc.html` for markup/measurements).
The prototype's `support.js` is a mockup runtime and is **not** ported.

## Working agreement

- One step per session. Each step leaves the repo in a building, committed state.
- `hugo --source exampleSite --themesDir ../..` must succeed at the end of every step.
- Commit after each step; the step number goes in the commit subject.

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

A term whose count exceeds `taxonomyPageLimit` must not render a full paginated
archive (that is the O(n) blowup the design is avoiding). Its term page still
builds — so the URL is never a 404 — but renders a bounded stub that links to
`/search/?q=category:Name`. Sidebar rows and tag-grid cells for those terms link
straight to the search page, per the design.

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

### 6. Term archive + over-limit stub
`term.html` with the eyebrow/h1/meta heading block; D2 stub for over-limit terms.

### 7. Tags grid page
`/tags/` flat-rectangle grid, server-paginated, over/under-limit routing.

### 8. Search page + Pagefind
`search.html`, query parser, adapter interface, Pagefind adapter, in-page
results, URL `?q=` and `?page=` sync, `aria-live` count, empty state.

### 9. Single post view
Back link, meta row, standfirst, front-matter hero image with the striped
fallback, body prose, tag footer with over-limit routing.

### 10. About view + Markdown prose theming
Article card, `content/about.md` eyebrow, list-item `—` markers, blockquote
treatment; applies to all rendered Markdown.

### 11. Accessibility pass
Focus rings on every interactive element, `prefers-reduced-motion`, keyboard
paths for drawer/dropdown/split bar, screen-reader labels, contrast check of the
`contrast` theme.

### 12. Bluge adapter
`bluge.js` against the documented JSON contract, plus a reference Go server
sketch and swap instructions.

### 13. Scale test harness
`scripts/gen-corpus.js` (10k / 100k / 500k), timing harness for `hugo` build,
Pagefind index, and query latency. Record results in `PERFORMANCE.md`. Verify no
unbounded query regressions.

### 14. Docs
`AGENTS.md`, full `README.md` (install, dev, config reference, search-backend
swap, testing).
