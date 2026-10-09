/**
 * Verification Test: Weave Spatial State Capture & Recall
 *
 * Updated for patch 11 (Weave v0.1 phase 0): tapping a scene only inspects it.
 * Recall happens through ADJUST; GO NOW (JUMP / MORPH) moves the nodes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Setup minimal browser-like globals for weave.js
global.window = global;
global.window.addEventListener = () => {};
global.document = {
  documentElement: {
    style: {}
  },
  getElementById: (id) => null,
  querySelector: (sel) => null,
  querySelectorAll: (sel) => [],
  addEventListener: () => {}
};
global.getComputedStyle = () => ({
  getPropertyValue: (prop) => ''
});
global.performance = {
  now: () => Date.now()
};
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);

// Mock Web Audio param with setTargetAtTime
class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this.value = target;
  }
}

// Track class matching Aether's AudioTrack spatial state & audio update methods
class MockAudioTrack {
  constructor(index, name, color) {
    this.index = index;
    this.name = name;
    this.color = color;
    this.x = 0.5;
    this.y = 0.5;
    this.z = 0;
    this.stripGainDb = 0;
    this.isMuted = false;
    this.isSoloed = false;
    this.isSpatialized = false;
    this.gainNode = { gain: new MockAudioParam(1.0) };
    this.stereoPanNode = { pan: new MockAudioParam(0.0) };
    this.volTxt = { textContent: '' };
    this.panTxt = { textContent: '' };
    this.updateAudioParamsFromPosition();
  }

  setPosition(x, y, z = undefined) {
    this.x = Math.max(0.02, Math.min(0.98, x));
    this.y = Math.max(0.02, Math.min(0.98, y));
    if (z !== undefined) {
      this.z = Math.max(0, Math.min(50, z));
    }
    this.updateAudioParamsFromPosition();
  }

  updateAudioParamsFromPosition() {
    const rawPan = (this.x - 0.5) * 2.0;
    const isCentered = Math.abs(rawPan) < 0.02;
    const panVal = isCentered ? 0.0 : Math.max(-1.0, Math.min(1.0, rawPan));
    const baseVol = Math.pow(this.y, 1.5);

    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(baseVol, 0, 0.02);
    }
    if (this.stereoPanNode && this.stereoPanNode.pan) {
      this.stereoPanNode.pan.setTargetAtTime(panVal, 0, 0.02);
    }
    if (this.volTxt) {
      this.volTxt.textContent = `${Math.round(this.y * 100)}%`;
    }
    if (this.panTxt) {
      if (isCentered) this.panTxt.textContent = 'C';
      else if (panVal < 0) this.panTxt.textContent = `L${Math.abs(Math.round(panVal * 100))}`;
      else this.panTxt.textContent = `R${Math.round(panVal * 100)}`;
    }
  }
}

let arenaDrawnCount = 0;
global.window.studio = {
  tracks: [
    new MockAudioTrack(0, 'Track 1', '#FC4037'),
    new MockAudioTrack(1, 'Track 2', '#FFEA00'),
    new MockAudioTrack(2, 'Track 3', '#8B68B9'),
    new MockAudioTrack(3, 'Track 4', '#00D600')
  ],
  drawArena: () => {
    arenaDrawnCount++;
  }
};

// S4: the engine captures through S1–S3 (globals in the app; placed on window here).
global.window.AetherWeaveModel = require(path.join(__dirname, '../desktop/weave-model.js'));
global.window.AetherWeaveAssets = require(path.join(__dirname, '../desktop/weave-assets.js'));
global.window.AetherWeaveImport = require(path.join(__dirname, '../desktop/weave-import.js'));
global.window.studio.tracks.forEach(t => { t._sourceRevision = 0; t._bufferOrigin = null; t.playlist = []; t.playlistIndex = 0; t.motionPath = []; t.eqValues = { low: 0, mid: 0, high: 0 }; });
global.window.studio.showToast = () => {};
// S4: a writer mock with the same contract as getCurrentSessionData (synchronous snapshot, async result).
global.window.studio.getCurrentSessionData = function () {
  const tracks = this.tracks.map(t => ({ index: t.index, name: t.name, sampleName: t.name, filePath: '', sampleData: null, playlist: [], playlistIndex: 0, isShuffle: false, isRepeat: true,
    isCustomNode: false, customNodeBundle: null, customNodeParams: null, customNodeZipBase64: null, isLiveIn: false, x: t.x, y: t.y, z: t.z, isMuted: false, isSoloed: false,
    motionSpeed: 1, motionPath: [], eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0, isStream: false, streamUrl: '' }));
  return Promise.resolve({ version: '3.1', type: 'aether_project', name: 'Test', masterVolume: 0.8, loudnessDb: 0, tracks });
};

// Load weave.js
const weaveCode = fs.readFileSync(path.join(__dirname, '../desktop/weave.js'), 'utf8');
eval(weaveCode);

(async () => {
console.log('=== Running Weave Spatial State Capture & Recall Verification ===\n');

const engine = global.window.weaveEngine;
engine.enabled = true; // exercise Weave with its header toggle enabled
assert(engine, 'weaveEngine must be instantiated on window');

// Step 1: Position T1–T4 distinctly
console.log('Step 1: Positioning T1-T4 distinctly...');
const posSceneA = [
  { x: 0.20, y: 0.90, z: 0 },
  { x: 0.80, y: 0.20, z: 0 },
  { x: 0.30, y: 0.40, z: 0 },
  { x: 0.70, y: 0.70, z: 0 }
];
posSceneA.forEach((p, i) => global.window.studio.tracks[i].setPosition(p.x, p.y, p.z));

// Step 2 & 3: Capture scene A and inspect captured values
console.log('Step 2 & 3: Capturing Scene A with captureCurrentScene()...');
assert.strictEqual(engine.scenes.length, 0, 'a new project starts with no Scenes');
assert.strictEqual((await engine.captureCurrentScene()).ok, true, 'capture A');
// S4 (D8): the first real capture replaces the three demo rows, so the list holds one real Scene.
assert.strictEqual(engine.scenes.length, 1, 'first real Scene is the first row');
const sceneA = engine.scenes[engine.scenes.length - 1];
const indexA = sceneA.index;

console.log('Inspecting captured Scene A spatialState:');
console.log(JSON.stringify(sceneA.spatialState, null, 2));

assert(sceneA.spatialState, 'sceneA must have spatialState');
['T1', 'T2', 'T3', 'T4'].forEach((key, i) => {
  assert.strictEqual(sceneA.spatialState[key].x, posSceneA[i].x);
  assert.strictEqual(sceneA.spatialState[key].y, posSceneA[i].y);
  assert.strictEqual(sceneA.spatialState[key].z, posSceneA[i].z);
  // Verify level matches volume y
  assert.strictEqual(sceneA.levels[i], posSceneA[i].y);
});
console.log('✔ Scene A captured values verified successfully.\n');

// Step 4: Move all 4 nodes substantially
console.log('Step 4: Moving all four nodes substantially to center (0.5, 0.5)...');
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));
global.window.studio.tracks.forEach((t, i) => {
  assert.strictEqual(t.x, 0.5);
  assert.strictEqual(t.y, 0.5);
  assert.strictEqual(t.panTxt.textContent, 'C');
  assert.strictEqual(t.volTxt.textContent, '50%');
});
console.log('✔ All nodes moved to (0.5, 0.5).\n');

// Step 5: Selecting (tapping) Scene A only inspects it (LAB-11). Nodes stay put.
console.log('Step 5: Selecting Scene A via selectScene(indexA) — inspect only, nodes must not move...');
const snap = () => global.window.studio.tracks.map(t => ({ x: t.x, y: t.y, z: t.z }));
const assertTracksEqual = (expected, label) => {
  global.window.studio.tracks.forEach((t, i) => {
    assert.strictEqual(t.x, expected[i].x, `${label}: track ${i} x`);
    assert.strictEqual(t.y, expected[i].y, `${label}: track ${i} y`);
    assert.strictEqual(t.z, expected[i].z, `${label}: track ${i} z`);
  });
};
const beforeSelect = snap();
engine.selectScene(indexA);
assert.strictEqual(engine.selectedIndex, indexA, 'Scene A must be the inspected (selected) scene');
assert.strictEqual(engine.editingIndex, null, 'Selecting must not open ADJUST');
assertTracksEqual(beforeSelect, 'selectScene(A) must not move nodes');
console.log('✔ Tap = inspect only: selection changed, nodes unchanged.\n');

// Step 6 & 7: ADJUST recalls Scene A onto the canvas, and Web Audio follows.
console.log('Step 6 & 7: Recalling Scene A via ADJUST (adjustScene(indexA))...');
const drawCountBeforeRecall = arenaDrawnCount;
engine.adjustScene(indexA);
assert.strictEqual(engine.editingIndex, indexA, 'ADJUST must mark Scene A as being edited');
assert(arenaDrawnCount > drawCountBeforeRecall, 'drawArena must be called on ADJUST recall');
global.window.studio.tracks.forEach((t, i) => {
  assert.strictEqual(t.x, posSceneA[i].x, `Track ${i} x must match`);
  assert.strictEqual(t.y, posSceneA[i].y, `Track ${i} y must match`);
  assert.strictEqual(t.z, posSceneA[i].z, `Track ${i} z must match`);
  // Confirm Web Audio pan and gain params agree with visible node state
  const expectedPan = Math.max(-1.0, Math.min(1.0, (posSceneA[i].x - 0.5) * 2.0));
  const expectedGain = Math.pow(posSceneA[i].y, 1.5);
  assert(Math.abs(t.stereoPanNode.pan.value - expectedPan) < 0.001, `Track ${i} pan must agree`);
  assert(Math.abs(t.gainNode.gain.value - expectedGain) < 0.001, `Track ${i} gain must agree`);
});
engine.exitAdjust();
assert.strictEqual(engine.editingIndex, null, 'DONE must close ADJUST');
console.log('✔ ADJUST recalled Scene A accurately; Web Audio state matches node state.\n');

// Step 8: Drag/move nodes again
console.log('Step 8: Simulating user dragging nodes again...');
global.window.studio.tracks[0].setPosition(0.12, 0.88);
assert.strictEqual(global.window.studio.tracks[0].x, 0.12);
assert.strictEqual(global.window.studio.tracks[0].y, 0.88);
console.log('✔ Subsequent node manipulation works seamlessly.\n');

// Step 9: Capture a second different scene (Scene B)
console.log('Step 9: Capturing second scene (Scene B)...');
const posSceneB = [
  { x: 0.85, y: 0.35, z: 5 },
  { x: 0.15, y: 0.85, z: 10 },
  { x: 0.65, y: 0.25, z: 0 },
  { x: 0.35, y: 0.65, z: 2 }
];
posSceneB.forEach((p, i) => global.window.studio.tracks[i].setPosition(p.x, p.y, p.z));
assert.strictEqual((await engine.captureCurrentScene()).ok, true, 'capture B');
const sceneB = engine.scenes[engine.scenes.length - 1];
const indexB = sceneB.index;
assert(sceneB.spatialState, 'sceneB must have spatialState');
assert.strictEqual(indexB, indexA + 1, 'Scene B must follow Scene A');
console.log('✔ Scene B captured.\n');

// Step 10: Alternate A/B repeatedly — ADJUST recalls, selection never moves anything.
console.log('Step 10: Alternating Scene A / Scene B (5 cycles): ADJUST recalls, tap inspects...');
for (let cycle = 1; cycle <= 5; cycle++) {
  engine.adjustScene(indexA);
  engine.exitAdjust();
  posSceneA.forEach((expected, i) => {
    const t = global.window.studio.tracks[i];
    assert.strictEqual(t.x, expected.x, `Cycle ${cycle} ADJUST A Track ${i} X mismatch`);
    assert.strictEqual(t.y, expected.y, `Cycle ${cycle} ADJUST A Track ${i} Y mismatch`);
  });
  const held = snap();
  engine.selectScene(indexB);
  assertTracksEqual(held, `Cycle ${cycle} selectScene(B) must not move nodes`);

  engine.adjustScene(indexB);
  engine.exitAdjust();
  posSceneB.forEach((expected, i) => {
    const t = global.window.studio.tracks[i];
    assert.strictEqual(t.x, expected.x, `Cycle ${cycle} ADJUST B Track ${i} X mismatch`);
    assert.strictEqual(t.y, expected.y, `Cycle ${cycle} ADJUST B Track ${i} Y mismatch`);
  });
  const held2 = snap();
  engine.selectScene(indexA);
  assertTracksEqual(held2, `Cycle ${cycle} selectScene(A) must not move nodes`);
}
console.log('✔ Deterministic ADJUST recall and inspect-only selection over 5 cycles.\n');

// Step 10b/10c: GO NOW is a quantized launch (5 Oct, Matt): it arms the picked Scene, nothing
// moves until the next bar line of the master clock, then a ONE-BAR crossfade glide carries the
// nodes into the launched Scene whatever transition BUILD has set. The clock below is the real
// onTransportTick (120 bpm: 2 s per bar).
console.log('Step 10b: GO NEXT arms on the next bar line and lands on the picked Scene after a one-bar crossfade...');
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));
global.window.studio.isPlaying = true;
engine.transitionMode = 'jump';
engine.transitionCurve = 'lin';
engine.playingIndex = indexA; engine.selectedIndex = indexB; engine.currentBarInScene = 0.4; engine._transportSec = 0.8;
const fromLive = snap();
assert.strictEqual(engine.goNext(), true, 'GO NEXT arms');
assert(engine._launch && engine._launch.ready && Math.abs(engine._launch.atTransport - 2) < 1e-9, 'ready at once (same sounds), fires on the next bar line of the host grid');
engine.onTransportTick(true, 120, 2 * 0.3);
assert.strictEqual(engine.playingIndex, indexA, 'still on A before the bar line');
assertTracksEqual(fromLive, 'nothing moves before the bar line');
engine.onTransportTick(true, 120, 2 * 0.31);
assert.strictEqual(engine.playingIndex, indexB, 'launched on the bar line: A -> B');
assert(engine.glide && engine.glide.endsAtBar === 1 && engine.glide.arrangement, 'one-bar crossfade glide, even under JUMP');
engine.onTransportTick(true, 120, 1); engine.updateGlide(performance.now());   // half a bar
global.window.studio.tracks.forEach((t, i) => {
  assert(Math.abs(t.x - (fromLive[i].x + posSceneB[i].x) / 2) < 0.02, `launch midpoint Track ${i} X`);
  assert(Math.abs(t.y - (fromLive[i].y + posSceneB[i].y) / 2) < 0.02, `launch midpoint Track ${i} Y`);
});
engine.onTransportTick(true, 120, 1.01); engine.updateGlide(performance.now());
assert.strictEqual(engine.glide, null, 'crossfade finished after one bar');
posSceneB.forEach((expected, i) => {
  const t = global.window.studio.tracks[i];
  assert(Math.abs(t.x - expected.x) < 1e-9, `launch end Track ${i} X`);
  assert(Math.abs(t.y - expected.y) < 1e-9, `launch end Track ${i} Y`);
  assert(Math.abs(t.z - expected.z) < 1e-9, `launch end Track ${i} Z`);
});
console.log('✔ Quantized GO NEXT launch verified.\n');

console.log('Step 10c: the programmed MORPH still glides at the end of a Scene (plan resumes after a launch)...');
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));
const fromLive2 = snap();
engine.transitionMode = 'morph'; engine.transitionLengthBars = 4;
const barsB = engine.scenes[indexB].bars;
engine.currentBarInScene = barsB - 4 - 0.5;
engine.onTransportTick(true, 120, 2 * 0.51);
assert(engine.glide && engine.glide.endsAtBar === barsB, 'programmed MORPH armed 4 bars before the end of B');
assertTracksEqual(fromLive2, 'MORPH must not snap at start');
engine.onTransportTick(true, 120, 2 * 2); engine.updateGlide(performance.now());   // half of the 4-bar glide
global.window.studio.tracks.forEach((t, i) => {
  assert(Math.abs(t.x - (fromLive2[i].x + posSceneA[i].x) / 2) < 0.01, `MORPH midpoint Track ${i} X`);
  assert(Math.abs(t.y - (fromLive2[i].y + posSceneA[i].y) / 2) < 0.01, `MORPH midpoint Track ${i} Y`);
});
engine.onTransportTick(true, 120, 2 * 2.01);
assert.strictEqual(engine.playingIndex, indexA, 'arrived at A by the plan');
assert.strictEqual(engine.glide, null, 'MORPH glide must finish');
posSceneA.forEach((expected, i) => {
  const t = global.window.studio.tracks[i];
  assert(Math.abs(t.x - expected.x) < 1e-9, `MORPH end Track ${i} X`);
  assert(Math.abs(t.y - expected.y) < 1e-9, `MORPH end Track ${i} Y`);
});
global.window.studio.isPlaying = false;
console.log('✔ Programmed MORPH transition verified.\n');

// Step 11: Selecting never moves the nodes (S4: the demo set is gone once real Scenes exist,
// so this selects Scene 01; the demo set itself is covered in test-weave-session.js).
console.log('Step 11: Testing selection safety...');
const tracksBefore = snap();
engine.selectScene(0);
assert.strictEqual(engine.selectedIndex, 0, 'Scene 01 should be selected in UI');
assertTracksEqual(tracksBefore, 'Select must not alter tracks');
console.log('✔ Selection leaves tracks unchanged.\n');

// Step 12: Loom scroll viewport & scroll navigation buttons
// (LAB-10 cut the seed set from 7 to 3, so overflow is checked both ways
//  instead of assuming a fixed scene count.)
console.log('Step 12: Testing Loom scroll viewport and scroll controls...');
let loomHTML = engine.buildLoomHTML();
assert(loomHTML.includes('id="weave-loom-viewport"'), 'Loom HTML must contain #weave-loom-viewport');
assert(!loomHTML.includes('class="weave-loom-footer"'), 'Bottom footer must be completely removed');
const overflows = () => { const b = engine.loomGeo.bands; const last = b[b.length - 1]; return last.y + last.h > 688; };
assert.strictEqual(loomHTML.includes('data-loom-scroll="up"'), overflows(), 'Scroll buttons shown only when scenes overflow');
while (!overflows()) { assert.strictEqual((await engine.captureCurrentScene()).ok, true, 'capture to overflow'); engine.buildLoomHTML(); }   // S4: capture is asynchronous
loomHTML = engine.buildLoomHTML();
assert(loomHTML.includes('data-loom-scroll="up"'), 'Loom HTML must render scroll-up button when scenes overflow');
assert(loomHTML.includes('data-loom-scroll="down"'), 'Loom HTML must render scroll-down button when scenes overflow');
console.log('✔ Loom scroll viewport and side navigation controls verified successfully.\n');

console.log('=== ALL WEAVE SPATIAL RECALL VERIFICATION TESTS PASSED ===');
})().catch(e => { console.error(e); process.exit(1); });
