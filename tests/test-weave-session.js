/**
 * Weave v0.1 Phase 1 S4 — WeaveEngine session, capture transaction, bindings and gates.
 * Run: node tests/test-weave-session.js
 * Pure/mocked only: real weave.js and real S1–S3 modules; a mock studio whose
 * getCurrentSessionData behaves like the writer (synchronous snapshot, asynchronous
 * encode, source-revision check at the end). No browser, native app or audio.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Browser-like globals for weave.js (as the existing Weave tests do)
global.window = global;
global.window.addEventListener = () => {};
global.document = { documentElement: { style: {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
let NOW = 1000; global.performance = { now: () => NOW };
global.requestAnimationFrame = () => 0;
let timers = []; const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
const flushTimers = () => { const t = timers; timers = []; t.forEach(x => x.fn()); };
const tick = () => new Promise(r => realSetTimeout(r, 0));

window.AetherWeaveModel = require(path.join(__dirname, '..', 'desktop', 'weave-model.js'));
window.AetherWeaveAssets = require(path.join(__dirname, '..', 'desktop', 'weave-assets.js'));
const REAL_S3 = require(path.join(__dirname, '..', 'desktop', 'weave-import.js'));
// The engine calls S3 through this frozen wrapper so tests can act "during hashing" (after the
// writer resolved, before the commit) — the real S3 does the work.
let hashHooks = [];
window.AetherWeaveImport = Object.freeze(Object.assign({}, REAL_S3, {
  extractAetherAssets: async (...args) => { const r = await REAL_S3.extractAetherAssets(...args); for (const h of hashHooks.splice(0)) await h(); return r; }
}));
const M = window.AetherWeaveModel;
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weave-v1-two-scenes.json'), 'utf8'));
const FX = Object.keys(FIXTURE.assets);
const A440 = FIXTURE.assets[FX[0]].storage.data, A660 = FIXTURE.assets[FX[1]].storage.data, ZIP = FIXTURE.assets[FX[2]].storage.data;
const ID_A440 = FX[0], ID_A660 = FX[1], ID_ZIP = FX[2];

// ---------- mock studio ----------
class MockTrack {
  constructor(index) {
    this.index = index; this.name = 'Track ' + (index + 1); this.sampleName = '';
    this.x = 0.5; this.y = 0.5; this.z = 0; this.moves = [];
    this._sourceRevision = 0; this._bufferOrigin = null; this._weaveBinding = null;
    this.audioBuffer = null; this.playlist = []; this.playlistIndex = 0; this.isShuffle = false; this.isRepeat = true;
    this.isCustomNode = false; this.customNodeBundle = null; this.customNodeParams = null; this.customNodeZipBase64 = null; this.customNodeDSP = null;
    this.isLiveIn = false; this.isStream = false; this.streamUrl = '';
    this.isMuted = false; this.isSoloed = false; this.eqValues = { low: 0, mid: 0, high: 0 }; this.stripGainDb = 0; this.motionSpeed = 1; this.motionPath = [];
    this.isPlayingMotion = false; this.isRecordingMotion = false;
  }
  setPosition(x, y, z) { this.x = x; this.y = y; if (z !== undefined) this.z = z; this.moves.push([x, y, z]); }
  // the same replacement discipline as the host
  _noteSourceReplaced() { this._sourceRevision++; this._bufferOrigin = null; }
  setPlaylist(files, idx) { this._noteSourceReplaced(); this.playlist = files; this.playlistIndex = idx || 0; const f = files[this.playlistIndex]; this.audioBuffer = { decodedOf: f.name }; this._bufferOrigin = { kind: 'decoded-item', revision: this._sourceRevision, bufferRef: this.audioBuffer, fileRef: f }; }
  setNode(zip, params) { this._noteSourceReplaced(); this.isCustomNode = true; this.customNodeZipBase64 = zip; this.customNodeBundle = { file_name: 'p.aethernode', manifest: { id: 'com.aether.test.fixture-pulse', version: '0.0.1', name: 'Fixture Pulse' } }; this.customNodeParams = params || { level: 0.5 }; this.customNodeDSP = { params: this.customNodeParams }; this.audioBuffer = null; }
  setLiveIn() { this._noteSourceReplaced(); this.isLiveIn = true; this.playlist = []; this.audioBuffer = null; }
  setStream(url) { this._noteSourceReplaced(); this.isStream = true; this.streamUrl = url; this.playlist = []; this.audioBuffer = null; }
  clear() { this._noteSourceReplaced(); this.playlist = []; this.audioBuffer = null; this.isCustomNode = false; this.customNodeBundle = null; this.customNodeZipBase64 = null; this.customNodeDSP = null; this.isLiveIn = false; this.isStream = false; this.streamUrl = ''; }
}
function makeStudio() {
  const st = {
    tracks: [0, 1, 2, 3].map(i => new MockTrack(i)),
    toasts: [], drawn: 0, isPlaying: false, currentBpm: 120, activeDragNodeIndex: -1,
    drawArena() { st.drawn++; },
    showToast(m) { st.toasts.push(m); },
    writerDelayMs: 0, writerHooks: [],
    // Like the writer: synchronous snapshot now; encode asynchronously; refuse if a source changed meanwhile.
    getCurrentSessionData(name) {
      const snapshots = st.tracks.map(t => ({ rev: t._sourceRevision, playlist: t.playlist.slice(), playlistIndex: t.playlistIndex, isShuffle: t.isShuffle, isRepeat: t.isRepeat }));
      const tracksData = st.tracks.map(t => ({
        index: t.index, name: t.name, sampleName: t.sampleName || t.name, filePath: '',
        sampleData: t.audioBuffer ? (t.audioBuffer.rendered || (t.playlist[t.playlistIndex] ? t.playlist[t.playlistIndex].data : A660)) : null,
        playlist: t.playlist.map(f => ({ name: f.name, type: 'audio/wav', data: f.data })), playlistIndex: t.playlistIndex, isShuffle: t.isShuffle, isRepeat: t.isRepeat,
        isCustomNode: t.isCustomNode, customNodeBundle: t.customNodeBundle, customNodeParams: t.customNodeParams ? { ...t.customNodeParams } : null, customNodeZipBase64: t.customNodeZipBase64,
        isLiveIn: t.isLiveIn, x: t.x, y: t.y, z: t.z, isMuted: t.isMuted, isSoloed: t.isSoloed, motionSpeed: t.motionSpeed, motionPath: t.motionPath.map(p => ({ ...p })),
        eq: { ...t.eqValues }, stripGainDb: t.stripGainDb, isStream: t.isStream, streamUrl: t.streamUrl
      }));
      return (async () => {
        await new Promise(r => realSetTimeout(r, st.writerDelayMs));
        for (const h of st.writerHooks.splice(0)) await h();
        if (st.tracks.some((t, i) => t._sourceRevision !== snapshots[i].rev || t.playlistIndex !== snapshots[i].playlistIndex || t.isShuffle !== snapshots[i].isShuffle || t.isRepeat !== snapshots[i].isRepeat)) {
          throw new Error('A source changed while saving. Please save again.');
        }
        return { version: '3.1', type: 'aether_project', name: name || 'Untitled Project', masterVolume: 0.8, loudnessDb: 0, tracks: tracksData };
      })();
    }
  };
  return st;
}
const weaveCode = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'weave.js'), 'utf8');
function freshEngine() {
  const st = makeStudio(); global.window.studio = st;
  eval(weaveCode);
  const e = global.window.weaveEngine;
  e.enabled = true; // these fixtures exercise the opt-in Weave feature
  e.renderWeaveLeft = () => {}; e.renderTransitionRight = () => {}; e.render = () => {};
  return { e, st };
}
const fileA = { name: 'a.wav', data: A440 }, fileB = { name: 'b.wav', data: A660 };
const thread = (e, k) => e._threadIdForSlot(k);
// GO NOW is quantized to the next bar line: arm it, then run the clock up to that bar.
const goNowOnBar = async (e, st) => { st.isPlaying = true; const ok = e.goNext(); let n = 0; while (e._launch && n++ < 200) { if (!e._launch.ready) { await tick(); continue; } e.onTransportTick(true, 120, Math.max(0.01, e._launch.atTransport - e._clock().transportTime + 0.002)); } for (let i = 0; i < 3; i++) await tick(); return ok; };
// seconds of transport until the next bar line on the fallback grid (2 s per bar at 120)
const toNextBar = (e) => { const b = e._clock().transportTime / 2; return 2 * (Math.floor(b + 1e-6) + 1 - b) + 0.002; };
const state = (e, row, k) => e.session.doc.scenes[row.id].threadStates[thread(e, k)];

let passed = 0, failed = 0; const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. boot: valid empty document, no Scene rows at all (a new project starts empty), nothing bound', () => {
  const { e } = freshEngine();
  assert.strictEqual(e.session.available, true);
  assert.strictEqual(M.validateDocument(e.session.doc).ok, true);
  assert.strictEqual(e.session.doc.order.length, 0); assert.strictEqual(e.session.demo, true);
  assert.deepStrictEqual(e.scenes, [], 'no rows until the first + SCENE');
  assert.strictEqual(e.calcTotalBars(), 0);
  // the old seed set survives only as the future demo project, never shown by default
  assert.deepStrictEqual(e._demoSetRows().map(r => [r.name, r.bars, r.demo]), [['Slow emergence', 16, true], ['Open water', 32, true], ['Afterglow', 16, true]]);
});

test('2. capture happy path: real Scene with capture provenance, dedupe, bindings, docRevision +1, demo gone', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA, fileB], 1); st.tracks[0].setPosition(0.2, 0.8, 3);
  st.tracks[1].setNode(ZIP, { level: 0.5 }); st.tracks[1].setPosition(0.3, 0.6, 0);
  st.tracks[2].setLiveIn(); st.tracks[3].setPosition(0.7, 0.4, 0);
  const r = await e.captureCurrentScene();
  assert.strictEqual(r.ok, true, r.code);
  const doc = e.session.doc;
  assert.strictEqual(M.validateDocument(doc).ok, true); assert.strictEqual(M.checkCompactCapacity(doc).ok, true);
  assert.strictEqual(doc.order.length, 1); assert.strictEqual(e.session.docRevision, 1); assert.strictEqual(e.session.dirty, true); assert.strictEqual(e.session.demo, false);
  const sc = doc.scenes[r.sceneId];
  assert.deepStrictEqual(Object.keys(sc.provenance).sort(), ['capturedAt', 'kind']); assert.strictEqual(sc.provenance.kind, 'capture');
  assert.deepStrictEqual(Object.keys(doc.assets).sort(), [ID_A440, ID_A660, ID_ZIP].sort(), 'rendered buffer pruned (plain decode of the selected item)');
  assert.deepStrictEqual(r.pruned, [0]);
  assert.strictEqual(e.scenes.length, 1); assert.strictEqual(e.scenes[0].demo, false); assert.strictEqual(e.scenes[0].id, r.sceneId);
  assert.deepStrictEqual(e.scenes[0].spatialState, { T1: { x: 0.2, y: 0.8, z: 3 }, T2: { x: 0.3, y: 0.6, z: 0 }, T3: { x: 0.5, y: 0.5, z: 0 }, T4: { x: 0.7, y: 0.4, z: 0 } });
  assert.deepStrictEqual(e.scenes[0].levels, [0.8, 0.6, 0.5, 0.4]);
  const b0 = st.tracks[0]._weaveBinding;
  assert.deepStrictEqual(b0, { weaveId: doc.id, threadId: thread(e, 0), sceneId: r.sceneId, sourceIdentity: 'playlist:' + ID_A440 + ',' + ID_A660, selectedKey: '1||', sourceRevision: 1 });
  assert.strictEqual(st.tracks[1]._weaveBinding.sourceIdentity, 'node:' + ID_ZIP);
  assert.strictEqual(st.tracks[2]._weaveBinding.sourceIdentity, 'live-input');
  assert.strictEqual(st.tracks[3]._weaveBinding.sourceIdentity, 'empty');
  for (const t of st.tracks) assert.strictEqual(e.bindingValid(t), true);
  assert.strictEqual(e.selectedIndex, 0);
});

test('3. origin proof uses press values only: pruned when decoded-item matches revision, buffer and selected file; override kept otherwise', async () => {
  const cases = [
    ['decoded-item matching', (t) => {}, true],
    ['stale revision', (t) => { t._bufferOrigin.revision -= 1; }, false],
    ['different buffer object', (t) => { t._bufferOrigin.bufferRef = {}; }, false],
    ['different file', (t) => { t._bufferOrigin.fileRef = fileB; }, false],
    ['kind session', (t) => { t._bufferOrigin = { kind: 'session' }; }, false],
    ['kind rebuilt', (t) => { t._bufferOrigin = { kind: 'rebuilt' }; }, false],
    ['kind synthetic', (t) => { t._bufferOrigin = { kind: 'synthetic' }; }, false],
    ['no origin', (t) => { t._bufferOrigin = null; }, false]
  ];
  for (const [label, mutate, expectPruned] of cases) {
    const { e, st } = freshEngine();
    const t = st.tracks[0]; t.setPlaylist([fileA], 0); t.audioBuffer.rendered = A660; // the "rendered" buffer bytes differ from the item
    mutate(t);
    const liveOriginBefore = JSON.stringify(t._bufferOrigin);
    // mutate the LIVE origin after the press (must not matter)
    st.writerHooks.push(async () => { t._bufferOrigin = { kind: 'decoded-item', revision: t._sourceRevision, bufferRef: t.audioBuffer, fileRef: fileA }; });
    const r = await e.captureCurrentScene();
    assert.strictEqual(r.ok, true, label + ': ' + r.code);
    const ts = state(e, e.scenes[0], 0);
    if (expectPruned) { assert.strictEqual('override' in ts.source, false, label); assert.deepStrictEqual(Object.keys(e.session.doc.assets), [ID_A440], label); }
    else { assert.deepStrictEqual(ts.source.override, { assetId: ID_A660, reason: 'derived-buffer' }, label); assert.strictEqual(e.session.doc.assets[ID_A660].origin, 'rendered-buffer', label); }
    void liveOriginBefore;
  }
});

test('4. source change after encoding (before commit) fails the capture: nothing added, nothing bound; also while waiting behind another capture', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  // (a) change after the writer resolved: S3 hashing is in flight → recheck fails
  const changeAfterEncode = ['_sourceRevision', 'audioBuffer', 'playlist', 'playlistIndex', 'isShuffle', 'isRepeat', 'isLiveIn', 'isStream', 'streamUrl', 'customNodeDSP', 'customNodeZipBase64'];
  for (const field of changeAfterEncode) {
    const t = st.tracks[0];
    const saved = { v: t[field], rev: t._sourceRevision };
    hashHooks.push(async () => {
    if (field === '_sourceRevision') t._sourceRevision++;
    else if (field === 'audioBuffer') t.audioBuffer = { other: true };
    else if (field === 'playlist') t.playlist = t.playlist.slice().concat([fileB]);
    else if (field === 'playlistIndex') t.playlistIndex = 1;
    else if (field === 'isShuffle') t.isShuffle = true;
    else if (field === 'isRepeat') t.isRepeat = false;
    else if (field === 'isLiveIn') t.isLiveIn = true;
    else if (field === 'isStream') t.isStream = true;
    else if (field === 'streamUrl') t.streamUrl = 'https://x.invalid';
    else if (field === 'customNodeDSP') t.customNodeDSP = {};
    else if (field === 'customNodeZipBase64') t.customNodeZipBase64 = ZIP;
    });
    const r = await e.captureCurrentScene();
    assert.strictEqual(r.ok, false, field); assert.strictEqual(r.code, 'changed', field);
    assert.strictEqual(e.session.doc.order.length, 0, field + ': nothing added'); assert.strictEqual(t._weaveBinding, null, field + ': nothing bound');
    assert.ok(st.toasts[st.toasts.length - 1].startsWith('Scene not added'), field);
    t[field] = saved.v; t._sourceRevision = saved.rev;
    if (field === 'playlistIndex') t.playlistIndex = 0;
  }
  // (b) change while waiting behind an earlier (slow) capture
  st.writerDelayMs = 20;
  const first = e.captureCurrentScene();
  st.writerDelayMs = 0;
  const second = e.captureCurrentScene();
  st.tracks[0]._noteSourceReplaced();   // after both presses, before either commits
  const [r1, r2] = await Promise.all([first, second]);
  assert.strictEqual(r1.ok, false); assert.strictEqual(r2.ok, false);
  assert.strictEqual(e.session.doc.order.length, 0);
  // (c) binding never points at a replaced source: a capture that commits binds the press revision
  const r3 = await e.captureCurrentScene();
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(st.tracks[0]._weaveBinding.sourceRevision, st.tracks[0]._sourceRevision);
});

test('5. deletion during hashing is preserved: the capture composes onto the latest document; docRevision is monotonic', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  await e.captureCurrentScene(); await e.captureCurrentScene();   // A, B
  const [idA, idB] = e.session.doc.order.slice();
  e.playingIndex = 1;   // B playing → A deletable
  const revs = [e.session.docRevision];
  hashHooks.push(async () => { assert.strictEqual(e.deleteScene(0), true, 'delete A during hashing'); revs.push(e.session.docRevision); });
  const r = await e.captureCurrentScene();
  assert.strictEqual(r.ok, true, r.code);
  revs.push(e.session.docRevision);
  assert.deepStrictEqual(e.session.doc.order, [idB, r.sceneId], 'A stays deleted, C appended');
  assert.deepStrictEqual(revs, [2, 3, 4]);
  assert.strictEqual(M.validateDocument(e.session.doc).ok, true);
  assert.strictEqual(idA in e.session.doc.scenes, false);
});

test('6. an ADJUST drag-end made during hashing survives the capture commit', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  const rA = await e.captureCurrentScene();
  hashHooks.push(async () => {
    e.adjustScene(0); st.tracks[0].setPosition(0.11, 0.22, 0); e.onNodeDragEnd(); e.exitAdjust();
    assert.deepStrictEqual(state(e, e.scenes[0], 0).spatial, { x: 0.11, y: 0.22, z: 0 });
  });
  const rB = await e.captureCurrentScene();
  assert.strictEqual(rB.ok, true);
  assert.deepStrictEqual(e.session.doc.scenes[rA.sceneId].threadStates[thread(e, 0)].spatial, { x: 0.11, y: 0.22, z: 0 }, 'edit preserved');
  assert.strictEqual(e.session.doc.order.length, 2);
});

test('7. a failed earlier capture does not block a later successful one; press order kept', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  st.writerDelayMs = 15;
  const p1 = e.captureCurrentScene();        // will fail: source changes before its commit
  st.writerDelayMs = 0;
  st.tracks[1].setPosition(0.9, 0.1, 0);
  const p2 = e.captureCurrentScene();
  st.tracks[0]._noteSourceReplaced();        // invalidates both presses' snapshots for track 0
  const p3early = null;
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(r1.ok, false); assert.strictEqual(r2.ok, false);
  const r3 = await e.captureCurrentScene();  // pressed after the change → succeeds
  assert.strictEqual(r3.ok, true, r3.code);
  assert.strictEqual(e.session.doc.order.length, 1);
  // order: two valid presses commit in press order even if the first is slower
  st.writerDelayMs = 15; const pa = e.captureCurrentScene(); st.writerDelayMs = 0; const pb = e.captureCurrentScene();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.ok(ra.ok && rb.ok);
  assert.deepStrictEqual(e.session.doc.order.slice(1), [ra.sceneId, rb.sceneId]);
  assert.ok(ra.captureId < rb.captureId);
  void p3early;
});

test('8. stale epoch: every pending capture is discarded', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  const p1 = e.captureCurrentScene(); const p2 = e.captureCurrentScene();
  e.session.epoch++;   // S5 New/Open would do this
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(r1.code, 'changed'); assert.strictEqual(r2.code, 'changed');
  assert.ok(st.toasts.every(t => /replaced during capture/.test(t)));
  assert.strictEqual(e.session.doc.order.length, 0);
});

test('9. binding invalidation: every replacement path (via the host discipline) invalidates; transport-like changes do not', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setNode(ZIP);
  await e.captureCurrentScene();
  for (const t of st.tracks) assert.strictEqual(e.bindingValid(t), true);
  st.tracks[0].x = 0.9; st.tracks[0].isPlayingMotion = true;   // transport/ownership changes, not source changes
  assert.strictEqual(e.bindingValid(st.tracks[0]), true);
  st.tracks[0].isPlayingMotion = false;
  const paths = { live: (t) => t.setLiveIn(), stream: (t) => t.setStream('https://x.invalid'), clear: (t) => t.clear(), item: (t) => t.setPlaylist([fileA, fileB], 1), node: (t) => t.setNode(ZIP), generic: (t) => t._noteSourceReplaced() };
  for (const [name, fn] of Object.entries(paths)) {
    const { e: e2, st: st2 } = freshEngine();
    st2.tracks[0].setPlaylist([fileA], 0);
    await e2.captureCurrentScene();
    fn(st2.tracks[0]);
    assert.strictEqual(e2.bindingValid(st2.tracks[0]), false, name);
    assert.strictEqual(e2.bindingFor(st2.tracks[0]) !== null, true, name + ': binding object kept, just invalid');
  }
});

test('10. arrangement playback takes the nodes over (5 Oct, Matt): a slot playing another sound is switched to the Scene\'s sound from the capture cache and moved; a running motion loop is replaced; the dragged node is left alone; suspension mid-glide stops the glide', async () => {
  const { e, st } = freshEngine();
  st.tracks.forEach((t, k) => t.setPosition(0.1 * (k + 1), 0.1 * (k + 1), 0));
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setPlaylist([fileB], 0);
  await e.captureCurrentScene();                                   // Scene 01 at 0.1/0.2/0.3/0.4, T2 = b.wav
  const bufB = st.tracks[1].audioBuffer;
  st.tracks.forEach((t, k) => t.setPosition(0.9, 0.9, 0));
  await e.captureCurrentScene();                                   // Scene 02 at 0.9
  st.tracks[1].setPlaylist([fileA], 0);                            // slot 2 now plays something else
  st.tracks[2].isPlayingMotion = true; st.tracks[2].motionPath = [{ t: 0, x: 0.9, y: 0.9, z: 0 }, { t: 1, x: 0.8, y: 0.8, z: 0 }];
  st.tracks.forEach(t => { t.moves = []; });
  e.playingIndex = 1; e.selectedIndex = 0; e.transitionMode = 'morph';
  await goNowOnBar(e, st);                                               // → Scene 01 on the bar line, one-bar crossfade glide
  assert.strictEqual(e.playingIndex, 0); assert.ok(e.glide && e.glide.endsAtBar === 1 && e.glide.arrangement);
  assert.strictEqual(st.tracks[1].audioBuffer, bufB, 'T2 switched back to Scene 01\'s sound (no decoding: the capture kept the buffer)');
  assert.strictEqual(e._slotMatchesScene(1, e.scenes[0].id), true, 'T2 rebound to the Scene it now plays');
  assert.strictEqual(st.tracks[2].isPlayingMotion, false, 'the old motion loop is frozen so it cannot fight the glide');
  e.onTransportTick(true, 120, 1); e.updateGlide(NOW);             // half a bar into the crossfade
  assert.deepStrictEqual(st.tracks.map(t => t.moves.length), [1, 1, 1, 1], 'every slot glides, T2 included');
  assert.strictEqual(st.toasts.filter(t => /not moved/.test(t)).length, 0, 'no "not moved" report for arrangement playback');
  // the node being dragged is never moved
  st.activeDragNodeIndex = 3; e.onTransportTick(true, 120, 0.4); e.updateGlide(NOW); st.activeDragNodeIndex = -1;
  assert.strictEqual(st.tracks[3].moves.length, 1, 'dragged node untouched'); assert.strictEqual(st.tracks[2].moves.length, 2);
  // suspension (sources being replaced) stops the glide where it is
  const tok = e.onSourcesReplacing();
  e.onTransportTick(true, 120, 0.2); e.updateGlide(NOW); assert.strictEqual(e.glide, null, 'glide dropped while suspended');
  assert.strictEqual(st.tracks[2].moves.length, 2);
  e.onSourcesReplaced(tok, { replaced: false });
  // Scene 01 has no motion for T3: on arrival its loop stays off (path kept, not run)
  e.playingIndex = 1; e.selectedIndex = 0; e.currentBarInScene = 0.5; await goNowOnBar(e, st); e.onTransportTick(true, 120, 2.2); e.updateGlide(NOW);
  assert.strictEqual(e.glide, null); assert.strictEqual(st.tracks[2].isPlayingMotion, false); assert.strictEqual(st.tracks[2].motionPath.length, 2);
});

test('11. empty Weave: GO NOW, auto-advance, Preview, ADJUST, delete and drag-end do nothing and throw nothing', async () => {
  const { e, st } = freshEngine();
  e.goNow(); e.previewTransition(); flushTimers();
  e.onTransportTick(true, 120, 1000);
  assert.deepStrictEqual(st.tracks.map(t => t.moves.length), [0, 0, 0, 0]);
  e.adjustScene(0); assert.strictEqual(e.editingIndex, null);
  assert.strictEqual(e.deleteScene(0), false); assert.strictEqual(e.scenes.length, 0);
  e.onNodeDragEnd(); assert.strictEqual(e.session.docRevision, 0);
  assert.strictEqual(e.reorderScene('nope', 0), false); assert.strictEqual(e.setSceneBars('nope', 8), false);
  e.selectScene(0); e.updateDynamicReadouts(); e._updateFade();
  // the render paths produce the empty hint, not a crash
  assert.ok(/data-weave-empty/.test(e.buildLoomHTML()) && /data-weave-empty/.test(e.buildSetListHTML(false)));
});

test('12. delayed Preview: cancelled by invalidation, suspension or a newer Preview; runs with the gate otherwise', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  st.tracks.forEach(t => t.setPosition(0.1, 0.1, 0)); await e.captureCurrentScene();
  st.tracks.forEach(t => t.setPosition(0.9, 0.9, 0)); await e.captureCurrentScene();
  e.transitionMode = 'jump'; e.selectedIndex = 0;
  st.tracks.forEach(t => { t.moves = []; });
  assert.strictEqual(e.previewTransition(), true);
  assert.strictEqual(timers.length, 1);
  st.tracks[0]._noteSourceReplaced();   // slot 1 invalid before the callback
  flushTimers();
  assert.strictEqual(st.tracks[0].moves.length, 1, 'slot 1 snapped to Scene 01 at Preview start only');
  assert.strictEqual(st.tracks[1].moves.length, 2, 'slot 2 snapped to Scene 01 then Scene 02');
  // newer Preview cancels the older callback
  st.tracks.forEach(t => { t.moves = []; });
  e.previewTransition(); e.previewTransition();
  assert.strictEqual(timers.length, 2);
  flushTimers();
  assert.strictEqual(st.tracks[1].moves.length, 3, 'start, start, one delayed move (the stale one skipped)');
  // suspension cancels
  st.tracks.forEach(t => { t.moves = []; });
  e.previewTransition(); const tok = e.onSourcesReplacing(); flushTimers();
  assert.strictEqual(st.tracks[1].moves.length, 1, 'only the start snap; delayed callback skipped while suspended');
  e.onSourcesReplaced(tok, { kind: 'session', replaced: false });
});

test('13. ADJUST (provisional D5): bound spatial recall only; same-source/different-Scene drag-end is refused; DONE writes nothing', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setPlaylist([fileB], 0);
  st.tracks.forEach(t => t.setPosition(0.2, 0.2, 0)); const rA = await e.captureCurrentScene();
  st.tracks.forEach(t => t.setPosition(0.8, 0.8, 0)); const rB = await e.captureCurrentScene();
  st.tracks[1].setPlaylist([fileA], 0);               // slot 2 differs from both Scenes now
  st.tracks.forEach(t => { t.moves = []; });
  e.adjustScene(0);                                    // recall Scene 01: slots 1,3,4 match (same sources, incl. empty); slot 2 does not
  assert.strictEqual(e.editingIndex, 0);
  assert.strictEqual(st.tracks[0].x, 0.2); assert.strictEqual(st.tracks[1].x, 0.8, 'left alone'); assert.strictEqual(st.tracks[2].x, 0.2);
  assert.ok(/T2 play a different source/.test(st.toasts[st.toasts.length - 1]));
  // drag-end while adjusting Scene 01: slots are bound to Scene 02 → nothing written to Scene 01
  st.tracks[0].setPosition(0.33, 0.44, 0);
  const revBefore = e.session.docRevision;
  e.onNodeDragEnd();
  assert.strictEqual(e.session.docRevision, revBefore, 'no document write');
  assert.deepStrictEqual(state(e, e.scenes[0], 0).spatial, { x: 0.2, y: 0.2, z: 0 });
  assert.ok(/Positions not saved to Scene 01/.test(st.toasts[st.toasts.length - 1]));
  e.exitAdjust(); assert.strictEqual(e.session.docRevision, revBefore);
  // adjusting Scene 02 (the binding Scene) writes bound slots only
  e.adjustScene(1); st.tracks[0].setPosition(0.55, 0.66, 2); st.tracks[1].setPosition(0.1, 0.1, 0);
  e.onNodeDragEnd();
  assert.strictEqual(e.session.docRevision, revBefore + 1);
  assert.deepStrictEqual(state(e, e.scenes[1], 0).spatial, { x: 0.55, y: 0.66, z: 2 });
  assert.deepStrictEqual(state(e, e.scenes[1], 1).spatial, { x: 0.8, y: 0.8, z: 0 }, 'unbound slot keeps its saved state');
  assert.deepStrictEqual(e.scenes[1].spatialState.T1, { x: 0.55, y: 0.66, z: 2 }, 'view re-derived');
  assert.strictEqual(M.validateDocument(e.session.doc).ok, true);
  void rA; void rB;
});

test('14. suspension and detach: writes blocked while suspended; successful/partial loads detach; failed preflight does not; rebuild detaches; capture clears detached', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  st.tracks.forEach(t => t.setPosition(0.2, 0.2, 0)); await e.captureCurrentScene();
  st.tracks.forEach(t => t.setPosition(0.8, 0.8, 0)); await e.captureCurrentScene();
  const tok = e.onSourcesReplacing();
  assert.strictEqual(e.suspended, true);
  e.playingIndex = 1; e.transitionMode = 'jump'; st.tracks.forEach(t => { t.moves = []; });
  await goNowOnBar(e, st); assert.deepStrictEqual(st.tracks.map(t => t.moves.length), [0, 0, 0, 0], 'no glide while suspended');
  e.adjustScene(0); assert.deepStrictEqual(st.tracks.map(t => t.moves.length), [0, 0, 0, 0]); e.exitAdjust();
  const rc = await e.captureCurrentScene(); assert.strictEqual(rc.code, 'suspended');
  // overlapping tokens: releasing one does not release the other
  const tok2 = e.onSourcesReplacing();
  e.onSourcesReplaced(tok, { kind: 'session', replaced: false });
  assert.strictEqual(e.suspended, true, 'second token still held');
  e.onSourcesReplaced(tok2, { kind: 'session', replaced: false });
  assert.strictEqual(e.suspended, false); assert.strictEqual(e.session.detached, false, 'failed preflight does not detach');
  // successful load → detached, toast; writes blocked
  const t3 = e.onSourcesReplacing(); st.tracks.forEach(t => t._noteSourceReplaced());
  e.onSourcesReplaced(t3, { kind: 'session', replaced: true, fileName: 'song.aether', failures: [] });
  assert.strictEqual(e.session.detached, true); assert.ok(/Weave detached — live sound is now song.aether/.test(st.toasts[st.toasts.length - 1]));
  await goNowOnBar(e, st); e.onTransportTick(true, 120, 2.1); e.updateGlide(NOW); assert.deepStrictEqual(st.tracks.map(t => t.moves.length), [0, 0, 0, 0], 'detached: nothing moves');
  // partial load lists failures
  const t4 = e.onSourcesReplacing(); e.onSourcesReplaced(t4, { kind: 'session', replaced: true, fileName: 'p.aether', failures: ['Track 2: bad'] });
  assert.ok(/Tracks that failed to load: Track 2: bad/.test(st.toasts[st.toasts.length - 1]));
  // rebuild detaches with its own message
  const t5 = e.onSourcesReplacing(); e.onSourcesReplaced(t5, { kind: 'rebuild', replaced: true });
  assert.ok(/Audio engine restarted/.test(st.toasts[st.toasts.length - 1]));
  // unknown token is ignored
  e.onSourcesReplaced({}, { kind: 'session', replaced: true });
  // a capture clears detached and binds again
  st.tracks[0].setPlaylist([fileA], 0);
  const r = await e.captureCurrentScene();
  assert.strictEqual(r.ok, true); assert.strictEqual(e.session.detached, false);
  st.tracks.forEach(t => { t.moves = []; });
  e.playingIndex = 2; e.selectedIndex = 0; e.transitionMode = 'jump'; await goNowOnBar(e, st); e.onTransportTick(true, 120, 2.1); e.updateGlide(NOW); assert.ok(st.tracks[0].moves.length >= 1, 'moves again after rebinding');
});

test('15. live-input and stream replacement: GO NEXT to a Scene with samples prepares and switches those slots (fade down → switch → fade up); drag-end refused; a pending capture fails', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setPlaylist([fileB], 0);
  st.tracks.forEach(t => t.setPosition(0.2, 0.2, 0)); await e.captureCurrentScene();
  st.tracks.forEach(t => t.setPosition(0.8, 0.8, 0)); await e.captureCurrentScene();
  const p = e.captureCurrentScene();
  st.tracks[0].setLiveIn(); st.tracks[1].setStream('https://x.invalid/s');
  const r = await p; assert.strictEqual(r.ok, false);
  st.tracks.forEach(t => { t.moves = []; });
  // Scene 01 needs its samples back on T1/T2 (live input / stream are different required sources): GO NEXT prepares,
  // fades down on the bar, installs the prepared sounds, fades up — the Scene lands whole.
  e.playingIndex = 1; e.selectedIndex = 0; e.transitionMode = 'jump'; await goNowOnBar(e, st);
  assert.strictEqual(e._launch, null, 'launch fired'); await tick(); await tick(); await tick();
  assert.strictEqual(e.playingIndex, 0, 'arrived at Scene 01 after the switch');
  assert.ok(st.tracks.every(t => t.moves.length >= 1), 'positions follow for every slot: ' + st.tracks.map(t => t.moves.length));
  assert.ok(!st.tracks[0].isLiveIn && !st.tracks[1].isStream, 'live input and stream replaced by the Scene\'s sounds');
  assert.strictEqual(st.tracks[0].audioBuffer.decodedOf, 'a.wav'); assert.strictEqual(st.tracks[1].audioBuffer.decodedOf, 'b.wav');
  assert.ok(e._entrance && e._entrance.idx === 0, 'fades up over one bar after the switch');
  // the installed slots now belong to Scene 01: an ADJUST drag-end writes it
  e.adjustScene(0); st.tracks[0].setPosition(0.4, 0.4, 0); const rev = e.session.docRevision; e.onNodeDragEnd();
  assert.strictEqual(e.session.docRevision, rev + 1, 'T1 is bound to Scene 01 after the switch');
  e.exitAdjust();
  // capturing live input / stream works and records them as such
  st.tracks[0].setLiveIn(); st.tracks[1].setStream('https://x.invalid/s');
  const r2 = await e.captureCurrentScene();
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(state(e, e.scenes[2], 0).source.kind, 'live-input'); assert.strictEqual(state(e, e.scenes[2], 1).source.kind, 'stream');
  assert.deepStrictEqual(state(e, e.scenes[2], 0).unsupported, ['live-input-not-stored']);
});

test('16. capacity and validity are checked before every commit; refusals add nothing', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  // a document whose thread for slot 1 is missing cannot be captured into
  e.session.doc.threads[0].color = 'track-2';
  const r = await e.captureCurrentScene();
  assert.strictEqual(r.ok, false); assert.strictEqual(e.session.doc.order.length, 0);
  // S3 conflict (node track that also has playlist items) is refused, never silently incomplete
  const { e: e2, st: st2 } = freshEngine();
  st2.tracks[0].setNode(ZIP); st2.tracks[0].playlist = [fileA];
  const r2 = await e2.captureCurrentScene();
  assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, 'conflict'); assert.strictEqual(e2.session.doc.order.length, 0);
  assert.ok(/Track 1/.test(st2.toasts[st2.toasts.length - 1]));
  // writer refusal (pending load) surfaces as a toast and adds nothing
  const { e: e3, st: st3 } = freshEngine();
  st3.getCurrentSessionData = () => { throw new Error('Wait for the current source or project to finish loading.'); };
  const r3 = await e3.captureCurrentScene();
  assert.strictEqual(r3.code, 'refused'); assert.ok(/Wait for the current source/.test(st3.toasts[st3.toasts.length - 1]));
});

test('17. immutability: every document change validates; the view is re-derived; S1–S3 reached through frozen exports; capture snapshot copies origin but keeps File/AudioBuffer references', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  const press = e._pressSnapshot();
  assert.strictEqual(press.tracks[0].bufferRef, st.tracks[0].audioBuffer, 'AudioBuffer by reference');
  assert.strictEqual(press.tracks[0].playlistRefs[0], fileA, 'File by reference');
  assert.notStrictEqual(press.tracks[0].origin, st.tracks[0]._bufferOrigin, 'origin metadata copied');
  assert.strictEqual(press.tracks[0].origin.bufferRef, st.tracks[0].audioBuffer, 'copy keeps the buffer reference');
  assert.strictEqual(press.tracks[0].origin.fileRef, fileA, 'copy keeps the file reference');
  await e.captureCurrentScene();
  const before = JSON.stringify(e.session.doc);
  e.scenes[0].spatialState.T1.x = 0.123;   // editing the view must not touch the document
  assert.strictEqual(JSON.stringify(e.session.doc), before);
  e.syncViewFromDoc(); assert.notStrictEqual(e.scenes[0].spatialState.T1.x, 0.123);
  assert.ok(Object.isFrozen(window.AetherWeaveModel) && Object.isFrozen(window.AetherWeaveImport));
});

test('18. without the model scripts the engine shows the empty Weave and refuses capture cleanly', () => {
  const saved = [window.AetherWeaveModel, window.AetherWeaveImport];
  window.AetherWeaveModel = undefined; window.AetherWeaveImport = undefined;
  const { e, st } = freshEngine();
  assert.strictEqual(e.session.available, false); assert.strictEqual(e.scenes.length, 0);
  return e.captureCurrentScene().then(r => { assert.strictEqual(r.code, 'unavailable'); assert.ok(/not available/.test(st.toasts[0])); window.AetherWeaveModel = saved[0]; window.AetherWeaveImport = saved[1]; });
});

test('19. deletion keeps playing, selected and editing identities (Codex review 2): delete the first of three while the last is played, selected and edited', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  for (let i = 0; i < 3; i++) { st.tracks.forEach(t => t.setPosition(0.1 * (i + 1), 0.1 * (i + 1), 0)); await e.captureCurrentScene(); }
  const [idA, idB, idC] = e.scenes.map(r => r.id);
  e.playingIndex = 2; e.selectedIndex = 2; e.adjustScene(2);
  assert.strictEqual(e.editingIndex, 2);
  assert.strictEqual(e.deleteScene(0), true);
  assert.deepStrictEqual(e.scenes.map(r => r.id), [idB, idC], 'surviving IDs stable');
  assert.strictEqual(e.scenes[e.playingIndex].id, idC, 'playing Scene identity kept');
  assert.strictEqual(e.scenes[e.selectedIndex].id, idC, 'selected Scene identity kept');
  assert.strictEqual(e.editingIndex, 1); assert.strictEqual(e.scenes[e.editingIndex].id, idC, 'editing Scene identity kept');
  // deleting the edited Scene itself ends ADJUST; deleting a later Scene leaves the earlier identities alone
  e.exitAdjust(); e.playingIndex = 0; e.selectedIndex = 1; e.adjustScene(1);
  assert.strictEqual(e.deleteScene(1), true);
  assert.strictEqual(e.editingIndex, null); assert.strictEqual(e.scenes[e.playingIndex].id, idB); assert.strictEqual(e.scenes[e.selectedIndex].id, idB);
});

test('20. delayed jump Preview targets a stable Scene ID (Codex review 2): a selection change while waiting does not retarget; a deleted target cancels', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  for (let i = 0; i < 3; i++) { st.tracks.forEach(t => t.setPosition(0.1 * (i + 1), 0.1 * (i + 1), 0)); await e.captureCurrentScene(); }
  e.transitionMode = 'jump'; e.selectedIndex = 0; e.playingIndex = 0;
  st.tracks.forEach(t => { t.moves = []; });
  assert.strictEqual(e.previewTransition(), true);         // Scene 01 → Scene 02 intended
  e.selectedIndex = 1;                                      // user selects Scene 02 before the callback fires
  flushTimers();
  assert.deepStrictEqual(st.tracks[1].moves.map(m => m[0]), [0.1, 0.2], 'snapped to Scene 01 at start, then to Scene 02 (not Scene 03)');
  // the target Scene is deleted while the Preview is waiting → nothing moves
  e.selectedIndex = 0; st.tracks.forEach(t => { t.moves = []; });
  assert.strictEqual(e.previewTransition(), true);
  assert.strictEqual(e.deleteScene(1), true);               // Scene 02 (the target) deleted; playing is Scene 01
  flushTimers();
  assert.deepStrictEqual(st.tracks[1].moves.map(m => m[0]), [0.1], 'only the start snap; the delayed move to the deleted target was cancelled');
  // a Scene inserted before the target shifts indices but the delayed move still reaches the intended Scene by ID
  e.selectedIndex = 0; st.tracks.forEach(t => { t.moves = []; });
  assert.strictEqual(e.previewTransition(), true);         // Scene 01 → Scene 03 (now at index 1)
  const target = e.scenes[1].id;
  st.tracks.forEach(t => t.setPosition(0.55, 0.55, 0)); await e.captureCurrentScene();   // appends a new Scene at the end
  e.adjustScene(0); e.exitAdjust();                         // ADJUST meanwhile does not cancel a Preview by itself
  flushTimers();
  assert.strictEqual(e.scenes[1].id, target);
  assert.deepStrictEqual(st.tracks[1].moves.map(m => Math.round(m[0] * 100) / 100), [0.1, 0.55, 0.1, 0.3], 'start snap, the test move, ADJUST recall, then the delayed move to the intended Scene');
});


test('21. BUILD reorder preserves playing/selected/editing IDs, source bindings and assets; PLAY/demo refuse', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0);
  for (let i = 0; i < 3; i++) await e.captureCurrentScene();
  const ids = e.scenes.map(row => row.id);
  e.playingIndex = 0; e.selectedIndex = 1; e.editingIndex = 2;
  const assets = JSON.stringify(e.session.doc.assets);
  const bindings = st.tracks.map(t => t._weaveBinding);
  const rev = e.session.docRevision;
  assert.strictEqual(e.reorderScene(ids[2], 0), true);
  assert.deepStrictEqual(e.session.doc.order, [ids[2], ids[0], ids[1]]);
  assert.strictEqual(e.scenes[e.playingIndex].id, ids[0]);
  assert.strictEqual(e.scenes[e.selectedIndex].id, ids[1]);
  assert.strictEqual(e.scenes[e.editingIndex].id, ids[2]);
  assert.strictEqual(JSON.stringify(e.session.doc.assets), assets);
  st.tracks.forEach((t, i) => assert.strictEqual(t._weaveBinding, bindings[i]));
  assert.strictEqual(e.session.docRevision, rev + 1);
  assert.ok(M.validateDocument(e.session.doc).ok);
  assert.strictEqual(e.reorderScene(ids[2], 2), true);
  assert.deepStrictEqual(e.session.doc.order, ids);
  assert.strictEqual(e.reorderScene(ids[0], -1), false);
  e.mode = 'play'; assert.strictEqual(e.reorderScene(ids[0], 2), false);
  const { e: demo } = freshEngine(); assert.strictEqual(demo.reorderScene('scene-0', 2), false);
});

test('22. capture pending while reordering composes onto the latest order', async () => {
  const { e, st } = freshEngine();
  await e.captureCurrentScene(); await e.captureCurrentScene();
  const ids = e.session.doc.order.slice();
  st.writerHooks.push(() => e.reorderScene(ids[1], 0));
  const result = await e.captureCurrentScene();
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(e.session.doc.order, [ids[1], ids[0], result.sceneId]);
  assert.ok(M.validateDocument(e.session.doc).ok);
});


test('23. real row pointer handlers: hold picks up a Scene, diagonal drop moves several places, cancellation preserves order', async () => {
  const { e } = freshEngine();
  for (let i = 0; i < 5; i++) await e.captureCurrentScene();
  const ids = e.session.doc.order.slice();
  const classes = () => { const values = new Set(); return { add: (...v) => v.forEach(x => values.add(x)), remove: (...v) => v.forEach(x => values.delete(x)), contains: v => values.has(v) }; };
  const rows = ids.map((id, i) => {
    const handlers = {};
    const card = { style: {}, isConnected: true, setPointerCapture() {}, releasePointerCapture() {}, addEventListener(name, fn) { handlers[name] = fn; } };
    return { dataset: { sceneId: id, sceneIndex: String(i) }, classList: classes(), offsetHeight: 80, card, handlers,
      getBoundingClientRect: () => ({ top: 100 + i * 80, height: 80 }), querySelector: () => card };
  });
  e.weaveEl = { querySelector: () => null, querySelectorAll: () => rows };
  const viewport = { scrollTop: 0, getBoundingClientRect: () => ({ top: 90, bottom: 600 }) };
  e.bindSceneRowGestures(viewport);
  const event = (type, x, y) => ({ type, clientX: x, clientY: y, pointerId: 7, button: 0, target: { closest: () => null }, preventDefault() {} });
  timers = [];
  const last = rows[4];
  last.handlers.pointerdown(event('pointerdown', 20, 460));
  timers.find(t => t.ms === 220).fn();
  assert.ok(last.classList.contains('is-reordering'), 'hold visibly picks up the Scene');
  last.handlers.pointermove(event('pointermove', 380, 120)); // mostly horizontal: must reorder, never delete after hold
  assert.ok(rows[0].classList.contains('is-drop-target'), 'insertion before first Scene');
  last.handlers.pointerup(event('pointerup', 380, 120));
  assert.deepStrictEqual(e.session.doc.order, [ids[4], ...ids.slice(0, 4)]);
  assert.strictEqual(e.session.doc.order.length, 5, 'held diagonal drag cannot trigger delete');
  assert.ok(!last.classList.contains('is-reordering'));
  const before = e.session.doc.order.slice();
  timers = [];
  rows[1].handlers.pointerdown(event('pointerdown', 20, 220));
  timers.find(t => t.ms === 220).fn();
  rows[1].handlers.pointermove(event('pointermove', 20, 550));
  rows[1].handlers.pointercancel(event('pointercancel', 20, 550));
  assert.deepStrictEqual(e.session.doc.order, before, 'cancelled drop changes nothing');
  assert.ok(rows.every(row => !row.classList.contains('is-drop-target')));
});

test('24. held card stays visible and no panel text selection (Matt native report): reordering row lifts its overflow clip above neighbours; panel refuses selectstart except in editable fields', () => {
  // The Loom row wrap clips its card (overflow hidden) so the horizontal swipe reveal works. A held
  // card is translated out of that box, so the clip must be lifted while .is-reordering or the card
  // is cut off and "disappears behind" other rows — the native symptom Matt reported.
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'weave.css'), 'utf8');
  const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null; };
  const base = rule('.weave-loom-row-wrap'); assert.ok(base && /overflow:\s*hidden/.test(base), 'row wrap still clips for the swipe reveal');
  const held = rule('.weave-loom-row-wrap.is-reordering'); assert.ok(held && /overflow:\s*visible/.test(held) && /z-index:\s*[1-9]/.test(held), 'held row: overflow visible and stacked above siblings');
  assert.ok(css.indexOf('.weave-loom-row-wrap {') < css.indexOf('.weave-loom-row-wrap.is-reordering {'), 'held rule wins the cascade');
  assert.ok(/\.weave-loom-row-wrap\.is-reordering \.weave-loom-row-under\s*\{[^}]*outline:[^}]*dashed/.test(css), 'placeholder outline at the original position');
  const panel = rule('.weave-panel, .weave-panel *'); assert.ok(panel && /-webkit-user-select:\s*none/.test(panel) && /[^-]user-select:\s*none/.test(panel), 'BUILD and PLAY panel content is unselectable, WebKit included');
  assert.ok(/\.weave-panel input, \.weave-panel textarea, \.weave-panel \[contenteditable\][^{]*\{[^}]*user-select:\s*text/.test(css), 'editable fields keep selection');
  // selectstart guard through the real attach(): background press refused, editable press allowed.
  const { e } = freshEngine();
  const listeners = {};
  const el = { addEventListener: (n, fn) => { listeners[n] = fn; }, classList: { toggle() {}, add() {}, remove() {} }, querySelector: () => null, querySelectorAll: () => [], style: { setProperty() {} } };
  e.wireQuietPanels = () => {}; e.startLoop = () => {};
  e.attach(el, el);
  assert.strictEqual(typeof listeners.selectstart, 'function');
  let prevented = 0; const ev = target => ({ target, preventDefault: () => prevented++ });
  listeners.selectstart(ev({ nodeType: 3, parentElement: { closest: () => null } })); // text node inside a Scene label
  listeners.selectstart(ev({ nodeType: 1, closest: () => null })); // sheet background
  assert.strictEqual(prevented, 2, 'selection refused on labels and background');
  listeners.selectstart(ev({ nodeType: 1, closest: sel => (sel.includes('input') ? {} : null) }));
  assert.strictEqual(prevented, 2, 'selection allowed inside an editable field');
});

// ---- the two-Scene instrument (5 Oct 2026, Matt's first priority) ----
function gainMock(st) {
  st.masterVolumeSlider = { value: '0.8' };
  st.masterGain = { gain: { value: 0.8 } };
  return st;
}
const motionOf = (t) => t.motionPath.map(p => [p.x, p.y]);

test('25. two Scenes: Play recalls State 1 (sound, strip, XYZ, its own motion), JUMP lands on State 2 whole, Stop rewinds, the test repeats without rebuilding', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setPlaylist([fileB], 0);
  // State 1: T1 front-left with a recorded loop, gain -6, T2 muted
  st.tracks[0].setPosition(0.2, 0.8, 0); st.tracks[0].motionPath = [{ t: 0, x: 0.2, y: 0.8, z: 0 }, { t: 2, x: 0.4, y: 0.6, z: 10 }]; st.tracks[0].isPlayingMotion = true;
  st.tracks[0].stripGainDb = -6; st.tracks[1].isMuted = true; st.tracks[1].eqValues = { low: 3, mid: 0, high: -2 };
  await e.captureCurrentScene();
  // State 2: T1 far right, no motion, gain 0, T2 unmuted, deeper
  st.tracks[0].motionPath = []; st.tracks[0].isPlayingMotion = false; st.tracks[0].setPosition(0.9, 0.3, 30); st.tracks[0].stripGainDb = 0;
  st.tracks[1].isMuted = false; st.tracks[1].eqValues = { low: 0, mid: 0, high: 0 }; st.tracks[1].setPosition(0.5, 0.5, 20);
  await e.captureCurrentScene();
  assert.strictEqual(e.scenes.length, 2);
  e.transitionMode = 'jump';
  // Play from stop: the instrument is put into State 1 before the first tick
  st.isPlaying = true; e._wasPlaying = false; e._onTransportStarted(); e._wasPlaying = true;
  assert.strictEqual(e.playingIndex, 0);
  assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y, st.tracks[0].z], [0.2, 0.8, 0], 'T1 at Scene 01\'s motion start');
  assert.deepStrictEqual(motionOf(st.tracks[0]), [[0.2, 0.8], [0.4, 0.6]]); assert.strictEqual(st.tracks[0].isPlayingMotion, true);
  assert.strictEqual(st.tracks[0].stripGainDb, -6); assert.strictEqual(st.tracks[1].isMuted, true); assert.deepStrictEqual(st.tracks[1].eqValues, { low: 3, mid: 0, high: -2 });
  assert.ok(e.fadeLevel < 1, 'one-bar entrance fade starts low');
  // run Scene 01 to its end (16 bars default at 120 bpm = 2 s per bar)
  assert.strictEqual(e.scenes[0].bars, 16);
  e.onTransportTick(true, 120, 2 * 15.5); assert.strictEqual(e.playingIndex, 0); assert.strictEqual(e.fadeLevel, 1);
  e.onTransportTick(true, 120, 2 * 1);
  assert.strictEqual(e.playingIndex, 1, 'arrived at Scene 02');
  assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y, st.tracks[0].z], [0.9, 0.3, 30], 'T1 at State 2');
  assert.strictEqual(st.tracks[0].isPlayingMotion, false, 'Scene 02 has no motion for T1: the loop is off');
  assert.strictEqual(st.tracks[0].stripGainDb, 0); assert.strictEqual(st.tracks[1].isMuted, false); assert.deepStrictEqual([st.tracks[1].x, st.tracks[1].z], [0.5, 20]);
  assert.strictEqual(st.tracks[0].audioBuffer.decodedOf, 'a.wav', 'same sounds: nothing reloaded');
  // Stop: rewind; Play again: State 1 again, no rebuild
  st.isPlaying = false; st.transportPosition = 0; e._onTransportStopped();
  assert.strictEqual(e.currentBarInScene, 0); assert.strictEqual(e.playingIndex, 0); assert.strictEqual(e.fadeLevel, 1);
  st.isPlaying = true; e._onTransportStarted();
  assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.2, 0.8]); assert.strictEqual(st.tracks[0].isPlayingMotion, true); assert.strictEqual(st.tracks[1].isMuted, true);
  // Pause/resume keeps the place
  e.onTransportTick(true, 120, 2 * 10); st.isPlaying = false; st.transportPosition = 20; e._onTransportStopped();
  assert.ok(Math.abs(e.currentBarInScene - 10) < 1e-9); st.isPlaying = true; e._onTransportStarted(); assert.ok(Math.abs(e.currentBarInScene - 10) < 1e-9);
});

test('26. MORPH: XYZ and gain glide over the last bars, the outgoing motion is frozen, a changed sample switches when the glide starts, the destination motion starts on arrival', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); st.tracks[0].stripGainDb = -12;
  st.tracks[0].motionPath = [{ t: 0, x: 0.2, y: 0.2, z: 0 }, { t: 1, x: 0.3, y: 0.3, z: 0 }]; st.tracks[0].isPlayingMotion = true;
  await e.captureCurrentScene();                                     // Scene 01: a.wav, loop, -12 dB
  st.tracks[0].setPlaylist([fileB], 0); st.tracks[0].motionPath = [{ t: 0, x: 0.8, y: 0.8, z: 0 }, { t: 1, x: 0.7, y: 0.7, z: 0 }]; st.tracks[0].setPosition(0.8, 0.8, 0); st.tracks[0].stripGainDb = 0;
  await e.captureCurrentScene();                                     // Scene 02: b.wav, other loop, 0 dB
  const bufA = e._bufferCache.get(e._audioAssetOf(state(e, e.scenes[0], 0))), bufB = e._bufferCache.get(e._audioAssetOf(state(e, e.scenes[1], 0)));
  assert.ok(bufA && bufB && bufA !== bufB, 'both captured sounds are cached');
  e.transitionMode = 'morph'; e.transitionLengthBars = 8; e.transitionCurve = 'lin';
  st.isPlaying = true; e._onTransportStarted();
  assert.strictEqual(st.tracks[0].audioBuffer, bufA); assert.strictEqual(st.tracks[0].isPlayingMotion, true); assert.strictEqual(st.tracks[0].stripGainDb, -12);
  st.tracks[0].moves = [];
  e.onTransportTick(true, 120, 2 * 8);                               // 8 bars before the end: glide starts
  assert.ok(e.glide && e.glide.arrangement, 'morph glide armed');
  assert.strictEqual(st.tracks[0].audioBuffer, bufB, 'b.wav switched in when the glide started');
  assert.strictEqual(st.tracks[0].isPlayingMotion, false, 'Scene 01\'s loop frozen for the glide');
  e.onTransportTick(true, 120, 2 * 4); e.updateGlide(NOW);           // halfway
  assert.ok(Math.abs(st.tracks[0].x - 0.5) < 0.02 && Math.abs(st.tracks[0].stripGainDb + 6) < 0.5, 'XYZ and gain halfway: ' + st.tracks[0].x + ' ' + st.tracks[0].stripGainDb);
  e.onTransportTick(true, 120, 2 * 4.01);                            // arrival
  assert.strictEqual(e.playingIndex, 1);
  assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.8, 0.8]); assert.strictEqual(st.tracks[0].stripGainDb, 0);
  assert.deepStrictEqual(motionOf(st.tracks[0]), [[0.8, 0.8], [0.7, 0.7]]); assert.strictEqual(st.tracks[0].isPlayingMotion, true); assert.strictEqual(st.tracks[0].motionAccumulatedTime, 0);
  // wrap back to Scene 01: a.wav returns, its loop restarts
  e.onTransportTick(true, 120, 2 * 17);
  assert.strictEqual(e.playingIndex, 0); assert.strictEqual(st.tracks[0].audioBuffer, bufA); assert.deepStrictEqual(motionOf(st.tracks[0]), [[0.2, 0.2], [0.3, 0.3]]);
});

test('27. FADE is a crossfade now: no dip to silence, XYZ/levels glide over the last L bars, a changed sample crossfades over the window; HOLD loops without transitioning; the demo set never plays', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); await e.captureCurrentScene();
  st.tracks[0].setPlaylist([fileB], 0); st.tracks[0].setPosition(0.8, 0.8, 0); await e.captureCurrentScene();
  const bufB = e._bufferCache.get(e._audioAssetOf(state(e, e.scenes[1], 0)));
  e.transitionMode = 'fade'; e.transitionLengthBars = 8; e.transitionCurve = 'lin';
  st.isPlaying = true; e._onTransportStarted();
  e.onTransportTick(true, 120, 2 * 6); assert.strictEqual(e.fadeLevel, 1); assert.strictEqual(st.masterGain.gain.value, 0.8);
  let swapped = null; const origSwap = e._swapBuffer.bind(e); e._swapBuffer = (k, buf, ts, id, ms) => { swapped = { k, ms }; return origSwap(k, buf, ts, id, ms); };
  e.onTransportTick(true, 120, 2 * 2.001);                           // 8 bars before the end: the crossfade starts
  assert.ok(e.glide && e.glide.arrangement, 'crossfade glide armed');
  assert.ok(swapped && swapped.k === 0 && Math.abs(swapped.ms - 16000) < 50, 'b.wav crossfades over the 8-bar window: ' + JSON.stringify(swapped));
  assert.strictEqual(st.tracks[0].audioBuffer, bufB);
  e.onTransportTick(true, 120, 2 * 4); e.updateGlide(NOW);           // half way
  assert.strictEqual(e.fadeLevel, 1, 'master level never dips'); assert.strictEqual(st.masterGain.gain.value, 0.8);
  assert.ok(Math.abs(st.tracks[0].x - 0.5) < 0.02, 'XYZ half way: ' + st.tracks[0].x);
  e.onTransportTick(true, 120, 2 * 4.01);
  assert.strictEqual(e.playingIndex, 1); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.8, 0.8], 'arrived whole'); assert.strictEqual(e.fadeLevel, 1);
  // HOLD loops the Scene and never starts a transition
  e.isHolding = true; e.onTransportTick(true, 120, 2 * 20); assert.strictEqual(e.playingIndex, 1); assert.strictEqual(e.glide, null); assert.strictEqual(e.fadeLevel, 1);
  e.isHolding = false;
  // Weave OFF keeps the level and the demo set is never applied
  e.setEnabled(false); assert.strictEqual(st.masterGain.gain.value, 0.8);
  const { e: d, st: ds } = freshEngine(); gainMock(ds);
  ds.isPlaying = true; d._onTransportStarted(); d.onTransportTick(true, 120, 1000);
  assert.deepStrictEqual(ds.tracks.map(t => t.moves.length), [0, 0, 0, 0]); assert.strictEqual(ds.masterGain.gain.value, 0.8);
});

test('28. INSERT IN WEAVE + prepare-then-launch: an inserted Scene with a different instrument is PREPARED while Scene 01 keeps playing, then switched on the bar (fade down → install → fade up); a failed preparation leaves Scene 01 playing', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); await e.captureCurrentScene();
  const tiny = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'aether-v31-tiny.json'), 'utf8'));
  const r = await e.insertAetherSession(tiny, 'tiny.aether');
  assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(e.scenes.length, 2); assert.strictEqual(r.index, 1);
  assert.strictEqual(M.validateDocument(e.session.doc).ok, true);
  const ts = state(e, e.scenes[1], 0); const assetId = e._audioAssetOf(ts); assert.ok(assetId && e.session.doc.assets[assetId], 'asset stored');
  assert.strictEqual(state(e, e.scenes[1], 1).source.kind, 'node', 'T2 of the inserted Scene is an AetherNode');
  assert.deepStrictEqual(e._planFor(e.scenes[1].id).slots, ['swap', 'install', 'unsupported', 'same'], 'plan: T1 sound swap, T2 instrument install, T3 live input unsupported, T4 same');
  // a mock host: prepareSession decodes sounds and parses bundles without touching tracks; loadNodeBundle installs
  let prepared = 0, loads = 0; const bundle = { manifest: { id: 'com.aether.test.fixture-pulse', name: 'Fixture Pulse', parameters: [{ id: 'level', default: 0 }, { id: 'steps', type: 'int', default: 1 }] }, dsp_js: '' };
  st.prepareSession = async (session) => { prepared++; await tick(); return session.tracks.map(tr => ({ ...tr, _playlist: [], _decoded: tr.sampleData ? { duration: 1, __mock: true, src: tr.index } : null, _bundle: tr.isCustomNode ? bundle : null })); };
  st.tracks.forEach(t => { t.loadNodeBundle = async (b) => { loads++; t.isCustomNode = true; t.customNodeBundle = b; t.customNodeDSP = { params: {}, setParameter(id, v) { this.params[id] = v; }, stop() {} }; }; t.cleanupSources = () => {}; });
  e.transitionMode = 'jump'; st.isPlaying = true; e._onTransportStarted();
  e.onTransportTick(true, 120, 2 * 17);
  assert.strictEqual(e.playingIndex, 0, 'the inserted Scene is not entered until it is ready: Scene 01 keeps playing');
  assert.ok(e._launch && !e._launch.ready, 'PREPARING the inserted Scene'); assert.strictEqual(e.fadeLevel, 1, 'no dip while preparing');
  for (let i = 0; i < 6; i++) await tick();
  assert.ok(e._launch && e._launch.ready, 'ready: NEXT BAR'); assert.strictEqual(prepared, 1);
  e.onTransportTick(true, 120, toNextBar(e) - 0.5); e._updateFade(); assert.ok(e.fadeLevel < 1 && e.fadeLevel > 0, 'fading down into the bar line: ' + e.fadeLevel);
  e.onTransportTick(true, 120, 0.52);
  assert.strictEqual(e._launch, null, 'fired on the bar line'); assert.strictEqual(e.fadeLevel, 0, 'silent for the switch');
  for (let i = 0; i < 6; i++) await tick();
  assert.strictEqual(e.playingIndex, 1, 'landed on the inserted Scene');
  assert.strictEqual(loads, 1, 'the instrument was installed once'); assert.ok(st.tracks[1].isCustomNode && st.tracks[1].customNodeBundle === bundle, 'T2 runs the prepared bundle');
  assert.deepStrictEqual(st.tracks[1].customNodeDSP.params, { level: 0.5, steps: 4 }, 'captured parameters restored');
  assert.ok(st.tracks[0].audioBuffer && st.tracks[0].audioBuffer.__mock, 'T1 plays the inserted sound'); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.21, 0.87]);
  assert.ok(e._entrance && e._entrance.idx === 1, 'fades up over one bar'); e.onTransportTick(true, 120, 2.1); assert.strictEqual(e.fadeLevel, 1);
  assert.ok(e._slotMatchesScene(1, e.scenes[1].id), 'T2 bound to the inserted Scene');
  // back to Scene 01: T2 must return to silence (captured empty), T1 to a.wav — a plain swap, no preparation
  const plan = e._planFor(e.scenes[0].id); assert.deepStrictEqual(plan.slots, ['swap', 'silence', 'same', 'same'], JSON.stringify(plan.slots));
  // failed preparation: a Scene whose instrument cannot be prepared leaves the current Scene playing and says why
  st.prepareSession = async () => { await tick(); throw new Error('Track 2: Instrument bundle has no supported JavaScript DSP.'); };
  st.tracks[1].isCustomNode = false; st.tracks[1].customNodeBundle = null; st.tracks[1]._weaveBinding = null; e._prepared.delete(e.scenes[1].id);   // force a fresh preparation
  e.selectScene(1); e.playingIndex = 0; assert.strictEqual(e.goNext(), true); assert.ok(e._launch && !e._launch.ready);
  for (let i = 0; i < 6; i++) await tick();
  assert.strictEqual(e._launch, null, 'launch dropped'); assert.strictEqual(e.playingIndex, 0, 'Scene 01 still playing');
  assert.ok(/not ready/.test(st.toasts[st.toasts.length - 1]) && /JavaScript DSP/.test(st.toasts[st.toasts.length - 1]), 'useful error: ' + st.toasts[st.toasts.length - 1]);
});

// ---- PLAY is the live room, BUILD is the quiet room (Matt, 5 Oct) ----
function transportMock(st) {
  gainMock(st);
  st.transportPosition = 0; st.stops = 0; st.plays = 0;
  st.playMaster = () => { st.isPlaying = true; st.plays++; };
  st.stopMaster = () => { st.isPlaying = false; st.transportPosition = 0; st.stops++; };
  return st;
}
// drive the host loop's transport edges the way startLoop does
const edge = (e, st) => { const p = !!st.isPlaying; if (p && !e._wasPlaying) e._onTransportStarted(); if (!p && e._wasPlaying) e._onTransportStopped(); e._wasPlaying = p; };

test('29. BUILD stops the audio; swipe-left AUDITION recalls the Scene and holds on it; swiping again, Stop or PLAY ends it; AUDITION TRANSITION plays A\'s end into B\'s start and stops itself', async () => {
  const { e, st } = freshEngine(); transportMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); await e.captureCurrentScene();
  st.tracks[0].setPosition(0.8, 0.8, 0); await e.captureCurrentScene();
  st.tracks[0].setPosition(0.5, 0.5, 0); await e.captureCurrentScene();
  e.setEnabled(false); e.setEnabled(true); assert.strictEqual(e.mode, 'play', 'WEAVE ON opens PLAY');
  st.playMaster(); edge(e, st); e.onTransportTick(true, 120, 2 * 3);
  e.setMode('build'); edge(e, st); assert.strictEqual(st.isPlaying, false, 'BUILD stops the transport'); assert.strictEqual(st.stops, 1);
  // audition Scene 03 from stopped: the transport starts on it, holding
  assert.strictEqual(e.auditionScene(2), true); edge(e, st);
  assert.strictEqual(st.isPlaying, true); assert.strictEqual(e.playingIndex, 2); assert.strictEqual(e.isHolding, true); assert.strictEqual(e._audition, 2);
  assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.5, 0.5], 'Scene 03 recalled');
  assert.strictEqual(e._entrance, null, 'no entrance fade for an audition');
  e.onTransportTick(true, 120, 2 * 40); assert.strictEqual(e.playingIndex, 2, 'holds (loops) on the auditioned Scene');
  // audition another Scene while playing: switches
  e.auditionScene(0); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.2, 0.2]); assert.strictEqual(e.playingIndex, 0);
  // swipe the same Scene again: stops
  e.auditionScene(0); edge(e, st); assert.strictEqual(st.isPlaying, false); assert.strictEqual(e._audition, null); assert.strictEqual(e.isHolding, false);
  // Stop from the host ends an audition too
  e.auditionScene(1); edge(e, st); st.stopMaster(); edge(e, st); assert.strictEqual(e._audition, null); assert.strictEqual(e.isHolding, false);
  // going to PLAY ends an audition
  e.auditionScene(1); edge(e, st); e.setMode('play'); edge(e, st); assert.strictEqual(st.isPlaying, false); assert.strictEqual(e._audition, null);
  // AUDITION TRANSITION (jump, 1 bar lead / 1 bar tail): starts near the end of 01, lands on 02, stops itself
  e.setMode('build'); e.selectedIndex = 0; e.transitionMode = 'jump';
  assert.strictEqual(e.auditionTransition(), true); edge(e, st);
  assert.strictEqual(e.playingIndex, 0); assert.ok(e.currentBarInScene > 14 && e.currentBarInScene < 16, 'starts ' + e.currentBarInScene);
  e.onTransportTick(true, 120, 2 * 1.6); assert.strictEqual(e.playingIndex, 1, 'landed on 02'); assert.strictEqual(st.isPlaying, true);
  e.onTransportTick(true, 120, 2 * 1.2); edge(e, st); assert.strictEqual(st.isPlaying, false, 'stopped itself after the tail'); assert.strictEqual(e._audition, null);
  // demo set: nothing
  const { e: d, st: ds } = freshEngine(); transportMock(ds); d.setMode('build'); assert.strictEqual(d.auditionScene(0), false); assert.strictEqual(ds.isPlaying, false);
});

test('30. GO NEXT / double-click are quantized launches on the host bar grid: nothing changes until the next bar line; then a one-bar crossfade into the picked Scene regardless of the BUILD transition; the plan resumes after; HOLD release resumes at the end of the pass; rename in BUILD goes through S1', async () => {
  const { e, st } = freshEngine(); transportMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); st.tracks[0].stripGainDb = -12; await e.captureCurrentScene();
  st.tracks[0].setPosition(0.8, 0.8, 0); st.tracks[0].stripGainDb = 0; await e.captureCurrentScene();
  st.tracks[0].setPosition(0.5, 0.5, 0); await e.captureCurrentScene();
  e.setEnabled(false); e.setEnabled(true);
  e.transitionMode = 'fade'; e.transitionLengthBars = 8; e.transitionCurve = 'lin';
  // stopped: double-click starts the transport on that Scene
  assert.strictEqual(e.jumpToScene(2), true); edge(e, st);
  assert.strictEqual(st.isPlaying, true); assert.strictEqual(e.playingIndex, 2); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.5, 0.5]);
  // playing, mid-bar: GO NOW to the picked Scene arms a launch; nothing moves until the bar line
  e.onTransportTick(true, 120, 2 * 2.4);                              // bar 2.4
  e.selectScene(0); assert.strictEqual(e.goNow(), true);
  assert.ok(e._launch && e._launch.ready && e.sceneIndexById(e._launch.sceneId) === 0, 'armed: ready at once (same sounds)');
  assert.ok(Math.abs(e._launch.atTransport - 6) < 1e-6, 'fires on the next host bar line (bar 3 = 6 s): ' + e._launch.atTransport);
  e.onTransportTick(true, 120, 2 * 0.3); assert.strictEqual(e.playingIndex, 2, 'still on 03 before the bar'); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.5, 0.5]);
  e.onTransportTick(true, 120, 2 * 0.31);                             // crosses bar 3
  assert.strictEqual(e.playingIndex, 0, 'launched on the bar line'); assert.strictEqual(e._launch, null);
  assert.ok(e.glide && e.glide.arrangement && e.glide.endsAtBar === 1, 'one-bar crossfade, not the 8-bar BUILD fade');
  assert.ok(e.currentBarInScene < 0.05, 'the launched Scene starts at its bar 0');
  e.onTransportTick(true, 120, 1); e.updateGlide(NOW);                // half a bar in
  assert.ok(Math.abs(st.tracks[0].x - 0.35) < 0.03 && Math.abs(st.tracks[0].stripGainDb + 6) < 0.6, 'half way across: ' + st.tracks[0].x + ' ' + st.tracks[0].stripGainDb);
  e.onTransportTick(true, 120, 1.02); e.updateGlide(NOW);
  assert.strictEqual(e.glide, null); assert.deepStrictEqual([st.tracks[0].x, st.tracks[0].y], [0.2, 0.2]); assert.strictEqual(st.tracks[0].stripGainDb, -12);
  assert.strictEqual(e.fadeLevel, 1, 'no silence anywhere');
  // untouched from here: the plan resumes — Scene 01's programmed 8-bar FADE into 02 starts 8 bars before its end
  e.onTransportTick(true, 120, 2 * (16 - 8 - 1.02 - 0.5)); assert.strictEqual(e.glide, null, 'not yet');
  e.onTransportTick(true, 120, 2 * 0.6); assert.ok(e.glide && e.glide.endsAtBar === 16, 'programmed transition running again');
  e.onTransportTick(true, 120, 2 * 9); assert.strictEqual(e.playingIndex, 1, 'arrived at 02 by the plan');
  // HOLD: loops; GO NOW cancels a hold; releasing HOLD lets the plan resume at the end of the pass
  e.toggleHold(); assert.strictEqual(e.isHolding, true); e.onTransportTick(true, 120, 2 * 40); assert.strictEqual(e.playingIndex, 1); assert.strictEqual(e.glide, null);
  e.toggleHold(); assert.strictEqual(e.isHolding, false);
  const bar = e.currentBarInScene; e.onTransportTick(true, 120, 2 * (16 - bar - 7.9)); assert.ok(e.glide, 'plan resumed: transition into 03 armed'); e.onTransportTick(true, 120, 2 * 8); assert.strictEqual(e.playingIndex, 2);
  e.toggleHold(); e.selectScene(0); e.goNow(); assert.strictEqual(e.isHolding, false, 'GO NOW cancels HOLD'); assert.ok(e._launch);
  // double-click while playing = the same launch
  e.cancelLaunch(); e.jumpToScene(1); assert.ok(e._launch && e.sceneIndexById(e._launch.sceneId) === 1);
  // BUILD only for rename; PLAY double-click is PLAY only
  e.setMode('build'); edge(e, st); assert.strictEqual(e.jumpToScene(0), false); assert.strictEqual(e._launch, null, 'BUILD clears an armed launch');
  assert.strictEqual(e.renameScene(e.scenes[0].id, '  Opening  '), true); assert.strictEqual(e.scenes[0].name, 'Opening'); assert.strictEqual(e.session.doc.scenes[e.scenes[0].id].name, 'Opening');
  assert.strictEqual(e.renameScene(e.scenes[0].id, '   '), false); assert.strictEqual(M.validateDocument(e.session.doc).ok, true);
});

// ---- Codex r6 review: the three lifecycle findings, as regressions ----
const realStopNodeOnly = (() => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
  const body = html.split('  stopNodeOnly(opts = {}) {')[1].split('\n  stop() {')[0].replace(/}\s*$/, '');
  return new Function('opts = {}', body);
})();
const fakeSource = () => ({ stops: [], connections: [], connect(x) { this.connections.push(x); }, disconnect() { this.connections = []; }, stop(at) { this.stops.push(at); } });
const fakeCtx = (t0) => ({ currentTime: t0, createGain: () => ({ gain: { setValueAtTime() {}, setValueCurveAtTime() {} }, connect() {}, disconnect() {} }) });

test('31. (Codex r6 P1) Stop/Pause own the outgoing crossfade source: after a crossfade starts, Stop ends the old sound at once; a newer change on the slot ends it too', async () => {
  const { e, st } = freshEngine();
  st.tracks[0].setPlaylist([fileA], 0); await e.captureCurrentScene();
  st.tracks[0].setPlaylist([fileB], 0); await e.captureCurrentScene();
  const t = st.tracks[0];
  const old = fakeSource(), incoming = fakeSource();
  Object.assign(t, { bufferSource: old, eqLowNode: {}, _stopNodeTape() {}, _stopInsertDry() {}, stopNodeOnly: realStopNodeOnly, play() { this.bufferSource = incoming; incoming.connect(this.eqLowNode); }, updatePlaylistUI() {} });
  st.isPlaying = true; st.audioCtx = fakeCtx(10); st.transportPosition = 0;
  const ts = state(e, e.scenes[0], 0);
  e._swapBuffer(0, e._bufferCache.get(e._audioAssetOf(ts)), ts, e.scenes[0].id, 8000);
  assert.deepStrictEqual(old.stops, [18.05], 'old source scheduled to stop at the end of the fade'); assert.ok(old.connections.length, 'still connected while fading');
  assert.strictEqual(e._fadeSources.size, 1, 'the Weave tracks the outgoing source');
  // Stop (the host turns isPlaying off; the Weave sees the edge)
  st.isPlaying = false; e._wasPlaying = true; e._onTransportStopped();
  assert.ok(old.stops.includes(0), 'outgoing source stopped now'); assert.strictEqual(old.connections.length, 0, 'disconnected'); assert.strictEqual(e._fadeSources.size, 0);
  // Pause (transportPosition > 0) stops it as well
  const old2 = fakeSource(); t.bufferSource = old2; st.isPlaying = true; e._wasPlaying = false;
  e._swapBuffer(0, e._bufferCache.get(e._audioAssetOf(ts)), ts, e.scenes[0].id, 8000);
  st.isPlaying = false; st.transportPosition = 12; e._wasPlaying = true; e._onTransportStopped();
  assert.ok(old2.stops.includes(0) && old2.connections.length === 0, 'Pause owns it too');
  // a newer change on the same slot (another crossfade) ends the previous outgoing source immediately
  const old3 = fakeSource(); t.bufferSource = old3; st.isPlaying = true; st.transportPosition = 0;
  e._swapBuffer(0, e._bufferCache.get(e._audioAssetOf(ts)), ts, e.scenes[0].id, 8000);
  const old4 = t.bufferSource; const ts1 = state(e, e.scenes[1], 0);
  e._swapBuffer(0, e._bufferCache.get(e._audioAssetOf(ts1)), ts1, e.scenes[1].id, 8000);
  assert.ok(old3.stops.includes(0) && old3.connections.length === 0, 'rapid successive launches: the first outgoing source is gone');
  assert.strictEqual(e._fadeSources.size, 1, 'only the latest outgoing source remains tracked');
  // WEAVE OFF ends everything outgoing
  e.setEnabled(false); assert.strictEqual(e._fadeSources.size, 0); assert.ok(old4.stops.includes(0));
});

test('32. (Codex r6 P1) a pending decode or preparation never overwrites the instrument after WEAVE OFF, a cancelled/replaced launch, or a newer source change on the slot', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0); await e.captureCurrentScene();
  const tiny = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'aether-v31-tiny.json'), 'utf8'));
  await e.insertAetherSession(tiny, 'tiny.aether');
  // 1. decode in flight, WEAVE OFF before it resolves
  let resolve; st.audioCtx = { decodeAudioData: () => new Promise(r => { resolve = r; }) };
  let swaps = 0; const origSwap = e._swapBuffer.bind(e); e._swapBuffer = (...a) => { swaps++; return origSwap(...a); };
  e.playingIndex = 1; st.isPlaying = true;
  const ts = state(e, e.scenes[1], 0);
  assert.strictEqual(e._applySourceToSlot(0, ts, e.scenes[1].id, 0, 0), 'pending');
  e.setEnabled(false); resolve({ duration: 1, __mock: true }); for (let i = 0; i < 4; i++) await tick();
  assert.strictEqual(swaps, 0, 'stale decode discarded after WEAVE OFF'); assert.strictEqual(st.tracks[0].audioBuffer.decodedOf, 'a.wav', 'instrument untouched');
  // 2. decode in flight, the user replaces the slot's source meanwhile
  e.setEnabled(true); e.playingIndex = 1; st.isPlaying = true; e._bufferCache.delete(e._audioAssetOf(ts)); e._decodePending.clear();
  assert.strictEqual(e._applySourceToSlot(0, ts, e.scenes[1].id, 0, 0), 'pending');
  st.tracks[0].setPlaylist([fileB], 0); resolve({ duration: 1, __mock: true }); for (let i = 0; i < 4; i++) await tick();
  assert.strictEqual(swaps, 0, 'stale decode discarded after a newer source change'); assert.strictEqual(st.tracks[0].audioBuffer.decodedOf, 'b.wav');
  // 3. preparation in flight for a launch that is replaced by another destination: the first never takes over
  let release; st.prepareSession = () => new Promise(r => { release = r; });
  st.tracks.forEach(t => { t.loadNodeBundle = async (b) => { t.isCustomNode = true; t.customNodeBundle = b; t.customNodeDSP = { params: {}, setParameter(id, v) { this.params[id] = v; }, stop() {} }; }; t.cleanupSources = () => {}; });
  st.tracks[0].setPosition(0.5, 0.5, 0); await e.captureCurrentScene();   // Scene 03: same sounds as live
  e.playingIndex = 0; e.selectScene(1); assert.strictEqual(e.goNext(), true); const first = e._launch; assert.ok(first && !first.ready, 'PREPARING 02');
  e.selectScene(2); assert.strictEqual(e.goNext(), true); assert.ok(e._launch !== first && e._launch.ready, 'replaced by 03, ready at once');
  release([{ index: 1, isCustomNode: true, _bundle: { manifest: {}, dsp_js: '' }, _decoded: null, _playlist: [], customNodeParams: {} }]); for (let i = 0; i < 4; i++) await tick();
  assert.ok(e._launch && e.sceneIndexById(e._launch.sceneId) === 2, 'the abandoned preparation did not arm 02'); assert.ok(!st.tracks[1].isCustomNode, 'and installed nothing');
  // 4. preparation in flight, WEAVE OFF: nothing installs
  e.cancelLaunch(); e.selectScene(1); e._prepared.delete(e.scenes[1].id); e.goNext(); assert.ok(e._launch && !e._launch.ready);
  e.setEnabled(false); release([{ index: 1, isCustomNode: true, _bundle: { manifest: {}, dsp_js: '' }, _decoded: null, _playlist: [], customNodeParams: {} }]); for (let i = 0; i < 4; i++) await tick();
  assert.strictEqual(e._launch, null); assert.ok(!st.tracks[1].isCustomNode, 'WEAVE OFF: nothing installed');
});

test('33. (Codex r6 P2) a captured empty slot recalls silence: the previous sound is stopped and unloaded (fading out under FADE), not kept', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[1].setPlaylist([fileB], 0); await e.captureCurrentScene();   // Scene 01: T1 a, T2 b
  st.tracks[1].clear(); await e.captureCurrentScene();                                                      // Scene 02: T2 empty
  st.tracks[1].setPlaylist([fileB], 0);                                                                     // live T2 sounds again
  const t = st.tracks[1]; let stops = 0; t.stopNodeOnly = () => { stops++; };
  assert.deepStrictEqual(e._planFor(e.scenes[1].id).slots[1], 'silence');
  st.isPlaying = true; e.playingIndex = 0;
  const r = e._applySourceToSlot(1, state(e, e.scenes[1], 1), e.scenes[1].id, 0, 0);
  assert.strictEqual(r, 'silenced'); assert.strictEqual(stops, 1); assert.strictEqual(t.audioBuffer, null); assert.strictEqual(t.isLoaded, false);
  assert.ok(e._slotMatchesScene(1, e.scenes[1].id), 'the silent slot is bound to Scene 02');
  // under FADE the outgoing sound ramps out through a tracked gain, and Stop owns it
  t.setPlaylist([fileB], 0); const old = fakeSource(); Object.assign(t, { bufferSource: old, eqLowNode: {} }); st.audioCtx = fakeCtx(5);
  e._applySourceToSlot(1, state(e, e.scenes[1], 1), e.scenes[1].id, 4000, 0);
  assert.deepStrictEqual(old.stops, [9.05]); assert.strictEqual(e._fadeSources.size, 1); assert.strictEqual(t.audioBuffer, null);
  st.isPlaying = false; e._wasPlaying = true; e._onTransportStopped(); assert.ok(old.stops.includes(0) && old.connections.length === 0);
  // a whole-state recall of Scene 02 through the arrangement does the same
  t.setPlaylist([fileB], 0); st.isPlaying = true; st.transportPosition = 0; e.transitionMode = 'jump'; e._onTransportStarted(); e.onTransportTick(true, 120, 2 * 16.5);
  assert.strictEqual(e.playingIndex, 1); assert.strictEqual(t.audioBuffer, null, 'T2 silent on Scene 02'); assert.strictEqual(st.tracks[0].audioBuffer.decodedOf, 'a.wav', 'T1 still plays');
});

test('34. compatible sound sets: the same AetherNode with different settings is reused — no reload; continuous settings glide, discrete ones (int/bool/options/pitch) switch at the start; every captured setting is restored on arrival; GO NEXT is ready at once', async () => {
  const { e, st } = freshEngine(); gainMock(st);
  const t = st.tracks[1];
  t.setNode(ZIP, { level: 0.2, cutoff: 200, steps: 4, pitch: 0, mode: 1, on: 1 });
  t.customNodeBundle.manifest.parameters = [{ id: 'level', default: 0 }, { id: 'cutoff', unit: 'Hz', default: 100 }, { id: 'steps', type: 'int', default: 1 }, { id: 'pitch', type: 'int', unit: 'st', default: 0 }, { id: 'mode', options: ['a', 'b', 'c'], default: 0 }, { id: 'on', type: 'bool', default: 0 }];
  t.customNodeDSP.setParameter = function (id, v) { this.params[id] = v; };
  st.tracks[0].setPlaylist([fileA], 0); st.tracks[0].setPosition(0.2, 0.2, 0);
  await e.captureCurrentScene();                                                     // Scene 01
  Object.assign(t.customNodeParams, { level: 0.8, cutoff: 2000, steps: 8, pitch: 7, mode: 2, on: 0 }); st.tracks[0].setPosition(0.8, 0.8, 0);
  await e.captureCurrentScene();                                                     // Scene 02: same instrument, other settings
  assert.strictEqual(state(e, e.scenes[1], 1).source.kind, 'node'); assert.deepStrictEqual(state(e, e.scenes[1], 1).source.node.params, { level: 0.8, cutoff: 2000, steps: 8, pitch: 7, mode: 2, on: 0 });
  assert.deepStrictEqual(e._planFor(e.scenes[0].id).slots, ['same', 'same', 'same', 'same'], 'same instrument: nothing to prepare');
  // back on Scene 01 settings, then GO NEXT to 02: ready at once, no loads
  let loads = 0; t.loadNodeBundle = async () => { loads++; };
  e.transitionMode = 'fade'; e.transitionLengthBars = 1; e.transitionCurve = 'lin';
  st.isPlaying = true; e._onTransportStarted();
  assert.deepStrictEqual(t.customNodeDSP.params, { level: 0.2, cutoff: 200, steps: 4, pitch: 0, mode: 1, on: 1 }, 'Scene 01 settings restored on Play');
  e.selectScene(1); assert.strictEqual(e.goNext(), true); assert.ok(e._launch && e._launch.ready, 'NEXT BAR straight away');
  e.onTransportTick(true, 120, toNextBar(e));
  assert.strictEqual(e.playingIndex, 1); assert.ok(e.glide && e.glide.np && e.glide.np[1], 'continuous settings glide');
  assert.deepStrictEqual(Object.keys(e.glide.np[1]).sort(), ['cutoff', 'level'], 'only the continuous ones');
  assert.strictEqual(t.customNodeDSP.params.steps, 8); assert.strictEqual(t.customNodeDSP.params.pitch, 7); assert.strictEqual(t.customNodeDSP.params.mode, 2); assert.strictEqual(t.customNodeDSP.params.on, 0);
  e.onTransportTick(true, 120, 1); e.updateGlide(NOW);
  assert.ok(Math.abs(t.customNodeDSP.params.level - 0.5) < 0.02 && Math.abs(t.customNodeDSP.params.cutoff - 1100) < 40, 'half way: ' + t.customNodeDSP.params.level + ' ' + t.customNodeDSP.params.cutoff);
  e.onTransportTick(true, 120, 1.02); e.updateGlide(NOW);
  assert.deepStrictEqual(t.customNodeDSP.params, { level: 0.8, cutoff: 2000, steps: 8, pitch: 7, mode: 2, on: 0 }, 'arrived with every setting');
  assert.strictEqual(loads, 0, 'the instrument was never reloaded'); assert.ok(t.isCustomNode && t.customNodeZipBase64 === ZIP);
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('✔ ' + t.name); }
    catch (e) { failed++; console.log('✘ ' + t.name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
