/* Auto backend: Bluge when a search server is answering, Pagefind when it is not.

   This exists for sites that ship both indexes — a generated archive published
   as static files but also served locally by the Go server. The same build then
   works either way, instead of being wrong in one of them.

   The choice is made once per page load, from a single `/api/health` probe, and
   cached: search must not pay for the probe on every query. A site that is
   always one or the other should name that backend directly and skip the probe
   entirely.

   If the server disappears mid-session — stopped while a page is open — the
   first failing query falls back to Pagefind for the rest of the session rather
   than reporting search as broken. That downgrade is one-way: nothing re-probes,
   because a visitor typing queries is not the right place to retry a server. */

import * as pagefind from './pagefind.js';
import * as bluge from './bluge.js';

var chosen = null;
var choosing = null;
var lastConfig = null;

/* Long enough to cross a local network, short enough that a hung proxy does not
   hold search hostage. A static host answers 404 immediately, which is a
   perfectly good "no". */
var PROBE_TIMEOUT_MS = 1500;

export async function init(config) {
  lastConfig = config;
  if (!chosen) {
    // Concurrent init() calls share one probe.
    choosing = choosing || probe(config);
    chosen = await choosing;
  }
  return chosen.init(config);
}

export async function search(parsed, opts) {
  try {
    return await chosen.search(parsed, opts);
  } catch (error) {
    if (chosen === bluge) {
      if (window.console) {
        console.info('[ledger] search server stopped answering; using Pagefind for the rest of this session.');
      }
      chosen = pagefind;
      await chosen.init(lastConfig);
      return chosen.search(parsed, opts);
    }
    throw error;
  }
}

async function probe(config) {
  var url = config.healthEndpoint || '/api/health';
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = controller ? setTimeout(function () { controller.abort(); }, PROBE_TIMEOUT_MS) : null;
  try {
    var response = await fetch(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) return pagefind;
    var body = await response.json();
    // A backend has to name itself. A static host that happens to serve
    // something at that path is not a search server.
    return body && body.backend ? bluge : pagefind;
  } catch (error) {
    return pagefind;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
