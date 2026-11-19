/* main.js — boot, realm switching, input, the frame loop. */
(function (ER) {
  'use strict';
  var C = ER.core;

  var qp = new URLSearchParams(location.search);
  var Q = {
    realm: qp.get('realm'),
    seed: qp.get('seed'),
    count: qp.get('count') ? parseInt(qp.get('count'), 10) : null,
    px: qp.get('px') ? parseInt(qp.get('px'), 10) : null,
    freeze: qp.get('freeze') === '1',
    quality: qp.get('quality') !== null ? parseInt(qp.get('quality'), 10) : null,
    view: qp.get('view') || 'normal',
    sort: qp.get('sort') !== 'off',
    debug: qp.get('debug') === '1',
    selftest: qp.get('selftest') === '1',
    yaw: qp.get('yaw') ? parseFloat(qp.get('yaw')) : null,
    pitch: qp.get('pitch') ? parseFloat(qp.get('pitch')) : null,
    dist: qp.get('dist') ? parseFloat(qp.get('dist')) : null
  };

  var app = {
    state: 'boot', realm: 'erdtree', seed: 'aster',
    count: 60000, time: 0, paused: false,
    fps: 0, frameMs: 16.7, genMs: 0, sortMs: 0,
    dirtySort: true, lastStats: 0, autoQuality: true, lowFor: 0, highFor: 0,
    cache: {}, cacheOrder: []
  };

  var R, cam, UI, S, canvas, lastT = 0;

  /* ---------------- boot ---------------- */
  function boot() {
    canvas = document.getElementById('view');
    UI = ER.ui;
    S = ER.ui.init();
    if (Q.realm && ER.sdf.scenes[Q.realm]) app.realm = Q.realm;
    if (Q.seed) app.seed = Q.seed;
    if (Q.count) {
      app.count = Q.count; S.count = Q.count;
      document.getElementById('count').value = Q.count;
      document.getElementById('count-out').textContent = Q.count.toLocaleString('en-US');
    }
    if (Q.px) {
      S.px = Q.px;
      document.getElementById('px').value = Q.px;
      document.getElementById('px-out').textContent = Q.px + ' px';
    }
    document.getElementById('seed').value = app.seed;
    UI.setRealm(app.realm);

    try {
      R = ER.render.init(canvas);
    } catch (e) {
      document.getElementById('load-msg').textContent = 'webgl2 unavailable — ' + e.message;
      return;
    }
    if (Q.quality !== null) { S.px = R.setQuality(Q.quality); app.autoQuality = false; }
    R.opts.viewMode = Q.view === 'normals' ? 1 : Q.view === 'ao' ? 2 : Q.view === 'depth' ? 3 : 0;
    if (qp.get('pa') === '0') R.opts.pixelArt = 0;
    if (qp.get('dith') !== null) R.opts.dither = parseFloat(qp.get('dith'));
    if (qp.get('fade')) R.opts.fade = parseFloat(qp.get('fade'));

    var scene = ER.sdf.scenes[app.realm];
    cam = ER.camera.create(scene.camera);
    cam.auto = !Q.freeze;
    cam.paused = Q.freeze;
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
      if (p.key === 'size') { R.splatScale = p.value; app.dirtySort = true; }
      else if (p.key === 'px') { app.autoQuality = false; relayout(); }
      else if (p.key === 'dither') { R.opts.dither = p.value; }
      else if (p.key === 'count') { app.count = p.value; }
    });
    ER.bus.on('toggle', function (t) {
      if (t.key === 'pixelArt') R.opts.pixelArt = t.value ? 1 : 0;
      else if (t.key === 'splatView') R.opts.splatView = t.value ? 1 : 0;
      else if (t.key === 'animate') R.opts.animate = t.value ? 1 : 0;
      else if (t.key === 'autoOrbit') cam.auto = t.value;
      else if (t.key === 'dither') R.opts.dither = t.value ? S.dither : 0;
    });
    ER.bus.on('action', function (a) {
      if (a === 'reset') { cam.reset(ER.sdf.scenes[app.realm].camera, 650); app.dirtySort = true; }
      else if (a === 'relayout') relayout();
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
    var L = ER.ui.layout(S.px);
    R.resize(L.iw, L.ih);
    if (R.scene) R.applySky(R.scene);
    UI.stats({ res: L.iw + '\u00d7' + L.ih });
    app.dirtySort = true;
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
    });
    function up(e) {
      if (!dragging) return;
      dragging = 0;
      canvas.style.cursor = 'grab';
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.wheel(e.deltaY);
      app.dirtySort = true;
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      var k = e.key;
      if (k === '1') ER.bus.emit('realm', 'erdtree');
      else if (k === '2') ER.bus.emit('realm', 'limgrave');
      else if (k === '3') ER.bus.emit('realm', 'caelid');
      else if (k === 'h' || k === 'H') ER.ui.setCollapsed(!ER.ui.isCollapsed());
      else if (k === 'r' || k === 'R') ER.bus.emit('action', 'reset');
      else if (k === ' ') {
        e.preventDefault();
        app.paused = !app.paused;
        cam.paused = app.paused;
      }
    });
  }

  /* ---------------- loop ---------------- */
  function loop(t) {
    requestAnimationFrame(loop);
    var now = C.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (!app.paused) app.time += dt;
    var moved = cam.update(dt);

    if (Q.sort && (moved || app.dirtySort) && app.time !== undefined) {
      R.sort(cam);
      app.dirtySort = false;
    }
    R.draw(cam, app.time, R.w / R.h);
    ER.app.renderer = R;
    ER.app.renderer = R;

    if (Q.debug && !app._diag) {
      app._diag = true;
      ER.ui.debug('webgl2 · ' + R.renderer + '\n' + R.diagnose(), true);
    }

    app.frameMs = app.frameMs * 0.9 + (dt * 1000) * 0.1;
    app.fps = 1000 / Math.max(0.1, app.frameMs);

    if (now - app.lastStats > 240) {
      app.lastStats = now;
      UI.stats({
        fps: app.fps, frame: app.frameMs, sort: R.sortMs,
        splats: R.count, res: R.w + '\u00d7' + R.h
      });
      autoQuality(dt, now);
    }
  }

  function autoQuality(dt) {
    if (!app.autoQuality || Q.quality !== null) return;
    if (app.fps < 33) { app.lowFor += dt; app.highFor = 0; }
    else if (app.fps > 56) { app.highFor += dt; app.lowFor = 0; }
    else { app.lowFor = Math.max(0, app.lowFor - dt * 0.5); }

    if (app.lowFor > 3.4 && R.quality > 1) {
      R.quality--;
      R.setQuality(R.quality);
      S.px = 4 + (3 - R.quality);
      document.getElementById('px').value = S.px;
      document.getElementById('px-out').textContent = S.px + ' px';
      relayout();
      app.lowFor = 0;
    } else if (app.highFor > 6 && R.quality < 3) {
      R.quality++;
      R.setQuality(R.quality);
      S.px = 4 + (3 - R.quality);
      document.getElementById('px').value = S.px;
      document.getElementById('px-out').textContent = S.px + ' px';
      relayout();
      app.highFor = 0;
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
