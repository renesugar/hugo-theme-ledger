# Ledger search server (Bluge)

A reference implementation of the theme's search API, backed by
[Bluge](https://github.com/blugelabs/bluge). It is an alternative to Pagefind,
not a requirement — the theme ships with Pagefind selected.

## When to use it

Pagefind is a static, chunked index served from your CDN: no server, and the
browser downloads only the fragments a query touches. Prefer it unless you need
something it cannot do:

- ranking or query features Pagefind does not implement
- an index that updates without rebuilding the site
- search over content that is not in the built HTML

Bluge costs you a running process. That is the trade.

## The contract

The server implements exactly what `assets/js/search/backends/bluge.js` calls.
Anything that answers this shape can replace it:

```
GET /api/search?q=<free text>
               &phrase=<exact phrase>   (repeatable)
               &category=<name>         (repeatable)
               &tag=<name>              (repeatable)
               &since=YYYY-MM-DD&until=YYYY-MM-DD
               &page=<n>&per=<n>

{
  "backend": "bluge",
  "query":   "category:Recipes tag:sourdough",
  "total":   1234,
  "page":    1,
  "per":     6,
  "offset":  0,
  "limit":   6,
  "results": [
    {
      "title": "Sourdough starter maintenance",
      "summary": "A starter is a schedule, not a recipe.",
      "url": "/notes/sourdough-starter-maintenance/",
      "category": "Recipes",
      "tags": ["sourdough", "baking"],
      "date": "2026-06-14",
      "readingTime": 7
    }
  ]
}
```

Every clause arrives as a separate parameter, already parsed. The grammar —
`category:`, `tag:`, `since:`, `until:`, quoted phrases, free text — is handled
client-side in `assets/js/search/query.js`, so a backend never re-parses it,
including the rule that the configured "all notes" label means *no* filter.

| parameter | notes |
|---|---|
| `q` | free-text terms, ANDed |
| `phrase` | exact phrase; repeatable, ANDed |
| `category`, `tag` | exact keyword match; repeatable, ANDed |
| `since` | inclusive lower date bound, `YYYY-MM-DD` |
| `until` | **exclusive** upper bound, so one day is `since:D until:D+1` |
| `page`, `per` | what `bluge.js` sends; `per` is capped at 100 |
| `offset`, `limit` | accepted instead, for callers that are not the adapter |
| `sort` | `date` (the default, for every query shape) or `score` for ranking |
| `expr` | the query as a JSON expression tree; when present it *is* the query |

`expr` exists because the parameters above cannot express `OR`, negation or
grouping — they are a flat set of clauses, all ANDed. The tree can:

```json
{"type":"and","nodes":[
  {"type":"or","nodes":[{"type":"term","value":"apple"},
                        {"type":"term","value":"banana"}]},
  {"type":"not","node":{"type":"field","field":"tag","value":"sweet"}}]}
```

Node types are `and` and `or` (with `nodes`), `not` (with `node`), `term`,
`phrase` (with `value`), and `field` (with `field` and `value`, where `field` is
one of `category`, `tag`, `since`, `until`). Anything else is a `400` naming the
problem, as is a tree over 8 KB or nested deeper than 32.

A negation is built as the `MustNot` of the boolean containing it — Bluge has no
standalone negation query — and a bare `-term` becomes a `MustNot`-only boolean,
which Bluge answers directly. The response echoes the tree back in the grammar's
own syntax, so the log line shows how a query was *understood*, not just what
arrived.

A malformed date or an inverted range is a `400`, not a silently empty result.

Paging is server-side: the endpoint receives `page` and `per` and returns only
that slice, so a large corpus never crosses the wire.

The response echoes `backend` and `query`, and every response carries a
`Server-Timing: search;dur=…` header and an `X-Ledger-Search-Backend` header.
Each request is logged with its query, total, window and duration — so a site
that looks like it is not reaching the backend can be told apart from one that
is reaching it and finding nothing.

`GET /api/health` returns `{"backend":"bluge","notes":N}`.

## Switching the theme over

1. Point the theme at the backend:

   ```toml
   [params.search]
     backend = "bluge"
     endpoint = "/api/search"
   ```

   Or `backend = "auto"` for one build that has to work both ways: it probes
   `/api/health` and uses this server when it answers, Pagefind when it does not.
   That needs both indexes present.

2. Have Hugo emit the index source. This is opt-in — a Pagefind site should not
   pay to render every note's plain text:

   ```toml
   [mediaTypes."application/jsonl"]
     suffixes = ["jsonl"]

   [outputFormats.ledgersearch]
     mediaType = "application/jsonl"
     baseName = "search-source"
     isPlainText = true
     notAlternative = true

   [outputs]
     home = ["html", "rss", "ledgersearch"]
   ```

   This writes `public/search-source.jsonl`, one note per line.

3. Build and run:

   ```bash
   hugo
   cd themes/hugo-theme-ledger/search-server
   go build -o ledger-search-server .
   ./ledger-search-server \
     -source ../../../public/search-source.jsonl \
     -index bluge-index \
     -site ../../../public \
     -listen 127.0.0.1:8080
   ```

The index is built on first start and rebuilt whenever the JSONL's size or
mtime changes. `-reindex` forces it; `-index-only` builds and exits, which is
what you want in CI so the first request is not the one that waits.

In production you would more likely serve `public/` from your existing web
server and reverse-proxy `/api/` here, rather than using `-site`. The adapter
only needs `endpoint` to resolve — same origin, or CORS on your side.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `-source` | `public/search-source.jsonl` | JSONL emitted by the `ledgersearch` output |
| `-index` | `bluge-index` | index directory |
| `-listen` | `127.0.0.1:8080` | listen address |
| `-site` | *(none)* | optional static directory to serve alongside the API |
| `-reindex` | `false` | rebuild even if the index looks current |
| `-index-only` | `false` | build the index and exit |

## Indexing notes

- `category` and `tag` are keyword fields — matched exactly, not tokenised, so
  `tag:sourdough` cannot also match "sourdoughs".
- `title` is boosted 5×, `summary` 2×, `body` 1×.
- `title`, `summary` and `body` are indexed **with term positions**. Without
  them a `"quoted phrase"` query matches nothing at all rather than failing
  loudly — the phrase clause needs to know which terms are adjacent. Positions
  make the index larger; that is what the phrase clause costs.
- Date bounds are a lexical range over the sortable ISO date, so no separate
  datetime field is needed: zero-padded dates sort chronologically as text.
- Emoji are indexed as keywords in their own field, because the analyser makes
  no term for one at all: `😃` yields nothing and `happy 😃 day` yields
  `[happy] [day]`. A term made only of emoji is matched against that field
  instead of the text fields. Rune by rune, so 👍🏽 and 👍 are the same search
  and any part of a joined sequence finds it. Costs 0.6% of the index.
- Results sort newest-first for **every** query, not only for those with no text
  to rank. An archive is read chronologically, and page 1 may be server-rendered
  by Hugo in date order while this endpoint serves page 2 — the two have to be
  slices of one sequence. `sort=score` opts back into relevance ranking.
- The index is written to a temporary directory and swapped into place, so an
  interrupted build never leaves a partial index behind.

## Writing another backend

Add a module beside `pagefind.js` and `bluge.js` exporting `init(config)` and
`search(parsed, {page, perPage})`, register it in the `BACKENDS` map in
`assets/js/search/main.js`, and select it with `params.search.backend`. The
parsed query shape and the result shape are the whole interface.

A backend need not implement every clause, but it must say which ones it
dropped: return their names in `unsupported` (`['since:', 'until:']`) and the
search view tells the visitor. Pagefind does exactly this — it has filters and
phrases but no date range.
