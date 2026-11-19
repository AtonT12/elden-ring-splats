/* camera.js — orbit rig with inertia, dolly, pan and tweened resets. */
(function (ER) {
  'use strict';
  var C = ER.core, mat4 = C.mat4;

  var MIN_D = 10, MAX_D = 62;
  var MIN_P = -0.38, MAX_P = 1.34;
  var FOV = 42 * Math.PI / 180;
  var NEAR = 0.4, FAR = 220;

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function create(preset) {
    var cam = {
      yaw: preset.yaw, pitch: preset.pitch, dist: preset.dist, tDist: preset.dist,
      target: [preset.target[0], preset.target[1], preset.target[2]],
      vYaw: 0, vPitch: 0,
      auto: true, autoHold: 0, paused: false,
      tween: null,
      _eye: [0, 0, 0], _view: mat4.create(), _proj: mat4.create(),
      aspect: 16 / 9
    };

    cam.eye = function () {
      var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      cam._eye[0] = cam.target[0] + cam.dist * cp * Math.sin(cam.yaw);
      cam._eye[1] = cam.target[1] + cam.dist * sp;
      cam._eye[2] = cam.target[2] + cam.dist * cp * Math.cos(cam.yaw);
      return cam._eye;
    };

    cam.view = function () {
      mat4.lookAt(cam._view, cam.eye(), cam.target, [0, 1, 0]);
      return cam._view;
    };

    cam.proj = function (aspect) {
      cam.aspect = aspect || cam.aspect;
      return mat4.perspective(cam._proj, FOV, cam.aspect, NEAR, FAR);
    };

    cam.drag = function (dx, dy) {
      cam.tween = null;
      cam.yaw -= dx * 0.0052;
      cam.pitch += dy * 0.0042;
      if (cam.pitch < MIN_P) cam.pitch = MIN_P;
      if (cam.pitch > MAX_P) cam.pitch = MAX_P;
      cam.vYaw = -dx * 0.00042;
      cam.vPitch = dy * 0.00034;
      cam.autoHold = 1.4;
    };

    cam.wheel = function (dy) {
      cam.tDist *= Math.exp(dy * 0.0011);
      if (cam.tDist < MIN_D) cam.tDist = MIN_D;
      if (cam.tDist > MAX_D) cam.tDist = MAX_D;
    };

    cam.pan = function (dx, dy) {
      var cp = Math.cos(cam.yaw), sp = Math.sin(cam.yaw);
      // camera right / up in world space
      var rx = cp, rz = -sp;
      var k = cam.dist * 0.0013;
      cam.target[0] += -dx * k * rx;
      cam.target[2] += -dx * k * rz;
      cam.target[1] += dy * k;
      var rad = Math.hypot(cam.target[0], cam.target[2]);
      if (rad > 9) {
        cam.target[0] *= 9 / rad;
        cam.target[2] *= 9 / rad;
      }
      if (cam.target[1] < -1) cam.target[1] = -1;
      if (cam.target[1] > 14) cam.target[1] = 14;
      cam.autoHold = 1.4;
    };

    cam.release = function () { /* inertia carries on in update */ };

    // hold the camera still for a frame (used by ?freeze=1)
    cam.snap = function (presetObj) {
      cam.tween = null;
      cam.yaw = presetObj.yaw;
      cam.pitch = presetObj.pitch;
      cam.dist = presetObj.dist;
      cam.tDist = presetObj.dist;
      cam.target = presetObj.target.slice();
      cam.vYaw = cam.vPitch = 0;
    };

    cam.reset = function (presetObj, ms) {
      var from = {
        yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
        target: cam.target.slice()
      };
      // take the short way round
      var dy = presetObj.yaw - cam.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      cam.tween = {
        t: 0, ms: ms || 650, from: from,
        to: {
          yaw: cam.yaw + dy, pitch: presetObj.pitch, dist: presetObj.dist,
          target: presetObj.target.slice()
        }
      };
      cam.vYaw = cam.vPitch = 0;
      cam.tDist = presetObj.dist;
    };

    cam.update = function (dt) {
      if (cam.tween) {
        var tw = cam.tween;
        tw.t += dt * 1000;
        var k = Math.min(1, tw.t / tw.ms), e = easeInOut(k);
        cam.yaw = C.lerp(tw.from.yaw, tw.to.yaw, e);
        cam.pitch = C.lerp(tw.from.pitch, tw.to.pitch, e);
        cam.dist = C.lerp(tw.from.dist, tw.to.dist, e);
        cam.target[0] = C.lerp(tw.from.target[0], tw.to.target[0], e);
        cam.target[1] = C.lerp(tw.from.target[1], tw.to.target[1], e);
        cam.target[2] = C.lerp(tw.from.target[2], tw.to.target[2], e);
        if (k >= 1) cam.tween = null;
        cam.tDist = cam.dist;
        return true;
      }

      var moved = false;
      if (Math.abs(cam.vYaw) > 1e-5 || Math.abs(cam.vPitch) > 1e-5) {
        cam.yaw += cam.vYaw * dt * 60;
        cam.pitch += cam.vPitch * dt * 60;
        if (cam.pitch < MIN_P) { cam.pitch = MIN_P; cam.vPitch = 0; }
        if (cam.pitch > MAX_P) { cam.pitch = MAX_P; cam.vPitch = 0; }
        var damp = Math.pow(0.0016, dt);
        cam.vYaw *= damp; cam.vPitch *= damp;
        moved = true;
      }

      if (cam.auto && !cam.paused) {
        if (cam.autoHold > 0) cam.autoHold -= dt;
        else { cam.yaw += 0.075 * dt; moved = true; }
      }

      if (Math.abs(cam.tDist - cam.dist) > 1e-3) {
        cam.dist += (cam.tDist - cam.dist) * Math.min(1, dt * 10);
        moved = true;
      }
      return moved;
    };

    return cam;
  }

  ER.camera = { create: create, FOV: FOV, NEAR: NEAR, FAR: FAR };
})(window.ER = window.ER || {});
