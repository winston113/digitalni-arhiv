/* @ds-bundle: {"format":4,"namespace":"DigitalniArhivPogodb","components":[]} */
(function () {
  'use strict';
  var KEY = 'tema';
  var CHOICES = ['system', 'light', 'dark'];
  var NAMES = { system: 'sistemska', light: 'svetla', dark: 'temna' };
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return CHOICES.indexOf(value) >= 0 ? value : 'system';
    } catch (e) {
      return 'system';
    }
  }
  function store(choice) {
    try { window.localStorage.setItem(KEY, choice); } catch (e) { /* shramba ni na voljo */ }
  }
  function resolve(choice) {
    return choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
  }
  function apply(choice) {
    document.documentElement.setAttribute('data-theme', resolve(choice));
  }

  // Poveže gumb in meni v .menu-wrap. options: choice, persist, onChange.
  function bindThemeMenu(wrap, options) {
    options = options || {};
    var button = wrap.querySelector('[aria-haspopup="menu"]');
    var menu = wrap.querySelector('[role="menu"]');
    var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitemradio"]'));
    var current = options.choice || 'system';

    function show(choice) {
      current = choice;
      items.forEach(function (item) {
        var on = item.getAttribute('data-choice') === choice;
        item.setAttribute('aria-checked', String(on));
        if (on) button.innerHTML = item.querySelector('.icon').outerHTML;
      });
      button.setAttribute('aria-label', 'Tema: ' + NAMES[choice]);
    }
    function open() {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
    }
    function close(focus) {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    }
    function choose(choice) {
      show(choice);
      apply(choice);
      if (options.persist !== false) store(choice);
      if (options.onChange) options.onChange(choice);
    }

    button.addEventListener('click', function () {
      if (!menu.hidden) return close(false);
      open();
      items[CHOICES.indexOf(current)].focus();
    });
    items.forEach(function (item, index) {
      item.addEventListener('click', function () {
        choose(item.getAttribute('data-choice'));
        close(true);
      });
      item.addEventListener('keydown', function (event) {
        var step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        items[(index + step + items.length) % items.length].focus();
      });
    });
    wrap.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) close(true);
    });
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) close(false);
    });
    media.addEventListener('change', function () {
      if (current === 'system') apply('system');
    });
    show(current);
  }

  window.DigitalniArhivPogodb = {
    theme: { stored: stored, resolve: resolve, apply: apply, bindThemeMenu: bindThemeMenu }
  };
})();
