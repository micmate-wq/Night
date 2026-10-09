/**
 * Rotate — six quantized band-pass resonators for Aether.
 * 4ms Spectral Multiband Resonator grammar, not a clone. Not an FFT.
 *
 * Six BiquadFilter bandpasses in parallel remix the take into a chord.
 * Frequencies lock to musical sets (min7, major, sus, pentatonic, whole-tone).
 * Rotate offsets the voicing; Tick Tok walks one scale step every other beat.
 * Spread is cluster vs wide. Q is resonance, capped so it cannot scream.
 */
class RotateDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
    this.isRunning = false;
    this._clockTimer = null;
    this._graph = [];
    this._tapeSource = null;
    this._tapeBuffer = null;
    this._clockSteps = 0;
    this._beatPhase = 0;
    this._lastClockTime = 0;
    this._bands = [];
    this._bandGains = [];
    this.params = {
      rotate: 0,
      spread: 0.45,
      morph: 0.3,
      q: 0.62
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
    this.dryGain.gain.setValueAtTime(0.12, now);

    this.wetSum = this._add(ctx.createGain());
    this.wetSum.gain.setValueAtTime(1, now);

    this.wetGain = this._add(ctx.createGain());
    this.wetGain.gain.setValueAtTime(0.82, now);

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-16, now);
    this.outComp.knee.setValueAtTime(8, now);
    this.outComp.ratio.setValueAtTime(12, now);
    this.outComp.attack.setValueAtTime(0.002, now);
    this.outComp.release.setValueAtTime(0.1, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._brickCurve(1024);
    this.outLimit.oversample = '2x';

    this._bands = [];
    this._bandGains = [];
    for (let i = 0; i < 6; i++) {
      const bp = this._add(ctx.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(220, now);
      bp.Q.setValueAtTime(8, now);
      const g = this._add(ctx.createGain());
      g.gain.setValueAtTime(0.38, now);
      this.input.connect(bp);
      bp.connect(g);
      g.connect(this.wetSum);
      this._bands.push(bp);
      this._bandGains.push(g);
    }

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    this.wetSum.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outLimit.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);

    this._applyVoicing(true);
    return this.outputNode;
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

  // One-octave interval sets. Voices wrap with octave carry so they stay quantized.
  _quality(morph) {
    const sets = [
      [0, 3, 7, 10],          // minor 7
      [0, 4, 7, 11],          // major 7
      [0, 2, 5, 7],           // sus
      [0, 3, 5, 7, 10],       // minor pentatonic
      [0, 2, 4, 6, 8, 10]     // whole-tone
    ];
    const i = Math.max(0, Math.min(4, Math.round(Math.max(0, Math.min(1, morph)) * 4)));
    return sets[i];
  }

  _midiToHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  _qValue(qNorm) {
    const q = Math.max(0, Math.min(1, qNorm));
    // 0.8 … 18.  Default 0.62 → ~11.5. Cap so high-Q cannot scream.
    return 0.8 + q * 17.2;
  }

  _clockBpm() {
    let b = 0;
    try {
      if (typeof window !== 'undefined' && window.__aetherClockBpm != null) {
        const n = Number(window.__aetherClockBpm);
        if (n > 0) b = n;
      }
    } catch (e) {}
    if (!b) return 0;
    return Math.max(40, Math.min(240, b));
  }

  _voiceMidis() {
    const spread = Math.max(0, Math.min(1, this.params.spread));
    const rotate = Math.max(0, Math.min(1, this.params.rotate));
    const scale = this._quality(this.params.morph);
    const n = scale.length;
    const root = 36 + Math.round((1 - spread) * 12); // C2 wide … C3 tight
    const step = 1 + Math.round(spread * 3);         // 1 … 4 scale degrees
    const base = Math.round(rotate * n) + (this._clockSteps || 0);
    const midis = [];
    for (let i = 0; i < 6; i++) {
      const deg = base + i * step;
      const oct = Math.floor(deg / n);
      const pc = scale[((deg % n) + n) % n];
      let midi = root + pc + oct * 12;
      midi = Math.max(24, Math.min(96, midi));
      midis.push(midi);
    }
    return midis;
  }

  _applyVoicing(snap) {
    if (!this.ctx || !this._bands || this._bands.length !== 6) return;
    const now = this.ctx.currentTime;
    const ny = this.ctx.sampleRate * 0.42;
    const q = this._qValue(this.params.q);
    const midis = this._voiceMidis();
    // Overlap compensation: tighter spread → slightly quieter per band.
    const spread = Math.max(0, Math.min(1, this.params.spread));
    const overlap = 0.34 + spread * 0.12;
    const tau = snap ? 0.012 : 0.045;
    for (let i = 0; i < 6; i++) {
      const hz = Math.max(40, Math.min(ny, this._midiToHz(midis[i])));
      this._bands[i].frequency.setTargetAtTime(hz, now, tau);
      this._bands[i].Q.setTargetAtTime(q, now, 0.04);
      this._bandGains[i].gain.setTargetAtTime(overlap, now, 0.04);
    }
    if (this.wetGain) {
      // High Q rings hotter. Pull wet a little as Q climbs.
      const qn = Math.max(0, Math.min(1, this.params.q));
      this.wetGain.gain.setTargetAtTime(0.9 - qn * 0.18, now, 0.05);
    }
  }

  _tickClock() {
    if (!this.ctx || !this.isRunning) return;
    const now = this.ctx.currentTime;
    if (!this._lastClockTime) this._lastClockTime = now;
    const dt = Math.max(0, Math.min(0.25, now - this._lastClockTime));
    this._lastClockTime = now;
    const bpm = this._clockBpm();
    if (!bpm) {
      if (this._clockSteps !== 0) {
        this._clockSteps = 0;
        this._beatPhase = 0;
        this._applyVoicing();
      }
      return;
    }
    this._beatPhase += dt * bpm / 60;
    // One scale step every other beat — chord walk, not a spin.
    const steps = Math.floor(this._beatPhase / 2);
    if (steps !== this._clockSteps) {
      this._clockSteps = steps;
      this._applyVoicing();
    }
  }

  _ensureClockTimer() {
    if (this._clockTimer) return;
    this._clockTimer = setInterval(() => {
      if (!this.ctx) return;
      this._tickClock();
    }, 50);
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
    this._applyVoicing();
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
    this._clockSteps = 0;
    this._beatPhase = 0;
    this._lastClockTime = t;
    this._startTape();
    this._ensureClockTimer();
    this._applyVoicing(true);
  }

  stop() {
    this.isRunning = false;
    this._clearClockTimer();
    this._stopTape();
    this._clockSteps = 0;
    this._beatPhase = 0;
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.04);
  }

  dispose() {
    this.stop();
    this._stopTape();
    this._clearClockTimer();
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this._bands = [];
    this._bandGains = [];
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = RotateDSP;
  window.RotateDSP = RotateDSP;
}
