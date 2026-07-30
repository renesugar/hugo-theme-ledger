#!/usr/bin/env node
/* Build a FlexSearch index from the JSONL Hugo emits for the Bluge backend.
 *
 *   node scripts/build-flexsearch-index.js \
 *     --source bench/site/public/search-source.jsonl \
 *     --out bench/site/public/flexsearch
 *
 * Emits one file per export key plus meta.json listing them, so the adapter knows
 * what to fetch without guessing. FlexSearch 0.8 exports through a callback that
 * yields a handful of named chunks — index maps per field, the registry, the tag
 * table and the document store.
 *
 * Same JSONL as Bluge and Orama, so all three index identical documents.
 *
 * `--fields summary` leaves note bodies out, the same lever measured for Orama.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Document } = require('flexsearch');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

const source = path.resolve(arg('source', 'bench/site/public/search-source.jsonl'));
const out = path.resolve(arg('out', 'bench/site/public/flexsearch'));
const fields = arg('fields', 'all');

const indexed = [{ field: 'title', tokenize: 'forward' }];
if (fields === 'all') indexed.push({ field: 'body', tokenize: 'forward' });
else indexed.push({ field: 'summary', tokenize: 'forward' });

const dateNumber = (iso) => {
  const digits = String(iso || '').slice(0, 10).replace(/-/g, '');
  return digits.length === 8 ? parseInt(digits, 10) : 0;
};

(async () => {
  const started = Date.now();
  const index = new Document({
    document: {
      id: 'id',
      index: indexed,
      // Tag fields are what `category:` and `tag:` filter on. FlexSearch ORs
      // several values for one field, so ANDing repeated tag clauses is the
      // adapter's job.
      tag: [{ field: 'category' }, { field: 'tags' }],
      // Stored so a result card can render without a second request, which is
      // the same contract the other backends meet.
      store: ['title', 'summary', 'category', 'tags', 'date'],
    },
  });

  let total = 0;
  let probeId = null;
  let probeTag = null;
  const stream = readline.createInterface({
    input: fs.createReadStream(source),
    crlfDelay: Infinity,
  });
  for await (const line of stream) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = JSON.parse(trimmed);
    if (probeId === null) probeId = record.url;
    if (probeTag === null && record.tags && record.tags.length) probeTag = record.tags[0];
    index.add({
      id: record.url,
      title: record.title || '',
      summary: record.summary || '',
      body: fields === 'all' ? (record.body || '') : '',
      category: record.category || '',
      tags: (record.tags && record.tags.length) ? record.tags : [],
      date: dateNumber(record.date),
    });
    total += 1;
    if (total % 20000 === 0) {
      console.log(`  added ${total} notes (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }

  fs.mkdirSync(out, { recursive: true });
  const written = [];
  await index.export((key, data) => {
    if (data === undefined || data === null) return;
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    // Keys contain dots (title.1.map); keep them as filenames, they are safe.
    const file = path.join(out, key + '.json');
    fs.writeFileSync(file, body);
    written.push({ key: key, bytes: Buffer.byteLength(body) });
  });

  const bytes = written.reduce((t, w) => t + w.bytes, 0);
  fs.writeFileSync(
    path.join(out, 'meta.json'),
    /* probeTag lets a persistent-storage adapter ask "is this index already
       here?" — a tag search against a mounted IndexedDB returns hits without any
       import, which is exactly the signal needed. It has to be a tag value known
       to be present: an absent one, or an empty filter, is indistinguishable from
       an empty index. `has()` is not usable for this — it throws on a mounted but
       unqueried store. */
    JSON.stringify({ notes: total, bytes: bytes, fields: fields, keys: written,
                     probeId: probeId, probeTag: probeTag }) + '\n'
  );

  console.log(
    `flexsearch index: ${total} notes, ${(bytes / 1048576).toFixed(1)} MB in ` +
    `${written.length} chunks (fields=${fields}) in ` +
    `${Math.round((Date.now() - started) / 1000)}s`
  );
  for (const w of written) {
    console.log(`  ${w.key}: ${(w.bytes / 1048576).toFixed(1)} MB`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
