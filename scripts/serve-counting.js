#!/usr/bin/env node
/* Static file server that counts the bytes it serves.
 *
 *   node scripts/serve-counting.js --root bench/site/public --port 8084
 *
 * Why not measure in the browser: Pagefind fetches its index chunks from a
 * SharedWorker, and a worker's requests never appear in the page's Resource
 * Timing entries. An in-page byte count therefore reports zero for Pagefind
 * while correctly counting a backend that fetches from the page — which would
 * flatter Pagefind in exactly the comparison this harness exists to make.
 *
 * Counting at the server sees every request whatever made it, needs no browser
 * API, and is the same measurement for every backend.
 *
 * Protocol for a measurement:
 *
 *   GET /__bytes?reset=1     start counting from zero
 *   ... drive the page ...
 *   GET /__bytes             {total, requests, byPrefix: {...}}
 *
 * Dependency-free, like everything else in scripts/.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

const root = path.resolve(arg('root', 'bench/site/public'));
const port = parseInt(arg('port', '8084'), 10);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
};

let tally = { total: 0, requests: 0, byPrefix: {} };

/* Bucket by the part of the path that identifies the backend, so a result can
   say where the bytes went rather than only how many there were. */
function bucket(pathname) {
  if (pathname.startsWith('/pagefind/')) return 'pagefind';
  if (pathname.startsWith('/orama/')) return 'orama';
  if (pathname.startsWith('/flexsearch/')) return 'flexsearch';
  if (pathname.startsWith('/api/')) return 'api';
  if (pathname.startsWith('/movenotes/')) return 'movenotes-tag-index';
  if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) return 'theme-assets';
  if (pathname.startsWith('/ledger/')) return 'theme-assets';
  return 'pages';
}

function record(pathname, bytes) {
  tally.total += bytes;
  tally.requests += 1;
  const key = bucket(pathname);
  tally.byPrefix[key] = (tally.byPrefix[key] || 0) + bytes;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/__bytes') {
    const body = JSON.stringify({
      total: tally.total,
      totalKB: Math.round(tally.total / 1024),
      requests: tally.requests,
      byPrefixKB: Object.fromEntries(
        Object.entries(tally.byPrefix).map(([k, v]) => [k, Math.round(v / 1024)])
      ),
    });
    if (url.searchParams.get('reset') === '1') {
      tally = { total: 0, requests: 0, byPrefix: {} };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
    return;
  }

  let file = path.join(root, pathname);
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');

  fs.stat(file, (error, stats) => {
    if (error || !stats.isFile()) {
      // Directory URLs without a trailing slash still have to resolve.
      const alternative = path.join(root, pathname, 'index.html');
      fs.stat(alternative, (error2, stats2) => {
        if (error2 || !stats2.isFile()) {
          response.writeHead(404).end('not found');
          return;
        }
        send(alternative, stats2, pathname, response);
      });
      return;
    }
    send(file, stats, pathname, response);
  });
});

function send(file, stats, pathname, response) {
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'content-length': stats.size,
    // No caching, so a measurement counts every byte a first visit would need.
    'cache-control': 'no-store',
  });
  record(pathname, stats.size);
  fs.createReadStream(file).pipe(response);
}

server.listen(port, '127.0.0.1', () => {
  console.log(`counting server: http://127.0.0.1:${port}/ from ${root}`);
  console.log('GET /__bytes?reset=1 to start a measurement, GET /__bytes to read it');
});
