/**
 * Tick Tok (Node V2 - Patient Zero Reference Implementation)
 *
 * Implements the Aether Node Manifesto v0.1 contract:
 * - Silent upon instantiation (no audio leakage in init()).
 * - Derives musical coordinate space exclusively from Aether Master Clock snapshot.
 * - Sample-accurate lookahead scheduling against Web Audio currentTime.
 * - Phase-coherent hot-insertion and pause/resume synchronization.
 * - Local groove/swing without accumulating timeline drift.
 * - Clean disposal of AudioNodes and timers.
 */
class TickTokDSP {
  constructor() {
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
    this.isRunning = false;
    this.timerId = null;

    // Musical step scheduling state
    this.nextStepIndex = 0;       // Continuous 16th-note step index from transport zero
    this.currentBarIndex = -1;    // 0-indexed bar index for ghost rolls

    // Parameters with deterministic identifiers
    this.params = {
      bpm: 120,
      pattern: 0.22,
      talk: 0.62,
      decay: 0.38,
      density: 0.50,
      lock: 0.70,
      color: 0.40
    };

    // Algorithmic rhythm generator state
    this.noiseBuffer = null;
    this.hat = 0b1010101010101010; // 8ths groove foundation
    this.ghost = 0;
    this.turing = 0b1011001010010110;
  }

  /**
   * Instantiate graph nodes and allocate audio buffers.
   * INVARIANT: Never begin event scheduling here. Produces complete silence.
   */
  init(audioContext, host = {}) {
    this.ctx = audioContext;
    this.host = host;
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this._makeNoise();
    return this.outputNode;
  }

  /**
   * Resolve current Aether clock snapshot via minimal host interface or fallback.
   */
  getSnapshot() {
    let snap = null;
    if (this.host && typeof this.host.getClockSnapshot === 'function') {
      snap = this.host.getClockSnapshot();
    } else if (typeof window !== 'undefined' && window.studio && typeof window.studio.getClockSnapshot === 'function') {
      snap = window.studio.getClockSnapshot();
    }
    if (snap) {
      if (this.isRunning && snap.state === 'stopped') {
        return Object.assign({}, snap, { state: 'playing' });
      }
      return snap;
    }

    // Fallback if host does not implement getClockSnapshot directly
    if (typeof window !== 'undefined' && window.studio) {
      const s = window.studio;
      const bpm = (typeof s.masterBpm === 'number' && s.masterBpm > 0)
        ? s.masterBpm
        : ((typeof s.getClockBpm === 'function' ? s.getClockBpm() : 0) || this.params.bpm || 120);
      const transportTime = typeof s.getCurrentPlaybackTime === 'function'
        ? Math.max(0, s.getCurrentPlaybackTime())
        : (s.transportPosition || 0);
      const audioCtxTime = this.ctx ? this.ctx.currentTime : 0;
      const isPlaying = !!(s.isPlaying || this.isRunning);
      const state = isPlaying ? 'playing' : (s._isPaused ? 'paused' : 'stopped');
      const beatsElapsed = transportTime * (bpm / 60);
      return {
        transportTime,
        audioCtxTime,
        bpm,
        state,
        beatsElapsed,
        barIndex: Math.floor(beatsElapsed / 4),
        beatIndex: Math.floor(beatsElapsed) % 4,
        stepIndex: Math.floor(beatsElapsed * 4) % 16,
        beatPhase: beatsElapsed % 1
      };
    }
    // Standalone fallback (e.g. test harness or isolated track audition)
    if (this.ctx) {
      const bpm = this.params.bpm || 120;
      return {
        transportTime: this.ctx.currentTime,
        audioCtxTime: this.ctx.currentTime,
        bpm,
        state: this.isRunning ? 'playing' : 'stopped',
        beatsElapsed: (this.ctx.currentTime * bpm) / 60,
        barIndex: 0,
        beatIndex: 0,
        stepIndex: 0,
        beatPhase: 0
      };
    }
    return null;
  }

  /**
   * Begin playback synchronized to Aether master transport.
   * Supports starting from zero, resuming from pause, and hot-insertion while playing.
   */
  start(passedSnapshot) {
    if (this.isRunning || !this.ctx) return;

    let snapshot = passedSnapshot || this.getSnapshot();
    if (snapshot) {
      if (snapshot.state !== 'playing') {
        snapshot = Object.assign({}, snapshot, { state: 'playing' });
      }
    } else if (this.ctx) {
      snapshot = {
        transportTime: 0,
        audioCtxTime: this.ctx.currentTime,
        bpm: this.params.bpm || 120,
        state: 'playing',
        beatsElapsed: 0,
        barIndex: 0,
        beatIndex: 0,
        stepIndex: 0,
        beatPhase: 0
      };
    } else {
      return;
    }

    this.isRunning = true;

    const bpm = snapshot.bpm || this.params.bpm || 120;
    this.params.bpm = bpm;

    // Determine target 16th-note step from continuous musical position
    const stepsPerBeat = 4;
    const currentMusicalStep = (snapshot.beatsElapsed || 0) * stepsPerBeat;

    // Align to the next immediate 16th-note step boundary
    this.nextStepIndex = Math.max(0, Math.ceil(currentMusicalStep - 1e-6)) | 0;
    this.currentBarIndex = Math.floor(this.nextStepIndex / 16);

    this._tick();
  }

  /**
   * Halt lookahead timers and stop scheduling new events.
   * Musical phase is preserved in Aether master transport.
   */
  stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Release all Web Audio nodes and clear timer handlers.
   */
  dispose() {
    this.stop();
    this.disconnect();
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
    this.noiseBuffer = null;
  }

  connect(dest) {
    if (this.outputNode && dest) {
      this.outputNode.connect(dest);
    }
  }

  disconnect() {
    if (this.outputNode) {
      try { this.outputNode.disconnect(); } catch (_) {}
    }
  }

  /**
   * Deterministic parameter access.
   * Parameter edits while paused must remain silent (no audition preview).
   */
  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = Number(value);
  }

  getParameter(paramId) {
    return this.params[paramId];
  }

  // --- INTERNAL TIMING & SCHEDULING ---

  _tick() {
    if (!this.isRunning || !this.ctx) return;

    const snapshot = this.getSnapshot();
    if (!snapshot || snapshot.state !== 'playing') {
      this.stop();
      return;
    }

    const bpm = snapshot.bpm || this.params.bpm || 120;
    this.params.bpm = bpm;
    const secondsPerStep = 15 / bpm; // 60 / bpm / 4
    const nowCtx = this.ctx.currentTime;

    // Mathematical anchor: audioCtx timestamp corresponding to transport zero
    const tZeroCtx = snapshot.audioCtxTime - snapshot.transportTime;
    const lookahead = 0.12; // 120ms scheduling window

    // Drift recovery: if the JS timer experienced extreme jitter,
    // advance nextStepIndex to prevent scheduling expired past events
    const currentLiveStep = Math.max(0, Math.floor(((nowCtx - tZeroCtx) / secondsPerStep) + 1e-6)) | 0;
    if (this.nextStepIndex < currentLiveStep) {
      this.nextStepIndex = currentLiveStep;
    }

    while (true) {
      const step = this.nextStepIndex;
      const tBase = tZeroCtx + (step * secondsPerStep);

      // Stop scheduling once we exceed the lookahead window
      if (tBase >= nowCtx + lookahead) {
        break;
      }

      // Check bar boundary for algorithmic ghost variations
      const barIndex = Math.floor(step / 16);
      if (barIndex !== this.currentBarIndex) {
        this.currentBarIndex = barIndex;
        this._rollGhosts();
      }

      const stepInBar = ((step % 16) + 16) % 16;

      // Local swing: offset odd 16th subdivisions WITHOUT shifting the straight grid
      const isOdd16th = (stepInBar % 2 === 1);
      const swingOffset = (this.params.pattern > 0.72 && isOdd16th)
        ? (secondsPerStep * 0.09)
        : 0;

      const tEvent = Math.max(nowCtx, tBase + swingOffset);

      this._fire(stepInBar, tEvent);
      this.nextStepIndex++;
    }

    this.timerId = setTimeout(() => this._tick(), 25);
  }

  // --- ANALOG SYNTHESIS ROUTINES ---

  _makeNoise() {
    const n = Math.floor(this.ctx.sampleRate * 0.25);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      pink = 0.7 * pink + w * 0.3;
      d[i] = (w * 0.78 + pink * 0.22) * 0.65;
    }
    this.noiseBuffer = buf;
  }

  _bit(mask, step) {
    return (mask >> (15 - (step & 15))) & 1;
  }

  _blendPattern(pattern) {
    const P = [
      0b1000100010001000, // four on the 16ths (1,5,9,13)
      0b1100100010001000, // double kick on 1
      0b1000000010001000, // gap (skip the 5)
      0b1110000010000000, // three in a row then space
      0b1001001000100100  // clave / uneven
    ];
    const N = P.length;
    const f = Math.max(0, Math.min(1, pattern)) * (N - 1);
    if (f >= N - 1) return P[N - 1];
    const i = Math.floor(f);
    const t = f - i;
    if (t < 0.18) return P[i];
    if (t > 0.82) return P[i + 1];
    return P[i] | P[i + 1];
  }

  _talkMask(talk, pattern) {
    if (talk < 0.06) return 0;
    let m = 0b0000100000001000; // classic snare on 5 and 13
    const E = [
      0b0000000000000000,
      0b0000001000000000, // 7
      0b0000001000100000, // 7 + 11
      0b0000001000100010  // 7 + 11 + 15
    ];
    const N = E.length;
    const climb = talk * 0.65 + pattern * 0.35;
    const u = Math.max(0, Math.min(1, (climb - 0.55) / 0.45));
    const f = u * (N - 1);
    if (f >= N - 1) m |= E[N - 1];
    else {
      const i = Math.floor(f);
      const t = f - i;
      if (t < 0.18) m |= E[i];
      else if (t > 0.82) m |= E[i + 1];
      else m |= E[i] | E[i + 1];
    }
    return m;
  }

  _rollGhosts() {
    const d = this.params.density;
    const lock = this.params.lock;
    if (Math.random() < lock) return; // freeze loop when locked
    let g = 0;
    for (let s = 0; s < 16; s++) {
      const chance = d * d * (s % 2 ? 0.35 : 0.12);
      if (Math.random() < chance) g |= (1 << (15 - s));
    }
    this.ghost = g;
    const bit = (this.turing >> 15) & 1;
    const inject = Math.random() > lock ? (Math.random() > 0.5 ? 1 : 0) : bit;
    this.turing = ((this.turing << 1) & 0xffff) | inject;
  }

  _fire(step, t) {
    const d = this.params.density;
    const col = this.params.color;
    const talk = this.params.talk;
    const kickMask = this._blendPattern(this.params.pattern);
    const snareMask = this._talkMask(talk, this.params.pattern);

    const kickOn = this._bit(kickMask, step);
    const snareOn = this._bit(snareMask, step);
    const hatBase = this._bit(this.hat, step) && d > 0.18;
    const hatGhost = this._bit(this.ghost, step) && d > 0.4;
    const turingHit = ((this.turing >> (15 - step)) & 1) && d > 0.62 && (step % 3 === 0);

    if (kickOn) this._kick(t, col, step === 0 ? 1 : 0.72);
    if (snareOn) {
      const classic = this._bit(0b0000100000001000, step);
      const vel = classic ? (0.52 + talk * 0.42) : (0.22 + talk * 0.28);
      this._talkBurst(t, col, vel);
    }
    if (hatBase || hatGhost || turingHit) {
      const vel = hatBase ? 0.48 : 0.24;
      this._hat(t, col, vel);
    }
  }

  _kick(t, col, vel) {
    if (!this.ctx || !this.outputNode) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f0 = 58 + col * 62; // thud → tin
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(36, f0 * 0.52), t + 0.06);
    const dur = 0.08 + (1 - col) * 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _talkBurst(t, col, vel) {
    if (!this.ctx || !this.outputNode || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.02 + col * 0.45;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400 + col * 2400, t);
    bp.Q.setValueAtTime(1.3 + col * 1.6, t);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(250, t);
    const g = this.ctx.createGain();
    const dur = 0.03 + this.params.decay * 0.25; // 0.03s … 0.28s
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.58 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(this.outputNode);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _hat(t, col, vel) {
    if (!this.ctx || !this.outputNode || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.5 + col * 1.5;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4200 + col * 4800, t);
    const g = this.ctx.createGain();
    const dur = 0.012 + col * 0.028;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.outputNode);
    src.start(t);
    src.stop(t + dur + 0.01);
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = TickTokDSP;
  window.TickTokDSP = TickTokDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TickTokDSP };
}
