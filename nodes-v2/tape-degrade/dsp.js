/**
 * Tape Degrade — Aether Node V2 (insert, not-tempo-aware)
 *
 * Port of nodes/tape-degrade (v1). The sound graph is unchanged:
 *   input -> wobble delay (wow / flutter / drift LFOs) -> saturation -> wear low-pass
 *   -> head bump -> (+ hiss) -> compressor -> post gain -> wet (mix) -> soft limiter -> out
 *
 * What changed vs v1:
 * - getParameter / getParameters; setParameter clamps to manifest ranges and ignores
 *   unknown ids. v1 stored any id it was given.
 * - setParameter only touches what the parameter affects. v1 recomputed every node and
 *   rebuilt the saturation curve on every knob move (heavy, and zippery while morphing);
 *   v2 keeps one fixed curve and moves the drive with smoothed gains.
 * - LFOs start in init() (they make no sound on their own) so stop()/start() can repeat
 *   cleanly. The hiss source runs only while started.
 * - Silent until start(); stop() fades the output in 50 ms (same as v1).
 * - dispose() stops oscillators and the hiss source.
 */

const TAPE_MAX_DRIVE = 4;

const TAPE_DEGRADE_V2_PARAMS = [
  { id: 'wobble',      min: 0, max: 1, def: 0.35 },
  { id: 'damage',      min: 0, max: 1, def: 0.25 },
  { id: 'noise',       min: 0, max: 1, def: 0.15 },
  { id: 'compression', min: 0, max: 1, def: 0.30 },
  { id: 'wear',        min: 0, max: 1, def: 0.30 },
  { id: 'mix',         min: 0, max: 1, def: 1.0 }
];

class TapeDegradeV2DSP {
  constructor() {
    this.ctx = null;
    this.host = null;
    this.input = null;
    this.outputNode = null;
    this.isRunning = false;
    this._graph = [];
    this._oscs = [];
    this.noiseSource = null;
    this.params = {};
    TAPE_DEGRADE_V2_PARAMS.forEach(s => { this.params[s.id] = s.def; });
  }

  _add(node) { this._graph.push(node); return node; }

  _osc(type, freq) {
    const o = this._add(this.ctx.createOscillator());
    o.type = type;
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    this._oscs.push(o);
    return o;
  }

  // Fixed tanh curve at maximum drive. The actual drive d (1..4) is set with a
  // pre-gain of d/4 and a post-gain of 1/d, which gives tanh(d*x)/d exactly like v1,
  // but can glide smoothly (v1 swapped the whole curve on every knob move).
  static _saturationCurve() {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * TAPE_MAX_DRIVE);
    }
    return curve;
  }

  _drive() {
    const p = this.params;
    return 1 + Math.max(0, p.damage * 0.7 + p.compression * 0.3) * 3;
  }

  static _limiterCurve(n = 512) {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      curve[i] = ax < 0.85 ? x : Math.sign(x) * (0.85 + 0.13 * Math.tanh((ax - 0.85) / 0.13));
    }
    return curve;
  }

  static _hissBuffer(ctx) {
    const sr = ctx.sampleRate, length = sr * 3;
    const buffer = ctx.createBuffer(2, length, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        const pink = (b0 + b1 + b2 + w * 0.5362) * 0.06;
        const hum = Math.sin((i / sr) * 50 * Math.PI * 2) * 0.005;
        d[i] = (pink + hum) * 0.18;
      }
    }
    return buffer;
  }

  /** Silent: builds the graph; output stays at 0 until start(). */
  init(audioContext, host = {}) {
    this.ctx = audioContext;
    this.host = host || {};
    const ctx = this.ctx, now = ctx.currentTime;

    this.input = this._add(ctx.createGain());
    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.preGain = this._add(ctx.createGain());
    this.wetGain = this._add(ctx.createGain());

    // Wobble: modulated delay line
    this.wobbleDelay = this._add(ctx.createDelay(0.2));
    this.wobbleDelay.delayTime.setValueAtTime(0.040, now);
    this.wowGain = this._add(ctx.createGain());
    this.wow2Gain = this._add(ctx.createGain());
    this.flutterGain = this._add(ctx.createGain());
    this.driftGain = this._add(ctx.createGain());
    this.fmGain = this._add(ctx.createGain());
    this.fmGain.gain.setValueAtTime(0.35, now);
    const wow = this._osc('sine', 0.48);
    const wow2 = this._osc('triangle', 0.83);
    const fm = this._osc('sine', 0.15);
    const flutter = this._osc('triangle', 5.5);
    const drift = this._osc('sine', 0.063);
    fm.connect(this.fmGain); this.fmGain.connect(wow.frequency);
    wow.connect(this.wowGain); wow2.connect(this.wow2Gain);
    flutter.connect(this.flutterGain); drift.connect(this.driftGain);
    [this.wowGain, this.wow2Gain, this.flutterGain, this.driftGain]
      .forEach(g => g.connect(this.wobbleDelay.delayTime));

    // Saturation, wear, head bump
    this.damageShaper = this._add(ctx.createWaveShaper());
    this.damageShaper.curve = TapeDegradeV2DSP._saturationCurve();
    this.damageShaper.oversample = '2x';
    this.satPost = this._add(ctx.createGain());
    this.wearFilter = this._add(ctx.createBiquadFilter());
    this.wearFilter.type = 'lowpass';
    this.wearFilter.Q.setValueAtTime(0.707, now);
    this.headBump = this._add(ctx.createBiquadFilter());
    this.headBump.type = 'peaking';
    this.headBump.frequency.setValueAtTime(80, now);
    this.headBump.Q.setValueAtTime(0.8, now);
    this.headBump.gain.setValueAtTime(0, now);

    // Hiss
    this.hissBuffer = TapeDegradeV2DSP._hissBuffer(ctx);
    this.noiseFilter = this._add(ctx.createBiquadFilter());
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.setValueAtTime(2600, now);
    this.noiseFilter.Q.setValueAtTime(0.6, now);
    this.noiseGain = this._add(ctx.createGain());
    this.noiseFilter.connect(this.noiseGain);

    // Dynamics + safety limiter
    this.compressor = this._add(ctx.createDynamicsCompressor());
    this.compressor.knee.setValueAtTime(6, now);
    this.compressor.attack.setValueAtTime(0.02, now);
    this.compressor.release.setValueAtTime(0.15, now);
    this.postGain = this._add(ctx.createGain());
    this.limiter = this._add(ctx.createWaveShaper());
    this.limiter.curve = TapeDegradeV2DSP._limiterCurve(512);
    this.limiter.oversample = '2x';

    this.input.connect(this.preGain);
    this.preGain.connect(this.wobbleDelay);
    this.wobbleDelay.connect(this.damageShaper);
    this.damageShaper.connect(this.satPost);
    this.satPost.connect(this.wearFilter);
    this.wearFilter.connect(this.headBump);
    this.headBump.connect(this.compressor);
    this.noiseGain.connect(this.compressor);
    this.compressor.connect(this.postGain);
    this.postGain.connect(this.wetGain);
    this.wetGain.connect(this.limiter);
    this.limiter.connect(this.outputNode);

    this._oscs.forEach(o => o.start(now));
    TAPE_DEGRADE_V2_PARAMS.forEach(s => this._apply(s.id, true));
    return this.outputNode;
  }

  /** Apply one parameter to the graph. `instant` sets values without smoothing. */
  _apply(id, instant = false) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime, p = this.params;
    const set = (param, v) => instant ? param.setValueAtTime(v, now) : param.setTargetAtTime(v, now, 0.05);
    switch (id) {
      case 'wobble':
        set(this.wowGain.gain, 0.0085 * p.wobble);
        set(this.wow2Gain.gain, 0.0055 * p.wobble);
        set(this.flutterGain.gain, 0.0018 * p.wobble);
        set(this.driftGain.gain, 0.0045 * p.wobble);
        break;
      case 'damage': {
        const d = this._drive();
        set(this.preGain.gain, d / TAPE_MAX_DRIVE);
        set(this.satPost.gain, 1 / d);
        break;
      }
      case 'wear':
        set(this.wearFilter.frequency, Math.max(1600, 18000 * Math.pow(1 - p.wear * 0.88, 2)));
        break;
      case 'noise':
        set(this.noiseGain.gain, p.noise * 0.015);
        break;
      case 'compression':
        set(this.compressor.threshold, -2 - p.compression * 8);
        set(this.compressor.ratio, 1.2 + p.compression * 2.8);
        set(this.postGain.gain, 0.90 - p.compression * 0.08);
        this._apply('damage', instant);
        break;
      case 'mix':
        set(this.wetGain.gain, p.mix);
        break;
    }
  }

  start(snapshot) {
    if (!this.ctx || !this.outputNode) return;
    const now = this.ctx.currentTime;
    if (!this.noiseSource) {
      this.noiseSource = this.ctx.createBufferSource();
      this.noiseSource.buffer = this.hissBuffer;
      this.noiseSource.loop = true;
      this.noiseSource.connect(this.noiseFilter);
      this.noiseSource.start(now);
    }
    this.isRunning = true;
    const g = this.outputNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1.0, now + 0.05);
  }

  stop() {
    this.isRunning = false;
    if (!this.ctx || !this.outputNode) return;
    const now = this.ctx.currentTime;
    const g = this.outputNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0, now + 0.05);
    if (this.noiseSource) {
      const src = this.noiseSource;
      this.noiseSource = null;
      try { src.stop(now + 0.06); } catch (_) {}
      src.onended = () => { try { src.disconnect(); } catch (_) {} };
    }
  }

  setParameter(paramId, value) {
    const spec = TAPE_DEGRADE_V2_PARAMS.find(s => s.id === paramId);
    if (!spec) return;
    let v = Number(value);
    if (!Number.isFinite(v)) return;
    v = Math.max(spec.min, Math.min(spec.max, v));
    this.params[paramId] = v;
    this._apply(paramId);
  }

  updateParams(key, value) { this.setParameter(key, value); }   // v1 alias
  getParameter(paramId) { return this.params[paramId]; }
  getParameters() { return Object.assign({}, this.params); }

  connect(destination) {
    if (this.outputNode && destination) this.outputNode.connect(destination);
  }

  disconnect() {
    if (this.outputNode) { try { this.outputNode.disconnect(); } catch (_) {} }
  }

  dispose() {
    this.stop();
    this._oscs.forEach(o => { try { o.stop(); } catch (_) {} });
    this._graph.forEach(n => { try { n.disconnect(); } catch (_) {} });
    this._oscs = [];
    this._graph = [];
    this.hissBuffer = null;
    this.input = null;
    this.outputNode = null;
    this.ctx = null;
    this.host = null;
  }
}

if (typeof window !== 'undefined') {
  window.TapeDegradeV2DSP = TapeDegradeV2DSP;
  window.CustomNodeDSP = TapeDegradeV2DSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TapeDegradeV2DSP, CustomNodeDSP: TapeDegradeV2DSP };
}
