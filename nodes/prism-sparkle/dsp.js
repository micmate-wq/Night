/**
 * PrismSparkleDSP - High-frequency modal FM synth and granular scatter engine
 * Tamed stereo shimmer feedback network & responsive parameter matrix
 */
class PrismSparkleDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.hpf = null;
    this.delayL = null;
    this.delayR = null;
    this.feedbackL = null;
    this.feedbackR = null;
    this.crossGain = null;
    this.pannerL = null;
    this.pannerR = null;
    this.shimmerFilter = null;
    this.limiter = null;
    this._timer = null;
    this.isRunning = false;

    // Scales (Frequencies mapped across C6 - C8)
    this.scales = [
      [1046.50, 1174.66, 1318.51, 1567.98, 1760.00, 2093.00, 2349.32, 2637.02, 3135.96], // C Major Pentatonic
      [1046.50, 1174.66, 1318.51, 1479.98, 1567.98, 1760.00, 1975.53, 2093.00, 2349.32], // Lydian High
      [1046.50, 1177.31, 1308.13, 1395.33, 1569.75, 1765.97, 1962.19, 2093.00, 2354.63], // Just Intonation Ratios
      [1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22]  // Chromatic
    ];

    // Node Parameters
    this.params = {
      density: 0.4,
      scatter: 0.5,
      shimmer: 0.45,
      cutoff: 6500,
      rootPitch: 0.0,
      decay: 0.35,
      scale: 0,
      gain: 0.7
    };
  }

  init(audioContext, options = {}) {
    this.ctx = audioContext;

    if (options.params) {
      Object.assign(this.params, options.params);
    }

    this._buildDSPGraph();
    this.start();
  }

  _buildDSPGraph() {
    if (!this.ctx) return;

    // Master Output & Safety Limiter
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(this.params.gain, this.ctx.currentTime);

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-6, this.ctx.currentTime);
    this.limiter.knee.setValueAtTime(10, this.ctx.currentTime);
    this.limiter.ratio.setValueAtTime(12, this.ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.limiter.release.setValueAtTime(0.1, this.ctx.currentTime);

    // Highpass Filter
    this.hpf = this.ctx.createBiquadFilter();
    this.hpf.type = "highpass";
    this.hpf.frequency.setValueAtTime(this.params.cutoff, this.ctx.currentTime);
    this.hpf.Q.setValueAtTime(0.7, this.ctx.currentTime);

    // Stereo Shimmer Delay Line with Safe Gain Ceiling
    this.delayL = this.ctx.createDelay(2.0);
    this.delayR = this.ctx.createDelay(2.0);
    this.delayL.delayTime.setValueAtTime(0.375, this.ctx.currentTime); // Dotted eighth
    this.delayR.delayTime.setValueAtTime(0.250, this.ctx.currentTime); // Quarter note

    // Scaled Feedback Gains (capped at 0.72 to prevent runaway howl)
    const safeFeedback = Math.min(0.72, this.params.shimmer * 0.8);
    this.feedbackL = this.ctx.createGain();
    this.feedbackR = this.ctx.createGain();
    this.feedbackL.gain.setValueAtTime(safeFeedback, this.ctx.currentTime);
    this.feedbackR.gain.setValueAtTime(safeFeedback, this.ctx.currentTime);

    this.crossGain = this.ctx.createGain();
    this.crossGain.gain.setValueAtTime(0.45, this.ctx.currentTime);

    this.pannerL = this.ctx.createStereoPanner();
    this.pannerR = this.ctx.createStereoPanner();
    this.pannerL.pan.setValueAtTime(-0.65, this.ctx.currentTime);
    this.pannerR.pan.setValueAtTime(0.65, this.ctx.currentTime);

    // High-frequency damping filter in the shimmer feedback loop
    this.shimmerFilter = this.ctx.createBiquadFilter();
    this.shimmerFilter.type = "bandpass";
    this.shimmerFilter.frequency.setValueAtTime(7500, this.ctx.currentTime);
    this.shimmerFilter.Q.setValueAtTime(0.8, this.ctx.currentTime);

    // Routing Graph:
    // Audio Sources -> HPF -> Limiter -> Output
    this.hpf.connect(this.limiter);
    this.limiter.connect(this.outputNode);

    // Left Delay Loop
    this.delayL.connect(this.pannerL);
    this.pannerL.connect(this.hpf);
    this.delayL.connect(this.feedbackL);
    this.feedbackL.connect(this.shimmerFilter);

    // Right Delay Loop
    this.delayR.connect(this.pannerR);
    this.pannerR.connect(this.hpf);
    this.delayR.connect(this.feedbackR);
    this.feedbackR.connect(this.shimmerFilter);

    // Cross-Feedback Link with Damping
    this.shimmerFilter.connect(this.crossGain);
    this.crossGain.connect(this.delayL);
    this.crossGain.connect(this.delayR);
  }

  // Trigger individual FM Modal Micro-Grain
  triggerSparkle() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.isRunning) return;
    const now = this.ctx.currentTime;

    // Pick base frequency from active scale
    const scaleIndex = Math.max(0, Math.min(this.scales.length - 1, Math.floor(this.params.scale)));
    const scale = this.scales[scaleIndex] || this.scales[0];
    let freq = scale[Math.floor(Math.random() * scale.length)];

    // Apply Root Pitch Shift (-12 to +12 semitones)
    const pitchFactor = Math.pow(2, (Number(this.params.rootPitch) || 0) / 12);
    freq = freq * pitchFactor;

    // Apply Pitch Jitter Scatter
    const scatterFactor = (Math.random() * 2 - 1) * (this.params.scatter * 0.12);
    freq = freq * (1 + scatterFactor);

    // Clamp within audio spectrum
    freq = Math.max(200, Math.min(18000, freq));

    // Modal / FM Synthesizer Node Group
    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const envGain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    // FM Ratios for Glassy/Metallic Timbre (Non-integer ratio)
    carrier.type = 'sine';
    modulator.type = 'sine';
    carrier.frequency.setValueAtTime(freq, now);
    modulator.frequency.setValueAtTime(freq * 3.41, now);

    // FM Index Decay Envelope
    const modDepth = Math.min(6000, freq * 1.4);
    modGain.gain.setValueAtTime(modDepth, now);
    modGain.gain.exponentialRampToValueAtTime(0.01, now + Math.max(0.04, this.params.decay * 0.4));

    // Amplitude Envelope (Glass Bell Impulse)
    const attack = 0.002;
    const release = Math.max(0.05, this.params.decay * (0.6 + Math.random() * 0.8));
    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.linearRampToValueAtTime(0.28, now + attack);
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);

    // Random Stereo Scattering per Grain
    panner.pan.setValueAtTime((Math.random() * 2) - 1, now);

    // Internal FM Connections
    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(envGain);
    envGain.connect(panner);

    // Direct routing into HPF and Shimmer Delay Network
    panner.connect(this.hpf);
    panner.connect(this.delayL);
    panner.connect(this.delayR);

    // Lifecycle Execution & Clean Teardown
    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + attack + release + 0.05);
    modulator.stop(now + attack + release + 0.05);

    setTimeout(() => {
      try {
        modulator.disconnect();
        modGain.disconnect();
        carrier.disconnect();
        envGain.disconnect();
        panner.disconnect();
      } catch (_) {}
    }, (attack + release + 0.1) * 1000);
  }

  _startGranularScheduler() {
    if (this._timer) clearTimeout(this._timer);

    const schedule = () => {
      if (this.isRunning && this.ctx && this.ctx.state === 'running') {
        const rateThreshold = 0.05 + (this.params.density * 0.9);
        if (Math.random() < rateThreshold) {
          this.triggerSparkle();
        }
      }
      const nextInterval = Math.max(20, (1 - this.params.density) * 350 + Math.random() * 50);
      this._timer = setTimeout(schedule, nextInterval);
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
      } else if (param === 'cutoff' && this.hpf) {
        this.hpf.frequency.setTargetAtTime(value, now, 0.02);
      } else if (param === 'shimmer' && this.feedbackL && this.feedbackR) {
        const safe = Math.min(0.72, value * 0.8);
        this.feedbackL.gain.setTargetAtTime(safe, now, 0.02);
        this.feedbackR.gain.setTargetAtTime(safe, now, 0.02);
      }
    }
  }

  setParam(param, value) {
    this.setParameter(param, value);
  }

  connect(destination) {
    if (this.outputNode && destination) {
      this.outputNode.connect(destination);
    }
  }

  disconnect() {
    if (this.outputNode) {
      this.outputNode.disconnect();
    }
  }

  start() {
    this.isRunning = true;
    if (this.ctx && this.feedbackL && this.feedbackR) {
      const safe = Math.min(0.72, this.params.shimmer * 0.8);
      const now = this.ctx.currentTime;
      this.feedbackL.gain.setTargetAtTime(safe, now, 0.03);
      this.feedbackR.gain.setTargetAtTime(safe, now, 0.03);
    }
    this._startGranularScheduler();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    // Instantly mute feedback loop tails to eliminate runaway noise on stop
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
  window.PrismSparkleDSP = PrismSparkleDSP;
  window.CustomNodeDSP = PrismSparkleDSP;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PrismSparkleDSP, PrismSparkleNode: PrismSparkleDSP };
}
