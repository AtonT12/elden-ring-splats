/* render.js — WebGL2 gaussian splat rasteriser.
   One instanced draw call for the whole cloud, then a quantise/dither pass.
   Nothing here allocates per frame except the order buffer upload. */
(function (ER) {
  'use strict';
  var C = ER.core;

  var TEX_W = 2048;          // texels per row in every data texture
  var BUCKETS = 1024;
  var Z_MIN = -30, Z_MAX = 90;

  /* ---------------- shaders ---------------- */

  var VS_SPLAT = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    'precision highp usampler2D;',
    'uniform sampler2D uData;',
    'uniform usampler2D uOrder;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform vec3 uEye;',
    'uniform vec2 uFbo;',
    'uniform float uScale;',
    'uniform float uMaxPx;',
    'uniform float uTime;',
    'uniform float uAnimate;',
    'uniform float uFade;',
    'in vec2 aCorner;',
    'out vec2 vUv;',
    'out vec3 vCol;',
    'out vec3 vNrm;',
    'out vec3 vView;',
    'out float vAlpha;',
    'out float vDepth;',
    'out float vAo;',
    'flat out int vMode;',
    '',
    'void main() {',
    '  ivec2 oc = ivec2(gl_InstanceID & 2047, gl_InstanceID >> 11);',
    '  int id = int(texelFetch(uOrder, oc, 0).r);',
    '  int base = id * 4;',
    '  ivec2 t0 = ivec2(base & 2047, base >> 11);',
    '  vec4 A = texelFetch(uData, t0, 0);',
    '  vec4 Bc = texelFetch(uData, t0 + ivec2(1, 0), 0);',
    '  vec4 Cn = texelFetch(uData, t0 + ivec2(2, 0), 0);',
    '  vec4 Dp = texelFetch(uData, t0 + ivec2(3, 0), 0);',
    '',
    '  vec3 p = A.xyz;',
    '  int mode = int(Cn.w + 0.5);',
    '  float ph = Dp.x;',
    '  if (uAnimate > 0.5) {',
    '    if (mode == 1) {',
    '      p.y += fract(uTime * 0.045 + ph * 0.159) * 5.0 - 1.0;',
    '      p.x += sin(uTime * 0.5 + ph) * 0.16;',
    '      p.z += cos(uTime * 0.43 + ph * 1.7) * 0.16;',
    '    } else if (mode == 2) {',
    '      p.y = mod(A.y - uTime * 11.0 + ph * 4.0, 16.0);',
    '    } else if (mode == 3) {',
    '      p.y -= mod(uTime * 0.55 + ph * 1.3, 2.2);',
    '      p.x += sin(uTime * 0.7 + ph) * 0.22;',
    '    } else if (mode == 4) {',
    '      p.x += sin(uTime * 1.7 + p.y * 2.0 + ph) * 0.07;',
    '    } else if (mode == 5) {',
    '      p.y += sin(uTime * 0.8 + ph) * 0.14;',
    '    }',
    '  }',
    '',
    '  vec4 vp = uView * vec4(p, 1.0);',
    '  gl_Position = uProj * vp;',
    '  float focal = uProj[1][1] * 0.5 * uFbo.y;',
    '  float px = A.w * focal / max(-vp.z, 0.05) * uScale;',
    '  px = clamp(px, 0.65, uMaxPx);',
    '  gl_Position.xy += aCorner * (px * 2.0 / uFbo) * gl_Position.w;',
    '',
    '  vUv = aCorner;',
    '  vCol = Bc.rgb;',
    '  vAlpha = Bc.a * uFade;',
    '  vNrm = Cn.xyz;',
    '  vView = normalize(p - uEye);',
    '  vDepth = -vp.z;',
    '  vAo = Dp.y;',
    '  vMode = mode;',
    '}'
  ].join('\n');

  var FS_SPLAT = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'in vec3 vCol;',
    'in vec3 vNrm;',
    'in vec3 vView;',
    'in float vAlpha;',
    'in float vDepth;',
    'in float vAo;',
    'flat in int vMode;',
    'uniform int uSplatView;',
    'uniform int uViewMode;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform float uFogStart;',
    'uniform float uRim;',
    'out vec4 outColor;',
    '',
    'void main() {',
    '  float r2 = dot(vUv, vUv);',
    '  float a;',
    '  if (uSplatView == 1) {',
    '    a = 1.0 - smoothstep(0.72, 1.0, r2);',
    '  } else {',
    '    a = exp(-4.2 * r2);',
    '  }',
    '  a *= vAlpha;',
    '  if (a < 0.010) discard;',
    '  float fog = 1.0 - exp(-max(0.0, vDepth - uFogStart) * uFogDensity);',
    '  vec3 col = mix(vCol, uFogColor, fog);',
    '  float rim = pow(1.0 - abs(dot(normalize(vNrm), vView)), 3.0);',
    '  col += rim * uRim;',
    '  if (uViewMode == 1) col = vNrm * 0.5 + 0.5;',
    '  else if (uViewMode == 2) col = vec3(vAo);',
    '  else if (uViewMode == 3) col = vec3(fract(vDepth * 0.08));',
    '  outColor = vec4(col, a);',
    '}'
  ].join('\n');

  var VS_POST = [
    '#version 300 es',
    'in vec2 aPos;',
    'out vec2 vUv;',
    'void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FS_POST = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv;',
    'uniform sampler2D uScene;',
    'uniform vec2 uRes;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uSkyHor;',
    'uniform vec3 uSkyBot;',
    'uniform vec3 uSunCol;',
    'uniform vec2 uSunPos;',
    'uniform vec2 uMoonPos;',
    'uniform vec3 uMoonCol;',
    'uniform vec2 uMoonPar;',
    'uniform float uDither;',
    'uniform float uPixelArt;',
    'uniform float uVignette;',
    'uniform vec3 uPal[16];',
    'out vec4 outColor;',
    '',
    'float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }',
    'float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }',
    'float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }',
    '',
    'vec3 skyAt(vec2 uv) {',
    '  float h = uv.y;',
    '  vec3 s = mix(uSkyHor, uSkyTop, smoothstep(0.36, 1.0, h));',
    '  s = mix(uSkyBot, s, smoothstep(0.0, 0.36, h));',
    '  // faint bloom standing where the light comes from',
    '  vec2 d = (uv - uSunPos) * vec2(uRes.x / uRes.y, 1.0);',
    '  float g = exp(-dot(d, d) * 9.0) * 0.20 + exp(-dot(d, d) * 1.8) * 0.06;',
    '  return s + uSunCol * g;',
    '}',
    '',
    'void main() {',
    '  vec4 sc = texture(uScene, vUv);',
    '  vec3 c = sc.rgb + skyAt(vUv) * (1.0 - sc.a);',
    '',
    '  vec2 asp = vec2(uRes.x / uRes.y, 1.0);',
    '  float md = length((vUv - uMoonPos) * asp);',
    '  float disc = 1.0 - smoothstep(uMoonPar.x * 0.92, uMoonPar.x, md);',
    '  float ring = exp(-max(0.0, md - uMoonPar.x) * 8.0) * 0.09;',
    '  c = mix(c, uMoonCol, disc * uMoonPar.y);',
    '  c += uMoonCol * ring * uMoonPar.y;',
    '',
    '  float b = bayer8(gl_FragCoord.xy) - 0.5;',
    '  vec3 d = c + b * uDither * 0.075;',
    '  vec3 q = c;',
    '  float best = 1e9;',
    '  for (int i = 0; i < 16; i++) {',
    '    vec3 dd = uPal[i] - d;',
    '    vec3 w = dd * vec3(0.92, 1.0, 0.74);',
    '    float dist = dot(w, w);',
    '    if (dist < best) { best = dist; q = uPal[i]; }',
    '  }',
    '  c = mix(c, q, uPixelArt);',
    '',
    '  vec2 v = (vUv - 0.5) * vec2(1.02, 1.1);',
    '  c *= 1.0 - uVignette * dot(v, v);',
    '  outColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ---------------- helpers ---------------- */

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  function uniforms(gl, p, names) {
    var u = {};
    for (var i = 0; i < names.length; i++) u[names[i]] = gl.getUniformLocation(p, names[i]);
    return u;
  }

  /* ---------------- renderer ---------------- */

  function init(canvas) {
    var gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true
    });
    if (!gl) throw new Error('WebGL2 unavailable');

    var floatTarget = gl.getExtension('EXT_color_buffer_float');

    var R = {
      gl: gl, canvas: canvas,
      w: canvas.width, h: canvas.height,
      count: 0, order: null, cloud: null, scene: null,
      sortMs: 0, drawMs: 0,
      quality: 3, maxPx: 48, splatScale: 1,
      opts: { pixelArt: 1, splatView: 0, dither: 0.6, animate: 1, fade: 1 },
      renderer: (function () {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl2';
      })()
    };

    R.progSplat = program(gl, VS_SPLAT, FS_SPLAT);
    R.progPost = program(gl, VS_POST, FS_POST);
    R.uSplat = uniforms(gl, R.progSplat, [
      'uData', 'uOrder', 'uView', 'uProj', 'uEye', 'uFbo', 'uScale', 'uMaxPx', 'uTime',
      'uAnimate', 'uFade', 'uSplatView', 'uViewMode', 'uFogColor', 'uFogDensity', 'uFogStart', 'uRim'
    ]);
    R.uPost = uniforms(gl, R.progPost, [
      'uScene', 'uRes', 'uSkyTop', 'uSkyHor', 'uSkyBot', 'uSunCol', 'uSunPos',
      'uMoonPos', 'uMoonCol', 'uMoonPar', 'uDither', 'uPixelArt', 'uVignette', 'uPal'
    ]);

    /* corner quad */
    R.cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    R.cornerLoc = gl.getAttribLocation(R.progSplat, 'aCorner');
    R.vaoSplat = gl.createVertexArray();
    gl.bindVertexArray(R.vaoSplat);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.cornerBuf);
    gl.enableVertexAttribArray(R.cornerLoc);
    gl.vertexAttribPointer(R.cornerLoc, 2, gl.FLOAT, false, 0, 0);

    /* fullscreen quad */
    R.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    R.postLoc = gl.getAttribLocation(R.progPost, 'aPos');
    R.vaoPost = gl.createVertexArray();
    gl.bindVertexArray(R.vaoPost);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quadBuf);
    gl.enableVertexAttribArray(R.postLoc);
    gl.vertexAttribPointer(R.postLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    /* data texture */
    R.dataTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, R.dataTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* order texture */
    R.orderTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, R.orderTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    /* buckets */
    R.hist = new Uint32Array(BUCKETS);
    R.start = new Uint32Array(BUCKETS);
    R.bucket = null;
    R.orderArr = null;

    /* fbo */
    R.fbo = gl.createFramebuffer();
    R.fboTex = gl.createTexture();
    R.floatTarget = !!floatTarget;

    R.allocTarget = function (w, h) {
      R.w = w; R.h = h;
      gl.bindTexture(gl.TEXTURE_2D, R.fboTex);
      if (R.floatTarget) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, R.fboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    R.resize = function (w, h) {
      canvas.width = w; canvas.height = h;
      R.allocTarget(w, h);
      if (R.scene) R.applySky(R.scene);
    };

    R.applySky = function (scene) {
      R.scene = scene;
      R.skyTop = C.hexToRgb(scene.sky.top);
      R.skyHor = C.hexToRgb(scene.sky.horizon);
      R.skyBot = C.hexToRgb(scene.sky.bottom);
      R.sunCol = C.hexToRgb(scene.lightCol || '#ffffff');
      R.fog = C.hexToRgb(scene.fog.color);
      R.palette = new Float32Array(48);
      for (var i = 0; i < 16; i++) {
        var c = C.hexToRgb(scene.palette[i] || '#000000');
        R.palette[i * 3] = c[0];
        R.palette[i * 3 + 1] = c[1];
        R.palette[i * 3 + 2] = c[2];
      }
      R.sunPos = scene.sunUv || [0.5, 0.58];
      var mo = scene.moon || { pos: [0.5, 0.5], size: 0.06, color: '#ffffff', i: 0 };
      R.moonPos = mo.pos;
      R.moonCol = C.hexToRgb(mo.color);
      R.moonPar = [mo.size, mo.i];
    };

    /* upload a cloud into the data texture */
    R.upload = function (cloud) {
      var n = cloud.count, texels = n * 4;
      var h = Math.ceil(texels / TEX_W);
      var buf = new Float32Array(h * TEX_W * 4);
      for (var i = 0; i < n; i++) {
        var b = i * 16;
        buf[b] = cloud.pos[i * 3];
        buf[b + 1] = cloud.pos[i * 3 + 1];
        buf[b + 2] = cloud.pos[i * 3 + 2];
        buf[b + 3] = cloud.rad[i];
        buf[b + 4] = cloud.col[i * 3];
        buf[b + 5] = cloud.col[i * 3 + 1];
        buf[b + 6] = cloud.col[i * 3 + 2];
        buf[b + 7] = cloud.alp[i];
        buf[b + 8] = cloud.nor[i * 3];
        buf[b + 9] = cloud.nor[i * 3 + 1];
        buf[b + 10] = cloud.nor[i * 3 + 2];
        buf[b + 11] = cloud.ani[i];
        buf[b + 12] = cloud.pha[i];
        buf[b + 13] = cloud.ao ? cloud.ao[i] : 1;
        buf[b + 14] = 0; buf[b + 15] = 0;
      }
      gl.bindTexture(gl.TEXTURE_2D, R.dataTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, h, 0, gl.RGBA, gl.FLOAT, buf);

      R.count = n;
      R.cloud = cloud;

      var oh = Math.ceil(n / TEX_W);
      R.orderH = oh;
      // the order texture is always a full rectangle, so the upload buffer
      // has to be padded out to TEX_W * oh entries
      R.orderBuf = new Uint32Array(TEX_W * oh);
      R.orderArr = R.orderBuf.subarray(0, n);
      for (var j = 0; j < n; j++) R.orderArr[j] = j;
      R.bucket = new Uint16Array(n);

      gl.bindTexture(gl.TEXTURE_2D, R.orderTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, TEX_W, oh, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null);
      R.orderDirty = true;
    };

    /* counting sort, far to near */
    R.sort = function (cam) {
      var t0 = C.now();
      var n = R.count;
      if (!n) return 0;
      var p = R.cloud.pos, eye = cam.eye();
      var f = cam.target;
      var fx = f[0] - eye[0], fy = f[1] - eye[1], fz = f[2] - eye[2];
      var fl = 1 / (Math.hypot(fx, fy, fz) || 1);
      fx *= fl; fy *= fl; fz *= fl;
      var ex = eye[0], ey = eye[1], ez = eye[2];

      R.hist.fill(0);
      var dmin = Z_MIN, dscale = BUCKETS / (Z_MAX - Z_MIN);
      var i, b, dz;
      for (i = 0; i < n; i++) {
        dz = (p[i * 3] - ex) * fx + (p[i * 3 + 1] - ey) * fy + (p[i * 3 + 2] - ez) * fz;
        var bi = ((dz - dmin) * dscale) | 0;
        if (bi < 0) bi = 0; else if (bi > BUCKETS - 1) bi = BUCKETS - 1;
        R.bucket[i] = bi;
        R.hist[bi]++;
      }
      var acc = 0;
      for (b = BUCKETS - 1; b >= 0; b--) { R.start[b] = acc; acc += R.hist[b]; }
      var ord = R.orderArr;
      for (i = 0; i < n; i++) ord[R.start[R.bucket[i]]++] = i;

      gl.bindTexture(gl.TEXTURE_2D, R.orderTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, R.orderH,
        gl.RED_INTEGER, gl.UNSIGNED_INT, R.orderBuf);

      R.sortMs = C.now() - t0;
      return R.sortMs;
    };

    R.draw = function (cam, time, aspect) {
      var gl2 = gl;
      // --- splat pass
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, R.fbo);
      gl2.viewport(0, 0, R.w, R.h);
      gl2.clearColor(0, 0, 0, 0);
      gl2.clear(gl2.COLOR_BUFFER_BIT);
      gl2.enable(gl2.BLEND);
      gl2.blendFuncSeparate(gl2.SRC_ALPHA, gl2.ONE_MINUS_SRC_ALPHA,
                            gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
      gl2.disable(gl2.DEPTH_TEST);

      gl2.useProgram(R.progSplat);
      gl2.bindVertexArray(R.vaoSplat);

      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, R.dataTex);
      gl2.uniform1i(R.uSplat.uData, 0);
      gl2.activeTexture(gl2.TEXTURE1);
      gl2.bindTexture(gl2.TEXTURE_2D, R.orderTex);
      gl2.uniform1i(R.uSplat.uOrder, 1);

      gl2.uniformMatrix4fv(R.uSplat.uView, false, cam.view());
      gl2.uniformMatrix4fv(R.uSplat.uProj, false, cam.proj(aspect));
      gl2.uniform3fv(R.uSplat.uEye, cam.eye());
      gl2.uniform2f(R.uSplat.uFbo, R.w, R.h);
      gl2.uniform1f(R.uSplat.uScale, R.splatScale);
      gl2.uniform1f(R.uSplat.uMaxPx, R.maxPx);
      gl2.uniform1f(R.uSplat.uTime, time);
      gl2.uniform1f(R.uSplat.uAnimate, R.opts.animate);
      gl2.uniform1f(R.uSplat.uFade, R.opts.fade);
      gl2.uniform1i(R.uSplat.uSplatView, R.opts.splatView);
      gl2.uniform1i(R.uSplat.uViewMode, R.opts.viewMode || 0);
      gl2.uniform3fv(R.uSplat.uFogColor, R.fog);
      gl2.uniform1f(R.uSplat.uFogDensity, R.scene.fog.density);
      gl2.uniform1f(R.uSplat.uFogStart, R.scene.fog.start);
      gl2.uniform1f(R.uSplat.uRim, 0.14);

      gl2.drawArraysInstanced(gl2.TRIANGLE_STRIP, 0, 4, R.count);

      // --- post pass
      gl2.bindFramebuffer(gl2.FRAMEBUFFER, null);
      gl2.viewport(0, 0, R.w, R.h);
      gl2.disable(gl2.BLEND);
      gl2.useProgram(R.progPost);
      gl2.bindVertexArray(R.vaoPost);

      gl2.activeTexture(gl2.TEXTURE0);
      gl2.bindTexture(gl2.TEXTURE_2D, R.fboTex);
      gl2.uniform1i(R.uPost.uScene, 0);
      gl2.uniform2f(R.uPost.uRes, R.w, R.h);
      gl2.uniform3fv(R.uPost.uSkyTop, R.skyTop);
      gl2.uniform3fv(R.uPost.uSkyHor, R.skyHor);
      gl2.uniform3fv(R.uPost.uSkyBot, R.skyBot);
      gl2.uniform3fv(R.uPost.uSunCol, R.sunCol);
      gl2.uniform2f(R.uPost.uSunPos, R.sunPos[0], R.sunPos[1]);
      gl2.uniform2f(R.uPost.uMoonPos, R.moonPos[0], R.moonPos[1]);
      gl2.uniform3fv(R.uPost.uMoonCol, R.moonCol);
      gl2.uniform2f(R.uPost.uMoonPar, R.moonPar[0], R.moonPar[1]);
      gl2.uniform1f(R.uPost.uDither, R.opts.dither);
      gl2.uniform1f(R.uPost.uPixelArt, R.opts.pixelArt);
      gl2.uniform1f(R.uPost.uVignette, 0.42);
      gl2.uniform3fv(R.uPost.uPal, R.palette);

      gl2.drawArrays(gl2.TRIANGLE_STRIP, 0, 4);
      gl2.bindVertexArray(null);
    };

    R.diagnose = function () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, R.fbo);
      var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var err = gl.getError();
      return 'fbo:' + st + (st === gl.FRAMEBUFFER_COMPLETE ? ' ok' : ' INCOMPLETE') +
        ' err:' + err +
        ' attr:' + gl.getProgramParameter(R.progSplat, gl.ACTIVE_ATTRIBUTES) +
        ' uni:' + gl.getProgramParameter(R.progSplat, gl.ACTIVE_UNIFORMS) +
        ' corner:' + R.cornerLoc +
        ' count:' + R.count +
        ' order:' + (R.orderH || 0) + 'x' + TEX_W +
        ' scale:' + R.splatScale + ' fade:' + R.opts.fade +
        ' view:' + (R.opts.viewMode || 0) +
        ' hdr:' + (R.floatTarget ? 'rgba16f' : 'rgba8');
    };

    R.setQuality = function (q) {      R.quality = q;
      var table = [
        { px: 6, maxPx: 24 },
        { px: 5, maxPx: 32 },
        { px: 4, maxPx: 40 },
        { px: 3, maxPx: 52 }
      ];
      R.maxPx = table[q].maxPx;
      return table[q].px;
    };

    ER.render.instance = R;
    ER.render.instance = R;
    return R;
  }

  ER.render = { init: init, TEX_W: TEX_W };
})(window.ER = window.ER || {});
