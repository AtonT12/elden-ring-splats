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
          var py = hfn(x, z);
          push(x, py, z, nx * l, ny * l, nz * l,
            o.matFn ? o.matFn(x, py, z, nx * l, ny * l, nz * l) : mat);
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
        var py2 = hfn(x, z);
        push(x, py2, z, nx * l, ny * l, nz * l,
          o.matFn ? o.matFn(x, py2, z, nx * l, ny * l, nz * l) : mat);
        made++;
      }
      return made;
    },

    /* vertical band — the cliff skirt of a floating island with stepped strata */
    skirt: function (rng, n, R, topFn, yBot, push, o) {
      o = o || {};
      var mat = o.mat || 'CLIFF';
      var edge = o.edge || null;
      var i, th, t, rr, y;
      for (i = 0; i < n; i++) {
        th = rng() * TAU;
        t = Math.pow(rng(), 0.52);
        var re = edge ? R * edge(th) : R;
        var top = topFn(Math.cos(th) * re, Math.sin(th) * re);
        y = C.lerp(yBot, top, t);
        // Stepped sedimentary ledges + tapered overhang profile
        var rawDrop = 1 - t;
        var ledge = C.terrace(t, 5, 0.28);
        rr = re * (1 - 0.14 * rawDrop - 0.04 * (1 - ledge) + 0.03 * Math.sin(th * 7 + y * 0.8));
        var nx = Math.cos(th), nz = Math.sin(th);
        var shelf = 0.09 * Math.sin(y * 3.8 + th * 1.5)
                  + 0.055 * C.snoise2(y * 1.9, th * 4.5, 71)
                  - 0.06 * Math.pow(Math.max(0, Math.sin(th * 11 + C.snoise2(th * 2.0, y * 0.6, 19) * 2.2)), 4);
        rr += shelf;
        var ny = 0.22 * rawDrop - 0.14 + 0.16 * Math.cos(y * 3.8 + th * 1.5);
        var nl = 1 / (Math.hypot(nx, ny, nz) || 1);
        var smat = o.matFn ? o.matFn(y, th, t) : mat;
        push(nx * rr, y, nz * rr, nx * nl, ny * nl, nz * nl, smat);
      }
    },

    /* distant mountain bands: layered jagged silhouettes that blend into height fog */
    farRidge: function (rng, n, R0, baseY, height, spread, seed, push, o) {
      o = o || {};
      var mat = o.mat || 'FAR';
      for (var i = 0; i < n; i++) {
        var a = rng() * TAU;
        var ca = Math.cos(a), sa = Math.sin(a);
        var crest = 0.14 + 0.86 * C.ridged2(ca * 1.85 + 4.1, sa * 1.85 - 2.7, seed, 4);
        var spire = Math.pow(Math.max(0, C.ridged2(ca * 4.2 - 1.3, sa * 4.2 + 2.9, seed + 93, 2)), 3) * 0.45;
        var r = R0 + (rng() - 0.5) * spread;
        crest = (crest + spire) * (0.76 + 0.34 * C.noise2(ca * 3.6 + r * 0.05, sa * 3.6, seed + 41));
        var t = Math.pow(rng(), 0.45);
        var y = baseY + height * crest * t;
        var nx = ca, nz = sa, ny = 0.22;
        var l = 1 / Math.hypot(nx, ny, nz);
        push(ca * r, y, sa * r, nx * l, ny * l, nz * l, mat);
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
      // Domain warp first. Without it every ridge follows the same radial
      // grammar and the island reads as a machined disc.
      var wx = x + 0.95 * C.fbm2(x * 0.062 + 3.7, z * 0.062 - 1.4, 37, 3);
      var wz = z + 0.95 * C.fbm2(x * 0.062 - 2.3, z * 0.062 + 5.1, 83, 3);
      var r2 = wx * wx + wz * wz, r = Math.sqrt(r2);
      var h = 0.72 * C.fbm2(wx * 0.105, wz * 0.105, 17, 4)
            + 0.27 * C.fbm2(wx * 0.34, wz * 0.34, 91, 2);
      h += 1.20 * Math.exp(-r2 / 30);                       // mound under the trunk

      var ang = Math.atan2(wz, wx);
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var ridge = 1.35 + 0.95 * C.noise2(ca * 1.7 + 3, sa * 1.7 + 8, 29);
      var rim = C.smooth(C.clamp((r - 8.2) / 3.1, 0, 1));
      h += rim * ridge;                                     // coastal highland
      // A worn plateau carries the capital. Keeping its base level stops the
      // towers from peeking over the ridge as detached roofs.
      var city = Math.exp(-Math.pow((r - 8.1) / 1.55, 2));
      var cityH = 2.15 + 0.18 * C.noise2(ca * 2.4, sa * 2.4, 47);
      h = C.lerp(h, cityH, city * 0.58);

      // Erosion gullies: narrow negative ridges, strongest on the outer
      // slopes where water and wind would actually cut them.
      var g1 = 1 - Math.abs(C.snoise2(wx * 0.20 + 2.1, wz * 0.17 - 4.6, 104));
      var g2 = 1 - Math.abs(C.snoise2(wx * 0.31 - 3.2, wz * 0.27 + 1.8, 211));
      var cut = Math.pow(C.clamp(g1, 0, 1), 7) + 0.55 * Math.pow(C.clamp(g2, 0, 1), 9);
      h -= 0.42 * cut * C.smooth(C.clamp((r - 2.8) / 4.5, 0, 1));

      // Stepped Leyndell plateau shelves & worn limestone terraces
      var shelfNorm = C.clamp((h + 1.2) / 4.2, 0, 1);
      h = C.lerp(h, C.terrace(shelfNorm, 6, 0.32) * 4.2 - 1.2, 0.22 * (1 - rim * 0.4));
      h += 0.06 * Math.sin(r * 2.2 + ca * 1.4) * (1 - rim)
         + 0.025 * C.snoise2(wx * 0.9, wz * 0.9, 57);
      return h;
    };

    var terrainMat = function (x, y, z, nx, ny, nz) {
      var slope = 1 - ny;
      var grain = C.noise2(x * 0.52 + 1.3, z * 0.52 - 2.1, 301);
      if (slope > 0.44 || grain > 0.83) return 'STONE_DK';
      if (slope > 0.28 || grain < 0.18) return 'CLIFF';
      if (y > 2.0 && grain > 0.62) return 'STONE';
      return 'GROUND';
    };

    var cliffMat = function (y, th, t) {
      var band = 0.5 + 0.5 * Math.sin(y * 3.4 + th * 2.6);
      var seam = C.noise2(th * 9.0, y * 2.4, 63);
      if (band > 0.70 && seam > 0.38) return 'STONE_DK';
      if (band < 0.24) return 'STONE';
      return 'CLIFF';
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
      sky: { top: '#05050c', horizon: '#4a3338', bottom: '#0a0810' },
      fog: { color: '#564252', scatterColor: '#d9a45c', density: 0.0085, start: 15,
             height: { base: -0.6, density: 0.006, falloff: 0.22, strength: 0.52 } },
      exposure: 1.14,
      light: (function () { var v = [-0.42, 0.78, 0.46], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#ffe4aa',
      sunUv: [0.46, 0.62],
      sunDisc: 0.18,
      ambient: '#6a5d72',
      camera: { yaw: -0.60, pitch: 0.22, dist: 33, target: [0, 6.4, 0] },
      palette: ['#07060d', '#100c17', '#1b1424', '#2a1d2c', '#3b2a33', '#523c33',
                '#6d5136', '#8b683c', '#a8813f', '#c49a4c', '#dcb262', '#f0cb80',
                '#ffe0a4', '#fff2ce', '#6a5c78', '#9c8a6a'],
      mats: {
        GROUND: { color: '#705c40', r: 0.165, a: 0.98, vary: 1, strata: 0.45, nJit: 0.52 },
        CLIFF: { color: '#53403a', r: 0.165, a: 0.98, vary: 1, strata: 0.85, nJit: 0.42 },
        BARK: { color: '#c8b084', r: 0.140, a: 0.97, bark: 0.9, nJit: 0.82 },
        BARK_DK: { color: '#725d40', r: 0.115, a: 0.94, bark: 0.7, nJit: 0.78 },
        STONE: { color: '#cfc2a6', r: 0.148, a: 0.98, vary: 1, strata: 0.5, nJit: 0.28 },
        STONE_DK: { color: '#948369', r: 0.150, a: 0.98, strata: 0.65, nJit: 0.30 },
        GOLD: { color: '#ffd67d', r: 0.075, a: 0.74, glow: 1.35 },
        CANOPY: { color: '#ffc860', r: 0.138, a: 0.25, glow: 1.16 },
        LEAF: { color: '#ffeba8', r: 0.048, a: 0.48, glow: 1.12 },
        MOTE: { color: '#fff2c8', r: 0.040, a: 0.36, glow: 1.50 },
        MIST: { color: '#cba67c', r: 2.3, a: 0.028, noAO: true },
        CLOTH: { color: '#8f322f', r: 0.075, a: 0.94 },
        BANNER: { color: '#7e2b2a', r: 0.075, a: 0.94 },
        WINDOW: { color: '#ffdc9c', r: 0.052, a: 0.62, glow: 1.65 },
        FAR: { color: '#5c4756', r: 0.92, a: 0.48, noAO: true },
        FAR_DEEP: { color: '#3f3040', r: 1.25, a: 0.36, noAO: true }
      },
      emit: [
        { name: 'ground', weight: 22, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 12.4, ground, b.push,
              { mat: 'GROUND', edge: edge, matFn: terrainMat });
          } },
        { name: 'skirt', weight: 6, fn: function (b, n, rng) {
            gen.skirt(rng, n, 12.4, ground, -3.7, b.push,
              { mat: 'CLIFF', edge: edge, matFn: cliffMat });
          } },
        { name: 'roots', weight: 5, fn: function (b, n, rng) {
            var k = 9;
            var q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var a = (i / k) * TAU + 0.35 + rng() * 0.14;
              var len = 3.5 + rng() * 2.0;
              var x0 = Math.cos(a) * 2.7, z0 = Math.sin(a) * 2.7;
              var mx = Math.cos(a + 0.08) * (len * 0.58), mz = Math.sin(a + 0.08) * (len * 0.58);
              var x1 = Math.cos(a) * len, z1 = Math.sin(a) * len;
              var y1 = ground(x1, z1) - 0.18;
              var ym = ground(mx, mz) + 0.95;
              var hq = Math.round(q[i] * 0.56);
              gen.capsule(rng, hq, x0, 3.2 + rng() * 0.6, z0, mx, ym, mz, 1.35, 0.72, b.push, { mat: 'BARK' });
              gen.capsule(rng, q[i] - hq, mx, ym, mz, x1, y1, z1, 0.72, 0.24, b.push, { mat: 'BARK' });
            }
          } },
        { name: 'trunk', weight: 13, fn: function (b, n, rng) {
            var segs = 9;
            var sizes = [];
            for (var s0 = 0; s0 < segs; s0++) sizes.push(1);
            sizes.push(0.65);                      // bark scars
            sizes.push(0.35);                      // inner golden sap seams
            var q = alloc(sizes, n);
            for (var i = 0; i < segs; i++) {
              var t0 = i / segs, t1 = (i + 1) / segs;
              var y0 = 0.4 + t0 * 12.6, y1 = 0.4 + t1 * 12.6;
              var r0 = C.lerp(4.35, 1.28, Math.pow(t0, 0.60));
              var r1 = C.lerp(4.35, 1.28, Math.pow(t1, 0.60));
              gen.capsule(rng, q[i], trunkX(y0), y0, trunkZ(y0), trunkX(y1), y1, trunkZ(y1),
                r0, r1, b.push, { mat: 'BARK' });
            }
            // bark scars: vertical dark fissures
            var scars = 8, sq = alloc(new Array(scars).fill(1), q[segs]);
            for (var s = 0; s < scars; s++) {
              var ang = (s / scars) * TAU + rng() * 0.35;
              for (var j = 0; j < sq[s]; j++) {
                var yy = 1.1 + rng() * 9.8;
                var rr = C.lerp(4.35, 1.28, Math.pow(yy / 13, 0.60)) * 1.005;
                b.push(trunkX(yy) + Math.cos(ang) * rr, yy, trunkZ(yy) + Math.sin(ang) * rr,
                  Math.cos(ang), 0.1, Math.sin(ang), 'BARK_DK');
              }
            }
            // luminous golden sap veins along the trunk
            var veins = 5, vq = alloc(new Array(veins).fill(1), q[segs + 1]);
            for (var v = 0; v < veins; v++) {
              var vang = (v / veins) * TAU + 0.42;
              for (var vj = 0; vj < vq[v]; vj++) {
                var vy = 1.4 + rng() * 9.2;
                var vr = C.lerp(4.35, 1.28, Math.pow(vy / 13, 0.60)) * 1.012;
                b.push(trunkX(vy) + Math.cos(vang) * vr, vy, trunkZ(vy) + Math.sin(vang) * vr,
                  Math.cos(vang), 0.1, Math.sin(vang), 'GOLD', 0.85, 0.85);
              }
            }
          } },
        { name: 'boughs', weight: 11, fn: function (b, n, rng) {
            var segs = [], tipsArr = [];
            var levels = [
              { y: 11.6, n: 4, len: 3.0, rad: 0.56 },
              { y: 10.1, n: 5, len: 3.3, rad: 0.60 },
              { y: 8.6, n: 3, len: 2.9, rad: 0.68 }
            ];
            for (var li = 0; li < levels.length; li++) {
              var lv = levels[li];
              for (var i = 0; i < lv.n; i++) {
                var a = (i / lv.n) * TAU + li * 0.53 + rng() * 0.28;
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
        { name: 'canopy', weight: 17, fn: function (b, n, rng) {
            var t = b._tips || [];
            var count = Math.max(1, t.length / 4);
            var q = alloc(new Array(count).fill(1), n);
            for (var i = 0; i < count; i++) {
              var x = t[i * 4], y = t[i * 4 + 1], z = t[i * 4 + 2];
              var rr = 0.98 + rng() * 0.68;
              gen.ellipsoid(rng, Math.round(q[i] * 0.54), x, y, z, rr, rr * 0.62, rr,
                b.push, { mat: 'CANOPY', inflate: 1, jit: 0.35 });
              gen.volume(rng, q[i] - Math.round(q[i] * 0.54), x, y, z, rr * 0.92, rr * 0.55, rr * 0.92,
                b.push, { mat: 'LEAF' });
            }
          } },
        { name: 'city', weight: 17, fn: function (b, n, rng) {
            var towers = 14, R = 8.1;
            var sizes = [];
            for (var i = 0; i < towers; i++) sizes.push(1);
            sizes.push(2.4);                     // cathedral + buttresses
            var q = alloc(sizes, n);
            for (var i2 = 0; i2 < towers; i2++) {
              var a = (i2 / towers) * TAU + 0.14;
              var x = Math.cos(a) * R, z = Math.sin(a) * R;
              var gy = ground(x, z) - 0.35;
              var h = 4.6 + (i2 % 4) * 0.95 + rng() * 0.65;
              var w = 1.30 + rng() * 0.26;
              var qi = alloc([1, 0.85, 0.32], q[i2]);
              gen.box(rng, qi[0], x, gy + h * 0.5, z, w, h, w, a, b.push, { mat: 'STONE' });
              gen.cone(rng, qi[1], x, gy + h, z, w * 0.96, 2.2 + (i2 % 3) * 0.45,
                b.push, { mat: i2 % 2 ? 'STONE_DK' : 'STONE' });
              // buttress plinth at tower base
              gen.box(rng, qi[2], x + Math.cos(a) * (w * 0.34), gy + 0.9, z + Math.sin(a) * (w * 0.34),
                w * 0.56, 1.8, w * 0.56, a, b.push, { mat: 'STONE_DK' });
              for (var wi = 0; wi < 4; wi++) {
                b.push(x + Math.cos(a) * (w * 0.51), gy + 1.4 + wi * 0.85,
                  z + Math.sin(a) * (w * 0.51), Math.cos(a), 0.12, Math.sin(a), 'WINDOW');
              }
            }
            // ring wall between towers, with gate gaps
            var segs = towers;
            for (var s = 0; s < segs; s++) {
              if (s % 4 === 3) continue;
              var a0 = (s / segs) * TAU + 0.14, a1 = ((s + 1) / segs) * TAU + 0.14;
              var mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * R;
              var mz = (Math.sin(a0) + Math.sin(a1)) * 0.5 * R;
              var chord = 2 * R * Math.sin((a1 - a0) * 0.5);
              gen.box(rng, Math.round(q[towers] * 0.14), mx, ground(mx, mz) + 1.35, mz,
                chord * 1.02, 3.0, 0.62, -(a0 + a1) * 0.5 + Math.PI * 0.5, b.push, { mat: 'STONE_DK' });
            }
            // cathedral
            var ca2 = 2.1, cx2 = Math.cos(ca2) * 6.9, cz2 = Math.sin(ca2) * 6.9;
            var gy2 = ground(cx2, cz2) - 0.3;
            var qq = alloc([2.2, 0.8, 0.6], q[towers]);
            gen.box(rng, qq[0], cx2, gy2 + 3.3, cz2, 3.5, 6.6, 2.5, ca2, b.push, { mat: 'STONE' });
            gen.cone(rng, qq[1], cx2, gy2 + 6.6, cz2, 2.2, 3.1, b.push, { mat: 'STONE_DK' });
            gen.capsule(rng, qq[2], cx2, gy2 + 9.7, cz2, cx2, gy2 + 12.2, cz2, 0.18, 0.04,
              b.push, { mat: 'GOLD' });
          } },
        { name: 'far', weight: 6, fn: function (b, n, rng) {
            if (ER.flags && ER.flags.far === false) return;
            var q = alloc([0.55, 0.45], n);
            gen.farRidge(rng, q[0], 56, -13, 25, 16, 219, b.push, { mat: 'FAR' });
            gen.farRidge(rng, q[1], 86, -17, 38, 24, 409, b.push, { mat: 'FAR_DEEP' });
          } },
        { name: 'motes', weight: 2, fn: function (b, n, rng) {
            var q = alloc([0.54, 0.34, 0.12], n), i, a, r, y;
            for (i = 0; i < q[0]; i++) {
              a = rng() * TAU; r = Math.sqrt(rng()) * 8.8;
              y = 5.5 + rng() * 9.0 - r * 0.12;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r,
                Math.cos(a), 0.2, Math.sin(a), 'MOTE', 1, 1, 1, rng() * TAU);
            }
            for (i = 0; i < q[1]; i++) {
              a = rng() * TAU; r = Math.sqrt(rng()) * 11.4;
              y = ground(Math.cos(a) * r, Math.sin(a) * r) + rng() * 1.8;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 'MOTE', 0.85, 0.9, 5, rng() * TAU);
            }
            for (i = 0; i < q[2]; i++) {
              a = rng() * TAU; r = 3.5 + rng() * 7.5;
              y = ground(Math.cos(a) * r, Math.sin(a) * r) + 1.2 + rng() * 3.5;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 'MIST', 1, 1, 5, rng() * TAU);
            }
          } },
        { name: 'banners', weight: 2, fn: function (b, n, rng) {
            for (var i = 0; i < 5; i++) {
              var a = 0.5 + i * 1.2, R = 8.0;
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
        var ring = Math.abs(Math.hypot(x, z) - 8.1) - 0.62;
        var dr = Math.max(ring, Math.max(0.2 - y, y - 4.2));
        if (dr < d) d = dr;
        // Canopy and the main bough mass: without this, the trunk casts a
        // shadow but the thing actually blocking the sky does not.
        var canopy = (Math.hypot(x / 6.4, (y - 15.4) / 4.8, z / 6.4) - 1) * 4.2;
        if (canopy < d) d = canopy;
        return d;
      }
    };
  })();

  /* =====================================================================
     REALM II — LIMGRAVE
     ===================================================================== */
  var limgrave = (function () {
    var ground = function (x, z) {
      var wx = x + 1.15 * C.fbm2(x * 0.055 + 7.2, z * 0.055 - 3.4, 151, 3);
      var wz = z + 1.15 * C.fbm2(x * 0.055 - 4.8, z * 0.055 + 2.6, 197, 3);
      var h = 1.16 * C.ridged2(wx * 0.078 + 3.1, wz * 0.078 - 1.7, 41, 4) - 0.44;
      h += 0.46 * C.fbm2(wx * 0.22, wz * 0.22, 77, 2);

      // Long eroded channels running down from the high ground.
      var c1 = 1 - Math.abs(C.snoise2(wx * 0.15 + 1.7, wz * 0.23 - 4.1, 231));
      var c2 = 1 - Math.abs(C.snoise2(wx * 0.33 - 2.2, wz * 0.10 + 3.5, 269));
      h -= 0.48 * Math.pow(C.clamp(c1, 0, 1), 6)
         + 0.20 * Math.pow(C.clamp(c2, 0, 1), 8);

      // crag for the castle; keep its summit broad enough for the keep
      var dx = x - 5.6, dz = z + 4.2;
      var crag = 3.4 * Math.exp(-(dx * dx + dz * dz) / 22);
      h = Math.max(h, crag + 0.58 * C.fbm2(x * 0.3, z * 0.3, 12, 2));
      var ledgeNorm = C.clamp((h + 1.0) / 4.8, 0, 1);
      h = C.lerp(h, C.terrace(ledgeNorm, 7, 0.30) * 4.8 - 1.0, 0.20);
      h += 0.045 * C.snoise2(wx * 1.1, wz * 1.1, 83);
      return h;
    };

    var terrainMat = function (x, y, z, nx, ny, nz) {
      var slope = 1 - ny;
      var grain = C.noise2(x * 0.63 - 2.7, z * 0.63 + 4.2, 313);
      if (slope > 0.48 || grain > 0.86) return 'STONE_DK';
      if (slope > 0.30) return 'CLIFF';
      if (grain > 0.74) return 'STONE_DK';
      return 'GROUND';
    };

    var cliffMat = function (y, th, t) {
      var band = 0.5 + 0.5 * Math.sin(y * 3.0 + th * 2.7);
      if (band > 0.70) return 'STONE_DK';
      if (band < 0.26) return 'CLIFF';
      return 'STONE';
    };
    var edge = function (th) {
      var c = Math.cos(th), sn = Math.sin(th);
      return 0.78 + 0.15 * C.noise2(c * 2.6 + 3, sn * 2.6 + 9, 88)
                  + 0.08 * C.noise2(c * 6.2 + 5, sn * 6.2 + 1, 42);
    };
    var castleGy = ground(5.6, -4.2);
    var towerOff = [[-1.9, -1.7], [1.9, -1.7], [-1.9, 1.7], [1.9, 1.7]];
    var towerPos = towerOff.map(function (o) {
      return [
        5.6 + o[0] * Math.cos(-0.55) + o[1] * Math.sin(-0.55),
        -4.2 - o[0] * Math.sin(-0.55) + o[1] * Math.cos(-0.55)
      ];
    });
    return {
      id: 'limgrave', label: 'LIMGRAVE', sub: 'STORMVEIL MARCH',
      epigraph: 'rain keeps the castle\u2019s name alive.',
      sky: { top: '#070d12', horizon: '#33484a', bottom: '#091013' },
      fog: { color: '#4c5f62', scatterColor: '#829a97', density: 0.0085, start: 15,
             height: { base: -1.4, density: 0.0055, falloff: 0.25, strength: 0.46 } },
      exposure: 1.06,
      light: (function () { var v = [0.36, 0.62, -0.70], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#dce6da',
      sunUv: [0.62, 0.58],
      sunDisc: 0.0,
      moon: { pos: [0.28, 0.73], size: 0.064, color: '#d5e2d8', i: 0.68 },
      ambient: '#415250',
      camera: { yaw: 1.02, pitch: 0.17, dist: 32, target: [1.1, 4.8, 0] },
      palette: ['#080d0f', '#0e1618', '#162224', '#20302f', '#2c3d3a', '#3c4f49',
                '#4f6259', '#647568', '#7b8a79', '#93a08c', '#aab5a0', '#c3cbb6',
                '#dbe1d2', '#eef1e6', '#40525a', '#6f8b8c'],
      mats: {
        GROUND: { color: '#5f6f4b', r: 0.160, a: 0.98, vary: 1, nJit: 0.52 },
        CLIFF: { color: '#3f4d48', r: 0.165, a: 0.98, strata: 0.9, nJit: 0.36 },
        STONE: { color: '#b4b3a2', r: 0.142, a: 0.98, vary: 1, strata: 0.45, nJit: 0.22 },
        STONE_DK: { color: '#565d56', r: 0.142, a: 0.98, strata: 0.65, nJit: 0.24 },
        ROOF: { color: '#374245', r: 0.125, a: 0.97 },
        TRUNK: { color: '#4b4238', r: 0.098, a: 0.95, bark: 0.8 },
        PINE: { color: '#293b2d', r: 0.115, a: 0.93, nJit: 0.22 },
        WATER: { color: '#6b8c91', r: 0.115, a: 0.52 },
        RAIN: { color: '#bdd3da', r: 0.025, a: 0.32 },
        CLOTH: { color: '#822f37', r: 0.072, a: 0.93 },
        WINDOW: { color: '#ffd693', r: 0.052, a: 0.62, glow: 2.3 },
        MOON: { color: '#e8efe4', r: 1.9, a: 0.055, glow: 1.2 },
        MIST: { color: '#8ea29f', r: 2.5, a: 0.032, noAO: true },
        FAR: { color: '#3f5558', r: 0.96, a: 0.48, noAO: true },
        FAR_DEEP: { color: '#2a3c40', r: 1.28, a: 0.36, noAO: true }
      },
      emit: [
        { name: 'ground', weight: 24, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 11.6, ground, b.push,
              { mat: 'GROUND', edge: edge, matFn: terrainMat });
          } },
        { name: 'skirt', weight: 6, fn: function (b, n, rng) {
            gen.skirt(rng, n, 11.6, ground, -3.9, b.push,
              { mat: 'CLIFF', edge: edge, matFn: cliffMat });
          } },
        { name: 'castle', weight: 21, fn: function (b, n, rng) {
            var bx = 5.6, bz = -4.2, gy = ground(bx, bz) - 0.4, yaw = -0.55;
            var q = alloc([2.6, 1.0, 0.55, 1.4, 0.5, 1.1, 0.65], n);
            // keep + lower stepped bastion
            gen.box(rng, Math.round(q[0] * 0.78), bx, gy + 3.1, bz, 3.4, 6.2, 3.0, yaw, b.push, { mat: 'STONE' });
            gen.box(rng, q[0] - Math.round(q[0] * 0.78), bx, gy + 1.4, bz, 4.2, 2.8, 3.8, yaw, b.push, { mat: 'STONE_DK' });
            // crenellations along the keep roof
            gen.box(rng, q[1], bx, gy + 6.3, bz, 3.9, 0.36, 3.5, yaw, b.push, { mat: 'STONE_DK' });
            // four towers
            var off = [[-1.9, -1.7], [1.9, -1.7], [-1.9, 1.7], [1.9, 1.7]];
            for (var i = 0; i < 4; i++) {
              var ox = off[i][0], oz = off[i][1];
              var wx = bx + ox * Math.cos(yaw) + oz * Math.sin(yaw);
              var wz = bz - ox * Math.sin(yaw) + oz * Math.cos(yaw);
              var hh = 6.5 + (i % 2) * 1.2;
              gen.cylinder(rng, Math.round(q[2] / 4), wx, gy, wz, 0.74, 0.66, hh, b.push, { mat: 'STONE' });
              gen.cone(rng, Math.round(q[3] / 4), wx, gy + hh, wz, 0.80, 1.85, b.push, { mat: 'ROOF' });
            }
            // curtain wall running down the crag
            for (var s = 0; s < 5; s++) {
              var t = s / 5;
              var x0 = bx - 4.2 + Math.cos(yaw) * (t * 3.2) - 2.4 * t;
              var z0 = bz + 2.6 + Math.sin(yaw) * (t * 2.0) + 2.0 * t;
              var x1 = x0 - 2.1, z1 = z0 + 1.5;
              var my = (ground(x0, z0) + ground(x1, z1)) * 0.5;
              gen.box(rng, Math.round(q[4] / 5), (x0 + x1) * 0.5, my + 1.25, (z0 + z1) * 0.5,
                2.7, 2.65, 0.40, Math.atan2(z1 - z0, x1 - x0) * -1 + Math.PI * 0.5, b.push, { mat: 'STONE_DK' });
            }
            // windows lit from within
            for (var wi = 0; wi < 9; wi++) {
              var wx = bx - 1.3 + (wi % 3) * 1.3;
              var wy = gy + 1.6 + Math.floor(wi / 3) * 1.7;
              for (var wj = 0; wj < 16; wj++) {
                b.push(wx + (rng() - 0.5) * 0.22, wy + (rng() - 0.5) * 0.36,
                  bz + 1.53 + (rng() - 0.5) * 0.05, 0, 0.2, 1, 'WINDOW');
              }
            }
            gen.arc(rng, Math.round(q[6] * 0.55), bx, gy + 1.35, bz + 1.58, 0.82, 0.16,
              0.10, Math.PI - 0.10, b.push, { mat: 'STONE' });
            gen.box(rng, Math.round(q[6] * 0.2), bx - 0.96, gy + 0.9, bz + 1.55, 0.24, 1.8, 0.22, 0, b.push, { mat: 'STONE_DK' });
            gen.box(rng, Math.round(q[6] * 0.2), bx + 0.96, gy + 0.9, bz + 1.55, 0.24, 1.8, 0.22, 0, b.push, { mat: 'STONE_DK' });
            gen.cloth(rng, Math.round(q[5] * 0.5), bx - 1.1, gy + 5.9, bz + 1.55, 0.8, 2.4, yaw, b.push, { mat: 'CLOTH' });
            gen.cloth(rng, Math.round(q[5] * 0.5), bx + 1.1, gy + 5.9, bz + 1.55, 0.8, 2.4, yaw, b.push, { mat: 'CLOTH' });
          } },
        { name: 'pines', weight: 14, fn: function (b, n, rng) {
            var k = 16, q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var x = 0, z = 0, guard = 0;
              do {
                var a = rng() * TAU, r = 2.5 + Math.sqrt(rng()) * 7.4;
                x = Math.cos(a) * r; z = Math.sin(a) * r;
              } while (guard++ < 12 &&
                       (Math.hypot(x - 5.6, z + 4.2) < 3.8 || Math.hypot(x, z) < 1.6));
              var gy = ground(x, z) - 0.1;
              var hh = 2.6 + rng() * 2.4, sw = 0.55 + rng() * 0.3;
              var qi = alloc([0.3, 1, 0.8, 0.6], q[i]);
              gen.capsule(rng, qi[0], x, gy, z, x, gy + hh * 0.45, z, 0.14, 0.09, b.push, { mat: 'TRUNK' });
              gen.cone(rng, qi[1], x, gy + hh * 0.2, z, sw * 1.5, hh * 0.55, b.push, { mat: 'PINE' });
              gen.cone(rng, qi[2], x, gy + hh * 0.5, z, sw * 1.15, hh * 0.45, b.push, { mat: 'PINE' });
              gen.cone(rng, qi[3], x, gy + hh * 0.74, z, sw * 0.8, hh * 0.38, b.push, { mat: 'PINE' });
            }
          } },
        { name: 'stones', weight: 9, fn: function (b, n, rng) {
            var k = 20, q = alloc(new Array(k).fill(1), n);
            for (var i = 0; i < k; i++) {
              var a = rng() * TAU, r = 3 + Math.sqrt(rng()) * 8;
              var x = Math.cos(a) * r, z = Math.sin(a) * r;
              var gy = ground(x, z);
              if (i % 2 === 0) {
                var rr = 0.45 + rng() * 0.40;
                gen.ellipsoid(rng, q[i], x, gy + rr * 0.32, z, rr * 1.2, rr * 0.7, rr,
                  b.push, { mat: 'STONE_DK', inflate: 0.94, jit: 0.25 });
              } else {
                var hh = 1.0 + rng() * 2.1;
                gen.box(rng, q[i], x, gy + hh * 0.4, z, 0.46 + rng() * 0.3, hh, 0.36 + rng() * 0.24,
                  rng() * TAU, b.push, { mat: 'STONE_DK' });
              }
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
        { name: 'far', weight: 6, fn: function (b, n, rng) {
            if (ER.flags && ER.flags.far === false) return;
            var q = alloc([0.55, 0.45], n);
            gen.farRidge(rng, q[0], 56, -14, 25, 18, 219, b.push, { mat: 'FAR' });
            gen.farRidge(rng, q[1], 86, -18, 38, 24, 377, b.push, { mat: 'FAR_DEEP' });
          } },
        { name: 'rain', weight: 7, fn: function (b, n, rng) {
            var q = alloc([0.85, 0.15], n), i;
            for (i = 0; i < q[0]; i++) {
              var a = rng() * TAU, r = Math.sqrt(rng()) * 13;
              var y = rng() * 15;
              b.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, 'RAIN', 1, 1, 2, rng() * TAU);
            }
            for (i = 0; i < q[1]; i++) {
              var ma = rng() * TAU, mr = 2.5 + rng() * 9.0;
              var mx = Math.cos(ma) * mr, mz = Math.sin(ma) * mr;
              b.push(mx, ground(mx, mz) + 0.7 + rng() * 2.2, mz, 0, 1, 0, 'MIST', 1, 1, 5, rng() * TAU);
            }
          } }
      ],
      macro: function (x, y, z) {
        var d = y - ground(x, z);
        var gy0 = castleGy;
        // castle block
        var bx = Math.abs(x - 5.6) - 2.4, by = Math.abs(y - (gy0 + 3.1)) - 3.2, bz = Math.abs(z + 4.2) - 2.2;
        var db = Math.hypot(Math.max(bx, 0), Math.max(by, 0), Math.max(bz, 0)) + Math.min(Math.max(bx, Math.max(by, bz)), 0);
        if (db < d) d = db;
        // four corner towers, approximated as vertical capsules
        var my = gy0 + 3.6;
        for (var mi = 0; mi < 4; mi++) {
          var tp = towerPos[mi];
          var dd = Math.hypot(x - tp[0], Math.max(0, Math.abs(y - my) - 3.0), z - tp[1]) - 0.8;
          if (dd < d) d = dd;
        }
        return d;
      }
    };
  })();

  /* =====================================================================
     REALM III — CAELID
     ===================================================================== */
  var caelid = (function () {
    var ground = function (x, z) {
      var wx = x + 1.0 * C.fbm2(x * 0.07 - 2.1, z * 0.07 + 4.4, 181, 3);
      var wz = z + 1.0 * C.fbm2(x * 0.07 + 5.8, z * 0.07 - 3.1, 223, 3);
      var h = 0.78 * C.fbm2(wx * 0.13 + 5.3, wz * 0.13 - 2.2, 213, 4);
      h += 0.42 * C.ridged2(wx * 0.26, wz * 0.26, 8, 3) - 0.20;

      // cracked runnels, stepped mesa shelves, and a shallow rot basin
      var crack = 1 - Math.abs(C.snoise2(wx * 0.37 + 1.2, wz * 0.29 - 4.6, 307));
      h -= 0.24 * Math.pow(C.clamp(crack, 0, 1), 10);
      var r2 = x * x + z * z;
      h -= 0.62 * Math.exp(-r2 / 18);
      var mesaNorm = C.clamp((h + 1.1) / 3.4, 0, 1);
      h = C.lerp(h, C.terrace(mesaNorm, 5, 0.26) * 3.4 - 1.1, 0.24);
      h += 0.04 * C.snoise2(wx * 1.6, wz * 1.6, 53);
      return h;
    };

    var terrainMat = function (x, y, z, nx, ny, nz) {
      var slope = 1 - ny;
      var grain = C.noise2(x * 0.57 + 3.8, z * 0.57 - 1.4, 331);
      var ash = C.noise2(x * 0.21 - 2.6, z * 0.21 + 7.1, 127);
      if (slope > 0.50) return 'RUST';
      if (slope > 0.31) return 'CLIFF';
      if (grain > 0.82) return 'BONE';
      if (grain > 0.61) return 'PALE';
      if (ash > 0.64) return 'SOIL';
      if (grain < 0.20) return 'RUST';
      return 'CRUST';
    };

    var cliffMat = function (y, th, t) {
      var band = 0.5 + 0.5 * Math.sin(y * 3.1 + th * 2.3);
      if (band > 0.74) return 'RUST';
      return 'CLIFF';
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
    var heroTreeGy = ground(-3.4, 2.2);
    var ruinGy = ground(4.8, -3.6);
    var monoX = Math.cos(1.2) * 6.8, monoZ = Math.sin(1.2) * 6.8;
    var monoGy = ground(monoX, 3.2);
    return {
      id: 'caelid', label: 'CAELID', sub: 'THE SCARLET WASTE',
      epigraph: 'nothing here was burned. it was infected.',
      sky: { top: '#140508', horizon: '#552923', bottom: '#160809' },
      fog: { color: '#523732', scatterColor: '#c2573c', density: 0.0072, start: 16,
             height: { base: -1.6, density: 0.0042, falloff: 0.25, strength: 0.38 } },
      exposure: 1.06,
      light: (function () { var v = [0.52, 0.66, 0.54], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })(),
      lightCol: '#ffcca8',
      sunUv: [0.62, 0.52],
      sunDisc: 0.24,
      ambient: '#6a564c',
      camera: { yaw: 0.92, pitch: 0.20, dist: 30, target: [0.4, 4.2, 0] },
      palette: ['#100407', '#1c0709', '#2a0c0c', '#3a1210', '#4d1a14', '#63241a',
                '#7c3120', '#984227', '#b3552f', '#c96b3a', '#d9863f', '#8a6a4a',
                '#a88a63', '#c7ab84', '#5b1a1c', '#7a2a22'],
      mats: {
        CRUST: { color: '#4c3830', r: 0.160, a: 0.98, vary: 1, strata: 0.45, nJit: 0.52 },
        CLIFF: { color: '#452b25', r: 0.165, a: 0.98, strata: 0.9, nJit: 0.34 },
        ROT_BARK: { color: '#2d231f', r: 0.105, a: 0.96, bark: 0.85, nJit: 0.68 },
        ASH: { color: '#8d8070', r: 0.092, a: 0.52 },
        BONE: { color: '#bab096', r: 0.098, a: 0.95, nJit: 0.18 },
        SCARLET: { color: '#c84229', r: 0.125, a: 0.76, glow: 0.82 },
        EMBER: { color: '#e67d3d', r: 0.048, a: 0.66, glow: 1.45 },
        RUST: { color: '#78503b', r: 0.128, a: 0.96, strata: 0.6, nJit: 0.22 },
        STONE: { color: '#8f826e', r: 0.142, a: 0.98, vary: 1, strata: 0.45, nJit: 0.22 },
        GLOW: { color: '#ffb070', r: 0.05, a: 0.65, glow: 1.65 },
        SOIL: { color: '#5f473d', r: 0.148, a: 0.97, vary: 1, nJit: 0.42 },
        PALE: { color: '#9c8a70', r: 0.148, a: 0.97, vary: 1, nJit: 0.24 },
        ROT: { color: '#7a251d', r: 0.135, a: 0.70 },
        HAZE: { color: '#84241c', r: 2.3, a: 0.032, noAO: true },
        FAR: { color: '#5c2a24', r: 0.96, a: 0.48, noAO: true },
        FAR_DEEP: { color: '#3f1a18', r: 1.28, a: 0.36, noAO: true }
      },
      emit: [
        { name: 'ground', weight: 23, shadow: true, fn: function (b, n, rng) {
            gen.heightfield(rng, n, 11.2, ground, b.push,
              { mat: 'CRUST', edge: edge, matFn: terrainMat });
          } },
        { name: 'skirt', weight: 5, fn: function (b, n, rng) {
            gen.skirt(rng, n, 11.2, ground, -3.7, b.push,
              { mat: 'CLIFF', edge: edge, matFn: cliffMat });
          } },
        { name: 'heroTree', weight: 14, fn: function (b, n, rng) {
            var x = -3.4, z = 2.2, gy = ground(x, z);
            var segs = [];
            collectDead(rng, x, gy, z, 6.4, 0.62, 3, 0.12, 0.99, -0.05, segs);
            for (var i = 0; i < 5; i++) {
              var a = (i / 5) * TAU + 0.4;
              var x1 = x + Math.cos(a) * 1.9, z1 = z + Math.sin(a) * 1.9;
              segs.push(x, gy + 0.9, z, x1, ground(x1, z1) - 0.2, z1, 0.34, 0.1, 1.4);
            }
            emitSegs(b, rng, segs, n);
          } },
        { name: 'ribs', weight: 5, fn: function (b, n, rng) {
            var cx = 1.2, cz = 5.2, gy = ground(cx, cz);
            var ribs = 7, q = alloc(new Array(ribs).fill(1), n);
            for (var i = 0; i < ribs; i++) {
              var z = cz + (i - ribs * 0.5) * 0.84;
              var lean = 0.35 + rng() * 0.35;
              var top = gy + 2.45 + 0.62 * Math.sin(i * 1.5);
              gen.capsule(rng, Math.round(q[i] * 0.34), cx, gy - 0.15, z, cx + 2.0, top, z, 0.24, 0.14, b.push, { mat: 'BONE' });
              gen.capsule(rng, Math.round(q[i] * 0.34), cx + 4.0, gy - 0.15, z, cx + 2.0, top, z, 0.24, 0.14, b.push, { mat: 'BONE' });
              gen.capsule(rng, q[i] - Math.round(q[i] * 0.68), cx + 2.0, top, z, cx + 2.0 + lean * 0.3, top + 0.52, z, 0.13, 0.05, b.push, { mat: 'BONE' });
            }
            gen.capsule(rng, Math.round(n * 0.08), cx - 0.4, gy + 0.7, cz - 2.8, cx - 0.1, gy + 0.35, cz + 3.2, 0.24, 0.08, b.push, { mat: 'BONE' });
          } },
        { name: 'deadTrees', weight: 10, fn: function (b, n, rng) {
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
              var hh = 2.2 + rng() * 2.5;
              gen.box(rng, q[i], x, gy + hh * 0.42, z, 0.62 + rng() * 0.3, hh, 0.34, rng() * TAU,
                b.push, { mat: i % 2 ? 'STONE' : 'RUST' });
              for (var s = 0; s < 6; s++) {
                b.push(x + (rng() - 0.5) * 0.4, gy + 0.4 + rng() * (hh - 0.8), z + 0.19,
                  (rng() - 0.5) * 0.3, 0.2, 1, 'GLOW');
              }
            }
          } },
        { name: 'ruin', weight: 8, fn: function (b, n, rng) {
            var x = 4.8, z = -3.6, gy = ground(x, z), yaw = 0.42;
            var q = alloc([2.2, 1.2, 0.9], n);
            gen.box(rng, q[0], x, gy + 2.4, z, 4.6, 4.8, 0.5, yaw, b.push, { mat: 'STONE' });
            gen.box(rng, q[1], x + Math.cos(yaw) * 0.1, gy + 1.1, z + 0.35, 1.5, 2.2, 0.28, yaw,
              b.push, { mat: 'CRUST' });
            gen.arc(rng, q[2], x - 1.9, gy, z + 1.4, 1.1, 0.2, 0.2, Math.PI - 0.2, b.push, { mat: 'BONE' });
            for (var i = 0; i < 40; i++) {
              var a = rng() * TAU, r = rng() * 2.6;
              var px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
              gen.ellipsoid(rng, 26, px, ground(px, pz) + 0.1, pz,
                0.16 + rng() * 0.2, 0.1 + rng() * 0.12, 0.16 + rng() * 0.2,
                b.push, { mat: 'BONE', inflate: 0.95 });
            }
          } },
        { name: 'rot', weight: 6, fn: function (b, n, rng) {
            gen.disc(rng, Math.round(n * 0.45), 1.2, ground(1.2, 0.4) + 0.1, 0.4, 3.4, b.push, { mat: 'ROT' });
            for (var i = 0; i < 28; i++) {
              var a = rng() * TAU, r = 0.4 + Math.sqrt(rng()) * 3.2;
              var x = 1.2 + Math.cos(a) * r, z = 0.4 + Math.sin(a) * r;
              var hh = 0.25 + rng() * 0.78;
              gen.cone(rng, 30, x, ground(x, z), z, 0.12 + rng() * 0.1, hh, b.push, { mat: 'SCARLET' });
            }
            for (var j = 0; j < Math.round(n * 0.2); j++) {
              var aa = rng() * TAU, rr = Math.sqrt(rng()) * 5;
              b.push(1.2 + Math.cos(aa) * rr, ground(1.2, 0.4) + rng() * 0.65, 0.4 + Math.sin(aa) * rr,
                0, 1, 0, 'EMBER', 1, 1, 3, rng() * TAU);
            }
          } },
        { name: 'far', weight: 6, fn: function (b, n, rng) {
            if (ER.flags && ER.flags.far === false) return;
            var q = alloc([0.55, 0.45], n);
            gen.farRidge(rng, q[0], 54, -14, 25, 18, 219, b.push, { mat: 'FAR' });
            gen.farRidge(rng, q[1], 84, -18, 38, 24, 431, b.push, { mat: 'FAR_DEEP' });
          } },
        { name: 'ash', weight: 8, fn: function (b, n, rng) {
          var q = alloc([0.82, 0.18], n), i;
          for (i = 0; i < q[0]; i++) {
            var a = rng() * TAU, r = Math.sqrt(rng()) * 12;
            b.push(Math.cos(a) * r, ground(Math.cos(a) * r, Math.sin(a) * r) + rng() * 9,
              Math.sin(a) * r, 0, 1, 0, 'ASH', 0.8 + rng() * 0.6, 1, 3, rng() * TAU);
          }
          for (i = 0; i < q[1]; i++) {
            var ha = rng() * TAU, hr = 1.5 + rng() * 8.5;
            var hx = Math.cos(ha) * hr, hz = Math.sin(ha) * hr;
            b.push(hx, ground(hx, hz) + 0.4 + rng() * 1.8, hz, 0, 1, 0, 'HAZE', 1, 1, 5, rng() * TAU);
          }
        } }
      ],
      macro: function (x, y, z) {
        var d = y - ground(x, z);
        var dt = Math.hypot(x + 3.4, (y - heroTreeGy - 3.2) * 0.42, z - 2.2) - 1.1;
        if (dt < d) d = dt;
        // ruin wall and a representative monolith: enough to anchor contact
        // shadow without evaluating every random piece in the field.
        var rx = Math.abs(x - 4.8) - 2.4, ry = Math.abs(y - (ruinGy + 2.4)) - 2.5;
        var rz = Math.abs(z + 3.6) - 0.36;
        var dr = Math.hypot(Math.max(rx, 0), Math.max(ry, 0), Math.max(rz, 0))
               + Math.min(Math.max(rx, Math.max(ry, rz)), 0);
        if (dr < d) d = dr;
        var dm = Math.hypot(x - monoX, Math.max(0, Math.abs(y - monoGy - 2.0) - 2.0),
                           z - monoZ) - 0.55;
        if (dm < d) d = dm;
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
