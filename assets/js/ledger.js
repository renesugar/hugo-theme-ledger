/* Ledger shell behaviour. Vanilla, no dependencies, loaded deferred.
   Step 2 covers the theme selector and the drawer toggle contract; the sidebar
   pager, collapse and split bar attach in step 3. */
(function () {
  'use strict';

  var STORE = {
    theme: 'ledger:theme',
    sidebarWidth: 'ledger:sidebarWidth',
    categoriesOpen: 'ledger:categoriesOpen',
    tagsOpen: 'ledger:tagsOpen'
  };

  function save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      /* Private mode or a full quota — the UI still works, it just forgets. */
    }
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
    if (!toggle || !shell) return;

    function setOpen(open) {
      shell.toggleAttribute('data-drawer-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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

    // The backdrop and any sidebar term selection close the drawer. Both are
    // added in step 3; delegation here means they need no extra wiring.
    document.addEventListener('click', function (event) {
      if (!shell.hasAttribute('data-drawer-open')) return;
      if (event.target.closest('[data-ledger-drawer-close]')) setOpen(false);
    });
  }

  function init() {
    initTheme();
    initDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
