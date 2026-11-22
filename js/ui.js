/* ui.js — panel wiring, loading sequence, stats readout, canvas layout.
   Talks to the rest of the app only through ER.bus. */
(function (ER) {
  'use strict';
  var C = ER.core;
  var $ = function (id) { return document.getElementById(id); };

  var WORDS = ['aster', 'gilded', 'hollow', 'ashen', 'verdant', 'pale', 'thorn',
               'ember', 'quiet', 'sable', 'morning', 'riven', 'wander', 'vesper',
               'graven', 'still'];

  var el = {};
  var state = {
    realm: 'erdtree',
    seed: 'aster',
    count: 75000,
    size: 1,
    px: 3,
    ditherAmount: 0.6,
    ditherOn: false,
    pixelArt: false,
    splatView: false,
    animate: true,
    autoOrbit: true,
    collapsed: false,
    quality: 2
  };
  var spark = [];
  var SPARK_N = 84;

  function setToggle(btn, on) {
    if (!btn) return;
    btn.classList.toggle('on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function init() {
    el.panel = $('panel');
    el.body = document.querySelector('.panel-body');
    el.tabs = Array.prototype.slice.call(document.querySelectorAll('.wtab'));
    el.seed = $('seed');
    el.seedRandom = $('seed-random');
    el.count = $('count');
    el.size = $('size');
    el.px = $('px');
    el.dither = $('dither');
    el.outCount = $('count-out');
    el.outSize = $('size-out');
    el.outPx = $('px-out');
    el.outDither = $('dither-out');
    el.tPixel = $('t-pixel');
    el.tSplat = $('t-splat');
    el.tDither = $('t-dither');
    el.tAnim = $('t-anim');
    el.tRotate = $('t-rotate');
    el.btnReset = $('btn-reset');
    el.btnCollapse = $('btn-collapse');
    el.btnReopen = $('panel-reopen');
    el.pxRow = el.px.closest('section');
    el.loading = $('loading');
    el.loadBar = $('load-bar');
    el.loadMsg = $('load-msg');
    el.loadSub = $('load-sub');
    el.loadTitle = $('load-title');
    el.frame = $('frame');
    el.view = $('view');
    el.debug = $('debug');
    el.hash = $('foot-hash');
    el.contextLost = $('context-lost');
    el.s = {
      fps: $('s-fps'), frame: $('s-frame'), splats: $('s-splats'),
      res: $('s-res'), sort: $('s-sort'), gen: $('s-gen')
    };
    el.graph = $('graph');
    el.gctx = el.graph.getContext('2d');

    /* ---- realm tabs ---- */
    el.tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var id = t.getAttribute('data-realm');
        if (id !== state.realm) ER.bus.emit('realm', id);
      });
    });

    /* ---- collapse ---- */
    el.btnCollapse.addEventListener('click', function () { setCollapsed(true); });
    el.btnReopen.addEventListener('click', function () { setCollapsed(false); });

    setModeControls();

    /* ---- seed ---- */
    function commitSeed() {
      var v = (el.seed.value || '').trim();
      if (!v) { el.seed.value = state.seed; return; }
      if (v === state.seed) return;
      state.seed = v;
      ER.bus.emit('seed', v);
    }
    el.seed.addEventListener('change', commitSeed);
    el.seed.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { el.seed.blur(); commitSeed(); }
    });
    el.seedRandom.addEventListener('click', function () {
      var w;
      do { w = WORDS[(Math.random() * WORDS.length) | 0]; } while (w === state.seed);
      state.seed = w;
      el.seed.value = w;
      ER.bus.emit('seed', w);
    });

    /* ---- sliders ---- */
    function slider(input, out, key, fmt, emit) {
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        state[key] = v;
        out.innerHTML = fmt(v);
        if (emit) emit(v);
        ER.bus.emit('param', { key: key, value: v });
      });
    }
    slider(el.count, el.outCount, 'count', function (v) { return v.toLocaleString('en-US'); });
    slider(el.size, el.outSize, 'size', function (v) { return v.toFixed(2) + '&times;'; });
    slider(el.px, el.outPx, 'px', function (v) { return v + ' px'; });
    slider(el.dither, el.outDither, 'ditherAmount', function (v) { return v.toFixed(2); },
      function (v) {
        if (v <= 0 && state.ditherOn) {
          state.ditherOn = false;
          setToggle(el.tDither, false);
          ER.bus.emit('toggle', { key: 'ditherOn', value: false });
        }
        ER.bus.emit('param', { key: 'ditherAmount', value: v });
      });

    /* ---- toggles ---- */
    function bindToggle(btn, key, onChange) {
      btn.addEventListener('click', function () {
        var on = !btn.classList.contains('on');
        setToggle(btn, on);
        state[key] = on;
        if (onChange) onChange(on);
        ER.bus.emit('toggle', { key: key, value: on });
      });
    }
    bindToggle(el.tPixel, 'pixelArt', function () {
      setModeControls();
      ER.bus.emit('action', 'relayout');
    });
    bindToggle(el.tSplat, 'splatView');
    bindToggle(el.tAnim, 'animate');
    bindToggle(el.tRotate, 'autoOrbit');
    el.tDither.addEventListener('click', function () {
      var on = !state.ditherOn;
      // Dither is a display-space operation. Turning it on from Cinematic is
      // an explicit request for the pixel pipeline, not a no-op.
      if (on && !state.pixelArt) {
        state.pixelArt = true;
        setToggle(el.tPixel, true);
        setModeControls();
        ER.bus.emit('toggle', { key: 'pixelArt', value: true });
      }
      state.ditherOn = on;
      if (on && state.ditherAmount <= 0) {
        state.ditherAmount = 0.6;
        el.dither.value = 0.6;
        el.outDither.textContent = '0.60';
      }
      setToggle(el.tDither, on && state.pixelArt);
      ER.bus.emit('toggle', { key: 'ditherOn', value: on });
    });
    el.btnReset.addEventListener('click', function () {
      el.btnReset.classList.add('on');
      setTimeout(function () { el.btnReset.classList.remove('on'); }, 150);
      ER.bus.emit('action', 'reset');
    });

    window.addEventListener('resize', function () { ER.bus.emit('action', 'relayout'); });

    if (window.innerWidth <= 760) setCollapsed(true, true);

    return state;
  }

  /* ---------- layout ---------- */
  function setModeControls() {
    if (!el.view) return;
    el.view.classList.toggle('pixel', state.pixelArt);
    el.px.disabled = !state.pixelArt;
    el.dither.disabled = !state.pixelArt;
    if (el.pxRow) el.pxRow.classList.toggle('dim', !state.pixelArt);
    setToggle(el.tPixel, state.pixelArt);
    setToggle(el.tDither, state.ditherOn && state.pixelArt);
  }

  function layout(o) {
    var stage = document.getElementById('stage');
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var compact = sw <= 760;
    var reserveW = compact ? 24 : (state.collapsed ? 56 : 352);
    var reserveH = compact ? 72 : 108;
    var availW = Math.max(260, sw - reserveW);
    var availH = Math.max(180, sh - reserveH);
    // Keep a cinematic canvas on phones instead of a tall, narrow crop.
    var aspect = C.clamp(sw / sh, 1.25, 1.9);
    var iw, ih, cssW, cssH;

    if (o.pixelArt) {
      var px = Math.max(2, o.px || 3);
      var maxW = Math.min(640, Math.floor(availW / px));
      var maxH = Math.floor(availH / px);
      iw = Math.max(260, maxW);
      ih = Math.round(iw / aspect);
      if (ih > maxH) { ih = Math.max(120, maxH); iw = Math.round(ih * aspect); }
      cssW = iw * px;
      cssH = ih * px;
      if (cssW > availW) { cssW = availW; cssH = Math.round(cssW / aspect); }
    } else {
      var res = o.res || { w: 1024, h: 576 };
      iw = Math.min(res.w, Math.ceil(availW));
      ih = Math.round(iw / aspect);
      if (ih > res.h) { ih = res.h; iw = Math.round(ih * aspect); }
      iw = Math.max(260, iw);
      ih = Math.max(150, ih);
      var scale = Math.min(availW / iw, availH / ih);
      cssW = Math.round(iw * scale);
      cssH = Math.round(ih * scale);
    }

    el.view.style.width = cssW + 'px';
    el.view.style.height = cssH + 'px';
    el.frame.style.width = cssW + 'px';
    el.frame.style.height = cssH + 'px';
    return { iw: iw, ih: ih, scale: o.pixelArt ? (o.px || 3) : 1, cssW: cssW, cssH: cssH };
  }

  function setScaleLabel(pixelArt, quality, px) {
    state.quality = quality;
    if (pixelArt) {
      el.outPx.textContent = (px || 3) + ' px';
      el.px.disabled = false;
    } else {
      el.outPx.textContent = 'Q' + quality;
      el.px.disabled = true;
    }
  }

  function setPixelMode(on) {
    state.pixelArt = !!on;
    setModeControls();
  }

  function setDither(on, amount) {
    if (amount !== undefined) {
      state.ditherAmount = amount;
      el.dither.value = amount;
      el.outDither.textContent = Number(amount).toFixed(2);
    }
    state.ditherOn = !!on;
    setModeControls();
  }

  function setSeed(v) {
    state.seed = v;
    el.seed.value = v;
  }

  function setCount(v) {
    state.count = v;
    el.count.value = v;
    el.outCount.textContent = v.toLocaleString('en-US');
  }

  /* ---------- loading ---------- */
  function setTitle(t) { el.loadTitle.textContent = t; }

  function progress(p, msg, sub) {
    var pct = Math.round(Math.max(2, Math.min(100, p * 100)));
    el.loadBar.style.width = pct + '%';
    var track = el.loadBar.parentNode;
    if (track) track.setAttribute('aria-valuenow', String(pct));
    if (msg !== undefined) el.loadMsg.textContent = msg;
    if (sub !== undefined) el.loadSub.textContent = sub;
  }

  function compact(on) {
    el.loading.classList.toggle('compact', !!on);
  }

  function hideLoading() {
    el.loading.classList.add('hidden');
    el.loading.setAttribute('aria-hidden', 'true');
  }

  function showLoading(title, msg) {
    el.loading.classList.remove('hidden', 'compact');
    el.loading.style.display = '';
    el.loading.setAttribute('aria-hidden', 'false');
    if (title) setTitle(title);
    if (msg) el.loadMsg.textContent = msg;
    el.loadBar.style.width = '2%';
  }

  /* ---------- panel state ---------- */
  function setRealm(id) {
    state.realm = id;
    document.body.setAttribute('data-realm', id);
    el.tabs.forEach(function (t) {
      var active = t.getAttribute('data-realm') === id;
      t.classList.toggle('on', active);
      t.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setCollapsed(on, silent) {
    state.collapsed = !!on;
    el.panel.classList.toggle('collapsed', state.collapsed);
    el.panel.setAttribute('aria-hidden', state.collapsed ? 'true' : 'false');
    if (state.collapsed) el.panel.setAttribute('inert', '');
    else el.panel.removeAttribute('inert');
    el.btnReopen.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
    document.body.classList.toggle('panel-collapsed', state.collapsed);
    if (silent) return;
    ER.bus.emit('action', 'relayout');
    if (state.collapsed) el.btnReopen.focus({ preventScroll: true });
    else el.btnCollapse.focus({ preventScroll: true });
  }

  function showContextLost(on) {
    if (el.contextLost) el.contextLost.classList.toggle('show', !!on);
  }

  function isCollapsed() { return state.collapsed; }

  function setHash(h) { el.hash.textContent = 'HASH ' + h; }

  /* ---------- stats ---------- */
  function stats(o) {
    if (o.fps !== undefined) {
      el.s.fps.textContent = o.fps.toFixed(0);
      spark.push(o.fps);
      if (spark.length > SPARK_N) spark.shift();
      drawSpark();
    }
    if (o.frame !== undefined) el.s.frame.textContent = o.frame.toFixed(1) + ' ms';
    if (o.splats !== undefined) el.s.splats.textContent = o.splats.toLocaleString('en-US');
    if (o.res !== undefined) el.s.res.textContent = o.res;
    if (o.sort !== undefined) el.s.sort.textContent = o.sort.toFixed(1) + ' ms';
    if (o.gen !== undefined) el.s.gen.textContent = o.gen.toFixed(0) + ' ms';
  }

  function drawSpark() {
    var g = el.gctx, w = el.graph.width, h = el.graph.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0f0c15';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2436';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h - 12.5);
    g.lineTo(w, h - 12.5);
    g.stroke();

    var n = spark.length;
    if (n < 2) return;
    var step = w / (SPARK_N - 1);
    // bars, pixel-art style
    for (var i = 0; i < n; i++) {
      var v = C.clamp(spark[i] / 75, 0, 1);
      var bh = Math.max(1, Math.round(v * (h - 3)));
      var x = Math.round(i * step);
      g.fillStyle = spark[i] > 52 ? '#9fbb78' : (spark[i] > 34 ? '#c8b06a' : '#b5654a');
      g.fillRect(x, h - bh, Math.max(1, Math.round(step) - 1), bh);
    }
  }

  function debug(text, on) {
    el.debug.textContent = text;
    el.debug.style.display = on ? 'block' : 'none';
  }

  ER.ui = {
    init: init, layout: layout, progress: progress, compact: compact,
    hideLoading: hideLoading, showLoading: showLoading, setTitle: setTitle,
    setRealm: setRealm, setCollapsed: setCollapsed, isCollapsed: isCollapsed,
    setScaleLabel: setScaleLabel, setPixelMode: setPixelMode, setDither: setDither,
    setSeed: setSeed, setCount: setCount, showContextLost: showContextLost,
    stats: stats, setHash: setHash, debug: debug, state: state
  };
})(window.ER = window.ER || {});
