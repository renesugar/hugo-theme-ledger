# AGENTS.md

Orientation for coding agents working on this theme. Read this before changing
templates or search code — several constraints here are invisible from any
single file and easy to break by accident.

## What this is

A Hugo theme for a personal knowledge base: a shell of header, resizable
sidebar and content panel, with five content views (home, search, taxonomy
archive, tags grid, about) plus a single-post view. Built from a design handoff
in `/home/renes/projects/design_handoff_hugo_ledger_theme/`, whose
`HugoShell.dc.html` is the source of truth for every measurement.

**The defining requirement is scale**: it must stay fast at 100k+ pages. Most of
the non-obvious code exists for that reason.

## Where things are

```
layouts/
  baseof.html            shell frame; computes the active nav key
  home.html              primed search bar + results + capped pagination
  page.html              single post; carries the Pagefind indexing contract
  about.html             layout: about
  search.html            /search/
  term.html              taxonomy archive — two shapes, over/under limit
  taxonomy.html          /tags/ and /categories/ grids
  section.html           generic list, not a designed view
  home.ledgersearch.jsonl  opt-in index source for the Bluge backend
  _partials/
    head, header, footer, sidebar, scripts
    term-list.html       bounded taxonomy data (returns a slice)
    search-view.html     the in-page results view, used by two layouts
    result-card, pagination, search-bar, empty-results
assets/
  css/_*.css             concatenated in an explicit order in head.html
  js/ledger.js           shell behaviour (plain IIFE, loads everywhere)
  js/search/             ES modules, bundled with js.Build, search views only
search-server/           reference Go/Bluge server
scripts/                 corpus generator, bench harness, latency probe
```

`PLAN.md` holds the architectural decisions (D1–D5) and step history.
`PERFORMANCE.md` holds measurements, including the things that were tried and
did not work — read it before optimising anything, to avoid repeating them.

## Invariants — break these and the theme stops scaling

**Never range over `site.RegularPages` in a per-page partial.** That is an O(n²)
build. Taxonomy data comes from the taxonomy page tree (`term-list.html`), which
is O(terms). Counting notes goes through `mainSections` and each section's
already-built `RegularPages`.

**The sidebar must stay byte-identical on every page.** It is rendered through
`partialCached` with no variant key, so it renders once per build instead of
once per page. That is why the active row and the drawer nav's current page are
marked client-side from `location.pathname` rather than in the template. If you
add anything page-specific to the sidebar, you have silently made the build
O(pages) in sidebar work.

**Only the first page of each sidebar panel is inlined.** The rest live in one
fingerprinted JSON asset shared site-wide, capped at `sidebar.maxTerms`.
Anything inlined in the sidebar is multiplied by the page count — a 50k-tag site
inlining all terms would ship gigabytes.

**Pagination must be bounded before `.Paginate`, not after.** Hugo generates a
page for every pager it is handed. Capping which pages are *linked* does
nothing; `home.html` truncates the slice first. This was shipped broken once —
see the step 5 commit.

**Over-limit terms must never call `.Paginate`.** A term holding 200k notes
would emit ~33k pager directories. `term.html` server-renders only the first
page and hands the rest to the search backend.

## Search

The grammar (`category:`, `tag:`, free text) is parsed once, backend-agnostically,
in `assets/js/search/query.js`. Backends implement two methods:

```js
init(config)                    -> Promise<void>
search(parsed, {page, perPage}) -> Promise<{total, page, pages, results}>
```

Add one beside `pagefind.js`/`bluge.js`, register it in the `BACKENDS` map in
`main.js`, select it with `params.search.backend`. Do not re-parse the grammar
in a backend.

**Pagefind indexing is scoped by a single `data-pagefind-body`** on note
articles in `page.html`. Pagefind indexes *only* marked elements once any exist,
which is what keeps the shared header/sidebar/footer out of every excerpt and
keeps `about.md` and `search.md` out of the index. Adding that attribute to
another layout changes what the whole site indexes.

**Ordering must agree between Hugo and the backend.** `term.html` server-renders
page 1 in Hugo's date order; the backend serves page 2. Notes carry
`data-pagefind-sort="date"` and filter-only queries request a date sort so the
two are slices of one sequence. Remove that and pages will repeat and skip
notes.

## The number-windowing rule exists three times

"Page 1, current ±1, last, with `…` where the run skips" is implemented in:

- `layouts/_partials/pagination.html` (Go, server-rendered)
- `assets/js/ledger.js` (sidebar mini-pager)
- `assets/js/search/paging.js` (search results)

They cannot share code across the template/IIFE/module boundaries. Change one,
change all three, and check the sequences still match.

## Building and testing

```bash
npm run build            # hugo, no search index
npm run preview          # hugo + pagefind + static serve — use this for search
npm run dev              # hugo server; SEARCH DOES NOT WORK (no index)
scripts/bench.sh 10000   # scale tier; appends to bench/out/results.tsv
```

**A change is not verified until it has been driven in a browser.** Markup that
looks right has been wrong several times in this repo's history — the pagination
cap looked correct in the rendered pager while silently generating every page.
Check the built output on disk, not just the HTML.

## Traps already hit here

- **`hugo server` builds no Pagefind index.** Search fails under `npm run dev`
  and works under `npm run preview`. This is not a bug.
- **`jsonify` inside a `<script>` double-escapes.** Go's contextual autoescaping
  already quotes values in JS context; piping through `jsonify` produced
  `data-theme="\"light\""`.
- **`{{ "\n" }}` between trim markers is eaten.** The JSONL emitter put the
  whole corpus on one line. Use `printf "%s\n"`.
- **`getComputedStyle` returns `oklch()` verbatim in Chrome.** Parsing it as RGB
  reads lightness/chroma/hue as colour channels and yields nonsense contrast
  ratios. Paint to a canvas and read the pixel back.
- **`pkill -f "hugo server ..."` matches its own shell command line**, killing
  the command chain while the server survives. Use `pkill -f 'hugo[ ]server'`.
- **Setting `border-radius` in `:focus-visible`** reshapes the element, not the
  outline. Outlines already follow the element's radius.

## Conventions

- Vanilla JS, no dependencies. `ledger.js` is an IIFE loaded on every page;
  `search/` is ES modules bundled by `js.Build` and loaded only where needed.
- CSS is hand-written, concatenated in the explicit order listed in
  `head.html` — new stylesheets must be added to that list.
- Class names are `ledger-` prefixed. Behaviour hooks are `data-ledger-*`
  attributes, kept separate from styling classes.
- Comments explain *why*, particularly where something looks unnecessary. Most
  of the odd-looking code is load-bearing for scale; say so rather than letting
  the next reader simplify it away.
