/**
 * Automated Verification Suite for Aether Node V2 Patient Zero (TickTok)
 * Tests acceptance criteria:
 * - Test A: Two nodes from transport zero share exact musical phase.
 * - Test B: Pause / Resume maintains phase without local restart.
 * - Test C: Hot insertion joins running timeline in-phase.
 * - Test D: Repeated Pause / Resume exhibits zero cumulative phase divergence.
 * - Test E: Lifecycle cleanup leaves no active timers or orphan sequencers.
 * - Test F: Parameter edits while paused produce no preview hits (silence).
 * - Test G: Local swing modifies odd subdivisions without shifting master grid.
 */

const assert = require('assert');
const { TickTokDSP } = require('../nodes-v2/tick-tok/dsp.js');

// Mock Web Audio Context
class MockParam {
  constructor(val = 0) {
    this.value = val;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exp', v, t }); this.value = v; }
}

class MockAudioNode {
  constructor() {
    this.connected = [];
  }
  connect(dest) { this.connected.push(dest); }
  disconnect() { this.connected = []; }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockParam(1.0);
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor() {
    super();
    this.frequency = new MockParam(440);
    this.type = 'sine';
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(t) { this.startedAt = t; }
  stop(t) { this.stoppedAt = t; }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.frequency = new MockParam(1000);
    this.Q = new MockParam(1);
    this.type = 'lowpass';
  }
}

class MockBufferSourceNode extends MockAudioNode {
  constructor() {
    super();
    this.playbackRate = new MockParam(1);
    this.buffer = null;
    this.startedAt = null;
    this.stoppedAt = null;
  }
  start(t) { this.startedAt = t; }
  stop(t) { this.stoppedAt = t; }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 100.0; // Simulate non-zero audio clock
    this.sampleRate = 48000;
  }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createBufferSource() { return new MockBufferSourceNode(); }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length)
    };
  }
}

// Mock Aether Master Transport Clock
class MockAetherTransport {
  constructor(bpm = 120) {
    this.bpm = bpm;
    this.state = 'stopped';
    this.transportPosition = 0;
    this.transportStartTime = 0;
    this.audioCtx = new MockAudioContext();
  }

  play() {
    this.state = 'playing';
    this.transportStartTime = this.audioCtx.currentTime;
  }

  pause() {
    if (this.state === 'playing') {
      this.transportPosition = this.getCurrentPlaybackTime();
      this.state = 'paused';
    }
  }

  stop() {
    this.state = 'stopped';
    this.transportPosition = 0;
    this.transportStartTime = 0;
  }

  getCurrentPlaybackTime() {
    if (this.state !== 'playing') return this.transportPosition;
    return this.transportPosition + (this.audioCtx.currentTime - this.transportStartTime);
  }

  advanceTime(seconds) {
    this.audioCtx.currentTime += seconds;
  }

  getClockSnapshot() {
    const transportTime = Math.max(0, this.getCurrentPlaybackTime());
    const audioCtxTime = this.audioCtx.currentTime;
    const bpm = this.bpm;
    const state = this.state;
    const beatsPerBar = 4;
    const stepsPerBeat = 4;
    const beatsElapsed = transportTime * (bpm / 60);
    const beatPhase = beatsElapsed >= 0 ? (beatsElapsed % 1) : 0;
    const totalBeats = Math.floor(beatsElapsed + 1e-9);
    const barIndex = Math.floor((beatsElapsed + 1e-9) / beatsPerBar);
    const beatIndex = ((totalBeats % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const totalSteps = Math.floor((beatsElapsed * stepsPerBeat) + 1e-9);
    const stepIndex = ((totalSteps % (beatsPerBar * stepsPerBeat)) + (beatsPerBar * stepsPerBeat)) % (beatsPerBar * stepsPerBeat);

    return {
      transportTime,
      audioCtxTime,
      bpm,
      state,
      beatsElapsed,
      barIndex,
      beatIndex,
      stepIndex,
      beatPhase
    };
  }

  createHost() {
    return {
      getClockSnapshot: () => this.getClockSnapshot()
    };
  }
}

console.log('=== Running Aether Node V2 Patient Zero Verification Suite ===\n');

// --- Test 0: Silence upon instantiation ---
{
  const transport = new MockAetherTransport(120);
  const node = new TickTokDSP();
  node.init(transport.audioCtx, transport.createHost());

  assert.strictEqual(node.isRunning, false, 'Node must NOT be running on init');
  assert.strictEqual(node.timerId, null, 'Node must NOT have active timer on init');
  console.log('✔ Test 0 Passed: Silence upon instantiation (no audio leakage)');
  node.dispose();
}

// --- Test A: Two nodes from zero ---
{
  const transport = new MockAetherTransport(120);
  const nodeA = new TickTokDSP();
  const nodeB = new TickTokDSP();
  nodeA.init(transport.audioCtx, transport.createHost());
  nodeB.init(transport.audioCtx, transport.createHost());

  transport.stop();
  transport.play();

  // Capture scheduled events on both
  const firedA = [];
  const firedB = [];
  nodeA._fire = (step, t) => firedA.push({ step, t });
  nodeB._fire = (step, t) => firedB.push({ step, t });

  // Start both nodes
  nodeA.start();
  nodeB.start();

  assert.strictEqual(nodeA.isRunning, true);
  assert.strictEqual(nodeB.isRunning, true);
  assert(firedA.length > 0, 'Events should be scheduled within lookahead');
  assert.strictEqual(firedA.length, firedB.length, 'Both instances must schedule the same number of events');
  for (let i = 0; i < firedA.length; i++) {
    assert.strictEqual(firedA[i].step, firedB[i].step, `Step mismatch at index ${i}`);
    assert(Math.abs(firedA[i].t - firedB[i].t) < 1e-9, `AudioCtx timestamp mismatch at step ${firedA[i].step}`);
  }
  console.log(`✔ Test A Passed: Two nodes from zero share identical musical phase (${firedA.length} steps verified)`);
  nodeA.dispose();
  nodeB.dispose();
}

// --- Test B: Pause / Resume ---
{
  const transport = new MockAetherTransport(120);
  const node = new TickTokDSP();
  node.init(transport.audioCtx, transport.createHost());

  transport.play();
  node.start();

  // Advance transport 2.5 seconds (5 beats = 20 steps)
  transport.advanceTime(2.5);
  transport.pause();
  node.stop();

  assert.strictEqual(node.isRunning, false, 'Node must halt scheduling on pause');
  assert.strictEqual(node.timerId, null, 'Node timer must be cleared on pause');

  const pauseSnap = transport.getClockSnapshot();
  assert.strictEqual(pauseSnap.state, 'paused');
  assert.strictEqual(pauseSnap.beatsElapsed, 5.0);

  // Resume after a delay
  transport.advanceTime(10.0); // Real world clock advances during pause
  transport.play();

  const firedResume = [];
  node._fire = (step, t) => firedResume.push({ step, t });
  node.start();

  assert.strictEqual(node.isRunning, true);
  assert(firedResume.length > 0, 'Resuming must immediately schedule starting step');
  assert.strictEqual(firedResume[0].step, 20 % 16, 'First scheduled step on resume must be step 20 (step 4 of bar 1)');
  assert.strictEqual(node.nextStepIndex, 21, 'nextStepIndex must advance past scheduled step 20 to 21');
  console.log('✔ Test B Passed: Pause/Resume anchors directly to master musical phase without restart');
  node.dispose();
}

// --- Test C: Hot insertion ---
{
  const transport = new MockAetherTransport(120);
  const nodeA = new TickTokDSP();
  nodeA.init(transport.audioCtx, transport.createHost());

  transport.play();
  nodeA.start();

  // Run transport for 3.375 seconds (BPM 120: stepDur = 0.125s -> 27 steps elapsed = 6.75 beats)
  transport.advanceTime(3.375);

  // Hot-insert Node B while transport is running!
  const nodeB = new TickTokDSP();
  nodeB.init(transport.audioCtx, transport.createHost());

  // Capture events fired on both starting from step 27
  const firedA = [];
  const firedB = [];
  nodeA._fire = (step, t) => firedA.push({ step, t });
  nodeB._fire = (step, t) => firedB.push({ step, t });

  nodeB.start(); // Application calls start() during hot insert
  nodeA.nextStepIndex = 27; // Align A to check lock
  nodeA._tick();

  const expectedStep = Math.ceil(transport.getClockSnapshot().beatsElapsed * 4 - 1e-6);
  assert.strictEqual(expectedStep, 27, 'Calculated expected step at 3.375s must be 27');
  assert(firedB.length > 0, 'Hot inserted node B must schedule immediately in lookahead');
  assert.strictEqual(firedA.length, firedB.length);
  for (let i = 0; i < firedA.length; i++) {
    assert.strictEqual(firedA[i].step, firedB[i].step);
    assert(Math.abs(firedA[i].t - firedB[i].t) < 1e-9);
  }
  console.log(`✔ Test C Passed: Hot insertion joins running musical phase at Step ${expectedStep} with sample-accurate alignment`);
  nodeA.dispose();
  nodeB.dispose();
}

// --- Test D: Repeated Pause / Resume ---
{
  const transport = new MockAetherTransport(120);
  const nodeA = new TickTokDSP();
  const nodeB = new TickTokDSP();
  nodeA.init(transport.audioCtx, transport.createHost());
  nodeB.init(transport.audioCtx, transport.createHost());

  transport.play();
  nodeA.start();
  nodeB.start();

  for (let cycle = 1; cycle <= 10; cycle++) {
    transport.advanceTime(0.75 + (cycle * 0.1));
    transport.pause();
    nodeA.stop();
    nodeB.stop();

    transport.advanceTime(1.0); // Real world idle during pause
    transport.play();
    nodeA.start();
    nodeB.start();

    assert.strictEqual(nodeA.nextStepIndex, nodeB.nextStepIndex, `Cycle ${cycle}: step index mismatch between A and B`);
    const snap = transport.getClockSnapshot();
    const startStep = Math.ceil(snap.beatsElapsed * 4 - 1e-6);
    assert(nodeA.nextStepIndex >= startStep + 1, `Cycle ${cycle}: node must have advanced past starting step ${startStep}`);
  }
  console.log('✔ Test D Passed: 10 repeated Pause/Resume cycles produce zero cumulative phase divergence');
  nodeA.dispose();
  nodeB.dispose();
}

// --- Test E: Lifecycle cleanup ---
{
  const transport = new MockAetherTransport(120);
  const node = new TickTokDSP();
  node.init(transport.audioCtx, transport.createHost());

  transport.play();
  node.start();
  assert(node.timerId !== null, 'Timer should be active during playback');

  node.dispose();
  assert.strictEqual(node.isRunning, false, 'isRunning must be false after dispose');
  assert.strictEqual(node.timerId, null, 'timerId must be null after dispose');
  assert.strictEqual(node.ctx, null, 'audioContext reference must be released');
  assert.strictEqual(node.outputNode, null, 'outputNode reference must be released');

  // Attempting tick after dispose must be a safe no-op
  node._tick();
  assert.strictEqual(node.timerId, null, 'No timer should be created after dispose');
  console.log('✔ Test E Passed: Lifecycle cleanup completely releases resources and halts sequencers');
}

// --- Test F: Parameter edits while paused ---
{
  const transport = new MockAetherTransport(120);
  const node = new TickTokDSP();
  node.init(transport.audioCtx, transport.createHost());
  transport.stop(); // Transport stopped

  let previewHitsFired = 0;
  node._fire = () => { previewHitsFired++; };

  node.setParameter('pattern', 0.85);
  node.setParameter('color', 0.9);
  node.setParameter('talk', 0.3);

  assert.strictEqual(node.getParameter('pattern'), 0.85);
  assert.strictEqual(previewHitsFired, 0, 'No audio preview hits must be fired when editing parameters while paused/stopped');
  console.log('✔ Test F Passed: Parameter edits while paused remain completely silent');
  node.dispose();
}

// --- Test G: Local swing non-accumulating behaviour ---
{
  const transport = new MockAetherTransport(120);
  const node = new TickTokDSP();
  node.init(transport.audioCtx, transport.createHost());
  node.setParameter('pattern', 0.9); // Pattern > 0.72 enables swing

  const fired = [];
  node._fire = (step, t) => fired.push({ step, t });

  transport.play();
  node.start();

  // Advance time across step 1 and step 2 boundaries
  transport.advanceTime(0.125);
  node._tick();
  transport.advanceTime(0.125);
  node._tick();

  assert(fired.length >= 3, `Need at least 3 steps to verify swing, got ${fired.length}`);
  const secondsPerStep = 15 / 120; // 0.125s
  const tZero = transport.audioCtx.currentTime - transport.getCurrentPlaybackTime();

  // Even step (step 0): straight grid
  assert.strictEqual(fired[0].step, 0);
  assert(Math.abs(fired[0].t - (tZero + 0 * secondsPerStep)) < 1e-6, 'Even step 0 must be straight on grid');

  // Odd step (step 1): shifted by swing offset
  assert.strictEqual(fired[1].step, 1);
  const straightT1 = tZero + 1 * secondsPerStep;
  const expectedSwing = secondsPerStep * 0.09;
  assert(Math.abs(fired[1].t - (straightT1 + expectedSwing)) < 1e-6, 'Odd step 1 must be delayed by swing offset');

  // Even step (step 2): MUST return to straight grid without inheriting step 1 delay!
  if (fired.length > 2) {
    assert.strictEqual(fired[2].step, 2);
    const straightT2 = tZero + 2 * secondsPerStep;
    assert(Math.abs(fired[2].t - straightT2) < 1e-6, 'Even step 2 must return strictly to straight grid (non-accumulating)');
  }
  console.log('✔ Test G Passed: Local swing offsets odd subdivisions without drifting subsequent master grid');
  node.dispose();
}

// --- Test H: Argumentless start() and fallback clock snapshot resolution ---
{
  const audioCtx = new MockAudioContext();
  const node = new TickTokDSP();
  // Init without clock host
  node.init(audioCtx, {});

  let firedCount = 0;
  node._fire = () => { firedCount++; };

  // Calling start() without arguments must activate and not silently bail
  node.start();
  assert.strictEqual(node.isRunning, true, 'start() without arguments must activate the node');
  assert(firedCount > 0, 'start() must schedule initial steps using fallback snapshot');

  node.stop();
  assert.strictEqual(node.isRunning, false, 'stop() must halt execution');
  console.log('✔ Test H Passed: Argumentless start() and fallback clock resolution activate without silence');
  node.dispose();
}

console.log('\n=== ALL 9 VERIFICATION TESTS PASSED SUCCESSFULLY ===');
