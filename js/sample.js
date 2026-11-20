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
      ori: new Float32Array(cap),
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
      B.ao = d(B.ao, 1); B.ori = d(B.ori, 1);
      B.cap = nc;
    }

    B.push = function (x, y, z, nx, ny, nz, matKey, rScale, aScale, anim, phase) {
      if (B.count >= B.cap) grow();
      var i = B.count++, i3 = i * 3;
      var m = B._matCache[matKey];
      if (!m) {
        var src = B.mats[matKey];
        if (!src) {
          // Never substitute an arbitrary ground material: Caelid has no
          // GROUND entry, and a silent fallback made missing points invisible.
          if (window.ER && ER.ui && ER.ui.debug) ER.ui.debug('unknown material: ' + matKey, true);
          throw new Error('unknown material: ' + matKey);
        }
        m = B._matCache[matKey] = {
          c: C.hexLin ? C.hexLin(src.color) : C.hexToRgb(src.color), r: src.r, a: src.a,
          glow: src.glow || 0, noAO: !!src.noAO, vary: src.vary || 0, nJit: src.nJit || 0
        };
      }

      // A little normal grain: without it, a smooth cylinder shows a single
      // hard highlight band instead of reading as bark. Applied once only.
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
        // Seven taps, but instead of a binary cut we keep the closest
        // distance/step ratio. That turns the old stamped black patch into a
        // soft penumbra while costing exactly the same number of samples.
        var macro2 = B.macro, pen = 1;
        for (var s = 0; s < 7; s++) {
          var d = macro2(x + L[0] * SUN_T[s], y + L[1] * SUN_T[s], z + L[2] * SUN_T[s]);
          if (d < 0.015) { pen = 0; break; }
          pen = Math.min(pen, 7.5 * d / SUN_T[s]);
        }
        sh = (ER.flags && ER.flags.softshadow === false)
          ? (pen < 0.001 ? 0.22 : 1)
          : 0.24 + 0.76 * C.clamp(pen, 0, 1);
      }

      var sky = 0.5 + 0.5 * ny;
      // Two lights: a directional key tinted by the realm's sun, plus a
      // hemispheric bounce tinted by its ambient.
      var kd = (0.10 + 0.90 * key) * (0.55 + 0.45 * sh) * ao;
      var ka = (0.36 + 0.44 * sky) * (0.45 + 0.55 * sh) * ao;
      var lr = B.lc[0] * kd + B.ac[0] * ka;
      var lg = B.lc[1] * kd + B.ac[1] * ka;
      var lb = B.lc[2] * kd + B.ac[2] * ka;

      // Glow keeps its own hue instead of collapsing every emissive surface
      // toward the same chalk-white core.
      var g = m.glow * 0.42; if (g > 1) g = 1;
      if (g > 0) {
        var tgtR = m.c[0] * 2.4 + 0.12;
        var tgtG = m.c[1] * 1.65 + 0.08;
        var tgtB = m.c[2] * 1.05 + 0.04;
        lr += (tgtR - lr) * g; lg += (tgtG - lg) * g; lb += (tgtB - lb) * g;
      }

      var jit = 0.972 + B.rng() * 0.056;
      var cr = m.c[0] * lr * jit, cg = m.c[1] * lg * jit, cb = m.c[2] * lb * jit;
      if (m.vary) {
        var tv = 0.84 + 0.30 * C.noise2(x * 0.21, z * 0.21, B.tintSeed);
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
      // Zero for loose particles, near one for actual surfaces. The splat
      // vertex shader uses this to turn a world normal into a screen-space
      // ellipse without a full 3D covariance representation.
      B.ori[i] = anim ? 0 : (m.noAO ? 0.55 : 0.9);
      return i;
    };

    return B;
  }

  /* Copy already-baked points when a generator lands a little short. This is
     deliberately not routed through push(): re-sampling a material would
     change the baked light and could reference a material the realm lacks. */
  function cloneRange(B, start, target) {
    if (target <= start || B.count <= start) return;
    var n = B.count, guard = 0;
    while (B.count < target && guard++ < (target - start) * 4) {
      var src = start + ((B.rng() * (n - start)) | 0);
      if (src >= n) src = start;
      var dst = B.count++, s3 = src * 3, d3 = dst * 3;
      B.pos[d3] = B.pos[s3] + (B.rng() - 0.5) * 0.018;
      B.pos[d3 + 1] = B.pos[s3 + 1] + (B.rng() - 0.5) * 0.018;
      B.pos[d3 + 2] = B.pos[s3 + 2] + (B.rng() - 0.5) * 0.018;
      B.nor[d3] = B.nor[s3]; B.nor[d3 + 1] = B.nor[s3 + 1]; B.nor[d3 + 2] = B.nor[s3 + 2];
      B.col[d3] = B.col[s3]; B.col[d3 + 1] = B.col[s3 + 1]; B.col[d3 + 2] = B.col[s3 + 2];
      B.rad[dst] = B.rad[src] * 0.96;
      B.alp[dst] = B.alp[src] * 0.86;
      B.ani[dst] = B.ani[src];
      B.pha[dst] = B.pha[src];
      B.ao[dst] = B.ao[src];
      B.ori[dst] = B.ori[src];
    }
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
    B.lc = C.hexLin(scene.lightCol || '#ffffff');
    B.ac = C.hexLin(scene.ambient || '#333333');
    B.aoAmt = scene.aoAmt === undefined ? 1 : scene.aoAmt;
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
          var start = B.count;
          e.fn(B, q, B.rng);
          // An emitter owns exactly its quota. Excess fixed-detail points are
          // trimmed here instead of allowing the final global clamp to delete
          // later emitters (rain, ash, motes, banners).
          if (B.count > start + q) B.count = start + q;
          else if (B.count < start + q) cloneRange(B, start, start + q);
        }
        em++;
        if (C.now() - t0 > 12) break;
      }
      if (onProgress) onProgress(0.08 + 0.78 * (em / scene.emit.length), em, scene.emit.length);
      if (em < scene.emit.length) return nextFrame().then(step);

      // Safety pad. Normal operation should already be exact, but if every
      // emitter somehow lands short we copy baked points rather than assume a
      // material that the current realm may not define.
      if (B.count < target) cloneRange(B, 0, target);
      if (B.count > target) B.count = target;

      B.hash = hashCloud(B);
      if (onProgress) onProgress(1, scene.emit.length, scene.emit.length);
      return B;
    }
    return step();
  }

  ER.sample = { build: build, quotas: quotas };
})(window.ER = window.ER || {});
