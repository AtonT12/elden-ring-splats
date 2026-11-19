/* sdf.js — shape generators + the three realm definitions.
   Everything is emitted as points on (or inside) analytic surfaces.
   No meshes, no textures. */
(function (ER) {
  'use strict';
  var C = ER.core, TAU = C.TAU;

  /* ---------- budget splitter ---------- */
  function alloc(sizes, n) {
    var sum = 0, i;
    for (i = 0; i < sizes.length; i++) sum += sizes[i];
    if (sum <= 0) sum = 1;
    var out = [], acc = 0, frac = [];
    for (i = 0; i < sizes.length; i++) {
      var v = n * sizes[i] / sum;
      var f = Math.floor(v);
      out.push(f); acc += f;
      frac.push({ i: i, f: v - f });
    }
    var rem = n - acc;
    frac.sort(function (a, b) { return b.f - a.f; });
    for (i = 0; i < rem; i++) out[frac[i % frac.length].i]++;
    return out;
  }

  /* uniform direction on unit sphere */
  function dir3(rng, o) {
    var u = rng() * 2 - 1, th = rng() * TAU, s = Math.sqrt(1 - u * u);
    o[0] = s * Math.cos(th); o[1] = u; o[2] = s * Math.sin(th);
    return o;
  }

  var _d = [0, 0, 0];

  /* ---------- surface generators ---------- */
  var gen = {
    alloc: alloc,
    dir3: dir3,

    /* ellipsoid shell; inflate<1 pulls points inward for a dusty volume */
    ellipsoid: function (rng, n, cx, cy, cz, rx, ry, rz, push, o) {
      o = o || {};
      var mat = o.mat || 'ROCK', inflate = o.inflate === undefined ? 1 : o.inflate;
      var jit = o.jit === undefined ? 0 : o.jit;
      for (var i = 0; i < n; i++) {
        dir3(rng, _d);
        var k = inflate * (1 - jit * rng());
        var x = cx + _d[0] * rx * k, y = cy + _d[1] * ry * k, z = cz + _d[2] * rz * k;
        var nx = _d[0] / rx, ny = _d[1] / ry, nz = _d[2] / rz;
        var l = 1 / (Math.hypot(nx, ny, nz) || 1);
        push(x, y, z, nx * l, ny * l, nz * l, mat);
      }
    },

    /* solid ball of points, density falls towards the centre */
    volume: function (rng, n, cx, cy, cz, rx, ry, rz, push, o) {
      o = o || {};
      var mat = o.mat || 'ROCK';
      for (var i = 0; i < n; i++) {
        dir3(rng, _d);
        var k = Math.cbrt(rng());
        push(cx + _d[0] * rx * k, cy + _d[1] * ry * k, cz + _d[2] * rz * k,
          _d[0], _d[1], _d[2], mat);
      }
    },

    /* vertical tapered cylinder: capsed by area weight */
    cylinder: function (rng, n, cx, y0, cz, r0, r1, h, push, o) {
      o = o || {};
      var mat = o.mat || 'STONE', caps = o.caps === undefined ? true : o.caps;
      var y1 = y0 + h;
      var slant = Math.hypot(h, r1 - r0);
      var aSide = Math.PI * (r0 + r1) * slant;
      var aB = Math.PI * r0 * r0, aT = Math.PI * r1 * r1;
      var sz = caps ? [aSide, aB, aT] : [1, 0, 0];
      var q = alloc(sz, n);
      var i, t, ang, rr, py, nx, ny, nz;
      for (i = 0; i < q[0]; i++) {
        t = rng(); ang = rng() * TAU;
        rr = r0 + (r1 - r0) * t; py = y0 + t * h;
        nx = Math.cos(ang) * h; nz = Math.sin(ang) * h; ny = r0 - r1;
        var l = 1 / (Math.hypot(nx, ny, nz) || 1);
        push(cx + Math.cos(ang) * rr, py, cz + Math.sin(ang) * rr, nx * l, ny * l, nz * l, mat);
      }
      for (i = 0; i < q[1]; i++) {
        ang = rng() * TAU; rr = r0 * Math.sqrt(rng());
        push(cx + Math.cos(ang) * rr, y0, cz + Math.sin(ang) * rr, 0, -1, 0, mat);
      }
      for (i = 0; i < q[2]; i++) {
        ang = rng() * TAU; rr = r1 * Math.sqrt(rng());
        push(cx + Math.cos(ang) * rr, y1, cz + Math.sin(ang) * rr, 0, 1, 0, mat);
      }
    },

    /* cone with apex up; used for roofs and conifer tiers */
    cone: function (rng, n, cx, y0, cz, r, h, push, o) {
      o = o || {};
      var mat = o.mat || 'STONE', cap = o.cap !== false;
      var slant = Math.hypot(r, h), aSide = Math.PI * r * slant, aCap = Math.PI * r * r;
      var q = alloc(cap ? [aSide, aCap] : [1, 0], n);
      var i, t, ang, rr, py, nx, ny, nz, l;
      for (i = 0; i < q[0]; i++) {
        t = Math.sqrt(rng()); ang = rng() * TAU;
        rr = r * (1 - t); py = y0 + t * h;
        nx = Math.cos(ang) * h; nz = Math.sin(ang) * h; ny = r;
        l = 1 / (Math.hypot(nx, ny, nz) || 1);
        push(cx + Math.cos(ang) * rr, py, cz + Math.sin(ang) * rr, nx * l, ny * l, nz * l, mat);
      }
      for (i = 0; i < q[1]; i++) {
        ang = rng() * TAU; rr = r * Math.sqrt(rng());
        push(cx + Math.cos(ang) * rr, y0, cz + Math.sin(ang) * rr, 0, -1, 0, mat);
      }
    },

    /* capsule between two arbitrary points, tapered radius */
    capsule: function (rng, n, ax, ay, az, bx, by, bz, r0, r1, push, o) {
      o = o || {};
      var mat = o.mat || 'ROCK';
      var dx = bx - ax, dy = by - ay, dz = bz - az;
      var L = Math.hypot(dx, dy, dz) || 1e-4;
      var ux = dx / L, uy = dy / L, uz = dz / L;
      // orthonormal basis around the axis
      var px = 0, py = 1, pz = 0;
      if (Math.abs(uy) > 0.92) { px = 1; py = 0; pz = 0; }
      var vx = uy * pz - uz * py, vy = uz * px - ux * pz, vz = ux * py - uy * px;
      var vl = 1 / (Math.hypot(vx, vy, vz) || 1); vx *= vl; vy *= vl; vz *= vl;
      var wx = vy * uz - vz * uy, wy = vz * ux - vx * uz, wz = vx * uy - vy * ux;
      var rm = (r0 + r1) * 0.5;
      var q = alloc([Math.PI * (r0 + r1) * L, 2.4 * rm * rm], n);
      var i, t, ang, rr, ca, sa, nx, ny, nz, l;
      for (i = 0; i < q[0]; i++) {
        t = rng(); ang = rng() * TAU;
        rr = r0 + (r1 - r0) * t;
        ca = Math.cos(ang); sa = Math.sin(ang);
        nx = (vx * ca + wx * sa);
        ny = (vy * ca + wy * sa);
        nz = (vz * ca + wz * sa);
        // tilt the normal back against the taper
        nx = nx * L + ux * (r0 - r1); ny = ny * L + uy * (r0 - r1); nz = nz * L + uz * (r0 - r1);
        l = 1 / (Math.hypot(nx, ny, nz) || 1);
        push(ax + ux * L * t + (vx * ca + wx * sa) * rr,
             ay + uy * L * t + (vy * ca + wy * sa) * rr,
             az + uz * L * t + (vz * ca + wz * sa) * rr,
             nx * l, ny * l, nz * l, mat);
      }
      // rounded end caps
      for (i = 0; i < q[1]; i++) {
        var end = rng() < 0.5 ? 0 : 1;
        var ex = end ? bx : ax, ey = end ? by : ay, ez = end ? bz : az;
        var sgn = end ? 1 : -1, rad = end ? r1 : r0;
        dir3(rng, _d);
        var dot = (_d[0] * ux + _d[1] * uy + _d[2] * uz) * sgn;
        if (dot < 0) { _d[0] *= -1; _d[1] *= -1; _d[2] *= -1; }
        push(ex + _d[0] * rad, ey + _d[1] * rad, ez + _d[2] * rad, _d[0], _d[1], _d[2], mat);
      }
    },

    /* box, yaw-rotated; faces weighted by area */
    box: function (rng, n, cx, cy, cz, sx, sy, sz, yaw, push, o) {
      o = o || {};
      var mat = o.mat || 'STONE';
      var hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
      var w = [hx * hy, hx * hy, hx * hz, hx * hz, hy * hz, hy * hz];
      var q = alloc(w, n), i, k;
      var ca = Math.cos(yaw), sa = Math.sin(yaw);
      for (k = 0; k < 6; k++) {
        for (i = 0; i < q[k]; i++) {
          var a = rng() * 2 - 1, b = rng() * 2 - 1;
          var lx, ly, lz, nx, ny, nz;
          if (k < 2) {            // +z / -z
            lx = a * hx; ly = b * hy; lz = k ? -hz : hz;
            nx = 0; ny = 0; nz = k ? -1 : 1;
          } else if (k < 4) {     // +x / -x
            lx = k === 3 ? -hx : hx; ly = a * hy; lz = b * hz;
            nx = k === 3 ? -1 : 1; ny = 0; nz = 0;
          } else {                // +y / -y
            lx = a * hx; ly = k === 5 ? -hy : hy; lz = b * hz;
            nx = 0; ny = k === 5 ? -1 : 1; nz = 0;
          }
          push(cx + lx * ca + lz * sa, cy + ly, cz - lx * sa + lz * ca,
               nx * ca + nz * sa, ny, -nx * sa + nz * ca, mat);
        }
      }
    },

    /* heightfield over a disc; jittered grid, exact count */
    heightfield: function (rng, n, R, hfn, push, o) {
      o = o || {};
      var mat = o.mat || 'GROUND';
      var edge = o.edge || null;
      var cover = edge ? 0.84 : 1;
      var cell = Math.sqrt(Math.PI * R * R * cover * cover / n) * 1.03;
      var side = Math.ceil((2 * R) / cell) + 1;
      var made = 0, i, j, e = 0.06;
      var nx, ny, nz, l, gx, gz;
      outer:
      for (j = 0; j < side; j++) {
        for (i = 0; i < side; i++) {
          var x = -R + (i + rng()) * cell;
          var z = -R + (j + rng()) * cell;
          var lim = edge ? R * edge(Math.atan2(z, x)) : R;
          if (x * x + z * z > lim * lim) continue;
          gx = (hfn(x + e, z) - hfn(x - e, z)) / (2 * e);
          gz = (hfn(x, z + e) - hfn(x, z - e)) / (2 * e);
          nx = -gx; ny = 1; nz = -gz;
          l = 1 / Math.hypot(nx, ny, nz);
          push(x, hfn(x, z), z, nx * l, ny * l, nz * l, mat);
          if (++made >= n) break outer;
        }
      }
      // the grid can fall a few cells short at the disc rim — top it up
      var guard = 0;
      while (made < n && guard++ < n * 4) {
        var a = rng() * TAU, rr = Math.sqrt(rng());
        var lim2 = edge ? R * edge(a) : R;
        x = Math.cos(a) * rr * lim2; z = Math.sin(a) * rr * lim2;
        gx = (hfn(x + e, z) - hfn(x - e, z)) / (2 * e);
        gz = (hfn(x, z + e) - hfn(x, z - e)) / (2 * e);
        nx = -gx; ny = 1; nz = -gz;
        l = 1 / Math.hypot(nx, ny, nz);
        push(x, hfn(x, z), z, nx * l, ny * l, nz * l, mat);
        made++;
      }
      return made;
    },

    /* vertical band — the cliff skirt of a floating island */
    skirt: function (rng, n, R, topFn, yBot, push, o) {
      o = o || {};
      var mat = o.mat || 'CLIFF';
      var edge = o.edge || null;
      var i, th, t, rr, y;
      for (i = 0; i < n; i++) {
        th = rng() * TAU;
        t = Math.pow(rng(), 0.55);
        var re = edge ? R * edge(th) : R;
        var top = topFn(Math.cos(th) * re, Math.sin(th) * re);
        y = C.lerp(yBot, top, t);
        // bulge the profile outward as it descends
        rr = re * (1 - 0.16 * (1 - t) + 0.035 * Math.sin(th * 9 + y));
        var nx = Math.cos(th), nz = Math.sin(th);
        push(nx * rr, y, nz * rr, nx, 0.25 * (1 - t) - 0.1, nz, mat);
      }
    },

    /* flat disc, used for puddles / rot pools */
    disc: function (rng, n, cx, cy, cz, R, push, o) {
      o = o || {};
      var mat = o.mat || 'WATER';
      for (var i = 0; i < n; i++) {
        var a = rng() * TAU, r = R * Math.sqrt(rng());
        push(cx + Math.cos(a) * r, cy + (rng() - 0.5) * 0.03, cz + Math.sin(a) * r, 0, 1, 0, mat);
      }
    },

    /* half torus standing on the ground — a broken arch */
    arc: function (rng, n, cx, cy, cz, R, r, a0, a1, push, o) {
      o = o || {};
      var mat = o.mat || 'STONE';
      for (var i = 0; i < n; i++) {
        var th = a0 + (a1 - a0) * rng();
        var ph = rng() * TAU;
        var cr = Math.cos(ph), sr = Math.sin(ph);
        var nx = cr * Math.cos(th), ny = cr * Math.sin(th), nz = sr;
        push(cx + (R + r * cr) * Math.cos(th), cy + (R + r * cr) * Math.sin(th),
             cz + r * sr, nx, ny, nz, mat);
      }
    },

    /* thin vertical quad — banners, hanging cloth */
    cloth: function (rng, n, cx, cy, cz, w, h, yaw, push, o) {
      o = o || {};
      var mat = o.mat || 'CLOTH';
      var ca = Math.cos(yaw), sa = Math.sin(yaw);
      for (var i = 0; i < n; i++) {
        var u = rng() * 2 - 1, v = rng();
        var sag = 0.12 * w * (1 - v) * Math.sin(u * 3.1);
        push(cx + u * w * 0.5 * ca + sag * sa, cy - v * h, cz - u * w * 0.5 * sa + sag * ca,
             0, 1, 0, mat);
      }
    }
  };

  /* ---------- shared material presets ---------- */
  function M(r, a, extra) {
    var m = { r: r, a: a === undefined ? 0.92 : a };
    if (extra) for (var k in extra) m[k] = extra[k];
    return m;
  }

  /* =====================================================================
     REALM I — ERDTREE
     ===================================================================== */
  var erdTree = (function () {
    var ground = function (x, z) {
      var r2 = x * x + z * z, r = Math.sqrt(r2);
      var h = 0.55 * C.fbm2(x * 0.11, z * 0.11, 17, 3)
            + 0.22 * C.fbm2(x * 0.42, z * 0.42, 91, 2);
      h += 1.20 * Math.exp(-r2 / 30);                       // mound under the trunk
      var ang = Math.atan2(z, x);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      // the ridge is not a circle: its height wanders with angle
      var ridge = 1.35 + 0.95 * C.noise2(ca * 1.7 + 3, sa * 1.7 + 8, 29);
      var rim = C.smooth(C.clamp((r - 8.2) / 3.1, 0, 1));
      h += rim * ridge;                                     // coastal highland
      h -= 0.45 * C.smooth(C.clamp((r - 6.4) / 1.6, 0, 1)) * (1 - rim);
      h += 0.10 * Math.sin(r * 2.1 + ca * 1.4) * (1 - rim);  // terraces
      return h;
    };

    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.84 + 0.11 * C.noise2(c * 2.2 + 4, sn * 2.2 + 7, 61)
                  + 0.05 * C.noise2(c * 5.5 + 1, sn * 5.5 + 2, 17);
    };

    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.84 + 0.11 * C.noise2(c * 2.2 + 4, sn * 2.2 + 7, 61)
                  + 0.05 * C.noise2(c * 5.5 + 1, sn * 5.5 + 2, 17);
    };

    // trunk centreline drift
    var trunkX = function (y) { return 0.34 * Math.sin(y * 0.33 + 0.6) * (y / 13); };
    var trunkZ = function (y) { return 0.22 * Math.cos(y * 0.27) * (y / 13); };

    /* collect branch segments first, then spend the budget by area.
       two-phase keeps the point count exact no matter how deep it recurses */
    function collect(rng, x0, y0, z0, dx, dy, dz, len, rad, depth, segs, tips) {
      var x1 = x0 + dx * len, y1 = y0 + dy * len, z1 = z0 + dz * len;
      segs.push(x0, y0, z0, x1, y1, z1, rad, rad * 0.62, len * (rad + rad * 0.62));
      if (depth <= 0) { tips.push(x1, y1, z1, rad); return; }
      var kids = 3;
      for (var i = 0; i < kids; i++) {
        var a = rng() * TAU, tilt = 0.55 + rng() * 0.55;
        var ca = Math.cos(a), sa = Math.sin(a);
        var ndx = dx + ca * tilt, ndy = dy * (0.55 + rng() * 0.55) + 0.06, ndz = dz + sa * tilt;
        var l = 1 / Math.hypot(ndx, ndy, ndz);
        collect(rng, x1, y1, z1, ndx * l, ndy * l, ndz * l,
          len * (0.62 + rng() * 0.12), rad * 0.62, depth - 1, segs, tips);
      }
    }

    return {
      id: 'erdtree', label: 'ERDTREE', sub: 'THE GILDED BOUGH',
      epigraph: 'the bough remembers every age it outlived.',
      sky: { top: '#07060d', horizon: '#2a1d2c', bottom: '#0d0a14' },
      fog: { color: '#2b1f33', density: 0.017, start: 16 },
      light: (function () { var v = [-0.38, 0.80, 0.46], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#ffe2ac',
      sunUv: [0.46, 0.62],
      ambient: '#3a2c46',
      camera: { yaw: -0.60, pitch: 0.22, dist: 33, target: [0, 6.4, 0] },
      palette: ['#07060d', '#100c17', '#1b1424', '#2a1d2c', '#3b2a33', '#523c33',
                '#6d5136', '#8b683c', '#a8813f', '#c49a4c', '#dcb262', '#f0cb80',
                '#ffe0a4', '#fff2ce', '#6a5c78', '#9c8a6a'],
      mats: {
        GROUND: { color: '#6a5a3e', r: 0.145, a: 0.95, vary: 1, nJit: 0.4 },
        CLIFF: { color: '#382a2c', r: 0.19, a: 0.95, vary: 1 },
        BARK: { color: '#c2ad86', r: 0.135, a: 0.95, nJit: 0.85 },
        BARK_DK: { color: '#7c6749', r: 0.11, a: 0.9, nJit: 0.8 },
        STONE: { color: '#c9bda3', r: 0.11, a: 0.95, vary: 1, nJit: 0.3 },
        STONE_DK: { color: '#8d8069', r: 0.12, a: 0.95 },
        GOLD: { color: '#ffd47c', r: 0.08, a: 0.7, glow: 1.6 },
        CANOPY: { color: '#ffcf72', r: 0.15, a: 0.26, glow: 1.5 },
        LEAF: { color: '#fff0bc', r: 0.055, a: 0.5, glow: 1.45 },
        MOTE: { color: '#fff6d8', r: 0.048, a: 0.42, glow: 2.0 },
        CLOTH: { color: '#8d3330', r: 0.075, a: 0.9 },
        BANNER: { color: '#7e2b2a', r: 0.07, a: 0.9 }
      },
      emit: [
        { name: 'ground', weight: 26, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 12.4, ground, b.push, { mat: 'GROUND', edge: edge });
          } },
        { name: 'skirt', weight: 5, fn: function (b, n, rng) {
            var q = alloc([1, 0.4, 0.34], n);
            gen.skirt(rng, q[0], 12.4, ground, -3.4, b.push, { mat: 'CLIFF', edge: edge });
            // loose rock hanging under the island
            gen.ellipsoid(rng, q[1], 3.2, -3.0, 5.4, 2.0, 1.1, 1.8, b.push, { mat: 'CLIFF', inflate: 0.9, jit: 0.5 });
            gen.ellipsoid(rng, q[2], -5.4, -3.6, -3.0, 1.7, 0.9, 1.6, b.push, { mat: 'CLIFF', inflate: 0.9, jit: 0.5 });
          } },
        { name: 'roots', weight: 4, fn: function (b, n, rng) {
            var k = 7;
            var q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var a = (i / k) * TAU + 0.35 + rng() * 0.15;
              var len = 3.4 + rng() * 1.7;
              var x0 = Math.cos(a) * 2.8, z0 = Math.sin(a) * 2.8;
              var x1 = Math.cos(a) * len, z1 = Math.sin(a) * len;
              var y1 = ground(x1, z1) - 0.15;
              gen.capsule(rng, q[i], x0, 3.0 + rng() * 0.6, z0, x1, y1, z1,
                1.35, 0.30, b.push, { mat: 'BARK' });
            }
          } },
        { name: 'trunk', weight: 13, fn: function (b, n, rng) {
            var segs = 8;
            var sizes = [];
            for (var s0 = 0; s0 < segs; s0++) sizes.push(1);
            sizes.push(0.7);                       // bark scars
            var q = alloc(sizes, n);
            for (var i = 0; i < segs; i++) {
              var t0 = i / segs, t1 = (i + 1) / segs;
              var y0 = 0.4 + t0 * 12.4, y1 = 0.4 + t1 * 12.4;
              var r0 = C.lerp(4.30, 1.30, Math.pow(t0, 0.60));
              var r1 = C.lerp(4.30, 1.30, Math.pow(t1, 0.60));
              gen.capsule(rng, q[i], trunkX(y0), y0, trunkZ(y0), trunkX(y1), y1, trunkZ(y1),
                r0, r1, b.push, { mat: 'BARK' });
            }
            // bark scars: thin vertical seams of darker wood
            var scars = 7, sq = alloc(new Array(scars).fill(1), q[segs]);
            for (var s = 0; s < scars; s++) {
              var ang = rng() * TAU;
              for (var j = 0; j < sq[s]; j++) {
                var yy = 1.2 + rng() * 9.6;
                var rr = C.lerp(4.30, 1.30, Math.pow(yy / 13, 0.60)) * 1.004;
                b.push(trunkX(yy) + Math.cos(ang) * rr, yy, trunkZ(yy) + Math.sin(ang) * rr,
                  Math.cos(ang), 0.1, Math.sin(ang), 'BARK_DK');
              }
            }
          } },
        { name: 'boughs', weight: 11, fn: function (b, n, rng) {
            var segs = [], tipsArr = [];
            var levels = [
              { y: 11.4, n: 4, len: 2.9, rad: 0.54 },
              { y: 10.0, n: 4, len: 3.2, rad: 0.60 },
              { y: 8.6, n: 3, len: 2.8, rad: 0.66 }
            ];
            for (var li = 0; li < levels.length; li++) {
              var lv = levels[li];
              for (var i = 0; i < lv.n; i++) {
                var a = (i / lv.n) * TAU + li * 0.53 + rng() * 0.3;
                var dx = Math.cos(a) * (0.62 + rng() * 0.3), dz = Math.sin(a) * (0.62 + rng() * 0.3);
                var l = 1 / Math.hypot(dx, 1.15, dz);
                collect(rng, trunkX(lv.y), lv.y, trunkZ(lv.y),
                  dx * l, 1.15 * l, dz * l, lv.len * (0.9 + rng() * 0.2), lv.rad, 2, segs, tipsArr);
              }
            }
            var cnt = segs.length / 9, sizes = [], k;
            for (k = 0; k < cnt; k++) sizes.push(segs[k * 9 + 8]);
            var q = alloc(sizes, n);
            for (k = 0; k < cnt; k++) {
              var o = k * 9;
              gen.capsule(rng, q[k], segs[o], segs[o + 1], segs[o + 2],
                segs[o + 3], segs[o + 4], segs[o + 5], segs[o + 6], segs[o + 7],
                b.push, { mat: 'BARK' });
            }
            b._tips = tipsArr;
          } },
        { name: 'canopy', weight: 18, fn: function (b, n, rng) {
            var t = b._tips || [];
            var count = Math.max(1, t.length / 4);
            var q = alloc(new Array(count).fill(1), n);
            for (var i = 0; i < count; i++) {
              var x = t[i * 4], y = t[i * 4 + 1], z = t[i * 4 + 2];
              var rr = 0.95 + rng() * 0.65;
              gen.ellipsoid(rng, Math.round(q[i] * 0.55), x, y, z, rr, rr * 0.62, rr,
                b.push, { mat: 'CANOPY', inflate: 1, jit: 0.35 });
              gen.volume(rng, q[i] - Math.round(q[i] * 0.55), x, y, z, rr * 0.9, rr * 0.55, rr * 0.9,
                b.push, { mat: 'LEAF' });
            }
          } },
        { name: 'city', weight: 16, fn: function (b, n, rng) {
            var towers = 20, R = 9.7;
            var sizes = [];
            for (var i = 0; i < towers; i++) sizes.push(1);
            sizes.push(2.6);                     // cathedral
            var q = alloc(sizes, n);
            for (var i2 = 0; i2 < towers; i2++) {
              var a = (i2 / towers) * TAU + 0.12;
              var x = Math.cos(a) * R, z = Math.sin(a) * R;
              var gy = ground(x, z) - 0.2;
              var h = 3.8 + (i2 % 4) * 0.8 + rng() * 0.6;
              var w = 1.05 + rng() * 0.3;
              var qi = alloc([1, 0.9], q[i2]);
              gen.box(rng, qi[0], x, gy + h * 0.5, z, w, h, w, a, b.push, { mat: 'STONE' });
              // crown: either a cone roof or crenellations
              if (i2 % 3 === 0) gen.cone(rng, qi[1], x, gy + h, z, w * 1.05, 2.0, b.push, { mat: 'STONE_DK' });
              else gen.box(rng, qi[1], x, gy + h + 0.16, z, w * 1.22, 0.32, w * 1.22, a, b.push, { mat: 'STONE_DK' });
            }
            // ring wall between towers, with gate gaps
            var segs = towers;
            for (var s = 0; s < segs; s++) {
              if (s % 4 === 3) continue;
              var a0 = (s / segs) * TAU + 0.12, a1 = ((s + 1) / segs) * TAU + 0.12;
              var mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * R;
              var mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * R;
              var chord = 2 * R * Math.sin((a1 - a0) * 0.5);
              gen.box(rng, Math.round(q[towers] * 0.16), mx, ground(mx, mz) + 1.15, mz,
                chord * 1.02, 2.6, 0.55, -(a0 + a1) * 0.5 + Math.PI * 0.5, b.push, { mat: 'STONE_DK' });
            }
            // cathedral
            var ca2 = 2.1, cx2 = Math.cos(ca2) * 8.2, cz2 = Math.sin(ca2) * 8.2;
            var gy2 = ground(cx2, cz2) - 0.3;
            var qq = alloc([2.2, 0.7, 0.5], q[towers]);
            gen.box(rng, qq[0], cx2, gy2 + 2.9, cz2, 3.4, 5.8, 2.4, ca2, b.push, { mat: 'STONE' });
            gen.cone(rng, qq[1], cx2, gy2 + 5.8, cz2, 2.1, 2.6, b.push, { mat: 'STONE_DK' });
            gen.capsule(rng, qq[2], cx2, gy2 + 8.2, cz2, cx2, gy2 + 10.6, cz2, 0.16, 0.05,
              b.push, { mat: 'GOLD' });
          } },
        { name: 'motes', weight: 3, fn: function (b, n, rng) {
            var q = alloc([0.62, 0.38], n), i, a, r, y;
            for (i = 0; i < q[0]; i++) {
              a = rng() * TAU; r = Math.sqrt(rng()) * 8.6;
              y = 5.5 + rng() * 8.5 - r * 0.12;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r,
                Math.cos(a), 0.2, Math.sin(a), 'MOTE', 1, 1, 1, rng() * TAU);
            }
            for (i = 0; i < q[1]; i++) {
              a = rng() * TAU; r = Math.sqrt(rng()) * 11.4;
              y = ground(Math.cos(a) * r, Math.sin(a) * r) + rng() * 1.6;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 'MOTE', 0.85, 0.9, 5, rng() * TAU);
            }
          } },
        { name: 'banners', weight: 2, fn: function (b, n, rng) {
            for (var i = 0; i < 5; i++) {
              var a = 0.5 + i * 1.2, R = 9.4;
              var x = Math.cos(a) * R, z = Math.sin(a) * R;
              gen.cloth(rng, Math.round(n / 5), x, ground(x, z) + 3.6, z, 0.7, 1.9, -a, b.push, { mat: 'CLOTH' });
            }
          } }
      ],
      macro: function (x, y, z) {
        // terrain + trunk + city ring: enough for creases, cheap enough for 5 taps
        var d = y - ground(x, z);
        var yy = C.clamp(y, 0.4, 12.8);
        var tx = trunkX(yy), tz = trunkZ(yy);
        var rr = C.lerp(4.30, 1.30, Math.pow((yy - 0.4) / 12.4, 0.60));
        var dt = Math.hypot(x - tx, y - yy, z - tz) - rr;
        if (dt < d) d = dt;
        var ring = Math.abs(Math.hypot(x, z) - 9.7) - 0.7;
        var dr = Math.max(ring, Math.max(0.2 - y, y - 4.2));
        if (dr < d) d = dr;
        return d;
      }
    };
  })();

  /* =====================================================================
     REALM II — LIMGRAVE
     ===================================================================== */
  var limgrave = (function () {
    var ground = function (x, z) {
      var h = 1.05 * C.ridged2(x * 0.085 + 3.1, z * 0.085 - 1.7, 41, 3) - 0.35;
      h += 0.55 * C.fbm2(x * 0.2, z * 0.2, 77, 2);
      // crag for the castle
      var dx = x - 5.6, dz = z + 4.2;
      var crag = 3.4 * Math.exp(-(dx * dx + dz * dz) / 22);
      h = Math.max(h, crag + 0.6 * C.fbm2(x * 0.3, z * 0.3, 12, 2));
      return h;
    };
    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.78 + 0.15 * C.noise2(c * 2.6 + 3, sn * 2.6 + 9, 88)
                  + 0.08 * C.noise2(c * 6.2 + 5, sn * 6.2 + 1, 42);
    };
    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.78 + 0.15 * C.noise2(c * 2.6 + 3, sn * 2.6 + 9, 88)
                  + 0.08 * C.noise2(c * 6.2 + 5, sn * 6.2 + 1, 42);
    };
    return {
      id: 'limgrave', label: 'LIMGRAVE', sub: 'STORMVEIL MARCH',
      epigraph: 'rain keeps the castle\u2019s name alive.',
      sky: { top: '#080f12', horizon: '#2c3b3e', bottom: '#0a1012' },
      fog: { color: '#46585a', density: 0.016, start: 19 },
      light: (function () { var v = [0.36, 0.62, -0.70], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#cfe0dd',
      sunUv: [0.62, 0.58],
      moon: { pos: [0.28, 0.73], size: 0.062, color: '#cfdbd2', i: 0.62 },
      ambient: '#2b3a3c',
      camera: { yaw: 2.35, pitch: 0.24, dist: 34, target: [1.2, 5.0, 0] },
      palette: ['#080d0f', '#0e1618', '#162224', '#20302f', '#2c3d3a', '#3c4f49',
                '#4f6259', '#647568', '#7b8a79', '#93a08c', '#aab5a0', '#c3cbb6',
                '#dbe1d2', '#eef1e6', '#40525a', '#6f8b8c'],
      mats: {
        GROUND: { color: '#6b7a5c', r: 0.15, a: 0.95, vary: 1, nJit: 0.4 },
        CLIFF: { color: '#2c3739', r: 0.19, a: 0.95 },
        STONE: { color: '#aeb9ad', r: 0.11, a: 0.95, vary: 1 },
        STONE_DK: { color: '#4a5652', r: 0.125, a: 0.95 },
        ROOF: { color: '#33424a', r: 0.12, a: 0.95 },
        TRUNK: { color: '#4b4238', r: 0.10, a: 0.94 },
        PINE: { color: '#31463a', r: 0.12, a: 0.9 },
        WATER: { color: '#6d8b8f', r: 0.12, a: 0.5 },
        RAIN: { color: '#b9cfd6', r: 0.028, a: 0.30 },
        CLOTH: { color: '#7b3038', r: 0.07, a: 0.9 },
        WINDOW: { color: '#ffd79a', r: 0.055, a: 0.55, glow: 2.2 },
        WINDOW: { color: '#ffd79a', r: 0.055, a: 0.55, glow: 2.2 },
        MOON: { color: '#e8efe4', r: 1.9, a: 0.055, glow: 1.2 },
        MIST: { color: '#8fa09c', r: 2.8, a: 0.030 }
      },
      emit: [
        { name: 'ground', weight: 30, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 11.6, ground, b.push, { mat: 'GROUND', edge: edge });
          } },
        { name: 'skirt', weight: 5, fn: function (b, n, rng) {
            var q = alloc([1, 0.42], n);
            gen.skirt(rng, q[0], 11.6, ground, -3.8, b.push, { mat: 'CLIFF', edge: edge });
            gen.ellipsoid(rng, q[1], -4.5, -3.2, 4.2, 2.1, 1.0, 1.6, b.push, { mat: 'CLIFF', inflate: 0.92, jit: 0.5 });
          } },
        { name: 'castle', weight: 20, fn: function (b, n, rng) {
            var bx = 5.6, bz = -4.2, gy = ground(bx, bz) - 0.4, yaw = -0.55;
            var q = alloc([2.6, 1.0, 0.55, 1.4, 0.5, 1.1], n);
            // keep
            gen.box(rng, q[0], bx, gy + 3.1, bz, 3.4, 6.2, 3.0, yaw, b.push, { mat: 'STONE' });
            // crenellations along the keep roof
            gen.box(rng, q[1], bx, gy + 6.3, bz, 3.9, 0.34, 3.5, yaw, b.push, { mat: 'STONE_DK' });
            // four towers
            var off = [[-1.9, -1.7], [1.9, -1.7], [-1.9, 1.7], [1.9, 1.7]];
            for (var i = 0; i < 4; i++) {
              var ox = off[i][0], oz = off[i][1];
              var wx = bx + ox * Math.cos(yaw) + oz * Math.sin(yaw);
              var wz = bz - ox * Math.sin(yaw) + oz * Math.cos(yaw);
              var hh = 6.4 + (i % 2) * 1.1;
              gen.cylinder(rng, Math.round(q[2] / 4), wx, gy, wz, 0.72, 0.66, hh, b.push, { mat: 'STONE' });
              gen.cone(rng, Math.round(q[3] / 4), wx, gy + hh, wz, 0.78, 1.7, b.push, { mat: 'ROOF' });
            }
            // curtain wall running down the crag
            for (var s = 0; s < 5; s++) {
              var t = s / 5;
              var x0 = bx - 4.2 + Math.cos(yaw) * (t * 3.2) - 2.4 * t;
              var z0 = bz + 2.6 + Math.sin(yaw) * (t * 2.0) + 2.0 * t;
              var x1 = x0 - 2.1, z1 = z0 + 1.5;
              var my = (ground(x0, z0) + ground(x1, z1)) * 0.5;
              gen.box(rng, Math.round(q[4] / 5), (x0 + x1) * 0.5, my + 1.1, (z0 + z1) * 0.5,
                2.7, 2.3, 0.34, Math.atan2(z1 - z0, x1 - x0) * -1 + Math.PI * 0.5, b.push, { mat: 'STONE_DK' });
            }
            // a few windows lit from within
            for (var wi = 0; wi < 9; wi++) {
              var wx = bx - 1.3 + (wi % 3) * 1.3;
              var wy = gy + 1.6 + Math.floor(wi / 3) * 1.7;
              for (var wj = 0; wj < 16; wj++) {
                b.push(wx + (rng() - 0.5) * 0.22, wy + (rng() - 0.5) * 0.36,
                  bz + 1.53 + (rng() - 0.5) * 0.05, 0, 0.2, 1, 'WINDOW');
              }
            }
            // a few windows lit from within
            for (var wi = 0; wi < 9; wi++) {
              var wx = bx - 1.3 + (wi % 3) * 1.3;
              var wy = gy + 1.6 + Math.floor(wi / 3) * 1.7;
              for (var wj = 0; wj < 16; wj++) {
                b.push(wx + (rng() - 0.5) * 0.22, wy + (rng() - 0.5) * 0.36,
                  bz + 1.53 + (rng() - 0.5) * 0.05, 0, 0.2, 1, 'WINDOW');
              }
            }
            // two banners on the keep face
            gen.cloth(rng, Math.round(q[5] * 0.5), bx - 1.1, gy + 5.9, bz + 1.55, 0.8, 2.4, yaw, b.push, { mat: 'CLOTH' });
            gen.cloth(rng, Math.round(q[5] * 0.5), bx + 1.1, gy + 5.9, bz + 1.55, 0.8, 2.4, yaw, b.push, { mat: 'CLOTH' });
          } },
        { name: 'pines', weight: 14, fn: function (b, n, rng) {
            var k = 15, q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var x = 0, z = 0, guard = 0;
              do {
                var a = rng() * TAU, r = 2.5 + Math.sqrt(rng()) * 7.4;
                x = Math.cos(a) * r; z = Math.sin(a) * r;
              } while (guard++ < 12 &&
                       (Math.hypot(x - 5.6, z + 4.2) < 3.8 || Math.hypot(x, z) < 1.6));
              var gy = ground(x, z) - 0.1;
              var hh = 2.6 + rng() * 2.2, sw = 0.55 + rng() * 0.3;
              var qi = alloc([0.3, 1, 0.8, 0.6], q[i]);
              gen.capsule(rng, qi[0], x, gy, z, x, gy + hh * 0.45, z, 0.14, 0.09, b.push, { mat: 'TRUNK' });
              gen.cone(rng, qi[1], x, gy + hh * 0.2, z, sw * 1.5, hh * 0.55, b.push, { mat: 'PINE' });
              gen.cone(rng, qi[2], x, gy + hh * 0.5, z, sw * 1.15, hh * 0.45, b.push, { mat: 'PINE' });
              gen.cone(rng, qi[3], x, gy + hh * 0.74, z, sw * 0.8, hh * 0.38, b.push, { mat: 'PINE' });
            }
          } },
        { name: 'stones', weight: 9, fn: function (b, n, rng) {
            var k = 18, q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var a = rng() * TAU, r = 3 + Math.sqrt(rng()) * 8;
              var x = Math.cos(a) * r, z = Math.sin(a) * r;
              var gy = ground(x, z);
              var hh = 0.9 + rng() * 1.9;
              gen.box(rng, q[i], x, gy + hh * 0.4, z, 0.42 + rng() * 0.3, hh, 0.32 + rng() * 0.24,
                rng() * TAU, b.push, { mat: 'STONE_DK' });
            }
          } },
        { name: 'arch', weight: 4, fn: function (b, n, rng) {
            var x = -3.6, z = 3.4, gy = ground(x, z);
            var q = alloc([2.4, 1, 1], n);
            gen.arc(rng, q[0], x, gy, z, 1.5, 0.22, 0.15, Math.PI - 0.15, b.push, { mat: 'STONE' });
            gen.box(rng, q[1], x - 1.5, gy + 0.55, z, 0.52, 1.3, 0.46, 0.2, b.push, { mat: 'STONE' });
            gen.box(rng, q[2], x + 1.5, gy + 0.55, z, 0.52, 1.3, 0.46, -0.1, b.push, { mat: 'STONE' });
          } },
        { name: 'water', weight: 3, fn: function (b, n, rng) {
            gen.disc(rng, Math.round(n * 0.5), -2.0, ground(-2, 5.6) + 0.06, 5.6, 2.2, b.push, { mat: 'WATER' });
            gen.disc(rng, Math.round(n * 0.3), 2.6, ground(2.6, 7.2) + 0.06, 7.2, 1.4, b.push, { mat: 'WATER' });
            gen.disc(rng, Math.round(n * 0.2), -6.4, ground(-6.4, -1.2) + 0.05, -1.2, 1.1, b.push, { mat: 'WATER' });
          } },
        { name: 'rain', weight: 8, fn: function (b, n, rng) {
            for (var i = 0; i < n; i++) {
              var a = rng() * TAU, r = Math.sqrt(rng()) * 13;
              var y = rng() * 15;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 'RAIN', 1, 1, 2, rng() * TAU);
            }
          } }
      ],
      macro: function (x, y, z) {
        var d = y - ground(x, z);
        // castle block
        var bx = Math.abs(x - 5.6) - 2.4, by = Math.abs(y - (ground(5.6, -4.2) + 3.1)) - 3.2, bz = Math.abs(z + 4.2) - 2.2;
        var db = Math.hypot(Math.max(bx, 0), Math.max(by, 0), Math.max(bz, 0)) + Math.min(Math.max(bx, Math.max(by, bz)), 0);
        if (db < d) d = db;
        return d;
      }
    };
  })();

  /* =====================================================================
     REALM III — CAELID
     ===================================================================== */
  var caelid = (function () {
    var ground = function (x, z) {
      var h = 0.8 * C.fbm2(x * 0.14 + 5.3, z * 0.14 - 2.2, 213, 3);
      h += 0.35 * C.ridged2(x * 0.3, z * 0.3, 8, 2) - 0.18;
      // a shallow rot basin
      var r2 = x * x + z * z;
      h -= 0.55 * Math.exp(-r2 / 18);
      return h;
    };

    function collectDead(rng, x0, y0, z0, h, rad, depth, dirx, diry, dirz, segs) {
      var x1 = x0 + dirx * h, y1 = y0 + diry * h, z1 = z0 + dirz * h;
      segs.push(x0, y0, z0, x1, y1, z1, rad, rad * 0.66, h * (rad + rad * 0.66));
      if (depth <= 0) return;
      var kids = depth === 3 ? 2 : 2 + (rng() < 0.45 ? 1 : 0);
      for (var i = 0; i < kids; i++) {
        var a = rng() * TAU, tilt = 0.5 + rng() * 0.55;
        var nx = dirx + Math.cos(a) * tilt, ny = diry * 0.9 + 0.18, nz = dirz + Math.sin(a) * tilt;
        var l = 1 / Math.hypot(nx, ny, nz);
        collectDead(rng, x1, y1, z1, h * (0.62 + rng() * 0.14), rad * 0.66,
          depth - 1, nx * l, ny * l, nz * l, segs);
      }
    }

    function emitSegs(b, rng, segs, n) {
      var cnt = segs.length / 9, sizes = [], k;
      for (k = 0; k < cnt; k++) sizes.push(segs[k * 9 + 8]);
      var q = alloc(sizes, n);
      for (k = 0; k < cnt; k++) {
        var o = k * 9;
        gen.capsule(rng, q[k], segs[o], segs[o + 1], segs[o + 2],
          segs[o + 3], segs[o + 4], segs[o + 5], segs[o + 6], segs[o + 7],
          b.push, { mat: 'ROT_BARK' });
      }
    }

    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.82 + 0.14 * C.noise2(c * 3.1 + 2, sn * 3.1 + 6, 55)
                  + 0.06 * C.noise2(c * 7.4 + 8, sn * 7.4 + 3, 24);
    };
    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.82 + 0.14 * C.noise2(c * 3.1 + 2, sn * 3.1 + 6, 55)
                  + 0.06 * C.noise2(c * 7.4 + 8, sn * 7.4 + 3, 24);
    };
    return {
      id: 'caelid', label: 'CAELID', sub: 'THE SCARLET WASTE',
      epigraph: 'nothing here was burned. it was infected.',
      sky: { top: '#150409', horizon: '#4a1418', bottom: '#180608' },
      fog: { color: '#5a1a16', density: 0.024, start: 15 },
      light: (function () { var v = [0.52, 0.66, 0.54], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#ffb08a',
      sunUv: [0.62, 0.52],
      ambient: '#41161a',
      camera: { yaw: 0.92, pitch: 0.20, dist: 30, target: [0.4, 4.2, 0] },
      palette: ['#100407', '#1c0709', '#2a0c0c', '#3a1210', '#4d1a14', '#63241a',
                '#7c3120', '#984227', '#b3552f', '#c96b3a', '#d9863f', '#8a6a4a',
                '#a88a63', '#c7ab84', '#5b1a1c', '#7a2a22'],
      mats: {
        CRUST: { color: '#4a2a20', r: 0.15, a: 0.95, vary: 1, nJit: 0.4 },
        CLIFF: { color: '#2a1412', r: 0.19, a: 0.95 },
        ROT_BARK: { color: '#3c2420', r: 0.105, a: 0.94, nJit: 0.75 },
        ASH: { color: '#6f6058', r: 0.1, a: 0.5 },
        BONE: { color: '#b7a284', r: 0.09, a: 0.9 },
        SCARLET: { color: '#c33f28', r: 0.13, a: 0.72, glow: 1.15 },
        EMBER: { color: '#e0773a', r: 0.05, a: 0.6, glow: 1.9 },
        RUST: { color: '#7d4429', r: 0.115, a: 0.93 },
        GLOW: { color: '#ffb070', r: 0.05, a: 0.6, glow: 2.2 },
        HAZE: { color: '#7a1f18', r: 2.6, a: 0.032 }
      },
      emit: [
        { name: 'ground', weight: 26, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 11.2, ground, b.push, { mat: 'CRUST', edge: edge });
          } },
        { name: 'skirt', weight: 4, fn: function (b, n, rng) {
            gen.skirt(rng, n, 11.2, ground, -3.6, b.push, { mat: 'CLIFF', edge: edge });
          } },
        { name: 'heroTree', weight: 15, fn: function (b, n, rng) {
            var x = -3.4, z = 2.2, gy = ground(x, z);
            var segs = [];
            collectDead(rng, x, gy, z, 6.4, 0.62, 3, 0.12, 0.99, -0.05, segs);
            // buttress roots
            for (var i = 0; i < 5; i++) {
              var a = (i / 5) * TAU + 0.4;
              var x1 = x + Math.cos(a) * 1.9, z1 = z + Math.sin(a) * 1.9;
              segs.push(x, gy + 0.9, z, x1, ground(x1, z1) - 0.2, z1, 0.34, 0.1, 1.4);
            }
            emitSegs(b, rng, segs, n);
          } },
        { name: 'deadTrees', weight: 11, fn: function (b, n, rng) {
            var k = 6, segs = [];
            for (var i = 0; i < k; i++) {
              var a = rng() * TAU, r = 4.6 + Math.sqrt(rng()) * 5.6;
              var x = Math.cos(a) * r, z = Math.sin(a) * r;
              var h = 2.8 + rng() * 2.6;
              var dx = (rng() - 0.5) * 0.3, dz = (rng() - 0.5) * 0.3;
              var l = 1 / Math.hypot(dx, 0.96, dz);
              collectDead(rng, x, ground(x, z), z, h, 0.3, 2, dx * l, 0.96 * l, dz * l, segs);
            }
            emitSegs(b, rng, segs, n);
          } },
        { name: 'monoliths', weight: 9, fn: function (b, n, rng) {
            var k = 7, q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var a = rng() * TAU, r = 2.8 + Math.sqrt(rng()) * 7.4;
              var x = Math.cos(a) * r, z = Math.sin(a) * r, gy = ground(x, z);
              var hh = 2.2 + rng() * 2.4;
              gen.box(rng, q[i], x, gy + hh * 0.42, z, 0.62 + rng() * 0.3, hh, 0.34, rng() * TAU,
                b.push, { mat: 'RUST' });
              // a glowing seam down one face
              for (var s = 0; s < 6; s++) {
                b.push(x + (rng() - 0.5) * 0.4, gy + 0.4 + rng() * (hh - 0.8), z + 0.19,
                  (rng() - 0.5) * 0.3, 0.2, 1, 'GLOW');
              }
            }
          } },
        { name: 'ruin', weight: 8, fn: function (b, n, rng) {
            var x = 4.8, z = -3.6, gy = ground(x, z), yaw = 0.42;
            var q = alloc([2.2, 1.2, 0.9], n);
            gen.box(rng, q[0], x, gy + 2.4, z, 4.6, 4.8, 0.5, yaw, b.push, { mat: 'RUST' });
            // punched doorway
            gen.box(rng, q[1], x + Math.cos(yaw) * 0.1, gy + 1.1, z + 0.35, 1.5, 2.2, 0.28, yaw,
              b.push, { mat: 'CRUST' });
            gen.arc(rng, q[2], x - 1.9, gy, z + 1.4, 1.1, 0.2, 0.2, Math.PI - 0.2, b.push, { mat: 'BONE' });
            // rubble
            for (var i = 0; i < 40; i++) {
              var a = rng() * TAU, r = rng() * 2.6;
              var px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
              gen.ellipsoid(rng, 26, px, ground(px, pz) + 0.1, pz,
                0.16 + rng() * 0.2, 0.1 + rng() * 0.12, 0.16 + rng() * 0.2,
                b.push, { mat: 'BONE', inflate: 0.95 });
            }
          } },
        { name: 'rot', weight: 6, fn: function (b, n, rng) {
            gen.disc(rng, Math.round(n * 0.45), 1.2, ground(1.2, 0.4) + 0.1, 0.4, 3.4, b.push, { mat: 'SCARLET' });
            // rot crystals growing out of the basin
            for (var i = 0; i < 26; i++) {
              var a = rng() * TAU, r = 0.4 + Math.sqrt(rng()) * 3.2;
              var x = 1.2 + Math.cos(a) * r, z = 0.4 + Math.sin(a) * r;
              var hh = 0.2 + rng() * 0.7;
              gen.cone(rng, 30, x, ground(x, z), z, 0.12 + rng() * 0.1, hh, b.push, { mat: 'SCARLET' });
            }
            for (var j = 0; j < Math.round(n * 0.2); j++) {
              var aa = rng() * TAU, rr = Math.sqrt(rng()) * 5;
              b.push(1.2 + Math.cos(aa) * rr, ground(1.2, 0.4) + rng() * 0.6, 0.4 + Math.sin(aa) * rr,
                0, 1, 0, 'EMBER', 1, 1, 3, rng() * TAU);
            }
          } },
        { name: 'ash', weight: 9, fn: function (b, n, rng) {
          for (var i = 0; i < n; i++) {
            var a = rng() * TAU, r = Math.sqrt(rng()) * 12;
            b.push(Math.cos(a) * r, ground(Math.cos(a) * r, Math.sin(a) * r) + rng() * 9,
              Math.sin(a) * r, 0, 1, 0, 'ASH', 0.8 + rng() * 0.6, 1, 3, rng() * TAU);
          }
        } }
      ],
      macro: function (x, y, z) {
        var d = y - ground(x, z);
        var tx = -3.4, tz = 2.2, ty = ground(tx, tz);
        var dt = Math.hypot(x - tx, (y - ty - 3.2) * 0.42, z - tz) - 1.1;
        if (dt < d) d = dt;
        return d;
      }
    };
  })();

  ER.sdf = {
    gen: gen,
    scenes: { erdtree: erdTree, limgrave: limgrave, caelid: caelid },
    order: ['erdtree', 'limgrave', 'caelid']
  };
})(window.ER = window.ER || {});
