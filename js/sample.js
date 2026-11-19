/* sample.js — turns a realm definition into a point cloud.
   Two phases per point: place it on a surface, then bake light into it.
   Deterministic: same realm+seed+count always yields the same hash. */
(function (ER) {
  'use strict';
  var C = ER.core;

  var HA = [0.02, 0.09, 0.24, 0.55, 1.10];   // AO tap heights
  var AO_W = [1.0, 0.72, 0.52, 0.37, 0.27];
  var SUN_T = [0.5, 1.04, 1.80, 2.90, 4.40, 6.60, 9.80];

  function makeCloud(cap) {
    var B = {
      cap: cap, count: 0,
      pos: new Float32Array(cap * 3),
      nor: new Float32Array(cap * 3),
      col: new Float32Array(cap * 3),
      rad: new Float32Array(cap),
      alp: new Float32Array(cap),
      ani: new Float32Array(cap),
      pha: new Float32Array(cap),
      ao: new Float32Array(cap),
      rng: Math.random,
      scene: null, macro: null, L: [0, 1, 0], lc: [1, 1, 1], ac: [0.2, 0.2, 0.2],
      shadow: false, aoAmt: 1,
      mats: null, _matCache: {}
    };

    function grow() {
      var nc = B.cap * 2;
      var d = function (a, k) { var b = new Float32Array(nc * k); b.set(a); return b; };
      B.pos = d(B.pos, 3); B.nor = d(B.nor, 3); B.col = d(B.col, 3);
      B.rad = d(B.rad, 1); B.alp = d(B.alp, 1); B.ani = d(B.ani, 1); B.pha = d(B.pha, 1);
      B.ao = d(B.ao, 1);
      B.cap = nc;
    }

    B.push = function (x, y, z, nx, ny, nz, matKey, rScale, aScale, anim, phase) {
      if (B.count >= B.cap) grow();
      var i = B.count++, i3 = i * 3;
      var m = B._matCache[matKey];
      if (!m) {
        var src = B.mats[matKey] || B.mats.GROUND;
        m = B._matCache[matKey] = {
          c: C.hexToRgb(src.color), r: src.r, a: src.a,
          glow: src.glow || 0, noAO: !!src.noAO, vary: src.vary || 0, nJit: src.nJit || 0, nJit: src.nJit || 0
        };
      }

      // a little normal grain: without it, a smooth cylinder shows a single
      // hard highlight band instead of reading as bark
      if (m.nJit) {
        var jn = m.nJit;
        nx += (C.noise2(y * 2.7, x * 2.7, 7) - 0.5) * jn;
        ny += (C.noise2(z * 2.7, y * 2.7, 13) - 0.5) * jn;
        nz += (C.noise2(x * 2.7, z * 2.7, 19) - 0.5) * jn;
        var nl = 1 / (Math.hypot(nx, ny, nz) || 1);
        nx *= nl; ny *= nl; nz *= nl;
      }

      // a little normal grain: without it, a smooth cylinder shows a single
      // hard highlight band instead of reading as bark
      if (m.nJit) {
        var jn = m.nJit;
        nx += (C.noise2(y * 2.7, x * 2.7, 7) - 0.5) * jn;
        ny += (C.noise2(z * 2.7, y * 2.7, 13) - 0.5) * jn;
        nz += (C.noise2(x * 2.7, z * 2.7, 19) - 0.5) * jn;
        var nl = 1 / (Math.hypot(nx, ny, nz) || 1);
        nx *= nl; ny *= nl; nz *= nl;
      }

      var L = B.L;
      var key = nx * L[0] + ny * L[1] + nz * L[2];
      if (key < 0) key = 0;

      var ao = 1;
      if (!m.noAO && B.aoAmt > 0) {
        var occ = 0, h, sca = 1, macro = B.macro;
        for (var k = 0; k < 5; k++) {
          h = HA[k];
          occ += (h - macro(x + nx * h, y + ny * h, z + nz * h)) * AO_W[k];
          sca *= 0.9;
        }
        ao = 1 - 1.9 * occ;
        if (ao < 0.12) ao = 0.12; else if (ao > 1) ao = 1;
        if (B.aoAmt < 1) ao = 1 + (ao - 1) * B.aoAmt;
      }

      var sh = 1;
      if (B.shadow) {
        var t = 0.5, macro2 = B.macro, blocked = false;
        for (var s = 0; s < 7; s++) {
          var d = macro2(x + L[0] * SUN_T[s], y + L[1] * SUN_T[s], z + L[2] * SUN_T[s]);
          if (d < 0.10) { blocked = true; break; }
          t = SUN_T[s];
        }
        if (blocked) sh = 0.22;
      }

      var sky = 0.5 + 0.5 * ny;
      // two lights: a directional key tinted by the realm's sun, plus a
      // hemispheric bounce tinted by its ambient. This is what stops every
      // realm from turning into a single flat hue.
      var kd = (0.07 + 0.93 * key) * sh * ao;
      var ka = (0.40 + 0.42 * sky) * (0.38 + 0.62 * sh) * ao;
      var lr = B.lc[0] * kd + B.ac[0] * ka;
      var lg = B.lc[1] * kd + B.ac[1] * ka;
      var lb = B.lc[2] * kd + B.ac[2] * ka;

      var g = m.glow * 0.55; if (g > 1) g = 1;
      if (g > 0) {
        var tgt = 1.2;
        lr += (tgt - lr) * g; lg += (tgt - lg) * g; lb += (tgt - lb) * g;
      }

      var jit = 0.93 + B.rng() * 0.14;
      var cr = m.c[0] * lr * jit, cg = m.c[1] * lg * jit, cb = m.c[2] * lb * jit;
      if (m.vary) {
        var tv = 0.70 + 0.58 * C.noise2(x * 0.21, z * 0.21, B.tintSeed);
        cr *= tv; cg *= tv; cb *= tv;
      }

      B.pos[i3] = x; B.pos[i3 + 1] = y; B.pos[i3 + 2] = z;
      B.nor[i3] = nx; B.nor[i3 + 1] = ny; B.nor[i3 + 2] = nz;
      B.col[i3] = cr; B.col[i3 + 1] = cg; B.col[i3 + 2] = cb;
      B.rad[i] = m.r * (rScale === undefined ? 1 : rScale) * (0.78 + B.rng() * 0.44);
      B.alp[i] = m.a * (aScale === undefined ? 1 : aScale) * (0.86 + B.rng() * 0.26);
      B.ani[i] = anim || 0;
      B.pha[i] = phase === undefined ? B.rng() * C.TAU : phase;
      B.ao[i] = ao * sh;
      return i;
    };

    return B;
  }

  function quotas(emitters, total) {
    var sum = 0, i;
    for (i = 0; i < emitters.length; i++) sum += emitters[i].weight;
    var out = [], acc = 0, frac = [];
    for (i = 0; i < emitters.length; i++) {
      var v = total * emitters[i].weight / sum;
      var f = Math.floor(v);
      out.push(f); acc += f;
      frac.push({ i: i, f: v - f });
    }
    frac.sort(function (a, b) { return b.f - a.f; });
    for (i = 0; i < total - acc; i++) out[frac[i % frac.length].i]++;
    return out;
  }

  function hashCloud(B) {
    var h = 0x811c9dc5, n = B.count, i;
    var step = n > 20000 ? 7 : 1;
    for (i = 0; i < n; i += step) {
      h ^= (B.pos[i * 3] * 7919) | 0;
      h = Math.imul(h, 0x01000193);
      h ^= (B.pos[i * 3 + 1] * 7919) | 0;
      h = Math.imul(h, 0x01000193);
      h ^= (B.col[i * 3] * 4093) | 0;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  var nextFrame = function () {
    return new Promise(function (r) { setTimeout(r, 0); });
  };

  /* build(scene, seedText, target, onProgress) -> Promise<cloud> */
  function build(scene, seedText, target, onProgress) {
    var B = makeCloud(Math.ceil(target * 1.12));
    B.scene = scene;
    B.macro = scene.macro;
    B.L = scene.light;
    B.mats = scene.mats;
    B.lc = C.hexToRgb(scene.lightCol || '#ffffff');
    B.ac = C.hexToRgb(scene.ambient || '#333333');
    B.aoAmt = scene.aoAmt === undefined ? 1 : scene.aoAmt;
    B.tintSeed = C.fnv1a(scene.id) & 0xffff;
    B.tintSeed = C.fnv1a(scene.id) & 0xffff;

    var qs = quotas(scene.emit, target);
    var total = 0, i;
    for (i = 0; i < qs.length; i++) total += qs[i];

    var em = 0;
    function step() {
      var t0 = C.now();
      while (em < scene.emit.length) {
        var e = scene.emit[em];
        var q = qs[em];
        if (q > 0) {
          B.rng = C.mulberry32(C.fnv1a(scene.id + '|' + seedText + '|' + e.name + '|' + target));
          B.shadow = !!e.shadow;
          e.fn(B, q, B.rng);
        }
        em++;
        if (C.now() - t0 > 12) break;
      }
      if (onProgress) onProgress(0.08 + 0.78 * (em / scene.emit.length), em, scene.emit.length);
      if (em < scene.emit.length) return nextFrame().then(step);

      // safety pad: keep the readout honest if a generator came up short
      var guard = 0;
      while (B.count < target && guard++ < target * 3) {
        var j = (B.rng() * B.count) | 0;
        B.push(B.pos[j * 3] + (B.rng() - 0.5) * 0.04,
               B.pos[j * 3 + 1] + (B.rng() - 0.5) * 0.04,
               B.pos[j * 3 + 2] + (B.rng() - 0.5) * 0.04,
               B.nor[j * 3], B.nor[j * 3 + 1], B.nor[j * 3 + 2],
               'GROUND', 1, 0.6, 0, B.pha[j]);
      }
      if (B.count > target) B.count = target;

      B.hash = hashCloud(B);
      if (onProgress) onProgress(1, scene.emit.length, scene.emit.length);
      return B;
    }
    return step();
  }

  ER.sample = { build: build, quotas: quotas };
})(window.ER = window.ER || {});
