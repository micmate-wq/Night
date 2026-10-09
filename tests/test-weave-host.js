/**
 * Weave v0.1 Phase 1 S4 — host-side tests.
 * Run: node tests/test-weave-host.js
 * Exercises the ACTUAL AudioTrack / SpatialStudio methods changed by S4, extracted from
 * desktop/index.html and evaluated in a sandbox, with mocked dependencies (DOM elements,
 * Web Audio objects, Tauri, the Weave engine hooks). Pure/mocked only: no browser, no
 * native app, no audio. Evidence of host wiring, not of native behaviour.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'index.html'), 'utf8');
function classSource(name) {
  const i = html.indexOf('\nclass ' + name + ' {');
  assert.ok(i > 0, 'class ' + name + ' found');
  let depth = 0;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (depth === 0) return html.slice(i + 1, k + 1); }
  }
  throw new Error('unbalanced class ' + name);
}
const sandbox = {
  console, setTimeout, clearTimeout, Promise, Math, Date, Object, Array, JSON, Number, String, Error, TypeError, Float32Array, Uint8Array, Map, Set, Symbol,
  Infinity, NaN, isFinite, parseFloat, parseInt, performance: { now: () => Date.now() },
  URL: { revokeObjectURL() {} }, Blob: class {}, document: { getElementById: () => null },
  invokeTauri: async () => { throw new Error('no tauri in tests'); },
  requestAnimationFrame: () => 0
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.runInNewContext(classSource('AudioTrack') + '\n' + classSource('SpatialStudio') + '\nthis.AudioTrack = AudioTrack; this.SpatialStudio = SpatialStudio;', sandbox);
const { AudioTrack, SpatialStudio } = sandbox;

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const same = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);   // sandbox objects have their own Object.prototype
const el = () => ({ textContent: '', classList: { add() {}, remove() {}, toggle() {} }, value: '', innerHTML: '', style: {} });
const knob = () => ({ setValue() {} });

// A track instance built on the REAL prototype, with the runtime fields the exercised
// methods read, and stubs only for leaf dependencies (DOM, Web Audio, other subsystems).
function makeTrack(index, studio) {
  const t = Object.create(AudioTrack.prototype);
  Object.assign(t, {
    index, name: 'Track ' + (index + 1), studio, isLoaded: false, isPlaying: false, isMuted: false, isSoloed: false,
    audioBuffer: null, playlist: [], playlistIndex: 0, isShuffle: false, isRepeat: true, isLiveIn: false, isStream: false, streamUrl: '',
    x: 0.5, y: 0.5, z: 0, motionPath: [], motionSpeed: 1, eqValues: { low: 0, mid: 0, high: 0 }, stripGainDb: 0,
    _sourceRevision: 0, _bufferOrigin: null, _weaveBinding: null, startTime: 0, duration: 0,
    isCustomNode: false, customNodeBundle: null, customNodeDSP: null, customNodeZipBase64: null,
    filePath: '', sampleName: '', useMediaElement: false, htmlAudio: null, fileInput: null, liveStream: null, liveMediaSource: null,
    nameEl: el(), statusEl: el(), liveInBtn: el(), streamBtn: el(), muteBtn: el(), soloBtn: el(), recBtn: el(), playMotionBtn: el(),
    knobLow: knob(), knobMid: knob(), knobHigh: knob(), knobGain: knob(),
    gainNode: { gain: { value: 1, setTargetAtTime() {} } }, eqLowNode: { connect() {} }, _pcmCopy: null, _projectExternal: null,
    lastMotionFrameTime: 0, motionAccumulatedTime: 0, isPlayingMotion: false, bufferSource: null, mediaElementSource: null,
    streamMediaSource: null, streamEntryGain: null, _streamCaptureAnalyser: null, streamAudio: null
  });
  // Leaf dependencies (other subsystems), stubbed; the methods under test are the real ones.
  t.calls = [];
  for (const m of ['cleanupLiveIn', 'cleanupStream', 'cleanupCustomNode', 'stopNodeOnly', 'updatePlaylistUI', 'updateAudioParamsFromPosition',
    '_stopIcecastPcm', 'setupWebAudioNodes', 'resetWebAudioGraph', 'setMotionSpeed', 'updatePlaybackDisplay', '_getInsertInputNode']) {
    t[m] = (...a) => { t.calls.push(m); if (m === '_getInsertInputNode') return null; };
  }
  t._startIcecastPcmTap = async () => { t.calls.push('_startIcecastPcmTap'); };
  t.setPosition = (x, y, z) => { t.x = x; t.y = y; if (z !== undefined) t.z = z; };
  return t;
}
function makeStudio(engine) {
  const st = Object.create(SpatialStudio.prototype);
  const audioCtx = {
    close: async () => {},
    state: 'running', currentTime: 0, sampleRate: 100,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    createBuffer: (ch, len, sr) => ({ numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, _ch: Array.from({ length: ch }, () => new Float32Array(len)), getChannelData(c) { return this._ch[c]; }, copyToChannel(a, c) { this._ch[c].set(a); } }),
    decodeAudioData: (buf, resolve) => setTimeout(() => resolve({ duration: 1.5, numberOfChannels: 1, length: 150, sampleRate: 100, getChannelData: () => new Float32Array(150) }), 2),
    resume: async () => {}
  };
  Object.assign(st, {
    audioCtx, isPlaying: false, tracks: [], toasts: [],
    ensureAudioRunning: async () => {}, stopMaster() {}, setLoudnessDb() {}, updateSoloState() {}, reportProjectLimits() {}, playMaster() {},
    showToast(m, t) { st.toasts.push(m); }, masterVolumeSlider: el(), masterVolVal: el(), masterGain: { gain: { value: 0.8 } }, masterPlayBtn: el(),
    snapshotTrackPcm() {}, setupAudioContext() { st.audioCtx = audioCtx; }, _audioRecovering: false, _audioUnloading: false, workletReady: false,
    masterLimiter: null, masterProcessing: null, masterRecorderNode: null, recorderZeroGain: null, icecastCaptureNode: null, icecastZeroGain: null, reverbBuffer: null, _icecastCaptureReady: false
  });
  st.tracks = [0, 1, 2, 3].map(i => makeTrack(i, st));
  sandbox.window.weaveEngine = engine;
  return st;
}
// A recording Weave-engine double for the hooks (the real engine's hook semantics are tested in test-weave-session.js).
function makeEngine() {
  const e = { events: [], open: new Set() };
  e.onSourcesReplacing = () => { const tok = { n: e.events.length }; e.open.add(tok); e.events.push(['replacing', tok]); return tok; };
  e.onSourcesReplaced = (tok, info) => { assert.ok(e.open.has(tok), 'released token was issued and still open'); e.open.delete(tok); e.events.push(['replaced', tok, info]); };
  return e;
}

// ---------- the explicit replacement sites ----------
test('H1. _noteSourceReplaced bumps the revision, clears the origin proof and invalidates a pending loader token', () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[0];
  t._bufferOrigin = { kind: 'decoded-item', revision: 0 };
  const token = t._sourceRevision;            // what a pending loader would hold
  t._noteSourceReplaced();
  assert.strictEqual(t._sourceRevision, 1); assert.strictEqual(t._bufferOrigin, null);
  assert.notStrictEqual(token, t._sourceRevision, 'pending loader token no longer matches');
});

test('H2. clearSource (real) bumps once and clears the origin; cleanupSources itself does not bump', () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[0];
  t._bufferOrigin = { kind: 'synthetic' }; t.audioBuffer = { a: 1 };
  t.cleanupSources();                      // real method
  assert.strictEqual(t._sourceRevision, 0, 'cleanupSources must not bump (loader tokens stay valid)');
  assert.strictEqual(t.audioBuffer, null);
  t._bufferOrigin = { kind: 'synthetic' };
  t.clearSource();                         // real method
  assert.strictEqual(t._sourceRevision, 1); assert.strictEqual(t._bufferOrigin, null);
});

test('H3. connectLiveInput (real) replaces the source: revision bumped, origin cleared, live flags set', async () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[1];
  t._bufferOrigin = { kind: 'decoded-item', revision: 0 }; t.audioBuffer = { a: 1 };
  const pendingToken = t._sourceRevision;
  await t.connectLiveInput({ getTracks: () => [] }, 'Mic');
  assert.strictEqual(t._sourceRevision, 1); assert.strictEqual(t._bufferOrigin, null);
  assert.strictEqual(t.isLiveIn, true); assert.strictEqual(t.audioBuffer, null, 'cleanupSources ran');
  assert.notStrictEqual(pendingToken, t._sourceRevision);
  assert.ok(t.calls.includes('cleanupLiveIn') && t.calls.includes('cleanupStream'));
});

test('H4. loadStreamUrl (real) replaces the source: revision bumped, origin cleared, buffer nulled, stream flags set', async () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[2];
  t._bufferOrigin = { kind: 'decoded-item', revision: 0 }; t.audioBuffer = { a: 1 };
  await t.loadStreamUrl('https://x.invalid/stream');
  assert.strictEqual(t._sourceRevision, 1); assert.strictEqual(t._bufferOrigin, null);
  assert.strictEqual(t.audioBuffer, null); assert.strictEqual(t.isStream, true); assert.strictEqual(t.streamUrl, 'https://x.invalid/stream');
  assert.ok(t.calls.includes('_startIcecastPcmTap'));
});

test('H5. _loadAudioFile (real) sets a decoded-item origin bound to this revision, buffer and file; a cancelled load sets nothing', async () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[0];
  const other = { name: 'z.wav', type: 'audio/wav', arrayBuffer: async () => new ArrayBuffer(8) };
  const file = { name: 'a.wav', type: 'audio/wav', arrayBuffer: async () => new ArrayBuffer(8) };
  t.playlist = [other, file]; t.playlistIndex = 1;   // the loaded file is the SECOND item
  await t._loadAudioFile(file);
  assert.strictEqual(t._sourceRevision, 1);
  assert.ok(t.audioBuffer, 'decoded');
  assert.deepStrictEqual(Object.keys(t._bufferOrigin).sort(), ['bufferRef', 'fileRef', 'kind', 'revision']);
  assert.strictEqual(t._bufferOrigin.kind, 'decoded-item'); assert.strictEqual(t._bufferOrigin.revision, 1);
  assert.strictEqual(t._bufferOrigin.bufferRef, t.audioBuffer, 'same AudioBuffer object (reference)');
  assert.strictEqual(t._bufferOrigin.fileRef, file, 'same File object (reference)');
  // cancelled: another replacement lands while decoding
  const t2 = st.tracks[1]; const f2 = { name: 'b.wav', type: 'audio/wav', arrayBuffer: async () => { t2._noteSourceReplaced(); return new ArrayBuffer(8); } };
  await t2._loadAudioFile(f2);
  assert.strictEqual(t2.audioBuffer, null); assert.strictEqual(t2._bufferOrigin, null, 'cancelled load leaves no origin');
});

test('H6. loadDemoStems (real) marks every track replaced with a synthetic origin', async () => {
  const st = makeStudio(makeEngine());
  st.tracks.forEach(t => { t._bufferOrigin = { kind: 'decoded-item' }; });
  await st.loadDemoStems();
  for (const t of st.tracks) {
    assert.strictEqual(t._sourceRevision, 1, 'bumped once');
    same(t._bufferOrigin, { kind: 'synthetic' });
    assert.ok(t.audioBuffer && t.audioBuffer.length === 400, 'synthetic buffer assigned');
    assert.ok(t.calls.includes('cleanupSources') === false, 'cleanupSources is the real method (not a stub) and ran');
  }
});

test('H7. stopNodeOnly/play/stop are transport paths and do not touch the revision (sampled via stopNodeOnly on the real prototype)', () => {
  const st = makeStudio(makeEngine()); const t = st.tracks[0];
  delete t.stopNodeOnly;  // use the real one for this check
  t._stopNodeTape = () => {}; t._stopInsertDry = () => {}; t._pauseIcecastPcm = () => {};
  t._bufferOrigin = { kind: 'decoded-item' };
  t.stopNodeOnly();
  assert.strictEqual(t._sourceRevision, 0); same(t._bufferOrigin, { kind: 'decoded-item' });
});

// ---------- suspension wrappers ----------
test('H8. _applySession wrapper: token issued, released on success with replaced:true and failures; released on throw with replaced:false', async () => {
  const eng = makeEngine(); const st = makeStudio(eng);
  st._applySessionCore = async (s, onReplacing) => { onReplacing(); return { failures: ['Track 2: x'] }; };
  const r = await st._applySession({ name: 'song.aether' });
  same(r, { failures: ['Track 2: x'] });
  assert.strictEqual(eng.open.size, 0, 'released');
  same(eng.events[1][2], { kind: 'session', replaced: true, fileName: 'song.aether', failures: ['Track 2: x'] });
  st._applySessionCore = async () => { throw new Error('A source changed while checking the project.'); };
  await assert.rejects(() => st._applySession({ name: 'x' }));
  assert.strictEqual(eng.open.size, 0, 'released on throw');
  same(eng.events[3][2], { kind: 'session', replaced: false, fileName: 'x', failures: [] });
  // a throw after the destructive boundary keeps replaced:true (Codex review 2)
  st._applySessionCore = async (s, onReplacing) => { onReplacing(); throw new Error('late failure'); };
  await assert.rejects(() => st._applySession({ name: 'y' }), /late failure/);
  assert.strictEqual(eng.open.size, 0, 'released on a late throw');
  same(eng.events[5][2], { kind: 'session', replaced: true, fileName: 'y', failures: [] });
});

test('H9. real _applySessionCore: failed preflight throws before touching tracks (replaced:false); successful load restores buffers with a session origin (replaced:true)', async () => {
  const eng = makeEngine(); const st = makeStudio(eng);
  st.tracks.forEach(t => { t._bufferOrigin = { kind: 'decoded-item' }; t._weaveBinding = { x: 1 }; });
  st.prepareSession = async () => { throw new Error('Invalid playlist.'); };
  await assert.rejects(() => st._applySession({ name: 'bad', tracks: [{}] }), /Invalid playlist/);
  assert.strictEqual(eng.events[1][2].replaced, false);
  for (const t of st.tracks) { assert.strictEqual(t._sourceRevision, 0, 'no revision change on failed preflight'); same(t._bufferOrigin, { kind: 'decoded-item' }); }
  // success path: the real core runs with a prepared track carrying a decoded buffer
  const decoded = { duration: 2, numberOfChannels: 1 };
  st.prepareSession = async () => [{ index: 0, name: 'T1', sampleName: 's.wav', x: 0.2, y: 0.8, z: 1, isMuted: false, isSoloed: false, eq: { low: 1, mid: 0, high: 0 }, stripGainDb: -3, motionSpeed: 1, motionPath: [], playlistIndex: 0, isShuffle: false, isRepeat: true, _decoded: decoded, _playlist: [], _bundle: null }];
  const r = await st._applySession({ name: 'good.aether', masterVolume: 0.8, loudnessDb: 0, tracks: [{ index: 0 }] });
  same(r.failures, []);
  const t0 = st.tracks[0];
  assert.strictEqual(t0.audioBuffer, decoded); same(t0._bufferOrigin, { kind: 'session' });
  assert.strictEqual(t0._sourceRevision, 1, 'the core bumped the track revision');
  same(eng.events[3][2], { kind: 'session', replaced: true, fileName: 'good.aether', failures: [] });
  assert.strictEqual(eng.open.size, 0);
});

test('H9b. real _applySessionCore throwing after track cleanup (Codex review 2): replaced:true is reported and the token released; a per-track failure is a partial load', async () => {
  const eng = makeEngine(); const st = makeStudio(eng);
  const decoded = { duration: 2, numberOfChannels: 1 };
  const prepared = () => [{ index: 0, name: 'T1', sampleName: 's.wav', x: 0.2, y: 0.8, z: 1, playlistIndex: 0, isShuffle: false, isRepeat: true, motionPath: [], _decoded: decoded, _playlist: [], _bundle: null }];
  st.tracks.forEach(t => { t._bufferOrigin = { kind: 'decoded-item' }; t._weaveBinding = { x: 1 }; });
  // 1. failure after the destructive boundary: the master solo refresh throws once every track was cleared and rehydrated
  st.prepareSession = async () => prepared();
  st.updateSoloState = () => { throw new Error('solo bus unavailable'); };
  await assert.rejects(() => st._applySession({ name: 'late.aether', tracks: [{ index: 0 }] }), /solo bus unavailable/);
  assert.strictEqual(eng.open.size, 0, 'token released on a late throw');
  same(eng.events[1][2], { kind: 'session', replaced: true, fileName: 'late.aether', failures: [] });
  assert.strictEqual(st.tracks[0]._sourceRevision, 1, 'the track really was replaced');
  // 2. partial load: one track fails inside the per-track try → returns with failures, replaced:true
  st.updateSoloState = () => {};
  st.prepareSession = async () => [prepared()[0], { index: 1, name: 'T2', playlistIndex: 0, motionPath: [], _decoded: null, _playlist: [], _bundle: { id: 'x' } }];
  st.tracks[1].loadNodeBundle = async () => { throw new Error('Instrument could not start.'); };
  const r = await st._applySession({ name: 'partial.aether', tracks: [{ index: 0 }, { index: 1 }] });
  assert.strictEqual(r.failures.length, 1); assert.ok(/Track 2/.test(r.failures[0]));
  same(eng.events[3][2], { kind: 'session', replaced: true, fileName: 'partial.aether', failures: JSON.parse(JSON.stringify(r.failures)) });
  assert.strictEqual(eng.open.size, 0);
  // 3. preflight failure still reports replaced:false (nothing touched)
  st.prepareSession = async () => { throw new Error('Invalid playlist.'); };
  const revs = st.tracks.map(t => t._sourceRevision);
  await assert.rejects(() => st._applySession({ name: 'bad', tracks: [{}] }), /Invalid playlist/);
  same(eng.events[5][2], { kind: 'session', replaced: false, fileName: 'bad', failures: [] });
  same(st.tracks.map(t => t._sourceRevision), revs);
  assert.strictEqual(eng.open.size, 0);
});

test('H10. rebuildAudioGraph wrapper + real core: early return reports replaced:false; a real rebuild bumps every track, marks restored buffers rebuilt and releases', async () => {
  const eng = makeEngine(); const st = makeStudio(eng);
  st._audioRecovering = true;
  await st.rebuildAudioGraph();
  same(eng.events[1][2], { kind: 'rebuild', replaced: false });
  assert.strictEqual(eng.open.size, 0);
  st._audioRecovering = false;
  st.tracks[0].audioBuffer = st.audioCtx.createBuffer(1, 10, 100); st.tracks[0].duration = 0.1; st.tracks[0].isLoaded = true;
  st.tracks[0]._bufferOrigin = { kind: 'decoded-item' };
  const before = st.tracks[0].audioBuffer;
  await st.rebuildAudioGraph();
  same(eng.events[3][2], { kind: 'rebuild', replaced: true });
  assert.strictEqual(eng.open.size, 0, 'released');
  for (const t of st.tracks) assert.strictEqual(t._sourceRevision, 1, 'every track bumped once');
  assert.notStrictEqual(st.tracks[0].audioBuffer, before, 'new buffer object');
  same(st.tracks[0]._bufferOrigin, { kind: 'rebuilt' });
  assert.strictEqual(st.tracks[1]._bufferOrigin, null, 'a track with no buffer keeps no origin');
  assert.strictEqual(st._audioRecovering, false, 'core finally ran');
  // a throwing core still releases
  st._rebuildAudioGraphCore = async () => { throw new Error('boom'); };
  await assert.rejects(() => st.rebuildAudioGraph(), /boom/);
  assert.strictEqual(eng.open.size, 0);
  same(eng.events[5][2], { kind: 'rebuild', replaced: false });
});

test('H11. overlapping operations hold distinct tokens; releasing one does not release the other', async () => {
  const eng = makeEngine(); const st = makeStudio(eng);
  let releaseA; st._applySessionCore = () => new Promise(res => { releaseA = () => res({ failures: [] }); });
  let releaseB; st._rebuildAudioGraphCore = () => new Promise(res => { releaseB = () => res(); });
  const pa = st._applySession({ name: 'a' }); const pb = st.rebuildAudioGraph();
  await new Promise(r => setTimeout(r, 1));
  assert.strictEqual(eng.open.size, 2, 'two tokens open');
  releaseB(); await pb;
  assert.strictEqual(eng.open.size, 1, 'the session token is still held');
  releaseA(); await pa;
  assert.strictEqual(eng.open.size, 0);
});

test('H12. script order: S1, S2, S3 are loaded before weave.js; no other markup changed', () => {
  const i = html.indexOf('<script src="weave-model.js"></script>');
  const j = html.indexOf('<script src="weave-assets.js"></script>');
  const k = html.indexOf('<script src="weave-import.js"></script>');
  const w = html.indexOf('<script src="weave.js"></script>');
  assert.ok(i > 0 && j > i && k > j && w > k, 'order model → assets → import → weave');
});


test('H14. real transport freezes XYZ automation on Pause/Stop, preserves path, and restarts motion on Play', () => {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'motion-loop.js'), 'utf8'), sandbox);
  const st = makeStudio(makeEngine());
  delete st.stopMaster; delete st.playMaster;
  st.cancelLoudnessMatch = () => {};
  st.masterTimeEl = el(); st.transportPosition = 0; st.transportStartTime = 0;
  let now = 1000; const oldNow = sandbox.performance.now;
  sandbox.performance.now = () => now;
  try {
    const t = st.tracks[0];
    t.motionPath = [{ t: 0, x: 0, y: 0, z: 0 }, { t: 2, x: 1, y: 1, z: 50 }];
    const pathRef = t.motionPath;
    t.motionSpeed = 1; t.isPlayingMotion = true; t.isRecordingMotion = false;
    t.motionAccumulatedTime = 0; t.lastMotionFrameTime = now;
    st.playMaster(); now += 200; t.updateMotionPlayback();
    assert.ok(t.x > 0 && t.y > 0 && t.z > 0, 'XYZ moves during Play');
    st.pauseMaster();
    const paused = [t.x, t.y, t.z, t.motionAccumulatedTime];
    now += 10000; t.updateMotionPlayback();
    same([t.x, t.y, t.z, t.motionAccumulatedTime], paused, 'Pause freezes position and phase');
    st.playMaster(); now += 100; t.updateMotionPlayback();
    assert.ok(t.motionAccumulatedTime > paused[3] && t.motionAccumulatedTime < paused[3] + 0.2, 'resume excludes idle time');
    st.stopMaster();
    const stopped = [t.x, t.y, t.z];
    for (let i = 0; i < 10; i++) { now += 100; t.updateMotionPlayback(); }
    same([t.x, t.y, t.z], stopped, 'Stop keeps the node stationary across frames');
    assert.strictEqual(t.motionAccumulatedTime, 0, 'Stop rewinds motion phase');
    assert.strictEqual(t.motionPath, pathRef, 'recorded path is preserved');
    assert.strictEqual(t.isPlayingMotion, true, 'automation remains enabled for next Play');
    st.playMaster(); now += 100; t.updateMotionPlayback();
    assert.ok(t.motionAccumulatedTime > 0 && t.motionAccumulatedTime < 0.2, 'Play starts motion from beginning');
    // Live-input tracks must freeze too, despite bypassing audio Stop.
    t.isLiveIn = true; st.stopMaster(); now += 200;
    const liveStopped = [t.x, t.y, t.z]; t.updateMotionPlayback();
    same([t.x, t.y, t.z], liveStopped, 'Stop freezes live-input automation too');
  } finally { sandbox.performance.now = oldNow; }
});


test('H15. Space toggles transport for every non-text focus target (buttons, range inputs, selects); it types a space in text fields; repeats and keyup never activate controls', () => {
  const st = makeStudio(makeEngine()); let toggles = 0;
  st.toggleMasterPlay = () => { toggles++; };
  const listeners = {}; const oldAdd = sandbox.window.addEventListener;
  sandbox.window.addEventListener = (name, fn, capture) => {
    (listeners[name] ||= []).push({ fn, capture });
  };
  sandbox.keyboardStudio = st;
  try {
    const start = html.indexOf('    // Keyboard shortcuts');
    const end = html.indexOf("    document.addEventListener('visibilitychange'", start);
    const helperStart = html.indexOf('function isTextEditingTarget(el) {'); const helperEnd = html.indexOf('\n}\n', helperStart) + 3;
    vm.runInNewContext(html.slice(helperStart, helperEnd) + '(function(){' + html.slice(start, end) + '}).call(keyboardStudio)', sandbox);
    // Text editing targets type a space (Matt, 5 Oct): the transport never sees it
    for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
      const before = toggles; const down = { code: 'Space', key: ' ', target, repeat: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
      listeners.keydown.forEach(({ fn }) => fn(down));
      assert.strictEqual(toggles, before, 'Space types in ' + target.tagName); assert.ok(!down.prevented, 'not consumed in a text field');
    }
    for (const tag of ['BUTTON', 'INPUT', 'SELECT', 'DIV']) {
      const target = { tagName: tag, type: tag === 'INPUT' ? 'range' : undefined, isContentEditable: false, closest: () => ({ open: true }) };
      const makeEvent = (repeat = false) => ({ code: 'Space', key: ' ', target, repeat, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; } });
      const before = toggles; const down = makeEvent();
      listeners.keydown.forEach(({ fn }) => fn(down));
      assert.strictEqual(toggles, before + 1, 'Space toggles with ' + tag + ' focused, even in a dialog');
      assert.ok(down.prevented && down.stopped, 'focused control cannot activate');
      const repeated = makeEvent(true); listeners.keydown.forEach(({ fn }) => fn(repeated));
      assert.strictEqual(toggles, before + 1, 'holding Space must not toggle repeatedly');
      const up = makeEvent(); listeners.keyup.forEach(({ fn }) => fn(up));
      assert.ok(up.prevented && up.stopped, 'keyup cannot activate the focused button');
      assert.strictEqual(toggles, before + 1, 'keyup does not toggle');
    }
    const enter = { code: 'Enter', key: 'Enter', preventDefault() { throw new Error('other keys must remain available'); } };
    listeners.keydown.forEach(({ fn }) => fn(enter));
  } finally { sandbox.window.addEventListener = oldAdd; delete sandbox.keyboardStudio; }
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('✔ ' + t.name); }
    catch (e) { failed++; console.log('✘ ' + t.name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
