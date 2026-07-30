/* Query grammar, parsed once and backend-agnostically.

   The grammar:

     category:<name>   exact category match; the configured "all notes" label
                       matches everything rather than naming a category
     tag:<name>        exact tag match, repeatable — several tags are ANDed
     since:YYYY-MM-DD  lower date bound, inclusive
     until:YYYY-MM-DD  upper date bound, exclusive
     "quoted phrase"   exact phrase
     anything else     free text
     <space>           AND, between any two expressions
     OR                OR, uppercase only — `or` is an ordinary word
     -<expression>     negation; needs at least one positive alongside it
     ( … )             grouping

   AND binds tighter than OR, so `a b OR c` is `(a AND b) OR c`. Parentheses are
   how you get the other reading.

   Clauses tokenise on whitespace, so a value containing a space must be
   quoted: `category:"Field notes"`. Templates generate clauses through
   `layouts/_partials/search-clause.html`, which applies the same rule — the
   two have to agree, or a category with a space in its name silently becomes a
   category plus a stray search term.

   Anything that does not fit — `foo:bar`, `since:yesterday` — is free text, so
   a note that mentions a colon is still findable by typing what it says.

   Every backend receives this same shape, so adding one never means
   re-implementing the grammar. Not every backend can honour all of it —
   Pagefind has no date filter, for instance. A backend reports what it had to
   drop in `unsupported` on its response rather than silently ignoring it.

   `parsed.tree` is the expression; the flat `categories`/`tags`/`phrases`/
   `terms`/`since`/`until` fields are derived from it and are what the adapters
   read today. The flat form cannot express OR or negation, so a query using
   them is approximated there — every positive leaf, ANDed — and `parsed.operators`
   names what was approximated so a backend can say so. */

var FIELDS = { category: 1, tag: 1, since: 1, until: 1 };
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuery(raw, allNotesLabel) {
  var tokens = tokenize(String(raw == null ? '' : raw), allNotesLabel);
  var tree = parseExpression(new Cursor(tokens));

  var parsed = {
    categories: [],
    tags: [],
    phrases: [],
    terms: [],
    since: '',
    until: '',
    text: '',
    matchAll: true,
    tree: tree,
    operators: []
  };

  collectOperators(tree, parsed.operators);
  flatten(tree, parsed, false);

  // Convenience for backends that take free text as one string. Phrases keep
  // their quotes: both Pagefind and Bluge read that as an exact phrase.
  parsed.text = parsed.terms
    .concat(parsed.phrases.map(function (p) { return '"' + p + '"'; }))
    .join(' ');

  parsed.matchAll = !parsed.categories.length && !parsed.tags.length &&
    !parsed.phrases.length && !parsed.terms.length &&
    !parsed.since && !parsed.until;

  return parsed;
}

/* A negation with nothing to subtract from selects most of the archive, and on
   Pagefind it cannot be expressed at all. Twitter/X requires a positive clause
   for the same reason; this reports rather than throws, so the caller decides
   whether to run it. */
export function negationNeedsPositive(tree) {
  return !!tree && !hasPositive(tree);
}

function hasPositive(node) {
  if (!node) return false;
  if (node.type === 'not') return false;
  if (node.type === 'and') return node.nodes.some(hasPositive);
  // An OR is positive only if every branch is: `a OR -b` still matches every
  // note without b.
  if (node.type === 'or') return node.nodes.every(hasPositive);
  return true;
}

function collectOperators(node, out) {
  if (!node) return;
  if (node.type === 'or' && out.indexOf('OR') === -1) out.push('OR');
  if (node.type === 'not' && out.indexOf('-') === -1) out.push('-');
  if (node.type === 'and' || node.type === 'or') node.nodes.forEach(function (n) {
    collectOperators(n, out);
  });
  if (node.type === 'not') collectOperators(node.node, out);
}

/* Fill the flat shape from the tree. Negated branches contribute nothing, and
   OR branches contribute as though they were ANDed — the approximation the
   header describes. */
function flatten(node, parsed, negated) {
  if (!node || negated) return;
  switch (node.type) {
    case 'and':
    case 'or':
      node.nodes.forEach(function (n) { flatten(n, parsed, false); });
      return;
    case 'not':
      return;
    case 'field':
      if (node.field === 'category') parsed.categories.push(node.value);
      else if (node.field === 'tag') parsed.tags.push(node.value);
      else parsed[node.field] = node.value;
      return;
    case 'phrase':
      parsed.phrases.push(node.value);
      return;
    case 'term':
      parsed.terms.push(node.value);
      return;
  }
}

/* Recursive descent over the token list.

     expression := disjunction
     disjunction := conjunction ( OR conjunction )*
     conjunction := unary+
     unary       := '-' unary | primary
     primary     := '(' expression ')' | value

   Returns null for an empty query, which is the match-all case. */
function Cursor(tokens) {
  this.tokens = tokens;
  this.at = 0;
}
Cursor.prototype.peek = function () { return this.tokens[this.at] || null; };
Cursor.prototype.next = function () { return this.tokens[this.at++] || null; };

function parseExpression(cursor) {
  return parseDisjunction(cursor);
}

function parseDisjunction(cursor) {
  var branches = [];
  var first = parseConjunction(cursor);
  if (first) branches.push(first);
  while (cursor.peek() && cursor.peek().type === 'or') {
    cursor.next();
    var next = parseConjunction(cursor);
    if (next) branches.push(next);
  }
  if (!branches.length) return null;
  if (branches.length === 1) return branches[0];
  return { type: 'or', nodes: branches };
}

function parseConjunction(cursor) {
  var nodes = [];
  for (;;) {
    var token = cursor.peek();
    if (!token || token.type === 'or' || token.type === 'close') break;
    var node = parseUnary(cursor);
    if (node) nodes.push(node);
  }
  if (!nodes.length) return null;
  if (nodes.length === 1) return nodes[0];
  return { type: 'and', nodes: nodes };
}

function parseUnary(cursor) {
  var token = cursor.peek();
  if (token && token.type === 'not') {
    cursor.next();
    var inner = parseUnary(cursor);
    // A trailing `-` with nothing after it is not a negation of everything.
    return inner ? { type: 'not', node: inner } : null;
  }
  return parsePrimary(cursor);
}

function parsePrimary(cursor) {
  var token = cursor.next();
  if (!token) return null;
  if (token.type === 'open') {
    var inner = parseExpression(cursor);
    if (cursor.peek() && cursor.peek().type === 'close') cursor.next();
    return inner;
  }
  if (token.type === 'close') return null;      // unmatched, ignored
  return token.node;
}

/* One pass over the string, emitting operator tokens and value nodes.

   A bare `tag:` with no value is not a filter matching nothing — it is
   dropped, so typing a prefix before its value arrives does not blank the
   results. */
function tokenize(text, allNotesLabel) {
  var tokens = [];
  var i = 0;
  var n = text.length;
  var depth = 0;

  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;

    /* `(` opens a group only at the start of a token. A URL such as
       `…/Function_(mathematics)` keeps its parentheses because they are not
       where a group could begin, and the matching `)` is only taken back off
       below while a group is actually open. */
    if (text[i] === '(') { tokens.push({ type: 'open' }); depth++; i++; continue; }
    if (text[i] === ')') {
      if (depth > 0) { tokens.push({ type: 'close' }); depth--; i++; continue; }
      i++;                                       // stray, and nothing to close
      continue;
    }

    // `-` negates only as a prefix: `covid-19` and `a-b` are ordinary words.
    if (text[i] === '-' && i + 1 < n && !isSpace(text[i + 1])) {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }

    var field = null;
    var colon = fieldPrefixEnd(text, i);
    if (colon !== -1) {
      field = text.slice(i, colon).toLowerCase();
      i = colon + 1;
    }

    var value;
    var quoted = false;
    var closes = 0;
    if (text[i] === '"') {
      quoted = true;
      var read = readQuoted(text, i);
      value = read.value;
      i = read.next;
    } else {
      var start = i;
      while (i < n && !isSpace(text[i])) i++;
      value = text.slice(start, i);
      /* A trailing `)` belongs to the token when the token opened it and
         closes a group when it did not. `…/Function_(mathematics)` keeps its
         own pair; `pizza)` gives its bracket back. Counting rather than
         peeling blindly is what lets a URL sit inside a group. */
      while (value.length && value[value.length - 1] === ')' &&
             occurrences(value, ')') > occurrences(value, '(')) {
        value = value.slice(0, -1);
        closes++;
      }
    }

    if (!value) { emitCloses(); continue; }     // a bare `tag:` or a lone `""`

    if (!field && !quoted && value === 'OR') { tokens.push({ type: 'or' }); continue; }

    if ((field === 'since' || field === 'until') && !ISO_DATE.test(value)) {
      // Not a date, so not a bound. Keep what was typed as searchable text.
      tokens.push({ type: 'value', node: { type: 'term', value: field + ':' + value } });
      continue;
    }

    if (field === 'category' && allNotesLabel &&
        value.toLowerCase() === String(allNotesLabel).toLowerCase()) {
      // `category:All notes` is defined as meaning everything, not a category
      // that happens to be named that. It constrains nothing, so it emits
      // nothing at all.
      continue;
    }

    if (field) {
      tokens.push({ type: 'value', node: { type: 'field', field: field, value: value } });
    } else if (quoted) {
      tokens.push({ type: 'value', node: { type: 'phrase', value: value } });
    } else {
      tokens.push({ type: 'value', node: { type: 'term', value: value } });
    }
    emitCloses();
  }

  return tokens;

  /* Brackets peeled off the end of a token close their groups, in order, after
     the token itself. With no group open they were stray and are dropped. */
  function emitCloses() {
    while (closes > 0) {
      closes--;
      if (depth > 0) { tokens.push({ type: 'close' }); depth--; }
    }
  }
}

function occurrences(text, ch) {
  var n = 0;
  for (var i = 0; i < text.length; i++) if (text[i] === ch) n++;
  return n;
}

/* Returns the index of the colon ending a recognised field prefix at `from`,
   or -1. An unknown prefix is not field syntax, so `http://example.com` stays
   one free-text token. */
function fieldPrefixEnd(text, from) {
  var colon = text.indexOf(':', from);
  if (colon === -1) return -1;
  var name = text.slice(from, colon).toLowerCase();
  if (!name || !FIELDS[name]) return -1;
  return colon;
}

/* Reads a double-quoted run starting at `from`, honouring `\"`. An unterminated
   quote runs to the end of the string rather than being discarded, so results
   keep updating while the closing quote is still being typed. */
function readQuoted(text, from) {
  var out = '';
  var i = from + 1;
  while (i < text.length) {
    var ch = text[i];
    if (ch === '\\' && text[i + 1] === '"') { out += '"'; i += 2; continue; }
    if (ch === '"') { i++; break; }
    out += ch;
    i++;
  }
  return { value: out, next: i };
}

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/* Human-readable form used in the results count line. */
export function describeQuery(parsed, raw) {
  if (parsed.matchAll && !raw) return '';
  return String(raw || '').trim();
}
