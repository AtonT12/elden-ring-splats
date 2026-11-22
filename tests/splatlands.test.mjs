import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadEngine() {
  const sandbox = {
    setTimeout,
    clearTimeout,
    performance,
    console,
    ER: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const files = ['js/core.js', 'js/sdf.js', 'js/sample.js', 'js/camera.js'];
  for (const rel of files) {
    const abs = path.resolve(process.cwd(), rel);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }
  return sandbox.ER;
}

const ER = loadEngine();

test('core noise, terrace, and deterministic PRNG behave accurately', () => {
  const C = ER.core;
  assert.equal(typeof C.terrace, 'function');
  assert.equal(C.fnv1a('aster'), C.fnv1a('aster'));
  assert.notEqual(C.fnv1a('aster'), C.fnv1a('gilded'));

  const r1 = C.mulberry32(C.fnv1a('erdtree|aster'));
  const r2 = C.mulberry32(C.fnv1a('erdtree|aster'));
  for (let i = 0; i < 25; i++) {
    const a = r1();
    const b = r2();
    assert.equal(a, b);
    assert.ok(a >= 0 && a < 1);
  }

  // terrace should be monotonically non-decreasing over [0, 1]
  let prev = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const v = C.terrace(i / 40, 4, 0.72);
    assert.ok(Number.isFinite(v));
    assert.ok(v >= prev - 1e-9);
    prev = v;
  }

  const fb = C.fbm2(1.4, -2.3, 4, 17);
  const rd = C.ridged2(1.4, -2.3, 4, 17);
  assert.ok(Number.isFinite(fb) && fb >= -1 && fb <= 1);
  assert.ok(Number.isFinite(rd) && rd >= 0 && rd <= 1);
});

test('all three realms define finite macro SDFs, scatter fog, and 16-color palettes', () => {
  const ids = ['erdtree', 'limgrave', 'caelid'];
  for (const id of ids) {
    const scene = ER.sdf.scenes[id];
    assert.ok(scene, `missing scene ${id}`);
    assert.equal(scene.palette.length, 16, `${id} palette must have 16 colors`);
    assert.ok(scene.fog && scene.fog.color && scene.fog.scatterColor, `${id} missing fog scatterColor`);
    assert.ok(Array.isArray(scene.emit) && scene.emit.length >= 8, `${id} missing emitters`);
    assert.ok(scene.mats && Object.keys(scene.mats).length >= 10, `${id} missing material palette`);
    assert.ok(typeof scene.macro === 'function', `${id} missing macro SDF`);

    for (let x = -12; x <= 12; x += 6) {
      for (let z = -12; z <= 12; z += 6) {
        const d = scene.macro(x, 2.0, z);
        assert.ok(Number.isFinite(d), `${id} non-finite macro at (${x},${z})`);
      }
    }
  }
});

test('sampler builds deterministic, finite point clouds with exact requested count for all realms', async () => {
  const ids = ['erdtree', 'limgrave', 'caelid'];
  for (const id of ids) {
    const scene = ER.sdf.scenes[id];
    const cloudA = await ER.sample.build(scene, 'aster', 6000);
    const cloudB = await ER.sample.build(scene, 'aster', 6000);
    const cloudC = await ER.sample.build(scene, 'vesper', 6000);

    assert.equal(cloudA.count, 6000);
    assert.equal(cloudA.hash, cloudB.hash);
    assert.match(cloudA.hash, /^[0-9A-F]{8}$/);
    assert.notEqual(cloudA.hash, cloudC.hash);

    for (let i = 0; i < cloudA.count; i += 17) {
      assert.ok(Number.isFinite(cloudA.pos[i * 3]) && Number.isFinite(cloudA.pos[i * 3 + 1]) && Number.isFinite(cloudA.pos[i * 3 + 2]));
      assert.ok(Number.isFinite(cloudA.nor[i * 3]) && Number.isFinite(cloudA.nor[i * 3 + 1]) && Number.isFinite(cloudA.nor[i * 3 + 2]));
      assert.ok(Number.isFinite(cloudA.col[i * 3]) && Number.isFinite(cloudA.col[i * 3 + 1]) && Number.isFinite(cloudA.col[i * 3 + 2]));
      assert.ok(Number.isFinite(cloudA.rad[i]) && cloudA.rad[i] > 0);
      assert.ok(Number.isFinite(cloudA.alp[i]) && cloudA.alp[i] >= 0);
      assert.ok(Number.isFinite(cloudA.ao[i]) && cloudA.ao[i] >= 0 && cloudA.ao[i] <= 1);
      assert.ok(Number.isFinite(cloudA.ori[i]) && cloudA.ori[i] >= 0 && cloudA.ori[i] <= 1);
    }
  }
});

test('camera clamps pitch, zoom, pan bounds, and completes reset tween', () => {
  const preset = { yaw: 0.4, pitch: 0.25, dist: 28, target: [0, 3, 0] };
  const cam = ER.camera.create(preset);

  cam.drag(0, 10000);
  assert.ok(cam.pitch <= 1.34 + 1e-6);
  cam.drag(0, -10000);
  assert.ok(cam.pitch >= -0.38 - 1e-6);

  cam.wheel(-50000);
  assert.equal(cam.tDist, 10);
  cam.wheel(50000);
  assert.equal(cam.tDist, 62);

  cam.pan(10000, 10000);
  assert.ok(Math.hypot(cam.target[0], cam.target[2]) <= 9 + 1e-6);
  assert.ok(cam.target[1] <= 14 + 1e-6 && cam.target[1] >= -1 - 1e-6);

  cam.reset(preset, 200);
  for (let i = 0; i < 15; i++) cam.update(0.02);
  assert.ok(Math.abs(cam.dist - preset.dist) < 1e-3);
  assert.ok(Math.abs(cam.pitch - preset.pitch) < 1e-3);
  assert.ok(Math.abs(cam.target[1] - preset.target[1]) < 1e-3);
});
