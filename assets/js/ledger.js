/* Ledger shell behaviour. Vanilla, no dependencies, loaded deferred. */
(function () {
  'use strict';

  var STORE = {
    theme: 'ledger:theme',
    sidebarWidth: 'ledger:sidebarWidth',
    categoriesOpen: 'ledger:categoriesOpen',
    tagsOpen: 'ledger:tagsOpen'
  };

  var MOBILE = '(max-width: 899px)';

  function save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* Private mode or a full quota — the UI still works, it just forgets. */
    }
  }

  function isMobile() {
    return window.matchMedia(MOBILE).matches;
  }

  /* Always page 1, the current page ±1, and the last page; a gap (null) wherever
     the sequence skips. Shared rule with the server-rendered content pagination. */
  function windowPages(current, total) {
    var want = {};
    [1, total, current - 1, current, current + 1].forEach(function (n) {
      if (n >= 1 && n <= total) want[n] = true;
    });
    var pages = [];
    var prev = 0;
    Object.keys(want).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (n) {
        if (n - prev > 1) pages.push(null);
        pages.push(n);
        prev = n;
      });
    return pages;
  }

  /* ── Theme selector ────────────────────────────────────────────────────── */

  function initTheme() {
    var root = document.querySelector('[data-ledger-theme]');
    if (!root) return;

    var button = root.querySelector('[data-ledger-theme-button]');
    var menu = root.querySelector('.ledger-theme-menu');
    if (!button || !menu) return;

    var options = Array.prototype.slice.call(
      menu.querySelectorAll('[data-theme-value]')
    );

    // The current row's highlight and checkmark are CSS-driven off
    // <html data-theme>; only the ARIA state needs syncing in script.
    function syncChecked() {
      var current = document.documentElement.getAttribute('data-theme');
      options.forEach(function (option) {
        var on = option.getAttribute('data-theme-value') === current;
        option.setAttribute('aria-checked', on ? 'true' : 'false');
        option.tabIndex = on ? 0 : -1;
      });
    }

    function isOpen() {
      return button.getAttribute('aria-expanded') === 'true';
    }

    function open() {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      var checked = options.filter(function (o) {
        return o.getAttribute('aria-checked') === 'true';
      })[0];
      (checked || options[0]).focus();
    }

    function close(returnFocus) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus) button.focus();
    }

    function apply(value) {
      document.documentElement.setAttribute('data-theme', value);
      save(STORE.theme, value);
      syncChecked();
    }

    button.addEventListener('click', function () {
      if (isOpen()) close(false); else open();
    });

    options.forEach(function (option, index) {
      option.addEventListener('click', function () {
        apply(option.getAttribute('data-theme-value'));
        close(true);
      });

      option.addEventListener('keydown', function (event) {
        var next = null;
        if (event.key === 'ArrowDown') next = options[(index + 1) % options.length];
        else if (event.key === 'ArrowUp') next = options[(index - 1 + options.length) % options.length];
        else if (event.key === 'Home') next = options[0];
        else if (event.key === 'End') next = options[options.length - 1];
        if (next) {
          event.preventDefault();
          next.focus();
        }
      });
    });

    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    });

    document.addEventListener('click', function (event) {
      if (isOpen() && !root.contains(event.target)) close(false);
    });

    document.addEventListener('focusin', function (event) {
      if (isOpen() && !root.contains(event.target)) close(false);
    });

    syncChecked();
  }

  /* ── Mobile drawer ─────────────────────────────────────────────────────── */

  function initDrawer() {
    var toggle = document.querySelector('[data-ledger-drawer-toggle]');
    var shell = document.querySelector('.ledger-shell');
    var backdrop = document.querySelector('.ledger-backdrop');
    if (!toggle || !shell) return;

    function setOpen(open) {
      shell.toggleAttribute('data-drawer-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (backdrop) backdrop.hidden = !open;
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && shell.hasAttribute('data-drawer-open')) {
        setOpen(false);
        toggle.focus();
      }
    });

    // The backdrop and any term or nav link inside the drawer close it.
    document.addEventListener('click', function (event) {
      if (!shell.hasAttribute('data-drawer-open')) return;
      if (event.target.closest('[data-ledger-drawer-close]')) setOpen(false);
    });

    window.matchMedia(MOBILE).addEventListener('change', function (event) {
      if (!event.matches) setOpen(false);
    });
  }

  /* ── Panel collapse ────────────────────────────────────────────────────── */

  function initPanels() {
    var flags = { categories: 'data-categories-closed', tags: 'data-tags-closed' };
    var keys = { categories: STORE.categoriesOpen, tags: STORE.tagsOpen };

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-ledger-panel-toggle]'),
      function (button) {
        var id = button.getAttribute('data-ledger-panel-toggle');
        var flag = flags[id];
        var root = document.documentElement;

        // The collapsed state itself is applied pre-paint by the head script;
        // sync ARIA to whatever it decided.
        button.setAttribute('aria-expanded', root.hasAttribute(flag) ? 'false' : 'true');

        button.addEventListener('click', function () {
          var open = root.hasAttribute(flag);   // currently closed -> opening
          root.toggleAttribute(flag, !open);
          button.setAttribute('aria-expanded', open ? 'true' : 'false');
          save(keys[id], open ? 'true' : 'false');
        });
      }
    );
  }

  /* ── Sidebar term paging ───────────────────────────────────────────────── */

  var termsPromise = null;

  function loadTerms(url) {
    if (!termsPromise) {
      termsPromise = fetch(url, { credentials: 'same-origin' })
        .then(function (response) {
          if (!response.ok) throw new Error('terms ' + response.status);
          return response.json();
        })
        .catch(function () {
          termsPromise = null;   // let a later interaction retry
          return null;
        });
    }
    return termsPromise;
  }

  function activeQuery() {
    if (location.pathname.replace(/\/$/, '').indexOf('/search') === -1) return null;
    return new URLSearchParams(location.search).get('q');
  }

  function isActiveTerm(item) {
    var q = activeQuery();
    if (q !== null) {
      var idx = item.url.indexOf('?q=');
      return idx !== -1 && decodeURIComponent(item.url.slice(idx + 3)) === q;
    }
    // Match the archive path as well as the row's own href: an over-limit row
    // links to search, but its archive URL is still a real page a visitor can
    // land on, and the row should light up there too.
    var here = location.pathname.replace(/\/$/, '');
    return item.url.replace(/\/$/, '') === here ||
           (!!item.path && item.path.replace(/\/$/, '') === here);
  }

  function buildRow(item, glyph) {
    var a = document.createElement('a');
    a.className = 'ledger-term';
    a.href = item.url;
    a.setAttribute('data-ledger-drawer-close', '');
    if (item.path) a.setAttribute('data-path', item.path);
    if (item.over) a.setAttribute('data-over', 'true');
    if (isActiveTerm(item)) a.setAttribute('data-active', 'true');

    var g = document.createElement('span');
    g.className = 'ledger-term-glyph';
    g.setAttribute('aria-hidden', 'true');
    g.textContent = glyph;

    var name = document.createElement('span');
    name.className = 'ledger-term-name';
    name.textContent = item.name;          // textContent: term names are content

    a.appendChild(g);
    a.appendChild(name);

    if (item.over) {
      var over = document.createElement('span');
      over.className = 'ledger-term-over';
      over.title = 'Over limit — opens the search page';
      over.setAttribute('aria-hidden', 'true');
      over.textContent = '⌕';
      a.appendChild(over);
    }

    var count = document.createElement('span');
    count.className = 'ledger-term-count';
    count.textContent = item.count.toLocaleString();
    a.appendChild(count);

    return a;
  }

  function initTerms() {
    var sidebar = document.querySelector('[data-ledger-sidebar]');
    if (!sidebar) return;
    var url = sidebar.getAttribute('data-terms-url');

    Array.prototype.forEach.call(
      sidebar.querySelectorAll('[data-ledger-terms]'),
      function (list) {
        var id = list.getAttribute('data-ledger-terms');
        var pager = sidebar.querySelector('[data-ledger-minipager="' + id + '"]');
        if (!pager) return;

        var glyph = id === 'tags' ? '#' : '▸';
        var pagesEl = pager.querySelector('[data-pages]');
        var rangeEl = pager.querySelector('[data-range]');
        var steps = pager.querySelectorAll('[data-step]');
        var items = null;
        var page = 1;

        function perPage() {
          return parseInt(
            isMobile() ? list.getAttribute('data-per-page-mobile')
                       : list.getAttribute('data-per-page'), 10) || 7;
        }

        function pageCount() {
          return Math.max(1, Math.ceil((items ? items.length : 0) / perPage()));
        }

        function renderRows() {
          var per = perPage();
          var start = (page - 1) * per;
          var slice = items.slice(start, start + per);
          var frag = document.createDocumentFragment();
          slice.forEach(function (item) { frag.appendChild(buildRow(item, glyph)); });
          list.textContent = '';
          list.appendChild(frag);
          return { start: start, end: start + slice.length };
        }

        function renderPager(bounds) {
          var total = pageCount();
          pagesEl.textContent = '';
          windowPages(page, total).forEach(function (n) {
            if (n === null) {
              var gap = document.createElement('span');
              gap.className = 'ledger-minipager-gap';
              gap.textContent = '…';
              pagesEl.appendChild(gap);
              return;
            }
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'ledger-minipager-page';
            b.textContent = String(n);
            if (n === page) b.setAttribute('aria-current', 'true');
            b.setAttribute('aria-label', 'Page ' + n);
            b.addEventListener('click', function () { go(n); });
            pagesEl.appendChild(b);
          });

          steps[0].disabled = page <= 1;
          steps[1].disabled = page >= total;

          rangeEl.textContent = items.length
            ? (bounds.start + 1) + '–' + bounds.end + ' of ' + items.length
            : '';
          pager.hidden = total <= 1;
        }

        function go(next) {
          page = Math.min(Math.max(1, next), pageCount());
          renderPager(renderRows());
        }

        Array.prototype.forEach.call(steps, function (step) {
          step.addEventListener('click', function () {
            go(page + parseInt(step.getAttribute('data-step'), 10));
          });
        });

        window.matchMedia(MOBILE).addEventListener('change', function () {
          if (items) go(page);
        });

        // Hydrate from the shared terms asset. Until it arrives the panel keeps
        // its server-rendered first page, so this degrades to "page 1 only".
        loadTerms(url).then(function (data) {
          if (!data || !data[id]) return;
          items = data[id] || [];

          // Open on the page holding the active term, if there is one.
          var activeIndex = -1;
          items.forEach(function (item, i) {
            if (activeIndex === -1 && isActiveTerm(item)) activeIndex = i;
          });
          page = activeIndex === -1 ? 1 : Math.floor(activeIndex / perPage()) + 1;

          renderPager(renderRows());
        });
      }
    );
  }

  /* The sidebar is cached identically across the site, so the drawer nav's
     current-page state has to be applied here rather than in the template. */
  function markActiveDrawerNav() {
    var here = location.pathname.replace(/\/$/, '');
    Array.prototype.forEach.call(
      document.querySelectorAll('.ledger-drawer-nav a'),
      function (a) {
        var href = (a.getAttribute('href') || '').replace(/\/$/, '');
        var on = href === here || (href !== '' && here.indexOf(href + '/') === 0);
        if (on) a.setAttribute('aria-current', 'page');
      }
    );
  }

  /* Mark the server-rendered first page before the terms asset arrives. */
  function markActiveServerRows() {
    Array.prototype.forEach.call(
      document.querySelectorAll('.ledger-sidebar .ledger-term'),
      function (a) {
        var on = isActiveTerm({
          url: a.getAttribute('href') || '',
          path: a.getAttribute('data-path') || ''
        });
        if (on) a.setAttribute('data-active', 'true');
      }
    );
  }

  /* ── Post back link ────────────────────────────────────────────────────── */

  function initBackLink() {
    var link = document.querySelector('[data-ledger-back]');
    if (!link) return;

    // "Returns to the referring search/archive page" — a history step preserves
    // the visitor's scroll position, query and page number, which re-navigating
    // to the href cannot. Only for same-origin referrers; otherwise the href
    // stands, so the link is never dead.
    var referrer = document.referrer;
    if (!referrer) return;
    try {
      if (new URL(referrer).origin !== location.origin) return;
    } catch (e) {
      return;
    }

    link.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      history.back();
    });
  }

  /* ── Search bar ────────────────────────────────────────────────────────── */

  function initSearchBar() {
    var input = document.querySelector('[data-ledger-search-input]');
    var clear = document.querySelector('[data-ledger-search-clear]');
    if (!input || !clear) return;

    function sync() {
      clear.hidden = input.value === '';
    }

    // Per the handoff, × clears the field but does not re-run the query.
    clear.addEventListener('click', function () {
      input.value = '';
      sync();
      input.focus();
    });

    input.addEventListener('input', sync);
    sync();
  }

  /* ── Split bar ─────────────────────────────────────────────────────────── */

  function initSplit() {
    var split = document.querySelector('[data-ledger-split]');
    var sidebar = document.querySelector('[data-ledger-sidebar]');
    if (!split || !sidebar) return;

    var min = parseInt(split.getAttribute('aria-valuemin'), 10) || 190;
    var max = parseInt(split.getAttribute('aria-valuemax'), 10) || 460;

    function setWidth(px, persist) {
      var w = Math.min(Math.max(min, Math.round(px)), max);
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
      split.setAttribute('aria-valuenow', String(w));
      if (persist) save(STORE.sidebarWidth, w);
      return w;
    }

    function currentWidth() {
      return sidebar.getBoundingClientRect().width;
    }

    split.addEventListener('mousedown', function (event) {
      if (isMobile()) return;
      event.preventDefault();
      var startX = event.clientX;
      var startW = currentWidth();
      document.body.style.userSelect = 'none';

      function move(e) { setWidth(startW + (e.clientX - startX), false); }

      function up() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
        setWidth(currentWidth(), true);
      }

      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    // Keyboard resizing — the prototype omits this; the handoff asks for it.
    split.addEventListener('keydown', function (event) {
      var delta = 0;
      if (event.key === 'ArrowLeft') delta = -16;
      else if (event.key === 'ArrowRight') delta = 16;
      else if (event.key === 'Home') return setWidth(min, true) && undefined;
      else if (event.key === 'End') return setWidth(max, true) && undefined;
      if (!delta) return;
      event.preventDefault();
      setWidth(currentWidth() + delta, true);
    });

    split.setAttribute('aria-valuenow', String(Math.round(currentWidth())));
  }

  function init() {
    initTheme();
    initDrawer();
    initPanels();
    markActiveDrawerNav();
    markActiveServerRows();
    initTerms();
    initSearchBar();
    initBackLink();
    initSplit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
