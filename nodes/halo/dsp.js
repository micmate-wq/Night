/**
 * Halo — nested-zone color delay for Aether.
 * Mimeophon grammar, not a clone. Class DSP, native Web Audio only.
 *
 * One looping time T, always being written. Eight nested zones (T … T/128).
 * You listen to a zone (equal-power crossfade); all zones keep being written.
 * Zone changes crossfade taps (no doppler). Rate may smear. Hold mutes the write.
 * Color lives in the feedback path. Tiny zone + high Repeats = Karplus-strong.
 */
class HaloDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
    this.isRunning = false;
    this._clockTimer = null;
    this._loopTime = 1;
    this._maxDelay = 5.5;
    this._graph = [];
    this._tapeSource = null;
    this._tapeBuffer = null;
    this._noiseSrc = null;
    this.params = {
      rate: 0.12,
      zone: 0,
      repeats: 0.55,
      color: 0.4,
      mix: 0.62,
      hold: 0,
      bpm: 120
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

    this.holdGain = this._add(ctx.createGain());
    this.holdGain.gain.setValueAtTime(1, now);

    this.writeBus = this._add(ctx.createGain());
    this.writeBus.gain.setValueAtTime(1, now);

    this.noiseGain = this._add(ctx.createGain());
    this.noiseGain.gain.setValueAtTime(0.0045, now);

    const mix0 = Math.max(0, Math.min(1, this.params.mix));
    this.dryGain = this._add(ctx.createGain());
    this.dryGain.gain.setValueAtTime(1 - mix0, now);

    this.wetGain = this._add(ctx.createGain());
    this.wetGain.gain.setValueAtTime(mix0, now);

    this.wetSum = this._add(ctx.createGain());
    this.wetSum.gain.setValueAtTime(1, now);

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-14, now);
    this.outComp.knee.setValueAtTime(4, now);
    this.outComp.ratio.setValueAtTime(20, now);
    this.outComp.attack.setValueAtTime(0.001, now);
    this.outComp.release.setValueAtTime(0.06, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._brickCurve(1024);
    this.outLimit.oversample = '2x';

    this.shaper = this._add(ctx.createWaveShaper());
    this.shaper.curve = this._tanhCurve(256, 1.35);
    this.shaper.oversample = '2x';

    this.colorFilter = this._add(ctx.createBiquadFilter());
    this.colorFilter.type = 'lowpass';
    this.colorFilter.Q.setValueAtTime(0.55, now);
    this.colorFilter.frequency.setValueAtTime(1800, now);

    this.loopComp = this._add(ctx.createDynamicsCompressor());
    this.loopComp.threshold.setValueAtTime(-24, now);
    this.loopComp.knee.setValueAtTime(6, now);
    this.loopComp.ratio.setValueAtTime(14, now);
    this.loopComp.attack.setValueAtTime(0.001, now);
    this.loopComp.release.setValueAtTime(0.08, now);

    this.clipper = this._add(ctx.createWaveShaper());
    this.clipper.curve = this._tanhCurve(256, 2.4);
    this.clipper.oversample = '2x';

    this.feedbackGain = this._add(ctx.createGain());
    this.feedbackGain.gain.setValueAtTime(0.5, now);

    this.delays = [];
    this.tapGains = [];
    this._maxDelay = 5.5;
    let firstDelay = null;
    const delayCands = [10, 8, 5.5];
    for (let c = 0; c < delayCands.length; c++) {
      try {
        firstDelay = ctx.createDelay(delayCands[c]);
        this._maxDelay = delayCands[c];
        break;
      } catch (e) {
        firstDelay = null;
      }
    }
    if (!firstDelay) {
      firstDelay = ctx.createDelay();
      this._maxDelay = 1;
    }
    this._add(firstDelay);
    for (let i = 0; i < 8; i++) {
      const d = (i === 0) ? firstDelay : this._add(ctx.createDelay(this._maxDelay));
      d.delayTime.setValueAtTime(0.25 / Math.pow(2, i), now);
      const g = this._add(ctx.createGain());
      g.gain.setValueAtTime(i === 0 ? 1 : 0.0001, now);
      this.writeBus.connect(d);
      d.connect(g);
      g.connect(this.wetSum);
      this.delays.push(d);
      this.tapGains.push(g);
    }

    this.input.connect(this.holdGain);
    this.holdGain.connect(this.writeBus);
    // No internal dry. Host insert dry is the only tape path, so Mix 1.00 can mute it.

    this.wetSum.connect(this.shaper);
    this.shaper.connect(this.colorFilter);
    this.colorFilter.connect(this.loopComp);
    this.loopComp.connect(this.clipper);
    this.clipper.connect(this.feedbackGain);
    this.feedbackGain.connect(this.writeBus);

    this.wetSum.connect(this.wetGain);
    this.wetGain.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outLimit.connect(this.outputNode);

    this._makeNoise();
    this._tickTimes();
    this._updateColor();
    this._updateHold();
    this._updateMix();
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

  _makeNoise() {
    const n = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.09;
      b6 = w * 0.115926;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.noiseGain);
    this.noiseGain.connect(this.writeBus);
    try { src.start(0); } catch (e) {}
    this._noiseSrc = src;
    this._graph.push(src);
  }

  _clockBpm() {
    let b = 120;
    try {
      if (typeof window !== 'undefined' && window.__aetherClockBpm != null) {
        const n = Number(window.__aetherClockBpm);
        if (n > 0) b = n;
      }
    } catch (e) {}
    return Math.max(40, Math.min(240, b));
  }

  _rateToLoopTime(rate, tLong, tShort) {
    const r = Math.max(0, Math.min(1, rate));
    const tMid = Math.max(tShort, Math.min(tLong, 3.2));
    const tFast = Math.max(tShort, Math.min(tLong, 0.85));
    const pts = [
      [0.00, tLong],
      [0.50, tMid],
      [0.75, tFast],
      [1.00, tShort]
    ];
    let i = 0;
    if (r > 0.75) i = 2;
    else if (r > 0.5) i = 1;
    const r0 = pts[i][0];
    const r1 = pts[i + 1][0];
    const a = Math.max(1e-6, pts[i][1]);
    const b = Math.max(1e-6, pts[i + 1][1]);
    const u = (r - r0) / (r1 - r0);
    return Math.exp(Math.log(a) + u * (Math.log(b) - Math.log(a)));
  }

  _tickTimes() {
    if (!this.ctx || !this.delays) return;
    const bpm = this._clockBpm();
    this.params.bpm = bpm;
    const maxT = (this._maxDelay || 5.5) - 0.1;
    // Ambient first: slow end is the delay max, not a bar count that BPM can shrink.
    const tLong = maxT;
    const tShort = 0.004;
    const rate = Math.max(0, Math.min(1, this.params.rate));
    let T = this._rateToLoopTime(rate, tLong, tShort);
    T = Math.max(tShort, Math.min(maxT, T));
    this._loopTime = T;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 8; i++) {
      const d = Math.max(0.0015, Math.min(maxT, T / Math.pow(2, i)));
      this.delays[i].delayTime.setTargetAtTime(d, now, 0.06);
    }
    this._updateTaps();
    this._updateRepeats();
  }

  _updateTaps() {
    if (!this.tapGains || !this.ctx) return;
    const z = Math.max(0, Math.min(1, this.params.zone)) * 7;
    const i0 = Math.floor(z);
    const frac = z - i0;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 8; i++) {
      let g = 0.0001;
      if (i === i0) g = Math.cos(frac * Math.PI * 0.5);
      else if (i === i0 + 1) g = Math.sin(frac * Math.PI * 0.5);
      const atten = 1 / Math.sqrt(1 + this.params.zone * 10);
      this.tapGains[i].gain.setTargetAtTime(Math.max(0.0001, g * atten), now, 0.018);
    }
  }

  _updateRepeats() {
    if (!this.feedbackGain || !this.ctx) return;
    const zone = Math.max(0, Math.min(1, this.params.zone));
    const color = Math.max(0, Math.min(1, this.params.color));
    const repeats = Math.max(0, Math.min(1, this.params.repeats));
    // Tiny zones store more energy. Cap feedback as zone climbs so civilians keep their ears.
    const maxFb = 0.72 - zone * 0.28;
    const fb = repeats * maxFb;
    this.feedbackGain.gain.setTargetAtTime(fb, this.ctx.currentTime, 0.04);
  }

  _updateColor() {
    if (!this.colorFilter || !this.ctx) return;
    const c = Math.max(0, Math.min(1, this.params.color));
    const hz = 400 * Math.pow(9000 / 400, c);
    this.colorFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.05);
    this._updateRepeats();
  }

  _updateHold() {
    if (!this.holdGain || !this.ctx) return;
    const open = this.params.hold > 0.5 ? 0 : 1;
    this.holdGain.gain.setTargetAtTime(open, this.ctx.currentTime, 0.02);
  }

  _updateMix() {
    if (!this.wetGain || !this.ctx) return;
    const m = Math.max(0, Math.min(1, this.params.mix));
    const now = this.ctx.currentTime;
    const wet = (m >= 0.995) ? 1 : (m <= 0.005 ? 0 : m);
    const zone = Math.max(0, Math.min(1, this.params.zone));
    this.wetGain.gain.setValueAtTime(wet * (0.55 / Math.sqrt(1 + zone * 6)), now);
    if (this.dryGain) this.dryGain.gain.setValueAtTime(0, now);
  }

  _ensureClockTimer() {
    if (this._clockTimer) return;
    this._clockTimer = setInterval(() => {
      if (!this.ctx) return;
      this._tickTimes();
    }, 250);
  }

  _clearClockTimer() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
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
    if (paramId === 'rate' || paramId === 'zone') { this._tickTimes(); this._updateMix(); }
    else if (paramId === 'repeats') this._updateRepeats();
    else if (paramId === 'color') this._updateColor();
    else if (paramId === 'hold') this._updateHold();
    else if (paramId === 'mix') this._updateMix();
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
    if (this.noiseGain) this.noiseGain.gain.setValueAtTime(0.0045, t);
    this._startTape();
    this._ensureClockTimer();
    this._tickTimes();
  }

  stop() {
    this.isRunning = false;
    this._clearClockTimer();
    this._stopTape();
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.04);
    if (this.noiseGain) this.noiseGain.gain.setValueAtTime(0, t);
    if (this.feedbackGain) this.feedbackGain.gain.setValueAtTime(0, t);
  }

  dispose() {
    this.stop();
    this._stopTape();
    this._clearClockTimer();
    if (this._noiseSrc) {
      try { this._noiseSrc.stop(); } catch (e) {}
      this._noiseSrc = null;
    }
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this.delays = [];
    this.tapGains = [];
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = HaloDSP;
  window.HaloDSP = HaloDSP;
}
