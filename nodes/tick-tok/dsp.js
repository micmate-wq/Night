
/**
 * Tick Tok — BPM-clocked morphing analog rhythm for Aether.
 * Same class-DSP style as Tick (no AudioWorklet). Weekend-wilder sibling.
 */
class TickTokDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.isRunning = false;
    this.timerId = null;
    this.nextStepTime = 0;
    this.step = 0;
    this.bar = 0;
    this.params = {
      bpm: 120,
      pattern: 0.22,
      talk: 0.62,
      decay: 0.38,
      density: 0.5,
      lock: 0.7,
      color: 0.4
    };
    this.noiseBuffer = null;
    this.hat = 0b1010101010101010; // 8ths, light groove when talk is low
    this.ghost = 0;
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
    // White-ish (less brown than Tick splat); hats highpass it further.
    const n = Math.floor(this.ctx.sampleRate * 0.25);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      pink = 0.7 * pink + w * 0.3;
      d[i] = (w * 0.78 + pink * 0.22) * 0.65;
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
    const bpm = Math.max(60, Math.min(180, this.params.bpm));
    return 60 / bpm / 4; // 16ths
  }

  _bit(mask, step) {
    return (mask >> (15 - (step & 15))) & 1;
  }

  _blendPattern(pattern) {
    const P = [
      0b1000100010001000, // four on the 16ths (1,5,9,13)
      0b1100100010001000, // double kick on 1
      0b1000000010001000, // gap (skip the 5)
      0b1110000010000000, // three in a row then space
      0b1001001000100100  // clave / uneven
    ];
    const N = P.length;
    const f = Math.max(0, Math.min(1, pattern)) * (N - 1);
    if (f >= N - 1) return P[N - 1];
    const i = Math.floor(f);
    const t = f - i;
    if (t < 0.18) return P[i];
    if (t > 0.82) return P[i + 1];
    return P[i] | P[i + 1]; // both light during the handoff
  }

  _talkMask(talk, pattern) {
    if (talk < 0.06) return 0;
    let m = 0b0000100000001000; // classic snare 5 and 13
    const E = [
      0b0000000000000000,
      0b0000001000000000, // 7
      0b0000001000100000, // 7 + 11
      0b0000001000100010  // 7 + 11 + 15
    ];
    const N = E.length;
    const climb = talk * 0.65 + pattern * 0.35;
    const u = Math.max(0, Math.min(1, (climb - 0.55) / 0.45));
    const f = u * (N - 1);
    if (f >= N - 1) m |= E[N - 1];
    else {
      const i = Math.floor(f);
      const t = f - i;
      if (t < 0.18) m |= E[i];
      else if (t > 0.82) m |= E[i + 1];
      else m |= E[i] | E[i + 1];
    }
    return m;
  }

  _rollGhosts() {
    const d = this.params.density;
    const lock = this.params.lock;
    if (Math.random() < lock) return; // freeze loop
    let g = 0;
    for (let s = 0; s < 16; s++) {
      const chance = d * d * (s % 2 ? 0.35 : 0.12);
      if (Math.random() < chance) g |= (1 << (15 - s));
    }
    this.ghost = g;
    const bit = (this.turing >> 15) & 1;
    const inject = Math.random() > lock ? (Math.random() > 0.5 ? 1 : 0) : bit;
    this.turing = ((this.turing << 1) & 0xffff) | inject;
  }

  _tick() {
    if (!this.isRunning || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now - 0.05) this.nextStepTime = now;
    const look = 0.12;
    while (this.nextStepTime < now + look) {
      let t = this.nextStepTime;
      if (this.params.pattern > 0.72 && (this.step & 1)) {
        t += this._stepDur() * 0.09; // shuffle odd 16ths
      }
      this._fire(this.step, t);
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
    const talk = this.params.talk;
    const kickMask = this._blendPattern(this.params.pattern);
    const snareMask = this._talkMask(talk, this.params.pattern);

    const kickOn = this._bit(kickMask, step);
    const snareOn = this._bit(snareMask, step);
    const hatBase = this._bit(this.hat, step) && d > 0.18;
    const hatGhost = this._bit(this.ghost, step) && d > 0.4;
    const turingHit = ((this.turing >> (15 - step)) & 1) && d > 0.62 && (step % 3 === 0);

    if (kickOn) this._kick(t, col, step === 0 ? 1 : 0.72);
    if (snareOn) {
      const classic = this._bit(0b0000100000001000, step);
      const vel = classic ? (0.52 + talk * 0.42) : (0.22 + talk * 0.28);
      this._talkBurst(t, col, vel);
    }
    if (hatBase || hatGhost || turingHit) {
      const vel = hatBase ? 0.48 : 0.24;
      this._hat(t, col, vel);
    }
  }

  _kick(t, col, vel) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f0 = 58 + col * 62; // thud → tin
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(36, f0 * 0.52), t + 0.06);
    const dur = 0.08 + (1 - col) * 0.05; // stays short; decay is for talk
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.outputNode);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _talkBurst(t, col, vel) {
    if (!this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.02 + col * 0.45;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400 + col * 2400, t);
    bp.Q.setValueAtTime(1.3 + col * 1.6, t);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(250, t);
    const g = this.ctx.createGain();
    const dur = 0.03 + this.params.decay * 0.25; // 0.03s … 0.28s
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.58 * vel, t + 0.003);
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
    src.playbackRate.value = 1.5 + col * 1.5;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4200 + col * 4800, t);
    const g = this.ctx.createGain();
    const dur = 0.012 + col * 0.028;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.outputNode);
    src.start(t);
    src.stop(t + dur + 0.01);
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = TickTokDSP;
  window.TickTokDSP = TickTokDSP;
}
