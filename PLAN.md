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
| `captured-thread-reply` | `ledgerHideTitle` / `ledgerHideMeta`, and two shared tags for `tag:a tag:b` |
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

### 16. Grammar, imported-note switches, and one Bluge contract  ✅
Prerequisites for using this theme as the output of
`/home/renes/projects/movenotes-v3/obsidian2site.py`, whose generator supports a
larger query grammar than the theme did and whose server spoke a different HTTP
shape. Planned in that repo's `LEDGER_MIGRATION_PLAN.md` (step 21).

**Grammar.** `query.js` now tokenises rather than matching one leading clause:
repeatable `tag:`/`category:`, `since:`/`until:` date bounds, quoted phrases and
free text, all ANDed. The parsed shape is
`{categories[], tags[], phrases[], terms[], since, until, text, matchAll}`.

Tokenising means a value containing a space needs quoting, which the old
"remainder of the string is the value" rule did not. Every template that
generates a clause — six of them — now goes through
`_partials/search-clause.html`, which quotes only when necessary. That partial
exists so the quoting rule cannot drift from `query.js`.

**Unsupported clauses are reported, not dropped.** A backend returns the clause
names it could not honour in `unsupported`, and the search view says so.
Pagefind returns `['since:', 'until:']`: it has filters and phrases but no date
range, and quietly returning the unbounded set would look like an answer.

**Phrases needed term positions.** The reference server indexed no positions, so
the first `"quoted phrase"` query returned zero results while looking healthy.
`title`, `summary` and `body` now carry `SearchTermPositions()`. Positions
enlarge the index, which makes the Bluge sizes in `PERFORMANCE.md` a floor.

**One HTTP contract.** `search-server` accepts repeatable `phrase`/`category`/
`tag`, `since`/`until`, `page`/`per` *or* `offset`/`limit`, and `sort`; returns
`backend`, `query`, `total`, `page`, `per`, `offset`, `limit`, `results`; sends
`Server-Timing` and logs every request. Malformed or inverted date bounds are
400s. `main_test.go` pins the parsing rules, since two independent clients
depend on them.

**Imported-note switches.** `ledgerHideTitle` keeps the `h1` in the document
outline and takes it off the screen; `ledgerHideMeta` drops the category/date
row; `params.post.heroPlaceholder = false` removes the striped stand-in
site-wide. All three are for archives whose notes carry their own heading,
timestamp and no hero — a Twitter/X import shows all of it twice otherwise. The
standfirst also stopped falling back to Hugo's auto `.Summary`, which is the
first words of the body sitting directly beneath it.

Verified in a browser against both backends: every query form was run through
the real search UI on a Bluge build and a Pagefind build, and the two agree on
every query both can express. `exampleSite` carries
`notes/captured-thread-reply.md` as the imported-note fixture.

Also fixed `footer.html`, where `site.Params.footer.rss | default true` read an
explicit `rss = false` as absent — Hugo's `default` treats false as empty.

**Follow-ups, found while wiring the generator up to this theme:**

- `home.html` built its primed query with `printf "category:%s"`, so the default
  "All notes" label — which contains a space — produced a query that tokenised
  as the category "All" plus the term "notes". It goes through
  `search-clause.html` like the other six sites now. This is why that partial
  exists, and it was still missed once.
- `section.html` called `.Paginate` on the section's whole page set with no cap.
  Every other unbounded surface is capped by decision D1; this one was not, and
  a section holding the corpus is the largest single source of pages in a build
  — 166k notes at 6 per page is ~28k pager directories. New
  `params.scale.maxSectionPagerPages` (default 500 in the example config),
  applied by truncating before `.Paginate`, with the same "showing the N most
  recent" ceiling card home uses.

### 17. The `auto` backend  ✅
`backend = "auto"` for a build that has to work both as static files and behind
the Go server — which is what movenotes' `--search-backend both` has always
promised, and could not express while a backend was chosen at build time.

`auto.js` is not a third engine. It probes `/api/health` once per page load, with
a 1.5 s timeout, and then delegates to `bluge.js` or `pagefind.js`; a backend has
to name itself in that response, because a static host serving something at that
path is not a search server. The answer is cached, so search never pays for the
probe twice, and concurrent `init()` calls share one probe.

Its one piece of behaviour beyond delegation: if the server stops answering
mid-session, the first failing query falls back to Pagefind for the rest of the
session instead of reporting search as broken. That downgrade is deliberately
one-way — a visitor typing queries is not the right place to retry a server.

Also fixed the `home.ledgersearch.jsonl` guard, which warned that the JSONL was
unused whenever the backend was not exactly `bluge`; `auto` may select Bluge and
needs it too.

Verified in a browser on one build served two ways: as static files it probes,
gets a 404 and uses Pagefind; behind the server it probes, gets `bluge` and
answers `since:`/`until:` with no unsupported-clause notice and no Pagefind
download at all. The downgrade was verified by failing `/api/search` while the
page was open — results kept coming from Pagefind, and the next query issued no
further request to the dead server.

### 18. Subpath deployments  ✅
The theme was broken on any site published below the domain root — which is the
normal case on GitHub Pages, where a repository publishes to
`<owner>.github.io/<repo>/`.

`relURL` drops the baseURL's path when its argument begins with a slash:

```
baseURL = "https://example.github.io/archive/"
"/search/" | relURL  ->  /search/            wrong
"search/"  | relURL  ->  /archive/search/    right
```

Every link, stylesheet, script and fetch URL in the theme was written the first
way — 23 of them. Rather than removing 23 slashes and trusting the next edit,
they now go through `_partials/site-url.html`, which takes either form and passes
absolute URLs through. `baseof.html`'s active-nav comparison uses it on both
sides, so it keeps matching.

Two runtime consequences needed more than a path fix:

- The search config's `bundlePath`, `endpoint` and `healthEndpoint` are fetched or
  imported by the browser, so they carry the subpath now; an absolute URL still
  passes through, which is how a Bluge server on another host is configured. The
  config also gained `siteRoot` for backends that resolve stored result URLs.
- **Pagefind needed `baseUrl` in `options()`.** It records result URLs relative to
  the directory it indexed, which is the built site's root and not the domain's,
  so every result linked to `/notes/…` and 404ed.

Verified by building `exampleSite` with `--baseURL https://example.github.io/archive/`,
serving it under `/archive/`, and driving search in a browser: four results, every
href under `/archive/`, and no request outside the subpath except the favicon.

### 19. Benchmark tiers 25k and 200k, and a byte-accurate baseline  ✅
Two new tiers, and the metric that the Orama/FlexSearch comparison turns on.

**Bytes cannot be measured in the browser.** Pagefind fetches its index from a
SharedWorker, and a worker's requests never appear in the page's Resource Timing
entries — so an in-page count reports zero bytes for Pagefind while correctly
counting a backend that fetches from the page. It would have flattered Pagefind in
exactly the comparison the harness exists to make. `scripts/serve-counting.js` is
a dependency-free static server that tallies what it serves;
`/__bytes?reset=1` starts a measurement. `query-latency.js` also switched from
`transferSize` to `encodedBodySize`, since the former is 0 for a cache hit.

The result, in `PERFORMANCE.md`: Pagefind has **two independent limits**. Cold
bytes scale with the number of *tag values* — 13.6 MB at 250 tags, 103 MB and
2,200 requests at 2,000 — and warm latency scales with the number of *matches*,
reaching 132 s for a query matching 54,854 of 200,000 notes while transferring
6 KB. Free text is cheap and scales sublinearly (369 KB at 25k, 1,759 KB at 200k),
and paging stays flat at 2 ms.

`bench.sh` gained `maxSectionPagerPages` — the older rows were measured before
that cap and silently emitted a pager directory per six notes, ~83,000 of them at
500k — plus `home_pagers`, `section_pagers` and `term_dirs` columns so the caps
are visible in the data rather than inferred from a total.

### 20. The Orama backend — measured, and not promoted  ✅
`backends/orama.js` behind the same adapter contract, `scripts/build-orama-index.js`
reading the same JSONL Bluge indexes, and the full metric set at 25,000 notes.

**Refuted on the criterion that scales against it.** Orama holds its whole index in
memory, so a visitor downloads 223 MB (full text) or 33 MB (titles and summaries)
and waits 11–19 s before the first result, against Pagefind's 369 KB and about a
second. Warm queries are then extraordinary — 35 ms for a filter over 8,924 notes
where Pagefind takes 6,006 ms — but that is the wrong half of the trade for a
100k-note archive. Two of the promotion rule's four criteria fail, and they are the
two the rule exists for.

100k and 200k were deliberately not measured: the index is linear, so 200k projects
to ~1.8 GB, and no measurement of it could change the decision. The projection is
labelled as arithmetic in `PERFORMANCE.md`.

Three things worth keeping from the attempt:

- **A static `import '@orama/orama'` in the adapter inlines the library into the
  shared search bundle** — 8.9 KB to 88.2 KB, paid by every site including the
  Pagefind ones. It is built as its own asset and imported from a runtime URL, the
  way `pagefind.js` loads its bundle, and only when a site selects the backend.
- **`@orama/plugin-data-persistence` cannot be bundled for a browser**: its entry
  point pulls in Node's `stream`. Orama's own `load()` accepts exactly what the
  plugin's `persist` writes, so the browser needs neither.
- **A persisted Orama database does not carry its schema**, and `create()` needs
  one before `load()`. The builder writes it into `meta.json` rather than letting
  the adapter guess, which would have silently mis-typed fields whenever the index
  was built with `--fields summary`.

The adapter stays in the theme, registered and documented as a small-site option:
at a few thousand notes its index is a few megabytes, and it answers the
`since:`/`until:` bounds Pagefind cannot express at all.
