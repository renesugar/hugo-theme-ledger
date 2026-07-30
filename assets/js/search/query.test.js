/* Tests for the query grammar — `npm test`.

   The grammar is the one piece of pure logic in this theme that every backend
   depends on and no build step exercises: a Hugo build will happily ship a
   parser that reads `cat OR dog` as three ANDed words. It runs under
   `node --test` because it has no DOM in it. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseQuery, negationNeedsPositive } from './query.js';

/* The flat fields the adapters read, without the tree, so a comparison shows
   only what a backend would act on. */
function flat(raw, allNotes) {
  const parsed = parseQuery(raw, allNotes);
  return {
    categories: parsed.categories,
    tags: parsed.tags,
    phrases: parsed.phrases,
    terms: parsed.terms,
    since: parsed.since,
    until: parsed.until,
    text: parsed.text,
    matchAll: parsed.matchAll
  };
}

test('an operator-free query parses exactly as it always has', () => {
  assert.deepEqual(flat(''), {
    categories: [], tags: [], phrases: [], terms: [],
    since: '', until: '', text: '', matchAll: true
  });
  assert.deepEqual(flat('canadian housing'), {
    categories: [], tags: [], phrases: [], terms: ['canadian', 'housing'],
    since: '', until: '', text: 'canadian housing', matchAll: false
  });
  assert.deepEqual(flat('tag:economics tag:housing category:"Field notes"'), {
    categories: ['Field notes'], tags: ['economics', 'housing'],
    phrases: [], terms: [], since: '', until: '', text: '', matchAll: false
  });
  assert.deepEqual(flat('"Bank of Canada" rates'), {
    categories: [], tags: [], phrases: ['Bank of Canada'], terms: ['rates'],
    since: '', until: '', text: 'rates "Bank of Canada"', matchAll: false
  });
  assert.deepEqual(flat('since:2026-07-01 until:2026-08-01'), {
    categories: [], tags: [], phrases: [], terms: [],
    since: '2026-07-01', until: '2026-08-01', text: '', matchAll: false
  });
});

test('an unparseable field value stays searchable text', () => {
  assert.deepEqual(flat('since:yesterday').terms, ['since:yesterday']);
  assert.deepEqual(flat('foo:bar').terms, ['foo:bar']);
});

test('category:"All notes" constrains nothing', () => {
  const parsed = parseQuery('category:"All notes"', 'All notes');
  assert.equal(parsed.matchAll, true);
  assert.deepEqual(parsed.categories, []);
  assert.equal(parsed.tree, null);
});

test('a URL survives its own punctuation', () => {
  // Parentheses inside a URL are not grouping, and the trailing one is not a
  // close when no group is open.
  const url = 'https://example.com/wiki/Function_(mathematics)';
  assert.deepEqual(flat(url).terms, [url]);
  // A hyphen inside a word is not a negation.
  assert.deepEqual(flat('more-canadians-housing').terms, ['more-canadians-housing']);
  // A URL inside a real group keeps its own parentheses and closes the group.
  const parsed = parseQuery('(' + url + ' OR pizza)');
  assert.deepEqual(parsed.tree, {
    type: 'or',
    nodes: [{ type: 'term', value: url }, { type: 'term', value: 'pizza' }]
  });
});

test('OR is uppercase only', () => {
  assert.deepEqual(parseQuery('cat OR dog').tree, {
    type: 'or',
    nodes: [{ type: 'term', value: 'cat' }, { type: 'term', value: 'dog' }]
  });
  // Lowercase `or` is an ordinary word, so a note that says it stays findable.
  assert.deepEqual(flat('cat or dog').terms, ['cat', 'or', 'dog']);
});

test('AND binds tighter than OR', () => {
  assert.deepEqual(parseQuery('a b OR c').tree, {
    type: 'or',
    nodes: [
      { type: 'and', nodes: [{ type: 'term', value: 'a' }, { type: 'term', value: 'b' }] },
      { type: 'term', value: 'c' }
    ]
  });
  assert.deepEqual(parseQuery('a (b OR c)').tree, {
    type: 'and',
    nodes: [
      { type: 'term', value: 'a' },
      { type: 'or', nodes: [{ type: 'term', value: 'b' }, { type: 'term', value: 'c' }] }
    ]
  });
});

test('negation applies to a term, a field or a group', () => {
  assert.deepEqual(parseQuery('cat -grumpy').tree, {
    type: 'and',
    nodes: [
      { type: 'term', value: 'cat' },
      { type: 'not', node: { type: 'term', value: 'grumpy' } }
    ]
  });
  assert.deepEqual(parseQuery('-tag:draft').tree, {
    type: 'not', node: { type: 'field', field: 'tag', value: 'draft' }
  });
  assert.deepEqual(parseQuery('a -(b OR c)').tree, {
    type: 'and',
    nodes: [
      { type: 'term', value: 'a' },
      {
        type: 'not',
        node: { type: 'or', nodes: [{ type: 'term', value: 'b' }, { type: 'term', value: 'c' }] }
      }
    ]
  });
  // A `-` with nothing attached is an ordinary character, as it was before
  // negation existed — not a negation of everything.
  assert.deepEqual(parseQuery('-').tree, { type: 'term', value: '-' });
  assert.deepEqual(parseQuery('cat - dog').terms, ['cat', '-', 'dog']);
});

test('a negation needs something positive to subtract from', () => {
  assert.equal(negationNeedsPositive(parseQuery('-cat').tree), true);
  assert.equal(negationNeedsPositive(parseQuery('-cat -dog').tree), true);
  assert.equal(negationNeedsPositive(parseQuery('cat -dog').tree), false);
  // `a OR -b` matches every note without b, so it is not positive either.
  assert.equal(negationNeedsPositive(parseQuery('a OR -b').tree), true);
  assert.equal(negationNeedsPositive(parseQuery('a OR b').tree), false);
  assert.equal(negationNeedsPositive(parseQuery('').tree), false);
});

test('operators used are reported, and the flat shape approximates them', () => {
  const or = parseQuery('cat OR dog');
  assert.deepEqual(or.operators, ['OR']);
  // Until the backends take the tree, OR is approximated as AND — fewer
  // results rather than the wrong ones, and `operators` says it happened.
  assert.deepEqual(or.terms, ['cat', 'dog']);

  const not = parseQuery('pizza -donut');
  assert.deepEqual(not.operators, ['-']);
  assert.deepEqual(not.terms, ['pizza']);   // the negated leaf contributes nothing

  assert.deepEqual(parseQuery('canadian housing').operators, []);
});

test('unbalanced parentheses do not lose the query', () => {
  assert.deepEqual(flat('(cat dog').terms, ['cat', 'dog']);
  assert.deepEqual(flat('cat dog)').terms, ['cat', 'dog']);
});
