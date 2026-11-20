/* main.js — boot, realm switching, input, the frame loop. */
(function (ER) {
  'use strict';
  var C = ER.core;

  var qp = new URLSearchParams(location.search);
  function qInt(name, fallback, lo, hi) {
    if (qp.get(name) === null) return fallback;
    var n = parseInt(qp.get(name), 10);
    if (!isFinite(n)) n = fallback;
    return C.clamp(n, lo, hi);
  }
  function qNum(name, fallback, lo, hi) {
    if (qp.get(name) === null) return fallback;
    var n = parseFloat(qp.get(name));
    if (!isFinite(n)) n = fallback;
    return C.clamp(n, lo, hi);
  }
  var Q = {
    realm: qp.get('realm'),
    seed: qp.get('seed'),
    count: qInt('count', null, 20000, 90000),
    px: qInt('px', null, 2, 8),
    freeze: qp.get('freeze') === '1',
    quality: qInt('quality', null, 0, 3),
    view: qp.get('view') || 'normal',
    sort: qp.get('sort') !== 'off',
    sortHz: qInt('sortHz', 15, 4, 60),
    debug: qp.get('debug') === '1',
    selftest: qp.get('selftest') === '1',
    orient: qp.get('orient') !== '0',
    fog2: qp.get('fog2') !== '0',
    dof: qp.get('dof') !== '0',
    bloom: qp.get('bloom') !== '0',
    grade: qp.get('grade') !== '0',
    far: qp.get('far') !== '0',
    terrain: qp.get('terrain') !== '0',
    yaw: qp.get('yaw') ? parseFloat(qp.get('yaw')) : null,
    pitch: qp.get('pitch') ? parseFloat(qp.get('pitch')) : null,
    dist: qp.get('dist') ? parseFloat(qp.get('dist')) : null
  };

  var app = {
    state: 'boot', realm: 'erdtree', seed: 'aster',
    count: 60000, time: 0, paused: false,
    fps: 0, frameMs: 16.7, genMs: 0, sortMs: 0,
    dirtySort: true, lastStats: 0, lastAutoAt: 0, autoQuality: true, lowFor: 0, highFor: 0,
    needsDraw: true, countTimer: 0,
    cache: {}, cacheOrder: []
  };

  var R, cam, UI, S, canvas, lastT = 0, lastSort = 0, relayoutPending = false;
  ER.flags = {
    far: Q.far,
    terrain: Q.terrain,
    fog2: Q.fog2,
    orient: Q.orient,
    softshadow: qp.get('softshadow') !== '0'
  };

  /* ---------------- boot ---------------- */
  function boot() {
    canvas = document.getElementById('view');
    UI = ER.ui;
    S = ER.ui.init();
    if (Q.realm && ER.sdf.scenes[Q.realm]) app.realm = Q.realm;
    if (Q.seed) app.seed = Q.seed;
    if (Q.count) app.count = Q.count;
    if (Q.px) S.px = Q.px;
    UI.setSeed(app.seed);
    UI.setCount(app.count);
    UI.setRealm(app.realm);

    try {
      R = ER.render.init(canvas);
    } catch (e) {
      document.getElementById('load-msg').textContent = 'webgl2 unavailable — ' + e.message;
      return;
    }

    var initialQuality = Q.quality === null
      ? (window.innerWidth >= 1280 ? 3 : 2)
      : Q.quality;
    R.setQuality(initialQuality);
    if (Q.quality !== null) app.autoQuality = false;
    R.opts.viewMode = Q.view === 'normals' ? 1 : Q.view === 'ao' ? 2 : Q.view === 'depth' ? 3 : 0;
    var startPixel = qp.get('pa') === '1';
    var startDitherAmount = qNum('dith', 0.6, 0, 1);
    var startDither = startPixel && startDitherAmount > 0;
    UI.setPixelMode(startPixel);
    UI.setDither(startDither, startDitherAmount);
    UI.setScaleLabel(startPixel, R.quality, S.px);
    S.pixelArt = startPixel;
    S.ditherOn = startDither;
    S.ditherAmount = startDitherAmount;
    R.opts.pixelArt = startPixel ? 1 : 0;
    R.opts.dither = startDither ? startDitherAmount : 0;
    if (qp.get('fade')) R.opts.fade = qNum('fade', 1, 0, 1);
    if (!Q.dof) R.opts.dof = 0;
    if (!Q.bloom) R.opts.bloom = 0;
    if (!Q.orient) R.opts.orient = 0;
    if (Q.freeze) R.opts.animate = 0;

    var scene = ER.sdf.scenes[app.realm];
    cam = ER.camera.create(scene.camera);
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cam.auto = !Q.freeze && !reduceMotion;
    cam.paused = Q.freeze;
    if (!cam.auto) {
      S.autoOrbit = false;
      var tr = document.getElementById('t-rotate');
      tr.classList.remove('on');
      tr.setAttribute('aria-pressed', 'false');
    }
    if (Q.yaw !== null) cam.yaw = Q.yaw;
    if (Q.pitch !== null) cam.pitch = Q.pitch;
    if (Q.dist !== null) { cam.dist = Q.dist; cam.tDist = Q.dist; }

    wireInput();
    relayout();

    ER.ui.showLoading('KINDLING THE ERDTREE', 'reading the golden order');
    ER.ui.progress(0.02, 'reading the golden order', scene.sub);

    staged(build(app.realm, app.seed, app.count, true), scene, Q.freeze ? 260 : 1500, function () {
      app.state = 'ready';
      setTimeout(function () {
        ER.ui.hideLoading();
        document.body.classList.add('ready');
        lastT = C.now();
        requestAnimationFrame(loop);
      }, Q.freeze ? 60 : 420);
    });

    if (Q.debug) {
      ER.ui.debug('webgl2 · ' + R.renderer + '\nfloat target: ' + (R.floatTarget ? 'rgba16f' : 'rgba8'), true);
    }

    /* bus wiring */
    ER.bus.on('realm', function (id) { switchRealm(id); });
    ER.bus.on('seed', function (v) { app.seed = v; rebuild(); });
    ER.bus.on('param', function (p) {
      if (p.key === 'size') { R.splatScale = p.value; app.dirtySort = true; app.needsDraw = true; }
      else if (p.key === 'px') { S.px = p.value; app.autoQuality = false; queueRelayout(); }
      else if (p.key === 'ditherAmount') {
        S.ditherAmount = p.value;
        R.opts.dither = (S.ditherOn && S.pixelArt) ? p.value : 0;
        app.needsDraw = true;
      } else if (p.key === 'count') {
        S.count = p.value;
        app.count = p.value;
        clearTimeout(app.countTimer);
        app.countTimer = setTimeout(rebuild, 520);
      }
    });
    ER.bus.on('toggle', function (t) {
      if (t.key === 'pixelArt') {
        S.pixelArt = t.value;
        R.opts.pixelArt = t.value ? 1 : 0;
        R.opts.dither = (t.value && S.ditherOn) ? S.ditherAmount : 0;
        UI.setPixelMode(t.value);
        UI.setDither(S.ditherOn, S.ditherAmount);
        UI.setScaleLabel(t.value, R.quality, S.px);
        app.needsDraw = true;
        queueRelayout();
      } else if (t.key === 'splatView') {
        R.opts.splatView = t.value ? 1 : 0; app.needsDraw = true;
      } else if (t.key === 'animate') {
        R.opts.animate = t.value ? 1 : 0; app.needsDraw = true;
      } else if (t.key === 'autoOrbit') {
        cam.auto = t.value; app.needsDraw = true;
      } else if (t.key === 'ditherOn') {
        S.ditherOn = t.value;
        R.opts.dither = (t.value && S.pixelArt) ? S.ditherAmount : 0;
        app.needsDraw = true;
      }
    });
    ER.bus.on('action', function (a) {
      if (a === 'reset') {
        cam.reset(ER.sdf.scenes[app.realm].camera, 650);
        app.dirtySort = true; app.needsDraw = true;
      } else if (a === 'relayout') queueRelayout();
    });
  }

  /* ---------------- build ---------------- */
  function cacheKey(id, seed, count) { return id + '|' + seed + '|' + count; }

  function build(id, seed, count, quiet) {
    var key = cacheKey(id, seed, count);
    var scene = ER.sdf.scenes[id];
    var t0 = C.now();

    if (app.cache[key]) {
      var hit = app.cache[key];
      R.applySky(scene);
      R.upload(hit);
      app.genMs = 0;
      UI.setHash(hit.hash);
      UI.stats({ splats: hit.count, res: R.w + '\u00d7' + R.h, gen: 0 });
      return Promise.resolve(hit);
    }

    return ER.sample.build(scene, seed, count, quiet ? null : function (p, i, total) {
      var name = scene.emit[Math.min(i, scene.emit.length - 1)];
      var label = p >= 0.999 ? 'first light'
        : 'sampling ' + (name ? name.name.replace(/([A-Z])/g, ' $1').toLowerCase().trim() : 'the field');
      UI.progress(0.06 + p * 0.9, label, scene.sub);
    }).then(function (cloud) {
      app.genMs = C.now() - t0;
      R.applySky(scene);
      R.upload(cloud);
      UI.setHash(cloud.hash);
      UI.stats({ splats: cloud.count, res: R.w + '\u00d7' + R.h, gen: app.genMs });
      app.cache[key] = cloud;
      app.cacheOrder.push(key);
      while (app.cacheOrder.length > 3) delete app.cache[app.cacheOrder.shift()];
      return cloud;
    });
  }

  /* ---------------- loading timeline ----------------
     The build itself takes ~150ms. Run a paced four-stage sequence on top of
     it so the page has the same rhythm as the reference, without lying about
     what is happening: the bar only reaches 100% once the cloud is in. */
  var STAGES = ['reading the golden order', 'sampling the bough',
                'baking occlusion', 'first light'];

  function staged(promise, scene, minMs, onDone) {
    var t0 = C.now(), built = false, result = null;
    promise.then(function (c) { result = c; built = true; });
    var tick = setInterval(function () {
      var t = Math.min(1, (C.now() - t0) / minMs);
      if (built && t >= 1) {
        clearInterval(tick);
        ER.ui.progress(1, STAGES[3], scene.epigraph);
        onDone(result);
        return;
      }
      var stage = t < 0.40 ? 0 : t < 0.78 ? 1 : 2;
      ER.ui.progress(Math.min(0.94, t * 0.94), STAGES[built ? 2 : stage], scene.sub);
    }, 80);
  }

  /* ---------------- switching ---------------- */
  function switchRealm(id) {
    if (app.state === 'building' || id === app.realm) return;
    app.state = 'building';
    app.realm = id;
    UI.setRealm(id);
    var scene = ER.sdf.scenes[id];
    UI.showLoading('CROSSING INTO ' + scene.label, 'unbinding the old ground');
    UI.compact(true);
    UI.progress(0.03, 'unbinding the old ground', scene.sub);

    cam.reset(scene.camera, 700);
    R.opts.fade = 0.25;

    staged(build(id, app.seed, app.count, true), scene, 1100, function () {
      var t0 = C.now();
      (function fadeIn() {
        var k = Math.min(1, (C.now() - t0) / 160);
        R.opts.fade = 0.25 + 0.75 * k;
        if (k < 1) requestAnimationFrame(fadeIn);
      })();
      app.state = 'ready';
      app.dirtySort = true;
      setTimeout(function () {
        ER.ui.hideLoading();
        ER.ui.compact(false);
      }, 2600);
    });
  }

  function rebuild() {
    if (app.state === 'building') return;
    var id = app.realm, scene = ER.sdf.scenes[id];
    app.state = 'building';
    ER.ui.showLoading('RESHAPING ' + scene.label, 'reseeding the field');
    ER.ui.compact(true);
    staged(build(id, app.seed, app.count, true), scene, 900, function () {
      app.state = 'ready';
      app.dirtySort = true;
      setTimeout(function () { ER.ui.hideLoading(); ER.ui.compact(false); }, 1500);
    });
  }

  /* ---------------- layout ---------------- */
  function relayout() {
    var L = ER.ui.layout({
      pixelArt: S.pixelArt,
      px: S.px,
      res: R.qualitySpec(R.quality)
    });
    R.resize(L.iw, L.ih);
    UI.setScaleLabel(S.pixelArt, R.quality, S.px);
    UI.stats({ res: L.iw + '\u00d7' + L.ih });
    app.dirtySort = true;
    app.needsDraw = true;
  }

  function queueRelayout() {
    if (relayoutPending) return;
    relayoutPending = true;
    requestAnimationFrame(function () {
      relayoutPending = false;
      relayout();
    });
  }

  /* ---------------- input ---------------- */
  function wireInput() {
    var dragging = 0, lx = 0, ly = 0;
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    canvas.addEventListener('pointerdown', function (e) {
      dragging = e.button === 2 ? 2 : 1;
      lx = e.clientX; ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (dragging === 2) cam.pan(dx, dy);
      else cam.drag(dx, dy);
      app.dirtySort = true;
      app.needsDraw = true;
    });
    function up(e) {
      if (!dragging) return;
      dragging = 0;
      canvas.style.cursor = 'grab';
      app.dirtySort = true;
      app.needsDraw = true;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.wheel(e.deltaY);
      app.dirtySort = true;
      app.needsDraw = true;
    }, { passive: false });

    canvas.addEventListener('dblclick', function () {
      ER.bus.emit('action', 'reset');
    });

    window.addEventListener('keydown', function (e) {
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var k = e.key;
      if (k === ' ' && tag === 'BUTTON') return;
      if (k === '1') ER.bus.emit('realm', 'erdtree');
      else if (k === '2') ER.bus.emit('realm', 'limgrave');
      else if (k === '3') ER.bus.emit('realm', 'caelid');
      else if (k === 'h' || k === 'H') ER.ui.setCollapsed(!ER.ui.isCollapsed());
      else if (k === 'r' || k === 'R') ER.bus.emit('action', 'reset');
      else if (k === ' ') {
        e.preventDefault();
        app.paused = !app.paused;
        cam.paused = app.paused;
        app.needsDraw = true;
      }
    });
  }

  /* ---------------- loop ---------------- */
  function loop(t) {
    requestAnimationFrame(loop);
    var now = C.now();
    if (document.hidden) { lastT = now; return; }
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    var animating = !app.paused && R.opts.animate > 0.5;
    if (!app.paused) app.time += dt;
    var moved = cam.update(dt);
    var justResized = app.needsDraw;

    if (Q.sort && (moved || app.dirtySort) && app.time !== undefined) {
      var interval = 1000 / Math.max(4, Q.sortHz);
      // While orbiting, sort at a bounded rate. Once motion stops, a pending
      // dirty flag forces one final exact ordering before the frame is drawn.
      if ((app.dirtySort && !moved) || now - lastSort >= interval) {
        R.sort(cam);
        lastSort = now;
        app.dirtySort = false;
      }
    }

    if (animating || moved || app.dirtySort || justResized || !app.paused || app.forceDraw) {
      R.draw(cam, app.time, R.w / R.h);
      app.needsDraw = false;
      app.forceDraw = false;
    }

    ER.app.renderer = R;

    if (Q.debug && !app._diag) {
      app._diag = true;
      ER.ui.debug('webgl2 · ' + R.renderer + '\n' + R.diagnose(), true);
    }

    // Ignore the first long frame after a tab switch or build pause.
    if (dt < 0.5) {
      app.frameMs = app.frameMs * 0.9 + (dt * 1000) * 0.1;
      app.fps = 1000 / Math.max(0.1, app.frameMs);
    }

    if (now - app.lastStats > 240) {
      app.lastStats = now;
      UI.stats({
        fps: app.fps, frame: app.frameMs, sort: R.sortMs,
        splats: R.count, res: R.w + '\u00d7' + R.h
      });
      autoQuality(now);
    }
  }

  function autoQuality(now) {
    if (!app.autoQuality || Q.quality !== null || app.paused) { app.lastAutoAt = now; return; }
    var elapsed = app.lastAutoAt ? Math.min(1.5, (now - app.lastAutoAt) / 1000) : 0;
    app.lastAutoAt = now;
    if (!elapsed) return;

    if (app.fps < 42) { app.lowFor += elapsed; app.highFor = 0; }
    else if (app.fps > 57) { app.highFor += elapsed; app.lowFor = 0; }
    else {
      app.lowFor = Math.max(0, app.lowFor - elapsed * 0.45);
      app.highFor = Math.max(0, app.highFor - elapsed * 0.25);
    }

    if (app.lowFor > 2.8 && R.quality > 0) {
      R.setQuality(R.quality - 1);
      UI.setScaleLabel(S.pixelArt, R.quality, S.px);
      relayout();
      app.lowFor = 0;
      app.highFor = 0;
    } else if (app.highFor > 8 && R.quality < 3) {
      R.setQuality(R.quality + 1);
      UI.setScaleLabel(S.pixelArt, R.quality, S.px);
      relayout();
      app.highFor = 0;
      app.lowFor = 0;
    }
  }

  /* ---------------- selftest ---------------- */
  function selftest() {
    var pass = 0, fail = 0, lines = [];
    function ok(name, cond) {
      if (cond) { pass++; } else { fail++; lines.push('FAIL ' + name); }
    }
    var m = C.mat4.create();
    C.mat4.perspective(m, 0.7, 1.6, 0.5, 100);
    ok('proj[5]=f', Math.abs(m[5] - 1 / Math.tan(0.35)) < 1e-5);
    ok('proj[11]=-1', Math.abs(m[11] + 1) < 1e-6);
    var view = C.mat4.create();
    C.mat4.lookAt(view, [0, 0, 10], [0, 0, 0], [0, 1, 0]);
    ok('lookAt forward', Math.abs(view[14] + 10) < 1e-5);
    ok('rng deterministic', C.mulberry32(C.fnv1a('a'))() === C.mulberry32(C.fnv1a('a'))());
    ok('rng range', (function () {
      var r = C.mulberry32(7), i, v;
      for (i = 0; i < 500; i++) { v = r(); if (v < 0 || v >= 1) return false; }
      return true;
    })());
    ok('median of rng ~0.5', (function () {
      var r = C.mulberry32(3), s = 0, i;
      for (i = 0; i < 20000; i++) s += r();
      return Math.abs(s / 20000 - 0.5) < 0.01;
    })());

    if (R && R.count) {
      var cloud = R.cloud;
      ok('cloud count exact', cloud.count === app.count && R.count === app.count);
      ok('cloud hash present', /^[0-9A-F]{8}$/.test(cloud.hash || ''));
      ok('orientation present', !!cloud.ori && cloud.ori.length >= cloud.count);
      ok('finite bounds', (function () {
        var k, tail = cloud.count - 1;
        for (k = 0; k < 64; k++) {
          var q = (cloud.count * k / 64) | 0;
          if (!isFinite(cloud.pos[q * 3]) || !isFinite(cloud.pos[q * 3 + 1]) ||
              !isFinite(cloud.col[q * 3]) || !isFinite(cloud.rad[q])) return false;
        }
        return isFinite(cloud.pos[tail * 3 + 2]) && isFinite(cloud.alp[tail]);
      })());

      var ord = R.orderArr, n = R.count, mono = true;
      var p = R.cloud.pos, eye = cam.eye();
      var fx = cam.target[0] - eye[0], fy = cam.target[1] - eye[1], fz = cam.target[2] - eye[2];
      var fl = 1 / Math.hypot(fx, fy, fz);
      fx *= fl; fy *= fl; fz *= fl;
      var prev = 1e9, i, d;
      for (i = 0; i < n; i += 97) {
        var o = ord[i] * 3;
        d = (p[o] - eye[0]) * fx + (p[o + 1] - eye[1]) * fy + (p[o + 2] - eye[2]) * fz;
        if (d > prev + 0.35) { mono = false; break; }
        prev = d;
      }
      ok('sort order monotonic', mono);
      ok('all indices present', (function () {
        var seen = new Uint8Array(n), k;
        for (k = 0; k < n; k++) seen[ord[k]] = 1;
        for (k = 0; k < n; k++) if (!seen[k]) return false;
        return true;
      })());
    }

    var txt = 'SELFTEST  PASS ' + pass + '  FAIL ' + fail +
      (fail ? '\n' + lines.join('\n') : '\nall checks green') +
      '\nrenderer ' + (R ? R.renderer : 'n/a');
    ER.ui.debug(txt, true);
    document.title = 'SELFTEST ' + pass + '/' + (pass + fail);
  }

  ER.app = { boot: boot, app: app, selftest: selftest };
  if (Q.selftest) { window.addEventListener('load', function () { setTimeout(selftest, 1500); }); }
  window.addEventListener('load', boot);
})(window.ER = window.ER || {});
