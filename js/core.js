/* core.js — namespace, math, rng, noise, tiny event bus.
   Loaded first. No dependencies. */
(function (ER) {
  'use strict';

  /* ---------- scalar ---------- */
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var TAU = Math.PI * 2;

  /* ---------- hashing ---------- */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    a |= 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* integer lattice hash -> [0,1) */
  function ihash(x, y, seed) {
    var h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* value noise, [0,1] */
  function noise2(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = smooth(xf), v = smooth(yf);
    var a = ihash(xi, yi, seed), b = ihash(xi + 1, yi, seed);
    var c = ihash(xi, yi + 1, seed), d = ihash(xi + 1, yi + 1, seed);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  }

  /* signed noise, [-1,1] */
  function snoise2(x, y, seed) { return noise2(x, y, seed) * 2 - 1; }

  function fbm2(x, y, seed, oct, lac, gain) {
    oct = oct || 3; lac = lac || 2.03; gain = gain || 0.5;
    var sum = 0, amp = 0.5, norm = 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * snoise2(x, y, seed + i * 131);
      norm += amp;
      x *= lac; y *= lac; amp *= gain;
    }
    return sum / norm;
  }

  /* ridged: sharp crests, [0,1] */
  function ridged2(x, y, seed, oct) {
    oct = oct || 3;
    var sum = 0, amp = 0.5, norm = 0;
    for (var i = 0; i < oct; i++) {
      var n = 1 - Math.abs(snoise2(x, y, seed + i * 977));
      sum += amp * n * n;
      norm += amp;
      x *= 2.07; y *= 2.07; amp *= 0.5;
    }
    return sum / norm;
  }

  /* stepped sedimentary cliff terracing */
  function terrace(v, steps, sharpness) {
    var s = v * steps;
    var i = Math.floor(s);
    var f = s - i;
    var k = sharpness === undefined ? 0.35 : sharpness;
    var t = smooth(clamp((f - (1 - k)) / k, 0, 1));
    return (i + t) / steps;
  }

  /* ---------- mat4 (column-major, gl-matrix layout) ---------- */
  var mat4 = {
    create: function () {
      var m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    },
    identity: function (m) {
      m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
      m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
      m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
      m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
      return m;
    },
    perspective: function (out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
      out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
      out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
      out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
      return out;
    },
    lookAt: function (out, eye, center, up) {
      var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      var l = 1 / (Math.hypot(zx, zy, zz) || 1);
      zx *= l; zy *= l; zz *= l;
      var xx = up[1] * zz - up[2] * zy;
      var xy = up[2] * zx - up[0] * zz;
      var xz = up[0] * zy - up[1] * zx;
      l = 1 / (Math.hypot(xx, xy, xz) || 1);
      xx *= l; xy *= l; xz *= l;
      var yx = zy * xz - zz * xy;
      var yy = zz * xx - zx * xz;
      var yz = zx * xy - zy * xx;
      out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
      out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
      out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
      out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      out[15] = 1;
      return out;
    },
    multiply: function (out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
          a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
          a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
          a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      for (var i = 0; i < 4; i++) {
        var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
        out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      }
      return out;
    }
  };

  /* ---------- vec3 (plain arrays, low allocation in hot paths) ---------- */
  var vec3 = {
    norm: function (v) {
      var l = Math.hypot(v[0], v[1], v[2]) || 1;
      v[0] /= l; v[1] /= l; v[2] /= l; return v;
    },
    scale: function (v, s) { v[0] *= s; v[1] *= s; v[2] *= s; return v; }
  };

  /* ---------- bus ---------- */
  var handlers = {};
  var bus = {
    on: function (evt, fn) { (handlers[evt] || (handlers[evt] = [])).push(fn); },
    emit: function (evt, data) {
      var list = handlers[evt];
      if (!list) return;
      for (var i = 0; i < list.length; i++) list[i](data);
    }
  };

  var now = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ---------- misc ---------- */
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  /* sRGB-ish authoring -> linear-ish working space. Keeps splats from
     turning into chalk when they stack. */
  function srgb(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function hexLin(hex) {
    var c = hexToRgb(hex);
    return [srgb(c[0]), srgb(c[1]), srgb(c[2])];
  }

  ER.core = {
    clamp: clamp, lerp: lerp, smooth: smooth, TAU: TAU,
    fnv1a: fnv1a, mulberry32: mulberry32, ihash: ihash,
    noise2: noise2, snoise2: snoise2, fbm2: fbm2, ridged2: ridged2, terrace: terrace,
    mat4: mat4, vec3: vec3, bus: bus, now: now,
    hexToRgb: hexToRgb, hexLin: hexLin, srgb: srgb
  };
  /* the bus is app-wide, so expose it at the namespace root too */
  ER.bus = bus;
})(window.ER = window.ER || {});
