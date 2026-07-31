#!/usr/bin/env node
/* Build an Orama index from the JSONL Hugo emits for the Bluge backend.
 *
 *   node scripts/build-orama-index.js \
 *     --source bench/site/public/search-source.jsonl \
 *     --out bench/site/public/orama
 *
 * Emits index.json (the persisted Orama database) and meta.json (document count
 * and the byte size, so a page can report what it is about to download).
 *
 * The same JSONL feeds Bluge, so the two backends index exactly the same
 * documents and any difference in results is the engine, not the corpus.
 *
 * `--fields summary` indexes titles and summaries but not bodies. Orama holds
 * its whole index in memory in the browser, so shrinking what is indexed is its
 * only real lever; measuring both says whether the lever is enough.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { create, insertMultiple } = require('@orama/orama');
const { persist } = require('@orama/plugin-data-persistence');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

const source = path.resolve(arg('source', 'bench/site/public/search-source.jsonl'));
const out = path.resolve(arg('out', 'bench/site/public/orama'));
const fields = arg('fields', 'all');           // all | summary
const batchSize = parseInt(arg('batch', '2000'), 10);

/* Schema notes, all of them load-bearing for the grammar:
 *
 *   tags as enum[] with containsAll — repeated `tag:` clauses are ANDed, which
 *     is what the grammar means. A string[] field cannot express that in Orama
 *     3.x: containsAll returns nothing and only scalar equality works.
 *   category as enum, filtered with { eq } — a plain equality filter on an enum
 *     is INVALID_FILTER_OPERATION.
 *   date as a number (YYYYMMDD) so since/until become a `between` range. Orama
 *     has no date type, and lexical ISO strings cannot be range-filtered.
 */
const schema = {
  title: 'string',
  summary: 'string',
  category: 'enum',
  tags: 'enum[]',
  date: 'number',
};
if (fields === 'all') schema.body = 'string';

const dateNumber = (iso) => {
  const digits = String(iso || '').slice(0, 10).replace(/-/g, '');
  return digits.length === 8 ? parseInt(digits, 10) : 0;
};

(async () => {
  const started = Date.now();
  const db = create({ schema });

  let pending = [];
  let total = 0;
  const flush = async () => {
    if (!pending.length) return;
    await insertMultiple(db, pending, batchSize);
    pending = [];
  };

  const stream = readline.createInterface({
    input: fs.createReadStream(source),
    crlfDelay: Infinity,
  });

  for await (const line of stream) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = JSON.parse(trimmed);
    const document = {
      id: record.url,
      title: record.title || '',
      summary: record.summary || '',
      category: record.category || '',
      // Orama's enum[] rejects an empty array on some paths; a sentinel keeps
      // every document shaped the same.
      tags: (record.tags && record.tags.length) ? record.tags : ['(none)'],
      date: dateNumber(record.date),
    };
    if (fields === 'all') document.body = record.body || '';
    pending.push(document);
    total += 1;
    if (pending.length >= batchSize) {
      await flush();
      if (total % 20000 === 0) {
        console.log(`  indexed ${total} notes (${Math.round((Date.now() - started) / 1000)}s)`);
      }
    }
  }
  await flush();

  fs.mkdirSync(out, { recursive: true });
  const serialized = await persist(db, 'json');
  const indexPath = path.join(out, 'index.json');
  fs.writeFileSync(indexPath, serialized);
  const bytes = fs.statSync(indexPath).size;
  // The schema travels with the index: a persisted Orama database does not
  // include it, and create() needs it before load() to type the fields.
  fs.writeFileSync(
    path.join(out, 'meta.json'),
    JSON.stringify({ notes: total, bytes: bytes, fields: fields, schema: schema }) + '\n'
  );

  console.log(
    `orama index: ${total} notes, ${(bytes / 1048576).toFixed(1)} MB ` +
    `(fields=${fields}) in ${Math.round((Date.now() - started) / 1000)}s`
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
