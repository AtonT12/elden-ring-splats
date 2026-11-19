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
    count: 60000,
    size: 1,
    px: 3,
    dither: 0.6,
    pixelArt: true,
    splatView: false,
    animate: true,
    autoOrbit: true,
    collapsed: false
  };
  var spark = [];
  var SPARK_N = 84;

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
    el.loading = $('loading');
    el.loadBar = $('load-bar');
    el.loadMsg = $('load-msg');
    el.loadSub = $('load-sub');
    el.loadTitle = $('load-title');
    el.frame = $('frame');
    el.view = $('view');
    el.debug = $('debug');
    el.hash = $('foot-hash');
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
        out.innerHTML = fmt(v);
        if (emit) emit(v);
        ER.bus.emit('param', { key: key, value: v });
      });
    }
    slider(el.count, el.outCount, 'count', function (v) { return v.toLocaleString('en-US'); });
    slider(el.size, el.outSize, 'size', function (v) { return v.toFixed(2) + '&times;'; });
    slider(el.px, el.outPx, 'px', function (v) { return v + ' px'; });
    slider(el.dither, el.outDither, 'dither', function (v) { return v.toFixed(2); },
      function (v) {
        if (state.dither !== 0 && v === 0) { /* keep the toggle in sync */ }
        ER.bus.emit('toggle', { key: 'dither', value: v > 0 });
      });

    /* ---- toggles ---- */
    function toggle(btn, key, onChange) {
      btn.addEventListener('click', function () {
        var on = !btn.classList.contains('on');
        btn.classList.toggle('on', on);
        state[key] = on;
        if (onChange) onChange(on);
        ER.bus.emit('toggle', { key: key, value: on });
      });
    }
    toggle(el.tPixel, 'pixelArt');
    toggle(el.tSplat, 'splatView');
    toggle(el.tDither, 'dither');
    toggle(el.tAnim, 'animate');
    toggle(el.tRotate, 'autoOrbit');
    el.btnReset.addEventListener('click', function () {
      el.btnReset.classList.add('on');
      setTimeout(function () { el.btnReset.classList.remove('on'); }, 150);
      ER.bus.emit('action', 'reset');
    });

    window.addEventListener('resize', function () { ER.bus.emit('action', 'relayout'); });

    return state;
  }

  /* ---------- layout ---------- */
  function layout(pxSize) {
    var stage = document.getElementById('stage');
    var sw = stage.clientWidth, sh = stage.clientHeight;
    var availW = Math.min(sw * 0.92, sw - 340), availH = sh * 0.88;
    // pixel size is the on-screen size of one internal pixel, so the canvas
    // is exactly internal * px across. fit by height first to keep the aspect.
    var ih = Math.max(80, Math.floor(availH / pxSize));
    var iw = Math.round(ih * sw / sh);
    if (iw * pxSize > availW) {
      iw = Math.floor(availW / pxSize);
      ih = Math.round(iw * sh / sw);
    }
    if (iw > 640) { iw = 640; ih = Math.round(iw * sh / sw); }
    if (iw < 280) { iw = 280; ih = Math.round(iw * sh / sw); }
    var cssW = iw * pxSize, cssH = ih * pxSize;
    el.view.style.width = cssW + 'px';
    el.view.style.height = cssH + 'px';
    el.frame.style.width = cssW + 'px';
    el.frame.style.height = cssH + 'px';
    return { iw: iw, ih: ih, scale: pxSize, cssW: cssW, cssH: cssH };
  }

  /* ---------- loading ---------- */
  function setTitle(t) { el.loadTitle.textContent = t; }

  function progress(p, msg, sub) {
    el.loadBar.style.width = (Math.max(2, Math.min(100, p * 100))) + '%';
    if (msg !== undefined) el.loadMsg.textContent = msg;
    if (sub !== undefined) el.loadSub.textContent = sub;
  }

  function compact(on) {
    el.loading.classList.toggle('compact', !!on);
  }

  function hideLoading() {
    el.loading.classList.add('hidden');
  }

  function showLoading(title, msg) {
    el.loading.classList.remove('hidden', 'compact');
    el.loading.style.display = '';
    if (title) setTitle(title);
    if (msg) el.loadMsg.textContent = msg;
    el.loadBar.style.width = '2%';
  }

  /* ---------- panel state ---------- */
  function setRealm(id) {
    state.realm = id;
    el.tabs.forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-realm') === id);
    });
  }

  function setCollapsed(on) {
    state.collapsed = on;
    el.panel.classList.toggle('collapsed', on);
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
    stats: stats, setHash: setHash, debug: debug, state: state
  };
})(window.ER = window.ER || {});
