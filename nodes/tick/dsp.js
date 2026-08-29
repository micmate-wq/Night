
/**
 * Tick — lockable 16-step analog rhythm voice for Aether.
 * Interface matches GranularAtmosphericCloudDSP (init/setParameter/connect/dispose).
 */
class TickDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.isRunning = false;
    this.timerId = null;
    this.nextStepTime = 0;
    this.step = 0;
    this.bar = 0;
    this.params = { rate: 108, density: 0.55, lock: 0.72, color: 0.42 };
    this.noiseBuffer = null;
    // 16-step grids: bit0 = step 0. Default is a small groove, not empty.
    this.kick = 0b1000100010001000;   // 1 and 9, plus 5 and 13 light
    this.snare = 0b0000100000001000;  // 5 and 13
    this.hat = 0b1010101010101010;    // 8ths
    this.ghost = 0;                   // lockable extras
    this.turing = 0b1011001010010110;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(0.85, this.ctx.currentTime);
    this._makeNoise();
    this.start();
    return this.outputNode;
  }

  _makeNoise() {
    const n = Math.floor(this.ctx.sampleRate * 0.2);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.04;
      b1 = 0.98 * b1 + w * 0.08;
      b2 = 0.9 * b2 + w * 0.15;
      d[i] = (w * 0.35 + b0 + b1 + b2) * 0.45;
    }
    this.noiseBuffer = buf;
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
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
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  dispose() {
    this.stop();
    this.disconnect();
    this.ctx = null;
    this.outputNode = null;
  }

  _stepDur() {
    const bpm = Math.max(60, Math.min(180, this.params.rate));
    return 60 / bpm / 4; // 16ths
  }

  _bit(mask, step) {
    return (mask >> (15 - (step & 15))) & 1;
  }

  _rollGhosts() {
    const d = this.params.density;
    const lock = this.params.lock;
    if (Math.random() < lock) return; // keep loop
    let g = 0;
    for (let s = 0; s < 16; s++) {
      const chance = d * d * (s % 2 ? 0.35 : 0.12);
      if (Math.random() < chance) g |= (1 << (15 - s));
    }
    this.ghost = g;
    // Turing rotate with occasional inject
    const bit = (this.turing >> 15) & 1;
    const inject = Math.random() > lock ? (Math.random() > 0.5 ? 1 : 0) : bit;
    this.turing = ((this.turing << 1) & 0xffff) | inject;
  }

  _tick() {
    if (!this.isRunning || !this.ctx) return;
    const now = this.ctx.currentTime;
    const look = 0.12;
    while (this.nextStepTime < now + look) {
      this._fire(this.step, this.nextStepTime);
      this.step = (this.step + 1) & 15;
      if (this.step === 0) {
        this.bar++;
        this._rollGhosts();
      }
      this.nextStepTime += this._stepDur();
    }
    this.timerId = setTimeout(() => this._tick(), 20);
  }

  _fire(step, t) {
    const d = this.params.density;
    const col = this.params.color;
    const kickOn = this._bit(this.kick, step) && (d > 0.08 || step === 0);
    const snareOn = this._bit(this.snare, step) && d > 0.22;
    const hatBase = this._bit(this.hat, step) && d > 0.18;
    const hatGhost = this._bit(this.ghost, step) && d > 0.4;
    const turingHit = ((this.turing >> (15 - step)) & 1) && d > 0.62 && (step % 3 === 0);

    if (kickOn) this._kick(t, col, step === 0 ? 1 : 0.72);
    if (snareOn) this._splat(t, col, 0.8);
    if (hatBase || hatGhost || turingHit) {
      const vel = hatBase ? 0.55 : 0.28;
      this._hat(t, col, vel);
    }
  }

  _kick(t, col, vel) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f0 = 72 + col * 50;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(38, f0 * 0.55), t + 0.07);
    const dur = 0.09 + (1 - col) * 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _splat(t, col, vel) {
    if (!this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + col * 0.7;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(180 + col * 1400, t);
    bp.Q.setValueAtTime(1.2 + col * 2.2, t);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(200, t);
    const g = this.ctx.createGain();
    const dur = 0.05 + (1 - col) * 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(this.outputNode);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  _hat(t, col, vel) {
    if (!this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.4 + col * 1.6;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4000 + col * 5000, t);
    const g = this.ctx.createGain();
    const dur = 0.012 + col * 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * vel, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.outputNode);
    src.start(t);
    src.stop(t + dur + 0.01);
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = TickDSP;
  window.TickDSP = TickDSP;
}
