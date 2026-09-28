/**
 * Verification Test: Weave Spatial State Capture & Recall
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

// Load weave.js
const weaveCode = fs.readFileSync(path.join(__dirname, '../desktop/weave.js'), 'utf8');
eval(weaveCode);

console.log('=== Running Weave Spatial State Capture & Recall Verification ===\n');

const engine = global.window.weaveEngine;
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
const initialSceneCount = engine.scenes.length;
engine.captureCurrentScene();
assert.strictEqual(engine.scenes.length, initialSceneCount + 1, 'Scene count must increment by 1');
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

// Step 5 & 6 & 7: Recall Scene A
console.log('Step 5, 6 & 7: Recalling Scene A via selectScene(indexA)...');
const drawCountBeforeRecall = arenaDrawnCount;
engine.selectScene(indexA);

assert(arenaDrawnCount > drawCountBeforeRecall, 'drawArena must be called on recall');
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
console.log('✔ Scene A recalled accurately; Web Audio state matches node state.\n');

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
engine.captureCurrentScene();
const sceneB = engine.scenes[engine.scenes.length - 1];
const indexB = sceneB.index;
assert(sceneB.spatialState, 'sceneB must have spatialState');
console.log('✔ Scene B captured.\n');

// Step 10: Alternate between Scene A and Scene B repeatedly
console.log('Step 10: Alternating between Scene A and Scene B (5 cycles)...');
for (let cycle = 1; cycle <= 5; cycle++) {
  // Select Scene A
  engine.selectScene(indexA);
  posSceneA.forEach((expected, i) => {
    const t = global.window.studio.tracks[i];
    assert.strictEqual(t.x, expected.x, `Cycle ${cycle} Scene A Track ${i} X mismatch`);
    assert.strictEqual(t.y, expected.y, `Cycle ${cycle} Scene A Track ${i} Y mismatch`);
  });

  // Select Scene B
  engine.selectScene(indexB);
  posSceneB.forEach((expected, i) => {
    const t = global.window.studio.tracks[i];
    assert.strictEqual(t.x, expected.x, `Cycle ${cycle} Scene B Track ${i} X mismatch`);
    assert.strictEqual(t.y, expected.y, `Cycle ${cycle} Scene B Track ${i} Y mismatch`);
  });
}
console.log('✔ Deterministic alternating recall verified over 5 cycles.\n');

// Step 11: Safety check on mock scenes (indices 0..6)
console.log('Step 11: Testing mock scene selection safety...');
// Record state before clicking mock scene
const tracksBefore = global.window.studio.tracks.map(t => ({ x: t.x, y: t.y, z: t.z }));
// Select mock scene 0
engine.selectScene(0);
assert.strictEqual(engine.selectedIndex, 0, 'Mock scene should be selected in UI');
// Tracks must remain completely unchanged (no arbitrary overwriting)
global.window.studio.tracks.forEach((t, i) => {
  assert.strictEqual(t.x, tracksBefore[i].x, `Mock scene select must not alter track ${i} X`);
  assert.strictEqual(t.y, tracksBefore[i].y, `Mock scene select must not alter track ${i} Y`);
  assert.strictEqual(t.z, tracksBefore[i].z, `Mock scene select must not alter track ${i} Z`);
});
// Step 12: Test Loom scroll viewport & scroll navigation buttons
console.log('Step 12: Testing Loom scroll viewport and scroll controls...');
const loomHTML = engine.buildLoomHTML();
assert(loomHTML.includes('id="weave-loom-viewport"'), 'Loom HTML must contain #weave-loom-viewport');
// Since engine.scenes currently has 9 scenes (7 initial + 2 captured), totalContentH > viewportH
assert(loomHTML.includes('data-loom-scroll="up"'), 'Loom HTML must render scroll-up button when scenes overflow');
assert(loomHTML.includes('data-loom-scroll="down"'), 'Loom HTML must render scroll-down button when scenes overflow');
assert(!loomHTML.includes('class="weave-loom-footer"'), 'Bottom footer must be completely removed');
console.log('✔ Loom scroll viewport and side navigation controls verified successfully.\n');

console.log('=== ALL WEAVE SPATIAL RECALL VERIFICATION TESTS PASSED ===');
