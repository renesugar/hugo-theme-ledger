/* What the Bluge adapter puts on the wire.

   The choice pinned here is that a query travels flat unless it needs not to.
   Flat parameters keep a shared URL legible and are what the reference server's
   `offset`/`limit` contract is written against; the tree exists for the three
   things they cannot spell. Getting this backwards would work — the server
   accepts both — and would quietly make every URL a blob of JSON. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuery } from '../query.js';
import { init, search } from './bluge.js';

/* Runs one search against a stub and returns the query string it requested. */
async function requestFor(raw) {
  let requested = '';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requested = String(url);
    return {
      ok: true,
      json: async () => ({ total: 0, page: 1, per: 6, results: [] })
    };
  };
  try {
    await init({ endpoint: '/api/search' });
    await search(parseQuery(raw), { page: 1, perPage: 6 });
  } finally {
    globalThis.fetch = realFetch;
  }
  return new URLSearchParams(requested.slice(requested.indexOf('?') + 1));
}

test('a query without operators travels as flat parameters', async () => {
  const params = await requestFor('canadian housing tag:economics');
  assert.equal(params.get('expr'), null);
  assert.equal(params.get('q'), 'canadian housing');
  assert.deepEqual(params.getAll('tag'), ['economics']);
  assert.equal(params.get('page'), '1');
  assert.equal(params.get('per'), '6');
});

test('phrases and date bounds still travel flat', async () => {
  const params = await requestFor('"Bank of Canada" since:2026-07-01 until:2026-08-01');
  assert.equal(params.get('expr'), null);
  assert.deepEqual(params.getAll('phrase'), ['Bank of Canada']);
  assert.equal(params.get('since'), '2026-07-01');
  assert.equal(params.get('until'), '2026-08-01');
});

test('a query with an operator travels as the tree, and only then', async () => {
  for (const raw of ['cat OR dog', 'pizza -donut', 'a (b OR c)']) {
    const params = await requestFor(raw);
    assert.ok(params.get('expr'), `${raw} should send expr`);
    // The flat fields would contradict the tree, so they are not sent at all.
    assert.equal(params.get('q'), null, `${raw} should not also send q`);
    assert.equal(params.get('page'), '1');
  }
});

test('the tree on the wire is the tree the grammar built', async () => {
  const params = await requestFor('cat OR dog');
  assert.deepEqual(JSON.parse(params.get('expr')), {
    type: 'or',
    nodes: [{ type: 'term', value: 'cat' }, { type: 'term', value: 'dog' }]
  });
});

test('an empty query asks for everything, with no expr', async () => {
  const params = await requestFor('');
  assert.equal(params.get('expr'), null);
  assert.equal(params.get('q'), null);
  assert.equal(params.get('per'), '6');
});
