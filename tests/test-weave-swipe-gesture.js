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

const engine = global.window.weaveEngine;
engine.enabled = true; // exercise Weave with its header toggle enabled
assert(engine, 'WeaveEngine instance must be exposed to window.weaveEngine');

console.log('=== Running Weave Row Swipe Gesture Verification ===\n');

// 1. Initial State
assert.strictEqual(engine.editingIndex, null, 'editingIndex should initially be null');
assert.strictEqual(engine.scenes.length, 0, 'a new project starts with no Scenes');
console.log(`✔ Initial state verified: no Scenes, editingIndex = null.`);

// 2. Capture Scenes. S4 (D8): the first real capture replaces the demo set, so the count
// becomes 1, not 4; a second capture gives the non-playing Scene the later steps delete.
global.window.studio.tracks.forEach(t => t.setPosition(0.5, 0.5, 0));
assert.strictEqual((await engine.captureCurrentScene()).ok, true, 'first capture (becomes the playing Scene 01)');
assert.strictEqual(engine.scenes.length, 1, 'first real Scene is the first row');
const initialCount = engine.scenes.length;
global.window.studio.tracks[0].setPosition(0.25, 0.75, 5);
global.window.studio.tracks[1].setPosition(0.35, 0.65, 0);
global.window.studio.tracks[2].setPosition(0.45, 0.55, 0);
global.window.studio.tracks[3].setPosition(0.55, 0.45, 0);
assert.strictEqual((await engine.captureCurrentScene()).ok, true, 'capture a known Scene');
const capturedIdx = engine.scenes.length - 1;
const captured = () => engine.scenes[capturedIdx];   // rows are re-derived from the document after each change (S4)
const capturedId = captured().id;
assert(captured().spatialState, 'Captured scene must have spatialState');
assert.strictEqual(captured().spatialState.T1.x, 0.25, 'Captured T1 X matches');
assert.strictEqual(captured().spatialState.T1.y, 0.75, 'Captured T1 Y matches');
assert(/^sc_[0-9a-f-]{36}$/.test(capturedId), 'Captured scene has a stable S1 Scene ID (S4)');
console.log(`✔ Scene ${capturedIdx + 1} captured with distinct positions and stable ID: ${capturedId}.`);

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

assert.strictEqual(captured().spatialState.T1.x, 0.12, 'Existing snapshot T1 X updated in place');
assert.strictEqual(captured().spatialState.T1.y, 0.88, 'Existing snapshot T1 Y updated in place');
assert.strictEqual(captured().spatialState.T2.x, 0.92, 'Existing snapshot T2 X updated in place');
assert.strictEqual(captured().levels[0], 0.88, 'Scene levels[0] updated to match new Y');
assert.strictEqual(captured().id, capturedId, 'stable ID across the re-derived row');
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
const sceneToDeleteIdx = capturedIdx; // the captured, non-playing Scene
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
})().catch(e => { console.error(e); process.exit(1); });
