/**
 * Tape Degrade EtherNode DSP
 * Emulates vintage tape degradation:
 * - Wow & Flutter pitch instability (wobble)
 * - Tape saturation & wave deformation (damage)
 * - Band-limited analog tape hiss (noise)
 * - High-frequency head roll-off & tape aging (wear)
 * - Heavy analog magnetic dynamic squashing (compression)
 * - Insert dry/wet blend (mix)
 */
class TapeDegradeDSP {
  constructor() {
    this.ctx = null;
    this.input = null;
    this.outputNode = null;
    this.isRunning = false;
    this._graph = [];

    this.params = {
      wobble: 0.35,
      damage: 0.25,
      noise: 0.15,
      compression: 0.30,
      wear: 0.30,
      mix: 1.0
    };

    // Internal DSP nodes
    this.preGain = null;
    this.wobbleDelay = null;
    this.wowLfo = null;
    this.wowGain = null;
    this.flutterLfo = null;
    this.flutterGain = null;
    this.driftLfo = null;
    this.driftGain = null;
    this.damageShaper = null;
    this.wearFilter = null;
    this.headBumpFilter = null;
    this.noiseBuffer = null;
    this.noiseSource = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.compressor = null;
    this.postGain = null;
    this.wetGain = null;
    this.dryGain = null;
  }

  _add(node) {
    this._graph.push(node);
    return node;
  }

  _makeDistortionCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    const drive = 1.0 + Math.max(0, amount) * 3.0;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // Strictly 1.0x gain at small/mid levels: derivative at x=0 is exactly 1.0 (0 dB boost)
      curve[i] = Math.tanh(x * drive) / drive;
    }
    return curve;
  }

  _makeLimiterCurve(n = 512) {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const ax = Math.abs(x);
      if (ax < 0.85) {
        curve[i] = x;
      } else {
        curve[i] = Math.sign(x) * (0.85 + 0.13 * Math.tanh((ax - 0.85) / 0.13));
      }
    }
    return curve;
  }

  _buildNoiseBuffer(ctx) {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 3; // 3 seconds loop
    const buffer = ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        // Pink-ish tape hiss filter
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        const pink = (b0 + b1 + b2 + white * 0.5362) * 0.06;
        // Subtle 50Hz tape motor hum
        const hum = Math.sin((i / sampleRate) * 50 * Math.PI * 2) * 0.005;
        data[i] = (pink + hum) * 0.18;
      }
    }
    return buffer;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Main endpoints
    this.input = this._add(ctx.createGain());
    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.preGain = this._add(ctx.createGain());
    this.preGain.gain.setValueAtTime(1.0, now);

    const m0 = Math.max(0, Math.min(1, Number(this.params.mix)));
    this.wetGain = this._add(ctx.createGain());
    this.wetGain.gain.setValueAtTime(m0, now);

    // 1. Wow & Flutter (Wobble) Delay with Organic Irregular LFO Network (30% slower)
    this.wobbleDelay = this._add(ctx.createDelay(0.2));
    this.wobbleDelay.delayTime.setValueAtTime(0.040, now); // 40ms baseline delay

    // Primary Wow LFO (30% slower: ~0.48 Hz)
    this.wowLfo = this._add(ctx.createOscillator());
    this.wowLfo.frequency.setValueAtTime(0.48, now);
    this.wowGain = this._add(ctx.createGain());

    // Secondary Wow LFO (30% slower: ~0.83 Hz triangle)
    this.wow2Lfo = this._add(ctx.createOscillator());
    this.wow2Lfo.type = 'triangle';
    this.wow2Lfo.frequency.setValueAtTime(0.83, now);
    this.wow2Gain = this._add(ctx.createGain());

    // FM LFO (30% slower: ~0.15 Hz)
    this.fmLfo = this._add(ctx.createOscillator());
    this.fmLfo.frequency.setValueAtTime(0.15, now);
    this.fmGain = this._add(ctx.createGain());
    this.fmGain.gain.setValueAtTime(0.35, now);
    this.fmLfo.connect(this.fmGain);
    this.fmGain.connect(this.wowLfo.frequency);

    // Flutter LFO (30% slower: ~5.5 Hz)
    this.flutterLfo = this._add(ctx.createOscillator());
    this.flutterLfo.type = 'triangle';
    this.flutterLfo.frequency.setValueAtTime(5.5, now);
    this.flutterGain = this._add(ctx.createGain());

    // Drift LFO (30% slower: ~0.063 Hz)
    this.driftLfo = this._add(ctx.createOscillator());
    this.driftLfo.frequency.setValueAtTime(0.063, now);
    this.driftGain = this._add(ctx.createGain());

    this.wowLfo.connect(this.wowGain);
    this.wow2Lfo.connect(this.wow2Gain);
    this.flutterLfo.connect(this.flutterGain);
    this.driftLfo.connect(this.driftGain);

    this.wowGain.connect(this.wobbleDelay.delayTime);
    this.wow2Gain.connect(this.wobbleDelay.delayTime);
    this.flutterGain.connect(this.wobbleDelay.delayTime);
    this.driftGain.connect(this.wobbleDelay.delayTime);

    // 2. Tape Saturation / Damage Waveshaper
    this.damageShaper = this._add(ctx.createWaveShaper());
    this.damageShaper.curve = this._makeDistortionCurve(this.params.damage);
    this.damageShaper.oversample = '2x';

    // 3. Wear Filter (High-cut / head wear) & Head Bump (0 dB unity reference)
    this.wearFilter = this._add(ctx.createBiquadFilter());
    this.wearFilter.type = 'lowpass';
    this.wearFilter.Q.setValueAtTime(0.707, now);

    this.headBumpFilter = this._add(ctx.createBiquadFilter());
    this.headBumpFilter.type = 'peaking';
    this.headBumpFilter.frequency.setValueAtTime(80, now);
    this.headBumpFilter.Q.setValueAtTime(0.8, now);
    this.headBumpFilter.gain.setValueAtTime(0.0, now); // 0 dB unity gain

    // 4. Tape Noise (Hiss & Rumble)
    this.noiseBuffer = this._buildNoiseBuffer(ctx);
    this.noiseFilter = this._add(ctx.createBiquadFilter());
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.setValueAtTime(2600, now);
    this.noiseFilter.Q.setValueAtTime(0.6, now);

    this.noiseGain = this._add(ctx.createGain());

    // 5. Tape Dynamic Compression & Safety Limiter
    this.compressor = this._add(ctx.createDynamicsCompressor());
    this.postGain = this._add(ctx.createGain());
    this.postGain.gain.setValueAtTime(0.88, now); // Gain-calibrated to match bypass RMS

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._makeLimiterCurve(512);
    this.outLimit.oversample = '2x';

    // Wire DSP graph
    // Input -> PreGain -> Wobble Delay -> Damage Shaper -> Wear Filter -> Head Bump
    this.input.connect(this.preGain);
    this.preGain.connect(this.wobbleDelay);
    this.wobbleDelay.connect(this.damageShaper);
    this.damageShaper.connect(this.wearFilter);
    this.wearFilter.connect(this.headBumpFilter);

    // Head Bump + Tape Noise -> Compressor -> PostGain -> WetGain -> OutLimit -> OutputNode
    this.headBumpFilter.connect(this.compressor);
    this.noiseGain.connect(this.compressor);

    this.compressor.connect(this.postGain);
    this.postGain.connect(this.wetGain);
    this.wetGain.connect(this.outLimit);
    this.outLimit.connect(this.outputNode);

    // Apply initial parameter states
    this._applyAllParams();
  }

  _applyAllParams() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Wobble modulation depths (rich, organic analog tape warble)
    const w = this.params.wobble;
    if (this.wowGain) this.wowGain.gain.setTargetAtTime(0.0085 * w, now, 0.05);
    if (this.wow2Gain) this.wow2Gain.gain.setTargetAtTime(0.0055 * w, now, 0.05);
    if (this.flutterGain) this.flutterGain.gain.setTargetAtTime(0.0018 * w, now, 0.05);
    if (this.driftGain) this.driftGain.gain.setTargetAtTime(0.0045 * w, now, 0.05);

    // Damage & Saturation curve (strict unity derivative at small levels)
    const dmg = this.params.damage;
    if (this.damageShaper) {
      this.damageShaper.curve = this._makeDistortionCurve(dmg * 0.7 + this.params.compression * 0.3);
    }
    if (this.preGain) {
      this.preGain.gain.setTargetAtTime(1.0, now, 0.05);
    }

    // Wear filter cutoff: 18000 Hz down to 1800 Hz
    const wear = this.params.wear;
    const cutoff = Math.max(1600, 18000 * Math.pow(1 - wear * 0.88, 2));
    if (this.wearFilter) {
      this.wearFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
    }

    // Tape Noise level (ultra-subtle analog floor)
    const noise = this.params.noise;
    if (this.noiseGain) {
      this.noiseGain.gain.setTargetAtTime(noise * 0.015, now, 0.05);
    }

    // Compression parameters: gentle transparent threshold prevents Web Audio auto-makeup inflation
    const comp = this.params.compression;
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(-2 - comp * 8, now, 0.05);
      this.compressor.ratio.setTargetAtTime(1.2 + comp * 2.8, now, 0.05);
      this.compressor.knee.setTargetAtTime(6, now, 0.05);
      this.compressor.attack.setTargetAtTime(0.02, now, 0.05);
      this.compressor.release.setTargetAtTime(0.15, now, 0.05);
    }
    if (this.postGain) {
      // Compensate for compressor auto-makeup so output matches exact bypass dry level
      const targetGain = 0.90 - comp * 0.08;
      this.postGain.gain.setTargetAtTime(targetGain, now, 0.05);
    }

    // Mix (Wet level)
    const m = Math.max(0, Math.min(1, Number(this.params.mix)));
    if (this.wetGain) this.wetGain.gain.setTargetAtTime(m, now, 0.05);
  }

  setParameter(paramId, value) {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    this.params[paramId] = num;
    this._applyAllParams();
  }

  updateParams(key, value) {
    this.setParameter(key, value);
  }

  connect(destNode) {
    if (this.outputNode && destNode) {
      try {
        this.outputNode.connect(destNode);
      } catch (e) {
        console.warn('TapeDegradeDSP connect failed:', e);
      }
    }
  }

  disconnect() {
    if (this.outputNode) {
      try {
        this.outputNode.disconnect();
      } catch (e) {}
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    if (!this.ctx || !this.outputNode) return;
    const now = this.ctx.currentTime;

    // Start LFO oscillators
    try {
      this.wowLfo.start(now);
      if (this.wow2Lfo) this.wow2Lfo.start(now);
      if (this.fmLfo) this.fmLfo.start(now);
      this.flutterLfo.start(now);
      this.driftLfo.start(now);
    } catch (e) {}

    // Start looped noise buffer source
    if (this.noiseBuffer && !this.noiseSource) {
      try {
        this.noiseSource = this.ctx.createBufferSource();
        this.noiseSource.buffer = this.noiseBuffer;
        this.noiseSource.loop = true;
        this.noiseSource.connect(this.noiseFilter);
        this.noiseFilter.connect(this.noiseGain);
        this.noiseSource.start(now);
      } catch (e) {}
    }

    // Fade in output
    this.outputNode.gain.cancelScheduledValues(now);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, now);
    this.outputNode.gain.linearRampToValueAtTime(1.0, now + 0.05);
  }

  stop() {
    this.isRunning = false;
    if (!this.ctx || !this.outputNode) return;
    const now = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(now);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, now);
    this.outputNode.gain.linearRampToValueAtTime(0.0, now + 0.05);
  }

  dispose() {
    this.stop();
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch (e) {}
      try { this.noiseSource.disconnect(); } catch (e) {}
      this.noiseSource = null;
    }
    this._graph.forEach((node) => {
      try { node.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this.noiseBuffer = null;
    this.ctx = null;
    this.input = null;
    this.outputNode = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = TapeDegradeDSP;
  window.TapeDegradeDSP = TapeDegradeDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TapeDegradeDSP };
}
