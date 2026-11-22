/* render.js — WebGL2 gaussian splat rasteriser.
   One instanced draw call for the whole cloud, then a quantise/dither pass.
   Nothing here allocates per frame except the order buffer upload. */
(function (ER) {
  'use strict';
  var C = ER.core;

  var TEX_W = 2048;          // texels per row in every data texture
  var BUCKETS = 1024;
  var Z_MIN = -30, Z_MAX = 145;

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
    'uniform float uFocus;',
    'uniform float uDof;',
    'uniform float uFogDensity;',
    'uniform float uFogStart;',
    'uniform float uFogHeightBase;',
    'uniform float uFogHeightDensity;',
    'uniform float uFogHeightFalloff;',
    'uniform float uFogHeightStrength;',
    'uniform float uOrient;',
    'in vec2 aCorner;',
    'out vec2 vUv;',
    'out vec3 vCol;',
    'out vec3 vNrm;',
    'out vec3 vView;',
    'out float vAlpha;',
    'out float vDepth;',
    'out float vAo;',
    'out float vFog;',
    'out float vDof;',
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
    '  float depth = max(-vp.z, 0.05);',
    '  float focal = uProj[1][1] * 0.5 * uFbo.y;',
    '  float px = A.w * focal / depth * uScale;',
    '  px = clamp(px, 0.65, uMaxPx);',
    '',
    '  // A surface normal is projected into screen space and used as the short',
    '  // axis of an ellipse. This is a cheap stand-in for a full 3D covariance:',
    '  // no matrix inverse, no extra texture, but rocks and bark stop reading as',
    '  // uniform round cotton. Loose particles have orientation zero.',
    '  vec3 nView = mat3(uView) * normalize(Cn.xyz);',
    '  vec2 tilt = nView.xy;',
    '  float tl = length(tilt);',
    '  vec2 ax = tl > 0.045 ? tilt / tl : vec2(0.88, 0.47);',
    '  vec2 ay = vec2(-ax.y, ax.x);',
    '  float ori = clamp(Dp.z, 0.0, 1.0) * uOrient;',
    '  float ratio = mix(1.0, clamp(1.0 - tl * 0.52, 0.58, 1.0), ori);',
    '  float minor = px * ratio;',
    '  float major = px / max(ratio, 0.62);',
    '',
    '  // Focal-band DOF: keep the hero subject sharp within a clean deadzone',
    '  // around uFocus while softening foreground particles and distant ridges.',
    '  float focalDist = abs(depth - uFocus);',
    '  float coc = clamp(smoothstep(uFocus * 0.14, uFocus * 0.85, focalDist) * uDof, 0.0, 1.0);',
    '  major *= 1.0 + coc * 1.15;',
    '  minor *= 1.0 + coc * 0.42;',
    '  vec2 offset = (aCorner.x * ax * minor + aCorner.y * ay * major) * (2.0 / uFbo);',
    '  gl_Position.xy += offset * gl_Position.w;',
    '',
    '  // Analytic exponential height fog integrated along the camera ray.',
    '  float depthFog = max(0.0, depth - uFogStart) * uFogDensity;',
    '  float dy = p.y - uEye.y;',
    '  float h0 = uFogHeightDensity * exp(-uFogHeightFalloff * max(0.0, uEye.y - uFogHeightBase));',
    '  float heightFog;',
    '  if (abs(dy) > 0.20) {',
    '    heightFog = h0 * depth * (1.0 - exp(-uFogHeightFalloff * dy)) / (uFogHeightFalloff * dy);',
    '  } else {',
    '    heightFog = h0 * depth;',
    '  }',
    '  vFog = 1.0 - exp(-(depthFog + max(0.0, heightFog) * uFogHeightStrength));',
    '',
    '  vUv = aCorner;',
    '  vCol = Bc.rgb;',
    '  vAlpha = Bc.a * uFade / (1.0 + coc * 1.35);',
    '  vNrm = Cn.xyz;',
    '  vView = normalize(p - uEye);',
    '  vDepth = depth;',
    '  vAo = Dp.y;',
    '  vDof = coc;',
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
    'in float vFog;',
    'in float vDof;',
    'flat in int vMode;',
    'uniform int uSplatView;',
    'uniform int uViewMode;',
    'uniform vec3 uFogColor;',
    'uniform vec3 uFogScatterCol;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uRimCol;',
    'uniform float uRim;',
    'out vec4 outColor;',
    '',
    'void main() {',
    '  float r2 = dot(vUv, vUv);',
    '  float a;',
    '  if (uSplatView == 1) {',
    '    a = 1.0 - smoothstep(0.72, 1.0, r2);',
    '  } else {',
    '    a = exp(-4.35 * r2);',
    '  }',
    '  a *= vAlpha;',
    '  if (a < 0.010) discard;',
    '  vec3 n = normalize(vNrm);',
    '  float fog = clamp(vFog, 0.0, 1.0);',
    '  float sunInscatter = pow(max(dot(vView, uSunDir), 0.0), 4.0);',
    '  vec3 fogCol = mix(uFogColor, uFogScatterCol, sunInscatter * 0.58);',
    '  float sunMask = 0.35 + 0.65 * max(dot(n, uSunDir), 0.0);',
    '  float rim = pow(1.0 - abs(dot(n, vView)), 2.8) * sunMask;',
    '  vec3 col = vCol + uRimCol * rim * uRim;',
    '  col = mix(col, fogCol, fog);',
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
    'uniform float uSunDisc;',
    'uniform vec3 uFogColor;',
    'uniform vec3 uFogScatterCol;',
    'uniform vec2 uMoonPos;',
    'uniform vec3 uMoonCol;',
    'uniform vec2 uMoonPar;',
    'uniform float uSkyYaw;',
    'uniform float uSkyTime;',
    'uniform float uExposure;',
    'uniform float uBloom;',
    'uniform int uViewMode;',
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
    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoiseS(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbmS(vec2 p) {',
    '  float a = 0.5, v = 0.0;',
    '  for (int i = 0; i < 4; i++) { v += a * vnoiseS(p); p = p * 2.03 + 7.1; a *= 0.5; }',
    '  return v;',
    '}',
    '',
    'vec3 aces(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    '',
    'vec3 skyAt(vec2 uv) {',
    '  float h = uv.y;',
    '  vec3 s = mix(uSkyHor, uSkyTop, smoothstep(0.30, 1.0, h));',
    '  s = mix(uSkyBot, s, smoothstep(0.0, 0.32, h));',
    '',
    '  vec2 cp = vec2(((uv.x - 0.5) * (uRes.x / uRes.y) * 2.1 + uSkyYaw), h * 3.1 - uSkyTime * 0.006);',
    '  float deck = fbmS(cp * 3.1 + vec2(2.3, 8.1));',
    '  float band = smoothstep(0.28, 0.54, h) * (1.0 - smoothstep(0.80, 0.99, h));',
    '  float cloud = smoothstep(0.45, 0.72, deck) * band;',
    '  vec3 cloudCol = mix(uFogColor, uFogScatterCol, 0.42);',
    '  s = mix(s, cloudCol, cloud * 0.22);',
    '',
    '  float horizon = exp(-pow((h - 0.40) * 4.8, 2.0));',
    '  s += uFogScatterCol * horizon * 0.045;',
    '  vec2 d = (uv - uSunPos) * vec2(uRes.x / uRes.y, 1.0);',
    '  float sd = length(d);',
    '  float g = exp(-sd * sd * 11.0) * 0.20 + exp(-sd * sd * 3.2) * 0.025;',
    '  float disc = 1.0 - smoothstep(0.052, 0.085, sd);',
    '  s += uSunCol * (g + disc * uSunDisc);',
    '  return s;',
    '}',
    '',
    'void main() {',
    '  vec4 sc = texture(uScene, vUv);',
    '  vec3 sky = skyAt(vUv);',
    '',
    '  vec2 asp = vec2(uRes.x / uRes.y, 1.0);',
    '  float md = length((vUv - uMoonPos) * asp);',
    '  float disc = 1.0 - smoothstep(uMoonPar.x * 0.92, uMoonPar.x, md);',
    '  vec2 moonP = (vUv - uMoonPos) * asp / max(uMoonPar.x, 0.001);',
    '  float mottle = 0.80 + 0.20 * vnoiseS(moonP * 7.0 + vec2(3.4, 9.1));',
    '  float ring = exp(-max(0.0, md - uMoonPar.x) * 7.5) * 0.14;',
    '  sky = mix(sky, uMoonCol * mottle, disc * uMoonPar.y);',
    '  sky += uMoonCol * ring * uMoonPar.y;',
    '',
    '  float cover = clamp(sc.a, 0.0, 1.0);',
    '  vec3 c = sc.rgb + sky * (1.0 - cover);',
    '',
    '  if (uViewMode > 0) {',
    '    outColor = vec4(c, 1.0);',
    '    return;',
    '  }',
    '',
    '  vec2 tx = 1.0 / uRes;',
    '  // Subtle micro-clarity sharpening on foreground/midground surfaces in cinematic mode',
    '  if (uPixelArt < 0.5 && cover > 0.25) {',
    '    vec3 n0 = texture(uScene, vUv + vec2(tx.x, 0.0)).rgb;',
    '    vec3 n1 = texture(uScene, vUv - vec2(tx.x, 0.0)).rgb;',
    '    vec3 n2 = texture(uScene, vUv + vec2(0.0, tx.y)).rgb;',
    '    vec3 n3 = texture(uScene, vUv - vec2(0.0, tx.y)).rgb;',
    '    vec3 blur = (n0 + n1 + n2 + n3) * 0.25;',
    '    c += (sc.rgb - blur) * 0.18 * cover;',
    '    c = max(c, vec3(0.0));',
    '  }',
    '',
    '  // Dual-ring 8-tap HDR bloom thresholded for true emissives',
    '  vec3 glow = max(texture(uScene, vUv + vec2(1.5, 0.4) * tx).rgb - vec3(0.50), 0.0)',
    '            + max(texture(uScene, vUv + vec2(-1.4, 0.9) * tx).rgb - vec3(0.50), 0.0)',
    '            + max(texture(uScene, vUv + vec2(0.4, -1.6) * tx).rgb - vec3(0.50), 0.0)',
    '            + max(texture(uScene, vUv + vec2(-2.0, -0.5) * tx).rgb - vec3(0.50), 0.0)',
    '            + 0.65 * max(texture(uScene, vUv + vec2(3.6, 2.2) * tx).rgb - vec3(0.54), 0.0)',
    '            + 0.65 * max(texture(uScene, vUv + vec2(-3.2, 2.6) * tx).rgb - vec3(0.54), 0.0)',
    '            + 0.65 * max(texture(uScene, vUv + vec2(2.4, -3.5) * tx).rgb - vec3(0.54), 0.0)',
    '            + 0.65 * max(texture(uScene, vUv + vec2(-3.8, -2.0) * tx).rgb - vec3(0.54), 0.0);',
    '  glow *= 0.17 * uBloom;',
    '',
    '  c *= uExposure;',
    '  c += glow;',
    '  c = aces(c);',
    '  c = pow(max(c, 0.0), vec3(1.0 / 2.2));',
    '',
    '  if (uPixelArt > 0.5) {',
    '    float b = bayer8(gl_FragCoord.xy) - 0.5;',
    '    vec3 d = c + b * uDither * 0.075;',
    '    vec3 q = c;',
    '    float best = 1e9;',
    '    for (int i = 0; i < 16; i++) {',
    '      vec3 dd = uPal[i] - d;',
    '      vec3 w = dd * vec3(0.92, 1.0, 0.74);',
    '      float dist = dot(w, w);',
    '      if (dist < best) { best = dist; q = uPal[i]; }',
    '    }',
    '    c = q;',
    '  }',
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
      powerPreference: 'high-performance',
      preserveDrawingBuffer: location.search.indexOf('capture=1') >= 0
    });
    if (!gl) throw new Error('WebGL2 unavailable');

    var floatTarget = gl.getExtension('EXT_color_buffer_float');

    var R = {
      gl: gl, canvas: canvas,
      w: canvas.width, h: canvas.height,
      count: 0, order: null, cloud: null, scene: null,
      sortMs: 0, drawMs: 0,
      quality: 2, maxPx: 30, splatScale: 1,
      exposure: 1.25, bloom: 0.08,
      opts: { pixelArt: 0, splatView: 0, dither: 0.6, animate: 1, fade: 1, dof: 1.15, bloom: 0.08, orient: 1 },
      renderer: (function () {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl2';
      })(),
      contextLost: false
    };
    R.isSoftware = /swiftshader|llvmpipe|software|microsoft basic/i.test(R.renderer);

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      R.contextLost = true;
      ER.bus.emit('contextlost', true);
    });
    canvas.addEventListener('webglcontextrestored', function () {
      R.contextLost = false;
      ER.bus.emit('contextrestored', true);
    });

    R.progSplat = program(gl, VS_SPLAT, FS_SPLAT);
    R.progPost = program(gl, VS_POST, FS_POST);
    R.uSplat = uniforms(gl, R.progSplat, [
      'uData', 'uOrder', 'uView', 'uProj', 'uEye', 'uFbo', 'uScale', 'uMaxPx', 'uTime',
      'uAnimate', 'uFade', 'uSplatView', 'uViewMode', 'uFogColor', 'uFogScatterCol', 'uSunDir',
      'uFogDensity', 'uFogStart', 'uRim', 'uRimCol', 'uFocus', 'uDof',
      'uFogHeightBase', 'uFogHeightDensity', 'uFogHeightFalloff', 'uFogHeightStrength', 'uOrient'
    ]);
    R.uPost = uniforms(gl, R.progPost, [
      'uScene', 'uRes', 'uSkyTop', 'uSkyHor', 'uSkyBot', 'uSunCol', 'uSunPos', 'uSunDisc',
      'uFogColor', 'uFogScatterCol', 'uMoonPos', 'uMoonCol', 'uMoonPar', 'uSkyYaw', 'uSkyTime',
      'uExposure', 'uBloom', 'uViewMode', 'uDither', 'uPixelArt', 'uVignette', 'uPal'
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
      R.skyTop = C.hexLin(scene.sky.top);
      R.skyHor = C.hexLin(scene.sky.horizon);
      R.skyBot = C.hexLin(scene.sky.bottom);
      R.sunCol = C.hexLin(scene.lightCol || '#ffffff');
      R.sunDir = scene.light || [0, 1, 0];
      R.fog = C.hexLin(scene.fog.color);
      R.fogScatter = C.hexLin(scene.fog.scatterColor || scene.fog.color);
      R.exposure = scene.exposure === undefined ? 1.25 : scene.exposure;
      // Palette values are display-space sRGB: quantisation happens after
      // tone mapping and gamma, never in the linear scene buffer.
      R.palette = new Float32Array(48);
      for (var i = 0; i < 16; i++) {
        var c = C.hexToRgb(scene.palette[i] || '#000000');
        R.palette[i * 3] = c[0];
        R.palette[i * 3 + 1] = c[1];
        R.palette[i * 3 + 2] = c[2];
      }
      R.sunPos = scene.sunUv || [0.5, 0.58];
      R.sunDisc = scene.sunDisc === undefined ? 0.18 : scene.sunDisc;
      var mo = scene.moon || { pos: [0.5, 0.5], size: 0.06, color: '#ffffff', i: 0 };
      R.moonPos = mo.pos;
      R.moonCol = C.hexLin(mo.color);
      R.moonPar = [mo.size, mo.i];
      var fh = scene.fog.height || { base: 0, density: 0.008, falloff: 0.24, strength: 0.8 };
      R.fogHeight = (ER.flags && ER.flags.fog2 === false)
        ? { base: fh.base, density: 0, falloff: fh.falloff, strength: 0 }
        : fh;
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
        buf[b + 14] = cloud.ori ? cloud.ori[i] : 0.7;
        buf[b + 15] = 0;
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
      if (R.contextLost || !R.count || !R.scene) return;
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
      gl2.uniform3fv(R.uSplat.uFogScatterCol, R.fogScatter);
      gl2.uniform3fv(R.uSplat.uSunDir, R.sunDir);
      gl2.uniform1f(R.uSplat.uFogDensity, R.scene.fog.density);
      gl2.uniform1f(R.uSplat.uFogStart, R.scene.fog.start);
      gl2.uniform3fv(R.uSplat.uRimCol, R.sunCol);
      gl2.uniform1f(R.uSplat.uRim, 0.14);
      gl2.uniform1f(R.uSplat.uFocus, Math.hypot(
        cam.target[0] - cam.eye()[0],
        cam.target[1] - cam.eye()[1],
        cam.target[2] - cam.eye()[2]));
      gl2.uniform1f(R.uSplat.uDof, R.opts.dof || 0);
      gl2.uniform1f(R.uSplat.uFogHeightBase, R.fogHeight.base);
      gl2.uniform1f(R.uSplat.uFogHeightDensity, R.fogHeight.density);
      gl2.uniform1f(R.uSplat.uFogHeightFalloff, R.fogHeight.falloff);
      gl2.uniform1f(R.uSplat.uFogHeightStrength, R.fogHeight.strength);
      gl2.uniform1f(R.uSplat.uOrient, R.opts.orient);

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
      gl2.uniform1f(R.uPost.uSunDisc, R.sunDisc);
      gl2.uniform3fv(R.uPost.uFogColor, R.fog);
      gl2.uniform3fv(R.uPost.uFogScatterCol, R.fogScatter);
      gl2.uniform2f(R.uPost.uMoonPos, R.moonPos[0], R.moonPos[1]);
      gl2.uniform3fv(R.uPost.uMoonCol, R.moonCol);
      gl2.uniform2f(R.uPost.uMoonPar, R.moonPar[0], R.moonPar[1]);
      gl2.uniform1f(R.uPost.uSkyYaw, cam.yaw * 0.62);
      gl2.uniform1f(R.uPost.uSkyTime, time);
      gl2.uniform1f(R.uPost.uExposure, R.exposure);
      gl2.uniform1f(R.uPost.uBloom, R.opts.bloom || 0);
      gl2.uniform1i(R.uPost.uViewMode, R.opts.viewMode || 0);
      gl2.uniform1f(R.uPost.uDither, R.opts.dither);
      gl2.uniform1f(R.uPost.uPixelArt, R.opts.pixelArt);
      gl2.uniform1f(R.uPost.uVignette, R.opts.pixelArt > 0.5 ? 0.18 : 0.11);
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

    var QUALITY = [
      { w: 640, h: 360, maxPx: 20, dof: 0.00, bloom: 0.00 },
      { w: 960, h: 540, maxPx: 26, dof: 0.70, bloom: 0.05 },
      { w: 1280, h: 720, maxPx: 34, dof: 1.15, bloom: 0.10 },
      { w: 1600, h: 900, maxPx: 42, dof: 1.50, bloom: 0.14 }
    ];

    R.qualitySpec = function (q) {
      q = Math.max(0, Math.min(3, q | 0));
      return QUALITY[q];
    };

    R.setQuality = function (q) {
      q = Math.max(0, Math.min(3, q | 0));
      R.quality = q;
      var spec = QUALITY[q];
      R.maxPx = spec.maxPx;
      R.opts.dof = spec.dof;
      R.opts.bloom = spec.bloom;
      return spec;
    };

    ER.render.instance = R;
    return R;
  }

  ER.render = { init: init, TEX_W: TEX_W };
})(window.ER = window.ER || {});
