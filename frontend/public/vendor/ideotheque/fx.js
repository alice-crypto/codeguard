/*!
 * Idéothèque — fx.js — bibliothèque d'idées visuelles
 * Active automatiquement tous les éléments [data-fx] de la page.
 * API : FX.init(racine), FX.replay(element), FX.trigger(element), FX.play(transition, callback, event),
 *       FX.go(transition, adresse, event),
 *       FX.register(nom, définition), FX.isEntrance(nom)
 * Licence MIT
 */
(function () {
  'use strict';

  // --- Outils partagés par tous les effets ----------------------------------

  var defs = {};
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover)').matches;
  var raf = window.requestAnimationFrame.bind(window);
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=/<>';

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function cssVar(el, name, fallback) {
    var v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }
  // Lit un attribut numérique data-fx-* (clé en camelCase, ex. 'fxSpeed')
  function num(el, key, fallback) {
    var v = parseFloat(el.dataset[key]);
    return isNaN(v) ? fallback : v;
  }
  function ensurePositioned(el) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  }
  function make(tag, className, parent) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (parent) parent.appendChild(n);
    return n;
  }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  // Interpolation sur une durée ; une nouvelle animation sur le même élément annule la précédente
  function tween(el, duration, fn, done) {
    var run = el._fxRun = (el._fxRun || 0) + 1;
    if (reduced) { fn(1); if (done) done(); return; }
    var start = null;
    function frame(t) {
      if (run !== el._fxRun) return;
      if (start === null) start = t;
      var p = Math.min((t - start) / duration, 1);
      fn(p);
      if (p < 1) raf(frame);
      else if (done) done();
    }
    raf(frame);
  }

  // --- Découpages de texte --------------------------------------------------

  // Lettres (.fx-char), regroupées par mot pour garder les coupures de ligne
  function splitChars(el) {
    if (el.dataset.fxSplit) return;
    el.dataset.fxSplit = '1';
    var text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var i = 0;
    text.split(/(\s+)/).forEach(function (word) {
      if (/^\s+$/.test(word)) { el.appendChild(document.createTextNode(' ')); return; }
      var w = make('span', 'fx-wordbox', el);
      w.setAttribute('aria-hidden', 'true');
      Array.from(word).forEach(function (ch) {
        var s = make('span', 'fx-char', w);
        s.textContent = ch;
        s.style.setProperty('--fx-i', i++);
      });
    });
    el.style.setProperty('--fx-n', i);
  }

  // Mots (.fx-word)
  function splitWords(el) {
    if (el.dataset.fxSplit) return;
    el.dataset.fxSplit = '1';
    var text = el.textContent.trim().replace(/\s+/g, ' ');
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var words = text.split(' ');
    words.forEach(function (word, i) {
      var s = make('span', 'fx-word', el);
      s.setAttribute('aria-hidden', 'true');
      s.textContent = word;
      s.style.setProperty('--fx-i', i);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
    el.style.setProperty('--fx-n', words.length);
  }

  // Lignes visuelles (.fx-line > span), à refaire si la largeur change
  function splitLines(el) {
    if (!el.dataset.fxText) {
      // Les <br> du texte d'origine deviennent des retours à la ligne forcés
      el.querySelectorAll('br').forEach(function (br) { br.replaceWith(' \n '); });
      el.dataset.fxText = el.textContent.trim().replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, ' \n ');
    }
    var text = el.dataset.fxText;
    el.setAttribute('aria-label', text.replace(/ \n /g, ' '));
    el.textContent = '';
    var spans = [];
    text.split(' ').forEach(function (word) {
      if (word === '\n') { el.appendChild(document.createElement('br')); return; }
      if (spans.length) el.appendChild(document.createTextNode(' '));
      var s = make('span', '', el);
      s.textContent = word;
      s.style.display = 'inline-block';
      spans.push(s);
    });
    var lines = [];
    var top = null;
    spans.forEach(function (s) {
      if (s.offsetTop !== top) { lines.push([]); top = s.offsetTop; }
      lines[lines.length - 1].push(s.textContent);
    });
    el.textContent = '';
    lines.forEach(function (words, i) {
      var line = make('span', 'fx-line', el);
      line.setAttribute('aria-hidden', 'true');
      var inner = make('span', '', line);
      inner.textContent = words.join(' ');
      inner.style.setProperty('--fx-i', i);
    });
  }

  // --- Visibilité, entrées, défilement -------------------------------------

  var pending = new Set();
  var scrollEls = new Set();
  var resizers = [];
  var lastY = window.scrollY;
  var velocity = 0;
  var smoothVelocity = 0;
  var scrollDir = 1;

  var visIO = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { e.target._fxVisible = e.isIntersecting; });
      }, { rootMargin: '120px 0px' })
    : null;

  function watchVisibility(el) {
    if (visIO) visIO.observe(el);
    else el._fxVisible = true;
  }

  var observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) settle(entry.target);
        });
      }, { threshold: 0, rootMargin: '0px 0px -12% 0px' })
    : null;

  function settle(el) {
    enter(el);
    if (el.dataset.fxRepeat !== 'true') {
      observer.unobserve(el);
      pending.delete(el);
    }
  }

  function updateScroll() {
    var vh = window.innerHeight;
    scrollEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var info = {
        enter: clamp((vh - r.top) / (vh * 0.85), 0, 1),
        pass: clamp((vh - r.top) / (vh + r.height), 0, 1),
        rect: r,
        vh: vh
      };
      el.style.setProperty('--fx-p', info.enter.toFixed(3));
      el.style.setProperty('--fx-pass', info.pass.toFixed(3));
      var d = defs[el.dataset.fx];
      if (d && typeof d.scroll === 'function') d.scroll(el, info);
    });
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    velocity = clamp(y - lastY, -120, 120);
    if (velocity) scrollDir = velocity > 0 ? 1 : -1;
    lastY = y;
    startLoop();
    if (ticking) return;
    ticking = true;
    raf(function () {
      ticking = false;
      updateScroll();
      // Filet de sécurité : un défilement rapide (ou un saut d'ancre) peut faire passer
      // un élément au-dessus de l'écran sans qu'il ait été détecté. On le révèle quand même.
      pending.forEach(function (el) {
        if (!el.classList.contains('fx-in') && el.getBoundingClientRect().bottom < 0) settle(el);
      });
    });
  }, { passive: true });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resizers.forEach(function (fn) { fn(); });
      updateScroll();
    }, 150);
  });

  // --- Boucle d'animation partagée -----------------------------------------

  var tickers = [];
  var looping = false;
  var lastT = 0;

  // fn(dt, temps) est appelée à chaque image tant que l'élément est visible
  // (ou toujours si el est null)
  function addTicker(el, fn) {
    if (el) watchVisibility(el);
    tickers.push({ el: el, fn: fn });
    startLoop();
  }

  function startLoop() {
    if (looping) return;
    looping = true;
    raf(loop);
  }

  function loop(t) {
    var dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0;
    lastT = t;
    smoothVelocity += (velocity - smoothVelocity) * 0.12;
    velocity *= 0.88;
    for (var i = 0; i < tickers.length; i++) {
      var tk = tickers[i];
      if (tk.el && (!tk.el._fxVisible || !tk.el.isConnected)) continue;
      tk.fn(dt, t);
    }
    raf(loop);
  }

  // --- Transitions plein écran ---------------------------------------------

  function overlay(name, pieces) {
    var o = make('div', 'fx-tr fx-tr-' + name);
    o.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < pieces; i++) {
      var p = make('i', '', o);
      p.style.setProperty('--fx-i', i);
    }
    o.style.setProperty('--fx-n', pieces);
    document.body.appendChild(o);
    return o;
  }

  function uncover(o, tr) {
    o.classList.remove('fx-cover');
    o.classList.add('fx-uncover');
    setTimeout(function () { o.remove(); }, tr.uncover || 1200);
  }

  // Recouvre l'écran, appelle callback, puis découvre (sauf si keep, pour une navigation)
  function play(name, callback, event, keep) {
    var d = defs[name];
    if (typeof callback !== 'function') callback = null;
    if (!d || !d.transition || reduced) { if (callback) callback(); return; }
    var tr = d.transition;
    if (tr.custom) { tr.custom(callback, event); return; }
    var o = overlay(name, tr.pieces || 1);
    var x = event && event.clientX != null ? event.clientX : window.innerWidth / 2;
    var y = event && event.clientY != null ? event.clientY : window.innerHeight / 2;
    o.style.setProperty('--fx-x', x + 'px');
    o.style.setProperty('--fx-y', y + 'px');
    o._fxEvent = event;
    if (tr.build) tr.build(o);
    raf(function () { raf(function () { o.classList.add('fx-cover'); }); });
    setTimeout(function () {
      if (callback) callback();
      if (!keep) uncover(o, tr);
    }, tr.cover || 900);
  }

  function arrive() {
    var name = null;
    try { name = sessionStorage.getItem('fx-arrive'); sessionStorage.removeItem('fx-arrive'); } catch (err) {}
    var d = name && defs[name];
    if (!d || !d.transition || d.transition.custom || reduced) return;
    var o = overlay(name, d.transition.pieces || 1);
    o._fxArrive = true;
    if (d.transition.build) d.transition.build(o);
    o.classList.add('fx-cover', 'fx-instant');
    raf(function () { raf(function () { o.classList.remove('fx-instant'); uncover(o, d.transition); }); });
  }

  // Joue une transition puis change de page ; la page suivante la termine
  function go(name, href, event) {
    var d = defs[name];
    if (!d || !d.transition || d.transition.custom || reduced) { window.location.href = href; return; }
    play(name, function () {
      try { sessionStorage.setItem('fx-arrive', name); } catch (err) {}
      window.location.href = href;
    }, event, true);
  }

  // Un lien portant une transition la joue avant de changer de page
  function bindLink(el, name) {
    el.addEventListener('click', function (e) {
      var href = el.getAttribute('href');
      if (!href || href.charAt(0) === '#' || e.metaKey || e.ctrlKey || e.shiftKey || el.target === '_blank') return;
      e.preventDefault();
      go(name, href, e);
    });
  }

  // --- Cycle de vie des effets ---------------------------------------------

  function enter(el) {
    el.classList.add('fx-in');
    var d = defs[el.dataset.fx];
    if (d && d.enter) d.enter(el);
  }

  function init(root) {
    // data-fx-tr : une transition sur un lien qui porte déjà un autre effet
    (root || document).querySelectorAll('a[data-fx-tr]').forEach(function (el) {
      if (el.dataset.fxTrReady) return;
      el.dataset.fxTrReady = '1';
      var d = defs[el.dataset.fxTr];
      if (d && d.transition) bindLink(el, el.dataset.fxTr);
    });
    (root || document).querySelectorAll('[data-fx]').forEach(function (el) {
      if (el.dataset.fxReady) return;
      el.dataset.fxReady = '1';
      var d = defs[el.dataset.fx];
      if (!d) return;
      if (d.setup) d.setup(el);
      if (d.scroll) { scrollEls.add(el); }
      if (d.tick) addTicker(el, function (dt, t) { d.tick(el, dt, t); });
      if (d.transition && el.tagName === 'A') bindLink(el, el.dataset.fx);
      if (d.trigger && d.triggerOn) {
        el.addEventListener(d.triggerOn, function (e) { d.trigger(el, e); });
      }
      if (d.entrance) {
        el.classList.add('fx-entrance');
        if (observer && !reduced) { observer.observe(el); pending.add(el); }
        else enter(el);
      }
    });
    updateScroll();
  }

  // Rejoue une entrée (utile pour les démos ou un contenu rechargé)
  function replay(el) {
    var d = defs[el.dataset.fx];
    el.classList.remove('fx-in');
    if (d && d.reset) d.reset(el);
    void el.offsetWidth; // force le navigateur à repartir de l'état initial
    raf(function () { raf(function () { enter(el); }); });
  }

  // Déclenche un effet ponctuel (secousse, confettis…) sur un élément
  function trigger(el, event) {
    var d = defs[el.dataset.fx];
    if (d && d.trigger) d.trigger(el, event);
    else if (d && d.entrance) replay(el);
  }

  function register(name, def) {
    defs[name] = def || {};
  }

  window.FX = {
    init: init,
    replay: replay,
    trigger: trigger,
    play: play,
    go: go,
    register: register,
    isEntrance: function (name) { return !!(defs[name] && defs[name].entrance); },
    has: function (name) { return !!defs[name]; },
    names: function () { return Object.keys(defs); },
    util: {
      reduced: reduced,
      canHover: canHover,
      raf: raf,
      GLYPHS: GLYPHS,
      clamp: clamp,
      lerp: lerp,
      rand: rand,
      cssVar: cssVar,
      num: num,
      make: make,
      ensurePositioned: ensurePositioned,
      easeOut: easeOut,
      easeInOut: easeInOut,
      tween: tween,
      splitChars: splitChars,
      splitWords: splitWords,
      splitLines: splitLines,
      addTicker: addTicker,
      watchVisibility: watchVisibility,
      onResize: function (fn) { resizers.push(fn); },
      velocity: function () { return smoothVelocity; },
      scrollDir: function () { return scrollDir; }
    },
    _boot: function () {
      function go() { arrive(); init(); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
      else go();
    }
  };
})();

/* Pack 00 — les 22 effets d'origine */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Entrées purement CSS : il suffit de les déclarer comme entrées
  ['curtain-soft', 'blur-in', 'pill-grow'].forEach(function (name) {
    FX.register(name, { entrance: true });
  });
  FX.register('text-split', { entrance: true, setup: U.splitChars });
  FX.register('line-mask', { entrance: true, setup: U.splitLines });
  U.onResize(function () {
    document.querySelectorAll('[data-fx="line-mask"]').forEach(U.splitLines);
  });

  FX.register('rise-stagger', {
    entrance: true,
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (child, i) {
        child.style.setProperty('--fx-i', i);
      });
    }
  });

  FX.register('count-up', {
    entrance: true,
    enter: function (el) {
      var to = parseFloat(el.dataset.fxTo || el.textContent.replace(/[^\d.-]/g, '')) || 0;
      var decimals = U.num(el, 'fxDecimals', 0);
      var fmt = new Intl.NumberFormat(document.documentElement.lang || undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
      U.tween(el, U.num(el, 'fxDuration', 1600), function (p) {
        el.textContent = fmt.format(to * (1 - Math.pow(1 - p, 4)));
      });
    }
  });

  // --- text-scramble --------------------------------------------------------

  // Remplace chaque lettre par un signe aléatoire (état de départ du brouillage)
  function garble(el) {
    if (U.reduced) return;
    el.textContent = Array.from(el.dataset.fxText).map(function (ch) {
      return ch === ' ' ? ' ' : U.GLYPHS[(Math.random() * U.GLYPHS.length) | 0];
    }).join('');
  }

  function scrambleTo(el) {
    var target = el.dataset.fxText;
    // Chaque lettre se fixe à un instant différent, globalement de gauche à droite
    var marks = Array.from(target).map(function (_, i, a) {
      return (i / a.length) * 0.6 + Math.random() * 0.4;
    });
    U.tween(el, U.num(el, 'fxDuration', 1200), function (p) {
      var out = '';
      for (var i = 0; i < target.length; i++) {
        var ch = target[i];
        out += (p >= marks[i] || ch === ' ') ? ch : U.GLYPHS[(Math.random() * U.GLYPHS.length) | 0];
      }
      el.textContent = out;
    });
  }

  FX.register('text-scramble', {
    entrance: true,
    setup: function (el) {
      el.dataset.fxText = el.textContent;
      el.setAttribute('aria-label', el.dataset.fxText);
      garble(el);
      if (el.dataset.fxHover === 'true') {
        el.addEventListener('pointerenter', function () { scrambleTo(el); });
      }
    },
    reset: garble,
    enter: scrambleTo
  });

  // --- pixel-dissolve -------------------------------------------------------

  function paintPixels(el, progress) {
    var c = el._fxCanvas;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) c.width = Math.round(r.width * dpr);
    if (c.height !== Math.round(r.height * dpr)) c.height = Math.round(r.height * dpr);
    var cols = U.num(el, 'fxCols', 14);
    var size = c.width / cols;
    var rows = Math.ceil(c.height / size);
    var total = cols * rows;
    if (!el._fxOrder || el._fxOrder.length !== total) {
      // Ordre aléatoire de disparition, recalculé seulement si la grille change
      el._fxOrder = Array.from({ length: total }, function (_, i) { return i; });
      for (var k = total - 1; k > 0; k--) {
        var j = (Math.random() * (k + 1)) | 0;
        var tmp = el._fxOrder[k]; el._fxOrder[k] = el._fxOrder[j]; el._fxOrder[j] = tmp;
      }
    }
    var order = el._fxOrder;
    var ctx = c.getContext('2d');
    var main = U.cssVar(el, '--fx-pixel-color', '#ff5b2e');
    var alt = U.cssVar(el, '--fx-pixel-alt', '#14141a');
    var gone = Math.floor(progress * total);
    var band = Math.ceil(total * 0.08);
    ctx.clearRect(0, 0, c.width, c.height);
    for (var n = gone; n < total; n++) {
      var idx = order[n];
      var x = (idx % cols) * size;
      var y = Math.floor(idx / cols) * size;
      // Les cases sur le point de disparaître changent de teinte : effet de scintillement
      ctx.fillStyle = (n < gone + band && progress > 0) ? alt : main;
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(size) + 1, Math.ceil(size) + 1);
    }
  }

  FX.register('pixel-dissolve', {
    entrance: true,
    setup: function (el) {
      if (U.reduced) return;
      U.ensurePositioned(el);
      var c = U.make('canvas', 'fx-pixels', el);
      c.setAttribute('aria-hidden', 'true');
      el._fxCanvas = c;
      paintPixels(el, 0);
    },
    enter: function (el) {
      if (!el._fxCanvas) return;
      el._fxOrder = null;
      paintPixels(el, 0);
      var delay = U.num(el, 'fxDelay', 0);
      setTimeout(function () {
        U.tween(el, U.num(el, 'fxDuration', 1100), function (p) {
          paintPixels(el, p * p * (3 - 2 * p));
        });
      }, delay);
    }
  });

  // --- preloader ------------------------------------------------------------

  FX.register('preloader', {
    entrance: true,
    setup: function (el) {
      el.innerHTML =
        '<div class="fx-pre-label"></div>' +
        '<div class="fx-pre-num">0</div>' +
        '<div class="fx-pre-bar"><i></i></div>';
      el.querySelector('.fx-pre-label').textContent = el.dataset.fxLabel || 'Chargement';
      el.setAttribute('role', 'status');
    },
    enter: function (el) {
      el.classList.remove('fx-done');
      var num = el.querySelector('.fx-pre-num');
      if (U.reduced) { el.classList.add('fx-done'); return; }
      var last = 0;
      U.tween(el, U.num(el, 'fxDuration', 2200), function (p) {
        // Mise à jour par paliers : un compteur « mécanique » plutôt que fluide
        var now = performance.now();
        if (now - last < 70 && p < 1) return;
        last = now;
        var v = Math.round(100 * U.easeInOut(p));
        num.textContent = v;
        el.style.setProperty('--fx-p', v / 100);
      }, function () {
        setTimeout(function () {
          el.classList.add('fx-done');
          el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true }));
        }, 250);
      });
    }
  });

  // --- scroll-expand --------------------------------------------------------

  FX.register('scroll-expand', { scroll: true });

  // --- marquee --------------------------------------------------------------

  FX.register('marquee', {
    setup: function (el) {
      var track = U.make('div', 'fx-marquee-track');
      var unit = U.make('div', 'fx-marquee-unit', track);
      while (el.firstChild) unit.appendChild(el.firstChild);
      el.appendChild(track);
      el._fxM = { track: track, unit: unit, x: 0, w: 0 };
      // Copies supplémentaires pour remplir la largeur (masquées aux lecteurs d'écran)
      el._fxM.fill = function () {
        var m = el._fxM;
        m.w = unit.offsetWidth;
        if (!m.w) return;
        while (track.children.length > 1) track.removeChild(track.lastChild);
        var copies = Math.ceil(el.offsetWidth / m.w) + 1;
        for (var i = 0; i < copies; i++) {
          var clone = unit.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          track.appendChild(clone);
        }
      };
      el._fxM.fill();
      U.onResize(el._fxM.fill);
    },
    tick: function (el, dt) {
      var m = el._fxM;
      if (U.reduced) return;
      if (!m.w) m.fill();
      if (!m.w) return;
      var boost = Math.abs(U.velocity()) / 10;
      m.x += U.num(el, 'fxDirection', -1) * U.scrollDir() * U.num(el, 'fxSpeed', 60) * (1 + boost) * dt;
      if (m.x <= -m.w) m.x += m.w;
      if (m.x > 0) m.x -= m.w;
      m.track.style.transform = 'translate3d(' + m.x.toFixed(2) + 'px,0,0)';
    }
  });

  // --- dot-grid -------------------------------------------------------------

  FX.register('dot-grid', {
    setup: function (el) {
      U.ensurePositioned(el);
      var c = U.make('canvas', 'fx-dot-canvas');
      c.setAttribute('aria-hidden', 'true');
      el.insertBefore(c, el.firstChild);
      var d = el._fxD = { c: c, x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, s: 0, ts: 0, dirty: true };
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        d.tx = e.clientX - r.left;
        d.ty = e.clientY - r.top;
        if (d.s === 0) { d.x = d.tx; d.y = d.ty; }
        d.ts = 1;
      });
      el.addEventListener('pointerleave', function () { d.ts = 0; });
      if ('ResizeObserver' in window) new ResizeObserver(function () { d.dirty = true; }).observe(el);
    },
    tick: function (el) {
      var d = el._fxD;
      var moving = Math.abs(d.tx - d.x) > 0.3 || Math.abs(d.ty - d.y) > 0.3 || Math.abs(d.ts - d.s) > 0.01;
      if (!d.dirty && !moving) return;
      d.dirty = false;
      var ease = U.reduced ? 1 : 0.14;
      d.x += (d.tx - d.x) * ease;
      d.y += (d.ty - d.y) * ease;
      d.s += (d.ts - d.s) * ease;
      var r = el.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var W = Math.round(r.width * dpr);
      var H = Math.round(r.height * dpr);
      if (d.c.width !== W) d.c.width = W;
      if (d.c.height !== H) d.c.height = H;
      var ctx = d.c.getContext('2d');
      var gap = U.num(el, 'fxGap', 24);
      var reach = U.num(el, 'fxReach', 160);
      var base = U.cssVar(el, '--fx-dot-color', 'rgba(255,255,255,.22)');
      var hot = U.cssVar(el, '--fx-dot-accent', '#ff5b2e');
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.scale(dpr, dpr);
      for (var y = gap / 2; y < r.height; y += gap) {
        for (var x = gap / 2; x < r.width; x += gap) {
          var k = d.s * Math.pow(Math.max(0, 1 - Math.hypot(x - d.x, y - d.y) / reach), 2);
          ctx.fillStyle = k > 0.12 ? hot : base;
          ctx.beginPath();
          ctx.arc(x, y, 1.1 + k * 3.4, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  });

  // --- cursor ---------------------------------------------------------------

  var cursor = null;
  var cur = { x: 0, y: 0, tx: 0, ty: 0, seen: false };

  FX.register('cursor', {
    setup: function (el) {
      if (U.reduced || !U.canHover) return;
      if (!cursor) {
        cursor = U.make('div', 'fx-cursor', document.body);
        cursor.setAttribute('aria-hidden', 'true');
        U.make('span', '', cursor);
        U.addTicker(null, function () {
          cur.x += (cur.tx - cur.x) * 0.2;
          cur.y += (cur.ty - cur.y) * 0.2;
          cursor.style.transform = 'translate3d(' + cur.x.toFixed(1) + 'px,' + cur.y.toFixed(1) + 'px,0)';
        });
      }
      el.addEventListener('pointerenter', function () { cursor.classList.add('fx-on'); });
      el.addEventListener('pointerleave', function () { cursor.classList.remove('fx-on'); });
      el.addEventListener('pointermove', function (e) {
        cur.tx = e.clientX;
        cur.ty = e.clientY;
        if (!cur.seen) { cur.x = cur.tx; cur.y = cur.ty; cur.seen = true; }
      });
      el.addEventListener('pointerover', function (e) {
        var t = e.target.closest('a, button, [data-fx-cursor-label]');
        var label = t && t.dataset.fxCursorLabel;
        cursor.classList.toggle('fx-grow', !!t);
        cursor.classList.toggle('fx-label', !!label);
        cursor.firstChild.textContent = label || '';
      });
    }
  });

  // --- page-wipe ------------------------------------------------------------

  FX.register('page-wipe', { transition: { pieces: 2, cover: 950, uncover: 1200 } });
  // Ancien nom de l'API, conservé
  FX.wipe = function (callback, keep) { FX.play('page-wipe', callback, null, keep); };

  // --- magnetic / tilt-card -------------------------------------------------

  FX.register('magnetic', {
    setup: function (el) {
      var strength = U.num(el, 'fxStrength', 0.35);
      el.addEventListener('pointermove', function (e) {
        if (U.reduced) return;
        var r = el.getBoundingClientRect();
        el.classList.add('fx-active');
        el.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2) * strength + 'px,' +
          (e.clientY - r.top - r.height / 2) * strength + 'px)';
      });
      el.addEventListener('pointerleave', function () {
        el.classList.remove('fx-active');
        el.style.transform = '';
      });
    }
  });

  FX.register('tilt-card', {
    setup: function (el) {
      var max = U.num(el, 'fxMax', 10);
      el.addEventListener('pointermove', function (e) {
        if (U.reduced) return;
        var r = el.getBoundingClientRect();
        el.classList.add('fx-active');
        el.style.setProperty('--fx-ry', (((e.clientX - r.left) / r.width - 0.5) * max * 2).toFixed(2) + 'deg');
        el.style.setProperty('--fx-rx', (-((e.clientY - r.top) / r.height - 0.5) * max * 2).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () {
        el.classList.remove('fx-active');
        el.style.setProperty('--fx-rx', '0deg');
        el.style.setProperty('--fx-ry', '0deg');
      });
    }
  });

  FX.register('roll-text', { setup: U.splitChars });

  // Effets purement CSS, sans comportement JavaScript
  ['underline-draw', 'corner-marks', 'scanlines', 'shimmer'].forEach(function (name) {
    FX.register(name, {});
  });
})(window.FX);

/* Pack 01 — Entrées */
(function (FX) {
  'use strict';
  var U = FX.util;

  [
    'fade-up', 'slide-in', 'zoom-in-soft', 'flip-up', 'swing-in', 'iris-open', 'diagonal-wipe',
    'split-reveal', 'block-reveal', 'stretch-in', 'skew-up', 'drop-bounce', 'pop-in', 'blinds-open',
    'ink-spread', 'fold-down', 'lift-shadow', 'rule-draw'
  ].forEach(function (name) { FX.register(name, { entrance: true }); });

  // Ordre diagonal : rangée + colonne, mesurées sur la grille réelle
  function orderTiles(el) {
    var kids = Array.prototype.slice.call(el.children);
    var tops = [];
    var lefts = [];
    kids.forEach(function (k) {
      if (tops.indexOf(k.offsetTop) === -1) tops.push(k.offsetTop);
      if (lefts.indexOf(k.offsetLeft) === -1) lefts.push(k.offsetLeft);
    });
    tops.sort(function (a, b) { return a - b; });
    lefts.sort(function (a, b) { return a - b; });
    kids.forEach(function (k) {
      k.style.setProperty('--fx-i', tops.indexOf(k.offsetTop) + lefts.indexOf(k.offsetLeft));
    });
  }
  FX.register('tile-cascade', { entrance: true, setup: orderTiles });
  U.onResize(function () { document.querySelectorAll('[data-fx="tile-cascade"]').forEach(orderTiles); });

  function scatter(el) {
    var spread = U.num(el, 'fxSpread', 140);
    Array.prototype.forEach.call(el.children, function (k, i) {
      k.style.setProperty('--fx-i', i);
      k.style.setProperty('--fx-x', U.rand(-spread, spread).toFixed(0) + 'px');
      k.style.setProperty('--fx-y', U.rand(-spread, spread).toFixed(0) + 'px');
      k.style.setProperty('--fx-r', U.rand(-90, 90).toFixed(0) + 'deg');
    });
  }
  FX.register('scatter-gather', { entrance: true, setup: scatter, reset: scatter });
})(window.FX);

/* Pack 02 — Texte */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Garde le texte d'origine pour les pseudo-éléments (::before / ::after)
  function copyText(el) { el.dataset.fxCopy = el.textContent.trim(); }

  FX.register('typewriter', {
    entrance: true,
    setup: function (el) {
      el.dataset.fxText = el.textContent.trim();
      el.setAttribute('aria-label', el.dataset.fxText);
      el.style.minHeight = el.offsetHeight + 'px';
      if (!U.reduced) el.textContent = '';
    },
    reset: function (el) { el.textContent = ''; },
    enter: function (el) {
      var text = el.dataset.fxText;
      var speed = U.num(el, 'fxSpeed', 45);
      U.tween(el, text.length * speed, function (p) {
        el.textContent = text.slice(0, Math.round(p * text.length));
      });
    }
  });

  FX.register('word-rise', { entrance: true, setup: U.splitWords });
  FX.register('wave-text', { setup: U.splitChars });
  FX.register('glitch-text', { setup: copyText });
  FX.register('slice-hover', { setup: copyText });
  ['gradient-flow', 'stroke-fill', 'neon-flicker', 'wavy-underline', 'image-text'].forEach(function (n) {
    FX.register(n, {});
  });
  ['highlight-sweep', 'strike-draw', 'track-in', 'long-shadow'].forEach(function (n) {
    FX.register(n, { entrance: true });
  });
  FX.register('char-flip', { entrance: true, setup: U.splitChars });

  FX.register('letter-focus', {
    entrance: true,
    setup: function (el) {
      U.splitChars(el);
      el.querySelectorAll('.fx-char').forEach(function (c) {
        c.style.setProperty('--fx-r', Math.random().toFixed(2));
      });
    }
  });

  // --- proximity-weight -----------------------------------------------------

  FX.register('proximity-weight', {
    setup: function (el) {
      U.splitChars(el);
      var chars = Array.prototype.slice.call(el.querySelectorAll('.fx-char'));
      var reach = U.num(el, 'fxReach', 120);
      var queued = null;
      function update(x, y) {
        chars.forEach(function (c) {
          var r = c.getBoundingClientRect();
          var d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
          c.style.setProperty('--fx-k', Math.max(0, 1 - d / reach).toFixed(2));
        });
      }
      el.addEventListener('pointermove', function (e) {
        if (U.reduced) return;
        if (queued) return;
        queued = U.raf(function () { queued = null; update(e.clientX, e.clientY); });
      });
      el.addEventListener('pointerleave', function () { update(-1e4, -1e4); });
    }
  });

  // --- word-rotator ---------------------------------------------------------

  FX.register('word-rotator', {
    setup: function (el) {
      var words = (el.dataset.fxWords || el.textContent).split('|').map(function (w) { return w.trim(); });
      el.setAttribute('aria-label', words.join(', '));
      el.textContent = '';
      var spans = words.map(function (w) {
        var s = U.make('span', '', el);
        s.textContent = w;
        s.setAttribute('aria-hidden', 'true');
        return s;
      });
      var i = 0;
      spans[0].classList.add('fx-cur');
      function fit() { el.style.width = spans[i].offsetWidth + 'px'; }
      fit();
      U.onResize(fit);
      if (U.reduced || spans.length < 2) return;
      var timer = setInterval(function () {
        if (!el.isConnected) { clearInterval(timer); return; }
        var prev = spans[i];
        i = (i + 1) % spans.length;
        spans.forEach(function (s) { s.classList.remove('fx-prev'); });
        prev.classList.remove('fx-cur');
        prev.classList.add('fx-prev');
        spans[i].classList.add('fx-cur');
        fit();
      }, U.num(el, 'fxInterval', 2200));
    }
  });

  // --- odometer -------------------------------------------------------------

  FX.register('odometer', {
    entrance: true,
    setup: function (el) {
      var text = el.textContent.trim();
      el.setAttribute('aria-label', text);
      el.textContent = '';
      var col = 0;
      Array.from(text).forEach(function (ch) {
        if (!/\d/.test(ch)) {
          var s = U.make('span', '', el);
          s.textContent = ch;
          s.setAttribute('aria-hidden', 'true');
          return;
        }
        var c = U.make('span', 'fx-odo-col', el);
        c.setAttribute('aria-hidden', 'true');
        var strip = U.make('span', '', c);
        strip.textContent = '0\n1\n2\n3\n4\n5\n6\n7\n8\n9';
        strip.style.setProperty('--fx-d', ch);
        strip.style.setProperty('--fx-i', col++);
      });
    }
  });

  // --- scroll-ink -----------------------------------------------------------

  FX.register('scroll-ink', {
    setup: U.splitWords,
    scroll: function (el, info) {
      var words = el._fxWords || (el._fxWords = el.querySelectorAll('.fx-word'));
      var r = info.rect;
      var p = U.reduced ? 1 : U.clamp((info.vh * 0.85 - r.top) / (r.height + info.vh * 0.45), 0, 1);
      var on = Math.round(p * words.length);
      if (on === el._fxOn) return;
      el._fxOn = on;
      for (var i = 0; i < words.length; i++) words[i].classList.toggle('fx-on', i < on);
    }
  });

  // --- velocity-stretch -----------------------------------------------------

  FX.register('velocity-stretch', {
    tick: function (el) {
      if (U.reduced) return;
      var v = U.velocity();
      var k = U.clamp(Math.abs(v) / 50, 0, 0.7);
      el._fxK = U.lerp(el._fxK || 0, k, 0.15);
      el.style.transform = 'scaleY(' + (1 + el._fxK).toFixed(3) + ') skewX(' + (-U.clamp(v, -40, 40) / 4).toFixed(2) + 'deg)';
    }
  });

  FX.register('edge-label', { scroll: true });
})(window.FX);

/* Pack 03 — Micro-interactions (survol, clic) */
(function (FX) {
  'use strict';
  var U = FX.util;

  [
    'fill-up', 'border-trace', 'shine-sweep', 'press-squash', 'lift-hover', 'jelly', 'conic-border',
    'underline-fill', 'zoom-frame', 'tooltip-pop', 'switch-morph', 'blob-morph', 'pulse-ring', 'invert-sweep'
  ].forEach(function (n) { FX.register(n, {}); });

  FX.register('ripple-click', {
    setup: function (el) {
      el.addEventListener('pointerdown', function (e) {
        if (U.reduced) return;
        var r = el.getBoundingClientRect();
        var size = Math.max(r.width, r.height) * 2.2;
        var s = U.make('span', 'fx-ripple', el);
        s.style.width = s.style.height = size + 'px';
        s.style.left = (e.clientX - r.left - size / 2) + 'px';
        s.style.top = (e.clientY - r.top - size / 2) + 'px';
        setTimeout(function () { s.remove(); }, 700);
      });
    }
  });

  FX.register('spotlight-card', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--fx-my', (e.clientY - r.top) + 'px');
      });
    }
  });

  FX.register('icon-nudge', {
    setup: function (el) { if (!el.dataset.fxIcon) el.dataset.fxIcon = '→'; }
  });

  FX.register('swap-text', {
    setup: function (el) {
      var text = el.textContent.trim();
      var alt = el.dataset.fxAlt || text;
      el.textContent = '';
      var box = U.make('span', 'fx-swap', el);
      var a = U.make('span', '', box);
      a.textContent = text;
      var b = U.make('span', '', box);
      b.textContent = alt;
      b.setAttribute('aria-hidden', 'true');
    }
  });

  FX.register('click-burst', {
    triggerOn: 'click',
    trigger: function (el) {
      if (U.reduced) return;
      var n = U.num(el, 'fxCount', 12);
      var reach = U.num(el, 'fxReach', 70);
      for (var i = 0; i < n; i++) {
        var s = U.make('span', 'fx-spark', el);
        var a = (i / n) * Math.PI * 2 + U.rand(-0.2, 0.2);
        var d = reach * U.rand(0.6, 1.1);
        s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(1) + 'px');
        s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(1) + 'px');
        setTimeout(s.remove.bind(s), 700);
      }
    }
  });

  FX.register('shake', {
    trigger: function (el) {
      el.classList.remove('fx-shaking');
      void el.offsetWidth;
      el.classList.add('fx-shaking');
      if (navigator.vibrate && el.dataset.fxVibrate === 'true') navigator.vibrate(80);
    }
  });

  FX.register('fan-out', {
    setup: function (el) {
      var kids = el.children;
      Array.prototype.forEach.call(kids, function (k, i) { k.style.setProperty('--fx-i', i); });
      el.style.setProperty('--fx-mid', (kids.length - 1) / 2);
    }
  });

  FX.register('depth-hover', {
    setup: function (el) {
      var range = U.num(el, 'fxRange', 24);
      var layers = Array.prototype.slice.call(el.querySelectorAll('[data-fx-depth]'));
      el.addEventListener('pointermove', function (e) {
        if (U.reduced) return;
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        layers.forEach(function (l) {
          var d = parseFloat(l.dataset.fxDepth) || 0;
          l.style.transform = 'translate(' + (px * range * d * 2).toFixed(1) + 'px,' + (py * range * d * 2).toFixed(1) + 'px)';
        });
      });
      el.addEventListener('pointerleave', function () {
        layers.forEach(function (l) { l.style.transform = ''; });
      });
    }
  });
})(window.FX);

/* Pack 04 — Défilement */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Effets entièrement pilotés par --fx-p / --fx-pass (posés par le moteur)
  [
    'parallax', 'scroll-rotate', 'scale-on-scroll', 'fade-exit', 'hero-shrink', 'scroll-unveil',
    'perspective-scroll', 'split-columns', 'blur-exit', 'fill-scroll'
  ].forEach(function (n) { FX.register(n, { scroll: true }); });

  // --- Défilement dans une boîte ou dans la page --------------------------

  // Premier ancêtre déclaré défilant (sinon la page). On ne teste pas s'il déborde déjà :
  // certains effets (pin-horizontal) ne le font déborder qu'après leur mise en place.
  function scrollParent(el) {
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var o = getComputedStyle(p).overflowY;
      if (o === 'auto' || o === 'scroll') return p;
    }
    return null;
  }

  function view(parent) {
    if (!parent) return { top: 0, h: window.innerHeight, w: window.innerWidth };
    var r = parent.getBoundingClientRect();
    return { top: r.top, h: parent.clientHeight, w: parent.clientWidth };
  }

  // Appelle update à chaque défilement de la page ou de la boîte qui contient l'élément
  function bindScroll(el, update) {
    var parent = scrollParent(el);
    var queued = false;
    function run() {
      if (queued) return;
      queued = true;
      U.raf(function () { queued = false; update(view(parent), parent); });
    }
    (parent || window).addEventListener('scroll', run, { passive: true });
    if (parent) window.addEventListener('scroll', run, { passive: true });
    U.onResize(run);
    run();
    return parent;
  }

  // Partagés avec les packs suivants (navigation…)
  U.scrollParent = scrollParent;
  U.bindScroll = bindScroll;

  // --- progress-bar ---------------------------------------------------------

  FX.register('progress-bar', {
    setup: function (el) {
      bindScroll(el, function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        el.style.setProperty('--fx-page', max > 0 ? (window.scrollY / max).toFixed(4) : 0);
      });
    }
  });

  // --- stack-cards ----------------------------------------------------------

  FX.register('stack-cards', {
    setup: function (el) {
      var kids = Array.prototype.slice.call(el.children);
      kids.forEach(function (k, i) { k.style.setProperty('--fx-i', i); });
      bindScroll(el, function () {
        if (U.reduced) return;
        kids.forEach(function (k, i) {
          var next = kids[i + 1];
          if (!next) return;
          var a = k.getBoundingClientRect();
          var b = next.getBoundingClientRect();
          var cover = U.clamp(1 - (b.top - a.top) / a.height, 0, 1);
          k.style.setProperty('--fx-s', (1 - cover * 0.08).toFixed(3));
          k.style.setProperty('--fx-shade', (1 - cover * 0.35).toFixed(3));
        });
      });
    }
  });

  // --- pin-horizontal -------------------------------------------------------

  FX.register('pin-horizontal', {
    setup: function (el) {
      var pin = U.make('div', 'fx-pin');
      var track = U.make('div', 'fx-track', pin);
      while (el.firstChild) track.appendChild(el.firstChild);
      el.appendChild(pin);
      bindScroll(el, function (v) {
        pin.style.height = v.h + 'px';
        var distance = Math.max(0, track.scrollWidth - v.w);
        el.style.height = (v.h + distance) + 'px';
        var r = el.getBoundingClientRect();
        var p = distance ? U.clamp((v.top - r.top) / distance, 0, 1) : 0;
        track.style.transform = 'translate3d(' + (-p * distance).toFixed(1) + 'px,0,0)';
      });
    }
  });

  // --- bg-shift -------------------------------------------------------------

  FX.register('bg-shift', {
    setup: function (el) {
      var scope = el.closest('[data-fx-bg-scope]') || document.body;
      bindScroll(el, function (v) {
        var r = el.getBoundingClientRect();
        var mid = v.top + v.h / 2;
        if (r.top <= mid && r.bottom > mid) {
          scope.style.backgroundColor = el.dataset.fxBg || '';
          if (el.dataset.fxColor) scope.style.color = el.dataset.fxColor;
        }
      });
    }
  });

  // --- scroll-count ---------------------------------------------------------

  FX.register('scroll-count', {
    setup: function (el) {
      el.dataset.fxTo = el.dataset.fxTo || el.textContent.replace(/[^\d.-]/g, '');
      el.setAttribute('aria-label', el.textContent.trim());
    },
    scroll: function (el, info) {
      var to = parseFloat(el.dataset.fxTo) || 0;
      var v = U.reduced ? to : Math.round(to * info.enter);
      if (v === el._fxV) return;
      el._fxV = v;
      el.textContent = v.toLocaleString(document.documentElement.lang || undefined);
    }
  });

  // --- path-scroll ----------------------------------------------------------

  FX.register('path-scroll', {
    setup: function (el) {
      el._fxPaths = Array.prototype.map.call(el.querySelectorAll('path'), function (p) {
        var len = p.getTotalLength();
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
        return { p: p, len: len };
      });
    },
    scroll: function (el, info) {
      var k = U.reduced ? 1 : U.clamp(info.pass * 1.4 - 0.15, 0, 1);
      el._fxPaths.forEach(function (o) { o.p.style.strokeDashoffset = (o.len * (1 - k)).toFixed(1); });
    }
  });

  // --- skew-scroll ----------------------------------------------------------

  FX.register('skew-scroll', {
    tick: function (el) {
      if (U.reduced) return;
      var target = U.clamp(U.velocity() * 0.18, -10, 10);
      el._fxK = U.lerp(el._fxK || 0, target, 0.12);
      if (Math.abs(el._fxK) < 0.01 && !el.style.transform) return;
      el.style.transform = 'skewY(' + el._fxK.toFixed(2) + 'deg)';
    }
  });

  // --- scatter-scroll -------------------------------------------------------

  FX.register('scatter-scroll', {
    scroll: true,
    setup: function (el) {
      U.splitChars(el);
      var spread = U.num(el, 'fxSpread', 160);
      el.querySelectorAll('.fx-char').forEach(function (c) {
        c.style.setProperty('--fx-rx', U.rand(-spread, spread).toFixed(0) + 'px');
        c.style.setProperty('--fx-ry', U.rand(-spread, spread * 0.4).toFixed(0) + 'px');
        c.style.setProperty('--fx-rr', U.rand(-120, 120).toFixed(0) + 'deg');
      });
    }
  });
})(window.FX);

/* Pack 05 — Transitions plein écran */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Place les pièces d'une grille (--c colonne, --r rangée) et un délai aléatoire --fx-r
  function grid(cols) {
    return function (o) {
      Array.prototype.forEach.call(o.children, function (p, i) {
        p.style.setProperty('--c', i % cols);
        p.style.setProperty('--r', Math.floor(i / cols));
        if ((i % cols + Math.floor(i / cols)) % 2) p.classList.add('fx-alt');
        p.style.setProperty('--fx-r', Math.random().toFixed(2));
      });
    };
  }

  FX.register('bands', { transition: { pieces: 5, cover: 950, uncover: 1000 } });
  FX.register('circle-expand', { transition: { pieces: 1, cover: 850, uncover: 900 } });
  FX.register('slash', { transition: { pieces: 1, cover: 820, uncover: 850 } });
  FX.register('pixel-wipe', { transition: { pieces: 96, cover: 760, uncover: 800, build: grid(12) } });
  FX.register('shutter', { transition: { pieces: 8, cover: 820, uncover: 850 } });
  FX.register('curtain-close', { transition: { pieces: 2, cover: 800, uncover: 850 } });
  FX.register('fade-through', { transition: { pieces: 1, cover: 520, uncover: 550 } });
  FX.register('zoom-through', { transition: { pieces: 1, cover: 850, uncover: 800 } });
  FX.register('push-slide', { transition: { pieces: 1, cover: 780, uncover: 800 } });
  FX.register('arc-rise', { transition: { pieces: 1, cover: 920, uncover: 950 } });
  FX.register('tile-flip', { transition: { pieces: 40, cover: 1000, uncover: 1050, build: grid(8) } });
  FX.register('iris', { transition: { pieces: 1, cover: 820, uncover: 850 } });

  FX.register('glitch-cut', {
    transition: {
      pieces: 10,
      cover: 650,
      uncover: 700,
      build: function (o) {
        Array.prototype.forEach.call(o.children, function (p, i) {
          p.style.setProperty('--fx-dir', i % 2 ? 1 : -1);
          p.style.setProperty('--fx-r', Math.random().toFixed(2));
        });
      }
    }
  });

  FX.register('title-card', {
    transition: {
      pieces: 1,
      cover: 1300,
      uncover: 950,
      build: function (o) {
        var src = o._fxEvent && o._fxEvent.target && o._fxEvent.target.closest && o._fxEvent.target.closest('[data-fx-title]');
        var t = U.make('span', 'fx-tr-title', o);
        var text = (src && src.dataset.fxTitle) || document.title;
        // À l'arrivée sur la page suivante, le carton garde le titre de départ
        try {
          if (o._fxArrive) text = sessionStorage.getItem('fx-title') || text;
          else sessionStorage.setItem('fx-title', text);
        } catch (err) {}
        t.textContent = text;
      }
    }
  });

  // Morphing natif du navigateur entre deux états de la page ; repli immédiat sinon
  FX.register('view-morph', {
    transition: {
      custom: function (callback) {
        // Onglet masqué : le navigateur attendrait un rendu pour appeler callback
        if (!document.startViewTransition || U.reduced || document.hidden) { if (callback) callback(); return; }
        var vt = document.startViewTransition(function () { if (callback) callback(); });
        // Une transition interrompue rejette ses promesses : ce n'est pas une erreur pour la page
        if (vt && vt.ready) vt.ready.catch(function () {});
        if (vt && vt.finished) vt.finished.catch(function () {});
      }
    }
  });
})(window.FX);

/* Pack 06 — Ambiances */
(function (FX) {
  'use strict';
  var U = FX.util;

  ['grain', 'aurora', 'gradient-drift', 'grid-floor', 'blob-bg', 'halftone', 'light-beams'].forEach(function (n) {
    FX.register(n, {});
  });

  // --- Calque canvas commun -------------------------------------------------

  function layer(el) {
    var c = U.make('canvas', 'fx-layer');
    c.setAttribute('aria-hidden', 'true');
    el.insertBefore(c, el.firstChild);
    var L = { c: c, ctx: c.getContext('2d'), w: 0, h: 0, drawn: false };
    L.fit = function () {
      var w = el.clientWidth;
      var h = el.clientHeight;
      if (w === L.w && h === L.h) return false;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      L.w = w;
      L.h = h;
      c.width = Math.max(1, w * dpr);
      c.height = Math.max(1, h * dpr);
      L.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.drawn = false;
      return true;
    };
    L.fit();
    if ('ResizeObserver' in window) new ResizeObserver(function () { L.fit(); }).observe(el);
    return L;
  }

  // Avec le mouvement réduit, on dessine une seule image fixe
  function frozen(L) {
    if (!U.reduced) return false;
    if (L.drawn) return true;
    L.drawn = true;
    return false;
  }

  function pointer(el, state) {
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      state.mx = e.clientX - r.left;
      state.my = e.clientY - r.top;
      state.inside = true;
    });
    el.addEventListener('pointerleave', function () { state.inside = false; });
  }

  // --- starfield ------------------------------------------------------------

  FX.register('starfield', {
    setup: function (el) {
      var L = el._fxL = layer(el);
      el._fxStars = Array.from({ length: U.num(el, 'fxCount', 220) }, function () {
        return { x: U.rand(-1, 1), y: U.rand(-1, 1), z: U.rand(0.05, 1) };
      });
      pointer(el, L);
    },
    tick: function (el, dt) {
      var L = el._fxL;
      if (frozen(L)) return;
      var ctx = L.ctx;
      var speed = U.num(el, 'fxSpeed', 0.25);
      var cx = L.w / 2 + (L.inside ? (L.mx - L.w / 2) * 0.15 : 0);
      var cy = L.h / 2 + (L.inside ? (L.my - L.h / 2) * 0.15 : 0);
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.fillStyle = U.cssVar(el, '--fx-star', '#f4f1ea');
      el._fxStars.forEach(function (s) {
        s.z -= speed * dt;
        if (s.z <= 0.02) { s.x = U.rand(-1, 1); s.y = U.rand(-1, 1); s.z = 1; }
        var k = 0.5 / s.z;
        var x = cx + s.x * L.w * k * 0.5;
        var y = cy + s.y * L.h * k * 0.5;
        if (x < 0 || y < 0 || x > L.w || y > L.h) return;
        var size = Math.max(0.4, (1 - s.z) * 2.4);
        ctx.globalAlpha = Math.min(1, (1 - s.z) * 1.5);
        ctx.fillRect(x, y, size, size);
      });
      ctx.globalAlpha = 1;
    }
  });

  // --- constellation --------------------------------------------------------

  FX.register('constellation', {
    setup: function (el) {
      var L = el._fxL = layer(el);
      el._fxPts = Array.from({ length: U.num(el, 'fxCount', 46) }, function () {
        return { x: Math.random(), y: Math.random(), vx: U.rand(-0.02, 0.02), vy: U.rand(-0.02, 0.02) };
      });
      pointer(el, L);
    },
    tick: function (el, dt) {
      var L = el._fxL;
      if (frozen(L)) return;
      var ctx = L.ctx;
      var link = U.num(el, 'fxLink', 110);
      var color = U.cssVar(el, '--fx-line', 'rgba(185, 167, 255, 1)');
      var dot = U.cssVar(el, '--fx-node', '#f4f1ea');
      var pts = el._fxPts.map(function (p) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        return { x: p.x * L.w, y: p.y * L.h };
      });
      if (L.inside) pts.push({ x: L.mx, y: L.my, cursor: true });
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.strokeStyle = color;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          var reach = pts[j].cursor ? link * 1.6 : link;
          if (d > reach) continue;
          ctx.globalAlpha = (1 - d / reach) * 0.7;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = dot;
      pts.forEach(function (p) { if (!p.cursor) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); });
    }
  });

  // --- wave-lines -----------------------------------------------------------

  FX.register('wave-lines', {
    setup: function (el) { el._fxL = layer(el); el._fxT = 0; },
    tick: function (el, dt) {
      var L = el._fxL;
      if (frozen(L)) return;
      var ctx = L.ctx;
      var n = U.num(el, 'fxLines', 14);
      var a = U.cssVar(el, '--fx-w1', '#ff5b2e');
      var b = U.cssVar(el, '--fx-w2', '#b9a7ff');
      el._fxT += dt * U.num(el, 'fxSpeed', 0.6);
      var t = el._fxT;
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.lineWidth = 1.4;
      for (var i = 0; i < n; i++) {
        var k = i / (n - 1);
        ctx.strokeStyle = k < 0.5 ? a : b;
        ctx.globalAlpha = 0.25 + 0.6 * Math.sin(k * Math.PI);
        ctx.beginPath();
        for (var x = 0; x <= L.w; x += 6) {
          var y = L.h * (0.25 + k * 0.5) +
            Math.sin(x * 0.012 + t + k * 2) * 18 * (0.5 + k) +
            Math.sin(x * 0.03 - t * 1.4) * 6;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  });

  // --- code-rain ------------------------------------------------------------

  FX.register('code-rain', {
    setup: function (el) { el._fxL = layer(el); el._fxAcc = 0; },
    tick: function (el, dt) {
      var L = el._fxL;
      var size = U.num(el, 'fxSize', 14);
      var cols = Math.ceil(L.w / size);
      if (!el._fxDrops || el._fxDrops.length !== cols) {
        el._fxDrops = Array.from({ length: cols }, function () { return U.rand(-30, 0); });
        L.ctx.clearRect(0, 0, L.w, L.h);
      }
      if (frozen(L)) return;
      el._fxAcc += dt;
      if (el._fxAcc < 0.055) return;
      el._fxAcc = 0;
      var ctx = L.ctx;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,.12)';
      ctx.fillRect(0, 0, L.w, L.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = size + 'px ui-monospace, Consolas, monospace';
      var color = U.cssVar(el, '--fx-rain', '#20c7a5');
      el._fxDrops.forEach(function (y, i) {
        var ch = U.GLYPHS[(Math.random() * U.GLYPHS.length) | 0];
        ctx.fillStyle = Math.random() < 0.08 ? '#eafff9' : color;
        ctx.fillText(ch, i * size, y * size);
        el._fxDrops[i] = (y * size > L.h && Math.random() > 0.97) ? 0 : y + 1;
      });
    }
  });

  // --- water-ripple ---------------------------------------------------------

  FX.register('water-ripple', {
    setup: function (el) {
      var L = el._fxL = layer(el);
      el._fxRings = [];
      el._fxAuto = 0;
      var last = 0;
      function drop(x, y, strength) {
        el._fxRings.push({ x: x, y: y, r: 0, a: strength });
      }
      el.addEventListener('pointermove', function (e) {
        var now = performance.now();
        if (now - last < 90) return;
        last = now;
        var r = el.getBoundingClientRect();
        drop(e.clientX - r.left, e.clientY - r.top, 0.5);
      });
      el.addEventListener('pointerdown', function (e) {
        var r = el.getBoundingClientRect();
        drop(e.clientX - r.left, e.clientY - r.top, 1);
      });
      el._fxDrop = drop;
      L.inside = false;
    },
    tick: function (el, dt) {
      var L = el._fxL;
      if (frozen(L)) return;
      el._fxAuto += dt;
      if (el._fxAuto > 1.4) { el._fxAuto = 0; el._fxDrop(U.rand(0, L.w), U.rand(0, L.h), 0.7); }
      var ctx = L.ctx;
      var color = U.cssVar(el, '--fx-ripple', '#9fe8ff');
      ctx.clearRect(0, 0, L.w, L.h);
      ctx.strokeStyle = color;
      el._fxRings = el._fxRings.filter(function (g) {
        g.r += 70 * dt;
        g.a -= 0.35 * dt;
        if (g.a <= 0) return false;
        for (var k = 0; k < 3; k++) {
          var r = g.r - k * 12;
          if (r <= 0) continue;
          ctx.globalAlpha = g.a * (1 - k * 0.3);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(g.x, g.y, r, r * 0.6, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        return true;
      });
      ctx.globalAlpha = 1;
    }
  });

  // --- vhs ------------------------------------------------------------------

  FX.register('vhs', {
    setup: function (el) {
      var ui = U.make('div', 'fx-vhs-ui', el);
      ui.setAttribute('aria-hidden', 'true');
      var top = U.make('span', '', ui);
      top.textContent = '● REC  ' + (el.dataset.fxLabel || 'SP');
      var bottom = U.make('span', '', ui);
      el._fxClock = bottom;
      el._fxStart = performance.now();
    },
    tick: function (el) {
      var s = Math.floor((performance.now() - el._fxStart) / 1000);
      if (s === el._fxSec) return;
      el._fxSec = s;
      var pad = function (n) { return String(n).padStart(2, '0'); };
      el._fxClock.textContent = 'PLAY ▶ ' + pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    }
  });

  FX.register('crt', { entrance: true });

  // --- flashlight -----------------------------------------------------------

  FX.register('flashlight', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--fx-my', (e.clientY - r.top) + 'px');
      });
    }
  });

  // --- bokeh ----------------------------------------------------------------

  FX.register('bokeh', {
    setup: function (el) {
      var colors = (el.dataset.fxColors || '#ff5b2e,#b9a7ff,#ffcf4d,#20c7a5').split(',');
      for (var i = 0; i < U.num(el, 'fxCount', 14); i++) {
        var s = U.make('span', 'fx-bokeh', el);
        var size = U.rand(30, 110);
        s.style.width = s.style.height = size.toFixed(0) + 'px';
        s.style.left = U.rand(-10, 90).toFixed(1) + '%';
        s.style.top = U.rand(-10, 90).toFixed(1) + '%';
        s.style.setProperty('--c', colors[i % colors.length]);
        s.style.setProperty('--b', U.rand(1, 6).toFixed(1) + 'px');
        s.style.setProperty('--t', U.rand(6, 14).toFixed(1) + 's');
        s.style.setProperty('--d', U.rand(-10, 0).toFixed(1) + 's');
        s.style.setProperty('--x', U.rand(-40, 40).toFixed(0) + 'px');
        s.style.setProperty('--y', U.rand(-50, 30).toFixed(0) + 'px');
      }
    }
  });

  // --- orbit-rings ----------------------------------------------------------

  FX.register('orbit-rings', {
    setup: function (el) {
      [[0.38, 14], [0.62, 22], [0.88, 34]].forEach(function (o, i) {
        var r = U.make('span', 'fx-orbit');
        r.setAttribute('aria-hidden', 'true');
        r.style.setProperty('--k', o[0]);
        r.style.setProperty('--t', o[1] + 's');
        if (i === 1) r.style.animationDirection = 'reverse';
        el.insertBefore(r, el.firstChild);
      });
    }
  });
})(window.FX);

/* Pack 07 — Images et médias */
(function (FX) {
  'use strict';
  var U = FX.util;
  var NS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  ['ken-burns', 'color-reveal', 'blob-mask'].forEach(function (n) { FX.register(n, {}); });

  // --- Filtres SVG partagés -------------------------------------------------

  var defs = null;
  function svgDefs() {
    if (defs) return defs;
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', '0');
    s.setAttribute('height', '0');
    s.setAttribute('aria-hidden', 'true');
    s.style.position = 'absolute';
    defs = document.createElementNS(NS, 'defs');
    s.appendChild(defs);
    document.body.appendChild(s);
    return defs;
  }
  function addFilter(id, inner) {
    var f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id);
    f.setAttribute('x', '-10%');
    f.setAttribute('y', '-10%');
    f.setAttribute('width', '120%');
    f.setAttribute('height', '120%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = inner;
    svgDefs().appendChild(f);
    return f;
  }
  function imgOf(el) { return el.tagName === 'IMG' ? el : el.querySelector('img'); }
  function srcOf(img) { return img ? (img.currentSrc || img.src) : ''; }

  // --- svg-draw -------------------------------------------------------------

  FX.register('svg-draw', {
    entrance: true,
    setup: function (el) {
      el._fxShapes = Array.prototype.map.call(el.querySelectorAll('path, circle, line, polyline, rect'), function (s, i) {
        var len = s.getTotalLength ? s.getTotalLength() : 0;
        s.style.strokeDasharray = len;
        s.style.strokeDashoffset = U.reduced ? 0 : len;
        s.style.transitionDelay = (i * U.num(el, 'fxStagger', 120)) + 'ms';
        return { s: s, len: len };
      });
    },
    reset: function (el) { el._fxShapes.forEach(function (o) { o.s.style.strokeDashoffset = o.len; }); },
    enter: function (el) { el._fxShapes.forEach(function (o) { o.s.style.strokeDashoffset = 0; }); }
  });

  // --- image-trail ----------------------------------------------------------

  FX.register('image-trail', {
    setup: function (el) {
      var list = (el.dataset.fxImages || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return;
      var gap = U.num(el, 'fxGap', 70);
      var last = null;
      var i = 0;
      el.addEventListener('pointermove', function (e) {
        if (U.reduced) return;
        var r = el.getBoundingClientRect();
        var x = e.clientX - r.left;
        var y = e.clientY - r.top;
        if (last && Math.hypot(x - last.x, y - last.y) < gap) return;
        last = { x: x, y: y };
        var img = U.make('img', 'fx-trail', el);
        img.src = list[i++ % list.length];
        img.alt = '';
        img.style.left = x + 'px';
        img.style.top = y + 'px';
        img.style.setProperty('--r', U.rand(-12, 12).toFixed(0) + 'deg');
        setTimeout(function () { img.remove(); }, 1150);
      });
    }
  });

  // --- hover-preview --------------------------------------------------------

  FX.register('hover-preview', {
    setup: function (el) {
      var p = el._fxP = { box: U.make('div', 'fx-preview', el), x: 0, y: 0, tx: 0, ty: 0 };
      p.box.setAttribute('aria-hidden', 'true');
      el.querySelectorAll('[data-fx-image]').forEach(function (item) {
        item.addEventListener('pointerenter', function () {
          p.box.style.backgroundImage = 'url("' + item.dataset.fxImage + '")';
          p.box.classList.add('fx-on');
        });
      });
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        p.tx = e.clientX - r.left + 24;
        p.ty = e.clientY - r.top - p.box.offsetHeight / 2;
        if (!p.box.classList.contains('fx-on')) { p.x = p.tx; p.y = p.ty; }
      });
      el.addEventListener('pointerleave', function () { p.box.classList.remove('fx-on'); });
    },
    tick: function (el) {
      var p = el._fxP;
      var k = U.reduced ? 1 : 0.16;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.box.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
    }
  });

  // --- slice-in -------------------------------------------------------------

  FX.register('slice-in', {
    entrance: true,
    setup: function (el) {
      var img = imgOf(el);
      if (!img) return;
      var n = U.num(el, 'fxSlices', 6);
      for (var i = 0; i < n; i++) {
        var s = U.make('div', 'fx-slice', el);
        s.style.left = (i * 100 / n) + '%';
        s.style.width = 'calc(' + (100 / n) + '% + 1px)';
        s.style.setProperty('--fx-i', i);
        s.style.setProperty('--fx-dir', i % 2 ? -1 : 1);
        var inner = U.make('i', '', s);
        inner.style.left = (-i * 100) + '%';
        inner.style.width = (n * 100) + '%';
        inner.style.backgroundImage = 'url("' + srcOf(img) + '")';
      }
    }
  });

  // --- rgb-split ------------------------------------------------------------

  FX.register('rgb-split', {
    setup: function () {
      if (document.getElementById('fx-rgb-split')) return;
      addFilter('fx-rgb-split',
        '<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>' +
        '<feOffset in="r" dx="-6" result="ro"/>' +
        '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>' +
        '<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>' +
        '<feOffset in="b" dx="6" result="bo"/>' +
        '<feBlend in="ro" in2="g" mode="screen" result="rg"/>' +
        '<feBlend in="rg" in2="bo" mode="screen"/>');
    }
  });

  // --- compare --------------------------------------------------------------

  FX.register('compare', {
    setup: function (el) {
      var handle = U.make('div', 'fx-handle', el);
      handle.setAttribute('aria-hidden', 'true');
      var range = U.make('input', '', el);
      range.type = 'range';
      range.min = 0;
      range.max = 100;
      range.value = U.num(el, 'fxStart', 50);
      range.setAttribute('aria-label', el.dataset.fxLabel || 'Comparer avant et après');
      function set() { el.style.setProperty('--fx-pos', range.value + '%'); }
      range.addEventListener('input', set);
      set();
    }
  });

  // --- glare ----------------------------------------------------------------

  FX.register('glare', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }
  });

  // --- lens -----------------------------------------------------------------

  FX.register('lens', {
    setup: function (el) {
      var img = imgOf(el);
      if (!img) return;
      var lens = U.make('div', 'fx-lens', el);
      lens.setAttribute('aria-hidden', 'true');
      var zoom = U.num(el, 'fxZoom', 2.4);
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = e.clientX - r.left;
        var y = e.clientY - r.top;
        var size = lens.offsetWidth;
        lens.style.backgroundImage = 'url("' + srcOf(img) + '")';
        lens.style.backgroundSize = (r.width * zoom) + 'px ' + (r.height * zoom) + 'px';
        lens.style.backgroundPosition = (-(x * zoom - size / 2)) + 'px ' + (-(y * zoom - size / 2)) + 'px';
        lens.style.transform = 'translate(' + (x - size / 2) + 'px,' + (y - size / 2) + 'px)';
      });
    }
  });

  // --- photo-stack ----------------------------------------------------------

  function nextPhoto(el) {
    var top = el.lastElementChild;
    if (!top || el._fxBusy) return;
    el._fxBusy = true;
    top.classList.add('fx-out');
    setTimeout(function () {
      el.insertBefore(top, el.firstElementChild);
      top.classList.remove('fx-out');
      el._fxBusy = false;
    }, U.reduced ? 0 : 420);
  }

  FX.register('photo-stack', {
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (k, i, all) {
        k.style.setProperty('--r', (i === all.length - 1 ? 0 : U.rand(-9, 9)).toFixed(1) + 'deg');
      });
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextPhoto(el); }
      });
    },
    triggerOn: 'click',
    trigger: nextPhoto
  });

  // --- liquid-hover ---------------------------------------------------------

  FX.register('liquid-hover', {
    setup: function (el) {
      var id = 'fx-liquid-' + (++uid);
      var f = addFilter(id,
        '<feTurbulence type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="2" seed="3" result="t"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="t" scale="0" xChannelSelector="R" yChannelSelector="G"/>');
      var map = f.querySelector('feDisplacementMap');
      var turb = f.querySelector('feTurbulence');
      el.addEventListener('pointerenter', function () {
        if (U.reduced) return;
        el.style.filter = 'url(#' + id + ')';
        U.tween(el, 1100, function (p) {
          map.setAttribute('scale', (34 * Math.sin(p * Math.PI) * (1 - p * 0.4)).toFixed(2));
          turb.setAttribute('baseFrequency', (0.012 + p * 0.008).toFixed(4) + ' ' + (0.04 - p * 0.015).toFixed(4));
        }, function () { el.style.filter = ''; });
      });
    }
  });

  // --- pixelate -------------------------------------------------------------

  FX.register('pixelate', {
    setup: function (el) {
      var img = imgOf(el);
      if (!img || U.reduced) return;
      var c = U.make('canvas', '', el);
      c.setAttribute('aria-hidden', 'true');
      var small = document.createElement('canvas');
      var max = U.num(el, 'fxBlock', 22);
      function draw(block) {
        var w = el.clientWidth;
        var h = el.clientHeight;
        if (!w || !h) return;
        c.width = w;
        c.height = h;
        var sw = Math.max(1, Math.ceil(w / block));
        var sh = Math.max(1, Math.ceil(h / block));
        small.width = sw;
        small.height = sh;
        var iw = img.naturalWidth || w;
        var ih = img.naturalHeight || h;
        var k = Math.max(sw / iw, sh / ih);
        var sctx = small.getContext('2d');
        sctx.drawImage(img, (sw - iw * k) / 2, (sh - ih * k) / 2, iw * k, ih * k);
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
      }
      el._fxBlock = max;
      function animateTo(target, done) {
        var from = el._fxBlock;
        U.tween(el, 600, function (p) {
          el._fxBlock = Math.max(1, Math.round(from + (target - from) * U.easeOut(p)));
          draw(el._fxBlock);
        }, done);
      }
      if (img.complete) draw(max); else img.addEventListener('load', function () { draw(max); });
      el.addEventListener('pointerenter', function () {
        animateTo(1, function () { c.style.opacity = 0; });
      });
      el.addEventListener('pointerleave', function () {
        c.style.opacity = 1;
        animateTo(max);
      });
    }
  });

  // --- flip-card ------------------------------------------------------------

  FX.register('flip-card', {
    setup: function (el) {
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.classList.toggle('fx-flipped'); }
      });
    },
    triggerOn: 'click',
    trigger: function (el) { el.classList.toggle('fx-flipped'); }
  });

  // --- carousel-ring --------------------------------------------------------

  FX.register('carousel-ring', {
    setup: function (el) {
      var ring = U.make('div', 'fx-ring');
      var kids = Array.prototype.slice.call(el.children);
      kids.forEach(function (k, i) {
        k.style.setProperty('--fx-i', i);
        ring.appendChild(k);
      });
      el.appendChild(ring);
      ring.style.setProperty('--fx-n', kids.length);
      var w = kids[0] ? kids[0].offsetWidth : 120;
      var gap = U.num(el, 'fxGap', 18);
      el.style.setProperty('--fx-radius', ((w / 2 + gap) / Math.tan(Math.PI / Math.max(3, kids.length))).toFixed(0) + 'px');
    }
  });

  // --- drag-gallery ---------------------------------------------------------

  FX.register('drag-gallery', {
    setup: function (el) {
      var track = U.make('div', 'fx-track');
      while (el.firstChild) track.appendChild(el.firstChild);
      el.appendChild(track);
      var s = el._fxG = { track: track, x: 0, v: 0, drag: false, lx: 0, lt: 0 };
      if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
      el.setAttribute('aria-roledescription', 'galerie défilante');
      el.addEventListener('pointerdown', function (e) {
        s.drag = true;
        s.lx = e.clientX;
        s.lt = performance.now();
        s.v = 0;
        el.classList.add('fx-dragging');
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', function (e) {
        if (!s.drag) return;
        var now = performance.now();
        var dx = e.clientX - s.lx;
        s.x += dx;
        s.v = dx / Math.max(1, now - s.lt) * 1000;
        s.lx = e.clientX;
        s.lt = now;
      });
      function release() { s.drag = false; el.classList.remove('fx-dragging'); }
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') s.v = -900;
        if (e.key === 'ArrowLeft') s.v = 900;
      });
    },
    tick: function (el, dt) {
      var s = el._fxG;
      var min = Math.min(0, el.clientWidth - s.track.scrollWidth);
      if (!s.drag) {
        s.x += s.v * dt;
        s.v *= Math.pow(0.05, dt);
        if (s.x > 0) { s.x += (0 - s.x) * 0.2; s.v = 0; }
        if (s.x < min) { s.x += (min - s.x) * 0.2; s.v = 0; }
      }
      s.track.style.transform = 'translate3d(' + s.x.toFixed(1) + 'px,0,0)';
    }
  });

  // --- noise-reveal ---------------------------------------------------------

  FX.register('noise-reveal', {
    entrance: true,
    setup: function (el) {
      var id = 'fx-noise-' + (++uid);
      var f = addFilter(id,
        '<feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="3" seed="7" result="t"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="t" scale="160" xChannelSelector="R" yChannelSelector="B"/>');
      el._fxMap = f.querySelector('feDisplacementMap');
      el._fxId = id;
      if (!U.reduced) el.style.filter = 'url(#' + id + ')';
    },
    reset: function (el) {
      el._fxMap.setAttribute('scale', 160);
      el.style.filter = 'url(#' + el._fxId + ')';
    },
    enter: function (el) {
      U.tween(el, U.num(el, 'fxDuration', 1400), function (p) {
        el._fxMap.setAttribute('scale', (160 * Math.pow(1 - p, 3)).toFixed(1));
      }, function () { el.style.filter = ''; });
    }
  });
})(window.FX);

/* Pack 08 — Navigation et composants d'interface */
(function (FX) {
  'use strict';
  var U = FX.util;

  FX.register('focus-list', {});

  // --- Ouverture / fermeture partagées --------------------------------------

  var openable = ['menu-reveal', 'drawer', 'modal-zoom', 'dropdown'];

  function setOpen(el, open) {
    el.classList.toggle('fx-open', open);
    if (el.dataset.fx !== 'dropdown') el.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.querySelectorAll('[data-fx-toggle]').forEach(function (t) {
      var target = document.querySelector(t.dataset.fxToggle);
      if (target === el) t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (open) {
      var focusable = el.querySelector('a, button, input, [tabindex]');
      if (focusable && el.dataset.fx !== 'dropdown') setTimeout(function () { focusable.focus({ preventScroll: true }); }, 50);
    }
  }
  function toggle(el, e) {
    var open = !el.classList.contains('fx-open');
    var d = el._fxBeforeOpen;
    if (open && d) d(el, e);
    setOpen(el, open);
  }

  // Tout élément [data-fx-toggle="#id"] ouvre ou ferme le composant ciblé
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-fx-toggle]');
    if (t) {
      var target = document.querySelector(t.dataset.fxToggle);
      if (target && FX.has(target.dataset.fx)) { e.preventDefault(); FX.trigger(target, e); }
      return;
    }
    var close = e.target.closest('[data-fx-close]');
    if (close) {
      var host = close.closest('.fx-open');
      if (host) setOpen(host, false);
    }
    // Clic en dehors d'une liste déroulante ouverte : on la ferme
    document.querySelectorAll('[data-fx="dropdown"].fx-open').forEach(function (dd) {
      if (!dd.contains(e.target)) setOpen(dd, false);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.fx-open').forEach(function (el) {
      if (openable.indexOf(el.dataset.fx) !== -1) setOpen(el, false);
    });
  });

  function openableDef(extra) {
    return Object.assign({
      setup: function (el) { if (el.dataset.fx !== 'dropdown') el.setAttribute('aria-hidden', 'true'); },
      trigger: toggle
    }, extra || {});
  }

  FX.register('menu-reveal', openableDef({
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(el.children, function (k, i) { k.style.setProperty('--fx-i', i); });
    }
  }));

  FX.register('drawer', openableDef({
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      // Un clic sur le voile (hors du panneau) ferme le tiroir
      el.addEventListener('click', function (e) { if (e.target === el) setOpen(el, false); });
    }
  }));

  FX.register('modal-zoom', openableDef({
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      el.addEventListener('click', function (e) { if (e.target === el) setOpen(el, false); });
      // Point de départ : le centre de l'élément cliqué, relatif au centre de la fenêtre
      el._fxBeforeOpen = function (modal, e) {
        var src = e && e.target && e.target.getBoundingClientRect ? e.target.getBoundingClientRect() : null;
        var box = modal.getBoundingClientRect();
        if (!src || !box.width) { modal.style.removeProperty('--fx-dx'); modal.style.removeProperty('--fx-dy'); return; }
        modal.style.setProperty('--fx-dx', (src.left + src.width / 2 - (box.left + box.width / 2)).toFixed(0) + 'px');
        modal.style.setProperty('--fx-dy', (src.top + src.height / 2 - (box.top + box.height / 2)).toFixed(0) + 'px');
      };
    }
  }));

  FX.register('dropdown', openableDef({
    setup: function (el) {
      var btn = el.firstElementChild;
      var menu = el.lastElementChild;
      Array.prototype.forEach.call(menu.children, function (k, i) { k.style.setProperty('--fx-i', i); });
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-haspopup', 'true');
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggle(el, e);
          btn.setAttribute('aria-expanded', el.classList.contains('fx-open') ? 'true' : 'false');
        });
      }
    }
  }));

  // --- burger-morph ---------------------------------------------------------

  FX.register('burger-morph', {
    setup: function (el) {
      if (!el.children.length) for (var i = 0; i < 3; i++) U.make('span', '', el);
      Array.prototype.forEach.call(el.children, function (s) { s.setAttribute('aria-hidden', 'true'); });
      if (!el.hasAttribute('aria-expanded')) el.setAttribute('aria-expanded', 'false');
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Menu');
    },
    triggerOn: 'click',
    trigger: function (el) {
      // Si le bouton pilote un menu (data-fx-toggle), c'est ce menu qui met à jour aria-expanded
      if (el.dataset.fxToggle) return;
      el.setAttribute('aria-expanded', el.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    }
  });

  // --- smart-header / header-shrink -----------------------------------------

  function scrollTopOf(parent) { return parent ? parent.scrollTop : window.scrollY; }

  FX.register('smart-header', {
    setup: function (el) {
      var last = 0;
      U.bindScroll(el, function (v, parent) {
        var y = scrollTopOf(parent);
        var delta = y - last;
        if (Math.abs(delta) > 4) {
          el.classList.toggle('fx-hidden', delta > 0 && y > el.offsetHeight * 1.5);
          last = y;
        }
        el.classList.toggle('fx-scrolled', y > 4);
      });
      el.addEventListener('focusin', function () { el.classList.remove('fx-hidden'); });
    }
  });

  FX.register('header-shrink', {
    setup: function (el) {
      U.bindScroll(el, function (v, parent) {
        el.classList.toggle('fx-small', scrollTopOf(parent) > U.num(el, 'fxAfter', 40));
      });
    }
  });

  // --- tab-slider -----------------------------------------------------------

  FX.register('tab-slider', {
    setup: function (el) {
      var ind = U.make('span', 'fx-indicator');
      ind.setAttribute('aria-hidden', 'true');
      el.insertBefore(ind, el.firstChild);
      el.setAttribute('role', el.getAttribute('role') || 'tablist');
      var tabs = Array.prototype.filter.call(el.children, function (k) { return k !== ind; });
      function place(tab) {
        ind.style.width = tab.offsetWidth + 'px';
        ind.style.height = tab.offsetHeight + 'px';
        ind.style.transform = 'translate(' + tab.offsetLeft + 'px,' + tab.offsetTop + 'px)';
      }
      function select(tab) {
        tabs.forEach(function (t) { t.setAttribute('aria-selected', t === tab ? 'true' : 'false'); });
        place(tab);
      }
      tabs.forEach(function (t) {
        t.setAttribute('role', 'tab');
        t.addEventListener('click', function () { select(t); });
      });
      select(tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0]);
      U.onResize(function () { var cur = el.querySelector('[aria-selected="true"]'); if (cur) place(cur); });
    }
  });

  // --- dot-nav / scroll-spy (section active selon le défilement) -----------

  function spy(el, onChange) {
    var links = Array.prototype.slice.call(el.querySelectorAll('a[href^="#"]'));
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var anchor = targets.filter(Boolean)[0] || el;
    U.bindScroll(anchor, function (v) {
      var mid = v.top + v.h * 0.4;
      var current = 0;
      targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top <= mid) current = i; });
      links.forEach(function (a, i) {
        a.classList.toggle('fx-active', i === current);
        if (i === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      if (onChange) onChange(links[current]);
    });
    // Navigation dans une boîte qui défile : on fait défiler la boîte plutôt que la page
    links.forEach(function (a, i) {
      a.addEventListener('click', function (e) {
        var t = targets[i];
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth', block: 'start' });
      });
    });
  }

  FX.register('dot-nav', { setup: function (el) { spy(el); } });

  FX.register('scroll-spy', {
    setup: function (el) {
      var marker = U.make('span', 'fx-marker');
      marker.setAttribute('aria-hidden', 'true');
      el.insertBefore(marker, el.firstChild);
      spy(el, function (a) {
        if (!a) return;
        marker.style.height = a.offsetHeight + 'px';
        marker.style.transform = 'translateY(' + a.offsetTop + 'px)';
      });
    }
  });

  // --- top-ring -------------------------------------------------------------

  FX.register('top-ring', {
    setup: function (el) {
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Revenir en haut de la page');
      el.insertAdjacentHTML('afterbegin', '<svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/></svg>');
      if (!el.textContent.trim()) el.insertAdjacentHTML('beforeend', '<span aria-hidden="true">↑</span>');
      var circle = el.querySelector('circle');
      var len = 2 * Math.PI * 23;
      circle.style.strokeDasharray = len;
      U.bindScroll(el, function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var p = max > 0 ? window.scrollY / max : 0;
        circle.style.strokeDashoffset = (len * (1 - p)).toFixed(1);
        el.classList.toggle('fx-visible', el.dataset.fxLocal != null || window.scrollY > window.innerHeight * 0.5);
      });
      el.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: U.reduced ? 'auto' : 'smooth' });
      });
    }
  });

  // --- hover-pill -----------------------------------------------------------

  FX.register('hover-pill', {
    setup: function (el) {
      var pill = U.make('span', 'fx-pill');
      pill.setAttribute('aria-hidden', 'true');
      el.insertBefore(pill, el.firstChild);
      function place(item) {
        pill.style.width = item.offsetWidth + 'px';
        pill.style.height = item.offsetHeight + 'px';
        pill.style.transform = 'translate(' + item.offsetLeft + 'px,' + item.offsetTop + 'px)';
      }
      Array.prototype.forEach.call(el.children, function (item) {
        if (item === pill) return;
        item.addEventListener('pointerenter', function () {
          if (!pill.classList.contains('fx-on')) {
            pill.style.transition = 'none';
            place(item);
            void pill.offsetWidth;
            pill.style.transition = '';
          }
          place(item);
          pill.classList.add('fx-on');
        });
        item.addEventListener('focus', function () { place(item); pill.classList.add('fx-on'); });
      });
      el.addEventListener('pointerleave', function () { pill.classList.remove('fx-on'); });
    }
  });

  // --- accordion ------------------------------------------------------------

  FX.register('accordion', {
    setup: function (el) {
      var summary = el.querySelector('summary');
      if (!summary || !el.animate) return;
      summary.addEventListener('click', function (e) {
        if (U.reduced) return;
        e.preventDefault();
        var start = el.offsetHeight;
        var opening = !el.open;
        if (opening) el.open = true;
        var end = opening ? el.scrollHeight : summary.offsetHeight;
        if (opening) {
          el.style.height = start + 'px';
          end = el.scrollHeight;
        }
        var anim = el.animate({ height: [start + 'px', end + 'px'] }, { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
        anim.onfinish = function () {
          el.style.height = '';
          if (!opening) el.open = false;
        };
      });
    }
  });

  // --- dots-morph -----------------------------------------------------------

  FX.register('dots-morph', {
    setup: function (el) {
      var n = U.num(el, 'fxCount', el.children.length || 4);
      if (!el.children.length) for (var i = 0; i < n; i++) U.make('button', '', el);
      var dots = Array.prototype.slice.call(el.children);
      var interval = U.num(el, 'fxInterval', 3000);
      el.style.setProperty('--fx-interval', interval + 'ms');
      el.setAttribute('role', el.getAttribute('role') || 'group');
      var cur = 0;
      function go(i) {
        cur = i;
        dots.forEach(function (d, k) {
          d.setAttribute('aria-current', k === i ? 'true' : 'false');
          d.setAttribute('aria-label', 'Diapositive ' + (k + 1));
        });
        el.dispatchEvent(new CustomEvent('fx:change', { detail: { index: i }, bubbles: true }));
      }
      dots.forEach(function (d, k) { d.type = 'button'; d.addEventListener('click', function () { go(k); restart(); }); });
      var timer = null;
      function restart() {
        clearInterval(timer);
        if (U.reduced || el.dataset.fxAuto === 'false') return;
        timer = setInterval(function () {
          if (!el.isConnected) { clearInterval(timer); return; }
          go((cur + 1) % dots.length);
        }, interval);
      }
      go(0);
      restart();
    }
  });
})(window.FX);

/* Pack 09 — États et retours */
(function (FX) {
  'use strict';
  var U = FX.util;
  var NS = 'http://www.w3.org/2000/svg';

  ['orbit-loader', 'loading-bar', 'float', 'live-dot'].forEach(function (n) { FX.register(n, {}); });

  FX.register('typing-dots', {
    setup: function (el) {
      if (!el.children.length) for (var i = 0; i < 3; i++) U.make('i', '', el);
      el.setAttribute('role', 'status');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'En train d\'écrire');
    }
  });

  // --- check-draw / cross-draw ----------------------------------------------

  function drawIcon(paths, label) {
    return function (el) {
      if (!el.querySelector('svg')) {
        el.innerHTML = '<svg viewBox="0 0 52 52" xmlns="' + NS + '"><circle cx="26" cy="26" r="23" pathLength="1"/>' +
          paths.map(function (d) { return '<path d="' + d + '" pathLength="1"/>'; }).join('') + '</svg>';
      }
      el.setAttribute('role', 'img');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    };
  }
  FX.register('check-draw', { entrance: true, setup: drawIcon(['M15 27 l7 7 l15 -16'], 'Réussi') });
  FX.register('cross-draw', { entrance: true, setup: drawIcon(['M18 18 l16 16', 'M34 18 l-16 16'], 'Erreur') });

  // --- confetti -------------------------------------------------------------

  FX.register('confetti', {
    triggerOn: 'click',
    trigger: function (el) {
      if (U.reduced) return;
      var r = el.getBoundingClientRect();
      var c = U.make('canvas', '', document.body);
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999';
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = window.innerWidth * dpr;
      c.height = window.innerHeight * dpr;
      var ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      var colors = (el.dataset.fxColors || '#ff5b2e,#b9a7ff,#ffcf4d,#20c7a5,#f4f1ea').split(',');
      var ox = r.left + r.width / 2;
      var oy = r.top + r.height / 2;
      var parts = Array.from({ length: U.num(el, 'fxCount', 90) }, function (_, i) {
        var a = U.rand(-Math.PI * 0.95, -Math.PI * 0.05);
        var v = U.rand(260, 620);
        return {
          x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          w: U.rand(5, 10), h: U.rand(8, 16), rot: U.rand(0, 6), vr: U.rand(-10, 10),
          color: colors[i % colors.length]
        };
      });
      var start = null;
      var last = null;
      function frame(t) {
        if (start === null) { start = t; last = t; }
        var dt = Math.min((t - last) / 1000, 0.04);
        last = t;
        var life = (t - start) / 2200;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        parts.forEach(function (p) {
          p.vy += 900 * dt;
          p.vx *= 0.99;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.7)));
          ctx.restore();
        });
        if (life < 1) U.raf(frame); else c.remove();
      }
      U.raf(frame);
    }
  });

  // --- toast ----------------------------------------------------------------

  FX.register('toast', {
    setup: function (el) {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    },
    trigger: function (el, e) {
      var src = e && e.target && e.target.closest && e.target.closest('[data-fx-message]');
      var t = U.make('div', 'fx-toast', el);
      t.textContent = (src && src.dataset.fxMessage) || el.dataset.fxMessage || 'C\'est enregistré.';
      setTimeout(function () {
        t.classList.add('fx-leaving');
        setTimeout(function () { t.remove(); }, U.reduced ? 0 : 360);
      }, U.num(el, 'fxDuration', 3000));
    }
  });

  // --- progress-ring --------------------------------------------------------

  FX.register('progress-ring', {
    entrance: true,
    setup: function (el) {
      var value = U.clamp(U.num(el, 'fxValue', 72), 0, 100);
      el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="42"/></svg><span class="fx-value">0%</span>';
      el.setAttribute('role', 'progressbar');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
      el.setAttribute('aria-valuenow', value);
      var arc = el.querySelectorAll('circle')[1];
      var len = 2 * Math.PI * 42;
      arc.style.strokeDasharray = len;
      arc.style.strokeDashoffset = len;
      el._fxRing = { arc: arc, len: len, value: value, label: el.querySelector('.fx-value') };
    },
    reset: function (el) { el._fxRing.arc.style.strokeDashoffset = el._fxRing.len; el._fxRing.label.textContent = '0%'; },
    enter: function (el) {
      var g = el._fxRing;
      U.tween(el, U.num(el, 'fxDuration', 1400), function (p) {
        var v = g.value * U.easeOut(p);
        g.arc.style.strokeDashoffset = (g.len * (1 - v / 100)).toFixed(1);
        g.label.textContent = Math.round(v) + '%';
      });
    }
  });

  // --- badge-bump -----------------------------------------------------------

  FX.register('badge-bump', {
    setup: function (el) { el.setAttribute('aria-live', 'polite'); },
    trigger: function (el) {
      var n = (parseInt(el.textContent, 10) || 0) + 1;
      el.textContent = n > 99 ? '99+' : n;
      el.classList.remove('fx-bump');
      void el.offsetWidth;
      el.classList.add('fx-bump');
    }
  });

  // --- heart-like -----------------------------------------------------------

  FX.register('heart-like', {
    setup: function (el) {
      if (!el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'J\'aime');
    },
    triggerOn: 'click',
    trigger: function (el) {
      el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    }
  });

  // --- copy-morph -----------------------------------------------------------

  FX.register('copy-morph', {
    setup: function (el) { el._fxLabel = el.textContent.trim(); },
    triggerOn: 'click',
    trigger: function (el) {
      var text = el.dataset.fxCopy;
      if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
      var from = el.offsetWidth;
      el.style.width = from + 'px';
      el.innerHTML = '<span>' + (el.dataset.fxDone || 'Copié ✓') + '</span>';
      el.classList.add('fx-done');
      el.style.width = 'auto';
      var to = el.offsetWidth;
      el.style.width = from + 'px';
      void el.offsetWidth;
      el.style.width = to + 'px';
      clearTimeout(el._fxT);
      el._fxT = setTimeout(function () {
        el.innerHTML = '<span></span>';
        el.firstChild.textContent = el._fxLabel;
        el.classList.remove('fx-done');
        el.style.width = '';
      }, 1600);
    }
  });

  // --- liquid-fill ----------------------------------------------------------

  FX.register('liquid-fill', {
    entrance: true,
    setup: function (el) { el.style.setProperty('--fx-target', U.clamp(U.num(el, 'fxValue', 65), 0, 100) / 100); }
  });

  // --- flip-clock -----------------------------------------------------------

  FX.register('flip-clock', {
    setup: function (el) {
      el.setAttribute('role', 'timer');
      el.textContent = '';
      var parts = [];
      for (var g = 0; g < 3; g++) {
        if (g) { var s = U.make('span', 'fx-sep', el); s.textContent = ':'; s.setAttribute('aria-hidden', 'true'); }
        parts.push(U.make('span', 'fx-digit', el), U.make('span', 'fx-digit', el));
      }
      el._fxDigits = parts;
      el._fxTarget = el.dataset.fxTo ? new Date(el.dataset.fxTo).getTime() : null;
    },
    tick: function (el) {
      var now = Date.now();
      var secs;
      if (el._fxTarget) secs = Math.max(0, Math.floor((el._fxTarget - now) / 1000));
      else { var d = new Date(); secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); }
      if (secs === el._fxLast) return;
      el._fxLast = secs;
      // Au-delà de 99 heures, l'affichage passe en jours : heures : minutes
      var long = secs >= 360000;
      var a = long ? Math.min(99, Math.floor(secs / 86400)) : Math.floor(secs / 3600);
      var b = long ? Math.floor(secs / 3600) % 24 : Math.floor(secs / 60) % 60;
      var c = long ? Math.floor(secs / 60) % 60 : secs % 60;
      var str = String(a).padStart(2, '0') + String(b).padStart(2, '0') + String(c).padStart(2, '0');
      el.classList.toggle('fx-days', long);
      el.setAttribute('aria-label', long
        ? a + ' jours ' + b + ' heures ' + c + ' minutes'
        : str.slice(0, 2) + ':' + str.slice(2, 4) + ':' + str.slice(4));
      el._fxDigits.forEach(function (dg, i) {
        if (dg.textContent === str[i]) return;
        dg.textContent = str[i];
        dg.setAttribute('aria-hidden', 'true');
        if (U.reduced) return;
        dg.classList.remove('fx-flip');
        void dg.offsetWidth;
        dg.classList.add('fx-flip');
      });
    }
  });

  // --- loading-quips --------------------------------------------------------

  FX.register('loading-quips', {
    setup: function (el) {
      var quips = (el.dataset.fxMessages || 'On prépare tout…|Presque prêt…|Encore une seconde…').split('|');
      el.setAttribute('role', 'status');
      el.innerHTML = '';
      var q = U.make('span', 'fx-quip', el);
      var bar = U.make('div', 'fx-quip-bar', el);
      bar.setAttribute('aria-hidden', 'true');
      var i = 0;
      var p = 0;
      function show() {
        var n = U.make('span', 'fx-quip');
        n.textContent = quips[i % quips.length];
        el.replaceChild(n, el.firstChild);
        p = (i % quips.length + 1) / quips.length;
        el.style.setProperty('--fx-p', p.toFixed(3));
        i++;
      }
      show();
      var timer = setInterval(function () {
        if (!el.isConnected) { clearInterval(timer); return; }
        show();
      }, U.num(el, 'fxInterval', 1800));
      q.remove();
    }
  });
})(window.FX);

/* Pack 10 — Présentation */
(function (FX) {
  'use strict';
  var U = FX.util;
  var NS = 'http://www.w3.org/2000/svg';

  ['scroll-cue', 'peel', 'expand-panels'].forEach(function (n) { FX.register(n, {}); });

  // Répète une action tant que l'élément est dans la page
  function every(el, ms, fn) {
    if (U.reduced) return;
    var timer = setInterval(function () {
      if (!el.isConnected) { clearInterval(timer); return; }
      fn();
    }, ms);
  }

  // --- band-loader ----------------------------------------------------------

  FX.register('band-loader', {
    entrance: true,
    setup: function (el) {
      var quips = (el.dataset.fxMessages || 'On met la table…|Ça arrive, patience…|Dernière touche…').split('|');
      el.innerHTML = '<div class="fx-bands"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="fx-band-ui"><span class="fx-band-msg"></span><div class="fx-band-bar"></div></div>';
      el.querySelectorAll('.fx-bands i').forEach(function (b, i) { b.style.setProperty('--fx-i', i); });
      el.setAttribute('role', 'status');
      el._fxQuips = quips;
    },
    enter: function (el) {
      el.classList.remove('fx-done');
      var msg = el.querySelector('.fx-band-msg');
      if (U.reduced) { el.classList.add('fx-done'); return; }
      U.tween(el, U.num(el, 'fxDuration', 2600), function (p) {
        el.style.setProperty('--fx-p', p.toFixed(3));
        var q = el._fxQuips[Math.min(el._fxQuips.length - 1, Math.floor(p * el._fxQuips.length))];
        if (msg.textContent !== q) msg.textContent = q;
      }, function () {
        el.classList.add('fx-done');
        el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true }));
      });
    }
  });

  // --- bars-grow ------------------------------------------------------------

  FX.register('bars-grow', {
    entrance: true,
    setup: function (el) {
      var bars = Array.prototype.slice.call(el.children);
      var max = Math.max.apply(null, bars.map(function (b) { return parseFloat(b.dataset.fxValue) || 0; })) || 1;
      bars.forEach(function (b, i) {
        b.style.setProperty('--fx-i', i);
        b.style.setProperty('--fx-v', ((parseFloat(b.dataset.fxValue) || 0) / max * 100).toFixed(1));
        if (!b.getAttribute('aria-label') && b.dataset.fxValue) b.setAttribute('aria-label', (b.dataset.fxLabel || '') + ' ' + b.dataset.fxValue);
      });
    }
  });

  // --- marquee-vertical -----------------------------------------------------

  FX.register('marquee-vertical', {
    setup: function (el) {
      var track = U.make('div', 'fx-vtrack');
      while (el.firstChild) track.appendChild(el.firstChild);
      Array.prototype.slice.call(track.children).forEach(function (k) {
        var c = k.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        track.appendChild(c);
      });
      el.appendChild(track);
    }
  });

  // --- timeline -------------------------------------------------------------

  FX.register('timeline', {
    scroll: function (el, info) {
      var p = U.reduced ? 1 : U.clamp((info.vh * 0.6 - info.rect.top) / info.rect.height, 0, 1);
      el.style.setProperty('--fx-tl', p.toFixed(3));
      var line = info.rect.top + p * info.rect.height;
      Array.prototype.forEach.call(el.children, function (k) {
        k.classList.toggle('fx-on', k.getBoundingClientRect().top + 8 <= line);
      });
    }
  });

  // --- spotlight-focus ------------------------------------------------------

  function spotStep(el) {
    var s = el._fxSpot;
    if (!s || !s.steps.length) return;
    s.i = (s.i + 1) % s.steps.length;
    var target = s.steps[s.i];
    var pad = U.num(el, 'fxPad', 8);
    s.box.style.width = (target.offsetWidth + pad * 2) + 'px';
    s.box.style.height = (target.offsetHeight + pad * 2) + 'px';
    s.box.style.transform = 'translate(' + (target.offsetLeft - pad) + 'px,' + (target.offsetTop - pad) + 'px)';
    s.tip.textContent = target.dataset.fxTip || '';
    s.tip.style.display = target.dataset.fxTip ? '' : 'none';
  }

  FX.register('spotlight-focus', {
    setup: function (el) {
      var steps = Array.prototype.slice.call(el.querySelectorAll('[data-fx-step]'));
      steps.sort(function (a, b) { return (parseFloat(a.dataset.fxStep) || 0) - (parseFloat(b.dataset.fxStep) || 0); });
      var box = U.make('div', 'fx-spot', el);
      box.setAttribute('aria-hidden', 'true');
      var tip = U.make('span', 'fx-spot-tip', box);
      el._fxSpot = { steps: steps, box: box, tip: tip, i: -1 };
      U.raf(function () { spotStep(el); });
      every(el, U.num(el, 'fxInterval', 2600), function () { spotStep(el); });
      U.onResize(function () { el._fxSpot.i--; spotStep(el); });
    },
    trigger: spotStep
  });

  // --- logo-cycle -----------------------------------------------------------

  FX.register('logo-cycle', {
    setup: function (el) {
      var pool = Array.prototype.slice.call(el.children);
      var n = Math.min(U.num(el, 'fxSlots', 3), pool.length);
      el.style.setProperty('--fx-slots', n);
      el.innerHTML = '';
      var slots = [];
      for (var i = 0; i < n; i++) {
        var s = U.make('div', 'fx-slot', el);
        s.appendChild(pool[i]);
        slots.push(s);
      }
      var next = n;
      var turn = 0;
      every(el, U.num(el, 'fxInterval', 1800), function () {
        if (pool.length <= n) return;
        var slot = slots[turn++ % n];
        var old = slot.firstElementChild;
        var fresh = pool[next++ % pool.length];
        // Le logo choisi ne doit pas être déjà affiché ailleurs
        while (fresh.parentNode && fresh.parentNode.className === 'fx-slot') fresh = pool[next++ % pool.length];
        fresh.classList.add('fx-enter');
        slot.appendChild(fresh);
        void fresh.offsetWidth;
        fresh.classList.remove('fx-enter');
        old.classList.add('fx-leave');
        setTimeout(function () { old.classList.remove('fx-leave'); old.remove(); }, 650);
      });
    }
  });

  // --- quote-rotator --------------------------------------------------------

  FX.register('quote-rotator', {
    setup: function (el) {
      var quotes = Array.prototype.slice.call(el.children);
      var i = 0;
      quotes[0].classList.add('fx-cur');
      el.setAttribute('aria-live', 'polite');
      el.addEventListener('pointerenter', function () { el._fxPause = true; });
      el.addEventListener('pointerleave', function () { el._fxPause = false; });
      every(el, U.num(el, 'fxInterval', 4500), function () {
        if (el._fxPause || quotes.length < 2) return;
        quotes[i].classList.remove('fx-cur');
        i = (i + 1) % quotes.length;
        quotes[i].classList.add('fx-cur');
      });
    }
  });

  // --- circle-text ----------------------------------------------------------

  FX.register('circle-text', {
    setup: function (el) {
      var text = el.textContent.trim();
      // Un séparateur en fin de texte pour boucler proprement
      if (!/[✳•·*]\s*$/.test(text)) text += ' • ';
      el.setAttribute('aria-label', el.textContent.trim());
      el.textContent = '';
      // Chaque caractère, espaces compris, occupe une position sur le cercle
      Array.from(text).forEach(function (ch, i) {
        var s = U.make('span', 'fx-char', el);
        s.textContent = ch === ' ' ? ' ' : ch;
        s.setAttribute('aria-hidden', 'true');
        s.style.setProperty('--fx-i', i);
      });
      el.style.setProperty('--fx-n', Array.from(text).length);
    }
  });

  // --- split-flap -----------------------------------------------------------

  FX.register('split-flap', {
    setup: function (el) {
      var words = (el.dataset.fxWords || el.textContent).split('|').map(function (w) { return w.trim().toUpperCase(); });
      var len = Math.max.apply(null, words.map(function (w) { return w.length; }));
      el.setAttribute('aria-label', words.join(', '));
      el.textContent = '';
      var cells = [];
      for (var i = 0; i < len; i++) {
        var c = U.make('span', 'fx-flap', el);
        c.setAttribute('aria-hidden', 'true');
        cells.push(c);
      }
      var w = 0;
      var abc = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      function show(word) {
        word = word.padEnd(len, ' ');
        cells.forEach(function (c, i) {
          var target = word[i];
          if (U.reduced) { c.textContent = target; return; }
          var steps = 4 + ((Math.random() * 8) | 0) + i;
          var k = 0;
          (function flip() {
            c.textContent = k >= steps ? target : abc[(Math.random() * abc.length) | 0];
            if (k++ < steps) setTimeout(flip, 45);
          })();
        });
      }
      show(words[0]);
      every(el, U.num(el, 'fxInterval', 2600), function () { w = (w + 1) % words.length; show(words[w]); });
    }
  });

  // --- line-chart -----------------------------------------------------------

  FX.register('line-chart', {
    entrance: true,
    setup: function (el) {
      var values = (el.dataset.fxValues || '12,18,15,26,22,34,30,42').split(',').map(Number);
      var W = 300, H = 120, pad = 8;
      var max = Math.max.apply(null, values);
      var min = Math.min.apply(null, values);
      var pts = values.map(function (v, i) {
        return [pad + i * (W - pad * 2) / (values.length - 1), H - pad - (v - min) / ((max - min) || 1) * (H - pad * 2)];
      });
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      el.setAttribute('role', 'img');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Graphique : ' + values.join(', '));
      el.innerHTML = '<path class="fx-area" d="' + d + ' L' + pts[pts.length - 1][0] + ' ' + H + ' L' + pts[0][0] + ' ' + H + 'Z"/>' +
        '<path class="fx-line" d="' + d + '"/>' +
        pts.map(function (p, i) { return '<circle class="fx-point" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" style="--fx-i:' + i + '"/>'; }).join('');
      var line = el.querySelector('.fx-line');
      var len = line.getTotalLength();
      line.style.strokeDasharray = len;
      line.style.strokeDashoffset = U.reduced ? 0 : len;
      el._fxLine = { line: line, len: len };
    },
    reset: function (el) { el._fxLine.line.style.strokeDashoffset = el._fxLine.len; },
    enter: function (el) { el._fxLine.line.style.strokeDashoffset = 0; }
  });

  // --- holo-card ------------------------------------------------------------

  FX.register('holo-card', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width;
        var y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--fx-mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-my', (y * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-hx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-hy', (y * 100).toFixed(1) + '%');
        if (U.reduced) return;
        el.style.setProperty('--fx-ry', ((x - 0.5) * 16).toFixed(2) + 'deg');
        el.style.setProperty('--fx-rx', (-(y - 0.5) * 16).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--fx-rx', '0deg');
        el.style.setProperty('--fx-ry', '0deg');
      });
    }
  });

  // --- donut ----------------------------------------------------------------

  FX.register('donut', {
    entrance: true,
    setup: function (el) {
      var values = (el.dataset.fxValues || '45,25,20,10').split(',').map(Number);
      var colors = (el.dataset.fxColors || '#ff5b2e,#b9a7ff,#20c7a5,#ffcf4d,#f4f1ea').split(',');
      var total = values.reduce(function (a, b) { return a + b; }, 0) || 1;
      var r = 40;
      var c = 2 * Math.PI * r;
      var offset = 0;
      var label = el.textContent.trim();
      el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"></svg><span class="fx-donut-label"></span>';
      el.querySelector('.fx-donut-label').textContent = label;
      var svg = el.querySelector('svg');
      el._fxArcs = values.map(function (v, i) {
        var len = v / total * c;
        var circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', 50);
        circle.setAttribute('cy', 50);
        circle.setAttribute('r', r);
        circle.style.stroke = colors[i % colors.length];
        circle.style.strokeDashoffset = (-offset).toFixed(2);
        circle.style.strokeDasharray = U.reduced ? len + ' ' + c : '0 ' + c;
        circle.style.setProperty('--fx-i', i);
        svg.appendChild(circle);
        offset += len;
        return { el: circle, len: len, c: c };
      });
      el.setAttribute('role', 'img');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Répartition : ' + values.join(', '));
    },
    reset: function (el) { el._fxArcs.forEach(function (a) { a.el.style.strokeDasharray = '0 ' + a.c; }); },
    enter: function (el) { el._fxArcs.forEach(function (a) { a.el.style.strokeDasharray = (a.len - 1.2).toFixed(2) + ' ' + a.c; }); }
  });
})(window.FX);

/* Pack 11 — Idées de l'ère de l'IA */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Réponse « générée » : des groupes de 1 à 3 mots arrivent à un rythme irrégulier.
  // Pour afficher une nouvelle réponse : el.dataset.fxText = '…' puis FX.replay(el).
  FX.register('stream-text', {
    entrance: true,
    setup: function (el) {
      if (!el.dataset.fxText) el.dataset.fxText = el.textContent.trim().replace(/\s+/g, ' ');
      el.setAttribute('aria-label', el.dataset.fxText);
      if (!U.reduced) el.textContent = '';
    },
    reset: function (el) { el._fxStream = (el._fxStream || 0) + 1; el.textContent = ''; el.classList.remove('fx-done'); },
    enter: function (el) {
      var text = el.dataset.fxText;
      var run = el._fxStream = (el._fxStream || 0) + 1;
      el.setAttribute('aria-label', text);
      el.classList.remove('fx-done');
      if (U.reduced) { el.textContent = text; el.classList.add('fx-done'); return; }
      el.textContent = '';
      var words = text.split(' ');
      var speed = U.num(el, 'fxSpeed', 55);
      var caret = U.make('span', 'fx-caret', el);
      caret.setAttribute('aria-hidden', 'true');
      var i = 0;
      (function next() {
        if (run !== el._fxStream) return;
        var n = 1 + Math.floor(Math.random() * 3);
        for (var k = 0; k < n && i < words.length; k++, i++) {
          var tok = document.createElement('span');
          tok.className = 'fx-tok';
          tok.setAttribute('aria-hidden', 'true');
          tok.textContent = (i ? ' ' : '') + words[i];
          el.insertBefore(tok, caret);
        }
        if (i < words.length) setTimeout(next, speed * n * (.6 + Math.random() * .8));
        else {
          el.classList.add('fx-done');
          el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true }));
        }
      })();
    }
  });

  FX.register('text-shimmer', {});
  FX.register('ai-orb', {});

  // Champ de saisie qui écrit, montre puis efface des exemples de demandes, en boucle
  FX.register('prompt-box', {
    setup: function (el) {
      var list = (el.dataset.fxPrompts || 'Résume ce document en trois points|Propose un titre plus court').split('|');
      el.innerHTML = '<span class="fx-prompt-text"></span><span class="fx-prompt-caret" aria-hidden="true"></span><span class="fx-prompt-send" aria-hidden="true"></span>';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Exemples de demandes : ' + list.join(' ; '));
      el._fxPrompt = { list: list, i: 0, n: 0, phase: 'type', t: 0, txt: el.querySelector('.fx-prompt-text') };
      if (U.reduced) { el._fxPrompt.txt.textContent = list[0]; el.classList.add('fx-ready'); }
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      var s = el._fxPrompt;
      var word = s.list[s.i];
      s.t += dt * 1000;
      if (s.phase === 'type') {
        if (s.t < U.num(el, 'fxSpeed', 45)) return;
        s.t = 0;
        s.txt.textContent = word.slice(0, ++s.n);
        if (s.n >= word.length) { s.phase = 'hold'; el.classList.add('fx-ready'); }
      } else if (s.phase === 'hold') {
        if (s.t < U.num(el, 'fxHold', 1800)) return;
        s.t = 0;
        s.phase = 'erase';
        el.classList.remove('fx-ready');
      } else {
        if (s.t < 16) return;
        s.t = 0;
        s.n = Math.max(0, s.n - 2);
        s.txt.textContent = word.slice(0, s.n);
        if (!s.n) { s.phase = 'type'; s.i = (s.i + 1) % s.list.length; }
      }
    }
  });

  // Grille dont les lignes s'allument autour du curseur
  FX.register('glow-grid', {
    setup: function (el) {
      if (!U.canHover) return;
      // Écoute la fenêtre : la grille peut ainsi être un calque placé sous le contenu
      window.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        if (e.clientY < r.top - 200 || e.clientY > r.bottom + 200) return;
        el.style.setProperty('--fx-mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--fx-my', (e.clientY - r.top) + 'px');
      }, { passive: true });
    }
  });

  // Étapes d'un agent : chacune tourne pendant data-fx-step ms puis se coche
  FX.register('thinking-steps', {
    entrance: true,
    reset: function (el) {
      el._fxSteps = (el._fxSteps || 0) + 1;
      Array.prototype.forEach.call(el.children, function (li) { li.classList.remove('fx-active', 'fx-done'); });
    },
    enter: function (el) {
      var items = Array.prototype.slice.call(el.children);
      var run = el._fxSteps = (el._fxSteps || 0) + 1;
      if (U.reduced) { items.forEach(function (li) { li.classList.add('fx-done'); }); return; }
      var step = U.num(el, 'fxStep', 900);
      var i = 0;
      (function next() {
        if (run !== el._fxSteps) return;
        if (i > 0) { items[i - 1].classList.remove('fx-active'); items[i - 1].classList.add('fx-done'); }
        if (i >= items.length) { el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true })); return; }
        items[i].classList.add('fx-active');
        i++;
        setTimeout(next, step * (.7 + Math.random() * .6));
      })();
    }
  });
})(window.FX);

/* Pack 12 — Typographie cinétique */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Une vague de graisse parcourt le mot, lettre après lettre
  FX.register('weight-wave', {
    setup: function (el) { U.splitChars(el); el._fxChars = el.querySelectorAll('.fx-char'); },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var speed = U.num(el, 'fxSpeed', 1);
      el._fxChars.forEach(function (c, i) {
        c.style.setProperty('--fx-w', ((Math.sin(t * .003 * speed - i * .55) + 1) / 2).toFixed(3));
      });
    }
  });

  // Les lettres tombent du haut et rebondissent sur la ligne de base
  FX.register('letter-rain', {
    entrance: true,
    setup: function (el) { U.splitChars(el); el._fxChars = Array.prototype.slice.call(el.querySelectorAll('.fx-char')); },
    reset: function (el) { el._fxRun = (el._fxRun || 0) + 1; el._fxChars.forEach(function (c) { c.style.transform = ''; c.style.opacity = 0; }); },
    enter: function (el) {
      if (U.reduced) { el._fxChars.forEach(function (c) { c.style.opacity = 1; }); return; }
      var run = el._fxRun = (el._fxRun || 0) + 1;
      var g = U.num(el, 'fxGravity', 2600);
      var bits = el._fxChars.map(function () { return { y: -U.rand(120, 260), v: 0, wait: U.rand(0, .5), n: 0 }; });
      var last = 0;
      (function frame(t) {
        if (run !== el._fxRun) return;
        var dt = last ? Math.min((t - last) / 1000, .04) : 0;
        last = t;
        var moving = false;
        bits.forEach(function (b, i) {
          var c = el._fxChars[i];
          if (b.wait > 0) { b.wait -= dt; moving = true; return; }
          c.style.opacity = 1;
          if (b.n > 3) return;
          moving = true;
          b.v += g * dt;
          b.y += b.v * dt;
          if (b.y > 0) { b.y = 0; b.v *= -.42; b.n++; }
          c.style.transform = 'translateY(' + b.y.toFixed(1) + 'px)';
        });
        if (moving) U.raf(frame);
      })(0);
    }
  });

  // Le titre se resserre pendant qu'on défile vers lui
  FX.register('headline-collapse', {
    scroll: true,
    setup: function (el) { el.style.setProperty('--fx-gap', U.num(el, 'fxGap', .6) + 'em'); }
  });

  // Les lettres s'écartent du curseur et reviennent en douceur
  FX.register('cursor-repel', {
    setup: function (el) {
      U.splitChars(el);
      var s = el._fxS = { chars: Array.prototype.slice.call(el.querySelectorAll('.fx-char')).map(function (c) { return { el: c, x: 0, y: 0 }; }), mx: -9999, my: -9999 };
      if (!U.canHover || U.reduced) return;
      el.addEventListener('pointermove', function (e) { s.mx = e.clientX; s.my = e.clientY; });
      el.addEventListener('pointerleave', function () { s.mx = s.my = -9999; });
    },
    tick: function (el) {
      var s = el._fxS, R = U.num(el, 'fxRadius', 110), F = U.num(el, 'fxForce', 34);
      if (U.reduced) return;
      s.chars.forEach(function (c) {
        var r = c.el.getBoundingClientRect();
        var dx = r.left + r.width / 2 - c.x - s.mx, dy = r.top + r.height / 2 - c.y - s.my;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var k = Math.max(0, 1 - d / R);
        c.x += (dx / d * F * k - c.x) * .14;
        c.y += (dy / d * F * k - c.y) * .14;
        c.el.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px)';
      });
    }
  });

  // Le mot est le plus gras quand il passe au centre de l'écran
  FX.register('scroll-weight', {
    scroll: function (el, info) {
      el.style.setProperty('--fx-peak', (1 - Math.abs(info.pass * 2 - 1)).toFixed(3));
    }
  });

  // La lettre survolée s'étire et ses voisines suivent, comme un accordéon
  FX.register('letter-accordion', {
    setup: function (el) {
      U.splitChars(el);
      var cs = Array.prototype.slice.call(el.querySelectorAll('.fx-char'));
      function set(active) {
        cs.forEach(function (c, i) {
          var d = active < 0 ? 9 : Math.abs(i - active);
          c.style.setProperty('--fx-a', Math.max(0, 1 - d / 3).toFixed(2));
        });
      }
      cs.forEach(function (c, i) { c.addEventListener('pointerenter', function () { set(i); }); });
      el.addEventListener('pointerleave', function () { set(-1); });
      el.addEventListener('focusin', function () { set(0); });
      el.addEventListener('focusout', function () { set(-1); });
    }
  });

  // Texte en contour, rempli seulement autour du curseur
  FX.register('spot-fill', {
    setup: function (el) {
      var txt = el.textContent.trim();
      el.textContent = '';
      var box = el._fxBox = U.make('span', 'fx-sf', el);
      box.textContent = txt;
      box.dataset.fxLabel = txt;
      el._fxHover = false;
      el.addEventListener('pointermove', function (e) {
        var r = box.getBoundingClientRect();
        el._fxHover = true;
        el.style.setProperty('--fx-mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--fx-my', (e.clientY - r.top) + 'px');
      });
      el.addEventListener('pointerleave', function () { el._fxHover = false; });
    },
    tick: function (el, dt, t) {
      if (el._fxHover || U.reduced) return;
      var r = el._fxBox.getBoundingClientRect();
      el.style.setProperty('--fx-mx', ((Math.sin(t * .001) + 1) / 2 * r.width).toFixed(0) + 'px');
      el.style.setProperty('--fx-my', (r.height / 2).toFixed(0) + 'px');
    }
  });

  // Les lettres tournent en cercle puis se posent sur la ligne
  FX.register('letter-orbit', {
    entrance: true,
    setup: function (el) { U.splitChars(el); el._fxChars = Array.prototype.slice.call(el.querySelectorAll('.fx-char')); el._fxPlace = function (p) {
      var n = el._fxChars.length, R = U.num(el, 'fxRadius', 70);
      el._fxChars.forEach(function (c, i) {
        var q = U.easeInOut(U.clamp(p * 1.4 - i / n * .4, 0, 1));
        var a = i / n * Math.PI * 2 + (1 - q) * 3;
        var dx = Math.cos(a) * R * (1 - q), dy = Math.sin(a) * R * (1 - q);
        c.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) rotate(' + ((1 - q) * a * 57.3).toFixed(0) + 'deg)';
        c.style.opacity = Math.min(1, p * 4);
      });
    }; el._fxPlace(0); },
    reset: function (el) { el._fxPlace(0); },
    enter: function (el) { U.tween(el, U.num(el, 'fxDuration', 1500), el._fxPlace); }
  });

  // Le titre se reflète dessous, comme sur l'eau
  FX.register('mirror-type', {
    setup: function (el) {
      var txt = el.textContent.trim();
      el.innerHTML = '';
      U.make('span', 'fx-mir-top', el).textContent = txt;
      var m = U.make('span', 'fx-mir-low', el);
      m.textContent = txt;
      m.setAttribute('aria-hidden', 'true');
      el._fxLow = m;
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      el._fxLow.style.setProperty('--fx-sk', (Math.sin(t * .0016) * 4).toFixed(2) + 'deg');
    }
  });

  // Le titre se répète en éventail derrière lui
  FX.register('echo-stack', {
    setup: function (el) {
      var txt = el.textContent.trim(), n = U.num(el, 'fxCount', 5);
      el.textContent = '';
      var box = U.make('span', 'fx-echo-box', el);
      box.textContent = txt;
      for (var i = 1; i <= n; i++) {
        var s = U.make('span', 'fx-echo', box);
        s.textContent = txt;
        s.setAttribute('aria-hidden', 'true');
        s.style.setProperty('--fx-i', i);
      }
      el.style.setProperty('--fx-n', n);
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      el.style.setProperty('--fx-open', ((Math.sin(t * .0012) + 1) / 2).toFixed(3));
    }
  });

  // Chaque lettre est un rouleau de machine à sous qui s'arrête à son tour
  FX.register('slot-letters', {
    entrance: true,
    setup: function (el) {
      var txt = el.textContent.trim(), rolls = U.num(el, 'fxRolls', 8);
      el.setAttribute('aria-label', txt);
      el.textContent = '';
      Array.from(txt).forEach(function (ch, i) {
        var box = U.make('span', 'fx-slot', el);
        box.setAttribute('aria-hidden', 'true');
        var col = U.make('span', 'fx-slot-col', box);
        var s = '';
        for (var k = 0; k < rolls; k++) s += U.GLYPHS.charAt(Math.floor(Math.random() * U.GLYPHS.length)) + '\n';
        col.textContent = s + ch;
        col.style.setProperty('--fx-rolls', rolls);
        col.style.setProperty('--fx-i', i);
      });
    }
  });

  // Le titre s'allume point par point, comme un panneau d'affichage
  FX.register('dot-matrix', {
    entrance: true,
    setup: function (el) {
      var txt = el.textContent.trim();
      el.setAttribute('aria-label', txt);
      el.setAttribute('role', 'img');
      el.textContent = '';
      var cv = U.make('canvas', '', el), ctx = cv.getContext('2d');
      var cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
      var step = U.num(el, 'fxStep', 4), w, h, dots, last = 0;
      var font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
      var scan = function () {
        var off = document.createElement('canvas').getContext('2d');
        off.font = font;
        w = Math.ceil(off.measureText(txt).width); h = Math.ceil(fs * 1.2);
        off.canvas.width = w; off.canvas.height = h;
        off.font = font; off.textBaseline = 'middle'; off.fillText(txt, 0, h / 2);
        var data = off.getImageData(0, 0, w, h).data;
        dots = [];
        for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] > 120) dots.push([x, y]);
        cv.width = w; cv.height = h;
      };
      scan();
      if (document.fonts) document.fonts.load(font).then(function () { scan(); el._fxPaint(last); });
      el._fxPaint = function (p) {
        last = p;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = cs.color;
        dots.forEach(function (d) {
          var a = U.clamp(p * 1.5 - d[0] / w * .5, 0, 1);
          if (a <= 0) return;
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(d[0], d[1], step * .4, 0, 7);
          ctx.fill();
        });
      };
      el._fxPaint(0);
    },
    reset: function (el) { el._fxPaint(0); },
    enter: function (el) { U.tween(el, U.num(el, 'fxDuration', 1200), el._fxPaint); }
  });

  // Les lettres se résolvent à travers des blocs de densité
  FX.register('ascii-decay', {
    entrance: true,
    setup: function (el) {
      var txt = el.textContent.trim();
      el._fxTxt = txt;
      el.setAttribute('aria-label', txt);
      el._fxShow = function (p) {
        var ramp = '█▓▒░', out = '';
        for (var i = 0; i < txt.length; i++) {
          var q = U.clamp(p * 1.6 - i / txt.length * .6, 0, 1);
          if (txt[i] === ' ' || q >= 1) out += txt[i];
          else out += q <= 0 ? ' ' : ramp.charAt(Math.floor(q * ramp.length));
        }
        el.textContent = out;
      };
      if (!U.reduced) el._fxShow(0);
    },
    reset: function (el) { el._fxShow(0); },
    enter: function (el) { U.tween(el, U.num(el, 'fxDuration', 1400), el._fxShow); }
  });

  // Au survol, un saut se propage depuis la lettre touchée
  FX.register('hop-row', {
    setup: function (el) {
      U.splitChars(el);
      var cs = Array.prototype.slice.call(el.querySelectorAll('.fx-char'));
      cs.forEach(function (c, i) {
        c.addEventListener('pointerenter', function () {
          if (el.classList.contains('fx-hop')) return;
          cs.forEach(function (o, k) { o.style.setProperty('--fx-d', Math.abs(k - i)); });
          el.classList.add('fx-hop');
          setTimeout(function () { el.classList.remove('fx-hop'); }, 500 + cs.length * 40);
        });
      });
    }
  });

  // Le haut et le bas du mot glissent en sens contraire au défilement
  FX.register('half-shift', {
    scroll: function (el, info) { el.style.setProperty('--fx-shift', ((info.pass - .5) * U.num(el, 'fxShift', 60)).toFixed(1) + 'px'); },
    setup: function (el) {
      var t = el.textContent.trim();
      el.setAttribute('aria-label', t);
      el.innerHTML = '';
      ['fx-h-a', 'fx-h-b'].forEach(function (c) { var s = U.make('span', c, el); s.textContent = t; s.setAttribute('aria-hidden', 'true'); });
    }
  });

  // Au survol, la ligne de texte défile en continu
  FX.register('hover-marquee', {
    setup: function (el) {
      var txt = el.textContent.trim();
      el.setAttribute('aria-label', txt);
      el.textContent = '';
      var track = U.make('span', 'fx-hm-track', el);
      track.setAttribute('aria-hidden', 'true');
      var one = U.make('span', '', track);
      one.textContent = txt + ' — ';
      var w = one.offsetWidth || 120;
      var copies = Math.ceil((el.offsetWidth || 300) / w) + 1;
      for (var i = 0; i < copies; i++) track.appendChild(one.cloneNode(true));
      el.style.setProperty('--fx-w', w + 'px');
      el.style.setProperty('--fx-t', (w / U.num(el, 'fxSpeed', 80)).toFixed(2) + 's');
    }
  });

  // Les mots sont posés sur un cube qui tourne d'un quart de tour
  FX.register('cube-words', {
    setup: function (el) {
      var words = (el.dataset.fxWords || el.textContent).split('|').map(function (s) { return s.trim(); }).slice(0, 4);
      el.setAttribute('aria-label', words.join(', '));
      el.textContent = '';
      var cube = U.make('span', 'fx-cube', el);
      cube.setAttribute('aria-hidden', 'true');
      words.forEach(function (w, i) { var f = U.make('span', 'fx-face', cube); f.textContent = w; f.style.setProperty('--fx-i', i); });
      el._fxCube = { cube: cube, n: 0, t: 0, count: words.length };
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      var s = el._fxCube;
      s.t += dt * 1000;
      if (s.t < U.num(el, 'fxHold', 1800)) return;
      s.t = 0;
      s.n++;
      if (s.n % 4 >= s.count) s.n += 4 - s.n % 4;
      s.cube.style.setProperty('--fx-turn', s.n);
    }
  });

  // La casse des lettres hésite, puis se fixe au repos
  FX.register('case-shuffle', {
    setup: function (el) {
      el._fxOrig = el.textContent.trim();
      el._fxOn = true; el._fxT = 0;
      el.setAttribute('aria-label', el._fxOrig);
      el.addEventListener('pointerenter', function () { el._fxOn = true; });
      el.addEventListener('pointerleave', function () { el._fxOn = false; el.textContent = el._fxOrig; });
      setTimeout(function () { if (!el.matches(':hover')) { el._fxOn = false; el.textContent = el._fxOrig; } }, 1400);
    },
    tick: function (el, dt) {
      if (!el._fxOn || U.reduced) return;
      el._fxT += dt * 1000;
      if (el._fxT < U.num(el, 'fxRate', 90)) return;
      el._fxT = 0;
      el.textContent = Array.from(el._fxOrig).map(function (c) { return Math.random() < .5 ? c.toUpperCase() : c.toLowerCase(); }).join('');
    }
  });

  // L'espacement des lettres inspire et expire
  FX.register('breathe-track', {
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var c = (t / U.num(el, 'fxCycle', 6000)) % 1;
      var v = c < .45 ? U.easeInOut(c / .45) : c < .55 ? 1 : 1 - U.easeInOut((c - .55) / .45);
      el.style.setProperty('--fx-b', v.toFixed(3));
    }
  });

  // L'encre se répand depuis un trait fin jusqu'à la lettre nette
  FX.register('ink-bleed', {
    entrance: true,
    setup: function (el) {
      var root = document.getElementById('fx-ink-svg');
      if (!root) {
        root = document.createElement('div');
        root.id = 'fx-ink-svg';
        root.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        root.innerHTML = '<svg aria-hidden="true"><filter id="fx-ink"><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="3"/><feDisplacementMap in="SourceGraphic" scale="0"/></filter></svg>';
        document.body.appendChild(root);
      }
      el._fxMap = root.querySelector('feDisplacementMap');
    },
    enter: function (el) {
      var m = el._fxMap;
      U.tween(el, U.num(el, 'fxDuration', 1600), function (p) {
        m.setAttribute('scale', (U.num(el, 'fxScale', 40) * (1 - U.easeOut(p))).toFixed(1));
        el.style.opacity = Math.min(1, p * 3);
        if (p === 1) el.style.filter = 'none';
      });
    },
    reset: function (el) { el.style.filter = ''; el.style.opacity = 0; }
  });

  // Des barres noires se retirent des mots, dans le désordre
  FX.register('redact-reveal', {
    entrance: true,
    setup: function (el) {
      U.splitWords(el);
      var ws = Array.prototype.slice.call(el.querySelectorAll('.fx-word'));
      ws.map(function (w) { return { w: w, r: Math.random() }; })
        .sort(function (a, b) { return a.r - b.r; })
        .forEach(function (o, i) { o.w.style.setProperty('--fx-o', i); });
    }
  });

  // Chaque lettre est une étiquette collée de travers
  FX.register('sticker-letters', {
    entrance: true,
    setup: function (el) {
      U.splitChars(el);
      var pal = (el.dataset.fxColors || '').split(',').filter(Boolean);
      el.querySelectorAll('.fx-char').forEach(function (c, i) {
        c.style.setProperty('--fx-r', U.rand(-9, 9).toFixed(1) + 'deg');
        if (pal.length) c.style.background = pal[i % pal.length];
      });
    }
  });

  // Le titre glisse de côté quand on défile vite, puis revient
  FX.register('drift-title', {
    setup: function (el) { el._fxX = 0; },
    tick: function (el) {
      if (U.reduced) return;
      var target = U.velocity() * U.num(el, 'fxDrift', 3);
      el._fxX += (target - el._fxX) * .08;
      el.style.setProperty('--fx-x', el._fxX.toFixed(1) + 'px');
      el.style.setProperty('--fx-s', U.clamp(el._fxX * .05, -8, 8).toFixed(2) + 'deg');
    }
  });

  // Le texte suit une courbe et y avance en continu
  FX.register('path-type', {
    setup: function (el) {
      var txt = el.textContent.trim();
      var id = 'fx-path-' + Math.random().toString(36).slice(2, 8);
      el.setAttribute('aria-label', txt);
      el.setAttribute('role', 'img');
      el.innerHTML = '<svg viewBox="0 0 600 160" aria-hidden="true"><path id="' + id + '" d="' + (el.dataset.fxPath || 'M-20 90 C 120 -10, 220 190, 320 90 S 520 -10, 640 90') + '" fill="none"/><text><textPath href="#' + id + '"></textPath></text></svg>';
      el._fxTp = el.querySelector('textPath');
      el._fxTp.textContent = (txt + ' · ').repeat(4);
      el._fxO = 0;
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxO = (el._fxO + dt * U.num(el, 'fxSpeed', 2.4)) % 25;
      el._fxTp.setAttribute('startOffset', (-el._fxO) + '%');
    }
  });

  // Une couleur vive passe de mot en mot dans la phrase
  FX.register('color-cycle-words', {
    setup: function (el) {
      U.splitWords(el);
      el._fxW = el.querySelectorAll('.fx-word');
      el._fxT = 0; el._fxI = -1;
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxT += dt * 1000;
      if (el._fxT < U.num(el, 'fxStep', 500) && el._fxI >= 0) return;
      el._fxT = 0;
      if (el._fxI >= 0) el._fxW[el._fxI].classList.remove('fx-on');
      el._fxI = (el._fxI + 1) % el._fxW.length;
      el._fxW[el._fxI].classList.add('fx-on');
    }
  });

  // Le curseur est un soleil : l'ombre du titre part à l'opposé
  FX.register('sun-shadow', {
    setup: function (el) {
      var cast = function (dx, dy) {
        var n = U.num(el, 'fxLength', 18), col = U.cssVar(el, '--fx-shadow', 'rgba(0,0,0,.35)'), s = [];
        for (var i = 1; i <= n; i++) s.push((dx * i).toFixed(1) + 'px ' + (dy * i).toFixed(1) + 'px 0 ' + col);
        el.style.textShadow = s.join(',');
      };
      cast(.7, .7);
      if (!U.canHover || U.reduced) return;
      window.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > innerHeight + 200) return;
        var dx = r.left + r.width / 2 - e.clientX, dy = r.top + r.height / 2 - e.clientY;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        cast(dx / d, dy / d);
      }, { passive: true });
    }
  });

  // Le texte s'éloigne vers l'horizon, en perspective
  FX.register('depth-crawl', {
    setup: function (el) { el._fxY = el.offsetHeight * .75; },
    tick: function (el, dt) {
      if (U.reduced) return;
      var inner = el.firstElementChild;
      if (!inner) return;
      el._fxY += dt * U.num(el, 'fxSpeed', 22);
      if (el._fxY > inner.offsetHeight + el.offsetHeight) el._fxY = 0;
      inner.style.setProperty('--fx-y', (el.offsetHeight - el._fxY).toFixed(1) + 'px');
    }
  });

  // Au clic, les lettres se décrochent et tombent, puis reviennent
  FX.register('gravity-letters', {
    setup: function (el) { U.splitChars(el); el._fxChars = Array.prototype.slice.call(el.querySelectorAll('.fx-char')); },
    triggerOn: 'click',
    trigger: function (el) {
      if (U.reduced || el._fxFalling) return;
      el._fxFalling = true;
      var bits = el._fxChars.map(function () { return { x: 0, y: 0, vx: U.rand(-140, 140), vy: U.rand(-420, -120), r: 0, vr: U.rand(-300, 300) }; });
      var start = 0, last = 0;
      U.raf(function frame(t) {
        if (!start) start = last = t;
        var dt = (t - last) / 1000; last = t;
        bits.forEach(function (b, i) {
          b.vy += 1800 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt;
          el._fxChars[i].style.transform = 'translate(' + b.x.toFixed(0) + 'px,' + b.y.toFixed(0) + 'px) rotate(' + b.r.toFixed(0) + 'deg)';
        });
        if (t - start < 1000) return U.raf(frame);
        el._fxChars.forEach(function (c) { c.style.transition = 'transform .6s var(--fx-ease-spring)'; c.style.transform = ''; });
        setTimeout(function () { el._fxChars.forEach(function (c) { c.style.transition = ''; }); el._fxFalling = false; }, 650);
      });
    }
  });

  // Le mot passe de gros pixels à une image nette, par paliers
  FX.register('pixel-type', {
    entrance: true,
    setup: function (el) {
      var txt = el.textContent.trim();
      el.setAttribute('aria-label', txt); el.setAttribute('role', 'img');
      var cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
      var font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily, color = cs.color;
      el.textContent = '';
      var cv = U.make('canvas', '', el), ctx = cv.getContext('2d');
      var w, h, lastBlock = U.reduced ? 1 : 16;
      var size = function () {
        ctx.font = font;
        w = Math.ceil(ctx.measureText(txt).width); h = Math.ceil(fs * 1.25);
        cv.width = w; cv.height = h;
      };
      size();
      var off = document.createElement('canvas'), o = off.getContext('2d');
      if (document.fonts) document.fonts.load(font).then(function () { size(); el._fxDraw(lastBlock); });
      el._fxDraw = function (block) {
        lastBlock = block;
        ctx.font = font;
        if (Math.ceil(ctx.measureText(txt).width) !== w) size();
        var sw = Math.max(1, Math.ceil(w / block)), sh = Math.max(1, Math.ceil(h / block));
        off.width = sw; off.height = sh;
        o.setTransform(sw / w, 0, 0, sh / h, 0, 0);
        o.font = font; o.fillStyle = color; o.textBaseline = 'middle';
        o.fillText(txt, 0, h / 2);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, w, h);
      };
      el._fxDraw(U.reduced ? 1 : 16);
    },
    reset: function (el) { el._fxDraw(16); },
    enter: function (el) {
      var steps = [16, 8, 4, 2, 1];
      U.tween(el, U.num(el, 'fxDuration', 900), function (p) { el._fxDraw(steps[Math.min(4, Math.floor(p * 5))]); });
    }
  });

  // Un cercle dessiné à la main entoure le mot important
  FX.register('scribble-circle', {
    entrance: true,
    setup: function (el) {
      var j = function () { return U.rand(-3, 3).toFixed(1); };
      var d = 'M' + (12 + +j()) + ' 26 C 20 ' + (4 + +j()) + ', 170 ' + (2 + +j()) + ', 192 24 C 208 ' + (44 + +j()) + ', 110 ' + (58 + +j()) + ', 40 50 C -4 ' + (44 + +j()) + ', 2 ' + (14 + +j()) + ', 60 7 C 100 2, 150 3, 180 12';
      var w = document.createElement('span');
      w.className = 'fx-scribble';
      w.setAttribute('aria-hidden', 'true');
      w.innerHTML = '<svg viewBox="0 0 200 60" preserveAspectRatio="none"><path d="' + d + '" pathLength="1" fill="none"/></svg>';
      el.appendChild(w);
    }
  });
})(window.FX);

/* Pack 13 — Scènes de défilement */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Un cercle s'ouvre sur l'image à mesure qu'on défile
  FX.register('circle-unveil', {
    scroll: function (el, info) { el.style.setProperty('--fx-r', (U.easeInOut(info.enter) * 75).toFixed(2) + '%'); }
  });

  // Des lames horizontales s'ouvrent les unes après les autres
  FX.register('slat-scroll', {
    setup: function (el) {
      var n = U.num(el, 'fxSlats', 7);
      U.ensurePositioned(el);
      var box = U.make('div', 'fx-slats', el);
      box.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < n; i++) { var s = U.make('i', '', box); s.style.setProperty('--fx-q', U.clamp(1 - i / n, 0, 1)); }
      el.style.setProperty('--fx-n', n);
    },
    scroll: function (el, info) { el.style.setProperty('--fx-open', info.enter.toFixed(3)); }
  });

  // Le texte s'écrit au fil du défilement, et s'efface si on remonte
  FX.register('scroll-typing', {
    setup: function (el) {
      el._fxTxt = el.textContent.trim();
      el.setAttribute('aria-label', el._fxTxt);
      el.textContent = '';
      el._fxShown = U.make('span', 'fx-st-on', el);
      el._fxRest = U.make('span', 'fx-st-off', el);
      el._fxShown.setAttribute('aria-hidden', 'true');
      el._fxRest.setAttribute('aria-hidden', 'true');
    },
    scroll: function (el, info) {
      var n = Math.round(info.enter * el._fxTxt.length);
      if (n === el._fxN) return;
      el._fxN = n;
      el._fxShown.textContent = el._fxTxt.slice(0, n);
      el._fxRest.textContent = el._fxTxt.slice(n);
    }
  });

  // Une bande de texte géant traverse l'écran au défilement
  FX.register('band-slide', {
    setup: function (el) {
      var t = el.textContent.trim();
      el.setAttribute('aria-label', t);
      el.textContent = '';
      var b = U.make('span', 'fx-band', el);
      b.setAttribute('aria-hidden', 'true');
      b.textContent = (t + ' — ').repeat(6);
    },
    scroll: function (el, info) {
      var dir = el.dataset.fxDir === 'right' ? 1 : -1;
      el.style.setProperty('--fx-x', (info.pass * dir * U.num(el, 'fxTravel', 40)).toFixed(2) + '%');
    }
  });

  // Les lignes glissent en sens opposé
  FX.register('cross-rows', {
    setup: function (el) { Array.prototype.forEach.call(el.children, function (r, i) { r.style.setProperty('--fx-dir', i % 2 ? 1 : -1); }); },
    scroll: function (el, info) { el.style.setProperty('--fx-t', ((info.pass - .5) * U.num(el, 'fxTravel', 160)).toFixed(1) + 'px'); }
  });

  // Les cartes s'ouvrent en éventail au défilement
  FX.register('fan-scroll', {
    setup: function (el) {
      var n = el.children.length;
      Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-k', (i - (n - 1) / 2).toFixed(1)); });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-open', U.easeOut(info.enter).toFixed(3)); }
  });

  // On plonge à travers des cadres concentriques
  FX.register('tunnel-scroll', {
    setup: function (el) {
      var n = U.num(el, 'fxFrames', 6);
      U.ensurePositioned(el);
      for (var i = 0; i < n; i++) {
        var f = U.make('i', 'fx-tun', el);
        f.setAttribute('aria-hidden', 'true');
        f.style.setProperty('--fx-q', i / n);
      }
    },
    scroll: function (el, info) { el.style.setProperty('--fx-dive', info.pass.toFixed(3)); }
  });

  // Chaque couche se déplace selon sa profondeur
  FX.register('depth-stack', {
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-z', c.dataset.depth || (i + 1) / el.children.length); });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-y', ((.5 - info.pass) * U.num(el, 'fxAmp', 180)).toFixed(1) + 'px'); }
  });

  // Une interface couchée se redresse et se pose
  FX.register('plane-land', {
    scroll: function (el, info) { el.style.setProperty('--fx-land', (1 - U.easeOut(info.enter)).toFixed(3)); }
  });

  // Les éléments tournent sur une roue verticale
  FX.register('wheel-scroll', {
    setup: function (el) { el._fxK = el.children.length; Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-i', i); }); el.style.setProperty('--fx-count', el._fxK); },
    scroll: function (el, info) { el.style.setProperty('--fx-rot', ((info.pass - .5) * U.num(el, 'fxTurn', 180)).toFixed(1) + 'deg'); }
  });

  // Un fil se remplit le long de la section
  FX.register('thread-line', {
    setup: function (el) { U.ensurePositioned(el); var t = U.make('i', 'fx-thread', el); t.setAttribute('aria-hidden', 'true'); U.make('b', '', t); },
    scroll: function (el, info) {
      var p = U.clamp((info.vh * .6 - info.rect.top) / Math.max(1, info.rect.height), 0, 1);
      el.style.setProperty('--fx-fill', p.toFixed(3));
    }
  });

  // Une vague fait gonfler les points d'une grille
  FX.register('dot-swell', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-swell', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxP = .5;
    },
    scroll: function (el, info) { el._fxP = info.pass; },
    tick: function (el) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight, step = U.num(el, 'fxStep', 16);
      if (!w) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      if (el._fxDrawn === el._fxP && cv.dataset.w === '' + w) return;
      el._fxDrawn = el._fxP; cv.dataset.w = w;
      var c = cv.getContext('2d'), front = el._fxP * (h + 160) - 80;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      for (var y = step / 2; y < h; y += step) for (var x = step / 2; x < w; x += step) {
        var k = Math.max(0, 1 - Math.abs(y - front) / 80);
        c.beginPath(); c.arc(x, y, .8 + k * step * .42, 0, 7); c.fill();
      }
    }
  });

  // On entre dans le mot : il grandit jusqu'à devenir l'écran
  FX.register('aperture-text', {
    setup: function (el) { el.style.overflow = 'hidden'; },
    scroll: function (el, info) { el.style.setProperty('--fx-zoom', Math.pow(U.num(el, 'fxMax', 18), U.clamp(info.pass * 2 - .6, 0, 1)).toFixed(2)); }
  });

  // La teinte glisse au fil du défilement
  FX.register('hue-drift', {
    scroll: function (el, info) { el.style.setProperty('--fx-hue', (info.pass * U.num(el, 'fxRange', 140)).toFixed(1) + 'deg'); }
  });

  // Les barres montent et redescendent avec le défilement
  FX.register('bars-scrub', {
    setup: function (el) {
      var v = (el.dataset.fxValues || '30,55,40,75,60,95').split(',').map(Number), max = Math.max.apply(null, v);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Valeurs : ' + v.join(', '));
      v.forEach(function (n, i) {
        var b = U.make('i', '', el);
        b.style.setProperty('--fx-v', n / max);
        b.style.setProperty('--fx-q', i / v.length);
      });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-grow', info.enter.toFixed(3)); }
  });

  // Deux battants s'ouvrent sur le contenu
  FX.register('door-scroll', {
    setup: function (el) {
      U.ensurePositioned(el);
      ['fx-door-l', 'fx-door-r'].forEach(function (c) { U.make('i', c, el).setAttribute('aria-hidden', 'true'); });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-door', U.easeInOut(U.clamp(info.enter * 1.2 - .1, 0, 1)).toFixed(3)); }
  });

  // La grille se resserre en arrivant au centre
  FX.register('grid-breathe', {
    scroll: function (el, info) { el.style.setProperty('--fx-air', Math.abs(info.pass * 2 - 1).toFixed(3)); }
  });

  // La carte se retourne au fil du défilement
  FX.register('flip-scrub', {
    scroll: function (el, info) { el.style.setProperty('--fx-a', (U.clamp(info.pass * 2 - .5, 0, 1) * 180).toFixed(1) + 'deg'); }
  });

  // Un rideau de couleur se lève au défilement
  FX.register('curtain-scrub', {
    setup: function (el) { U.ensurePositioned(el); U.make('i', 'fx-cs', el).setAttribute('aria-hidden', 'true'); },
    scroll: function (el, info) { el.style.setProperty('--fx-lift', U.easeOut(info.enter).toFixed(3)); }
  });

  // Les lettres dispersées se rassemblent au défilement
  FX.register('letters-scrub', {
    setup: function (el) {
      U.splitChars(el);
      el.querySelectorAll('.fx-char').forEach(function (c) {
        c.style.setProperty('--fx-dx', U.rand(-90, 90).toFixed(0) + 'px');
        c.style.setProperty('--fx-dy', U.rand(-70, 70).toFixed(0) + 'px');
        c.style.setProperty('--fx-dr', U.rand(-120, 120).toFixed(0) + 'deg');
      });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-left', (1 - U.easeOut(info.enter)).toFixed(3)); }
  });

  // Les mots passent du gris au plein quand on les atteint
  FX.register('reading-marker', {
    setup: function (el) { U.splitWords(el); el._fxW = el.querySelectorAll('.fx-word'); el._fxN = -1; },
    scroll: function (el, info) {
      var line = info.vh * U.num(el, 'fxLine', .65);
      var p = U.clamp((line - info.rect.top) / Math.max(1, info.rect.height), 0, 1);
      var n = Math.round(p * el._fxW.length);
      if (n === el._fxN) return;
      el._fxN = n;
      el._fxW.forEach(function (w, i) { w.classList.toggle('fx-read', i < n); });
    }
  });

  // Un compteur de chapitres suit la page
  FX.register('chapter-ticker', {
    setup: function (el) {
      var sel = el.dataset.fxTarget || 'section';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<span class="fx-tk-col"></span><span class="fx-tk-tot"></span>';
      el._fxCol = el.firstChild;
      el._fxSec = Array.prototype.slice.call(document.querySelectorAll(sel));
      var n = Math.max(el._fxSec.length, U.num(el, 'fxCount', 5));
      for (var i = 1; i <= n; i++) U.make('b', '', el._fxCol).textContent = ('0' + i).slice(-2);
      el.lastChild.textContent = '/' + ('0' + n).slice(-2);
      el._fxCount = n;
    },
    scroll: function (el, info) {
      var i = 0;
      if (el._fxSec.length) el._fxSec.forEach(function (s, k) { if (s.getBoundingClientRect().top < info.vh * .5) i = k; });
      else i = Math.floor(info.pass * el._fxCount * .999);
      el.style.setProperty('--fx-cur', i);
    }
  });

  // L'image coulisse lentement à l'intérieur de son cadre
  FX.register('frame-drift', {
    scroll: function (el, info) { el.style.setProperty('--fx-d', ((info.pass - .5) * U.num(el, 'fxRange', 16)).toFixed(2) + '%'); }
  });

  // La bordure de section ondule quand on défile
  FX.register('wave-morph', {
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<svg viewBox="0 0 600 100" preserveAspectRatio="none"><path/></svg>';
      el._fxPath = el.querySelector('path');
    },
    scroll: function (el, info) {
      var a = 10 + Math.abs(U.velocity()) * .5 + U.num(el, 'fxAmp', 22) * Math.sin(info.pass * 3.14), ph = info.pass * 9, d = 'M0 100 L0 50';
      for (var x = 0; x <= 600; x += 30) d += ' L' + x + ' ' + (50 + Math.sin(x * .012 + ph) * a).toFixed(1);
      el._fxPath.setAttribute('d', d + ' L600 100 Z');
    }
  });

  // Des éléments tournent autour d'un centre au défilement
  FX.register('orbit-scrub', {
    setup: function (el) { var n = el.children.length; Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-a', (i / n * 360) + 'deg'); }); },
    scroll: function (el, info) { el.style.setProperty('--fx-turn', (info.pass * U.num(el, 'fxTurn', 240)).toFixed(1) + 'deg'); }
  });

  // Les blocs s'alignent comme des marches
  FX.register('stairs-scroll', {
    setup: function (el) { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-i', i); }); },
    scroll: function (el, info) { el.style.setProperty('--fx-rest', (1 - U.easeOut(info.enter)).toFixed(3)); }
  });

  // Un balayage progressif dévoile l'élément en biais
  FX.register('wipe-scrub', {
    scroll: function (el, info) { el.style.setProperty('--fx-at', (info.enter * 160 - 30).toFixed(1) + '%'); }
  });

  // La section recule et s'arrondit en sortant
  FX.register('card-recede', {
    scroll: function (el, info) {
      var out = U.clamp(-info.rect.top / Math.max(1, Math.min(info.rect.height, info.vh)), 0, 1);
      el.style.setProperty('--fx-out', (el.dataset.fxDemo ? info.pass : out).toFixed(3));
    }
  });

  // Des lignes de vitesse apparaissent quand on défile vite
  FX.register('speed-lines', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-speed', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxLn = [];
      for (var i = 0; i < U.num(el, 'fxLines', 26); i++) el._fxLn.push({ x: Math.random(), y: Math.random(), k: U.rand(.4, 1) });
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var v = el.dataset.fxDemo ? 60 * (.5 + .5 * Math.sin(t * .002)) : U.velocity();
      var c = cv.getContext('2d');
      c.clearRect(0, 0, w, h);
      if (Math.abs(v) < 1) return;
      c.strokeStyle = getComputedStyle(cv).color;
      c.lineWidth = 1;
      el._fxLn.forEach(function (l) {
        l.y = (l.y + v * l.k * .0009 + 1) % 1;
        var y = l.y * h, len = Math.abs(v) * l.k * 1.8;
        c.globalAlpha = Math.min(1, Math.abs(v) / 40) * l.k;
        c.beginPath(); c.moveTo(l.x * w, y); c.lineTo(l.x * w, y + len); c.stroke();
      });
    }
  });

  // Une jauge circulaire se remplit selon le défilement de l'élément
  FX.register('scroll-gauge', {
    setup: function (el) {
      el.setAttribute('role', 'meter');
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
      el.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="fx-g-bg"/><circle cx="50" cy="50" r="44" pathLength="100" class="fx-g-on"/></svg><b></b>';
      el._fxV = el.querySelector('b');
      el._fxGoal = U.num(el, 'fxGoal', 100);
    },
    scroll: function (el, info) {
      var v = Math.round(info.enter * el._fxGoal);
      el.style.setProperty('--fx-v', v);
      el._fxV.textContent = v + '%';
      el.setAttribute('aria-valuenow', v);
    }
  });
})(window.FX);

/* Pack 14 — Gestes et curseur */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Un point suit le curseur à l'intérieur de l'élément, retenu par un ressort
  FX.register('spring-follow', {
    setup: function (el) {
      U.ensurePositioned(el);
      var dot = U.make('i', 'fx-spring-dot', el);
      dot.setAttribute('aria-hidden', 'true');
      var s = el._fxS = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, dot: dot };
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        s.tx = e.clientX - r.left; s.ty = e.clientY - r.top;
        el.classList.add('fx-on');
      });
      el.addEventListener('pointerleave', function () { el.classList.remove('fx-on'); });
    },
    tick: function (el, dt) {
      var s = el._fxS, k = U.num(el, 'fxStiff', 90), d = U.num(el, 'fxDamp', 11);
      if (U.reduced) { s.x = s.tx; s.y = s.ty; }
      else {
        s.vx += ((s.tx - s.x) * k - s.vx * d) * dt; s.vy += ((s.ty - s.y) * k - s.vy * d) * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
      }
      s.dot.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px)';
    }
  });

  // On attrape l'élément, il s'étire, puis revient comme un élastique
  FX.register('squish-drag', {
    setup: function (el) {
      var s = el._fxS = { x: 0, y: 0, vx: 0, vy: 0, drag: false, sx: 0, sy: 0 };
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', function (e) {
        s.drag = true; s.sx = e.clientX - s.x; s.sy = e.clientY - s.y;
        if (el.setPointerCapture && e.isTrusted) el.setPointerCapture(e.pointerId);
        el.classList.add('fx-grab');
      });
      el.addEventListener('pointermove', function (e) {
        if (!s.drag) return;
        var nx = e.clientX - s.sx, ny = e.clientY - s.sy;
        s.vx = (nx - s.x) * 60; s.vy = (ny - s.y) * 60; s.x = nx; s.y = ny;
      });
      var up = function () { s.drag = false; el.classList.remove('fx-grab'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
    tick: function (el, dt) {
      var s = el._fxS;
      if (!s.drag) {
        s.vx += (-s.x * 120 - s.vx * 10) * dt; s.vy += (-s.y * 120 - s.vy * 10) * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (U.reduced) { s.x = s.y = 0; }
      }
      var sp = U.clamp(Math.sqrt(s.vx * s.vx + s.vy * s.vy) * .0003, 0, .35);
      var a = Math.atan2(s.vy, s.vx) * 57.3;
      el.style.transform = 'translate(' + s.x.toFixed(1) + 'px,' + s.y.toFixed(1) + 'px) rotate(' + a.toFixed(1) + 'deg) scale(' + (1 + sp).toFixed(3) + ',' + (1 - sp).toFixed(3) + ') rotate(' + (-a).toFixed(1) + 'deg)';
      if (s.drag) { s.vx *= .8; s.vy *= .8; }
    }
  });

  // Une étiquette accompagne le curseur au survol
  FX.register('cursor-label', {
    setup: function (el) {
      U.ensurePositioned(el);
      var l = U.make('span', 'fx-cl', el);
      l.textContent = el.dataset.fxLabel || 'Voir';
      l.setAttribute('aria-hidden', 'true');
      var s = el._fxS = { x: 0, y: 0, tx: 0, ty: 0, l: l };
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        s.tx = e.clientX - r.left; s.ty = e.clientY - r.top;
        el.classList.add('fx-on');
      });
      el.addEventListener('pointerleave', function () { el.classList.remove('fx-on'); });
    },
    tick: function (el) {
      var s = el._fxS;
      s.x = U.lerp(s.x, s.tx, .16); s.y = U.lerp(s.y, s.ty, .16);
      s.l.style.setProperty('--fx-x', s.x.toFixed(1) + 'px');
      s.l.style.setProperty('--fx-y', s.y.toFixed(1) + 'px');
    }
  });

  // Le texte pivote en 3D vers le curseur, avec un reflet qui glisse
  FX.register('hover-tilt-text', {
    setup: function (el) {
      var s = el._fxS = { rx: 0, ry: 0, tx: 0, ty: 0 };
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        s.ty = ((e.clientX - r.left) / r.width - .5) * U.num(el, 'fxMax', 26);
        s.tx = -((e.clientY - r.top) / r.height - .5) * U.num(el, 'fxMax', 26);
      });
      el.addEventListener('pointerleave', function () { s.tx = s.ty = 0; });
    },
    tick: function (el) {
      var s = el._fxS;
      if (U.reduced) return;
      s.rx = U.lerp(s.rx, s.tx, .1); s.ry = U.lerp(s.ry, s.ty, .1);
      el.style.setProperty('--fx-rx', s.rx.toFixed(2) + 'deg');
      el.style.setProperty('--fx-ry', s.ry.toFixed(2) + 'deg');
      el.style.setProperty('--fx-sx', (s.ry * -.5).toFixed(1) + 'px');
      el.style.setProperty('--fx-sy', (s.rx * .5).toFixed(1) + 'px');
    }
  });

  // Au clic, un cercle part du doigt et inverse la couleur du bouton
  FX.register('press-ripple-text', {
    setup: function (el) {
      var text = el.textContent;
      el.innerHTML = '<span class="fx-prt-a"></span><span class="fx-prt-b" aria-hidden="true"></span>';
      el.firstChild.textContent = text; el.lastChild.textContent = text;
    },
    triggerOn: 'click',
    trigger: function (el, e) {
      var r = el.getBoundingClientRect();
      var keyboard = !e || !e.clientX;
      el.style.setProperty('--fx-x', (keyboard ? r.width / 2 : e.clientX - r.left) + 'px');
      el.style.setProperty('--fx-y', (keyboard ? r.height / 2 : e.clientY - r.top) + 'px');
      el.classList.remove('fx-go');
      void el.offsetWidth;
      el.classList.add('fx-go');
      setTimeout(function () { el.classList.remove('fx-go'); }, 800);
    }
  });

  // Un bandeau unique glisse d'une ligne à l'autre
  FX.register('swipe-reveal-row', {
    setup: function (el) {
      U.ensurePositioned(el);
      var bg = U.make('i', 'fx-srr', el);
      bg.setAttribute('aria-hidden', 'true');
      el.insertBefore(bg, el.firstChild);
      var go = function (row) {
        el.style.setProperty('--fx-y', row.offsetTop + 'px');
        el.style.setProperty('--fx-h', row.offsetHeight + 'px');
        el.classList.add('fx-on');
      };
      Array.prototype.forEach.call(el.children, function (row) {
        if (row === bg) return;
        row.addEventListener('pointerenter', function () { go(row); });
        row.addEventListener('focusin', function () { go(row); });
      });
      el.addEventListener('pointerleave', function () { el.classList.remove('fx-on'); });
    }
  });

  // Une chaîne de perles suit le curseur
  FX.register('trail-dots', {
    setup: function (el) {
      U.ensurePositioned(el);
      var n = U.num(el, 'fxCount', 10), s = el._fxS = { pts: [], tx: 0, ty: 0 };
      for (var i = 0; i < n; i++) {
        var d = U.make('i', 'fx-td', el);
        d.setAttribute('aria-hidden', 'true');
        d.style.setProperty('--fx-q', 1 - i / n);
        s.pts.push({ x: 0, y: 0, el: d });
      }
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        s.tx = e.clientX - r.left; s.ty = e.clientY - r.top;
        el.classList.add('fx-on');
      });
      el.addEventListener('pointerleave', function () { el.classList.remove('fx-on'); });
    },
    tick: function (el) {
      var s = el._fxS, px = s.tx, py = s.ty;
      if (U.reduced) return;
      s.pts.forEach(function (p) {
        p.x = U.lerp(p.x, px, .34); p.y = U.lerp(p.y, py, .34);
        p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
        px = p.x; py = p.y;
      });
    }
  });

  // Il faut maintenir le bouton pour confirmer
  FX.register('hold-confirm', {
    setup: function (el) {
      var t = 0, holding = false, done = false, dur = U.num(el, 'fxHold', 1200);
      var start = function () { if (done) return; holding = true; el.classList.add('fx-hold'); };
      var stop = function () { holding = false; if (!done) { t = 0; el.style.setProperty('--fx-h', 0); el.classList.remove('fx-hold'); } };
      el.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (n) { el.addEventListener(n, stop); });
      el.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
      el.addEventListener('keyup', stop);
      el._fxStep = function (dt) {
        if (!holding || done) return;
        t += dt * 1000;
        el.style.setProperty('--fx-h', Math.min(1, t / dur).toFixed(3));
        if (t >= dur) {
          done = true;
          el.classList.add('fx-confirmed');
          el.dispatchEvent(new CustomEvent('fx:confirm', { bubbles: true }));
          setTimeout(function () { done = false; holding = false; t = 0; el.style.setProperty('--fx-h', 0); el.classList.remove('fx-confirmed', 'fx-hold'); }, 1600);
        }
      };
    },
    tick: function (el, dt) { el._fxStep(dt); }
  });

  // Un interrupteur dont le bouton s'étire avant de sauter de l'autre côté
  FX.register('snap-toggle', {
    setup: function (el) {
      el.setAttribute('role', 'switch');
      el.tabIndex = 0;
      el.setAttribute('aria-checked', el.dataset.fxOn === 'true' ? 'true' : 'false');
      U.make('i', '', el).setAttribute('aria-hidden', 'true');
      el.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); FX.trigger(el); } });
    },
    triggerOn: 'click',
    trigger: function (el) {
      var on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', on);
      el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { on: on } }));
    }
  });

  // Un compteur dont le chiffre glisse dans le sens du changement
  FX.register('stepper-pop', {
    setup: function (el) {
      var v = U.num(el, 'fxValue', 1), min = U.num(el, 'fxMin', 0), max = U.num(el, 'fxMax', 99);
      el.setAttribute('role', 'group');
      el.innerHTML = '<button type="button" aria-label="Moins">−</button><output aria-live="polite"><span></span></output><button type="button" aria-label="Plus">+</button>';
      var out = el.querySelector('output');
      out.firstChild.textContent = v;
      var change = function (d) {
        var nv = U.clamp(v + d, min, max);
        if (nv === v) { el.classList.remove('fx-stop'); void el.offsetWidth; el.classList.add('fx-stop'); return; }
        v = nv;
        var s = document.createElement('span');
        s.textContent = v;
        s.className = d > 0 ? 'fx-up' : 'fx-down';
        out.textContent = '';
        out.appendChild(s);
        el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { value: v } }));
      };
      el.firstChild.addEventListener('click', function () { change(-1); });
      el.lastChild.addEventListener('click', function () { change(1); });
    }
  });

  // Une note dont les étoiles s'allument en vague
  FX.register('star-rate', {
    setup: function (el) {
      var n = U.num(el, 'fxMax', 5), val = U.num(el, 'fxValue', 0);
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', n);
      el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Note');
      el.tabIndex = 0;
      var stars = [];
      for (var i = 0; i < n; i++) { var s = U.make('i', '', el); s.textContent = '★'; s.style.setProperty('--fx-i', i); stars.push(s); }
      var paint = function (k) { stars.forEach(function (s, i) { s.classList.toggle('fx-on', i < k); }); };
      var set = function (k) {
        val = U.clamp(k, 0, n); paint(val);
        el.setAttribute('aria-valuenow', val);
        el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { value: val } }));
      };
      stars.forEach(function (s, i) {
        s.addEventListener('pointerenter', function () { paint(i + 1); });
        s.addEventListener('click', function () { set(i + 1); });
      });
      el.addEventListener('pointerleave', function () { paint(val); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(val + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(val - 1); }
      });
      paint(val); el.setAttribute('aria-valuenow', val);
    }
  });

  // Une goutte de couleur entre par le côté où arrive le curseur
  FX.register('ink-button', {
    setup: function (el) {
      var mark = function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-x', (e.clientX - r.left) + 'px');
        el.style.setProperty('--fx-y', (e.clientY - r.top) + 'px');
      };
      el.addEventListener('pointerenter', mark);
      el.addEventListener('pointerleave', mark);
    }
  });

  // Un bouton dont les actions s'échappent comme des gouttes
  FX.register('gooey-menu', {
    setup: function (el) {
      if (!document.getElementById('fx-goo')) {
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        d.innerHTML = '<svg aria-hidden="true"><filter id="fx-goo"><feGaussianBlur in="SourceGraphic" stdDeviation="7"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -9"/></filter></svg>';
        document.body.appendChild(d);
      }
      var btn = el.querySelector('button');
      var items = el.querySelectorAll('a,[data-item]');
      // Les gouttes sont dans un calque filtré à part : les icônes restent nettes au-dessus
      var layer = U.make('span', 'fx-goo-l', el);
      layer.setAttribute('aria-hidden', 'true');
      el.insertBefore(layer, el.firstChild);
      U.make('i', '', layer);
      items.forEach(function (a, i) {
        a.style.setProperty('--fx-i', i + 1);
        U.make('i', '', layer).style.setProperty('--fx-i', i + 1);
      });
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () {
        var on = !el.classList.contains('fx-open');
        el.classList.toggle('fx-open', on);
        btn.setAttribute('aria-expanded', on);
      });
    }
  });

  // Une plaque de verre dont le reflet suit le curseur
  FX.register('liquid-glass', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', function () { el.style.removeProperty('--fx-gx'); el.style.removeProperty('--fx-gy'); });
    }
  });

  // Les éléments grossissent à l'approche du curseur, comme un dock
  FX.register('jelly-list', {
    setup: function (el) {
      var items = Array.prototype.slice.call(el.children);
      var R = U.num(el, 'fxRadius', 110);
      el.addEventListener('pointermove', function (e) {
        items.forEach(function (it) {
          var r = it.getBoundingClientRect();
          var d = Math.abs(r.left + r.width / 2 - e.clientX);
          it.style.setProperty('--fx-k', Math.max(0, 1 - d / R).toFixed(3));
        });
      });
      el.addEventListener('pointerleave', function () { items.forEach(function (it) { it.style.setProperty('--fx-k', 0); }); });
    }
  });

  // Un cadre lumineux glisse d'un champ au suivant
  FX.register('focus-beam', {
    setup: function (el) {
      U.ensurePositioned(el);
      var b = U.make('i', 'fx-beam', el);
      b.setAttribute('aria-hidden', 'true');
      el.addEventListener('focusin', function (e) {
        var r = e.target.getBoundingClientRect(), o = el.getBoundingClientRect();
        b.style.transform = 'translate(' + (r.left - o.left) + 'px,' + (r.top - o.top) + 'px)';
        b.style.width = r.width + 'px';
        b.style.height = r.height + 'px';
        el.classList.add('fx-on');
      });
      el.addEventListener('focusout', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('fx-on'); });
    }
  });

  // Une lumière fait le tour de la carte, plus vite au survol
  FX.register('border-chase', {
    setup: function (el) { el._fxA = 0; el._fxV = 40; },
    tick: function (el, dt) {
      if (U.reduced) return;
      var target = el.matches(':hover') ? 240 : U.num(el, 'fxIdle', 50);
      el._fxV = U.lerp(el._fxV, target, .05);
      el._fxA = (el._fxA + el._fxV * dt) % 360;
      el.style.setProperty('--fx-ang', el._fxA.toFixed(1) + 'deg');
    }
  });

  // Le coin d'une note se soulève à l'approche du curseur
  FX.register('sticky-note-peel', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var d = Math.hypot(r.right - e.clientX, r.bottom - e.clientY);
        el.style.setProperty('--fx-lift', U.clamp(1 - d / (r.width * .9), .12, 1).toFixed(3));
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--fx-lift', 0); });
    }
  });

  // Une petite image s'ouvre au milieu de la ligne au survol du lien
  FX.register('image-pop-link', {
    setup: function (el) {
      var i = document.createElement('img');
      i.src = el.dataset.fxImg || 'assets/dune.svg';
      i.alt = '';
      i.className = 'fx-ipl';
      i.setAttribute('aria-hidden', 'true');
      var at = U.num(el, 'fxAt', -1);
      var words = el.textContent.trim().split(' ');
      if (at < 0) at = Math.ceil(words.length / 2);
      el.textContent = words.slice(0, at).join(' ') + ' ';
      el.appendChild(i);
      el.appendChild(document.createTextNode(' ' + words.slice(at).join(' ')));
    }
  });

  // Une liste que l'on réorganise en faisant glisser, et les voisins s'écartent
  FX.register('drag-reorder', {
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (it) {
        it.tabIndex = 0;
        var startY = 0, drag = false;
        it.addEventListener('pointerdown', function (e) {
          drag = true; startY = e.clientY; it.classList.add('fx-drag');
          if (it.setPointerCapture && e.isTrusted) it.setPointerCapture(e.pointerId);
        });
        it.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var dy = e.clientY - startY;
          it.style.transform = 'translateY(' + dy + 'px) scale(1.03)';
          var h = it.offsetHeight;
          if (dy > h * .6 && it.nextElementSibling) { el.insertBefore(it.nextElementSibling, it); startY += h; flash(it); }
          else if (dy < -h * .6 && it.previousElementSibling) { el.insertBefore(it, it.previousElementSibling); startY -= h; flash(it); }
        });
        var end = function () { drag = false; it.classList.remove('fx-drag'); it.style.transform = ''; };
        it.addEventListener('pointerup', end);
        it.addEventListener('pointercancel', end);
        it.addEventListener('keydown', function (e) {
          if (!e.altKey) return;
          if (e.key === 'ArrowDown' && it.nextElementSibling) { e.preventDefault(); el.insertBefore(it.nextElementSibling, it); it.focus(); }
          if (e.key === 'ArrowUp' && it.previousElementSibling) { e.preventDefault(); el.insertBefore(it, it.previousElementSibling); it.focus(); }
        });
      });
      function flash() { el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true })); }
    }
  });

  // Une pile de cartes qu'on balaye vers la gauche ou la droite
  FX.register('swipe-card', {
    setup: function (el) {
      var layout = function () { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-pos', i); c.style.zIndex = 20 - i; }); };
      layout();
      var top = function () { return el.firstElementChild; }, sx = 0, dx = 0, drag = false;
      var send = function (dir) {
        var c = top();
        el.classList.add('fx-fly');
        c.style.transform = 'translateX(' + (dir * 340) + 'px) rotate(' + (dir * 24) + 'deg)';
        c.style.opacity = 0;
        el.dispatchEvent(new CustomEvent('fx:swipe', { bubbles: true, detail: { dir: dir > 0 ? 'right' : 'left' } }));
        setTimeout(function () { el.classList.remove('fx-fly'); c.style.transform = ''; c.style.opacity = ''; el.appendChild(c); layout(); }, 300);
      };
      el.tabIndex = 0;
      el.addEventListener('pointerdown', function (e) { drag = true; sx = e.clientX; dx = 0; if (e.isTrusted) el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', function (e) {
        if (!drag) return;
        dx = e.clientX - sx;
        top().style.transform = 'translateX(' + dx + 'px) rotate(' + dx * .08 + 'deg)';
      });
      var up = function () {
        if (!drag) return;
        drag = false;
        if (Math.abs(dx) > U.num(el, 'fxDistance', 80)) send(dx > 0 ? 1 : -1);
        else top().style.transform = '';
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') send(-1);
        if (e.key === 'ArrowRight') send(1);
      });
    }
  });

  // Un petit égaliseur s'anime au survol
  FX.register('sound-bars-hover', {
    setup: function (el) {
      var n = U.num(el, 'fxBars', 5);
      el.setAttribute('aria-hidden', 'true');
      el._fxB = [];
      for (var i = 0; i < n; i++) el._fxB.push({ el: U.make('i', '', el), v: .2, a: U.rand(.006, .012), b: U.rand(.002, .006) });
      el._fxAll = el.dataset.fxAuto === 'true';
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var hot = el._fxAll || el.matches(':hover') || (el.parentElement && el.parentElement.matches(':hover'));
      el._fxB.forEach(function (b) {
        var tg = hot ? .25 + .75 * Math.abs(Math.sin(t * b.a) * Math.cos(t * b.b)) : .18;
        b.v = U.lerp(b.v, tg, .22);
        b.el.style.transform = 'scaleY(' + b.v.toFixed(3) + ')';
      });
    }
  });

  // Plus on appuie longtemps, plus le mot s'écrase
  FX.register('pressure-word', {
    setup: function (el) {
      el._fxP = 0; el._fxDown = false;
      el.addEventListener('pointerdown', function () { el._fxDown = true; });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { el.addEventListener(n, function () { el._fxDown = false; }); });
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxP = el._fxDown ? Math.min(1, el._fxP + dt * 1.2) : el._fxP * .86;
      el.style.setProperty('--fx-press', el._fxP.toFixed(3));
    }
  });

  // Un prix qui change avec un défilement de chiffres
  FX.register('price-flip', {
    setup: function (el) {
      var vals = (el.dataset.fxValues || '19|190').split('|'), i = 0;
      el.setAttribute('aria-live', 'polite');
      var show = function (txt, dir) {
        var o = el.firstElementChild;
        if (o) { o.className = 'fx-pf-out' + (dir > 0 ? ' up' : ''); setTimeout(function () { o.remove(); }, 300); }
        var n = document.createElement('span');
        n.className = 'fx-pf-in' + (dir > 0 ? ' up' : '');
        n.textContent = txt;
        el.appendChild(n);
      };
      show(vals[0], 1);
      el._fxNext = function () { i = (i + 1) % vals.length; show(vals[i], i ? 1 : -1); el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { value: vals[i] } })); };
      var tog = el.dataset.fxToggle && document.querySelector(el.dataset.fxToggle);
      if (tog) tog.addEventListener('click', el._fxNext);
    },
    trigger: function (el) { el._fxNext(); }
  });

  // Une case qui coche d'un trait de stylo et biffe le texte
  FX.register('checkbox-scribble', {
    setup: function (el) {
      var input = el.querySelector('input');
      if (!input) return;
      var i = document.createElement('i');
      i.className = 'fx-cs-box';
      i.setAttribute('aria-hidden', 'true');
      i.innerHTML = '<svg viewBox="0 0 24 24"><path pathLength="1" d="M4 13 C7 15, 9 18, 10 20 C13 13, 16 8, 21 4"/></svg>';
      input.after(i);
      var txt = el.querySelector('span');
      if (txt) {
        var w = document.createElement('span');
        w.className = 'fx-cs-line';
        w.setAttribute('aria-hidden', 'true');
        w.innerHTML = '<svg viewBox="0 0 100 10" preserveAspectRatio="none"><path pathLength="1" d="M0 5 C20 2, 40 9, 60 5 S 90 2, 100 6"/></svg>';
        txt.style.position = 'relative';
        txt.appendChild(w);
      }
    }
  });

  // Une icône de recherche qui s'ouvre en champ de saisie
  FX.register('search-expand', {
    setup: function (el) {
      var input = el.querySelector('input'), btn = el.querySelector('button');
      if (!input || !btn) return;
      btn.setAttribute('aria-expanded', 'false');
      var set = function (on) { el.classList.toggle('fx-open', on); btn.setAttribute('aria-expanded', on); };
      btn.addEventListener('click', function () {
        var on = !el.classList.contains('fx-open');
        set(on);
        if (on) input.focus();
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { set(false); btn.focus(); } });
      input.addEventListener('blur', function () { if (!input.value) set(false); });
    }
  });

  // L'étiquette supprimée s'envole et les autres comblent la place
  FX.register('tag-delete', {
    setup: function (el) {
      el.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b || !el.contains(b)) return;
        var tag = b.parentElement;
        tag.style.width = tag.offsetWidth + 'px';
        void tag.offsetWidth;
        tag.classList.add('fx-out');
        var next = tag.nextElementSibling || tag.previousElementSibling;
        setTimeout(function () {
          tag.remove();
          if (next && next.querySelector('button')) next.querySelector('button').focus({ preventScroll: true });
          el.dispatchEvent(new CustomEvent('fx:remove', { bubbles: true }));
        }, 340);
      });
    }
  });

  // Une petite bulle confirme l'action à l'endroit du clic
  FX.register('copy-pop-toast', {
    triggerOn: 'click',
    trigger: function (el, e) {
      var b = document.createElement('span');
      b.className = 'fx-cpt';
      b.setAttribute('role', 'status');
      b.textContent = el.dataset.fxMessage || 'Copié !';
      var r = el.getBoundingClientRect();
      b.style.left = (e && e.clientX ? e.clientX : r.left + r.width / 2) + 'px';
      b.style.top = (e && e.clientY ? e.clientY : r.top) + 'px';
      document.body.appendChild(b);
      setTimeout(function () { b.remove(); }, 900);
      if (el.dataset.fxCopy && navigator.clipboard) navigator.clipboard.writeText(el.dataset.fxCopy).catch(function () {});
    }
  });

  // Un bouton rotatif qu'on tourne à la souris ou au clavier
  FX.register('knob-dial', {
    setup: function (el) {
      var min = U.num(el, 'fxMin', 0), max = U.num(el, 'fxMax', 100), v = U.num(el, 'fxValue', 40);
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max);
      el.tabIndex = 0;
      el.innerHTML = '<i></i><b></b>';
      var set = function (nv) {
        v = U.clamp(nv, min, max);
        var p = (v - min) / (max - min);
        el.style.setProperty('--fx-ang', (-135 + p * 270) + 'deg');
        el.style.setProperty('--fx-pct', p * 75);
        el.lastChild.textContent = Math.round(v);
        el.setAttribute('aria-valuenow', Math.round(v));
        el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { value: v } }));
      };
      set(v);
      var y0 = 0, v0 = 0, drag = false;
      el.addEventListener('pointerdown', function (e) { drag = true; y0 = e.clientY; v0 = v; if (e.isTrusted) el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', function (e) { if (drag) set(v0 + (y0 - e.clientY) * (max - min) / 150); });
      el.addEventListener('pointerup', function () { drag = false; });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(v + 1); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(v - 1); }
      });
    }
  });
})(window.FX);

/* Pack 15 — Passages et images */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Des tuiles couvrent l'écran en une vague diagonale
  FX.register('diagonal-tiles', { transition: { pieces: 70, cover: 900, uncover: 950, build: function (o) {
    Array.prototype.forEach.call(o.children, function (p, i) {
      var c = i % 10, r = Math.floor(i / 10);
      p.style.left = c * 10 + '%'; p.style.top = r * 100 / 7 + '%';
      p.style.setProperty('--fx-d', (c + r) * 28 + 'ms');
    });
  } } });

  // Des tuiles se posent en spirale vers le centre
  FX.register('spiral-tiles', { transition: { pieces: 48, cover: 1050, uncover: 1050, build: function (o) {
    var C = 8, R = 6, t = 0, l = 0, b = R - 1, r = C - 1, n = 0, kids = o.children;
    var place = function (x, y) {
      var p = kids[y * C + x];
      p.style.left = x * 100 / C + '%'; p.style.top = y * 100 / R + '%';
      p.style.setProperty('--fx-d', n++ * 12 + 'ms');
    };
    while (t <= b && l <= r) {
      for (var x = l; x <= r; x++) place(x, t); t++;
      for (var y = t; y <= b; y++) place(r, y); r--;
      if (t <= b) { for (x = r; x >= l; x--) place(x, b); b--; }
      if (l <= r) { for (y = b; y >= t; y--) place(l, y); l++; }
    }
  } } });

  // Une aiguille balaye l'écran comme un cadran
  FX.register('clock-wipe', { transition: { pieces: 1, cover: 800, uncover: 850, build: function (o) {
    var p = o.firstChild, start = null, outStart = null;
    (function run(t) {
      if (!o.isConnected) return;
      if (start === null) start = t;
      if (o.classList.contains('fx-uncover') && outStart === null) outStart = t;
      p.style.setProperty('--fx-ang', (o._fxArrive ? 360 : U.easeInOut(Math.min(1, (t - start) / 760)) * 360).toFixed(1) + 'deg');
      p.style.setProperty('--fx-from', (outStart === null ? 0 : U.easeInOut(Math.min(1, (t - outStart) / 800)) * 360).toFixed(1) + 'deg');
      U.raf(run);
    })(0);
  } } });

  // Des gouttes d'encre grandissent jusqu'à couvrir l'écran
  FX.register('ink-drops', { transition: { pieces: 12, cover: 950, uncover: 900, build: function (o) {
    Array.prototype.forEach.call(o.children, function (p, i) {
      p.style.left = (i % 4 + U.rand(.1, .9)) * 25 + '%';
      p.style.top = (Math.floor(i / 4) + U.rand(.1, .9)) * 33 + '%';
      p.style.setProperty('--fx-d', U.rand(0, 280).toFixed(0) + 'ms');
    });
  } } });

  // Des colonnes montent en escalier
  FX.register('stair-bars', { transition: { pieces: 9, cover: 880, uncover: 920, build: function (o) {
    var flip = Math.random() < .5, n = o.children.length;
    Array.prototype.forEach.call(o.children, function (p, i) {
      p.style.left = i * 100 / n + '%';
      p.style.setProperty('--fx-d', (flip ? n - 1 - i : i) * 45 + 'ms');
    });
  } } });

  // Une vague liquide monte et recouvre l'écran
  FX.register('wave-cover', { transition: { pieces: 1, cover: 900, uncover: 950, build: function (o) {
    var p = o.firstChild;
    p.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block"><path/></svg>';
    var path = p.querySelector('path'), t0 = null, lastOut = null;
    (function frame(t) {
      if (!o.isConnected) return;
      if (t0 === null) t0 = t;
      var out = o.classList.contains('fx-uncover');
      if (out && lastOut === null) lastOut = t;
      var a = Math.min(1, (t - t0) / 850), c = out ? Math.min(1, (t - lastOut) / 850) : 0;
      var top = 110 - U.easeInOut(a) * 120, bot = 110 - U.easeInOut(c) * 120;
      var amp = Math.sin(a * 3.14) * 10, ampB = Math.sin(c * 3.14) * 10;
      var d = 'M0 ' + top.toFixed(1) + ' Q25 ' + (top - amp).toFixed(1) + ' 50 ' + top.toFixed(1) + ' T100 ' + top.toFixed(1);
      d += out ? ' L100 ' + bot.toFixed(1) + ' Q75 ' + (bot + ampB).toFixed(1) + ' 50 ' + bot.toFixed(1) + ' T0 ' + bot.toFixed(1) + ' Z' : ' L100 100 L0 100 Z';
      path.setAttribute('d', d);
      U.raf(frame);
    })(0);
  } } });

  // Des lames horizontales et verticales se croisent
  FX.register('cross-blinds', { transition: { pieces: 16, cover: 800, uncover: 850, build: function (o) {
    Array.prototype.forEach.call(o.children, function (p, i) {
      var v = i % 2 === 0, k = Math.floor(i / 2);
      p.className = v ? 'fx-v' : 'fx-h';
      p.style[v ? 'left' : 'top'] = k * 12.5 + '%';
      p.style.setProperty('--fx-d', k * 28 + 'ms');
    });
  } } });

  // Deux panneaux se referment en 3D comme des portes
  FX.register('fold-doors', { transition: { pieces: 2, cover: 820, uncover: 860, build: function (o) {
    o.style.perspective = '1400px';
    o.children[0].className = 'fx-l';
    o.children[1].className = 'fx-r';
  } } });

  // Des éclats triangulaires convergent depuis le point de clic
  FX.register('shatter-tris', { transition: { pieces: 96, cover: 960, uncover: 900, build: function (o) {
    var C = 8, R = 6, e = o._fxEvent;
    var cx = e && e.clientX != null ? e.clientX / innerWidth : .5, cy = e && e.clientY != null ? e.clientY / innerHeight : .5;
    Array.prototype.forEach.call(o.children, function (p, i) {
      var q = i % 2, k = Math.floor(i / 2), c = k % C, r = Math.floor(k / C);
      p.style.left = c * 100 / C + '%'; p.style.top = r * 100 / R + '%';
      p.style.clipPath = q ? 'polygon(103% -3%,103% 103%,-3% 103%)' : 'polygon(-3% -3%,103% -3%,-3% 103%)';
      var d = Math.hypot((c + .5) / C - cx, (r + .5) / R - cy);
      p.style.setProperty('--fx-d', (d * 500).toFixed(0) + 'ms');
      p.style.setProperty('--fx-rot', U.rand(-120, 120).toFixed(0) + 'deg');
    });
  } } });

  // Des mots s'enchaînent en plein écran pendant le passage
  FX.register('word-flash', { transition: { pieces: 1, cover: 900, uncover: 700, build: function (o) {
    var src = o._fxEvent && o._fxEvent.currentTarget;
    var words = ((src && src.dataset && src.dataset.fxWords) || 'Un|Instant|Encore').split('|'), i = 0;
    var p = o.firstChild;
    var next = function () {
      if (!o.isConnected || i >= words.length) return;
      p.textContent = words[i++];
      setTimeout(next, 280);
    };
    setTimeout(next, 80);
  } } });

  // Des rangées de texte glissent en sens alternés
  FX.register('text-cover', { transition: { pieces: 6, cover: 850, uncover: 880, build: function (o) {
    var word = (document.documentElement.dataset.fxWord || document.title.split(/[\s—–-]/)[0] || 'Idéothèque') + ' ';
    Array.prototype.forEach.call(o.children, function (p, i) {
      p.textContent = word.repeat(14);
      p.style.top = i * 100 / 6 + '%';
      p.style.setProperty('--fx-dir', i % 2 ? 1 : -1);
      p.style.setProperty('--fx-d', i * 40 + 'ms');
    });
  } } });

  // Une trame de points grossit depuis le point de clic
  FX.register('dots-cover', { transition: { pieces: 140, cover: 900, uncover: 900, build: function (o) {
    var C = 14, R = 10, e = o._fxEvent;
    var cx = e && e.clientX != null ? e.clientX / innerWidth : .5, cy = e && e.clientY != null ? e.clientY / innerHeight : .5;
    Array.prototype.forEach.call(o.children, function (p, i) {
      var c = i % C, r = Math.floor(i / C);
      p.style.left = (c + .5) * 100 / C + '%'; p.style.top = (r + .5) * 100 / R + '%';
      p.style.setProperty('--fx-d', (Math.hypot((c + .5) / C - cx, (r + .5) / R - cy) * 460).toFixed(0) + 'ms');
    });
  } } });

  // Un rayon traverse l'écran et laisse un aplat derrière lui
  FX.register('scan-cover', { transition: { pieces: 2, cover: 760, uncover: 780, build: function (o) {
    o.children[0].className = 'fx-sc-fill';
    o.children[1].className = 'fx-sc-beam';
  } } });

  // Plusieurs aplats de couleur se suivent de près
  FX.register('color-stack', { transition: { pieces: 4, cover: 880, uncover: 920, build: function (o) {
    var list = U.cssVar(document.documentElement, '--fx-tr-colors', '#e10600,#ffd400,#0047ff,#0c0c0e').split(',');
    Array.prototype.forEach.call(o.children, function (p, i) {
      p.style.background = list[i % list.length];
      p.style.setProperty('--fx-d', i * 90 + 'ms');
    });
  } } });

  // Un grand X se dessine et s'épaissit jusqu'à couvrir l'écran
  FX.register('x-cross', { transition: { pieces: 2, cover: 800, uncover: 820, build: function (o) {
    o.style.setProperty('--fx-len', Math.hypot(innerWidth, innerHeight) * 1.1 + 'px');
    o.children[0].className = 'fx-a';
    o.children[1].className = 'fx-b';
  } } });

  // Une page se tourne comme dans un livre
  FX.register('page-turn', { transition: { pieces: 2, cover: 900, uncover: 900, build: function (o) {
    o.style.perspective = '2000px';
    var rtl = getComputedStyle(document.documentElement).direction === 'rtl';
    o.style.setProperty('--fx-side', rtl ? '100%' : '0%');
    o.children[0].className = 'fx-page';
    o.children[1].className = 'fx-fold';
  } } });

  // L'image se transforme en texte ASCII au survol
  FX.register('ascii-image', {
    setup: function (el) {
      var img = el.querySelector('img');
      if (!img) return;
      U.ensurePositioned(el);
      var pre = U.make('pre', 'fx-ascii', el);
      pre.setAttribute('aria-hidden', 'true');
      var draw = function () {
        var cols = U.num(el, 'fxCols', 46), w = el.offsetWidth || 200, h = el.offsetHeight || 150;
        var rows = Math.max(1, Math.round(cols * h / w * .5));
        var c = document.createElement('canvas');
        c.width = cols; c.height = rows;
        var x = c.getContext('2d');
        try {
          x.drawImage(img, 0, 0, cols, rows);
          var d = x.getImageData(0, 0, cols, rows).data, ramp = ' .:-=+*#%@', s = '';
          for (var j = 0; j < rows; j++) {
            for (var i = 0; i < cols; i++) {
              var k = (j * cols + i) * 4, l = (d[k] * .3 + d[k + 1] * .59 + d[k + 2] * .11) / 255;
              s += ramp.charAt(Math.floor(l * (ramp.length - .01)));
            }
            s += '\n';
          }
          pre.textContent = s;
          pre.style.fontSize = (w / cols / .6).toFixed(2) + 'px';
        } catch (err) { pre.textContent = ''; }
      };
      if (img.complete) draw(); else img.addEventListener('load', draw);
      U.onResize(draw);
    }
  });

  // L'image passe d'un tramage 1-bit à ses vraies couleurs
  FX.register('dither-reveal', {
    entrance: true,
    setup: function (el) {
      var img = el.querySelector('img');
      if (!img) return;
      U.ensurePositioned(el);
      var cv = el._fxCv = U.make('canvas', 'fx-dither', el);
      cv.setAttribute('aria-hidden', 'true');
      var B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      var draw = function () {
        var px = U.num(el, 'fxPixel', 3), w = Math.ceil((el.offsetWidth || 200) / px), h = Math.ceil((el.offsetHeight || 150) / px);
        cv.width = w; cv.height = h;
        var c = cv.getContext('2d');
        try {
          c.drawImage(img, 0, 0, w, h);
          var d = c.getImageData(0, 0, w, h), a = d.data;
          for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var i = (y * w + x) * 4, l = (a[i] * .3 + a[i + 1] * .59 + a[i + 2] * .11) / 255;
            var v = l > (B[(y % 4) * 4 + x % 4] + .5) / 16 ? 255 : 0;
            a[i] = a[i + 1] = a[i + 2] = v;
          }
          c.putImageData(d, 0, 0);
        } catch (err) { cv.remove(); }
      };
      if (img.complete) draw(); else img.addEventListener('load', draw);
    }
  });

  // Une image en deux couleurs qui retrouve ses teintes au survol
  FX.register('duotone-hover', {
    setup: function (el) {
      var hex = function (s) { var v = parseInt(s.replace('#', ''), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
      var a = hex(el.dataset.fxDark || '#0047ff'), b = hex(el.dataset.fxLight || '#ffd400');
      var id = 'fx-duo-' + Math.random().toString(36).slice(2, 8);
      var host = document.createElement('div');
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      host.innerHTML = '<svg aria-hidden="true"><filter id="' + id + '" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=".33 .33 .33 0 0 .33 .33 .33 0 0 .33 .33 .33 0 0 0 0 0 1 0"/><feComponentTransfer>' +
        ['R', 'G', 'B'].map(function (c, i) { return '<feFunc' + c + ' type="table" tableValues="' + a[i].toFixed(3) + ' ' + b[i].toFixed(3) + '"/>'; }).join('') +
        '</feComponentTransfer></filter></svg>';
      document.body.appendChild(host);
      el.style.setProperty('--fx-duo', 'url(#' + id + ')');
    }
  });

  // L'image se recompose à partir de cellules éparses
  FX.register('mosaic-hover', {
    setup: function (el) {
      var img = el.querySelector('img');
      if (!img) return;
      var C = U.num(el, 'fxCols', 6), R = U.num(el, 'fxRows', 4);
      el.style.setProperty('--fx-c', C);
      el.style.setProperty('--fx-rw', R);
      var src = img.getAttribute('src');
      img.classList.add('fx-sr-img');
      for (var j = 0; j < R; j++) for (var i = 0; i < C; i++) {
        var s = U.make('i', '', el);
        s.setAttribute('aria-hidden', 'true');
        s.style.backgroundImage = 'url("' + src + '")';
        s.style.backgroundPosition = (C > 1 ? i * 100 / (C - 1) : 0) + '% ' + (R > 1 ? j * 100 / (R - 1) : 0) + '%';
        s.style.setProperty('--fx-dx', U.rand(-22, 22).toFixed(0) + 'px');
        s.style.setProperty('--fx-dy', U.rand(-22, 22).toFixed(0) + 'px');
        s.style.setProperty('--fx-dr', U.rand(-16, 16).toFixed(0) + 'deg');
      }
    }
  });

  // L'image ondule comme une surface d'eau au survol
  FX.register('wave-image', {
    setup: function (el) {
      var id = 'fx-wv-' + Math.random().toString(36).slice(2, 8);
      var h = document.createElement('div');
      h.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      h.innerHTML = '<svg aria-hidden="true"><filter id="' + id + '"><feTurbulence type="turbulence" baseFrequency=".012 .05" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
      document.body.appendChild(h);
      el._fxT = h.querySelector('feTurbulence'); el._fxM = h.querySelector('feDisplacementMap');
      el._fxA = 0;
      (el.querySelector('img') || el).style.filter = 'url(#' + id + ')';
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var tg = (el.matches(':hover') || el.dataset.fxAuto === 'true') ? U.num(el, 'fxScale', 24) : 0;
      el._fxA = U.lerp(el._fxA, tg, .07);
      if (el._fxA < .1 && !tg) { if (el._fxOn) { el._fxM.setAttribute('scale', 0); el._fxOn = false; } return; }
      el._fxOn = true;
      el._fxM.setAttribute('scale', el._fxA.toFixed(1));
      el._fxT.setAttribute('baseFrequency', (.012 + Math.sin(t * .0007) * .004).toFixed(4) + ' ' + (.05 + Math.cos(t * .0009) * .012).toFixed(4));
    }
  });

  // L'image apparaît par lignes de plus en plus épaisses
  FX.register('scan-reveal', {
    entrance: true,
    setup: function (el) { el.style.setProperty('--fx-line', '0px'); },
    reset: function (el) { el.style.setProperty('--fx-line', '0px'); },
    enter: function (el) {
      var gap = U.num(el, 'fxGap', 10);
      U.tween(el, U.num(el, 'fxDuration', 1100), function (p) { el.style.setProperty('--fx-line', (U.easeInOut(p) * (gap + 1)).toFixed(2) + 'px'); }, function () { el.style.setProperty('--fx-line', (gap + 2) + 'px'); });
      el.style.setProperty('--fx-gap', gap + 'px');
    }
  });

  // Un diaporama qui change d'image par bandes verticales
  FX.register('strip-slider', {
    setup: function (el) {
      var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
      if (imgs.length < 2) return;
      var n = U.num(el, 'fxStrips', 8), i = 0, t = 0;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-roledescription', 'diaporama');
      imgs.forEach(function (im, k) { if (k) im.setAttribute('aria-hidden', 'true'); });
      var wrap = U.make('div', 'fx-strips', el);
      wrap.setAttribute('aria-hidden', 'true');
      var strips = [];
      for (var k = 0; k < n; k++) {
        var s = U.make('i', '', wrap);
        s.style.setProperty('--fx-k', k);
        s.style.backgroundPosition = (n > 1 ? k * 100 / (n - 1) : 0) + '% 50%';
        s.style.backgroundSize = n * 100 + '% 100%';
        strips.push(s);
      }
      var show = function () {
        i = (i + 1) % imgs.length;
        strips.forEach(function (s) { s.style.backgroundImage = 'url("' + imgs[i].getAttribute('src') + '")'; });
        el.classList.remove('fx-go'); void el.offsetWidth; el.classList.add('fx-go');
        setTimeout(function () { imgs.forEach(function (im, k) { im.classList.toggle('fx-cur', k === i); }); }, 900);
      };
      imgs[0].classList.add('fx-cur');
      el._fxNext = show;
      el._fxTick = function (dt) { if (el.matches(':hover')) return; t += dt * 1000; if (t > U.num(el, 'fxHold', 3200)) { t = 0; show(); } };
    },
    tick: function (el, dt) { if (el._fxTick && !U.reduced) el._fxTick(dt); },
    trigger: function (el) { if (el._fxNext) el._fxNext(); }
  });

  // Une bande reste nette et suit le curseur, le reste est flou
  FX.register('tilt-focus', {
    setup: function (el) {
      var img = el.querySelector('img');
      if (!img) return;
      var c = img.cloneNode();
      c.alt = '';
      c.setAttribute('aria-hidden', 'true');
      c.className = 'fx-tf-blur';
      el.appendChild(c);
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-fy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }
  });

  // Des photos tombent sur la table et se posent en désordre
  FX.register('polaroid-drop', {
    entrance: true,
    setup: function (el) {
      var top = el.children.length;
      Array.prototype.forEach.call(el.children, function (c, i) {
        c.style.setProperty('--fx-rot', U.rand(-14, 14).toFixed(1) + 'deg');
        c.style.setProperty('--fx-dx', U.rand(-28, 28).toFixed(0) + 'px');
        c.style.setProperty('--fx-dy', U.rand(-16, 16).toFixed(0) + 'px');
        c.style.setProperty('--fx-i', i);
        c.addEventListener('click', function () { c.style.zIndex = ++top; });
      });
    }
  });

  // Le curseur révèle une seconde image, comme une radio
  FX.register('x-ray', {
    setup: function (el) {
      var s = el._fxS = { x: 0, y: 0, tx: 0, ty: 0, r: 0, on: false };
      el.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        s.tx = e.clientX - b.left; s.ty = e.clientY - b.top; s.on = true;
      });
      el.addEventListener('pointerleave', function () { s.on = false; });
    },
    tick: function (el, dt, t) {
      var s = el._fxS;
      if (el.dataset.fxAuto === 'true' && !s.on) {
        s.tx = el.offsetWidth * (.5 + Math.sin(t * .0009) * .35);
        s.ty = el.offsetHeight * (.5 + Math.cos(t * .0013) * .3);
      }
      s.x = U.lerp(s.x, s.tx, .14); s.y = U.lerp(s.y, s.ty, .14);
      s.r = U.lerp(s.r, s.on || el.dataset.fxAuto === 'true' ? U.num(el, 'fxRadius', 70) : 0, .12);
      el.style.setProperty('--fx-x', s.x.toFixed(1) + 'px');
      el.style.setProperty('--fx-y', s.y.toFixed(1) + 'px');
      el.style.setProperty('--fx-r', s.r.toFixed(1) + 'px');
    }
  });
})(window.FX);

/* Pack 16 — Fonds génératifs */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Des lignes suivent un courant invisible et dessinent des veines
  FX.register('flow-field', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = U.make('canvas', 'fx-gen', el);
      cv.setAttribute('aria-hidden', 'true');
      el._fxG = { cv: cv, p: [], w: 0, h: 0 };
    },
    tick: function (el, dt, t) {
      var g = el._fxG, cv = g.cv, w = cv.clientWidth, h = cv.clientHeight, c = cv.getContext('2d');
      if (!w) return;
      if (w !== g.w || h !== g.h) {
        g.w = cv.width = w; g.h = cv.height = h; g.p = [];
        for (var i = 0; i < U.num(el, 'fxCount', 140); i++) g.p.push({ x: Math.random() * w, y: Math.random() * h, l: U.rand(40, 160) });
        c.fillStyle = getComputedStyle(el).backgroundColor;
      }
      if (U.reduced && g.done) return;
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,.035)';
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = getComputedStyle(cv).color;
      c.lineWidth = 1;
      c.beginPath();
      var scale = U.num(el, 'fxScale', .006), steps = U.reduced ? 80 : 1;
      for (var s = 0; s < steps; s++) g.p.forEach(function (p) {
        var a = (Math.sin(p.x * scale + t * .0001) + Math.cos(p.y * scale * 1.3)) * 2.4;
        c.moveTo(p.x, p.y);
        p.x += Math.cos(a) * 1.3; p.y += Math.sin(a) * 1.3;
        c.lineTo(p.x, p.y);
        if (--p.l < 0 || p.x < 0 || p.y < 0 || p.x > w || p.y > h) { p.x = Math.random() * w; p.y = Math.random() * h; p.l = U.rand(40, 160); }
      });
      c.stroke();
      g.done = true;
    }
  });

  // Des bulles se rencontrent et fusionnent comme dans une lampe à lave
  FX.register('metaballs', {
    setup: function (el) {
      U.ensurePositioned(el);
      if (!document.getElementById('fx-meta')) {
        var d = document.createElement('div');
        d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        d.innerHTML = '<svg aria-hidden="true"><filter id="fx-meta"><feGaussianBlur stdDeviation="12"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 30 -12"/></filter></svg>';
        document.body.appendChild(d);
      }
      var box = U.make('div', 'fx-meta-box', el);
      box.setAttribute('aria-hidden', 'true');
      el._fxB = [];
      for (var i = 0; i < U.num(el, 'fxCount', 7); i++) {
        var b = U.make('i', '', box), s = U.rand(36, 90);
        b.style.width = b.style.height = s + 'px';
        el._fxB.push({ el: b, s: s, x: Math.random(), y: Math.random(), vx: U.rand(-.1, .1), vy: U.rand(-.12, .12) });
      }
    },
    tick: function (el, dt) {
      var w = el.offsetWidth, h = el.offsetHeight;
      el._fxB.forEach(function (b) {
        if (!U.reduced) {
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x < 0 || b.x > 1) b.vx *= -1;
          if (b.y < 0 || b.y > 1) b.vy *= -1;
        }
        b.el.style.transform = 'translate(' + (b.x * w - b.s / 2).toFixed(1) + 'px,' + (b.y * h - b.s / 2).toFixed(1) + 'px)';
      });
    }
  });

  // Des cellules vivantes se déforment doucement
  FX.register('voronoi-cells', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = U.make('canvas', 'fx-vor', el);
      cv.setAttribute('aria-hidden', 'true');
      cv.width = 64; cv.height = 48;
      var pts = [];
      for (var i = 0; i < U.num(el, 'fxCount', 14); i++) pts.push({ x: Math.random(), y: Math.random(), a: U.rand(0, 6), s: U.rand(.1, .3) });
      el._fxV = { cv: cv, pts: pts, t: 0 };
    },
    tick: function (el, dt, t) {
      var g = el._fxV;
      g.t += dt;
      if (g.t < .05 && g.drawn) return;
      if (U.reduced && g.drawn) return;
      g.t = 0; g.drawn = true;
      var c = g.cv.getContext('2d'), W = 64, H = 48, img = c.createImageData(W, H), d = img.data;
      var a = U.cssVar(el, '--fx-cell', '#ff5b2e'), hex = parseInt(a.replace('#', ''), 16), R = hex >> 16 & 255, G = hex >> 8 & 255, B = hex & 255;
      var px = g.pts.map(function (p) { return [(p.x + Math.sin(t * .0003 * p.s * 4 + p.a) * .1) * W, (p.y + Math.cos(t * .0003 * p.s * 4 + p.a) * .1) * H]; });
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var m1 = 1e9, m2 = 1e9;
        for (var k = 0; k < px.length; k++) {
          var dx = x - px[k][0], dy = y - px[k][1], q = dx * dx + dy * dy;
          if (q < m1) { m2 = m1; m1 = q; } else if (q < m2) m2 = q;
        }
        var e = Math.sqrt(m2) - Math.sqrt(m1), i = (y * W + x) * 4, v = Math.min(1, e / 4);
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = (1 - v) * 255;
      }
      c.putImageData(img, 0, 0);
    }
  });

  // Des courbes de niveau glissent comme sur une carte
  FX.register('contour-lines', {
    setup: function (el) { U.ensurePositioned(el); el._fxCv = U.make('canvas', 'fx-gen', el); el._fxCv.setAttribute('aria-hidden', 'true'); el._fxT = 0; },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      el._fxT += dt;
      if (el._fxT < .08 && cv.width === w) return;
      if (U.reduced && cv.width === w) return;
      el._fxT = 0;
      cv.width = w; cv.height = h;
      var c = cv.getContext('2d'), S = 14, ph = t * .00012;
      var f = function (x, y) { return Math.sin(x * .011 + ph) + Math.cos(y * .014 - ph) + Math.sin((x + y) * .007 + ph * 2); };
      c.strokeStyle = getComputedStyle(cv).color;
      c.globalAlpha = .65;
      c.beginPath();
      for (var lv = -2.4; lv < 2.6; lv += .4) {
        for (var y = 0; y < h; y += S) for (var x = 0; x < w; x += S) {
          var a = f(x, y) - lv, b = f(x + S, y) - lv, d = f(x, y + S) - lv, e = f(x + S, y + S) - lv, P = [];
          if (a * b < 0) P.push([x + S * a / (a - b), y]);
          if (b * e < 0) P.push([x + S, y + S * b / (b - e)]);
          if (d * e < 0) P.push([x + S * d / (d - e), y + S]);
          if (a * d < 0) P.push([x, y + S * a / (a - d)]);
          if (P.length >= 2) { c.moveTo(P[0][0], P[0][1]); c.lineTo(P[1][0], P[1][1]); }
        }
      }
      c.stroke();
    }
  });

  // Un petit automate cellulaire vit en fond
  FX.register('game-of-life', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = el._fxCv = U.make('canvas', 'fx-gen', el);
      cv.setAttribute('aria-hidden', 'true');
      el._fxG = null; el._fxT = 0;
    },
    tick: function (el, dt) {
      var cv = el._fxCv, S = U.num(el, 'fxCell', 8), w = Math.ceil(cv.clientWidth / S), h = Math.ceil(cv.clientHeight / S);
      if (!w) return;
      if (!el._fxG || el._fxW !== w) {
        el._fxW = w; el._fxH = h; cv.width = w * S; cv.height = h * S;
        el._fxG = new Uint8Array(w * h);
        for (var i = 0; i < w * h; i++) el._fxG[i] = Math.random() < .28 ? 1 : 0;
      }
      el._fxT += dt;
      var first = !el._fxDrawn;
      if (!first && (U.reduced || el._fxT < U.num(el, 'fxStep', 180) / 1000)) return;
      el._fxT = 0; el._fxDrawn = true;
      var g = el._fxG, n = new Uint8Array(w * h), H = el._fxH, alive = 0;
      for (var y = 0; y < H; y++) for (var x = 0; x < w; x++) {
        var k = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (dx || dy) k += g[((y + dy + H) % H) * w + (x + dx + w) % w];
        var v = g[y * w + x] ? (k === 2 || k === 3) : k === 3;
        n[y * w + x] = v ? 1 : 0;
        alive += v ? 1 : 0;
      }
      if (alive < w * h * .04) for (var r = 0; r < w * h * .1; r++) n[Math.floor(Math.random() * w * h)] = 1;
      el._fxG = n;
      var c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height);
      c.fillStyle = getComputedStyle(cv).color;
      for (y = 0; y < H; y++) for (x = 0; x < w; x++) if (n[y * w + x]) c.fillRect(x * S + 1, y * S + 1, S - 2, S - 2);
    }
  });

  // Un ruban de lignes ondule comme un tissu dans le vent
  FX.register('ribbon-sine', {
    setup: function (el) { U.ensurePositioned(el); el._fxCv = U.make('canvas', 'fx-gen', el); el._fxCv.setAttribute('aria-hidden', 'true'); },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), n = U.num(el, 'fxLines', 34), T = t * .0005;
      c.clearRect(0, 0, w, h);
      c.strokeStyle = getComputedStyle(cv).color;
      for (var i = 0; i < n; i++) {
        var q = i / n;
        c.globalAlpha = .15 + Math.sin(q * 3.14) * .55;
        c.beginPath();
        for (var x = 0; x <= w; x += 8) {
          var y = h / 2 + Math.sin(x * .012 + T + q * 1.7) * h * .24 * (1 + Math.sin(T * .7 + q * 3)) * .6 + (q - .5) * h * .3 * Math.cos(x * .007 + T);
          if (x) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.stroke();
      }
    }
  });

  // Des particules forment un mot et s'écartent du curseur
  FX.register('particle-text', {
    setup: function (el) {
      var txt = el.textContent.trim(), cs = getComputedStyle(el), fs = parseFloat(cs.fontSize) || 48;
      el.setAttribute('aria-label', txt); el.setAttribute('role', 'img');
      el.textContent = '';
      var cv = U.make('canvas', '', el), font = (cs.fontWeight || 700) + ' ' + fs + 'px ' + cs.fontFamily;
      var g = el._fxG = { cv: cv, p: [], mx: -999, my: -999, col: cs.color };
      var scan = function () {
        var m = document.createElement('canvas').getContext('2d');
        m.font = font;
        var w = Math.ceil(m.measureText(txt).width) + 8, h = Math.ceil(fs * 1.3);
        m.canvas.width = w; m.canvas.height = h;
        m.font = font; m.textBaseline = 'middle'; m.fillText(txt, 4, h / 2);
        var d = m.getImageData(0, 0, w, h).data, step = U.num(el, 'fxStep', 3);
        g.p = [];
        for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) if (d[(y * w + x) * 4 + 3] > 128)
          g.p.push({ tx: x, ty: y, x: U.reduced ? x : Math.random() * w, y: U.reduced ? y : Math.random() * h, vx: 0, vy: 0 });
        cv.width = w; cv.height = h;
      };
      scan();
      if (document.fonts) document.fonts.load(font).then(scan);
      el.addEventListener('pointermove', function (e) { var r = cv.getBoundingClientRect(); g.mx = e.clientX - r.left; g.my = e.clientY - r.top; });
      el.addEventListener('pointerleave', function () { g.mx = g.my = -999; });
    },
    tick: function (el) {
      var g = el._fxG, c = g.cv.getContext('2d');
      c.clearRect(0, 0, g.cv.width, g.cv.height);
      c.fillStyle = g.col;
      g.p.forEach(function (p) {
        var dx = p.x - g.mx, dy = p.y - g.my, d = dx * dx + dy * dy;
        if (d < 1600 && !U.reduced) { var f = (1600 - d) / 1600 * 2.4; d = Math.sqrt(d) || 1; p.vx += dx / d * f; p.vy += dy / d * f; }
        p.vx += (p.tx - p.x) * .05; p.vy += (p.ty - p.y) * .05;
        p.vx *= .82; p.vy *= .82;
        p.x += p.vx; p.y += p.vy;
        c.fillRect(p.x, p.y, 2, 2);
      });
    }
  });

  // Des gouttes glissent sur une vitre
  FX.register('rain-glass', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxD = [];
      for (var i = 0; i < U.num(el, 'fxDrops', 28); i++) el._fxD.push({ x: Math.random(), y: Math.random(), r: U.rand(1.2, 3.4), v: 0, w: U.rand(0, 2) });
    },
    tick: function (el, dt) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d');
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,.05)';
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = getComputedStyle(cv).color;
      el._fxD.forEach(function (d) {
        d.w -= dt;
        if (d.w <= 0) { d.v = U.rand(.06, .4); d.w = U.rand(.2, 1.8); }
        d.y += d.v * dt;
        d.v *= .985;
        if (d.y > 1.05) { d.y = -.05; d.x = Math.random(); }
        c.beginPath();
        c.ellipse(d.x * w, d.y * h, d.r, d.r * 1.3, 0, 0, 7);
        c.fill();
      });
    }
  });

  // Des flocons tombent à plusieurs profondeurs
  FX.register('snow-fall', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxF = [];
      for (var i = 0; i < U.num(el, 'fxCount', 70); i++) { var z = Math.random(); el._fxF.push({ x: Math.random(), y: Math.random(), z: z, a: U.rand(0, 6) }); }
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d');
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      el._fxF.forEach(function (f) {
        f.y += (.03 + f.z * .09) * dt;
        f.x += Math.sin(t * .0006 + f.a) * .0006;
        if (f.y > 1.02) { f.y = -.02; f.x = Math.random(); }
        c.globalAlpha = .3 + f.z * .7;
        c.beginPath();
        c.arc(((f.x % 1) + 1) % 1 * w, f.y * h, .6 + f.z * 2.2, 0, 7);
        c.fill();
      });
    }
  });

  // Des lucioles errent et s'allument tour à tour
  FX.register('fireflies', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxF = [];
      for (var i = 0; i < U.num(el, 'fxCount', 26); i++) el._fxF.push({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, a: U.rand(0, 6), s: U.rand(.5, 1.4) });
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d'), col = getComputedStyle(cv).color;
      c.clearRect(0, 0, w, h);
      el._fxF.forEach(function (f) {
        f.vx = (f.vx + U.rand(-.04, .04) * dt) * .985; f.vy = (f.vy + U.rand(-.04, .04) * dt) * .985;
        f.x += f.vx; f.y += f.vy;
        if (f.x < 0 || f.x > 1) f.vx *= -1;
        if (f.y < 0 || f.y > 1) f.vy *= -1;
        var on = Math.pow(Math.max(0, Math.sin(t * .001 * f.s + f.a)), 3);
        c.globalAlpha = on;
        c.shadowBlur = 14;
        c.shadowColor = col;
        c.fillStyle = col;
        c.beginPath();
        c.arc(f.x * w, f.y * h, 2, 0, 7);
        c.fill();
      });
    }
  });

  // Un terrain de points ondule en perspective
  FX.register('matrix-dots-wave', {
    setup: function (el) { U.ensurePositioned(el); el._fxCv = U.make('canvas', 'fx-gen', el); el._fxCv.setAttribute('aria-hidden', 'true'); },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), N = U.num(el, 'fxRows', 22), T = t * .0012;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      for (var z = N; z > 0; z--) for (var x = -N; x <= N; x++) {
        var y = Math.sin(x * .45 + T) * Math.cos(z * .4 + T * .7) * 26;
        var k = 240 / (z * 16 + 70);
        var px = w / 2 + x * 24 * k, py = h * .35 + (y + 90) * k;
        if (px < 0 || px > w || py > h) continue;
        c.globalAlpha = 1 - z / N * .85;
        c.fillRect(px, py, Math.max(1, k * 2.4), Math.max(1, k * 2.4));
      }
    }
  });

  // Des rayons tournent lentement autour d'un point
  FX.register('sun-rays', {
    setup: function (el) { el._fxA = 0; },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxA = (el._fxA + dt * U.num(el, 'fxSpeed', 8)) % 360;
      el.style.setProperty('--fx-ray', el._fxA.toFixed(1) + 'deg');
    }
  });

  // Un plasma coloré, calculé pixel par pixel
  FX.register('plasma', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = el._fxCv = U.make('canvas', 'fx-plasma', el);
      cv.width = 80; cv.height = 60;
      cv.setAttribute('aria-hidden', 'true');
      var p = function (v, d) { var n = parseInt((U.cssVar(el, v, d)).replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
      el._fxA = p('--fx-a', '#0047ff'); el._fxB = p('--fx-b', '#e10600'); el._fxC = p('--fx-c', '#ffd400');
    },
    tick: function (el, dt, t) {
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = el._fxCv.getContext('2d'), W = 80, H = 60, im = c.createImageData(W, H), d = im.data, T = t * .0008;
      var A = el._fxA, B = el._fxB, C = el._fxC;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var v = (Math.sin(x * .13 + T) + Math.sin(y * .17 - T * .7) + Math.sin((x + y) * .09 + T * 1.3) + Math.sin(Math.sqrt(x * x + y * y) * .12)) / 4 * .5 + .5;
        var i = (y * W + x) * 4, f, P, Q;
        if (v < .5) { f = v * 2; P = A; Q = B; } else { f = (v - .5) * 2; P = B; Q = C; }
        d[i] = P[0] + (Q[0] - P[0]) * f; d[i + 1] = P[1] + (Q[1] - P[1]) * f; d[i + 2] = P[2] + (Q[2] - P[2]) * f; d[i + 3] = 255;
      }
      c.putImageData(im, 0, 0);
    }
  });

  // Un grand égaliseur rythme le bas de la section
  FX.register('equalizer-bg', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxB = [];
      for (var i = 0; i < U.num(el, 'fxBars', 28); i++) el._fxB.push({ v: 0, a: U.rand(1, 5), b: U.rand(0, 6) });
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), bw = w / el._fxB.length;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      el._fxB.forEach(function (b, i) {
        var tg = .15 + .85 * Math.abs(Math.sin(t * .001 * b.a + b.b) * Math.sin(t * .0023 + i * .4));
        b.v = U.lerp(b.v, tg, .16);
        var H = b.v * h * .8;
        c.fillRect(i * bw + 1, h - H, bw - 2, H);
      });
    }
  });

  // Des formes colorées se multiplient en kaléidoscope
  FX.register('kaleidoscope', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxS = (el.dataset.fxColors || '#e10600,#ffd400,#0047ff').split(',');
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), n = U.num(el, 'fxSides', 8), R = Math.max(w, h) * .62, T = t * .0003;
      c.clearRect(0, 0, w, h);
      c.save();
      c.translate(w / 2, h / 2);
      for (var i = 0; i < n * 2; i++) {
        c.save();
        c.rotate(i * Math.PI / n);
        if (i % 2) c.scale(1, -1);
        c.beginPath();
        c.moveTo(0, 0);
        c.arc(0, 0, R, 0, Math.PI / n);
        c.closePath();
        c.clip();
        el._fxS.forEach(function (col, k) {
          c.fillStyle = col;
          c.beginPath();
          var r = R * (.18 + k * .22) + Math.sin(T * 4 + k) * R * .1;
          var a = Math.PI / n * (.5 + .5 * Math.sin(T * 3 + k * 2));
          c.arc(Math.cos(a) * r, Math.sin(a) * r, R * (.1 + .05 * Math.sin(T * 5 + k)), 0, 7);
          c.fill();
        });
        c.restore();
      }
      c.restore();
    }
  });

  // Un éclair zèbre le fond de temps en temps
  FX.register('lightning', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxWait = 1; el._fxLife = 0;
    },
    trigger: function (el) { el._fxWait = 0; },
    tick: function (el, dt) {
      if (U.reduced) return;
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d');
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = 'rgba(0,0,0,.25)';
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
      el._fxWait -= dt;
      if (el._fxWait > 0) return;
      el._fxWait = U.rand(1.6, 5);
      var pts = [[U.rand(.2, .8) * w, 0], [U.rand(.2, .8) * w, h]];
      for (var d = h / 3, it = 0; it < 6; it++, d /= 2) {
        var n = [];
        pts.forEach(function (p, i) {
          n.push(p);
          if (i < pts.length - 1) n.push([(p[0] + pts[i + 1][0]) / 2 + U.rand(-d, d), (p[1] + pts[i + 1][1]) / 2]);
        });
        pts = n;
      }
      c.strokeStyle = getComputedStyle(cv).color;
      c.lineWidth = 1.5;
      c.shadowBlur = 12;
      c.shadowColor = c.strokeStyle;
      c.beginPath();
      pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
      c.stroke();
      c.shadowBlur = 0;
    }
  });

  // Du sable s'écoule et forme des dunes
  FX.register('sand-grain', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, S = 3, w = Math.floor(cv.clientWidth / S), H = Math.floor(cv.clientHeight / S);
      if (!w) return;
      if (el._fxW !== w) {
        el._fxW = w; cv.width = w * S; cv.height = H * S;
        el._fxH = new Uint16Array(w);
        for (var i = 0; i < w; i++) el._fxH[i] = Math.floor(H * .1 * (1 + Math.sin(i * .04)));
      }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d'), h = el._fxH;
      c.fillStyle = getComputedStyle(cv).color;
      for (var n = 0; n < U.num(el, 'fxRate', 8); n++) {
        var x = Math.round(w / 2 + Math.sin(t * .0007) * w * .35 + U.rand(-6, 6));
        x = U.clamp(x, 0, w - 1);
        while (true) {
          if (x > 0 && h[x - 1] + 1 < h[x]) x--;
          else if (x < w - 1 && h[x + 1] + 1 < h[x]) x++;
          else break;
        }
        h[x]++;
        c.fillRect(x * S, (H - h[x]) * S, S, S);
        if (h[x] > H * .85) { el._fxW = 0; c.clearRect(0, 0, cv.width, cv.height); return; }
      }
    }
  });

  // Un dégradé maillé qui se déforme lentement
  FX.register('mesh-gradient', {
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var T = t * .00025 * U.num(el, 'fxSpeed', 1);
      for (var i = 0; i < 4; i++) {
        el.style.setProperty('--fx-x' + i, (50 + Math.sin(T * (1 + i * .3) + i * 2) * 42).toFixed(1) + '%');
        el.style.setProperty('--fx-y' + i, (50 + Math.cos(T * (1.2 - i * .2) + i) * 42).toFixed(1) + '%');
      }
    }
  });

  // Une façade de tuiles qui s'allument au hasard
  FX.register('tiles-flicker', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
    },
    tick: function (el, dt) {
      var cv = el._fxCv, S = U.num(el, 'fxCell', 22), w = Math.ceil(cv.clientWidth / S), h = Math.ceil(cv.clientHeight / S);
      if (!w) return;
      if (el._fxW !== w) {
        el._fxW = w; cv.width = w * S; cv.height = h * S;
        el._fxV = new Float32Array(w * h);
        el._fxTg = new Float32Array(w * h);
        for (var i = 0; i < w * h; i++) el._fxTg[i] = Math.random() * .6;
      }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d'), V = el._fxV, G = el._fxTg;
      c.clearRect(0, 0, cv.width, cv.height);
      c.fillStyle = getComputedStyle(cv).color;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var k = y * w + x;
        if (Math.random() < .004) G[k] = Math.random() < .15 ? 1 : Math.random() * .3;
        V[k] += (G[k] - V[k]) * .06;
        c.globalAlpha = V[k];
        c.fillRect(x * S + 1, y * S + 1, S - 2, S - 2);
      }
    }
  });

  // Une galaxie tourne lentement sur elle-même
  FX.register('spiral-galaxy', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      var arms = U.num(el, 'fxArms', 3);
      el._fxS = [];
      for (var i = 0; i < U.num(el, 'fxCount', 520); i++) {
        var r = Math.pow(Math.random(), 1.7);
        el._fxS.push({ r: r, a: (i % arms) / arms * 6.283 + r * 5 + U.rand(-.3, .3) * (1 - r * .4), z: Math.random() });
      }
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), R = Math.min(w, h) * .48, T = t * .00012;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      el._fxS.forEach(function (s) {
        var a = s.a + T / (s.r + .25);
        c.globalAlpha = .25 + s.z * .75;
        var d = 1 + s.z * 1.2;
        c.fillRect(w / 2 + Math.cos(a) * s.r * R * 1.3, h / 2 + Math.sin(a) * s.r * R * .75, d, d);
      });
    }
  });

  // Des crêtes montagneuses se succèdent en lignes
  FX.register('noise-terrain', {
    setup: function (el) { U.ensurePositioned(el); el._fxCv = U.make('canvas', 'fx-gen', el); el._fxCv.setAttribute('aria-hidden', 'true'); },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), n = U.num(el, 'fxLines', 18), T = t * .00035;
      var col = getComputedStyle(cv).color, bg = U.cssVar(el, '--fx-terrain-bg', 'transparent');
      c.clearRect(0, 0, w, h);
      c.strokeStyle = col;
      c.lineWidth = 1;
      for (var i = 0; i < n; i++) {
        var base = h * .22 + i / n * h * .72;
        c.beginPath();
        c.moveTo(0, h);
        for (var x = 0; x <= w; x += 4) {
          var q = x / w, env = Math.pow(Math.sin(q * 3.14), 2.4);
          var y = base - env * (Math.abs(Math.sin(x * .05 + i * 1.7 + T) * Math.cos(x * .021 - i * .8 - T * .6)) * 26 + 3);
          c.lineTo(x, y);
        }
        c.lineTo(w, h);
        c.closePath();
        c.globalCompositeOperation = 'destination-out';
        c.fill();
        c.globalCompositeOperation = 'source-over';
        c.stroke();
      }
      if (bg !== 'transparent') { c.globalCompositeOperation = 'destination-over'; c.fillStyle = bg; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over'; }
    }
  });

  // Des bulles montent, éclatent quand on les touche
  FX.register('bubble-rise', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = el._fxCv = U.make('canvas', 'fx-gen', el);
      cv.setAttribute('aria-hidden', 'true');
      var bs = el._fxB = [], rings = el._fxR = [];
      var spawn = function (b) { b.x = Math.random(); b.y = 1 + Math.random() * .4; b.r = U.rand(5, 18); b.a = U.rand(0, 6); return b; };
      for (var i = 0; i < U.num(el, 'fxCount', 22); i++) { var b = spawn({}); b.y = Math.random(); bs.push(b); }
      el._fxSp = spawn;
      el.addEventListener('pointermove', function (e) {
        var q = cv.getBoundingClientRect(), mx = e.clientX - q.left, my = e.clientY - q.top;
        bs.forEach(function (b) {
          var dx = b.x * q.width - mx, dy = b.y * q.height - my;
          if (dx * dx + dy * dy < b.r * b.r) { rings.push({ x: b.x * q.width, y: b.y * q.height, r: b.r, l: 1 }); spawn(b); }
        });
      });
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d');
      c.clearRect(0, 0, w, h);
      c.strokeStyle = getComputedStyle(cv).color;
      c.lineWidth = 1.5;
      el._fxB.forEach(function (b) {
        b.y -= (.03 + .9 / b.r * .05) * dt;
        if (b.y * h < -b.r) el._fxSp(b);
        c.globalAlpha = .75;
        c.beginPath();
        c.arc(b.x * w + Math.sin(t * .001 + b.a) * 7, b.y * h, b.r, 0, 7);
        c.stroke();
      });
      el._fxR = el._fxR.filter(function (r) {
        r.l -= dt * 3; r.r += dt * 60;
        if (r.l <= 0) return false;
        c.globalAlpha = r.l;
        c.beginPath();
        c.arc(r.x, r.y, r.r, 0, 7);
        c.stroke();
        return true;
      });
    }
  });

  // Un soleil en pointillés, comme une gravure qui respire
  FX.register('stipple-sun', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxP = [];
      for (var i = 0; i < U.num(el, 'fxCount', 1500); i++) {
        var a = Math.random() * 6.283, r = Math.pow(Math.random(), .6);
        el._fxP.push({ a: a, r: r * 1.3, s: Math.random(), o: U.rand(0, 6) });
      }
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), R = Math.min(w, h) * .36, T = t * .001;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      el._fxP.forEach(function (p) {
        // Plein au centre, puis des points de plus en plus rares
        if (p.r > 1 && p.s > 1 - (p.r - 1) * 2.8 + .1) return;
        var rr = p.r + Math.sin(T + p.o) * .012;
        c.fillRect(w / 2 + Math.cos(p.a) * rr * R, h / 2 + Math.sin(p.a) * rr * R, 1.3, 1.3);
      });
    }
  });

  // Un globe en fil de fer tourne, et suit le curseur
  FX.register('wire-globe', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxRot = 0; el._fxTilt = .4; el._fxTg = .4; el._fxSp = 0;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el._fxTg = ((e.clientY - r.top) / r.height - .5) * 1.2;
        el._fxSp = ((e.clientX - r.left) / r.width - .5) * 1.6;
      });
      el.addEventListener('pointerleave', function () { el._fxSp = 0; el._fxTg = .4; });
    },
    tick: function (el, dt) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      el._fxRot += dt * (.25 + el._fxSp);
      el._fxTilt = U.lerp(el._fxTilt, el._fxTg, .06);
      var c = cv.getContext('2d'), R = Math.min(w, h) * .44, rot = el._fxRot, ct = Math.cos(el._fxTilt), st = Math.sin(el._fxTilt);
      c.clearRect(0, 0, w, h);
      c.strokeStyle = getComputedStyle(cv).color;
      var seg = function (lat0, lon0, lat1, lon1) {
        var P = function (la, lo) {
          var x = Math.cos(la) * Math.sin(lo + rot), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo + rot);
          return [x, y * ct - z * st, y * st + z * ct];
        };
        var a = P(lat0, lon0), b = P(lat1, lon1), front = (a[2] + b[2]) / 2;
        c.globalAlpha = front > 0 ? .9 : .16;
        c.beginPath();
        c.moveTo(w / 2 + a[0] * R, h / 2 + a[1] * R);
        c.lineTo(w / 2 + b[0] * R, h / 2 + b[1] * R);
        c.stroke();
      };
      var D = Math.PI / 18;
      for (var la = -Math.PI / 2 + Math.PI / 9; la < Math.PI / 2 - .01; la += Math.PI / 9) for (var lo = 0; lo < 6.28; lo += D) seg(la, lo, la, lo + D);
      for (lo = 0; lo < 6.28; lo += Math.PI / 9) for (la = -Math.PI / 2; la < Math.PI / 2 - .01; la += D) seg(la, lo, la + D, lo);
    }
  });

  // L'air chaud fait trembler l'image
  FX.register('heat-haze', {
    setup: function (el) {
      var id = 'fx-haze-' + Math.random().toString(36).slice(2, 8);
      var h = document.createElement('div');
      h.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      h.innerHTML = '<svg aria-hidden="true"><filter id="' + id + '"><feTurbulence type="fractalNoise" baseFrequency=".02 .09" numOctaves="2"/><feDisplacementMap in="SourceGraphic" scale="' + U.num(el, 'fxScale', 7) + '"/></filter></svg>';
      document.body.appendChild(h);
      el._fxT = h.querySelector('feTurbulence');
      (el.firstElementChild || el).style.filter = U.reduced ? '' : 'url(#' + id + ')';
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      el._fxT.setAttribute('baseFrequency', (.018 + Math.sin(t * .0005) * .004).toFixed(4) + ' ' + (.09 + Math.sin(t * .0013) * .03).toFixed(4));
    }
  });
})(window.FX);

/* Pack 17 — Parcours et mises en page */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Une case de la grille s'ouvre et les autres se rangent autour d'elle
  FX.register('bento-expand', {
    setup: function (el) {
      var cells = Array.prototype.slice.call(el.children);
      var flip = function (change) {
        var first = cells.map(function (c) { return c.getBoundingClientRect(); });
        change();
        cells.forEach(function (c, i) {
          var l = c.getBoundingClientRect(), o = first[i];
          if (U.reduced || !c.animate) return;
          c.animate([{ transform: 'translate(' + (o.left - l.left) + 'px,' + (o.top - l.top) + 'px)' }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
        });
      };
      cells.forEach(function (c) {
        c.tabIndex = 0;
        c.setAttribute('role', 'button');
        c.setAttribute('aria-expanded', 'false');
        var toggle = function () {
          var on = !c.classList.contains('fx-big');
          flip(function () {
            cells.forEach(function (o) { o.classList.remove('fx-big'); o.setAttribute('aria-expanded', 'false'); });
            if (on) { c.classList.add('fx-big'); c.setAttribute('aria-expanded', 'true'); }
          });
        };
        c.addEventListener('click', toggle);
        c.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          if (e.key === 'Escape' && c.classList.contains('fx-big')) toggle();
        });
      });
    }
  });

  // Une liste de grands liens dont l'aperçu change au survol
  FX.register('mega-index', {
    setup: function (el) {
      var pv = U.make('div', 'fx-mi-pv', el);
      pv.setAttribute('aria-hidden', 'true');
      var links = el.querySelectorAll('a');
      var show = function (a) {
        links.forEach(function (o) { o.classList.toggle('fx-dim', o !== a); });
        var src = a.dataset.fxImg;
        if (src) pv.style.backgroundImage = 'url("' + src + '")';
        pv.classList.add('fx-on');
      };
      var hide = function () {
        links.forEach(function (o) { o.classList.remove('fx-dim'); });
        pv.classList.remove('fx-on');
      };
      links.forEach(function (a) {
        if (a.dataset.fxImg) (new Image()).src = a.dataset.fxImg;
        a.addEventListener('pointerenter', function () { show(a); });
        a.addEventListener('focus', function () { show(a); });
        a.addEventListener('blur', hide);
      });
      el.addEventListener('pointerleave', hide);
    }
  });

  // Une barre en pilule qui se réduit quand on descend
  FX.register('pill-nav-morph', {
    setup: function (el) {
      var lastY = window.scrollY;
      var upd = function () {
        var y = window.scrollY;
        if (Math.abs(y - lastY) < 6) return;
        el.classList.toggle('fx-small', y > lastY && y > U.num(el, 'fxAfter', 120));
        lastY = y;
      };
      window.addEventListener('scroll', upd, { passive: true });
      el.addEventListener('pointerenter', function () { el.classList.remove('fx-small'); });
      el.addEventListener('focusin', function () { el.classList.remove('fx-small'); });
      if (el.dataset.fxDemo) setInterval(function () { el.classList.toggle('fx-small'); }, 1800);
    }
  });

  // Un rail vertical indique la section et la progression
  FX.register('rail-progress-nav', {
    setup: function (el) {
      var links = Array.prototype.slice.call(el.querySelectorAll('a[href^="#"]'));
      el._fxL = links.map(function (a) { return { a: a, t: document.querySelector(a.getAttribute('href').length > 1 ? a.getAttribute('href') : null) }; }).filter(function (o) { return o.t; });
      links.forEach(function (a) { U.make('i', '', a).setAttribute('aria-hidden', 'true'); });
      if (!el._fxL.length && links.length) links[0].classList.add('fx-cur');
    },
    scroll: function (el, info) {
      if (!el._fxL.length) { el.style.setProperty('--fx-q', info.pass.toFixed(3)); return; }
      var cur = 0, mid = info.vh / 2;
      el._fxL.forEach(function (o, i) { if (o.t.getBoundingClientRect().top < mid) cur = i; });
      el._fxL.forEach(function (o, i) {
        var on = i === cur;
        o.a.classList.toggle('fx-cur', on);
        if (on) { o.a.setAttribute('aria-current', 'true'); var r = o.t.getBoundingClientRect(); o.a.style.setProperty('--fx-q', U.clamp((mid - r.top) / r.height, 0, 1).toFixed(3)); }
        else o.a.removeAttribute('aria-current');
      });
    }
  });

  // Une palette de commandes qui filtre en direct
  FX.register('command-dock', {
    setup: function (el) {
      var input = el.querySelector('input'), items = Array.prototype.slice.call(el.querySelectorAll('li')), cur = 0;
      if (!input) return;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'true');
      var list = el.querySelector('ul');
      if (list) list.setAttribute('role', 'listbox');
      var vis = function () { return items.filter(function (i) { return !i.hidden; }); };
      var mark = function () {
        var v = vis();
        items.forEach(function (i) { i.classList.remove('fx-cur'); i.setAttribute('role', 'option'); i.setAttribute('aria-selected', 'false'); });
        if (v[cur]) { v[cur].classList.add('fx-cur'); v[cur].setAttribute('aria-selected', 'true'); }
      };
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        items.forEach(function (i) { i.hidden = i.textContent.toLowerCase().indexOf(q) === -1; });
        cur = 0; mark();
      });
      input.addEventListener('keydown', function (e) {
        var v = vis();
        if (e.key === 'ArrowDown') { e.preventDefault(); cur = (cur + 1) % Math.max(1, v.length); mark(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); cur = (cur - 1 + v.length) % Math.max(1, v.length); mark(); }
        if (e.key === 'Enter' && v[cur]) { e.preventDefault(); el.dispatchEvent(new CustomEvent('fx:pick', { bubbles: true, detail: { text: v[cur].textContent.trim() } })); var a = v[cur].querySelector('a'); if (a) a.click(); }
      });
      items.forEach(function (i, k) { i.style.setProperty('--fx-i', k); i.addEventListener('pointerenter', function () { cur = vis().indexOf(i); mark(); }); });
      mark();
      window.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'k' && el.dataset.fxShortcut === 'true') { e.preventDefault(); input.focus(); } });
    }
  });

  // Un fil d'Ariane qui replie ses niveaux intermédiaires
  FX.register('breadcrumb-fold', {
    setup: function (el) {
      var items = Array.prototype.slice.call(el.children);
      if (items.length <= U.num(el, 'fxKeep', 3)) return;
      var mid = items.slice(1, -1);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fx-bc-more';
      btn.textContent = '…';
      btn.setAttribute('aria-label', 'Afficher ' + mid.length + ' niveaux');
      btn.setAttribute('aria-expanded', 'false');
      el.insertBefore(btn, items[1]);
      mid.forEach(function (m, i) { m.classList.add('fx-bc-mid'); m.style.setProperty('--fx-i', i); });
      btn.addEventListener('click', function () {
        el.classList.add('fx-open');
        btn.setAttribute('aria-expanded', 'true');
        btn.hidden = true;
        if (mid[0].querySelector('a')) mid[0].querySelector('a').focus();
      });
    }
  });

  // Les titres de section s'empilent en haut de l'écran
  FX.register('sticky-stack-nav', {
    setup: function (el) {
      var layout = function () {
        var heads = el.querySelectorAll(el.dataset.fxHead || 'h2,h3');
        var top = U.num(el, 'fxTop', 0);
        heads.forEach(function (h, i) { h.style.setProperty('--fx-top', top + 'px'); h.style.zIndex = 10 + i; top += h.offsetHeight; });
        heads.forEach(function (h, i) { h.style.setProperty('--fx-bot', (top - parseFloat(h.style.getPropertyValue('--fx-top')) - h.offsetHeight) + 'px'); });
      };
      layout();
      U.onResize(layout);
    }
  });

  // Un panneau qu'on tire vers le haut depuis le bas de l'écran
  FX.register('page-peek', {
    setup: function (el) {
      var handle = el.querySelector('button') || el.firstElementChild, startY = 0, base = 0, drag = false, stops = [0, .5, 1], cur = 0;
      var H = function () { return el.offsetHeight - U.num(el, 'fxPeek', 56); };
      var go = function (i) {
        cur = i;
        el.style.setProperty('--fx-pos', (H() * (1 - stops[i])) + 'px');
        if (handle) handle.setAttribute('aria-expanded', i > 0);
      };
      go(0);
      if (!handle) return;
      handle.addEventListener('pointerdown', function (e) { drag = true; startY = e.clientY; base = H() * (1 - stops[cur]); el.classList.add('fx-drag'); if (e.isTrusted) handle.setPointerCapture(e.pointerId); });
      handle.addEventListener('pointermove', function (e) { if (drag) el.style.setProperty('--fx-pos', U.clamp(base + e.clientY - startY, 0, H()) + 'px'); });
      handle.addEventListener('pointerup', function (e) {
        if (!drag) return;
        drag = false; el.classList.remove('fx-drag');
        var moved = Math.abs(e.clientY - startY) > 6;
        if (!moved) return go((cur + 1) % stops.length);
        var q = 1 - parseFloat(el.style.getPropertyValue('--fx-pos')) / H(), best = 0;
        stops.forEach(function (s, i) { if (Math.abs(s - q) < Math.abs(stops[best] - q)) best = i; });
        go(best);
      });
      handle.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go((cur + 1) % stops.length); } });
    }
  });

  // Une rangée horizontale avec accroche et commandes
  FX.register('horizontal-snap', {
    setup: function (el) {
      var track = el.firstElementChild, items = Array.prototype.slice.call(track.children), cur = 0;
      var bar = U.make('div', 'fx-hs-bar', el);
      bar.innerHTML = '<button type="button" aria-label="Précédent">←</button><span class="fx-hs-dots"></span><button type="button" aria-label="Suivant">→</button>';
      var dots = bar.querySelector('.fx-hs-dots');
      items.forEach(function (it, i) {
        var d = U.make('i', '', dots);
        d.addEventListener('click', function () { go(i); });
      });
      var go = function (i) {
        i = U.clamp(i, 0, items.length - 1);
        track.scrollTo({ left: items[i].offsetLeft - track.offsetLeft, behavior: U.reduced ? 'auto' : 'smooth' });
      };
      bar.firstChild.addEventListener('click', function () { go(cur - 1); });
      bar.lastChild.addEventListener('click', function () { go(cur + 1); });
      var mark = function () {
        var best = 0, bd = 1e9;
        items.forEach(function (it, i) { var d = Math.abs(it.offsetLeft - track.offsetLeft - track.scrollLeft); if (d < bd) { bd = d; best = i; } });
        cur = best;
        Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('fx-on', i === best); });
      };
      track.addEventListener('scroll', function () { U.raf(mark); }, { passive: true });
      mark();
    }
  });

  // Deux panneaux : celui qu'on survole prend presque toute la place
  FX.register('split-hover-hero', {
    setup: function (el) {
      var k = Array.prototype.slice.call(el.children);
      var set = function (i) { k.forEach(function (c, j) { c.style.setProperty('--fx-g', i === j ? U.num(el, 'fxGrow', 3) : 1); c.classList.toggle('fx-on', i === j); }); };
      k.forEach(function (c, i) {
        c.addEventListener('pointerenter', function () { set(i); });
        c.addEventListener('focusin', function () { set(i); });
      });
      el.addEventListener('pointerleave', function () { set(-1); });
    }
  });

  // Un mur dont les colonnes se remplissent et se réorganisent en douceur
  FX.register('masonry-flow', {
    setup: function (el) {
      var kids = Array.prototype.slice.call(el.children);
      var layout = function () {
        var w = el.clientWidth, gap = U.num(el, 'fxGap', 8), min = U.num(el, 'fxMin', 80);
        var cols = Math.max(1, Math.floor((w + gap) / (min + gap))), cw = (w - gap * (cols - 1)) / cols, H = new Array(cols).fill(0);
        kids.forEach(function (k) {
          k.style.width = cw + 'px';
          var c = H.indexOf(Math.min.apply(null, H));
          k.style.transform = 'translate(' + (c * (cw + gap)) + 'px,' + H[c] + 'px)';
          H[c] += k.offsetHeight + gap;
        });
        el.style.height = Math.max.apply(null, H) + 'px';
      };
      layout();
      U.onResize(layout);
      el.querySelectorAll('img').forEach(function (i) { if (!i.complete) i.addEventListener('load', layout); });
    }
  });

  // Le trait d'onglet s'étire jusqu'au suivant avant de se rétracter
  FX.register('tab-underline-ink', {
    setup: function (el) {
      var tabs = Array.prototype.slice.call(el.querySelectorAll('[role="tab"],button,a'));
      var ink = U.make('i', 'fx-ink', el);
      ink.setAttribute('aria-hidden', 'true');
      var L = 0, R = 0;
      var move = function (t, instant) {
        var r = t.getBoundingClientRect(), o = el.getBoundingClientRect();
        var nl = r.left - o.left, nr = o.right - r.right;
        var right = nl > L;
        ink.style.transitionDelay = instant ? '0s' : (right ? '.09s, 0s' : '0s, .09s');
        if (instant) ink.style.transitionDuration = '0s';
        el.style.setProperty('--fx-l', nl + 'px');
        el.style.setProperty('--fx-r', nr + 'px');
        L = nl; R = nr;
        if (instant) { void ink.offsetWidth; ink.style.transitionDuration = ''; }
      };
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          tabs.forEach(function (o) { o.setAttribute('aria-selected', o === t); });
          move(t);
        });
      });
      var first = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
      if (first) { first.setAttribute('aria-selected', 'true'); move(first, true); }
      U.onResize(function () { var a = el.querySelector('[aria-selected="true"]'); if (a) move(a, true); });
    }
  });

  // Une barre d'onglets dont le renflement glisse sous l'icône active
  FX.register('mobile-tabbar-bump', {
    setup: function (el) {
      var tabs = Array.prototype.slice.call(el.querySelectorAll('button,a'));
      U.make('i', 'fx-bump', el).setAttribute('aria-hidden', 'true');
      var set = function (t) {
        tabs.forEach(function (o) { o.classList.toggle('fx-cur', o === t); if (o === t) o.setAttribute('aria-current', 'page'); else o.removeAttribute('aria-current'); });
        el.style.setProperty('--fx-x', (t.offsetLeft + t.offsetWidth / 2) + 'px');
      };
      tabs.forEach(function (t) { t.addEventListener('click', function (e) { if (t.tagName === 'A' && t.getAttribute('href') === '#') e.preventDefault(); set(t); }); });
      if (tabs[0]) set(tabs[0]);
      U.onResize(function () { var c = el.querySelector('.fx-cur'); if (c) set(c); });
    }
  });

  // Une miniature de la page montre où se trouve l'écran
  FX.register('toc-minimap', {
    setup: function (el) {
      var secs = Array.prototype.slice.call(document.querySelectorAll(el.dataset.fxTarget || 'main > section'));
      el._fxV = U.make('i', 'fx-mm-view', el);
      el._fxSecs = secs;
      el.setAttribute('role', 'navigation');
      el.setAttribute('aria-label', 'Plan de la page');
      if (!secs.length) { for (var i = 0; i < 6; i++) U.make('b', '', el).style.flex = 1 + i % 3; return; }
      var tot = document.documentElement.scrollHeight;
      secs.forEach(function (s, i) {
        var b = document.createElement('a');
        b.href = s.id ? '#' + s.id : '#';
        b.style.flex = s.offsetHeight / tot;
        b.setAttribute('aria-label', (s.querySelector('h1,h2,h3') || {}).textContent || 'Section ' + (i + 1));
        el.appendChild(b);
      });
    },
    scroll: function (el, info) {
      var tot = document.documentElement.scrollHeight;
      el._fxV.style.setProperty('--fx-t', (window.scrollY / tot * 100).toFixed(2) + '%');
      el._fxV.style.setProperty('--fx-h', Math.max(6, info.vh / tot * 100).toFixed(2) + '%');
    }
  });

  // Un menu radial qui s'ouvre sous le curseur
  FX.register('cursor-menu-ring', {
    setup: function (el) {
      var items = Array.prototype.slice.call(el.querySelectorAll('button,a')), n = items.length, cur = -1;
      items.forEach(function (b, i) {
        var a = i / n * 6.283 - 1.571;
        b.style.setProperty('--fx-x', (Math.cos(a) * U.num(el, 'fxRadius', 62)).toFixed(1) + 'px');
        b.style.setProperty('--fx-y', (Math.sin(a) * U.num(el, 'fxRadius', 62)).toFixed(1) + 'px');
        b.style.setProperty('--fx-i', i);
      });
      var open = function (x, y) {
        var o = (el.offsetParent || el.parentElement).getBoundingClientRect();
        el.style.left = (x - o.left) + 'px';
        el.style.top = (y - o.top) + 'px';
        el.classList.add('fx-open');
      };
      var close = function () { el.classList.remove('fx-open'); items.forEach(function (b) { b.classList.remove('fx-cur'); }); cur = -1; };
      var host = el.parentElement;
      host.addEventListener('contextmenu', function (e) { e.preventDefault(); open(e.clientX, e.clientY); items[0].focus({ preventScroll: true }); });
      document.addEventListener('pointerdown', function (e) { if (!el.contains(e.target)) close(); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); items[(items.indexOf(document.activeElement) + 1) % n].focus(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); items[(items.indexOf(document.activeElement) - 1 + n) % n].focus(); }
      });
      if (el.dataset.fxDemo) { var r = el.parentElement.getBoundingClientRect(); open(r.left + r.width / 2, r.top + r.height / 2); }
      el._fxOpen = open;
    },
    trigger: function (el, e) { var r = el.parentElement.getBoundingClientRect(); el._fxOpen(r.left + r.width / 2, r.top + r.height / 2); }
  });

  // Des sections empilées comme des onglets de classeur
  FX.register('stacked-sections-tabs', {
    setup: function (el) {
      var secs = Array.prototype.slice.call(el.children), n = secs.length;
      el.style.setProperty('--fx-n', n);
      var open = function (i) {
        secs.forEach(function (s, j) {
          var on = i === j;
          s.classList.toggle('fx-open', on);
          var b = s.querySelector('button');
          if (b) b.setAttribute('aria-expanded', on);
        });
      };
      secs.forEach(function (s, i) {
        var b = s.querySelector('button');
        if (b) b.addEventListener('click', function () { open(i); });
      });
      open(0);
    }
  });

  // Des couvertures en perspective autour de l'élément central
  FX.register('carousel-3d-coverflow', {
    setup: function (el) {
      var k = Array.prototype.slice.call(el.children), cur = Math.floor(k.length / 2);
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-roledescription', 'carrousel');
      var show = function () {
        k.forEach(function (c, i) {
          var d = i - cur;
          c.style.setProperty('--fx-d', d);
          c.style.setProperty('--fx-a', Math.abs(d));
          c.style.zIndex = 20 - Math.abs(d);
          c.setAttribute('aria-hidden', d !== 0);
        });
      };
      k.forEach(function (c, i) { c.addEventListener('click', function () { cur = i; show(); }); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { cur = Math.max(0, cur - 1); show(); }
        if (e.key === 'ArrowRight') { cur = Math.min(k.length - 1, cur + 1); show(); }
      });
      show();
    }
  });

  // Un lien d'évitement qui apparaît au clavier et emmène au contenu
  FX.register('skip-link-reveal', {
    setup: function (el) {
      el.addEventListener('click', function (e) {
        var href = el.getAttribute('href');
        if (!href || href.charAt(0) !== '#' || href.length < 2) return;
        var t = document.querySelector(href);
        if (!t) return;
        e.preventDefault();
        if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
        t.focus({ preventScroll: true });
        t.scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth' });
      });
    }
  });

  // Un sélecteur de langue dont les sigles se croisent
  FX.register('language-switch-flip', {
    setup: function (el) {
      var langs = (el.dataset.fxLangs || 'FR|EN|ES').split('|'), cur = 0;
      el.setAttribute('aria-label', 'Choisir la langue');
      el.innerHTML = '<span class="fx-ls-now"></span>';
      var now = el.firstChild;
      var render = function (dir) {
        var s = document.createElement('span');
        s.className = 'fx-ls-in';
        s.textContent = langs[cur];
        now.innerHTML = '';
        now.appendChild(s);
      };
      render();
      el.addEventListener('click', function () {
        cur = (cur + 1) % langs.length;
        render();
        document.documentElement.lang = langs[cur].toLowerCase();
        el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { lang: langs[cur] } }));
      });
    }
  });

  // Un parcours en étapes dont la ligne avance en courant
  FX.register('progress-steps-rail', {
    setup: function (el) {
      var st = Array.prototype.slice.call(el.children), n = st.length, cur = U.num(el, 'fxStep', 0);
      U.make('i', 'fx-psr', el).setAttribute('aria-hidden', 'true');
      el._fxSet = function (i) {
        cur = U.clamp(i, 0, n - 1);
        st.forEach(function (s, j) {
          s.classList.toggle('fx-done', j < cur);
          s.classList.toggle('fx-cur', j === cur);
          if (j === cur) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
        });
        el.style.setProperty('--fx-p', n > 1 ? cur / (n - 1) : 1);
      };
      el._fxSet(cur);
      el._fxN = function () { el._fxSet((cur + 1) % n); };
    },
    trigger: function (el) { el._fxN(); }
  });
})(window.FX);

/* Pack 18 — Données et présentation */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Des barres rayonnent autour d'un centre
  FX.register('radial-bars', {
    entrance: true,
    setup: function (el) {
      var v = (el.dataset.fxValues || '40,70,55,90,35,65,80,50,75,45,60,85').split(',').map(Number), max = Math.max.apply(null, v);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Valeurs : ' + v.join(', '));
      v.forEach(function (n, i) {
        var b = U.make('i', '', el);
        b.style.setProperty('--fx-a', (i / v.length * 360) + 'deg');
        b.style.setProperty('--fx-v', n / max);
        b.style.setProperty('--fx-i', i);
      });
    }
  });

  // Une petite courbe se dessine à l'entrée
  FX.register('sparkline-draw', {
    entrance: true,
    setup: function (el) {
      var v = (el.dataset.fxValues || '12,18,14,22,19,28,24,33').split(',').map(Number);
      var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), W = 100, H = 30;
      var pt = v.map(function (n, i) { return [i / (v.length - 1) * W, H - 3 - (n - mn) / ((mx - mn) || 1) * (H - 6)]; });
      var line = 'M' + pt.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
      var last = pt[pt.length - 1];
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'Tendance, de ' + v[0] + ' à ' + v[v.length - 1]);
      el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="fx-sl-area" d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z"/><path class="fx-sl-line" pathLength="1" d="' + line + '"/></svg><i style="left:' + last[0] + '%;top:' + (last[1] / H * 100) + '%"></i>';
    }
  });

  // Un calendrier d'activité qui s'allume en vague
  FX.register('heat-calendar', {
    entrance: true,
    setup: function (el) {
      var w = U.num(el, 'fxWeeks', 16), vals = el.dataset.fxValues ? el.dataset.fxValues.split(',').map(Number) : null;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Activité sur ' + w + ' semaines');
      el.style.setProperty('--fx-w', w);
      for (var i = 0; i < w * 7; i++) {
        var c = U.make('i', '', el);
        var col = Math.floor(i / 7);
        var v = vals ? (vals[i] || 0) : Math.pow(Math.random(), 2.2);
        c.style.setProperty('--fx-v', v.toFixed(2));
        c.style.setProperty('--fx-d', (col * 28 + (i % 7) * 12) + 'ms');
      }
    }
  });

  // Une barre répartie en segments avec sa légende
  FX.register('stacked-progress', {
    entrance: true,
    setup: function (el) {
      var parts = (el.dataset.fxParts || 'Design:40,Code:35,Son:25').split(',').map(function (s) { var p = s.split(':'); return { n: p[0], v: parseFloat(p[1]) }; });
      var sum = parts.reduce(function (a, p) { return a + p.v; }, 0);
      var bar = U.make('div', 'fx-sp-bar', el), leg = U.make('ul', 'fx-sp-leg', el);
      bar.setAttribute('aria-hidden', 'true');
      parts.forEach(function (p, i) {
        var s = U.make('i', '', bar);
        s.style.setProperty('--fx-w', p.v / sum);
        s.style.setProperty('--fx-i', i);
        var li = U.make('li', '', leg);
        li.style.setProperty('--fx-i', i);
        li.textContent = p.n + ' ' + Math.round(p.v / sum * 100) + ' %';
      });
    }
  });

  // Deux valeurs face à face, chacune pousse depuis son côté
  FX.register('versus-bars', {
    entrance: true,
    setup: function (el) {
      var a = U.num(el, 'fxA', 62), b = U.num(el, 'fxB', 38), na = el.dataset.fxNameA || 'Avant', nb = el.dataset.fxNameB || 'Après';
      el.innerHTML = '<div class="fx-vs-l"><b>' + a + '</b><span>' + na + '</span></div><div class="fx-vs-r"><span>' + nb + '</span><b>' + b + '</b></div><div class="fx-vs-bar"><i class="a"></i><i class="b"></i></div>';
      el.style.setProperty('--fx-a', a / (a + b));
      el.classList.add(a >= b ? 'fx-a-wins' : 'fx-b-wins');
    }
  });

  // Un cadran dont l'aiguille monte et oscille un instant
  FX.register('gauge-needle', {
    entrance: true,
    setup: function (el) {
      el.setAttribute('role', 'meter');
      var v = U.num(el, 'fxValue', 72), max = U.num(el, 'fxMax', 100);
      el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', max);
      el.innerHTML = '<svg viewBox="0 0 120 70" aria-hidden="true"><path class="bg" pathLength="1" d="M10 62 A50 50 0 0 1 110 62"/><path class="on" pathLength="1" d="M10 62 A50 50 0 0 1 110 62"/><g class="nd"><line x1="60" y1="62" x2="60" y2="20"/><circle cx="60" cy="62" r="4"/></g></svg><b>' + v + '</b>';
      el._fxQ = v / max;
    },
    reset: function (el) { el.style.setProperty('--fx-q', 0); },
    enter: function (el) {
      var q = el._fxQ;
      U.tween(el, 1100, function (p) {
        var o = 1 - Math.pow(1 - p, 3), wob = Math.sin(p * 12) * (1 - p) * .05;
        el.style.setProperty('--fx-q', (q * o + wob * q).toFixed(4));
      });
    }
  });

  // Un classement dont les lignes se dépassent
  FX.register('rank-race', {
    setup: function (el) {
      var rows = (el.dataset.fxItems || 'Atlas:40,Brume:55,Halo:30,Ocre:65,Verdure:48').split(',').map(function (s) {
        var p = s.split(':'), r = U.make('div', 'fx-rr', el);
        r.innerHTML = '<span></span><i></i><b></b>';
        r.firstChild.textContent = p[0];
        return { el: r, v: parseFloat(p[1]) };
      });
      el.style.setProperty('--fx-count', rows.length);
      var draw = function () {
        var mx = Math.max.apply(null, rows.map(function (r) { return r.v; }));
        rows.slice().sort(function (a, b) { return b.v - a.v; }).forEach(function (r, i) {
          r.el.style.setProperty('--fx-rank', i);
          r.el.style.setProperty('--fx-w', r.v / mx);
          r.el.lastChild.textContent = Math.round(r.v);
        });
      };
      draw();
      el._fxRows = rows; el._fxDraw = draw; el._fxT = 0;
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxT += dt;
      if (el._fxT < U.num(el, 'fxEvery', 1.1)) return;
      el._fxT = 0;
      el._fxRows.forEach(function (r) { r.v = Math.max(5, r.v + U.rand(-4, 12)); });
      el._fxDraw();
    }
  });

  // Une frise où chaque date affiche son histoire
  FX.register('timeline-scrub', {
    setup: function (el) {
      var items = Array.prototype.slice.call(el.children);
      var rail = U.make('div', 'fx-ts-rail', el), out = U.make('div', 'fx-ts-out', el);
      rail.setAttribute('role', 'tablist');
      out.setAttribute('aria-live', 'polite');
      var dots = items.map(function (it, i) {
        it.hidden = true;
        var b = U.make('button', '', rail);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.textContent = it.dataset.date || i + 1;
        b.style.setProperty('--fx-x', items.length > 1 ? i / (items.length - 1) : 0);
        b.addEventListener('click', function () { set(i); });
        b.addEventListener('pointerenter', function () { set(i); });
        return b;
      });
      var set = function (i) {
        dots.forEach(function (d, k) { d.setAttribute('aria-selected', k === i); d.tabIndex = k === i ? 0 : -1; });
        rail.style.setProperty('--fx-p', items.length > 1 ? i / (items.length - 1) : 0);
        out.innerHTML = '';
        var c = items[i].cloneNode(true);
        c.hidden = false;
        c.className = 'fx-ts-in';
        out.appendChild(c);
      };
      rail.addEventListener('keydown', function (e) {
        var i = dots.indexOf(document.activeElement);
        if (e.key === 'ArrowRight' && dots[i + 1]) { set(i + 1); dots[i + 1].focus(); }
        if (e.key === 'ArrowLeft' && dots[i - 1]) { set(i - 1); dots[i - 1].focus(); }
      });
      set(0);
    }
  });

  // Des bobines de chiffres tournent et s'arrêtent sur le nombre
  FX.register('number-ticker-reel', {
    entrance: true,
    setup: function (el) {
      var txt = (el.dataset.fxValue || el.textContent).trim();
      el.setAttribute('aria-label', txt);
      el.textContent = '';
      Array.from(txt).forEach(function (ch, i) {
        var box = U.make('span', 'fx-ntr', el);
        box.setAttribute('aria-hidden', 'true');
        if (!/\d/.test(ch)) { box.textContent = ch; box.classList.add('fx-ntr-fix'); return; }
        var col = U.make('span', 'fx-ntr-col', box), s = '';
        for (var k = 0; k < 20; k++) s += k % 10 + '\n';
        col.textContent = s + ch;
        col.style.setProperty('--fx-i', i);
      });
    }
  });

  // Une pile de témoignages dont la première carte part au fond
  FX.register('quote-card-shuffle', {
    setup: function (el) {
      el._fxT = 0;
      el._fxOrder = function () { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-pos', i); c.style.zIndex = 30 - i; c.setAttribute('aria-hidden', i > 0); }); };
      el._fxOrder();
      el._fxNext = function () {
        var f = el.firstElementChild;
        f.classList.add('fx-out');
        setTimeout(function () { f.classList.remove('fx-out'); el.appendChild(f); el._fxOrder(); }, 420);
      };
      el.addEventListener('click', el._fxNext);
    },
    trigger: function (el) { el._fxNext(); },
    tick: function (el, dt) {
      if (U.reduced || el.matches(':hover')) return;
      el._fxT += dt;
      if (el._fxT > U.num(el, 'fxHold', 3.5)) { el._fxT = 0; el._fxNext(); }
    }
  });

  // Des cartes de tarifs dont les prix suivent la bascule annuelle
  FX.register('pricing-toggle-cards', {
    setup: function (el) {
      var tog = el.querySelector('input[type="checkbox"]'), prices = el.querySelectorAll('[data-month]');
      if (!tog) return;
      var render = function () {
        prices.forEach(function (p) {
          var to = parseFloat(tog.checked ? p.dataset.year : p.dataset.month), from = parseFloat(p.textContent) || to;
          U.tween(p, 450, function (k) { p.textContent = Math.round(U.lerp(from, to, U.easeOut(k))); });
        });
        el.classList.toggle('fx-year', tog.checked);
      };
      prices.forEach(function (p) { p.textContent = p.dataset.month; });
      tog.addEventListener('change', render);
    }
  });

  // Une liste de fonctions dont l'élément actif change et se remplit
  FX.register('feature-orbit-card', {
    setup: function (el) {
      var k = Array.prototype.slice.call(el.children), cur = 0;
      el._fxT = 0; el._fxD = U.num(el, 'fxHold', 3.2);
      var set = function (i) { cur = i; el._fxT = 0; k.forEach(function (c, j) { c.classList.toggle('fx-cur', j === i); if (j === i) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current'); }); };
      k.forEach(function (c, i) { c.tabIndex = 0; c.addEventListener('pointerenter', function () { set(i); }); c.addEventListener('focus', function () { set(i); }); U.make('i', 'fx-foc', c).setAttribute('aria-hidden', 'true'); });
      set(0);
      el._fxNext = function () { set((cur + 1) % k.length); };
      el._fxCur = function () { return k[cur]; };
    },
    tick: function (el, dt) {
      if (U.reduced || el.matches(':hover')) return;
      el._fxT += dt;
      el._fxCur().style.setProperty('--fx-q', Math.min(1, el._fxT / el._fxD).toFixed(3));
      if (el._fxT >= el._fxD) el._fxNext();
    }
  });

  // Un mur de logos dont les cases se retournent une à une
  FX.register('logo-wall-flip', {
    setup: function (el) {
      var all = (el.dataset.fxLogos || 'Atlas|Brume|Halo|Ocre|Verdure|Nord|Sable|Iris|Onde').split('|'), n = U.num(el, 'fxCells', 6);
      el.style.setProperty('--fx-cells', Math.ceil(n / 2));
      el.setAttribute('aria-label', 'Références : ' + all.join(', '));
      el.setAttribute('role', 'img');
      var cells = [];
      for (var i = 0; i < n; i++) { var c = U.make('span', '', el); c.setAttribute('aria-hidden', 'true'); c.textContent = all[i % all.length]; cells.push(c); }
      el._fxC = cells; el._fxNx = n; el._fxAll = all; el._fxT = 0;
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxT += dt;
      if (el._fxT < U.num(el, 'fxEvery', 1.1)) return;
      el._fxT = 0;
      var c = el._fxC[Math.floor(Math.random() * el._fxC.length)], t = el._fxAll[el._fxNx++ % el._fxAll.length];
      c.classList.add('fx-flip');
      setTimeout(function () { c.textContent = t; }, 220);
      setTimeout(function () { c.classList.remove('fx-flip'); }, 460);
    }
  });

  // Un grand chiffre monte pendant que son libellé se dévoile
  FX.register('stat-reveal-split', {
    entrance: true,
    setup: function (el) {
      var v = U.num(el, 'fxValue', 87), s = el.dataset.fxSuffix || '%', l = el.dataset.fxLabel || '';
      el.innerHTML = '<b></b><span></span>';
      el.lastChild.textContent = l;
      el.setAttribute('aria-label', v + ' ' + s + ' ' + l);
      el._fxW = function (p) { el.firstChild.textContent = Math.round(v * U.easeOut(p)) + s; };
      el._fxW(0);
    },
    reset: function (el) { el._fxW(0); },
    enter: function (el) { U.tween(el, 1200, el._fxW); }
  });

  // Une carte en points avec des épingles qui s'allument
  FX.register('world-pins', {
    entrance: true,
    setup: function (el) {
      var pins = (el.dataset.fxPins || '48,2;40,-74;35,139;-23,-46;51,0;1,103').split(';').map(function (s) { return s.split(',').map(Number); });
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', el.getAttribute('aria-label') || pins.length + ' implantations dans le monde');
      var svg = '<svg viewBox="0 0 360 170" aria-hidden="true">';
      // Grandes masses de terre approximées par des ellipses : suffisant pour un décor en points
      var land = [[-100, 45, 50, 25], [-60, -15, 22, 32], [15, 50, 25, 15], [20, 5, 26, 32], [90, 45, 62, 25], [135, -25, 20, 12]];
      for (var y = -60; y <= 80; y += 6) for (var x = -170; x <= 175; x += 6) {
        if (land.some(function (l) { var dx = (x - l[0]) / l[2], dy = (y - l[1]) / l[3]; return dx * dx + dy * dy < 1; })) svg += '<circle class="d" cx="' + (x + 180) + '" cy="' + (85 - y) + '" r="1.2"/>';
      }
      pins.forEach(function (p, i) { svg += '<g class="p" style="--fx-i:' + i + ';transform-origin:' + (p[1] + 180) + 'px ' + (85 - p[0]) + 'px"><circle cx="' + (p[1] + 180) + '" cy="' + (85 - p[0]) + '" r="3"/><circle class="r" cx="' + (p[1] + 180) + '" cy="' + (85 - p[0]) + '" r="3"/></g>'; });
      el.innerHTML = svg + '</svg>';
    }
  });

  // Dans un tableau, la colonne survolée s'illumine en entier
  FX.register('compare-table-sweep', {
    setup: function (el) {
      var cells = el.querySelectorAll('th,td'), best = U.num(el, 'fxBest', -1);
      var mark = function (i) { cells.forEach(function (c) { c.classList.toggle('fx-col', c.cellIndex === i); }); };
      cells.forEach(function (c) {
        c.addEventListener('pointerenter', function () { if (c.cellIndex > 0) mark(c.cellIndex); });
        c.addEventListener('focusin', function () { if (c.cellIndex > 0) mark(c.cellIndex); });
      });
      el.addEventListener('pointerleave', function () { mark(best); });
      mark(best);
    }
  });

  // Un itinéraire se dessine au fil du défilement et allume ses étapes
  FX.register('map-route-draw', {
    setup: function (el) {
      var path = el.querySelector('path');
      if (!path) return;
      var L = path.getTotalLength();
      path.style.strokeDasharray = L;
      el._fxP = path; el._fxL = L;
      el._fxS = Array.prototype.slice.call(el.querySelectorAll('[data-at]')).map(function (d) { return { d: d, at: parseFloat(d.dataset.at) }; });
    },
    scroll: function (el, info) {
      if (!el._fxP) return;
      var q = el.dataset.fxDemo ? .72 : info.enter;
      el._fxP.style.strokeDashoffset = (el._fxL * (1 - q)).toFixed(1);
      el._fxS.forEach(function (s) { s.d.classList.toggle('fx-on', q >= s.at); });
    }
  });

  // Une rangée de visages, dont celui survolé s'agrandit et se présente
  FX.register('team-card-spotlight', {
    setup: function (el) {
      var k = Array.prototype.slice.call(el.children);
      var cap = document.createElement('div');
      cap.className = 'fx-tc-cap';
      cap.setAttribute('aria-live', 'polite');
      el.appendChild(cap);
      var set = function (c) {
        k.forEach(function (o) { o.classList.toggle('fx-on', o === c); });
        cap.textContent = (c.dataset.name || '') + (c.dataset.role ? ' — ' + c.dataset.role : '');
      };
      k.forEach(function (c) {
        c.tabIndex = 0;
        c.addEventListener('pointerenter', function () { set(c); });
        c.addEventListener('focus', function () { set(c); });
      });
      set(k[0]);
    }
  });

  // Un journal des nouveautés, filtrable par type
  FX.register('changelog-feed', {
    entrance: true,
    setup: function (el) {
      var items = Array.prototype.slice.call(el.children), types = [];
      items.forEach(function (it, i) {
        it.style.setProperty('--fx-i', i);
        if (it.dataset.type && types.indexOf(it.dataset.type) < 0) types.push(it.dataset.type);
      });
      if (!types.length) return;
      var bar = document.createElement('div');
      bar.className = 'fx-cf-bar';
      el.parentNode.insertBefore(bar, el);
      ['Tout'].concat(types).forEach(function (t, k) {
        var b = U.make('button', '', bar);
        b.type = 'button';
        b.textContent = t;
        b.setAttribute('aria-pressed', k === 0);
        b.addEventListener('click', function () {
          bar.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
          items.forEach(function (it) { it.hidden = !(k === 0 || it.dataset.type === t); });
        });
      });
    }
  });
})(window.FX);

/* Pack 19 — États et interfaces d'IA */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Un agent parcourt un graphe d'étapes, nœud après nœud
  FX.register('agent-graph', {
    entrance: true,
    setup: function (el) {
      var names = (el.dataset.fxSteps || 'Lire|Chercher|Écrire|Vérifier').split('|');
      el.setAttribute('role', 'list');
      el._fxN = names.map(function (n, i) {
        var d = U.make('span', 'fx-ag', el);
        d.setAttribute('role', 'listitem');
        d.textContent = n;
        d.style.setProperty('--fx-i', i);
        return d;
      });
    },
    reset: function (el) { el._fxRun2 = (el._fxRun2 || 0) + 1; el._fxN.forEach(function (d) { d.classList.remove('fx-on', 'fx-ok'); }); },
    enter: function (el) {
      var run = el._fxRun2 = (el._fxRun2 || 0) + 1, i = 0, step = U.num(el, 'fxStep', 800);
      if (U.reduced) { el._fxN.forEach(function (d) { d.classList.add('fx-ok'); }); return; }
      (function next() {
        if (run !== el._fxRun2) return;
        if (i) { el._fxN[i - 1].classList.remove('fx-on'); el._fxN[i - 1].classList.add('fx-ok'); }
        if (i >= el._fxN.length) { el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true })); return; }
        el._fxN[i++].classList.add('fx-on');
        setTimeout(next, step);
      })();
    }
  });

  // Une onde vocale qui réagit quand l'assistant écoute
  FX.register('voice-wave', {
    setup: function (el) {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', el.getAttribute('aria-label') || "L'assistant écoute");
      el._fxB = [];
      for (var i = 0; i < U.num(el, 'fxBars', 13); i++) el._fxB.push(U.make('i', '', el));
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var level = typeof el.fxLevel === 'number' ? el.fxLevel : .5 + .5 * Math.sin(t * .0023) * Math.sin(t * .0007);
      var n = el._fxB.length;
      el._fxB.forEach(function (b, i) {
        var env = Math.sin((i + .5) / n * 3.14);
        var v = .12 + env * level * (.5 + .5 * Math.sin(t * .012 + i * 1.3));
        b.style.transform = 'scaleY(' + v.toFixed(3) + ')';
      });
    }
  });

  // Des sources numérotées s'ouvrent dans le texte d'une réponse
  FX.register('citation-pop', {
    setup: function (el) {
      el.querySelectorAll('[data-source]').forEach(function (c, i) {
        var n = i + 1, a = document.createElement('a');
        a.className = 'fx-cite';
        a.href = c.getAttribute('href') || '#';
        a.textContent = n;
        a.setAttribute('aria-label', 'Source ' + n + ' : ' + c.dataset.source);
        var tip = U.make('span', 'fx-cite-tip', a);
        tip.textContent = c.dataset.source;
        tip.setAttribute('aria-hidden', 'true');
        a.style.setProperty('--fx-i', i);
        c.replaceWith(a);
      });
    }
  });

  // Une petite barre dit à quel point la réponse est sûre
  FX.register('confidence-meter', {
    entrance: true,
    setup: function (el) {
      var v = U.clamp(U.num(el, 'fxValue', 72), 0, 100);
      var lvl = v >= 75 ? 'Élevée' : v >= 40 ? 'Moyenne' : 'Faible';
      el.classList.add('fx-lvl-' + (v >= 75 ? 'h' : v >= 40 ? 'm' : 'l'));
      el.setAttribute('role', 'meter');
      el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', 100);
      el.setAttribute('aria-label', 'Confiance');
      el.innerHTML = '<span>Confiance : ' + lvl + '</span><i><b></b></i>';
      el.style.setProperty('--fx-v', v / 100);
    }
  });

  // Un texte montre ce qui a été retiré puis ajouté
  FX.register('diff-reveal', {
    entrance: true,
    setup: function (el) {
      el.querySelectorAll('del,ins').forEach(function (d, i) { d.style.setProperty('--fx-i', i); });
    }
  });

  // De petites étiquettes montrent ce que l'assistant est en train de lire
  FX.register('context-chips', {
    entrance: true,
    setup: function (el) {
      el._fxList = (el.dataset.fxItems || 'rapport.pdf|notes.md|budget.xlsx').split('|');
      el.setAttribute('aria-live', 'polite');
    },
    reset: function (el) { el._fxK = (el._fxK || 0) + 1; el.textContent = ''; },
    enter: function (el) {
      var run = el._fxK = (el._fxK || 0) + 1, i = 0;
      el.textContent = '';
      (function add() {
        if (run !== el._fxK || i >= el._fxList.length) return;
        var s = U.make('span', 'fx-cc', el);
        s.textContent = el._fxList[i++];
        if (U.reduced) add(); else setTimeout(add, U.num(el, 'fxStep', 500));
      })();
    }
  });

  // Le squelette de chargement se fond dans le vrai contenu
  FX.register('skeleton-morph', {
    entrance: true,
    setup: function (el) {
      el.setAttribute('aria-busy', 'true');
      el._fxDone = function () { el.classList.add('fx-ready'); el.setAttribute('aria-busy', 'false'); };
    },
    reset: function (el) { clearTimeout(el._fxTo); el.classList.remove('fx-ready'); el.setAttribute('aria-busy', 'true'); },
    enter: function (el) { el._fxTo = setTimeout(el._fxDone, U.num(el, 'fxWait', 1500)); }
  });

  // Du code s'écrit tout seul, avec une coloration simple
  FX.register('streaming-code', {
    entrance: true,
    setup: function (el) {
      el._fxSrc = el.textContent.replace(/^\n/, '');
      el.setAttribute('aria-label', el._fxSrc);
      if (!U.reduced) el.textContent = '';
    },
    reset: function (el) { el._fxS = (el._fxS || 0) + 1; el.textContent = ''; },
    enter: function (el) {
      var run = el._fxS = (el._fxS || 0) + 1, src = el._fxSrc, i = 0;
      var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      var hl = function (s) {
        return esc(s).replace(/(\/\/.*)|('[^']*'?|"[^"]*"?)|\b(function|const|let|var|return|if|else|for|await|async|import|from)\b/g, function (m, c, q, k) {
          return '<span class="' + (c ? 'c' : q ? 's' : 'k') + '">' + m + '</span>';
        });
      };
      if (U.reduced) { el.innerHTML = hl(src); return; }
      (function next() {
        if (run !== el._fxS) return;
        i = Math.min(src.length, i + 1 + Math.floor(Math.random() * 3));
        el.innerHTML = hl(src.slice(0, i)) + (i < src.length ? '<i class="fx-cur"></i>' : '');
        if (i < src.length) setTimeout(next, U.num(el, 'fxSpeed', 22));
        else el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true }));
      })();
    }
  });

  // Une file d'attente qui avance, avec la place restante
  FX.register('queue-position', {
    setup: function (el) {
      var start = U.num(el, 'fxStart', 6);
      el.setAttribute('role', 'status');
      el.innerHTML = '<div class="fx-q-row"></div><span></span>';
      var row = el.firstChild;
      for (var i = 0; i < start; i++) U.make('i', '', row);
      el._fxQ = { n: start - 1, t: 0, row: row, msg: el.lastChild };
      el._fxPaint = function () {
        var q = el._fxQ;
        Array.prototype.forEach.call(row.children, function (d, i) { d.classList.toggle('fx-me', i === q.n); d.classList.toggle('fx-gone', i > q.n); });
        q.msg.textContent = q.n > 0 ? q.n + (q.n > 1 ? ' personnes devant vous' : ' personne devant vous') : "C'est à vous !";
      };
      el._fxPaint();
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      var q = el._fxQ;
      q.t += dt;
      if (q.t < U.num(el, 'fxEvery', 1.4)) return;
      q.t = 0;
      if (q.n > 0) {
        q.n--;
        el._fxPaint();
        if (!q.n) el.dispatchEvent(new CustomEvent('fx:ready', { bubbles: true }));
      } else if (el.dataset.fxLoop === 'true') { q.n = q.row.children.length - 1; el._fxPaint(); }
    }
  });

  // Un champ refuse avec une secousse et explique pourquoi
  FX.register('error-glitch-shake', {
    trigger: function (el, e) {
      var msg = el.dataset.fxError || 'Cette valeur ne convient pas.', box = el.querySelector('.fx-eg-msg');
      if (!box) { box = U.make('span', 'fx-eg-msg', el); box.setAttribute('role', 'alert'); }
      box.textContent = msg;
      var input = el.querySelector('input,textarea,select');
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus({ preventScroll: true }); }
      el.classList.remove('fx-err'); void el.offsetWidth; el.classList.add('fx-err');
    },
    setup: function (el) {
      var input = el.querySelector('input,textarea,select');
      if (input) input.addEventListener('input', function () { el.classList.remove('fx-err'); input.removeAttribute('aria-invalid'); var b = el.querySelector('.fx-eg-msg'); if (b) b.textContent = ''; });
    }
  });

  // Un tampon « Validé » s'écrase sur l'élément
  FX.register('success-stamp', {
    setup: function (el) {
      U.ensurePositioned(el);
      var s = el._fxS = U.make('span', 'fx-stamp', el);
      s.textContent = el.dataset.fxStamp || 'Validé';
      s.setAttribute('role', 'status');
      s.style.setProperty('--fx-r', U.rand(-14, -6).toFixed(1) + 'deg');
      if (el.dataset.fxAuto === 'true') FX.trigger(el);
    },
    triggerOn: 'fx:ok',
    trigger: function (el) { el._fxS.classList.remove('fx-on'); void el._fxS.offsetWidth; el._fxS.classList.add('fx-on'); el.classList.add('fx-stamped'); setTimeout(function () { el.classList.remove('fx-stamped'); }, 260); }
  });

  // Faire glisser pour confirmer une action
  FX.register('unlock-slide', {
    setup: function (el) {
      var label = el.dataset.fxLabel || 'Glisser pour confirmer';
      el.innerHTML = '<span class="fx-us-t"></span><button type="button" aria-label="' + label + '">→</button>';
      el.firstChild.textContent = label;
      var b = el.lastChild, sx = 0, x = 0, drag = false;
      var max = function () { return el.clientWidth - b.offsetWidth - 8; };
      var pos = function (v) { x = v; el.style.setProperty('--fx-x', v + 'px'); el.style.setProperty('--fx-p', max() ? (v / max()).toFixed(3) : 0); };
      var done = function () {
        el.classList.add('fx-done');
        el.firstChild.textContent = el.dataset.fxDone || 'Confirmé';
        pos(max());
        el.dispatchEvent(new CustomEvent('fx:unlock', { bubbles: true }));
      };
      b.addEventListener('pointerdown', function (e) { if (el.classList.contains('fx-done')) return; drag = true; sx = e.clientX - x; el.classList.add('fx-drag'); if (e.isTrusted) b.setPointerCapture(e.pointerId); });
      b.addEventListener('pointermove', function (e) { if (drag) pos(U.clamp(e.clientX - sx, 0, max())); });
      b.addEventListener('pointerup', function () { if (!drag) return; drag = false; el.classList.remove('fx-drag'); if (x > max() * .86) done(); else pos(0); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); } });
    }
  });

  // Une zone de dépôt qui réagit à l'arrivée de fichiers
  FX.register('upload-drop', {
    setup: function (el) {
      var input = el.querySelector('input[type="file"]');
      var list = U.make('ul', 'fx-ud-list', el);
      var take = function (files) {
        Array.prototype.forEach.call(files, function (f) { var li = U.make('li', '', list); li.textContent = f.name; });
        el.dispatchEvent(new CustomEvent('fx:files', { bubbles: true, detail: { files: files } }));
      };
      ['dragenter', 'dragover'].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); el.classList.add('fx-over'); }); });
      ['dragleave', 'drop'].forEach(function (n) { el.addEventListener(n, function (e) { e.preventDefault(); el.classList.remove('fx-over'); }); });
      el.addEventListener('drop', function (e) { if (e.dataTransfer) take(e.dataTransfer.files); });
      if (input) input.addEventListener('change', function () { take(input.files); });
    }
  });

  // Un bandeau descend quand la connexion se perd
  FX.register('offline-banner', {
    setup: function (el) {
      el.setAttribute('role', 'status');
      var off = el.dataset.fxOff || 'Vous êtes hors ligne. Vos changements seront envoyés au retour.', on = el.dataset.fxOn || 'De nouveau en ligne.', to;
      var sync = function (state) {
        clearTimeout(to);
        el.textContent = state ? on : off;
        el.classList.add('fx-show');
        el.classList.toggle('fx-ok', state);
        if (state) to = setTimeout(function () { el.classList.remove('fx-show'); }, 2500);
      };
      window.addEventListener('offline', function () { sync(false); });
      window.addEventListener('online', function () { sync(true); });
      if (!navigator.onLine) sync(false);
      el._fxSync = sync; el._fxState = false;
    },
    trigger: function (el) { el._fxSync(el._fxState); el._fxState = !el._fxState; }
  });

  // Une pile qui se remplit et signale un niveau faible
  FX.register('battery-level', {
    entrance: true,
    setup: function (el) {
      var v = U.clamp(U.num(el, 'fxValue', 68), 0, 100);
      el.setAttribute('role', 'meter');
      el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', 100);
      el.setAttribute('aria-label', 'Niveau');
      el.innerHTML = '<i></i><b>' + v + ' %</b>';
      el.style.setProperty('--fx-v', v / 100);
      el.classList.toggle('fx-low', v < U.num(el, 'fxLow', 20));
      el.classList.toggle('fx-charge', el.dataset.fxCharging === 'true');
    }
  });

  // « Noa est en train d'écrire… », avec l'accord selon le nombre
  FX.register('typing-indicator-name', {
    setup: function (el) {
      el.setAttribute('role', 'status');
      el._fxSet = function (names) {
        var t = !names.length ? '' : names.length === 1 ? names[0] + " est en train d'écrire" : names.length === 2 ? names[0] + ' et ' + names[1] + " sont en train d'écrire" : names.length + " personnes sont en train d'écrire";
        el.innerHTML = t ? '<span></span><i></i><i></i><i></i>' : '';
        if (t) el.firstChild.textContent = t;
      };
      el._fxSet((el.dataset.fxNames || 'Noa').split('|').filter(Boolean));
      el._fxI = 0;
    },
    trigger: function (el) {
      var seq = [['Noa'], ['Noa', 'Sam'], ['Noa', 'Sam', 'Lou'], []];
      el._fxSet(seq[el._fxI++ % seq.length]);
    }
  });

  // Une pastille discrète indique l'enregistrement automatique
  FX.register('save-pill', {
    setup: function (el) {
      el.setAttribute('role', 'status');
      el._fxSt = function (s) {
        var msg = { saving: 'Enregistrement…', saved: 'Enregistré', error: 'Échec, nouvel essai…', idle: '' };
        el.dataset.fxState = s;
        el.textContent = msg[s];
      };
      el._fxSt('idle');
      el._fxC = 0;
    },
    trigger: function (el) {
      clearTimeout(el._fxTo);
      el._fxSt('saving');
      var fail = el.dataset.fxDemo && ++el._fxC % 3 === 0;
      el._fxTo = setTimeout(function () {
        el._fxSt(fail ? 'error' : 'saved');
        el._fxTo = setTimeout(function () { el._fxSt(fail ? 'saving' : 'idle'); if (fail) el._fxTo = setTimeout(function () { el._fxSt('saved'); }, 700); }, 1500);
      }, 800);
    },
    tick: function (el, dt) {
      if (!el.dataset.fxDemo || U.reduced) return;
      el._fxW = (el._fxW || 3) + dt;
      if (el._fxW > 3.6) { el._fxW = 0; FX.trigger(el); }
    }
  });

  // Une illustration flotte doucement quand il n'y a rien à afficher
  FX.register('empty-state-float', {
    setup: function (el) {
      var s = el._fxS = { x: 0, y: 0, tx: 0, ty: 0 };
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        s.tx = ((e.clientX - r.left) / r.width - .5) * 12;
        s.ty = ((e.clientY - r.top) / r.height - .5) * 12;
      });
      el.addEventListener('pointerleave', function () { s.tx = s.ty = 0; });
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var s = el._fxS;
      s.x = U.lerp(s.x, s.tx, .06); s.y = U.lerp(s.y, s.ty, .06);
      el.style.setProperty('--fx-x', s.x.toFixed(1) + 'px');
      el.style.setProperty('--fx-y', (s.y + Math.sin(t * .0016) * 6).toFixed(1) + 'px');
      el.style.setProperty('--fx-shadow', (1 - (Math.sin(t * .0016) + 1) * .12).toFixed(3));
    }
  });

  // Plusieurs tâches avancent, chacune à son rythme
  FX.register('multi-file-progress', {
    setup: function (el) {
      var names = (el.dataset.fxItems || 'photos.zip|contrat.pdf|notes.md').split('|');
      el._fxRows = names.map(function (n) {
        var r = U.make('div', 'fx-mf', el);
        r.innerHTML = '<span></span><i role="progressbar" aria-valuemin="0" aria-valuemax="100"><b></b></i><em></em>';
        r.firstChild.textContent = n;
        r.children[1].setAttribute('aria-label', n);
        return { el: r, p: 0, s: U.rand(.1, .4) };
      });
      el._fxSet = function (i, v) {
        var r = el._fxRows[i];
        r.p = U.clamp(v, 0, 1);
        r.el.style.setProperty('--fx-v', r.p);
        r.el.children[1].setAttribute('aria-valuenow', Math.round(r.p * 100));
        r.el.lastChild.textContent = r.p >= 1 ? '✓' : Math.round(r.p * 100) + ' %';
        r.el.classList.toggle('fx-ok', r.p >= 1);
      };
      el._fxRows.forEach(function (r, i) { el._fxSet(i, 0); });
      el._fxWait = 0;
    },
    tick: function (el, dt) {
      if (U.reduced || el.dataset.fxManual === 'true') return;
      var all = true;
      el._fxRows.forEach(function (r, i) { if (r.p < 1) { all = false; el._fxSet(i, r.p + r.s * dt); } });
      if (all && (el._fxWait += dt) > 2) { el._fxWait = 0; el._fxRows.forEach(function (r, i) { el._fxSet(i, 0); }); }
    }
  });

  // Des notifications s'empilent et se serrent
  FX.register('notification-stack', {
    setup: function (el) {
      el.setAttribute('role', 'log');
      el.setAttribute('aria-live', 'polite');
      el._fxPush = function (text) {
        var n = U.make('div', 'fx-ns', el);
        n.textContent = text;
        var x = U.make('button', '', n);
        x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Fermer');
        var bye = function () { n.classList.add('fx-out'); setTimeout(function () { n.remove(); order(); }, 280); };
        x.addEventListener('click', bye);
        setTimeout(bye, U.num(el, 'fxLife', 4500));
        order();
      };
      var order = function () {
        var k = el.children, max = U.num(el, 'fxMax', 3);
        for (var i = 0; i < k.length; i++) { var d = k.length - 1 - i; k[i].style.setProperty('--fx-d', d); k[i].classList.toggle('fx-hide', d >= max); }
      };
      el._fxN = 0;
    },
    trigger: function (el) {
      var msgs = ['Fichier enregistré', 'Nouvelle réponse', 'Export terminé', 'Rappel dans 5 minutes'];
      el._fxPush(msgs[el._fxN++ % msgs.length]);
    },
    tick: function (el, dt) {
      if (el.dataset.fxDemo !== 'true' || U.reduced) return;
      el._fxT = (el._fxT || 1.2) + dt;
      if (el._fxT > 1.4) { el._fxT = 0; FX.trigger(el); }
    }
  });

  // Des suggestions qui remplissent le champ d'une IA
  FX.register('prompt-suggestions', {
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (b, i) {
        b.style.setProperty('--fx-i', i);
        b.addEventListener('click', function () {
          var target = el.dataset.fxTarget && document.querySelector(el.dataset.fxTarget);
          var text = b.dataset.prompt || b.textContent.trim();
          if (target) { target.value = text; target.focus(); target.dispatchEvent(new Event('input', { bubbles: true })); }
          el.dispatchEvent(new CustomEvent('fx:pick', { bubbles: true, detail: { text: text } }));
        });
      });
    }
  });

  // Un sélecteur compact pour choisir un mode ou un modèle
  FX.register('model-switcher', {
    setup: function (el) {
      var opts = (el.dataset.fxOptions || 'Rapide|Équilibré|Précis').split('|'), cur = 0;
      el.innerHTML = '<button type="button" aria-haspopup="listbox" aria-expanded="false"></button><ul role="listbox" tabindex="-1"></ul>';
      var btn = el.firstChild, ul = el.lastChild;
      opts.forEach(function (o, i) { var li = U.make('li', '', ul); li.textContent = o; li.setAttribute('role', 'option'); li.style.setProperty('--fx-i', i); li.addEventListener('click', function () { pick(i); }); });
      var pick = function (i) {
        cur = i;
        btn.textContent = opts[i];
        Array.prototype.forEach.call(ul.children, function (l, k) { l.setAttribute('aria-selected', k === i); });
        set(false);
        el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { value: opts[i] } }));
      };
      var set = function (on) { el.classList.toggle('fx-open', on); btn.setAttribute('aria-expanded', on); };
      btn.addEventListener('click', function () { set(!el.classList.contains('fx-open')); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { set(false); btn.focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); set(true); pick((cur + 1) % opts.length); set(true); }
        if (e.key === 'ArrowUp') { e.preventDefault(); set(true); pick((cur - 1 + opts.length) % opts.length); set(true); }
      });
      document.addEventListener('pointerdown', function (e) { if (!el.contains(e.target)) set(false); });
      pick(0);
    }
  });
})(window.FX);

/* Pack 20 — Nouvelles entrées */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Les enfants arrivent selon leur position réelle à l'écran
  FX.register('cascade-rows', {
    entrance: true,
    setup: function (el) {
      var tops = [];
      Array.prototype.forEach.call(el.children, function (c) { if (tops.indexOf(c.offsetTop) < 0) tops.push(c.offsetTop); });
      Array.prototype.forEach.call(el.children, function (c) { c.style.setProperty('--fx-rw', tops.indexOf(c.offsetTop)); });
    }
  });

  // Un projecteur balaye l'élément puis l'éclaire en entier
  FX.register('spotlight-in', {
    entrance: true,
    setup: function (el) { el.style.setProperty('--fx-r', '0%'); },
    reset: function (el) { el.style.setProperty('--fx-r', '0%'); },
    enter: function (el) {
      U.tween(el, U.num(el, 'fxDuration', 1400), function (p) {
        var e = U.easeInOut(p);
        el.style.setProperty('--fx-x', (15 + Math.sin(e * 3.14) * 70).toFixed(1) + '%');
        el.style.setProperty('--fx-y', (30 + e * 20).toFixed(1) + '%');
        el.style.setProperty('--fx-r', (10 + e * e * 130).toFixed(1) + '%');
      });
    }
  });

  // Les lignes glissent de chaque côté et se calent sur la marge
  FX.register('typeset-lines', {
    entrance: true,
    setup: function (el) {
      var run = function () { U.splitLines(el); el.querySelectorAll('.fx-line > span').forEach(function (s, i) { s.style.setProperty('--fx-dir', i % 2 ? 1 : -1); }); };
      run();
      U.onResize(run);
    }
  });

  // Les cases rebondissent en onde depuis le centre
  FX.register('bounce-grid', {
    entrance: true,
    setup: function (el) {
      var b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      Array.prototype.forEach.call(el.children, function (c) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--fx-d', (Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) * 1.6).toFixed(0) + 'ms');
      });
    }
  });

  // Un cadre s'ouvre vers le haut, et l'image se pose en même temps
  FX.register('mask-rise-image', {
    entrance: true,
    setup: function (el) { if (!el.firstElementChild) U.make('div', '', el); el.firstElementChild.classList.add('fx-mri'); }
  });

  // Des panneaux se déplient comme un paravent
  FX.register('accordion-unfold', {
    entrance: true,
    setup: function (el) { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-i', i); c.classList.add(i % 2 ? 'fx-odd' : 'fx-even'); }); }
  });

  // Les mots sortent du flou l'un après l'autre
  FX.register('blur-words', { entrance: true, setup: function (el) { U.splitWords(el); } });

  // Des cartes sont distribuées depuis un même point
  FX.register('card-deal', {
    entrance: true,
    setup: function (el) {
      var b = el.getBoundingClientRect();
      Array.prototype.forEach.call(el.children, function (c, i) {
        var r = c.getBoundingClientRect();
        c.style.setProperty('--fx-dx', (b.left + b.width / 2 - r.left - r.width / 2).toFixed(0) + 'px');
        c.style.setProperty('--fx-dy', (b.top + b.height + 40 - r.top).toFixed(0) + 'px');
        c.style.setProperty('--fx-r', U.rand(-22, 22).toFixed(0) + 'deg');
        c.style.setProperty('--fx-i', i);
      });
    }
  });

  // Des bandes s'ouvrent comme un obturateur sur l'élément
  FX.register('shutter-text', {
    entrance: true,
    setup: function (el) {
      U.ensurePositioned(el);
      var b = U.make('span', 'fx-sht', el), n = U.num(el, 'fxBands', 6);
      b.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < n; i++) U.make('i', '', b).style.setProperty('--fx-i', i);
    }
  });

  // Un cadre se dessine autour du contenu, puis le contenu apparaît
  FX.register('line-draw-box', {
    entrance: true,
    setup: function (el) {
      U.ensurePositioned(el);
      var host = U.make('span', 'fx-ldb', el);
      host.setAttribute('aria-hidden', 'true');
      host.innerHTML = '<svg><rect pathLength="1" x="1" y="1"/></svg>';
      var fit = function () {
        var r = host.querySelector('rect');
        r.setAttribute('width', Math.max(0, el.offsetWidth - 2));
        r.setAttribute('height', Math.max(0, el.offsetHeight - 2));
        r.setAttribute('rx', U.num(el, 'fxRadius', 10));
      };
      fit();
      U.onResize(fit);
    }
  });

  // Une rangée s'ouvre depuis son centre
  FX.register('stagger-scale-row', {
    entrance: true,
    setup: function (el) {
      var n = el.children.length;
      Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-o', Math.abs(i - (n - 1) / 2).toFixed(1)); });
    }
  });

  // L'image apparaît à travers un grain de pellicule
  FX.register('grain-fade', {
    entrance: true,
    setup: function (el) {
      if (!FX._fxGrainUrl) {
        var c = document.createElement('canvas');
        c.width = c.height = 128;
        var x = c.getContext('2d'), im = x.createImageData(128, 128);
        for (var i = 0; i < im.data.length; i += 4) { im.data[i + 3] = Math.random() * 255; }
        x.putImageData(im, 0, 0);
        FX._fxGrainUrl = 'url(' + c.toDataURL() + ')';
      }
      el.style.setProperty('--fx-noise', FX._fxGrainUrl);
    }
  });

  // Les tuiles pivotent d'un quart de tour pour se ranger
  FX.register('rotate-tile-in', {
    entrance: true,
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (c, i) {
        c.style.setProperty('--fx-r', [90, 180, 270, -90][Math.floor(Math.random() * 4)] + 'deg');
        c.style.setProperty('--fx-i', i);
      });
    }
  });

  // Une ligne se dessine, puis le contenu se lève derrière elle
  FX.register('horizon-rise', {
    entrance: true,
    setup: function (el) {
      var w = document.createElement('span');
      w.className = 'fx-hr-in';
      while (el.firstChild) w.appendChild(el.firstChild);
      el.appendChild(w);
      U.make('i', 'fx-hr', el).setAttribute('aria-hidden', 'true');
    }
  });

  // Plusieurs copies d'un grand numéro se rassemblent
  FX.register('number-stack-in', {
    entrance: true,
    setup: function (el) {
      var t = el.textContent.trim(), n = 4;
      el.textContent = '';
      el.setAttribute('aria-label', t);
      for (var i = n; i >= 0; i--) {
        var s = U.make('span', i ? 'fx-ns-c' : 'fx-ns-t', el);
        s.textContent = t;
        s.setAttribute('aria-hidden', 'true');
        s.style.setProperty('--fx-i', i);
      }
    }
  });

  // Des filets se dessinent et les lignes de la liste arrivent
  FX.register('list-strike-in', {
    entrance: true,
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (c, i) {
        c.style.setProperty('--fx-i', i);
        U.ensurePositioned(c);
        U.make('i', 'fx-lsi', c).setAttribute('aria-hidden', 'true');
      });
    }
  });

  // Les éléments arrivent du fond et deviennent nets
  FX.register('depth-focus-in', {
    entrance: true,
    setup: function (el) { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-i', i); }); }
  });

  // Un surligneur traverse chaque ligne l'une après l'autre
  FX.register('marker-swipe-in', {
    entrance: true,
    setup: function (el) { var r = function () { U.splitLines(el); }; r(); U.onResize(r); }
  });

  // Des colonnes se déroulent de haut en bas l'une après l'autre
  FX.register('wipe-columns-in', {
    entrance: true,
    setup: function (el) {
      var k = el.children, step = Math.min(160, 700 / Math.max(1, k.length));
      Array.prototype.forEach.call(k, function (c, i) { c.style.setProperty('--fx-d', (i * step).toFixed(0) + 'ms'); });
    }
  });

  // L'élément s'allume comme un tube néon
  FX.register('glow-on', {
    entrance: true,
    reset: function (el) { el.style.setProperty('--fx-g', 0); },
    setup: function (el) { el.style.setProperty('--fx-g', 0); },
    enter: function (el) {
      var seq = [0, .9, .1, .1, 1, .2, 1, 1], t0 = null;
      if (U.reduced) { el.style.setProperty('--fx-g', 1); return; }
      U.tween(el, U.num(el, 'fxDuration', 700), function (p) { el.style.setProperty('--fx-g', seq[Math.min(seq.length - 1, Math.floor(p * seq.length))]); }, function () { el.style.setProperty('--fx-g', 1); });
    }
  });

  // Chaque mot monte de derrière sa ligne
  FX.register('curtain-words', {
    entrance: true,
    setup: function (el) {
      U.splitWords(el);
      el.querySelectorAll('.fx-word').forEach(function (w) {
        var i = document.createElement('span');
        i.className = 'fx-cw';
        i.textContent = w.textContent;
        w.textContent = '';
        w.appendChild(i);
      });
    }
  });

  // Les cases se retournent dans le désordre et révèlent le tableau
  FX.register('flip-board-in', {
    entrance: true,
    setup: function (el) {
      var k = Array.prototype.slice.call(el.children), o = k.map(function (_, i) { return i; }).sort(function () { return Math.random() - .5; });
      k.forEach(function (c, i) { c.style.setProperty('--fx-o', o[i]); });
    }
  });

  // L'élément arrive étiré, s'écrase et rebondit
  FX.register('rubber-in', {
    entrance: true,
    setup: function (el) { el.style.setProperty('--fx-delay', U.num(el, 'fxDelay', 0) + 'ms'); }
  });

  // Les éléments rejoignent leur place par une trajectoire courbe
  FX.register('path-follow-in', {
    entrance: true,
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (c, i) {
        var x = U.rand(-160, 160), y = U.rand(60, 140), cx = x * U.rand(-.6, .6), cy = y + U.rand(40, 90);
        c.style.setProperty('--fx-path', 'path("M ' + x.toFixed(0) + ' ' + y.toFixed(0) + ' Q ' + cx.toFixed(0) + ' ' + cy.toFixed(0) + ' 0 0")');
        c.style.setProperty('--fx-i', i);
      });
    }
  });

  // Toute une page apparaît doucement, de haut en bas
  FX.register('soft-page-in', {
    entrance: true,
    setup: function (el) { Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--fx-d', Math.min(i * 90, 450) + 'ms'); }); }
  });

  // Le mot arrive en tranches verticales décalées
  FX.register('slice-column-text', {
    entrance: true,
    setup: function (el) {
      var t = el.textContent.trim(), n = U.num(el, 'fxSlices', 7);
      el.setAttribute('aria-label', t);
      el.textContent = '';
      for (var i = 0; i < n; i++) {
        var s = U.make('span', '', el);
        s.setAttribute('aria-hidden', 'true');
        s.textContent = t;
        s.style.clipPath = 'inset(0 ' + (100 - (i + 1) * 100 / n).toFixed(2) + '% 0 ' + (i * 100 / n).toFixed(2) + '%)';
        s.style.setProperty('--fx-dy', (i % 2 ? 1 : -1) * U.rand(50, 120) + '%');
        s.style.setProperty('--fx-i', i);
      }
    }
  });

  // Un titre arrive et lance quelques éclats autour de lui
  FX.register('pop-confetti-title', {
    entrance: true,
    reset: function (el) { el.querySelectorAll('.fx-pct').forEach(function (i) { i.remove(); }); },
    enter: function (el) {
      if (U.reduced) return;
      U.ensurePositioned(el);
      for (var k = 0; k < U.num(el, 'fxBits', 16); k++) {
        var b = U.make('i', 'fx-pct', el), a = Math.random() * 6.283, d = U.rand(40, 110);
        b.setAttribute('aria-hidden', 'true');
        b.style.setProperty('--fx-x', (Math.cos(a) * d).toFixed(0) + 'px');
        b.style.setProperty('--fx-y', (Math.sin(a) * d * .7).toFixed(0) + 'px');
        b.style.setProperty('--fx-r', U.rand(-180, 180).toFixed(0) + 'deg');
        b.style.background = ['var(--fx-accent)', 'var(--fx-accent-2)', 'currentColor'][k % 3];
        setTimeout(function (n) { n.remove(); }.bind(null, b), 1100);
      }
    }
  });
})(window.FX);

/* Pack 21 — Détails éditoriaux */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Une lettrine entre en grand et le texte se place autour d'elle
  FX.register('drop-cap-draw', {
    entrance: true,
    setup: function (el) {
      var t = el.textContent.trim();
      el.setAttribute('aria-label', t);
      el.textContent = '';
      var c = U.make('span', 'fx-dc', el);
      c.textContent = t.charAt(0);
      c.setAttribute('aria-hidden', 'true');
      var r = U.make('span', 'fx-dc-r', el);
      r.textContent = t.slice(1);
      r.setAttribute('aria-hidden', 'true');
    }
  });

  // Une note en marge s'éclaire quand on survole sa référence
  FX.register('margin-note', {
    setup: function (el) {
      var refs = el.querySelectorAll('[data-note]');
      refs.forEach(function (r, i) {
        r.classList.add('fx-mn-ref');
        r.tabIndex = 0;
        var n = document.createElement('small');
        n.className = 'fx-mn';
        n.textContent = (i + 1) + '. ' + r.dataset.note;
        r.appendChild(n);
        r.style.setProperty('--fx-n', '"' + (i + 1) + '"');
      });
    }
  });

  // Une grande citation monte, précédée de ses guillemets
  FX.register('pull-quote-rise', {
    entrance: true,
    setup: function (el) {
      var r = function () { U.splitLines(el); };
      r();
      U.onResize(r);
    }
  });

  // Un petit bandeau indique le temps de lecture restant
  FX.register('reading-time-bar', {
    setup: function (el) {
      var target = document.querySelector(el.dataset.fxTarget || 'article');
      var words = target ? target.textContent.trim().split(/\s+/).length : U.num(el, 'fxWords', 1200);
      el._fxMin = Math.max(1, Math.ceil(words / U.num(el, 'fxWpm', 220)));
      el._fxT = target;
      el.setAttribute('role', 'status');
      el.innerHTML = '<span></span><i></i>';
    },
    scroll: function (el, info) {
      var p = info.pass;
      if (el._fxT) { var r = el._fxT.getBoundingClientRect(); p = U.clamp(-r.top / Math.max(1, r.height - info.vh), 0, 1); }
      var m = Math.ceil(el._fxMin * (1 - p));
      if (m !== el._fxLast) { el._fxLast = m; el.firstChild.textContent = m > 0 ? m + ' min restante' + (m > 1 ? 's' : '') : 'Lecture terminée'; }
      el.style.setProperty('--fx-p', p.toFixed(3));
    }
  });

  // Autour du curseur, les mots sont nets et le reste s'estompe
  FX.register('kerning-focus', {
    setup: function (el) {
      U.splitWords(el);
      var ws = el.querySelectorAll('.fx-word');
      el.addEventListener('pointermove', function (e) {
        ws.forEach(function (w) {
          var r = w.getBoundingClientRect();
          var d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
          w.style.setProperty('--fx-k', U.clamp(1 - d / U.num(el, 'fxRadius', 130), .12, 1).toFixed(2));
        });
      });
      el.addEventListener('pointerleave', function () { ws.forEach(function (w) { w.style.removeProperty('--fx-k'); }); });
    }
  });

  // Un bandeau d'informations qu'on peut mettre en pause
  FX.register('news-ticker-pause', {
    setup: function (el) {
      var items = Array.prototype.slice.call(el.children);
      var track = document.createElement('div');
      track.className = 'fx-nt';
      items.forEach(function (i) { track.appendChild(i); });
      el.appendChild(track);
      items.forEach(function (i) { var c = i.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; }); track.appendChild(c); });
      var b = U.make('button', 'fx-nt-b', el);
      b.type = 'button';
      var set = function (p) { el.classList.toggle('fx-paused', p); b.textContent = p ? '▶' : '❚❚'; b.setAttribute('aria-label', p ? 'Reprendre' : 'Mettre en pause'); };
      set(U.reduced);
      b.addEventListener('click', function () { set(!el.classList.contains('fx-paused')); });
      el.style.setProperty('--fx-t', (track.scrollWidth / 2 / U.num(el, 'fxSpeed', 50)).toFixed(1) + 's');
    }
  });

  // Une phrase bascule entre deux langues, lettre par lettre
  FX.register('bilingual-toggle', {
    setup: function (el) {
      var a = el.textContent.trim(), b = el.dataset.fxOther || a, cur = a, lang = false;
      el.setAttribute('aria-label', a);
      var morph = function (to) {
        var from = cur, n = Math.max(from.length, to.length);
        U.tween(el, U.num(el, 'fxDuration', 650), function (p) {
          var c = Math.floor(p * (n + 6)), s = '';
          for (var i = 0; i < n; i++) {
            if (i < c - 6) s += to.charAt(i);
            else if (i < c) s += to.charAt(i) && to.charAt(i) !== ' ' ? U.GLYPHS.charAt(Math.floor(Math.random() * U.GLYPHS.length)) : ' ';
            else s += from.charAt(i);
          }
          el.textContent = p >= 1 ? to : s;
        }, function () { cur = to; el.textContent = to; el.setAttribute('aria-label', to); });
      };
      el._fxFlip = function () { lang = !lang; morph(lang ? b : a); };
      el.addEventListener('click', el._fxFlip);
    },
    trigger: function (el) { el._fxFlip(); }
  });

  // Un champ d'écriture qui compte les mots jusqu'à un objectif
  FX.register('word-counter-goal', {
    setup: function (el) {
      var area = el.querySelector('textarea,[contenteditable]'), goal = U.num(el, 'fxGoal', 30);
      var out = U.make('div', 'fx-wc', el);
      out.setAttribute('aria-live', 'polite');
      var upd = function () {
        var t = area ? (area.value != null ? area.value : area.textContent) : '';
        var n = t.trim() ? t.trim().split(/\s+/).length : 0, ok = n >= goal;
        el.style.setProperty('--fx-q', Math.min(1, n / goal).toFixed(3));
        out.textContent = n + ' / ' + goal + ' mots';
        if (ok !== el._fxOk) { el._fxOk = ok; el.classList.toggle('fx-goal', ok); if (ok) el.dispatchEvent(new CustomEvent('fx:goal', { bubbles: true })); }
      };
      if (area) area.addEventListener('input', upd);
      upd();
    }
  });

  // Un spécimen de police qu'on règle en direct
  FX.register('typo-specimen', {
    setup: function (el) {
      var txt = el.textContent.trim() || 'Aa';
      el.innerHTML = '<div class="fx-ts-v" contenteditable="true" spellcheck="false" aria-label="Texte du spécimen"></div><label>Taille <input type="range" min="16" max="120" value="48"></label><label>Graisse <input type="range" min="100" max="900" step="100" value="500"></label>';
      var v = el.firstChild;
      v.textContent = txt;
      el.querySelectorAll('input').forEach(function (r, i) {
        var set = function () { v.style.setProperty(i ? '--fx-w' : '--fx-s', r.value + (i ? '' : 'px')); };
        r.addEventListener('input', set);
        set();
      });
    }
  });

  // Dans un titre fixe, un mot change avec la section
  FX.register('headline-replace-scroll', {
    setup: function (el) {
      el._fxSecs = Array.prototype.slice.call(document.querySelectorAll(el.dataset.fxTarget || '[data-word]'));
      el._fxWords = (el.dataset.fxWords || 'créer|tester|publier').split('|');
      el.setAttribute('aria-live', 'off');
      el.innerHTML = '<span class="fx-hr-w"></span>';
      el._fxBox = el.firstChild;
      el._fxI = -1;
    },
    scroll: function (el, info) {
      var i;
      if (el._fxSecs.length) {
        i = 0;
        el._fxSecs.forEach(function (s, k) { if (s.getBoundingClientRect().top < info.vh / 2) i = k; });
      } else i = Math.min(el._fxWords.length - 1, Math.floor(info.pass * el._fxWords.length));
      if (i === el._fxI) return;
      el._fxI = i;
      var w = el._fxSecs.length ? el._fxSecs[i].dataset.word : el._fxWords[i];
      var s = document.createElement('span');
      s.className = 'fx-hr-in';
      s.textContent = w;
      el._fxBox.textContent = '';
      el._fxBox.appendChild(s);
    }
  });

  // Des mots clés se surlignent l'un après l'autre dans le texte
  FX.register('highlight-terms-sweep', {
    entrance: true,
    setup: function (el) {
      var terms = (el.dataset.fxTerms || '').split('|').filter(Boolean);
      if (!terms.length) return;
      var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
      var re = new RegExp('(' + terms.map(esc).join('|') + ')', 'gi'), i = 0;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n) {
        if (!re.test(n.nodeValue)) return;
        re.lastIndex = 0;
        var f = document.createDocumentFragment(), parts = n.nodeValue.split(re);
        parts.forEach(function (p, k) {
          if (k % 2) { var m = document.createElement('mark'); m.textContent = p; m.style.setProperty('--fx-i', i++); f.appendChild(m); }
          else if (p) f.appendChild(document.createTextNode(p));
        });
        n.replaceWith(f);
      });
    }
  });

  // Une référence amène à sa note, qui rebondit pour se signaler
  FX.register('footnote-spring', {
    setup: function (el) {
      el.addEventListener('click', function (e) {
        var a = e.target.closest('a[href^="#"]');
        if (!a) return;
        var t = document.querySelector(a.getAttribute('href').length > 1 ? a.getAttribute('href') : null);
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: U.reduced ? 'auto' : 'smooth', block: 'center' });
        t.classList.remove('fx-fn'); void t.offsetWidth; t.classList.add('fx-fn');
        if (!t.hasAttribute('tabindex')) t.tabIndex = -1;
        t.focus({ preventScroll: true });
      });
    }
  });

  // Un autocollant se décolle un peu au survol
  FX.register('sticker-peel-hover', {
    setup: function (el) {
      el.style.setProperty('--fx-rot', U.rand(-8, 8).toFixed(1) + 'deg');
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-rx', (-(e.clientY - r.top) / r.height * 18 + 9).toFixed(1) + 'deg');
        el.style.setProperty('--fx-ry', ((e.clientX - r.left) / r.width * 22 - 11).toFixed(1) + 'deg');
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--fx-rx', '0deg'); el.style.setProperty('--fx-ry', '0deg'); });
    }
  });

  // Un soulignement ondulé se dessine sous le lien
  FX.register('underline-wave-draw', {
    setup: function (el) {
      var w = Math.max(60, Math.round(el.offsetWidth || 120)), d = 'M0 5', n = Math.round(w / 12);
      for (var i = 0; i < n; i++) d += ' q ' + (w / n / 2).toFixed(1) + ' ' + (i % 2 ? 7 : -7) + ' ' + (w / n).toFixed(1) + ' 0';
      var s = U.make('span', 'fx-uwd', el);
      s.setAttribute('aria-hidden', 'true');
      s.innerHTML = '<svg viewBox="0 0 ' + w + ' 10" preserveAspectRatio="none"><path pathLength="1" d="' + d + '"/></svg>';
    }
  });

  // Des réactions s'envolent quand on clique
  FX.register('emoji-burst', {
    triggerOn: 'click',
    trigger: function (el) {
      if (U.reduced) return;
      U.ensurePositioned(el);
      var list = (el.dataset.fxIcons || '♥|★|✦').split('|');
      for (var i = 0; i < U.num(el, 'fxCount', 6); i++) {
        var s = U.make('span', 'fx-eb', el);
        s.setAttribute('aria-hidden', 'true');
        s.textContent = list[Math.floor(Math.random() * list.length)];
        s.style.setProperty('--fx-x', U.rand(-50, 50).toFixed(0) + 'px');
        s.style.setProperty('--fx-y', U.rand(-120, -60).toFixed(0) + 'px');
        s.style.setProperty('--fx-r', U.rand(-40, 40).toFixed(0) + 'deg');
        s.style.animationDelay = i * 40 + 'ms';
        setTimeout(function (n) { n.remove(); }.bind(null, s), 1300);
      }
    }
  });

  // Une grille d'aiguilles s'oriente vers le curseur
  FX.register('cursor-compass', {
    setup: function (el) {
      var n = U.num(el, 'fxCount', 42);
      el.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < n; i++) U.make('i', '', el);
      var nodes = el.children;
      var look = function (x, y) {
        for (var k = 0; k < nodes.length; k++) {
          var r = nodes[k].getBoundingClientRect();
          nodes[k].style.transform = 'rotate(' + Math.atan2(y - r.top - r.height / 2, x - r.left - r.width / 2).toFixed(3) + 'rad)';
        }
      };
      if (!U.reduced) window.addEventListener('pointermove', function (e) {
        var b = el.getBoundingClientRect();
        if (b.bottom < -100 || b.top > innerHeight + 100) return;
        look(e.clientX, e.clientY);
      }, { passive: true });
      el._fxLook = look;
      el._fxA = 0;
    },
    tick: function (el, dt) {
      if (U.reduced || U.canHover) return;
      el._fxA += dt;
      var b = el.getBoundingClientRect();
      el._fxLook(b.left + b.width / 2 + Math.cos(el._fxA) * 100, b.top + b.height / 2 + Math.sin(el._fxA) * 100);
    }
  });

  // Un double appui sur l'image fait apparaître un cœur
  FX.register('double-click-like', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxBurst = function (x, y) {
        var h = U.make('span', 'fx-dcl', el);
        h.textContent = '♥';
        h.setAttribute('aria-hidden', 'true');
        h.style.left = x + 'px';
        h.style.top = y + 'px';
        h.style.setProperty('--fx-r', U.rand(-16, 16).toFixed(0) + 'deg');
        setTimeout(function () { h.remove(); }, 900);
        el.dispatchEvent(new CustomEvent('fx:like', { bubbles: true }));
      };
      el.addEventListener('dblclick', function (e) {
        var r = el.getBoundingClientRect();
        el._fxBurst(e.clientX - r.left, e.clientY - r.top);
      });
    },
    trigger: function (el) { el._fxBurst(el.offsetWidth / 2, el.offsetHeight / 2); }
  });

  // Un curseur dont la valeur suit dans une bulle
  FX.register('range-bubble', {
    setup: function (el) {
      var input = el.querySelector('input[type="range"]');
      if (!input) return;
      var b = U.make('output', 'fx-rb', el), unit = el.dataset.fxUnit || '';
      var upd = function () {
        var min = +input.min || 0, max = +input.max || 100, p = (input.value - min) / (max - min);
        el.style.setProperty('--fx-p', p.toFixed(3));
        b.textContent = input.value + unit;
      };
      input.addEventListener('input', upd);
      input.addEventListener('pointerdown', function () { el.classList.add('fx-on'); });
      input.addEventListener('focus', function () { el.classList.add('fx-on'); });
      input.addEventListener('blur', function () { el.classList.remove('fx-on'); });
      window.addEventListener('pointerup', function () { if (document.activeElement !== input) el.classList.remove('fx-on'); });
      upd();
    }
  });

  // Une info-bulle riche suit le curseur sans quitter l'écran
  FX.register('rich-tooltip-follow', {
    setup: function (el) {
      var tip = U.make('div', 'fx-rt', document.body);
      tip.setAttribute('role', 'tooltip');
      tip.textContent = el.dataset.fxTip || '';
      var id = 'fx-rt-' + Math.random().toString(36).slice(2, 7);
      tip.id = id;
      el.setAttribute('aria-describedby', id);
      if (!el.hasAttribute('tabindex') && !el.matches('a,button,input')) el.tabIndex = 0;
      var to;
      var place = function (x, y) {
        var w = tip.offsetWidth, h = tip.offsetHeight;
        tip.style.left = U.clamp(x + 14, 8, innerWidth - w - 8) + 'px';
        tip.style.top = U.clamp(y + 16, 8, innerHeight - h - 8) + 'px';
      };
      var show = function () { clearTimeout(to); to = setTimeout(function () { tip.classList.add('fx-on'); }, U.num(el, 'fxDelay', 120)); };
      var hide = function () { clearTimeout(to); tip.classList.remove('fx-on'); };
      el.addEventListener('pointermove', function (e) { place(e.clientX, e.clientY); });
      el.addEventListener('pointerenter', show);
      el.addEventListener('pointerleave', hide);
      el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); place(r.left, r.bottom); show(); });
      el.addEventListener('blur', hide);
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    }
  });

  // Des pastilles de couleur changent la teinte d'un produit
  FX.register('color-picker-orbit', {
    setup: function (el) {
      var cols = (el.dataset.fxColors || '#e10600|#ffd400|#0047ff|#111111').split('|');
      var names = (el.dataset.fxNames || cols.join('|')).split('|');
      var t = el.dataset.fxTarget && document.querySelector(el.dataset.fxTarget);
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Couleur');
      cols.forEach(function (c, i) {
        var b = U.make('button', '', el);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', names[i]);
        b.style.setProperty('--fx-c', c);
        b.addEventListener('click', function () {
          el.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-checked', o === b); });
          if (t) t.style.setProperty('--fx-color', c);
          el.dispatchEvent(new CustomEvent('fx:change', { bubbles: true, detail: { color: c } }));
        });
        if (!i) b.setAttribute('aria-checked', 'true');
      });
    }
  });

  // Une pagination dont l'indicateur s'étire d'une page à l'autre
  FX.register('pagination-squeeze', {
    setup: function (el) {
      var n = U.num(el, 'fxPages', 5), cur = 1, nav = el;
      nav.setAttribute('aria-label', nav.getAttribute('aria-label') || 'Pagination');
      U.make('i', 'fx-pgs', el).setAttribute('aria-hidden', 'true');
      var bs = [];
      var go = function (p) {
        cur = U.clamp(p, 1, n);
        bs.forEach(function (b, i) { var on = i === cur - 1; b.setAttribute('aria-current', on ? 'page' : 'false'); });
        var a = bs[cur - 1];
        el.style.setProperty('--fx-l', a.offsetLeft + 'px');
        el.style.setProperty('--fx-w', a.offsetWidth + 'px');
        el.dispatchEvent(new CustomEvent('fx:page', { bubbles: true, detail: { page: cur } }));
      };
      for (var i = 1; i <= n; i++) (function (k) {
        var b = U.make('button', '', el);
        b.type = 'button'; b.textContent = k;
        b.addEventListener('click', function () { go(k); });
        bs.push(b);
      })(i);
      go(1);
      el._fxGo = function () { go(cur % n + 1); };
    },
    trigger: function (el) { el._fxGo(); }
  });

  // Une foire aux questions dont le plus se change en moins
  FX.register('accordion-plus-morph', {
    setup: function (el) {
      var single = el.dataset.fxSingle !== 'false';
      var items = Array.prototype.slice.call(el.children);
      items.forEach(function (it) {
        var b = it.querySelector('button');
        if (!b) return;
        b.setAttribute('aria-expanded', 'false');
        U.make('i', 'fx-apm', b).setAttribute('aria-hidden', 'true');
        b.addEventListener('click', function () {
          var on = b.getAttribute('aria-expanded') !== 'true';
          if (single) items.forEach(function (o) { var x = o.querySelector('button'); if (x) x.setAttribute('aria-expanded', 'false'); o.classList.remove('fx-open'); });
          b.setAttribute('aria-expanded', on);
          it.classList.toggle('fx-open', on);
        });
      });
    }
  });
})(window.FX);

/* Pack 22 — Dernières idées */
(function (FX) {
  'use strict';
  var U = FX.util;

  // Le cadre reste fixe, et les images se succèdent au défilement
  FX.register('sticky-slideshow', {
    setup: function (el) { el._fxK = Array.prototype.slice.call(el.querySelectorAll('.fx-slide,img')); },
    scroll: function (el, info) {
      var n = el._fxK.length, p = U.clamp(-info.rect.top / Math.max(1, info.rect.height - info.vh), 0, .999);
      if (el.dataset.fxDemo) p = info.pass * .999;
      var c = Math.floor(p * n);
      if (c === el._fxC) return;
      el._fxC = c;
      el._fxK.forEach(function (s, i) { s.classList.toggle('fx-cur', i === c); });
    }
  });

  // Une horloge dont les aiguilles tournent avec le défilement
  FX.register('scroll-clock', {
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<i class="h"></i><i class="m"></i>';
    },
    scroll: function (el, info) {
      var total = info.pass * U.num(el, 'fxHours', 12) * 60;
      el.style.setProperty('--fx-m', (total * 6) + 'deg');
      el.style.setProperty('--fx-h', (total * .5) + 'deg');
    }
  });

  // Chaque lettre monte à sa propre vitesse
  FX.register('parallax-letters', {
    setup: function (el) {
      U.splitChars(el);
      el.querySelectorAll('.fx-char').forEach(function (c) { c.style.setProperty('--fx-s', U.rand(-1, 1).toFixed(2)); });
    },
    scroll: function (el, info) { el.style.setProperty('--fx-t', ((.5 - info.pass) * U.num(el, 'fxAmp', 160)).toFixed(1) + 'px'); }
  });

  // Un bandeau incliné traverse la section
  FX.register('tilted-band', {
    setup: function (el) {
      var t = el.textContent.trim();
      el.setAttribute('aria-label', t);
      el.textContent = '';
      var s = U.make('span', '', el);
      s.setAttribute('aria-hidden', 'true');
      s.textContent = (t + ' ✦ ').repeat(10);
      el._fxDir = el.dataset.fxDir === 'right' ? 1 : -1;
    },
    scroll: function (el, info) { el.firstChild.style.transform = 'translateX(' + ((info.pass * 30) * el._fxDir - 10).toFixed(2) + '%)'; }
  });

  // Une grille de cases s'ouvre au hasard sur l'image
  FX.register('grid-open-scroll', {
    setup: function (el) {
      U.ensurePositioned(el);
      var C = U.num(el, 'fxCols', 8), R = U.num(el, 'fxRows', 6), g = U.make('div', 'fx-gos', el);
      g.setAttribute('aria-hidden', 'true');
      el.style.setProperty('--fx-c', C);
      el.style.setProperty('--fx-rw', R);
      el._fxC = [];
      for (var i = 0; i < C * R; i++) el._fxC.push({ d: U.make('i', '', g), at: Math.random() * .85 });
    },
    scroll: function (el, info) { var p = info.enter; el._fxC.forEach(function (c) { var o = p < c.at; if (o !== c.o) { c.o = o; c.d.classList.toggle('fx-on', o); } }); }
  });

  // L'image plein cadre recule et se cadre
  FX.register('zoom-out-frame', {
    scroll: function (el, info) { el.style.setProperty('--fx-z', (1 + (1 - U.easeOut(info.enter)) * U.num(el, 'fxFrom', .8)).toFixed(3)); }
  });

  // Le texte ondule quand on défile
  FX.register('wave-text-scroll', {
    setup: function (el) {
      U.splitChars(el);
      el._fxC = el.querySelectorAll('.fx-char');
    },
    scroll: function (el, info) {
      var ph = info.pass * 18, a = U.num(el, 'fxAmp', 14) * Math.sin(info.pass * 3.14);
      el._fxC.forEach(function (c, i) { c.style.transform = 'translateY(' + (Math.sin(ph + i * .5) * a).toFixed(1) + 'px)'; });
    }
  });

  // Un titre n'est pleinement visible qu'au centre de l'écran
  FX.register('title-fade-pass', {
    scroll: function (el, info) {
      var d = Math.abs(info.pass - .5) * 2;
      el.style.setProperty('--fx-a', U.clamp(1.4 - d * 1.6, 0, 1).toFixed(3));
      el.style.setProperty('--fx-b', (d * d * U.num(el, 'fxBlur', 8)).toFixed(2) + 'px');
      el.style.setProperty('--fx-y', ((.5 - info.pass) * 40).toFixed(1) + 'px');
    }
  });

  // L'image s'agrandit et suit le curseur pour voir les détails
  FX.register('hover-zoom-pan', {
    setup: function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--fx-ox', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        el.style.setProperty('--fx-oy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }
  });

  // Des points sur une image ouvrent des explications
  FX.register('hotspot-image', {
    setup: function (el) {
      U.ensurePositioned(el);
      el.querySelectorAll('[data-x]').forEach(function (b) {
        b.style.left = b.dataset.x + '%';
        b.style.top = b.dataset.y + '%';
        var tip = U.make('span', 'fx-hs-t', b);
        tip.textContent = b.dataset.text || '';
        b.setAttribute('aria-expanded', 'false');
        b.setAttribute('aria-label', b.dataset.text || 'Détail');
        b.addEventListener('click', function () {
          var on = b.getAttribute('aria-expanded') !== 'true';
          el.querySelectorAll('[data-x]').forEach(function (o) { o.setAttribute('aria-expanded', 'false'); });
          b.setAttribute('aria-expanded', on);
        });
      });
    }
  });

  // Dans une galerie, tout s'estompe sauf l'image survolée
  FX.register('grid-dim-hover', {
    setup: function (el) {
      Array.prototype.forEach.call(el.children, function (c) {
        var on = function () { el.classList.add('fx-on'); Array.prototype.forEach.call(el.children, function (o) { o.classList.toggle('fx-cur', o === c); }); };
        c.addEventListener('pointerenter', on);
        c.addEventListener('focusin', on);
      });
      var off = function () { el.classList.remove('fx-on'); };
      el.addEventListener('pointerleave', off);
      el.addEventListener('focusout', function (e) { if (!el.contains(e.relatedTarget)) off(); });
    }
  });

  // On parcourt une séquence d'images en déplaçant le curseur
  FX.register('film-scrub', {
    setup: function (el) {
      var imgs = el.querySelectorAll('img');
      el.style.touchAction = 'pan-y';
      var show = function (p) {
        var k = U.clamp(Math.floor(p * imgs.length), 0, imgs.length - 1);
        imgs.forEach(function (im, i) { im.classList.toggle('fx-cur', i === k); });
        el.style.setProperty('--fx-p', p.toFixed(3));
      };
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); show((e.clientX - r.left) / r.width); });
      show(0);
      el._fxShow = show;
    }
  });

  // Les bords s'assombrissent et le centre suit le regard
  FX.register('vignette-focus', {
    setup: function (el) {
      var s = el._fxS = { x: 50, y: 50, tx: 50, ty: 50 };
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); s.tx = (e.clientX - r.left) / r.width * 100; s.ty = (e.clientY - r.top) / r.height * 100; });
      el.addEventListener('pointerleave', function () { s.tx = s.ty = 50; });
    },
    tick: function (el) {
      var s = el._fxS;
      s.x = U.lerp(s.x, s.tx, .08); s.y = U.lerp(s.y, s.ty, .08);
      el.style.setProperty('--fx-vx', s.x.toFixed(1) + '%');
      el.style.setProperty('--fx-vy', s.y.toFixed(1) + '%');
    }
  });

  // La miniature grandit jusqu'au plein écran, sans coupure
  FX.register('lightbox-flip', {
    setup: function (el) {
      el.addEventListener('click', function (e) {
        var img = e.target.closest('img');
        if (!img) return;
        var r = img.getBoundingClientRect(), bg = U.make('div', 'fx-lb', document.body), c = img.cloneNode();
        bg.setAttribute('role', 'dialog');
        bg.setAttribute('aria-modal', 'true');
        bg.setAttribute('aria-label', img.alt || 'Image agrandie');
        bg.tabIndex = -1;
        bg.appendChild(c);
        c.style.cssText = 'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
        var k = Math.min(innerWidth * .9 / r.width, innerHeight * .9 / r.height);
        var tx = innerWidth / 2 - r.left - r.width / 2, ty = innerHeight / 2 - r.top - r.height / 2;
        var close = function () {
          bg.classList.remove('fx-on');
          c.style.transform = '';
          setTimeout(function () { bg.remove(); img.focus && img.focus({ preventScroll: true }); }, U.reduced ? 0 : 400);
          document.removeEventListener('keydown', key);
        };
        var key = function (ev) { if (ev.key === 'Escape') close(); };
        bg.addEventListener('click', close);
        document.addEventListener('keydown', key);
        U.raf(function () { U.raf(function () { bg.classList.add('fx-on'); c.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')'; bg.focus(); }); });
      });
    }
  });

  // On gratte une surface pour découvrir ce qu'il y a dessous
  FX.register('scratch-reveal', {
    setup: function (el) {
      U.ensurePositioned(el);
      var cv = U.make('canvas', 'fx-scr', el), c = cv.getContext('2d'), down = false, count = 0;
      cv.setAttribute('aria-hidden', 'true');
      var init = function () {
        cv.width = el.offsetWidth; cv.height = el.offsetHeight;
        c.globalCompositeOperation = 'source-over';
        c.fillStyle = U.cssVar(el, '--fx-foil', '#888');
        c.fillRect(0, 0, cv.width, cv.height);
        c.fillStyle = 'rgba(255,255,255,.75)';
        c.font = '600 14px system-ui, sans-serif';
        c.textAlign = 'center';
        c.fillText(el.dataset.fxHint || 'Grattez ici', cv.width / 2, cv.height / 2);
        c.globalCompositeOperation = 'destination-out';
        c.lineWidth = U.num(el, 'fxBrush', 34);
        c.lineCap = 'round';
      };
      init();
      var at = function (e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      var last;
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', function (e) { down = true; last = at(e); });
      window.addEventListener('pointerup', function () { down = false; });
      cv.addEventListener('pointermove', function (e) {
        if (!down) return;
        var p = at(e);
        c.beginPath(); c.moveTo(last[0], last[1]); c.lineTo(p[0], p[1]); c.stroke();
        last = p;
        if (++count % 12) return;
        var d = c.getImageData(0, 0, cv.width, cv.height).data, clear = 0;
        for (var i = 3; i < d.length; i += 64) if (!d[i]) clear++;
        if (clear / (d.length / 64) > U.num(el, 'fxDone', .5)) { el.classList.add('fx-done'); el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true })); }
      });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.classList.add('fx-done'); });
      if (U.reduced) el.classList.add('fx-done');
    },
    trigger: function (el) { el.classList.add('fx-done'); }
  });

  // L'image est grise, sauf autour du curseur
  FX.register('color-splash', {
    setup: function (el) {
      var s = el._fxS = { x: 0, y: 0, tx: 0, ty: 0, r: 0, on: false };
      var img = el.querySelector('img');
      if (!img) return;
      var c = img.cloneNode();
      c.alt = '';
      c.setAttribute('aria-hidden', 'true');
      c.className = 'fx-cs-top';
      el.appendChild(c);
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); s.tx = e.clientX - r.left; s.ty = e.clientY - r.top; s.on = true; });
      el.addEventListener('pointerleave', function () { s.on = false; });
    },
    tick: function (el, dt, t) {
      var s = el._fxS, auto = el.dataset.fxAuto === 'true' && !s.on;
      if (auto) { s.tx = el.offsetWidth * (.5 + Math.cos(t * .001) * .3); s.ty = el.offsetHeight * (.5 + Math.sin(t * .0014) * .3); }
      s.x = U.lerp(s.x, s.tx, .14); s.y = U.lerp(s.y, s.ty, .14);
      s.r = U.lerp(s.r, s.on || auto ? U.num(el, 'fxRadius', 70) : 0, .1);
      el.style.setProperty('--fx-cx', s.x.toFixed(1) + 'px');
      el.style.setProperty('--fx-cy', s.y.toFixed(1) + 'px');
      el.style.setProperty('--fx-cr', s.r.toFixed(1) + 'px');
    }
  });

  // Des anneaux de couleur partent du point de clic
  FX.register('ripple-rings', { transition: { pieces: 5, cover: 900, uncover: 850, build: function (o) {
    var e = o._fxEvent, x = e && e.clientX != null ? e.clientX : innerWidth / 2, y = e && e.clientY != null ? e.clientY : innerHeight / 2;
    var list = U.cssVar(document.documentElement, '--fx-tr-colors', '#e10600,#ffd400,#0047ff,#e10600,#0c0c0e').split(',');
    Array.prototype.forEach.call(o.children, function (p, i) {
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = list[i % list.length];
      p.style.setProperty('--fx-d', i * 70 + 'ms');
    });
  } } });

  // Un grand triangle balaye l'écran depuis le coin le plus proche
  FX.register('corner-sweep', { transition: { pieces: 1, cover: 780, uncover: 800, build: function (o) {
    var e = o._fxEvent, x = e && e.clientX != null ? e.clientX : 0, y = e && e.clientY != null ? e.clientY : 0;
    o.style.setProperty('--fx-sx', x < innerWidth / 2 ? 1 : -1);
    o.style.setProperty('--fx-sy', y < innerHeight / 2 ? 1 : -1);
  } } });

  // Un bord en dents de scie monte et couvre l'écran
  FX.register('zigzag-cover', { transition: { pieces: 1, cover: 800, uncover: 820, build: function (o) {
    var n = Math.max(6, Math.round(innerWidth / 70)), pts = [];
    for (var i = 0; i <= n; i++) pts.push((i * 100 / n).toFixed(2) + '% ' + (i % 2 ? 0 : 60) + 'px');
    o.firstChild.style.clipPath = 'polygon(' + pts.join(',') + ',100% 100%,0 100%)';
  } } });

  // Deux moitiés se ferment au centre avec une ligne de lumière
  FX.register('mirror-split', { transition: { pieces: 3, cover: 720, uncover: 760, build: function (o) {
    o.children[0].className = 'fx-t';
    o.children[1].className = 'fx-b';
    o.children[2].className = 'fx-line';
  } } });

  // Un radar balaye et révèle des échos
  FX.register('radar-sweep', {
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      el._fxA = 0;
      el._fxE = [];
      for (var i = 0; i < U.num(el, 'fxBlips', 7); i++) {
        var d = U.make('i', '', el), a = Math.random() * 360, r = U.rand(16, 46);
        d.style.left = (50 + Math.cos(a / 57.3) * r) + '%';
        d.style.top = (50 + Math.sin(a / 57.3) * r) + '%';
        el._fxE.push({ d: d, a: (a + 90 + 360) % 360 });
      }
    },
    tick: function (el, dt) {
      if (U.reduced) return;
      var prev = el._fxA;
      el._fxA = (prev + dt * U.num(el, 'fxSpeed', 70)) % 360;
      el.style.setProperty('--fx-a', el._fxA.toFixed(1) + 'deg');
      el._fxE.forEach(function (b) {
        if ((prev < b.a && el._fxA >= b.a) || (prev > el._fxA && (b.a > prev || b.a <= el._fxA))) { b.d.classList.remove('fx-hit'); void b.d.offsetWidth; b.d.classList.add('fx-hit'); }
      });
    }
  });

  // Des impulsions de lumière voyagent sur un circuit
  FX.register('circuit-pulse', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxP = null;
    },
    tick: function (el, dt) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (!el._fxP || cv.width !== w) {
        cv.width = w; cv.height = h;
        el._fxP = [];
        var G = 24;
        for (var i = 0; i < U.num(el, 'fxTraces', 12); i++) {
          var x = Math.floor(Math.random() * w / G) * G, y = Math.floor(Math.random() * h / G) * G, pts = [[x, y]];
          for (var k = 0; k < 5; k++) {
            if (k % 2) x += (Math.random() < .5 ? -1 : 1) * G * Math.ceil(Math.random() * 4);
            else y += (Math.random() < .5 ? -1 : 1) * G * Math.ceil(Math.random() * 3);
            pts.push([x, y]);
          }
          var L = 0; for (k = 1; k < pts.length; k++) L += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
          el._fxP.push({ pts: pts, L: L, t: Math.random() * L, s: U.rand(60, 150) });
        }
      }
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      var c = cv.getContext('2d'), col = getComputedStyle(cv).color;
      c.clearRect(0, 0, w, h);
      c.strokeStyle = col; c.fillStyle = col;
      el._fxP.forEach(function (p) {
        c.globalAlpha = .22;
        c.beginPath();
        p.pts.forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
        c.stroke();
        p.t = (p.t + p.s * dt) % p.L;
        var d = p.t;
        for (var i = 1; i < p.pts.length; i++) {
          var a = p.pts[i - 1], b = p.pts[i], s = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
          if (d <= s) { var k = d / (s || 1); c.globalAlpha = 1; c.beginPath(); c.arc(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 2.4, 0, 7); c.fill(); break; }
          d -= s;
        }
      });
    }
  });

  // Plusieurs couches de vagues se balancent
  FX.register('sea-layers', {
    setup: function (el) { U.ensurePositioned(el); el._fxCv = U.make('canvas', 'fx-gen', el); el._fxCv.setAttribute('aria-hidden', 'true'); },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), cols = U.cssVar(el, '--fx-sea', '#9ec4ff,#4d8bff,#0047ff,#002a99').split(',');
      c.clearRect(0, 0, w, h);
      cols.forEach(function (col, i) {
        var base = h * (.42 + i * .14), T = t * .001 * (.5 + i * .25);
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(0, h);
        for (var x = 0; x <= w + 8; x += 8) c.lineTo(x, base + Math.sin(x * .018 + T + i * 1.7) * (10 + i * 3) + Math.sin(x * .007 - T) * 7);
        c.lineTo(w, h);
        c.closePath();
        c.fill();
      });
    }
  });

  // Des poussières flottent dans un rayon de lumière
  FX.register('dust-motes', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxD = [];
      for (var i = 0; i < U.num(el, 'fxCount', 60); i++) el._fxD.push({ x: Math.random(), y: Math.random(), z: Math.random(), a: U.rand(0, 6) });
      el._fxM = null;
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el._fxM = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; });
      el.addEventListener('pointerleave', function () { el._fxM = null; });
    },
    tick: function (el, dt, t) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      var c = cv.getContext('2d'), M = el._fxM;
      c.clearRect(0, 0, w, h);
      c.fillStyle = getComputedStyle(cv).color;
      el._fxD.forEach(function (d) {
        d.x += Math.sin(t * .0003 + d.a) * .0004;
        d.y -= (.01 + d.z * .02) * dt;
        if (d.y < -.02) { d.y = 1.02; d.x = Math.random(); }
        if (M) { d.x += (M[0] - d.x) * .002; d.y += (M[1] - d.y) * .002; }
        c.globalAlpha = (.15 + d.z * .6) * (.6 + .4 * Math.sin(t * .001 + d.a));
        c.beginPath();
        c.arc(d.x * w, d.y * h, .5 + d.z * 1.6, 0, 7);
        c.fill();
      });
    }
  });

  // Une grille d'hexagones s'éclaire autour du curseur
  FX.register('hex-glow', {
    setup: function (el) {
      el._fxH = false;
      el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el._fxH = true; el.style.setProperty('--fx-mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--fx-my', (e.clientY - r.top) + 'px'); });
      el.addEventListener('pointerleave', function () { el._fxH = false; });
    },
    tick: function (el, dt, t) {
      if (el._fxH || U.reduced) return;
      el.style.setProperty('--fx-mx', (el.offsetWidth * (.5 + Math.cos(t * .0008) * .4)).toFixed(0) + 'px');
      el.style.setProperty('--fx-my', (el.offsetHeight * (.5 + Math.sin(t * .0011) * .4)).toFixed(0) + 'px');
    }
  });

  // Des nuages dérivent à plusieurs profondeurs
  FX.register('cloud-drift', {
    setup: function (el) {
      U.ensurePositioned(el);
      el.classList.add('fx-cl-host');
      var box = U.make('div', 'fx-cl-b', el);
      box.setAttribute('aria-hidden', 'true');
      el._fxC = [];
      for (var i = 0; i < U.num(el, 'fxCount', 7); i++) {
        var c = U.make('i', '', box), z = Math.random();
        c.style.top = U.rand(4, 70) + '%';
        c.style.setProperty('--fx-s', (.4 + z * .9).toFixed(2));
        c.style.opacity = (.45 + z * .55).toFixed(2);
        el._fxC.push({ d: c, x: Math.random() * 120 - 20, v: 1.2 + z * 2.6 });
      }
    },
    tick: function (el, dt) {
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      el._fxC.forEach(function (c) {
        c.x += c.v * dt;
        if (c.x > 110) c.x = -30;
        c.d.style.left = c.x.toFixed(2) + '%';
      });
    }
  });

  // Un voyage dans les étoiles, qui s'accélère au survol
  FX.register('star-warp', {
    setup: function (el) {
      U.ensurePositioned(el);
      el._fxCv = U.make('canvas', 'fx-gen', el);
      el._fxCv.setAttribute('aria-hidden', 'true');
      el._fxS = [];
      for (var i = 0; i < U.num(el, 'fxCount', 180); i++) el._fxS.push({ x: U.rand(-1, 1), y: U.rand(-1, 1), z: Math.random() });
      el._fxV = .2;
    },
    tick: function (el, dt) {
      var cv = el._fxCv, w = cv.clientWidth, h = cv.clientHeight;
      if (!w) return;
      if (U.reduced && el._fxDone) return;
      el._fxDone = true;
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      el._fxV = U.lerp(el._fxV, el.matches(':hover') ? .9 : U.num(el, 'fxSpeed', .18), .03);
      var c = cv.getContext('2d'), v = el._fxV;
      c.clearRect(0, 0, w, h);
      c.strokeStyle = getComputedStyle(cv).color;
      el._fxS.forEach(function (s) {
        var oz = s.z;
        s.z -= v * dt;
        if (s.z <= .02) { s.z = 1; s.x = U.rand(-1, 1); s.y = U.rand(-1, 1); return; }
        var k = .4 * Math.min(w, h);
        c.globalAlpha = 1 - s.z;
        c.lineWidth = (1 - s.z) * 1.8;
        c.beginPath();
        c.moveTo(w / 2 + s.x * k / oz, h / 2 + s.y * k / oz);
        c.lineTo(w / 2 + s.x * k / s.z, h / 2 + s.y * k / s.z);
        c.stroke();
      });
    }
  });

  // Des pendules se désynchronisent et dessinent des vagues
  FX.register('pendulum-wave', {
    setup: function (el) {
      el.setAttribute('aria-hidden', 'true');
      var n = U.num(el, 'fxCount', 14);
      el._fxP = [];
      for (var i = 0; i < n; i++) { var d = U.make('i', '', el); el._fxP.push({ d: d, f: 18 + i }); }
    },
    tick: function (el, dt, t) {
      if (U.reduced) return;
      var T = t / U.num(el, 'fxCycle', 42000) * 6.283;
      el._fxP.forEach(function (p) { p.d.style.setProperty('--fx-a', (Math.sin(T * p.f) * 38).toFixed(2) + 'deg'); });
    }
  });

  // Un panneau latéral qui pousse tout le contenu
  FX.register('drawer-push', {
    setup: function (el) {
      var btn = el.querySelector('[data-open]'), pan = el.querySelector('aside');
      if (!btn || !pan) return;
      btn.setAttribute('aria-expanded', 'false');
      pan.setAttribute('inert', '');
      var set = function (on) {
        el.classList.toggle('fx-open', on);
        btn.setAttribute('aria-expanded', on);
        if (on) { pan.removeAttribute('inert'); var f = pan.querySelector('a,button'); if (f) f.focus(); }
        else { pan.setAttribute('inert', ''); btn.focus(); }
      };
      btn.addEventListener('click', function () { set(!el.classList.contains('fx-open')); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el.classList.contains('fx-open')) set(false); });
    }
  });

  // Un bouton de remontée qui montre la part lue
  FX.register('back-to-top-progress', {
    setup: function (el) {
      el.setAttribute('aria-label', el.getAttribute('aria-label') || 'Revenir en haut');
      el.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" class="b"/><circle cx="20" cy="20" r="18" pathLength="100" class="o"/></svg><span aria-hidden="true">↑</span>';
      el.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: U.reduced ? 'auto' : 'smooth' }); });
      if (el.dataset.fxDemo) el.classList.add('fx-show');
    },
    scroll: function (el) {
      var max = document.documentElement.scrollHeight - innerHeight, p = max > 0 ? window.scrollY / max : 0;
      el.style.setProperty('--fx-v', (p * 100).toFixed(1));
      if (!el.dataset.fxDemo) el.classList.toggle('fx-show', window.scrollY > U.num(el, 'fxAfter', 400));
    }
  });

  // Une grille filtrable dont les éléments glissent à leur nouvelle place
  FX.register('tag-filter-flip', {
    setup: function (el) {
      var bar = el.querySelector('[data-tags]'), grid = el.querySelector('[data-grid]');
      if (!bar || !grid) return;
      var items = Array.prototype.slice.call(grid.children), tags = ['Tout'];
      items.forEach(function (i) { (i.dataset.tag || '').split(' ').forEach(function (t) { if (t && tags.indexOf(t) < 0) tags.push(t); }); });
      var apply = function (tag) {
        var first = new Map();
        items.forEach(function (i) { if (!i.hidden) first.set(i, i.getBoundingClientRect()); });
        items.forEach(function (i) { i.hidden = !(tag === 'Tout' || (i.dataset.tag || '').split(' ').indexOf(tag) >= 0); });
        items.forEach(function (i) {
          if (i.hidden || U.reduced || !i.animate) return;
          var l = i.getBoundingClientRect(), f = first.get(i);
          if (f) i.animate([{ transform: 'translate(' + (f.left - l.left) + 'px,' + (f.top - l.top) + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
          else i.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
        });
      };
      tags.forEach(function (t, k) {
        var b = U.make('button', '', bar);
        b.type = 'button';
        b.textContent = t;
        b.setAttribute('aria-pressed', !k);
        b.addEventListener('click', function () { bar.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', o === b); }); apply(t); });
      });
    }
  });

  // Une barre latérale qui se replie sur ses icônes
  FX.register('sidebar-collapse', {
    setup: function (el) {
      var btn = el.querySelector('button[data-toggle]'), key = el.dataset.fxKey;
      var set = function (on) {
        el.classList.toggle('fx-small', on);
        if (btn) { btn.setAttribute('aria-expanded', !on); btn.setAttribute('aria-label', on ? 'Déplier le menu' : 'Replier le menu'); }
        if (key) try { localStorage.setItem(key, on ? '1' : '0'); } catch (err) {}
      };
      var start = false;
      if (key) try { start = localStorage.getItem(key) === '1'; } catch (err) {}
      set(start);
      if (btn) btn.addEventListener('click', function () { set(!el.classList.contains('fx-small')); });
      el.querySelectorAll('a').forEach(function (a) { var s = a.querySelector('span'); if (s) a.title = s.textContent; });
    },
    trigger: function (el) { el.classList.toggle('fx-small'); }
  });

  // Un camembert dont les parts s'ouvrent au survol
  FX.register('pie-explode', {
    entrance: true,
    setup: function (el) {
      var parts = (el.dataset.fxParts || 'Design:40,Code:30,Son:20,Récit:10').split(',').map(function (s) { var p = s.split(':'); return { n: p[0], v: +p[1] }; });
      var sum = parts.reduce(function (a, p) { return a + p.v; }, 0), a = -Math.PI / 2, svg = '<svg viewBox="-60 -60 120 120" aria-hidden="true">';
      parts.forEach(function (p, i) {
        var b = a + p.v / sum * Math.PI * 2, mid = (a + b) / 2, big = b - a > Math.PI ? 1 : 0;
        svg += '<path style="--fx-i:' + i + ';--fx-x:' + (Math.cos(mid) * 6).toFixed(1) + 'px;--fx-y:' + (Math.sin(mid) * 6).toFixed(1) + 'px" d="M0 0 L' + (Math.cos(a) * 50).toFixed(2) + ' ' + (Math.sin(a) * 50).toFixed(2) + ' A50 50 0 ' + big + ' 1 ' + (Math.cos(b) * 50).toFixed(2) + ' ' + (Math.sin(b) * 50).toFixed(2) + ' Z"><title>' + p.n + ' ' + Math.round(p.v / sum * 100) + ' %</title></path>';
        a = b;
      });
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', parts.map(function (p) { return p.n + ' ' + Math.round(p.v / sum * 100) + ' %'; }).join(', '));
      el.innerHTML = svg + '</svg>';
    }
  });

  // Un entonnoir montre ce qui reste à chaque étape
  FX.register('funnel-steps', {
    entrance: true,
    setup: function (el) {
      var st = (el.dataset.fxSteps || 'Visites:1000,Essais:420,Clients:96').split(',').map(function (s) { var p = s.split(':'); return { n: p[0], v: +p[1] }; }), top = st[0].v;
      st.forEach(function (s, i) {
        var r = U.make('div', 'fx-fn-r', el);
        r.style.setProperty('--fx-w', s.v / top);
        r.style.setProperty('--fx-i', i);
        r.innerHTML = '<i></i><span></span>';
        r.lastChild.textContent = s.n + ' · ' + s.v + (i ? ' (' + Math.round(s.v / st[i - 1].v * 100) + ' %)' : '');
      });
    }
  });

  // Une carte de rectangles proportionnels s'assemble
  FX.register('treemap-grow', {
    entrance: true,
    setup: function (el) {
      var it = (el.dataset.fxItems || 'Vidéo:42,Son:24,Image:18,Texte:10,Autre:6').split(',').map(function (s) { var p = s.split(':'); return { n: p[0], v: +p[1] }; }).sort(function (a, b) { return b.v - a.v; });
      var i = 0;
      var cut = function (list, x, y, w, h, hz) {
        if (list.length === 1) {
          var d = U.make('div', '', el);
          d.textContent = list[0].n;
          d.style.left = x + '%'; d.style.top = y + '%'; d.style.width = w + '%'; d.style.height = h + '%';
          d.style.setProperty('--fx-i', i++);
          d.title = list[0].n + ' : ' + list[0].v;
          return;
        }
        var tot = list.reduce(function (a, c) { return a + c.v; }, 0), acc = 0, k = 0;
        while (k < list.length - 1 && acc + list[k].v <= tot / 2) acc += list[k++].v;
        if (!k) { acc = list[0].v; k = 1; }
        var r = acc / tot;
        if (hz) { cut(list.slice(0, k), x, y, w * r, h, !hz); cut(list.slice(k), x + w * r, y, w * (1 - r), h, !hz); }
        else { cut(list.slice(0, k), x, y, w, h * r, !hz); cut(list.slice(k), x, y + h * r, w, h * (1 - r), !hz); }
      };
      cut(it, 0, 0, 100, 100, true);
    }
  });

  // Des bulles proportionnelles se serrent les unes contre les autres
  FX.register('bubble-pack', {
    entrance: true,
    setup: function (el) {
      var it = (el.dataset.fxItems || 'Paris:50,Lyon:30,Nantes:22,Lille:18,Rennes:14,Metz:9').split(',').map(function (s) { var p = s.split(':'); return { n: p[0], v: +p[1] }; }).sort(function (a, b) { return b.v - a.v; });
      var W = el.clientWidth || 220, H = el.clientHeight || 160, placed = [], mx = it[0].v;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', it.map(function (i) { return i.n + ' ' + i.v; }).join(', '));
      it.forEach(function (o, k) {
        var r = Math.sqrt(o.v / mx) * Math.min(W, H) * .26, a = 0, d = 0, x, y;
        do { x = Math.cos(a) * d; y = Math.sin(a) * d * .75; a += .5; d += .7; }
        while (placed.some(function (p) { return Math.hypot(p.x - x, p.y - y) < p.r + r + 2; }) && d < 400);
        placed.push({ x: x, y: y, r: r });
        var b = U.make('span', '', el);
        b.setAttribute('aria-hidden', 'true');
        b.textContent = r > 18 ? o.n : '';
        b.style.cssText = 'width:' + r * 2 + 'px;height:' + r * 2 + 'px;left:' + (W / 2 + x - r) + 'px;top:' + (H / 2 + y - r) + 'px';
        b.style.setProperty('--fx-i', k);
      });
    }
  });

  // Une carte de tâche passe de colonne en colonne
  FX.register('kanban-move', {
    setup: function (el) {
      el._fxCols = Array.prototype.slice.call(el.children);
      el._fxT = 0;
      el._fxStep = function () {
        var col = el._fxCols.filter(function (c) { return c.querySelector('[data-card]'); });
        if (!col.length) return;
        var from = col[Math.floor(Math.random() * col.length)], cards = from.querySelectorAll('[data-card]'), card = cards[cards.length - 1];
        var i = el._fxCols.indexOf(from), to = el._fxCols[(i + 1) % el._fxCols.length];
        var a = card.getBoundingClientRect();
        to.appendChild(card);
        var b = card.getBoundingClientRect();
        if (!U.reduced && card.animate) card.animate([{ transform: 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px) rotate(3deg)' }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.16,1,.3,1)' });
      };
    },
    trigger: function (el) { el._fxStep(); },
    tick: function (el, dt) {
      if (U.reduced) return;
      el._fxT += dt;
      if (el._fxT > U.num(el, 'fxEvery', 1.6)) { el._fxT = 0; el._fxStep(); }
    }
  });

  // Un compte à rebours en anneaux vers une vraie date
  FX.register('countdown-rings', {
    setup: function (el) {
      var end = new Date(el.dataset.fxTo || Date.now() + 3 * 864e5 + 5 * 36e5).getTime();
      var units = [['jours', 864e5, 30], ['heures', 36e5, 24], ['min', 6e4, 60], ['s', 1e3, 60]];
      el.setAttribute('role', 'timer');
      el.innerHTML = units.map(function (u) { return '<div><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="b"/><circle cx="20" cy="20" r="17" pathLength="100" class="o"/></svg><b></b><small>' + u[0] + '</small></div>'; }).join('');
      var box = el.children, last = -1;
      el._fxTick = function () {
        var rest = Math.max(0, end - Date.now()), s = Math.floor(rest / 1000);
        if (s === last) return;
        last = s;
        units.forEach(function (u, i) {
          var v = Math.floor(rest / u[1]);
          if (i) v %= u[2];
          box[i].querySelector('b').textContent = v;
          box[i].style.setProperty('--fx-v', Math.min(100, v / u[2] * 100).toFixed(1));
        });
        if (!rest) el.dispatchEvent(new CustomEvent('fx:done', { bubbles: true }));
      };
      el._fxTick();
    },
    tick: function (el) { el._fxTick(); }
  });

  // Le texte s'écrit, se trompe, corrige
  FX.register('typing-correct', {
    entrance: true,
    setup: function (el) {
      el._fxOk = el.textContent.trim();
      el._fxBad = el.dataset.fxWrong || el._fxOk;
      el.setAttribute('aria-label', el._fxOk);
      if (!U.reduced) el.textContent = '';
    },
    reset: function (el) { el._fxK = (el._fxK || 0) + 1; el.textContent = ''; },
    enter: function (el) {
      var run = el._fxK = (el._fxK || 0) + 1, ok = el._fxOk, bad = el._fxBad, i = 0, phase = 0, common = 0;
      if (U.reduced) { el.textContent = ok; return; }
      while (common < ok.length && ok[common] === bad[common]) common++;
      var sp = U.num(el, 'fxSpeed', 60);
      (function step() {
        if (run !== el._fxK) return;
        if (phase === 0) { el.textContent = bad.slice(0, ++i); if (i >= bad.length) { phase = 1; return setTimeout(step, 550); } }
        else if (phase === 1) { el.textContent = bad.slice(0, --i); if (i <= common) phase = 2; }
        else { el.textContent = ok.slice(0, ++i); if (i >= ok.length) return; }
        setTimeout(step, phase === 1 ? sp * .6 : sp * U.rand(.6, 1.5));
      })();
    }
  });

  // Chaque lettre se penche vers le curseur
  FX.register('letter-tilt-cursor', {
    setup: function (el) {
      U.splitChars(el);
      var cs = el.querySelectorAll('.fx-char');
      if (U.reduced) return;
      el.addEventListener('pointermove', function (e) {
        cs.forEach(function (c) {
          var r = c.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2, d = Math.hypot(dx, dy);
          var k = Math.max(0, 1 - d / U.num(el, 'fxRadius', 180));
          c.style.setProperty('--fx-t', (dx / (d || 1) * 22 * k).toFixed(1) + 'deg');
        });
      });
      el.addEventListener('pointerleave', function () { cs.forEach(function (c) { c.style.setProperty('--fx-t', '0deg'); }); });
    }
  });

  // Un mot vertical qui bascule à l'horizontale au survol
  FX.register('vertical-type-flip', {
    setup: function (el) { U.splitChars(el); el.querySelectorAll('.fx-char').forEach(function (c, i) { c.style.setProperty('--fx-i', i); }); }
  });

  // Les mots sont frappés l'un après l'autre sur l'écran
  FX.register('stamp-word', { entrance: true, setup: function (el) { U.splitWords(el); } });

  // Une conversation apparaît bulle après bulle
  FX.register('word-bubbles', {
    entrance: true,
    setup: function (el) {
      var acc = 0;
      Array.prototype.forEach.call(el.children, function (b) {
        b.style.setProperty('--fx-d', acc + 'ms');
        acc += 260 + b.textContent.length * U.num(el, 'fxPerChar', 16);
      });
    }
  });

  // Un texte long qui se déplie jusqu'à sa vraie hauteur
  FX.register('line-clamp-expand', {
    setup: function (el) {
      var box = document.createElement('div');
      box.className = 'fx-lc';
      while (el.firstChild) box.appendChild(el.firstChild);
      el.appendChild(box);
      var lines = U.num(el, 'fxLines', 3), lh = parseFloat(getComputedStyle(box).lineHeight) || 20, min = lh * lines;
      box.style.maxHeight = min + 'px';
      if (box.scrollHeight <= min + 2) { box.style.maxHeight = 'none'; return; }
      el.classList.add('fx-clamped');
      var b = U.make('button', '', el);
      b.type = 'button';
      b.textContent = el.dataset.fxMore || 'Lire la suite';
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var on = !el.classList.contains('fx-open');
        el.classList.toggle('fx-open', on);
        box.style.maxHeight = (on ? box.scrollHeight : min) + 'px';
        b.textContent = on ? (el.dataset.fxLess || 'Réduire') : (el.dataset.fxMore || 'Lire la suite');
        b.setAttribute('aria-expanded', on);
      });
    }
  });
})(window.FX);

window.FX._boot();
