/* Query grammar, parsed once and backend-agnostically.

   From the handoff:
     category:<name>  exact category match; the configured "all notes" label
                      matches everything. Names may contain spaces — the whole
                      remainder of the string is the value, so no quoting is
                      needed and none is accepted.
     tag:<name>       exact tag match, same rule.
     anything else    free text.

   Every backend receives this same shape, so adding one never means
   re-implementing the grammar. */

var FIELD = /^(category|tag)\s*:\s*(.*)$/i;

export function parseQuery(raw, allNotesLabel) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return { field: null, value: '', text: '', matchAll: true };

  var m = FIELD.exec(text);
  if (!m) return { field: null, value: '', text: text, matchAll: false };

  var field = m[1].toLowerCase();
  var value = m[2].trim();

  // `category:All notes` is defined as meaning everything, not a category
  // that happens to be named that.
  if (field === 'category' && allNotesLabel &&
      value.toLowerCase() === String(allNotesLabel).toLowerCase()) {
    return { field: null, value: '', text: '', matchAll: true };
  }

  // A bare `tag:` with no value is not a filter for nothing — treat it as
  // an empty query rather than returning zero results.
  if (!value) return { field: null, value: '', text: '', matchAll: true };

  return { field: field, value: value, text: '', matchAll: false };
}

/* Human-readable form used in the results count line. */
export function describeQuery(parsed, raw) {
  if (parsed.matchAll && !raw) return '';
  return String(raw || '').trim();
}
