/**
 * Body — pitched resonant body for Aether.
 * Rings grammar, not a clone. Audio in is the EXCITER.
 * A field recording becomes a note, not a bowl generator.
 *
 * Eight DelayNode combs (Karplus / modal) + a little bandpass.
 * Feedback is capped. Messy input hits a compressor then a brickwall.
 * Native Web Audio only. No AudioWorklet. No FFT.
 */
class BodyDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
    this.isRunning = false;
    this._graph = [];
    this._tapeSource = null;
    this._tapeBuffer = null;
    this.modes = [];
    this.params = {
      structure: 0.42,
      brightness: 0.55,
      damping: 0.45,
      position: 0.35
    };
  }

  _add(node) {
    this._graph.push(node);
    return node;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.input = this._add(ctx.createGain());
    this.input.gain.setValueAtTime(1, now);

    this.dryGain = this._add(ctx.createGain());
    this.dryGain.gain.setValueAtTime(0.07, now);

    this.exciterHP = this._add(ctx.createBiquadFilter());
    this.exciterHP.type = 'highpass';
    this.exciterHP.frequency.setValueAtTime(70, now);
    this.exciterHP.Q.setValueAtTime(0.7, now);

    this.exciterComp = this._add(ctx.createDynamicsCompressor());
    this.exciterComp.threshold.setValueAtTime(-28, now);
    this.exciterComp.knee.setValueAtTime(10, now);
    this.exciterComp.ratio.setValueAtTime(12, now);
    this.exciterComp.attack.setValueAtTime(0.002, now);
    this.exciterComp.release.setValueAtTime(0.09, now);

    this.exciterClip = this._add(ctx.createWaveShaper());
    this.exciterClip.curve = this._tanhCurve(256, 1.8);
    this.exciterClip.oversample = '2x';

    this.exciterLP = this._add(ctx.createBiquadFilter());
    this.exciterLP.type = 'lowpass';
    this.exciterLP.Q.setValueAtTime(0.55, now);
    this.exciterLP.frequency.setValueAtTime(2800, now);

    this.exciterGain = this._add(ctx.createGain());
    this.exciterGain.gain.setValueAtTime(0.18, now);

    this.wetSum = this._add(ctx.createGain());
    this.wetSum.gain.setValueAtTime(1, now);

    this.bodyBP = this._add(ctx.createBiquadFilter());
    this.bodyBP.type = 'bandpass';
    this.bodyBP.frequency.setValueAtTime(180, now);
    this.bodyBP.Q.setValueAtTime(0.55, now);

    this.bodyLP = this._add(ctx.createBiquadFilter());
    this.bodyLP.type = 'lowpass';
    this.bodyLP.Q.setValueAtTime(0.7, now);
    this.bodyLP.frequency.setValueAtTime(6200, now);

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-16, now);
    this.outComp.knee.setValueAtTime(6, now);
    this.outComp.ratio.setValueAtTime(18, now);
    this.outComp.attack.setValueAtTime(0.001, now);
    this.outComp.release.setValueAtTime(0.08, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._brickCurve(1024);
    this.outLimit.oversample = '2x';

    this.wetGain = this._add(ctx.createGain());
    this.wetGain.gain.setValueAtTime(0.92, now);

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    let maxDelay = 0.12;
    let proto = null;
    const delayCands = [0.12, 0.08, 0.05, 1];
    for (let c = 0; c < delayCands.length; c++) {
      try {
        proto = ctx.createDelay(delayCands[c]);
        maxDelay = delayCands[c];
        break;
      } catch (e) {
        proto = null;
      }
    }
    if (!proto) {
      proto = ctx.createDelay();
      maxDelay = 1;
    }
    this._maxDelay = maxDelay;
    this._add(proto);

    this.modes = [];
    const nModes = 8;
    for (let i = 0; i < nModes; i++) {
      const inj = this._add(ctx.createGain());
      inj.gain.setValueAtTime(0.2, now);
      const delay = (i === 0) ? proto : this._add(ctx.createDelay(this._maxDelay));
      delay.delayTime.setValueAtTime(0.01, now);
      const damp = this._add(ctx.createBiquadFilter());
      damp.type = 'lowpass';
      damp.Q.setValueAtTime(0.5, now);
      damp.frequency.setValueAtTime(2400, now);
      const fb = this._add(ctx.createGain());
      fb.gain.setValueAtTime(0.8, now);
      const tap = this._add(ctx.createGain());
      tap.gain.setValueAtTime(0.3, now);

      this.exciterGain.connect(inj);
      inj.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(tap);
      tap.connect(this.wetSum);

      this.modes.push({ inj, delay, damp, fb, tap });
    }

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    this.input.connect(this.exciterHP);
    this.exciterHP.connect(this.exciterComp);
    this.exciterComp.connect(this.exciterClip);
    this.exciterClip.connect(this.exciterLP);
    this.exciterLP.connect(this.exciterGain);

    this.wetSum.connect(this.bodyBP);
    this.bodyBP.connect(this.bodyLP);
    this.bodyLP.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outLimit.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    this._updateAll();
    return this.outputNode;
  }

  _tanhCurve(n, drive) {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) * 0.94;
    }
    return curve;
  }

  _brickCurve(n) {
    const lim = 0.86;
    const knee = 0.62;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const ax = Math.abs(x);
      const s = x < 0 ? -1 : 1;
      if (ax <= knee) curve[i] = x;
      else {
        const t = (ax - knee) / Math.max(1e-6, 1 - knee);
        curve[i] = s * (knee + (lim - knee) * Math.tanh(t * 3));
      }
    }
    return curve;
  }

  _clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  _f0() {
    const s = this._clamp01(this.params.structure);
    return 55 * Math.pow(4, s);
  }

  _ratio(i, structure) {
    const membrane = [1.000, 1.593, 2.135, 2.295, 2.653, 2.917, 3.155, 3.500];
    const harmonic = [1, 2, 3, 4, 5, 6, 7, 8];
    const s = Math.pow(this._clamp01(structure), 1.15);
    return membrane[i] + (harmonic[i] - membrane[i]) * s;
  }

  _updateAll() {
    this._updateStructure();
    this._updateBrightness();
    this._updateDamping();
    this._updatePosition();
  }

  _updateStructure() {
    if (!this.ctx || !this.modes || !this.modes.length) return;
    const now = this.ctx.currentTime;
    const s = this._clamp01(this.params.structure);
    const f0 = this._f0();
    const maxT = Math.max(0.002, (this._maxDelay || 0.12) - 0.002);
    for (let i = 0; i < this.modes.length; i++) {
      const freq = Math.max(40, Math.min(12000, f0 * this._ratio(i, s)));
      const dt = Math.max(0.0008, Math.min(maxT, 1 / freq));
      this.modes[i].delay.delayTime.setTargetAtTime(dt, now, 0.045);
    }
    if (this.bodyBP) {
      this.bodyBP.frequency.setTargetAtTime(Math.min(4000, f0 * 1.55), now, 0.05);
    }
    this._updateDamping();
    this._updateBrightness();
  }

  _updateBrightness() {
    if (!this.ctx || !this.modes || !this.modes.length) return;
    const now = this.ctx.currentTime;
    const b = this._clamp01(this.params.brightness);
    const lp = 650 * Math.pow(10000 / 650, b);
    if (this.exciterLP) this.exciterLP.frequency.setTargetAtTime(lp, now, 0.05);
    if (this.bodyLP) this.bodyLP.frequency.setTargetAtTime(1800 * Math.pow(9000 / 1800, b), now, 0.05);
    const f0 = this._f0();
    const s = this._clamp01(this.params.structure);
    for (let i = 0; i < this.modes.length; i++) {
      const freq = Math.max(40, f0 * this._ratio(i, s));
      const cut = Math.min(14000, freq * (2.2 + b * 10) * Math.pow(0.78, i * (1 - b * 0.55)));
      this.modes[i].damp.frequency.setTargetAtTime(Math.max(220, cut), now, 0.05);
    }
    this._updatePosition();
  }

  _updateDamping() {
    if (!this.ctx || !this.modes || !this.modes.length) return;
    const now = this.ctx.currentTime;
    const d = this._clamp01(this.params.damping);
    const b = this._clamp01(this.params.brightness);
    const s = this._clamp01(this.params.structure);
    const f0 = this._f0();
    const t60 = Math.exp(Math.log(9.5) + d * (Math.log(0.11) - Math.log(9.5)));
    const maxFb = 0.96;
    for (let i = 0; i < this.modes.length; i++) {
      const freq = Math.max(40, f0 * this._ratio(i, s));
      const dt = 1 / freq;
      const hf = Math.pow(0.42 + b * 0.58, i * 0.42);
      const t = Math.max(0.05, t60 * hf);
      let g = Math.pow(10, -3 * dt / t);
      g = Math.min(maxFb, g);
      g = Math.max(0.12, g);
      this.modes[i].fb.gain.setTargetAtTime(g, now, 0.04);
    }
    if (this.exciterGain) {
      const inj = 0.10 + d * 0.16;
      this.exciterGain.gain.setTargetAtTime(inj, now, 0.05);
    }
  }

  _updatePosition() {
    if (!this.ctx || !this.modes || !this.modes.length) return;
    const now = this.ctx.currentTime;
    const p = this._clamp01(this.params.position);
    const b = this._clamp01(this.params.brightness);
    const strike = 0.07 + p * 0.43;
    for (let i = 0; i < this.modes.length; i++) {
      const k = i + 1;
      const loc = 0.14 + 0.86 * Math.abs(Math.sin(Math.PI * k * strike));
      const even = (i % 2 === 0) ? (1 - p * 0.72) : (0.28 + p * 0.72);
      const brightRolloff = Math.pow(0.28 + b * 0.72, i * 0.5);
      const g = loc * even * brightRolloff * 0.42;
      this.modes[i].inj.gain.setTargetAtTime(Math.max(0.012, g), now, 0.03);
      this.modes[i].tap.gain.setTargetAtTime(Math.max(0.04, 0.22 + brightRolloff * 0.28), now, 0.03);
    }
  }

  injectAudioBuffer(audioBuffer) {
    if (!this.ctx || !audioBuffer) return;
    this._tapeBuffer = audioBuffer;
    if (this.isRunning) this._startTape();
  }

  _startTape() {
    if (!this.ctx || !this._tapeBuffer || !this.input) return;
    this._stopTape();
    const src = this.ctx.createBufferSource();
    src.buffer = this._tapeBuffer;
    src.loop = true;
    src.connect(this.input);
    try { src.start(0); } catch (e) {}
    this._tapeSource = src;
  }

  _stopTape() {
    if (this._tapeSource) {
      try { this._tapeSource.stop(); } catch (e) {}
      try { this._tapeSource.disconnect(); } catch (e) {}
      this._tapeSource = null;
    }
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'structure') this._updateStructure();
    else if (paramId === 'brightness') this._updateBrightness();
    else if (paramId === 'damping') this._updateDamping();
    else if (paramId === 'position') this._updatePosition();
  }

  connect(dest) {
    if (this.outputNode && dest) this.outputNode.connect(dest);
  }

  disconnect() {
    if (this.outputNode) this.outputNode.disconnect();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(1, t + 0.03);
    this._startTape();
    this._updateAll();
  }

  stop() {
    this.isRunning = false;
    this._stopTape();
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.04);
    if (this.modes) {
      for (let i = 0; i < this.modes.length; i++) {
        this.modes[i].fb.gain.setValueAtTime(0, t);
      }
    }
  }

  dispose() {
    this.stop();
    this._stopTape();
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this.modes = [];
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = BodyDSP;
  window.BodyDSP = BodyDSP;
}
