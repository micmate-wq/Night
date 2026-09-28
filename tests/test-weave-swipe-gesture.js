/**
 * Verification Test: Weave Loom Scene Row Swipe Gestures (Cancel, Adjust, Done, Delete, Stable IDs)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Setup browser-like globals for weave.js
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

// Track class matching Aether AudioTrack
class MockAudioTrack {
  constructor(index, name, color) {
    this.index = index;
    this.name = name;
    this.color = color;
    this.x = 0.5;
    this.y = 0.5;
    this.z = 0;
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
  }
}

global.window.studio = {
  tracks: [
    new MockAudioTrack(0, 'Track 1', '#FC4037'),
    new MockAudioTrack(1, 'Track 2', '#FFEA00'),
    new MockAudioTrack(2, 'Track 3', '#8B68B9'),
    new MockAudioTrack(3, 'Track 4', '#00D600')
  ],
  drawArena: () => {}
};

// Load weave.js
const weaveCode = fs.readFileSync(path.join(__dirname, '../desktop/weave.js'), 'utf8');
eval(weaveCode);

const engine = global.window.weaveEngine;
assert(engine, 'WeaveEngine instance must be exposed to window.weaveEngine');

console.log('=== Running Weave Row Swipe Gesture Verification ===\n');

// 1. Initial State
assert.strictEqual(engine.editingIndex, null, 'editingIndex should initially be null');
const initialCount = engine.scenes.length;
console.log(`✔ Initial state verified: ${initialCount} scenes, editingIndex = null.`);

// 2. Capture a known Scene with distinct coordinates
global.window.studio.tracks[0].setPosition(0.25, 0.75, 5);
global.window.studio.tracks[1].setPosition(0.35, 0.65, 0);
global.window.studio.tracks[2].setPosition(0.45, 0.55, 0);
global.window.studio.tracks[3].setPosition(0.55, 0.45, 0);
engine.captureCurrentScene();
const capturedIdx = engine.scenes.length - 1;
const capturedScene = engine.scenes[capturedIdx];
assert(capturedScene.spatialState, 'Captured scene must have spatialState');
assert.strictEqual(capturedScene.spatialState.T1.x, 0.25, 'Captured T1 X matches');
assert.strictEqual(capturedScene.spatialState.T1.y, 0.75, 'Captured T1 Y matches');
assert(capturedScene.id.startsWith('scene-uid-'), 'Captured scene has stable UID');
console.log(`✔ Scene ${capturedIdx + 1} captured with distinct positions and stable ID: ${capturedScene.id}.`);

// 3. Move tracks away
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));

// 4. Test ADJUST (formerly TWEAK) on captured scene
console.log('Testing ADJUST interaction...');
const prevPlaying = engine.playingIndex;
engine.adjustScene(capturedIdx);
assert.strictEqual(engine.editingIndex, capturedIdx, 'editingIndex must be updated to target scene');
assert.strictEqual(engine.playingIndex, prevPlaying, 'playingIndex must NOT change when adjusting');
assert.strictEqual(global.window.studio.tracks[0].x, 0.25, 'Spatial state T1 X recalled to canvas');
assert.strictEqual(global.window.studio.tracks[0].y, 0.75, 'Spatial state T1 Y recalled to canvas');

const htmlAdjusting = engine.buildLoomHTML();
assert(htmlAdjusting.includes('data-done-adjust'), 'Adjusting scene card must render DONE control');
assert(htmlAdjusting.includes('ADJUST'), 'Under-row action layer must display ADJUST tag');
assert(htmlAdjusting.includes('Release to edit'), 'Under-row action layer must display "Release to edit" hint');
assert(htmlAdjusting.includes('Release to delete'), 'Under-row action layer must have "Release to delete" message');
console.log('✔ ADJUST recalled spatial coordinates, set editingIndex, and rendered DONE control.');

// 4b. Test exiting ADJUST with DONE control
console.log('Testing exit ADJUST with DONE control...');
engine.exitAdjust();
assert.strictEqual(engine.editingIndex, null, 'exitAdjust must clear editingIndex to null');
const htmlExited = engine.buildLoomHTML();
assert(!htmlExited.includes('data-done-adjust'), 'DONE button must be removed after exiting adjust mode');
assert(!htmlExited.includes('is-editing'), 'is-editing class must be removed after exiting adjust mode');
console.log('✔ Exiting ADJUST with DONE returns scene to normal resting visual state.');

// Re-enter adjust mode for subsequent tests
engine.adjustScene(capturedIdx);

// 5. Test moving nodes and auto-updating the snapshot via onNodeDragEnd
console.log('Testing canvas node drag completion and snapshot update...');
global.window.studio.tracks[0].setPosition(0.12, 0.88, 10);
global.window.studio.tracks[1].setPosition(0.92, 0.18, 0);
engine.onNodeDragEnd();

assert.strictEqual(capturedScene.spatialState.T1.x, 0.12, 'Existing snapshot T1 X updated in place');
assert.strictEqual(capturedScene.spatialState.T1.y, 0.88, 'Existing snapshot T1 Y updated in place');
assert.strictEqual(capturedScene.spatialState.T2.x, 0.92, 'Existing snapshot T2 X updated in place');
assert.strictEqual(capturedScene.levels[0], 0.88, 'Scene levels[0] updated to match new Y');
assert.strictEqual(engine.scenes.length, initialCount + 1, 'No duplicate scenes created');
console.log('✔ Live canvas node movements correctly updated the snapshot in place.');

// 6. Test recall after update
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));
engine.adjustScene(capturedIdx);
assert.strictEqual(global.window.studio.tracks[0].x, 0.12, 'Updated positions restored on subsequent adjust/recall');
console.log('✔ Subsequent adjust restores the newly updated positions.');

// 7. Test guard on deleting actively playing scene
console.log('Testing deletion guards...');
const currentPlaying = engine.playingIndex;
const deletePlayingResult = engine.deleteScene(currentPlaying);
assert.strictEqual(deletePlayingResult, false, 'deleteScene on actively playing scene must return false');
assert.strictEqual(engine.scenes.length, initialCount + 1, 'Scene count unchanged after guarded delete');
console.log('✔ Actively playing scene deletion safely guarded and blocked.');

// 8. Test deleting a non-playing scene & verifying stable surviving scene IDs
console.log('Testing scene deletion and stable surviving IDs...');
// Record IDs of surviving scenes before deletion
const scenesBefore = engine.scenes.map(s => ({ id: s.id, name: s.name, index: s.index }));
const sceneToDeleteIdx = capturedIdx; // Captured scene at index 7
const expectedSurvivingIds = scenesBefore.filter((_, i) => i !== sceneToDeleteIdx).map(s => s.id);

const deleteResult = engine.deleteScene(sceneToDeleteIdx);
assert.strictEqual(deleteResult, true, 'deleteScene on non-playing scene must succeed');
assert.strictEqual(engine.scenes.length, initialCount, 'Scene count reduced by 1');
assert.strictEqual(engine.editingIndex, null, 'editingIndex cleared after deleting edited scene');

// Verify re-indexing of visible positions WITHOUT mutating surviving IDs
engine.scenes.forEach((s, idx) => {
  assert.strictEqual(s.index, idx, `Scene ${idx} index must be properly sequential`);
  assert.strictEqual(s.id, expectedSurvivingIds[idx], `Scene at position ${idx} must preserve its stable original ID: ${expectedSurvivingIds[idx]}`);
});
console.log('✔ Non-playing scene deleted cleanly: visible positions renumbered, surviving scene IDs stably preserved.');

// 9. Verify HTML markup contains new swipe wrappers, under-row action layer, and playhead overlay
console.log('Testing HTML markup generation...');
const loomHTML = engine.buildLoomHTML();
assert(loomHTML.includes('class="weave-loom-row-wrap"'), 'Must contain .weave-loom-row-wrap');
assert(loomHTML.includes('class="weave-loom-row-under"'), 'Must contain .weave-loom-row-under');
assert(loomHTML.includes('class="weave-loom-row-card'), 'Must contain .weave-loom-row-card');
assert(loomHTML.includes('adjust-msg'), 'Must contain adjust-msg');
assert(loomHTML.includes('delete-msg'), 'Must contain delete-msg');
assert(loomHTML.includes('class="weave-loom-playhead-svg"'), 'Must contain playhead overlay SVG');
console.log('✔ Loom HTML contains swipe wrappers, dynamic adjust/delete action layers, and playhead overlay.');

console.log('\n=== ALL WEAVE ROW SWIPE GESTURE TESTS PASSED ===');
