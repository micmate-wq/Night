/**
 * PrismCloudConvDSP - Harmonic Cloud with Reverb Fur Texture & Synthetic Convolution Hall
 * Supports Real-time Master Pitch Transposition
 */
class PrismCloudConvDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.dryGain = null;
    this.wetGain = null;
    this.convolver = null;
    this.preFilter = null;
    this.furFilter = null;

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
      decay: 5.0,
      fur: 0.65,
      dryWet: 0.60,
      gain: 0.75
    };
  }

  init(audioContext, options = {}) {
    this.ctx = audioContext;
    if (options.params) Object.assign(this.params, options.params);

    this._buildDSPGraph();
    this.start();
  }

  _generateSyntheticIR(durationSeconds = 5.0, fur = 0.65) {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate || 44100;
    const length = Math.max(1024, Math.floor(sampleRate * Math.min(10.0, durationSeconds)));
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const decayConstant = 3.6 / durationSeconds;
    const furDensity = 0.08 + (fur * 0.45);
    const alpha = 0.12 + (fur * 0.22);

    let filterL = 0;
    let filterR = 0;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * decayConstant);

      let furImpulseL = 0;
      let furImpulseR = 0;
      if (t < 0.12 && Math.random() < furDensity) {
        furImpulseL = (Math.random() > 0.5 ? 1 : -1) * (1.0 - t / 0.12) * (fur * 1.6);
        furImpulseR = (Math.random() > 0.5 ? 1 : -1) * (1.0 - t / 0.12) * (fur * 1.6);
      }

      const rawL = ((Math.random() * 2 - 1) * envelope) + furImpulseL;
      const rawR = ((Math.random() * 2 - 1) * envelope) + furImpulseR;

      filterL = filterL + alpha * (rawL - filterL);
      filterR = filterR + alpha * (rawR - filterR);

      left[i] = filterL;
      right[i] = filterR;
    }

    return buffer;
  }

  _buildDSPGraph() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(this.params.gain, now);

    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this._updateMixGains(now);

    // Warm pre-reverb filter
    this.preFilter = this.ctx.createBiquadFilter();
    this.preFilter.type = 'lowpass';
    const cutoff = 4000 + (this.params.fur * 7000);
    this.preFilter.frequency.setValueAtTime(cutoff, now);
    this.preFilter.Q.setValueAtTime(0.7, now);

    // High-frequency fur sheen enhancer
    this.furFilter = this.ctx.createBiquadFilter();
    this.furFilter.type = 'highshelf';
    this.furFilter.frequency.setValueAtTime(3200, now);
    this.furFilter.gain.setValueAtTime((this.params.fur - 0.5) * 8, now);

    // Synthetic Convolution Reverb
    this.convolver = this.ctx.createConvolver();
    this.convolver.normalize = true;
    try {
      this.convolver.buffer = this._generateSyntheticIR(this.params.decay, this.params.fur);
    } catch (e) {
      console.warn('Convolver IR build failed:', e);
    }

    // Routing Graph:
    this.preFilter.connect(this.convolver);
    this.convolver.connect(this.furFilter);
    this.furFilter.connect(this.wetGain);

    this.dryGain.connect(this.outputNode);
    this.wetGain.connect(this.outputNode);
  }

  _updateMixGains(time) {
    if (!this.dryGain || !this.wetGain || !this.ctx) return;
    const mix = Math.max(0, Math.min(1, this.params.dryWet));
    const dry = Math.cos(mix * 0.5 * Math.PI);
    const wet = Math.sin(mix * 0.5 * Math.PI);
    this.dryGain.gain.setTargetAtTime(dry, time, 0.02);
    this.wetGain.gain.setTargetAtTime(wet, time, 0.02);
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

    const detuneFactor1 = (Math.random() * 2 - 1) * 0.0025;
    const detuneFactor2 = (Math.random() * 2 - 1) * 0.0025;
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
    const peakGain = 0.09 + (swellVal * 0.11);

    const attack = Math.max(0.3, this.params.attack);
    const release = Math.max(1.0, this.params.release);

    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(peakGain, now + attack);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    panner.pan.setValueAtTime((Math.random() * 2 - 1) * 0.85, now);

    osc1.connect(envGain);
    osc2.connect(envGain);
    envGain.connect(panner);

    // Feed dry bus & convolution prefilter
    panner.connect(this.dryGain);
    panner.connect(this.preFilter);

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
      } else if (param === 'dryWet') {
        this._updateMixGains(now);
      } else if (param === 'fur') {
        if (this.preFilter) {
          const cutoff = 4000 + (value * 7000);
          this.preFilter.frequency.setTargetAtTime(cutoff, now, 0.02);
        }
        if (this.furFilter) {
          this.furFilter.gain.setTargetAtTime((value - 0.5) * 8, now, 0.02);
        }
        if (this.convolver) {
          try {
            this.convolver.buffer = this._generateSyntheticIR(this.params.decay, value);
          } catch (_) {}
        }
      } else if (param === 'decay' && this.convolver) {
        try {
          this.convolver.buffer = this._generateSyntheticIR(value, this.params.fur);
        } catch (_) {}
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
    if (this.ctx) {
      this._updateMixGains(this.ctx.currentTime);
    }
    this._startScheduler();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.ctx && this.wetGain && this.dryGain) {
      const now = this.ctx.currentTime;
      this.wetGain.gain.setValueAtTime(0.0, now);
      this.dryGain.gain.setValueAtTime(0.0, now);
    }
  }

  dispose() {
    this.stop();
    this.disconnect();
  }
}

if (typeof window !== 'undefined') {
  window.PrismCloudConvDSP = PrismCloudConvDSP;
  window.CustomNodeDSP = PrismCloudConvDSP;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PrismCloudConvDSP, PrismCloudNode: PrismCloudConvDSP };
}
