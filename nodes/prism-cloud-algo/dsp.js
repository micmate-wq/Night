/**
 * PrismCloudAlgoDSP - Harmonic Cloud with Algorithmic Allpass Wash & Breathing Dynamics
 * Node A: Algorithmic Reverb Model with Real-time Master Pitch Transposition
 */
class PrismCloudAlgoDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.reverbInput = null;
    this.dryGain = null;
    this.wetGain = null;

    // Allpass diffusion cascade
    this.allpassFilters = [];

    // Stereo feedback delay loop
    this.delayL = null;
    this.delayR = null;
    this.feedbackL = null;
    this.feedbackR = null;
    this.crossL = null;
    this.crossR = null;
    this.dampingFilter = null;

    // Modulation LFO for delay lines
    this.lfo = null;
    this.lfoGainL = null;
    this.lfoGainR = null;

    this.isRunning = false;
    this._timer = null;
    this._lfoPhase = 0;

    // Chord voicings mapped in C5 - C7 high register
    this.chords = [
      // 0: Maj9 (C5, G5, B5, D6, E6, G6, B6, D7, E7)
      [523.25, 783.99, 987.77, 1174.66, 1318.51, 1567.98, 1975.53, 2349.32, 2637.02],
      // 1: Min11 (C5, Eb5, G5, Bb5, D6, F6, G6, Bb6, D7)
      [523.25, 622.25, 783.99, 932.33, 1174.66, 1396.91, 1567.98, 1864.66, 2349.32],
      // 2: Sus2 (C5, D5, G5, C6, D6, G6, C7, D7, G7)
      [523.25, 587.33, 783.99, 1046.50, 1174.66, 1567.98, 2093.00, 2349.32, 3135.96],
      // 3: Lydian Add9 (C5, E5, F#5, G5, D6, E6, F#6, B6, D7)
      [523.25, 659.25, 739.99, 783.99, 1174.66, 1318.51, 1479.98, 1975.53, 2349.32]
    ];

    this.params = {
      chord: 0,
      rootPitch: 0.0,
      density: 0.45,
      swellRate: 0.22,
      attack: 1.2,
      release: 4.2,
      wash: 0.72,
      gain: 0.75
    };
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
    this.dryGain.gain.setValueAtTime(0.35, now);
    this.wetGain.gain.setValueAtTime(this.params.wash, now);

    this.reverbInput = this.ctx.createGain();
    this.reverbInput.gain.setValueAtTime(1.0, now);

    // 4-stage all-pass diffusion cascade
    this.allpassFilters = [];
    const apFreqs = [225, 556, 1341, 3210];
    let prevNode = this.reverbInput;

    apFreqs.forEach(freq => {
      const ap = this.ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.setValueAtTime(freq, now);
      ap.Q.setValueAtTime(1.4, now);
      prevNode.connect(ap);
      prevNode = ap;
      this.allpassFilters.push(ap);
    });

    // Modulated Stereo Delay Network
    this.delayL = this.ctx.createDelay(1.5);
    this.delayR = this.ctx.createDelay(1.5);
    this.delayL.delayTime.setValueAtTime(0.187, now);
    this.delayR.delayTime.setValueAtTime(0.263, now);

    // Microscopic LFO for Chorus Diffusion
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.setValueAtTime(0.16, now);

    this.lfoGainL = this.ctx.createGain();
    this.lfoGainR = this.ctx.createGain();
    this.lfoGainL.gain.setValueAtTime(0.0035, now);
    this.lfoGainR.gain.setValueAtTime(-0.0035, now);

    this.lfo.connect(this.lfoGainL);
    this.lfo.connect(this.lfoGainR);
    this.lfoGainL.connect(this.delayL.delayTime);
    this.lfoGainR.connect(this.delayR.delayTime);
    this.lfo.start(now);

    // Feedback & Cross-Mixing with safety cap
    const safeFeedback = Math.min(0.78, this.params.wash * 0.85);
    this.feedbackL = this.ctx.createGain();
    this.feedbackR = this.ctx.createGain();
    this.feedbackL.gain.setValueAtTime(safeFeedback, now);
    this.feedbackR.gain.setValueAtTime(safeFeedback, now);

    this.crossL = this.ctx.createGain();
    this.crossR = this.ctx.createGain();
    this.crossL.gain.setValueAtTime(0.25, now);
    this.crossR.gain.setValueAtTime(0.25, now);

    // Warm high-damping filter inside the feedback loop
    this.dampingFilter = this.ctx.createBiquadFilter();
    this.dampingFilter.type = 'lowpass';
    this.dampingFilter.frequency.setValueAtTime(4800, now);
    this.dampingFilter.Q.setValueAtTime(0.7, now);

    // Connect diffusion cascade to delay lines
    prevNode.connect(this.delayL);
    prevNode.connect(this.delayR);

    // Loop Left
    this.delayL.connect(this.dampingFilter);
    this.dampingFilter.connect(this.feedbackL);
    this.feedbackL.connect(this.delayL);
    this.feedbackL.connect(this.crossR);
    this.crossR.connect(this.delayR);

    // Loop Right
    this.delayR.connect(this.feedbackR);
    this.feedbackR.connect(this.delayR);
    this.feedbackR.connect(this.crossL);
    this.crossL.connect(this.delayL);

    // Sum wet path
    const pannerL = this.ctx.createStereoPanner();
    const pannerR = this.ctx.createStereoPanner();
    pannerL.pan.setValueAtTime(-0.8, now);
    pannerR.pan.setValueAtTime(0.8, now);

    this.delayL.connect(pannerL);
    this.delayR.connect(pannerR);
    pannerL.connect(this.wetGain);
    pannerR.connect(this.wetGain);

    // Master sum
    this.dryGain.connect(this.outputNode);
    this.wetGain.connect(this.outputNode);
  }

  triggerHarmonicGrain() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.isRunning) return;
    const now = this.ctx.currentTime;

    const chordList = this.chords[Math.min(this.chords.length - 1, Math.max(0, Math.floor(this.params.chord)))] || this.chords[0];
    const rawNote1 = chordList[Math.floor(Math.random() * chordList.length)];
    let rawNote2 = chordList[Math.floor(Math.random() * chordList.length)];

    // Apply Root Pitch Transposition
    const pitchRatio = Math.pow(2, (Number(this.params.rootPitch) || 0) / 12);
    const note1 = rawNote1 * pitchRatio;
    const note2 = rawNote2 * pitchRatio;

    const detuneFactor1 = (Math.random() * 2 - 1) * 0.003;
    const detuneFactor2 = (Math.random() * 2 - 1) * 0.003;
    const freq1 = Math.max(100, Math.min(18000, note1 * (1 + detuneFactor1)));
    const freq2 = Math.max(100, Math.min(18000, note2 * (1 + detuneFactor2)));

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const envGain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq1, now);
    osc2.frequency.setValueAtTime(freq2, now);

    // Breathing swell modulation amplitude
    const swellVal = 0.5 + 0.5 * Math.sin(this._lfoPhase);
    const peakGain = 0.08 + (swellVal * 0.12);

    const attack = Math.max(0.3, this.params.attack);
    const release = Math.max(1.0, this.params.release);

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, now);

    osc1.connect(envGain);
    osc2.connect(envGain);
    envGain.connect(panner);

    // Feed both dry and algorithmic wash
    panner.connect(this.dryGain);
    panner.connect(this.reverbInput);

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
      } else if (param === 'wash') {
        const safe = Math.min(0.78, value * 0.85);
        if (this.wetGain) this.wetGain.gain.setTargetAtTime(value, now, 0.02);
        if (this.feedbackL) this.feedbackL.gain.setTargetAtTime(safe, now, 0.02);
        if (this.feedbackR) this.feedbackR.gain.setTargetAtTime(safe, now, 0.02);
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
    if (this.ctx && this.feedbackL && this.feedbackR) {
      const safe = Math.min(0.78, this.params.wash * 0.85);
      const now = this.ctx.currentTime;
      this.feedbackL.gain.setTargetAtTime(safe, now, 0.03);
      this.feedbackR.gain.setTargetAtTime(safe, now, 0.03);
    }
    this._startScheduler();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.ctx && this.feedbackL && this.feedbackR) {
      const now = this.ctx.currentTime;
      this.feedbackL.gain.setValueAtTime(0.0, now);
      this.feedbackR.gain.setValueAtTime(0.0, now);
    }
  }

  dispose() {
    this.stop();
    this.disconnect();
  }
}

if (typeof window !== 'undefined') {
  window.PrismCloudAlgoDSP = PrismCloudAlgoDSP;
  window.CustomNodeDSP = PrismCloudAlgoDSP;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PrismCloudAlgoDSP, PrismCloudNode: PrismCloudAlgoDSP };
}
