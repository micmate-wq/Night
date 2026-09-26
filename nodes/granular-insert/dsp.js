/**
 * Granular Insert — dense pad-like granular insert for Aether.
 * Grains from the track sample (injectAudioBuffer). Native Web Audio only:
 * BufferSource grains + DelayNode feedback + multi-tap space. No ScriptProcessor.
 *
 * Host insert dry sits under via params.mix (not a UI knob). Always Aether.
 */
class GranularInsertDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
    this.isRunning = false;
    this._graph = [];
    this._tapeBuffer = null;
    this._timerId = null;
    this._scan = 0.15;
    this._activeGrains = 0;
    this._maxGrains = 48;
    this.params = {
      density: 0.72,
      smear: 0.48,
      pitch: 0.5,
      scale: 0.28,
      delay: 0.38,
      space: 0.52,
      // Host _armInsertDry reads this so dry sample sits under the pad bed.
      mix: 0.7
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

    // Input present for host insert wiring; grains read from injected buffer.
    this.input = this._add(ctx.createGain());
    this.input.gain.setValueAtTime(0, now);

    this.grainBus = this._add(ctx.createGain());
    this.grainBus.gain.setValueAtTime(0.85, now);

    this.wetSum = this._add(ctx.createGain());
    this.wetSum.gain.setValueAtTime(1, now);

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-18, now);
    this.outComp.knee.setValueAtTime(8, now);
    this.outComp.ratio.setValueAtTime(3.5, now);
    this.outComp.attack.setValueAtTime(0.01, now);
    this.outComp.release.setValueAtTime(0.18, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._softClip(1024);
    this.outLimit.oversample = '2x';

    // Feedback delay (time + feedback folded into Delay knob)
    this.delayNode = null;
    const delayCands = [2.0, 1.5, 1.0];
    for (let i = 0; i < delayCands.length; i++) {
      try {
        this.delayNode = this._add(ctx.createDelay(delayCands[i]));
        break;
      } catch (e) {
        this.delayNode = null;
      }
    }
    if (!this.delayNode) this.delayNode = this._add(ctx.createDelay());
    this.delayNode.delayTime.setValueAtTime(0.28, now);

    this.delayFb = this._add(ctx.createGain());
    this.delayFb.gain.setValueAtTime(0.35, now);

    this.delayTone = this._add(ctx.createBiquadFilter());
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.setValueAtTime(4200, now);
    this.delayTone.Q.setValueAtTime(0.5, now);

    this.delaySend = this._add(ctx.createGain());
    this.delaySend.gain.setValueAtTime(0.45, now);

    this.delayReturn = this._add(ctx.createGain());
    this.delayReturn.gain.setValueAtTime(0.55, now);

    // Multi-tap space (tasteful lush pad, not mush)
    this.spaceIn = this._add(ctx.createGain());
    this.spaceIn.gain.setValueAtTime(1, now);
    this.spaceWet = this._add(ctx.createGain());
    this.spaceWet.gain.setValueAtTime(0.4, now);
    this.spaceDry = this._add(ctx.createGain());
    this.spaceDry.gain.setValueAtTime(0.75, now);
    this.spaceLp = this._add(ctx.createBiquadFilter());
    this.spaceLp.type = 'lowpass';
    this.spaceLp.frequency.setValueAtTime(6500, now);
    this.spaceLp.Q.setValueAtTime(0.4, now);
    this.spaceHp = this._add(ctx.createBiquadFilter());
    this.spaceHp.type = 'highpass';
    this.spaceHp.frequency.setValueAtTime(90, now);
    this.spaceHp.Q.setValueAtTime(0.5, now);

    this.spaceTaps = [];
    this.spaceFbs = [];
    const tapTimes = [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0671];
    for (let i = 0; i < tapTimes.length; i++) {
      let d;
      try {
        d = this._add(ctx.createDelay(0.25));
      } catch (e) {
        d = this._add(ctx.createDelay());
      }
      d.delayTime.setValueAtTime(tapTimes[i], now);
      const fb = this._add(ctx.createGain());
      fb.gain.setValueAtTime(0.28 + (i % 3) * 0.04, now);
      const tapG = this._add(ctx.createGain());
      tapG.gain.setValueAtTime(0.18 + (i % 2) * 0.05, now);
      this.spaceIn.connect(d);
      d.connect(fb);
      fb.connect(d);
      d.connect(tapG);
      tapG.connect(this.spaceLp);
      this.spaceTaps.push(d);
      this.spaceFbs.push(fb);
    }

    // Grain → delay → space → out
    this.grainBus.connect(this.wetSum);
    this.grainBus.connect(this.delaySend);
    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delayNode);
    this.delayTone.connect(this.delayReturn);
    this.delayReturn.connect(this.wetSum);

    this.wetSum.connect(this.spaceDry);
    this.wetSum.connect(this.spaceIn);
    this.spaceLp.connect(this.spaceHp);
    this.spaceHp.connect(this.spaceWet);

    this.spaceDry.connect(this.outComp);
    this.spaceWet.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outLimit.connect(this.outputNode);

    this._makeWindow(256);
    this._updateDelay();
    this._updateSpace();

    if (config.sampleBuffer) this.injectAudioBuffer(config.sampleBuffer);
    return this.outputNode;
  }

  _softClip(n) {
    const lim = 0.9;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.4) * lim;
    }
    return curve;
  }

  _makeWindow(len) {
    this._window = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      // Hann — soft pad grains, high overlap friendly
      this._window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
    }
  }

  _scaleMode() {
    const s = Math.max(0, Math.min(0.999, this.params.scale));
    const idx = Math.floor(s * 7);
    // Interval sets in semitones relative to root (pitch knob)
    const modes = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // Chromatic
      [0, 2, 4, 5, 7, 9, 11],                 // Major
      [0, 2, 3, 5, 7, 8, 10],                 // Natural minor
      [0, 2, 4, 7, 9],                        // Major pentatonic
      [0, 3, 5, 7, 10],                       // Minor pentatonic
      [0, 7, 12, -12, 5],                     // Fifths / octaves
      [0, 4, 7, 11, 14, -5]                   // Maj7 / lush extensions
    ];
    const names = ['Chromatic', 'Major', 'Minor', 'Penta Maj', 'Penta Min', 'Fifths', 'Maj7'];
    return { intervals: modes[idx], name: names[idx], idx };
  }

  _pitchSemitones() {
    // Strong range: -24 .. +24, center 0.5 = unison
    const p = Math.max(0, Math.min(1, this.params.pitch));
    return (p - 0.5) * 48;
  }

  _pickInterval() {
    const { intervals } = this._scaleMode();
    return intervals[Math.floor(Math.random() * intervals.length)];
  }

  _densityHz() {
    const d = Math.max(0, Math.min(1, this.params.density));
    // Fairly dense by default — pad overlap, not sparse spray
    return 6 + Math.pow(d, 1.15) * 42;
  }

  _grainSeconds() {
    const s = Math.max(0, Math.min(1, this.params.smear));
    return 0.06 + Math.pow(s, 0.9) * 0.72;
  }

  injectAudioBuffer(audioBuffer) {
    if (!audioBuffer) return;
    this._tapeBuffer = audioBuffer;
    if (this.isRunning) this._ensureScheduler();
  }

  _ensureScheduler() {
    if (this._timerId != null) return;
    this._tick();
  }

  _clearScheduler() {
    if (this._timerId != null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
  }

  _tick() {
    this._timerId = null;
    if (!this.isRunning || !this.ctx) return;
    const dens = Math.max(0, Math.min(1, this.params.density));
    const burst = dens > 0.85 ? 3 : dens > 0.55 ? 2 : 1;
    if (this._tapeBuffer) {
      for (let i = 0; i < burst; i++) this._spawnGrain();
    }
    const hz = this._densityHz();
    const intervalMs = Math.max(8, (1000 * burst) / Math.max(1, hz));
    const jitter = (Math.random() * 0.35 - 0.1) * intervalMs;
    this._timerId = setTimeout(() => this._tick(), Math.max(8, intervalMs + jitter));
  }

  _spawnGrain() {
    if (!this.ctx || !this._tapeBuffer || !this.grainBus) return;
    if (this._activeGrains >= this._maxGrains) return;

    const buf = this._tapeBuffer;
    const now = this.ctx.currentTime;
    const grainDur = this._grainSeconds();
    const bufDur = buf.duration;
    if (bufDur < 0.05) return;

    // Slow scan + smear-linked spray for organic pad motion
    const smear = Math.max(0, Math.min(1, this.params.smear));
    this._scan = (this._scan + 0.0015 + smear * 0.004) % 1;
    const spray = (Math.random() * 2 - 1) * (0.08 + smear * 0.35);
    let offsetNorm = (this._scan + spray + 1) % 1;
    const maxOff = Math.max(0, bufDur - grainDur * 0.85);
    let offset = offsetNorm * maxOff;

    const baseSt = this._pitchSemitones();
    const interval = this._pickInterval();
    const micro = (Math.random() * 0.3 - 0.15);
    const st = baseSt + interval + micro;
    const rate = Math.pow(2, st / 12);
    // Keep offset valid under pitch stretch
    const playDur = Math.min(grainDur, Math.max(0.02, (bufDur - offset) / Math.max(0.25, rate)));

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(Math.max(0.125, Math.min(4, rate)), now);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    try {
      env.gain.setValueCurveAtTime(this._window, now, playDur);
    } catch (e) {
      env.gain.linearRampToValueAtTime(0.7, now + playDur * 0.2);
      env.gain.linearRampToValueAtTime(0.0001, now + playDur);
    }

    let panner = null;
    if (this.ctx.createStereoPanner) {
      panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.random() * 1.4 - 0.7, now);
    }

    // Soft per-grain level so dense overlap stays pad-like
    const gLevel = this.ctx.createGain();
    const overlap = 0.22 + (1 - Math.max(0, Math.min(1, this.params.density))) * 0.2;
    gLevel.gain.setValueAtTime(overlap, now);

    src.connect(env);
    env.connect(gLevel);
    if (panner) {
      gLevel.connect(panner);
      panner.connect(this.grainBus);
    } else {
      gLevel.connect(this.grainBus);
    }

    this._activeGrains++;
    try {
      src.start(now, offset, playDur + 0.02);
      src.stop(now + playDur + 0.05);
    } catch (e) {
      this._activeGrains = Math.max(0, this._activeGrains - 1);
      return;
    }

    src.onended = () => {
      this._activeGrains = Math.max(0, this._activeGrains - 1);
      try { src.disconnect(); } catch (e) {}
      try { env.disconnect(); } catch (e) {}
      try { gLevel.disconnect(); } catch (e) {}
      if (panner) try { panner.disconnect(); } catch (e) {}
    };
  }

  _updateDelay() {
    if (!this.ctx || !this.delayNode) return;
    const d = Math.max(0, Math.min(1, this.params.delay));
    const now = this.ctx.currentTime;
    // Time 80ms..720ms, feedback and send rise with knob
    const t = 0.08 + Math.pow(d, 0.85) * 0.64;
    this.delayNode.delayTime.setTargetAtTime(t, now, 0.05);
    this.delayFb.gain.setTargetAtTime(0.12 + d * 0.48, now, 0.05);
    this.delaySend.gain.setTargetAtTime(0.15 + d * 0.55, now, 0.05);
    this.delayReturn.gain.setTargetAtTime(0.25 + d * 0.45, now, 0.05);
    this.delayTone.frequency.setTargetAtTime(5200 - d * 1800, now, 0.08);
  }

  _updateSpace() {
    if (!this.ctx || !this.spaceWet) return;
    const s = Math.max(0, Math.min(1, this.params.space));
    const now = this.ctx.currentTime;
    // Equal-ish power: dry never fully vanishes; space opens wet + feedback
    const wet = Math.sin(s * Math.PI * 0.5) * 0.72;
    const dry = Math.cos(s * Math.PI * 0.5) * 0.55 + 0.35;
    this.spaceWet.gain.setTargetAtTime(wet, now, 0.06);
    this.spaceDry.gain.setTargetAtTime(dry, now, 0.06);
    this.spaceLp.frequency.setTargetAtTime(9000 - s * 3500, now, 0.1);
    const fb = 0.22 + s * 0.42;
    for (let i = 0; i < this.spaceFbs.length; i++) {
      this.spaceFbs[i].gain.setTargetAtTime(fb * (0.85 + (i % 3) * 0.08), now, 0.08);
    }
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'delay') this._updateDelay();
    else if (paramId === 'space') this._updateSpace();
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
    this.outputNode.gain.linearRampToValueAtTime(1, t + 0.06);
    this._ensureScheduler();
  }

  stop() {
    this.isRunning = false;
    this._clearScheduler();
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.08);
    if (this.delayFb) this.delayFb.gain.setTargetAtTime(0, t, 0.05);
  }

  dispose() {
    this.stop();
    this._clearScheduler();
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this.spaceTaps = [];
    this.spaceFbs = [];
    this._tapeBuffer = null;
    this.ctx = null;
    this.outputNode = null;
    this.input = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = GranularInsertDSP;
  window.GranularInsertDSP = GranularInsertDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GranularInsertDSP };
}
