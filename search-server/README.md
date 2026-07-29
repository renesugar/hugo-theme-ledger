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
GET /api/search?q=<text>&category=<name>&tag=<name>&page=<n>&per=<n>

{
  "total": 1234,
  "page": 1,
  "per": 6,
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

`category` and `tag` arrive as separate parameters, already parsed. The
`category:` / `tag:` grammar is handled client-side in
`assets/js/search/query.js`, so a backend never re-parses it — including the
rule that the configured "all notes" label means *no* filter.

Paging is server-side: the endpoint receives `page` and `per` and returns only
that slice, so a large corpus never crosses the wire.

`GET /api/health` returns `{"backend":"bluge","notes":N}`.

## Switching the theme over

1. Point the theme at the backend:

   ```toml
   [params.search]
     backend = "bluge"
     endpoint = "/api/search"
   ```

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
- With no text query, results sort newest-first rather than by index order.
- The index is written to a temporary directory and swapped into place, so an
  interrupted build never leaves a partial index behind.

## Writing another backend

Add a module beside `pagefind.js` and `bluge.js` exporting `init(config)` and
`search(parsed, {page, perPage})`, register it in the `BACKENDS` map in
`assets/js/search/main.js`, and select it with `params.search.backend`. The
parsed query shape and the result shape are the whole interface.
