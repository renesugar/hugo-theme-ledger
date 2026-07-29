#!/usr/bin/env node
/* Generate a synthetic corpus for scale testing.
 *
 *   node scripts/gen-corpus.js --count 100000 --out bench/site
 *
 * The shape matters as much as the size. Two properties are deliberate:
 *
 *   Tags follow a Zipf-like distribution — a few very common tags and a long
 *   tail of rare ones. A flat distribution would make every term over-limit and
 *   never exercise the archive path, or every term under-limit and never
 *   exercise the search routing. Real corpora are skewed; the theme's whole
 *   over/under-limit design only means anything against a skewed corpus.
 *
 *   Tag count grows with corpus size, so large tiers push well past
 *   sidebar.maxTerms and exercise the cap rather than pretending it away.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};

const count = parseInt(arg('count', '10000'), 10);
const out = arg('out', 'bench/site');
const seedStart = parseInt(arg('seed', '1'), 10);

// Small deterministic PRNG so runs are reproducible and comparable.
let seed = seedStart >>> 0;
const rand = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 4294967296;
};

const CATEGORIES = [
  'Recipes', 'Homelab', 'Writing', 'Reading', 'Travel', 'Woodwork',
  'Photography', 'Finance', 'Health', 'Music', 'Gardening', 'Languages',
  'Electronics', 'Archive',
];

/* Vocabulary.
 *
 * A small word list makes every note contain nearly the same words, so a
 * free-text query matches most of the corpus and search timings measure a case
 * that does not occur in real prose. Build a large vocabulary instead and
 * sample it Zipf-distributed, so term selectivity spans the range a real
 * corpus has: a handful of words in almost every note, and a long tail in a
 * fraction of a percent.
 */
const SYL_A = 'ba ce di fo gu ha je ki lo mu na pe ri so tu va we xi yo zu'.split(' ');
const SYL_B = 'bre cla dro fle gni hor jum kel lim mor nut pol rid sem tor vim wan xer yol zad'.split(' ');
const SYL_C = 'ck ft gn lm nd rk sp st th rn ld mp ng ct sk lt ph tr gr bl'.split(' ');

// 20^3 = 8,000 distinct pseudo-words, deterministic and ordered by rank.
const WORDS = [];
for (let c = 0; c < SYL_C.length; c++) {
  for (let b = 0; b < SYL_B.length; b++) {
    for (let a = 0; a < SYL_A.length; a++) {
      WORDS.push(SYL_A[a] + SYL_B[b] + SYL_C[c]);
    }
  }
}

// Zipf over the vocabulary: rank r has weight 1/r.
const wordCumulative = [];
let wordAcc = 0;
for (let r = 1; r <= WORDS.length; r++) { wordAcc += 1 / r; wordCumulative.push(wordAcc); }
const pickWord = () => {
  const target = rand() * wordAcc;
  let lo = 0, hi = wordCumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wordCumulative[mid] < target) lo = mid + 1; else hi = mid;
  }
  return WORDS[lo];
};

const tagCount = Math.min(5000, Math.max(24, Math.round(count / 100)));
const TAGS = Array.from({ length: tagCount }, (_, i) => WORDS[i]);

// Zipf: rank r gets weight 1/r, so tag 0 is ~tagCount times more common than
// the rarest. Precompute a cumulative table and binary-search it.
const cumulative = [];
let acc = 0;
for (let r = 1; r <= TAGS.length; r++) { acc += 1 / r; cumulative.push(acc); }
const pickTag = () => {
  const target = rand() * acc;
  let lo = 0, hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1; else hi = mid;
  }
  return TAGS[lo];
};

const sentence = (n) => {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(pickWord());
  return parts.join(' ');
};

const contentDir = path.join(out, 'content', 'notes');
fs.mkdirSync(contentDir, { recursive: true });

const started = Date.now();
const startYear = 2019;

for (let i = 0; i < count; i++) {
  const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
  const tags = new Set();
  const n = 1 + Math.floor(rand() * 4);
  while (tags.size < n) tags.add(pickTag());

  const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
  const year = startYear + Math.floor(rand() * 7);

  const title = `Note ${i} — ${sentence(3)}`;
  const summary = sentence(18);
  const body = [
    sentence(40), '', '## ' + sentence(3), '', sentence(60), '',
    '- ' + sentence(8), '- ' + sentence(8), '- ' + sentence(8), '',
    '> ' + sentence(16), '', sentence(55),
  ].join('\n');

  const md = `---
title: "${title}"
date: ${year}-${month}-${day}
summary: "${summary}"
categories: ["${category}"]
tags: [${[...tags].map((t) => `"${t}"`).join(', ')}]
readingTime: ${2 + Math.floor(rand() * 12)}
---

${body}
`;
  fs.writeFileSync(path.join(contentDir, `note-${i}.md`), md);

  if (i > 0 && i % 50000 === 0) {
    process.stderr.write(`  ${i}/${count} written\n`);
  }
}

fs.writeFileSync(path.join(out, 'content', '_index.md'), '---\ntitle: "Bench"\n---\n');
fs.writeFileSync(path.join(out, 'content', 'about.md'),
  '---\ntitle: "About"\nlayout: "about"\nurl: "/about/"\n---\n\nBench corpus.\n');
fs.writeFileSync(path.join(out, 'content', 'search.md'),
  '---\ntitle: "Search"\nlayout: "search"\nurl: "/search/"\noutputs: ["html"]\n---\n');

process.stderr.write(
  `generated ${count} notes, ${CATEGORIES.length} categories, ${TAGS.length} tags ` +
  `in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
