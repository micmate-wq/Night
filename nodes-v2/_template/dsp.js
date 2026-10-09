/**
 * Aether Node V2 Generic Starting Template (DSP)
 * 
 * Complies with Aether Node Manifesto v1.0:
 * - Silent upon instantiation (init() never schedules or outputs audio).
 * - Derives musical coordinates from master clock snapshot via minimal host boundary.
 * - Sample-accurate lookahead scheduling against Web Audio audioCtx.currentTime.
 * - Deterministic parameter API (setParameter / getParameter).
 * - Full resource disposal (dispose() cancels timers and disconnects AudioNodes).
 * 
 * FOR FUTURE CODING AGENTS:
 * -------------------------------------------------------------
 * 1. For NOT-TEMPO-AWARE nodes (effects, continuous synths, utility gains):
 *    - In manifest.json: set "timingTier": "not-tempo-aware".
 *    - Remove the lookahead scheduler section (_tick, nextStepIndex, timerId).
 *    - Use init() and parameter changes or input audio to drive your DSP graph.
 * 2. For AMBIENT-GENERATIVE nodes:
 *    - In manifest.json: set "timingTier": "ambient-generative".
 *    - Start/stop your continuous oscillators or buffers in start() / stop().
 * 3. For TEMPO-AWARE nodes (delays, LFOs):
 *    - In manifest.json: set "timingTier": "tempo-aware".
 *    - Update modulation rates in start() or via snapshot.bpm without step locking.
 * 4. For PHASE-GRID-AWARE nodes (sequencers, rhythm generators, arpeggiators):
 *    - Keep the lookahead scheduling architecture below intact.
 *    - Replace _playTone(time) with your custom synthesis voice triggers.
 */
class TemplateNodeDSP {
  constructor() {
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
    this.isRunning = false;
    this.timerId = null;

    // Musical step scheduling state (for phase-grid-aware nodes)
    this.nextStepIndex = 0;

    // Declared parameters matching manifest.json
    this.params = {
      gain: 0.75,
      frequency: 220,
      decay: 0.25,
      subdivision: 2 // Trigger every N 16th-notes (e.g. 2 = 8th notes, 4 = quarter notes)
    };
  }

  /**
   * REQUIRED: Instantiate Web Audio nodes and internal buffers.
   * INVARIANT: Never begin event scheduling here. Produces complete silence.
   */
  init(audioContext, host = {}) {
    this.ctx = audioContext;
    this.host = host;

    // Main output bus
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(this.params.gain, this.ctx.currentTime);

    // Optional input node (if role is "insert"):
    // this.inputNode = this.ctx.createGain();
    // this.inputNode.connect(this.outputNode);

    return this.outputNode;
  }

  /**
   * Resolve Aether Master Clock snapshot via minimal host boundary or fallback.
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

    // Fallback if running standalone or in isolated test harness
    if (this.ctx) {
      const bpm = 120;
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
   * REQUIRED: Start playback in sync with Aether master transport.
   * Handles: Play from zero, Resume from pause, and Hot Insertion while playing.
   */
  start(passedSnapshot) {
    if (this.isRunning || !this.ctx) return;

    let snapshot = passedSnapshot || this.getSnapshot();
    if (snapshot && snapshot.state !== 'playing') {
      snapshot = Object.assign({}, snapshot, { state: 'playing' });
    }

    this.isRunning = true;

    // For phase-grid-aware nodes: align next step to master clock coordinate
    const stepsPerBeat = 4; // 16th-note grid
    const currentMusicalStep = ((snapshot && snapshot.beatsElapsed) || 0) * stepsPerBeat;

    // Invariant: align to the next immediate step boundary
    this.nextStepIndex = Math.max(0, Math.ceil(currentMusicalStep - 1e-6)) | 0;

    // Begin lookahead scheduling loop
    this._tick();
  }

  /**
   * REQUIRED: Halt scheduling and freeze state upon transport Pause or Stop.
   */
  stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * REQUIRED: Release all Web Audio nodes and clear timers.
   */
  dispose() {
    this.stop();
    this.disconnect();
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
  }

  /**
   * Audio routing connection hooks.
   */
  connect(destination) {
    if (this.outputNode && destination) {
      this.outputNode.connect(destination);
    }
  }

  disconnect() {
    if (this.outputNode) {
      try { this.outputNode.disconnect(); } catch (_) {}
    }
  }

  /**
   * REQUIRED: Parameter access methods.
   * Invariant: Parameter edits while paused must not trigger preview audio hits.
   */
  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    const num = Number(value);
    this.params[paramId] = num;

    if (paramId === 'gain' && this.outputNode && this.ctx) {
      this.outputNode.gain.setTargetAtTime(num, this.ctx.currentTime, 0.015);
    }
  }

  getParameter(paramId) {
    return this.params[paramId];
  }

  // =========================================================================
  // SCHEDULING ENGINE (Lookahead + Hardware Timestamps)
  // Omit this entire section if your node is NOT tempo- or phase-aware.
  // =========================================================================

  _tick() {
    if (!this.isRunning || !this.ctx) return;

    const snapshot = this.getSnapshot();
    if (!snapshot || snapshot.state !== 'playing') {
      this.stop();
      return;
    }

    const bpm = snapshot.bpm || 120;
    const secondsPerStep = 15 / bpm; // 60 / bpm / 4 (duration of one 16th note)
    const nowCtx = this.ctx.currentTime;

    // Mathematical Anchor: audioCtx timestamp corresponding to transport zero
    const tZeroCtx = snapshot.audioCtxTime - snapshot.transportTime;
    const lookahead = 0.12; // 120ms scheduling window

    // Drift recovery: if the JS thread was delayed, advance pointer past expired events
    const currentLiveStep = Math.max(0, Math.floor(((nowCtx - tZeroCtx) / secondsPerStep) + 1e-6)) | 0;
    if (this.nextStepIndex < currentLiveStep) {
      this.nextStepIndex = currentLiveStep;
    }

    // Schedule all musical steps falling within the lookahead horizon
    while (true) {
      const step = this.nextStepIndex;
      const tBase = tZeroCtx + (step * secondsPerStep);

      if (tBase >= nowCtx + lookahead) {
        break;
      }

      // Check if this step should trigger sound (e.g. based on subdivision)
      const sub = Math.max(1, Math.round(this.params.subdivision || 2));
      if (step % sub === 0) {
        const tEvent = Math.max(nowCtx, tBase);
        this._playTone(tEvent);
      }

      this.nextStepIndex++;
    }

    // Schedule next wake-up tick (~25ms interval)
    this.timerId = setTimeout(() => this._tick(), 25);
  }

  /**
   * Minimal placeholder synthesis trigger.
   * Replace with your instrument voice / drum / filter trigger logic.
   */
  _playTone(time) {
    if (!this.ctx || !this.outputNode) return;

    try {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.params.frequency || 220, time);

      // Fast attack, exponential decay envelope
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(0.4, time + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.02, this.params.decay));

      osc.connect(env);
      env.connect(this.outputNode);

      osc.start(time);
      osc.stop(time + Math.max(0.05, this.params.decay) + 0.02);
    } catch (_) {}
  }
}

// Global browser and CommonJS exports for host compatibility
if (typeof window !== 'undefined') {
  window.TemplateNodeDSP = TemplateNodeDSP;
  window.CustomNodeDSP = TemplateNodeDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TemplateNodeDSP, CustomNodeDSP: TemplateNodeDSP };
}
