/**
 * PrismPolarCloudDSP - Generative Harmonic Cloud + Doppler Pitch-Shifter Cascade (Polar Style)
 * Web Audio API implementation of Doppler Dual-Delay Pitch Shifting in a Feedback Loop
 */
class PrismPolarCloudDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.dryGain = null;
    this.wetGain = null;

    // Master Feedback Cascade Loop
    this.masterDelay = null;
    this.feedbackGain = null;
    this.dampingFilter = null;
    this.limiter = null;

    // Doppler Pitch Shifter Nodes
    this.psInput = null;
    this.psOutput = null;
    this.psDelayA = null;
    this.psDelayB = null;
    this.psModA = null;
    this.psModB = null;
    this.psModGainA = null;
    this.psModGainB = null;
    this.psGainA = null;
    this.psGainB = null;
    this.psFadeLFO = null;
    this.psFadeGainA = null;
    this.psFadeGainB = null;

    this.isRunning = false;
    this._timer = null;
    this._lfoPhase = 0;

    // Interval Semitones: +12, +7, +19, +5, -12
    this.intervals = [12, 7, 19, 5, -12];

    // Chords in C5-C6 register
    this.chords = [
      // 0: Maj9 (C5, G5, B5, D6, E6, G6, B6, D7)
      [523.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98, 1975.53, 2349.32],
      // 1: Min11 (C5, Eb5, G5, Bb5, D6, F6, G6, Bb6)
      [523.25, 622.25, 783.99, 932.33, 1174.66, 1396.91, 1567.98, 1864.66],
      // 2: Sus2 (C5, D5, G5, C6, D6, G6, C7, D7)
      [523.25, 587.33, 783.99, 1046.50, 1174.66, 1567.98, 2093.00, 2349.32],
      // 3: Lydian Add9 (C5, E5, F#5, G5, D6, E6, F#6, B6)
      [523.25, 659.25, 739.99, 783.99, 1174.66, 1318.51, 1479.98, 1975.53]
    ];

    this.params = {
      chord: 0,
      interval: 0, // Octave Up (+12)
      rootPitch: 0.0,
      density: 0.45,
      delayTime: 0.42,
      feedback: 0.60,
      wash: 0.65,
      swellRate: 0.22,
      gain: 0.75
    };

    this.windowSize = 0.045; // 45ms window
  }

  init(audioContext, options = {}) {
    this.ctx = audioContext;
    if (options.params) Object.assign(this.params, options.params);

    this._buildDSPGraph();
    this.start();
  }

  _buildDSPGraph() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(this.params.gain, now);

    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.5, now);
    this.wetGain.gain.setValueAtTime(this.params.wash, now);

    // Safety Limiter
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-6, now);
    this.limiter.knee.setValueAtTime(8, now);
    this.limiter.ratio.setValueAtTime(10, now);
    this.limiter.attack.setValueAtTime(0.003, now);
    this.limiter.release.setValueAtTime(0.1, now);

    // Master Echo Delay
    this.masterDelay = this.ctx.createDelay(2.0);
    this.masterDelay.delayTime.setValueAtTime(this.params.delayTime, now);

    const safeFeedback = Math.min(0.78, this.params.feedback * 0.9);
    this.feedbackGain = this.ctx.createGain();
    this.feedbackGain.gain.setValueAtTime(safeFeedback, now);

    // Lowpass Damping Filter (softens reflections on each loop pass)
    this.dampingFilter = this.ctx.createBiquadFilter();
    this.dampingFilter.type = 'lowpass';
    this.dampingFilter.frequency.setValueAtTime(3800, now);
    this.dampingFilter.Q.setValueAtTime(0.7, now);

    // Build the Doppler Pitch Shifter Sub-graph
    this._buildPitchShifter(now);

    // Cascade Feedback Routing:
    // Sources -> dryGain -> outputNode
    // Sources -> masterDelay -> dampingFilter -> pitchShifter -> wetGain -> outputNode
    // pitchShifter -> feedbackGain -> masterDelay (Cascade Loop)

    this.masterDelay.connect(this.dampingFilter);
    this.dampingFilter.connect(this.psInput);
    this.psOutput.connect(this.feedbackGain);
    this.feedbackGain.connect(this.masterDelay);

    this.psOutput.connect(this.wetGain);
    this.wetGain.connect(this.limiter);
    this.dryGain.connect(this.limiter);
    this.limiter.connect(this.outputNode);
  }

  _buildPitchShifter(now) {
    this.psInput = this.ctx.createGain();
    this.psOutput = this.ctx.createGain();

    this.psDelayA = this.ctx.createDelay(0.2);
    this.psDelayB = this.ctx.createDelay(0.2);

    this.psGainA = this.ctx.createGain();
    this.psGainB = this.ctx.createGain();

    this.psInput.connect(this.psDelayA);
    this.psInput.connect(this.psDelayB);
    this.psDelayA.connect(this.psGainA);
    this.psDelayB.connect(this.psGainB);
    this.psGainA.connect(this.psOutput);
    this.psGainB.connect(this.psOutput);

    // Modulators for Doppler rate
    this._updatePitchShifterModulation(now);
  }

  _updatePitchShifterModulation(now) {
    if (!this.ctx) return;
    const intervalIdx = Math.max(0, Math.min(this.intervals.length - 1, Math.floor(this.params.interval)));
    const semitones = this.intervals[intervalIdx] ?? 12;

    const pitchRatio = Math.pow(2, semitones / 12);
    // Doppler modulation rate (Hz) for dual-delay saw sweeps
    const rate = Math.abs((1 - pitchRatio) / this.windowSize);
    const modRate = Math.max(0.1, Math.min(60, rate));
    const isUp = pitchRatio > 1.0;

    // Cleanly recreate modulators
    if (this.psModA) {
      try {
        this.psModA.stop();
        this.psModB.stop();
        this.psFadeLFO.stop();
      } catch (_) {}
    }

    const n = 128;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    // Sawtooth Fourier coefficients for delay mod
    for (let i = 1; i < n; i++) {
      imag[i] = (isUp ? -2 : 2) / (i * Math.PI);
    }
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.psModA = this.ctx.createOscillator();
    this.psModB = this.ctx.createOscillator();
    this.psModA.setPeriodicWave(wave);
    this.psModB.setPeriodicWave(wave);
    this.psModA.frequency.setValueAtTime(modRate, now);
    this.psModB.frequency.setValueAtTime(modRate, now);

    this.psModGainA = this.ctx.createGain();
    this.psModGainB = this.ctx.createGain();
    this.psModGainA.gain.setValueAtTime(this.windowSize * 0.5, now);
    this.psModGainB.gain.setValueAtTime(this.windowSize * 0.5, now);

    this.psDelayA.delayTime.setValueAtTime(this.windowSize * 0.5, now);
    this.psDelayB.delayTime.setValueAtTime(this.windowSize * 0.5, now);

    this.psModA.connect(this.psModGainA);
    this.psModGainA.connect(this.psDelayA.delayTime);

    this.psModB.connect(this.psModGainB);
    this.psModGainB.connect(this.psDelayB.delayTime);

    // Cross-fading LFO to eliminate glitch at saw reset
    this.psFadeLFO = this.ctx.createOscillator();
    this.psFadeLFO.frequency.setValueAtTime(modRate, now);

    const fadeGain = this.ctx.createGain();
    fadeGain.gain.setValueAtTime(0.5, now);

    this.psGainA.gain.setValueAtTime(0.5, now);
    this.psGainB.gain.setValueAtTime(0.5, now);

    this.psFadeLFO.connect(fadeGain);
    fadeGain.connect(this.psGainA.gain);

    const inverter = this.ctx.createGain();
    inverter.gain.setValueAtTime(-1, now);
    fadeGain.connect(inverter);
    inverter.connect(this.psGainB.gain);

    // Start oscillators with half-period phase offset on B
    this.psModA.start(now);
    this.psModB.start(now + (0.5 / modRate));
    this.psFadeLFO.start(now);
  }

  triggerHarmonicGrain() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.isRunning) return;
    const now = this.ctx.currentTime;

    const chordList = this.chords[Math.min(this.chords.length - 1, Math.max(0, Math.floor(this.params.chord)))] || this.chords[0];
    const rawNote1 = chordList[Math.floor(Math.random() * chordList.length)];
    let rawNote2 = chordList[Math.floor(Math.random() * chordList.length)];

    // Apply Root Pitch Transposition
    const pitchRatio = Math.pow(2, (Number(this.params.rootPitch) || 0) / 12);
    const freq1 = Math.max(100, Math.min(18000, rawNote1 * pitchRatio * (1 + (Math.random() * 2 - 1) * 0.0025)));
    const freq2 = Math.max(100, Math.min(18000, rawNote2 * pitchRatio * (1 + (Math.random() * 2 - 1) * 0.0025)));

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const envGain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq1, now);
    osc2.frequency.setValueAtTime(freq2, now);

    const swellVal = 0.5 + 0.5 * Math.sin(this._lfoPhase);
    const peakGain = 0.09 + (swellVal * 0.11);

    const attack = 1.2;
    const release = 4.2;

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, now);

    osc1.connect(envGain);
    osc2.connect(envGain);
    envGain.connect(panner);

    panner.connect(this.dryGain);
    panner.connect(this.masterDelay);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + attack + release + 0.1);
    osc2.stop(now + attack + release + 0.1);

    setTimeout(() => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        envGain.disconnect();
        panner.disconnect();
      } catch (_) {}
    }, (attack + release + 0.2) * 1000);
  }

  _startScheduler() {
    if (this._timer) clearTimeout(this._timer);

    const schedule = () => {
      if (this.isRunning && this.ctx && this.ctx.state === 'running') {
        this._lfoPhase += (this.params.swellRate * 0.35);
        if (this._lfoPhase > Math.PI * 2) this._lfoPhase -= Math.PI * 2;

        const swellVal = 0.5 + 0.5 * Math.sin(this._lfoPhase);
        const triggerChance = 0.15 + (this.params.density * 0.55) + (swellVal * 0.3);

        if (Math.random() < triggerChance) {
          this.triggerHarmonicGrain();
        }
      }
      const interval = Math.max(120, (1.1 - this.params.density) * 600 + Math.random() * 150);
      this._timer = setTimeout(schedule, interval);
    };
    schedule();
  }

  setParameter(param, value) {
    if (this.params[param] !== undefined) {
      this.params[param] = value;
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      if (param === 'gain' && this.outputNode) {
        this.outputNode.gain.setTargetAtTime(value, now, 0.02);
      } else if (param === 'wash' && this.wetGain) {
        this.wetGain.gain.setTargetAtTime(value, now, 0.02);
      } else if (param === 'delayTime' && this.masterDelay) {
        this.masterDelay.delayTime.setTargetAtTime(value, now, 0.03);
      } else if (param === 'feedback' && this.feedbackGain) {
        const safe = Math.min(0.78, value * 0.9);
        this.feedbackGain.gain.setTargetAtTime(safe, now, 0.02);
      } else if (param === 'interval') {
        this._updatePitchShifterModulation(now);
      }
    }
  }

  setParam(param, value) {
    this.setParameter(param, value);
  }

  connect(destination) {
    if (this.outputNode && destination) this.outputNode.connect(destination);
  }

  disconnect() {
    if (this.outputNode) this.outputNode.disconnect();
  }

  start() {
    this.isRunning = true;
    if (this.ctx && this.feedbackGain) {
      const safe = Math.min(0.78, this.params.feedback * 0.9);
      this.feedbackGain.gain.setTargetAtTime(safe, this.ctx.currentTime, 0.03);
    }
    this._startScheduler();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.ctx && this.feedbackGain && this.wetGain) {
      const now = this.ctx.currentTime;
      this.feedbackGain.gain.setValueAtTime(0.0, now);
      this.wetGain.gain.setValueAtTime(0.0, now);
    }
  }

  dispose() {
    this.stop();
    this.disconnect();
  }
}

if (typeof window !== 'undefined') {
  window.PrismPolarCloudDSP = PrismPolarCloudDSP;
  window.CustomNodeDSP = PrismPolarCloudDSP;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PrismPolarCloudDSP, PrismPolarNode: PrismPolarCloudDSP };
}
