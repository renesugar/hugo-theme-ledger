/* Query grammar, parsed once and backend-agnostically.

   The grammar:

     category:<name>   exact category match; the configured "all notes" label
                       matches everything rather than naming a category
     tag:<name>        exact tag match, repeatable — several tags are ANDed
     since:YYYY-MM-DD  lower date bound, inclusive
     until:YYYY-MM-DD  upper date bound, exclusive
     "quoted phrase"   exact phrase
     anything else     free text; several terms are ANDed

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
   drop in `unsupported` on its response rather than silently ignoring it. */

var FIELDS = { category: 1, tag: 1, since: 1, until: 1 };
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuery(raw, allNotesLabel) {
  var parsed = {
    categories: [],
    tags: [],
    phrases: [],
    terms: [],
    since: '',
    until: '',
    text: '',
    matchAll: true
  };

  tokenize(String(raw == null ? '' : raw)).forEach(function (token) {
    if (token.field === 'category') {
      // `category:All notes` is defined as meaning everything, not a category
      // that happens to be named that.
      if (allNotesLabel &&
          token.value.toLowerCase() === String(allNotesLabel).toLowerCase()) return;
      parsed.categories.push(token.value);
      return;
    }
    if (token.field === 'tag') {
      parsed.tags.push(token.value);
      return;
    }
    if (token.field === 'since' || token.field === 'until') {
      parsed[token.field] = token.value;
      return;
    }
    // A quoted run with no field prefix is a phrase; `tag:"two words"` is a tag
    // whose value happens to contain a space.
    if (token.quoted) parsed.phrases.push(token.value);
    else parsed.terms.push(token.value);
  });

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

/* One pass over the string, emitting { field, value, quoted } tokens.

   A bare `tag:` with no value is not a filter matching nothing — it is
   dropped, so typing a prefix before its value arrives does not blank the
   results. */
function tokenize(text) {
  var tokens = [];
  var i = 0;
  var n = text.length;

  while (i < n) {
    while (i < n && isSpace(text[i])) i++;
    if (i >= n) break;

    var field = null;
    var colon = fieldPrefixEnd(text, i);
    if (colon !== -1) {
      field = text.slice(i, colon).toLowerCase();
      i = colon + 1;
    }

    var value;
    var quoted = false;
    if (text[i] === '"') {
      quoted = true;
      var read = readQuoted(text, i);
      value = read.value;
      i = read.next;
    } else {
      var start = i;
      while (i < n && !isSpace(text[i])) i++;
      value = text.slice(start, i);
    }

    if (!value) continue;                       // a bare `tag:` or a lone `""`
    if ((field === 'since' || field === 'until') && !ISO_DATE.test(value)) {
      // Not a date, so not a bound. Keep what was typed as searchable text.
      tokens.push({ field: null, value: field + ':' + value, quoted: false });
      continue;
    }
    tokens.push({ field: field, value: value, quoted: quoted });
  }

  return tokens;
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
