/**
 * Bloom v2 — cheerful sparse ambient generator for Aether (gift for Lera).
 * v2.6: one button Seed → Grow → Growth. Drone quieter, moving line up. Loop keeps evolving.
 * hard-capped delay feedback. Native Web Audio only.
 * Class BloomV2DSP — distinct from BloomDSP so both can load.
 * Always Aether.
 */
class BloomV2DSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.isRunning = false;
    this._graph = [];
    this._padVoices = [];
    this._grainTimer = null;
    this._evolveTimer = null;
    this._melodyTimer = null;
    this._activeGrains = 0;
    this._maxGrains = 22;
    this._grainBuf = null;
    this._sparkleBuf = null;
    this._rootBaseHz = 196; // G3
    this._rootHz = 196;
    this._voiceTarget = 3;
    this._melIdx = 0;
    this._melDir = 1;
    this._melOct = 0;
    this._gardenPrev = null;
    this._gardenLastReseedAt = null;
    this._gardenReseedTimer = null;
    this._gardenPendingStop = false;
    this._activeGardenSeed = null;
    this._gardenRootBias = 0;
    this._gardenSparkle = 0.12;
    this._seedTimer = null;
    this._evolveOrigin = 0;
    this._noiseSrc = null;
    this._soundingPitchSt = null;
    this._heldSt = null;
    this._growOn = false;
    this._listenOnly = false;
    this._growRootHz = null;
    this._harmVoices = [];
    this._patTimer = null;
    this._patMode = 'live';
    this._patStep = 0;
    this._patIdx = -1;
    this._patBuf = [];
    this._patLoop = [];
    this._patPlay = 0;
    this._lockedStepMs = 0;
    this._lineVoices = [];
    this._delayPresetIdx = 1;
    // Discrete delay times — set on Seed/garden reseed only (no siren scrub)
    this._delayPresets = [0.22, 0.28, 0.34, 0.41, 0.48];
    this.params = {
      growth: 0.42,
      breeze: 0.48,
      bloom: 0.58,
      garden: 0.35,
      pitch: 0.5,
      melody: 0.4,
      air: 0.5,
      grainPitch: 0.5,
      harmony: 0.4,
      spray: 0.35,
      decay: 0.28,
      flowers: 1,
      _take: null
    };
    this._cloudTimer = null;
    this._gActive = 0;
  }

  _add(node) {
    this._graph.push(node);
    return node;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.padBus = this._add(ctx.createGain());
    this.padBus.gain.setValueAtTime(0.68, now);

    this.grainBus = this._add(ctx.createGain());
    this.grainBus.gain.setValueAtTime(0.48, now);

    this.melodyBus = this._add(ctx.createGain());
    this.melodyBus.gain.setValueAtTime(0.22, now);

    this.mixBus = this._add(ctx.createGain());
    this.mixBus.gain.setValueAtTime(1, now);

    this.toneLp = this._add(ctx.createBiquadFilter());
    this.toneLp.type = 'lowpass';
    this.toneLp.frequency.setValueAtTime(3800, now);
    this.toneLp.Q.setValueAtTime(0.32, now);

    // Gentle mid dip — pads/grains sit here and read loudest
    this.midCut = this._add(ctx.createBiquadFilter());
    this.midCut.type = 'peaking';
    this.midCut.frequency.setValueAtTime(680, now);
    this.midCut.Q.setValueAtTime(0.72, now);
    this.midCut.gain.setValueAtTime(-4.5, now);

    this.toneHp = this._add(ctx.createBiquadFilter());
    this.toneHp.type = 'highpass';
    this.toneHp.frequency.setValueAtTime(60, now);
    this.toneHp.Q.setValueAtTime(0.5, now);

    // Airy delay — FB hard-capped; delayTime only jumps on Seed/reseed
    this.delayNode = null;
    const delayCands = [1.2, 0.9, 0.7];
    for (let i = 0; i < delayCands.length; i++) {
      try {
        this.delayNode = this._add(ctx.createDelay(delayCands[i]));
        break;
      } catch (e) {
        this.delayNode = null;
      }
    }
    if (!this.delayNode) this.delayNode = this._add(ctx.createDelay());
    this.delayNode.delayTime.setValueAtTime(this._delayPresets[this._delayPresetIdx], now);

    this.delayFb = this._add(ctx.createGain());
    this.delayFb.gain.setValueAtTime(0.08, now);
    this.delayTone = this._add(ctx.createBiquadFilter());
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.setValueAtTime(4200, now);
    this.delayTone.Q.setValueAtTime(0.22, now);
    this.delaySend = this._add(ctx.createGain());
    this.delaySend.gain.setValueAtTime(0.12, now);
    this.delayReturn = this._add(ctx.createGain());
    this.delayReturn.gain.setValueAtTime(0.14, now);

    // Light multi-tap air
    this.spaceIn = this._add(ctx.createGain());
    this.spaceIn.gain.setValueAtTime(1, now);
    this.spaceWet = this._add(ctx.createGain());
    this.spaceWet.gain.setValueAtTime(0.16, now);
    this.spaceDry = this._add(ctx.createGain());
    this.spaceDry.gain.setValueAtTime(0.86, now);
    this.spaceLp = this._add(ctx.createBiquadFilter());
    this.spaceLp.type = 'lowpass';
    this.spaceLp.frequency.setValueAtTime(7200, now);
    this.spaceLp.Q.setValueAtTime(0.3, now);
    this.spaceHp = this._add(ctx.createBiquadFilter());
    this.spaceHp.type = 'highpass';
    this.spaceHp.frequency.setValueAtTime(110, now);

    // Breeze noise: silent until slider passes 50%
    this.noiseHp = this._add(ctx.createBiquadFilter());
    this.noiseHp.type = 'highpass';
    this.noiseHp.frequency.setValueAtTime(2200, now);
    this.noiseHp.Q.setValueAtTime(0.45, now);
    // Lowpass stays open until breeze crosses 60%, then closes slowly.
    this.noiseLp = this._add(ctx.createBiquadFilter());
    this.noiseLp.type = 'lowpass';
    this.noiseLp.frequency.setValueAtTime(16000, now);
    this.noiseLp.Q.setValueAtTime(0.5, now);
    this.noiseGain = this._add(ctx.createGain());
    this.noiseGain.gain.setValueAtTime(0, now);
    this.wildHp = this._add(ctx.createBiquadFilter());
    this.wildHp.type = 'highpass';
    this.wildHp.frequency.setValueAtTime(1800, now);
    this.wildHp.Q.setValueAtTime(0.5, now);
    this.wildGain = this._add(ctx.createGain());
    this.wildGain.gain.setValueAtTime(0, now);
    this.wildLfo = this._add(ctx.createOscillator());
    this.wildLfo.type = 'sine';
    this.wildLfo.frequency.setValueAtTime(0.18, now);
    this.wildLfo.start(now);

    this.spaceTaps = [];
    this.spaceFbs = [];
    const tapTimes = [0.019, 0.027, 0.036, 0.047, 0.058];
    for (let i = 0; i < tapTimes.length; i++) {
      let d;
      try { d = this._add(ctx.createDelay(0.15)); }
      catch (e) { d = this._add(ctx.createDelay()); }
      d.delayTime.setValueAtTime(tapTimes[i], now);
      const fb = this._add(ctx.createGain());
      fb.gain.setValueAtTime(0.04 + (i % 2) * 0.015, now);
      const tapG = this._add(ctx.createGain());
      tapG.gain.setValueAtTime(0.07 + (i % 3) * 0.012, now);
      this.spaceIn.connect(d);
      d.connect(fb);
      fb.connect(d);
      d.connect(tapG);
      tapG.connect(this.spaceLp);
      this.spaceTaps.push(d);
      this.spaceFbs.push(fb);
    }

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-18, now);
    this.outComp.knee.setValueAtTime(14, now);
    this.outComp.ratio.setValueAtTime(2.4, now);
    this.outComp.attack.setValueAtTime(0.012, now);
    this.outComp.release.setValueAtTime(0.2, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._softClip(1024);
    this.outLimit.oversample = '2x';

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    // Middle pad only: 15% slow ensemble, dry stays put.
    this.padDry = this._add(ctx.createGain());
    this.padDry.gain.setValueAtTime(1, now);
    this.chorusHp = this._add(ctx.createBiquadFilter());
    this.chorusHp.type = 'highpass';
    this.chorusHp.frequency.setValueAtTime(780, now);
    this.chorusHp.Q.setValueAtTime(0.5, now);
    this.chorusWet = this._add(ctx.createGain());
    this.chorusWet.gain.setValueAtTime(0.15, now);
    this.padBus.connect(this.padDry);
    this.padDry.connect(this.toneHp);
    this.lineBus = this._add(ctx.createGain());
    this.lineBus.gain.setValueAtTime(1, now);
    this.lineAmp = this._add(ctx.createGain());
    this.lineAmp.gain.setValueAtTime(1, now);
    this.lineLfoDepth = this._add(ctx.createGain());
    this.lineLfoDepth.gain.setValueAtTime(0, now);
    this._chorusLfos = [];
    const chorus = [
      { rate: 0.08, depth: 0.0042, base: 0.014, pan: -0.62 },
      { rate: 0.12, depth: 0.0050, base: 0.019, pan: 0.62 }
    ];
    for (let i = 0; i < chorus.length; i++) {
      const c = chorus[i];
      const dly = this._add(ctx.createDelay(0.08));
      dly.delayTime.setValueAtTime(c.base, now);
      const lfo = this._add(ctx.createOscillator());
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(c.rate, now);
      const depth = this._add(ctx.createGain());
      depth.gain.setValueAtTime(c.depth, now);
      lfo.connect(depth);
      depth.connect(dly.delayTime);
      const pan = ctx.createStereoPanner ? this._add(ctx.createStereoPanner()) : null;
      if (pan) pan.pan.setValueAtTime(c.pan, now);
      this.padBus.connect(dly);
      if (pan) {
        dly.connect(pan);
        pan.connect(this.chorusHp);
      } else {
        dly.connect(this.chorusHp);
      }
      lfo.start(now);
      this._chorusLfos.push(lfo);
    }
    this.chorusHp.connect(this.chorusWet);
    this.chorusWet.connect(this.toneHp);

    this.grainBus.connect(this.toneHp);
    this.melodyBus.connect(this.toneHp);
    this.lineBus.connect(this.lineAmp);
    this.lineAmp.connect(this.toneHp);
    if (this.wildLfo) this.wildLfo.connect(this.lineLfoDepth);
    this.lineLfoDepth.connect(this.lineAmp.gain);
    this.toneHp.connect(this.toneLp);
    this.toneLp.connect(this.midCut);
    this.midCut.connect(this.mixBus);

    this.noiseHp.connect(this.noiseLp);
    this.noiseLp.connect(this.noiseGain);
    this.noiseGain.connect(this.mixBus);
    this.wildHp.connect(this.wildGain);
    this.wildGain.connect(this.mixBus);

    this.mixBus.connect(this.spaceDry);
    this.mixBus.connect(this.spaceIn);
    this.mixBus.connect(this.delaySend);
    this.delaySend.connect(this.delayNode);
    this.delayNode.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delayNode);
    this.delayTone.connect(this.delayReturn);
    this.delayReturn.connect(this.mixBus);

    this.spaceLp.connect(this.spaceHp);
    this.spaceHp.connect(this.spaceWet);

    this.cloudBus = this._add(ctx.createGain());
    this.cloudBus.gain.setValueAtTime(0.9, now);
    this.cloudSend = this._add(ctx.createGain());
    this.cloudSend.gain.setValueAtTime(0.08, now);
    this.cloudBus.connect(this.cloudSend);
    this.cloudSend.connect(this.spaceIn);
    this.cloudBus.connect(this.outComp);

    this.loopIn = this._add(ctx.createGain());
    this.loopIn.gain.setValueAtTime(0, now);
    this.loopDly = this._add(ctx.createDelay(1.5));
    this.loopDly.delayTime.setValueAtTime(0.42, now);
    this.loopFb = this._add(ctx.createGain());
    this.loopFb.gain.setValueAtTime(0.12, now);
    this.loopTone = this._add(ctx.createBiquadFilter());
    this.loopTone.type = 'lowpass';
    this.loopTone.frequency.setValueAtTime(2800, now);
    this.loopWet = this._add(ctx.createGain());
    this.loopWet.gain.setValueAtTime(0, now);
    this.melodyBus.connect(this.loopIn);
    this.loopIn.connect(this.loopDly);
    this.loopDly.connect(this.loopTone);
    this.loopTone.connect(this.loopFb);
    this.loopFb.connect(this.loopDly);
    this.loopTone.connect(this.loopWet);
    this.loopWet.connect(this.outComp);

    this.spaceDry.connect(this.outComp);
    this.spaceWet.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outHp = this._add(ctx.createBiquadFilter());
    this.outHp.type = 'highpass';
    this.outHp.frequency.setValueAtTime(100, now);
    this.outHp.Q.setValueAtTime(0.707, now);
    this.outLimit.connect(this.outHp);
    this.outHp.connect(this.outputNode);

    this._buildGrainBuffers();
    this._buildNoise();
    this._installSampler();
    this._makeWindow(256);
    this._applyGarden();
    this._applyPitch();
    this._applyTone();
    this._applyAir();
    this._voiceTarget = this._growthVoices();

    return this.outputNode;
  }

  _installSampler() {
    const sr = this.ctx.sampleRate;
    this._capN = Math.floor(sr * 2.4);
    this._capL = new Float32Array(this._capN);
    this._capR = new Float32Array(this._capN);
    this._capW = 0;
    let proc = null;
    try { proc = this.ctx.createScriptProcessor(1024, 2, 2); } catch (e) { proc = null; }
    if (!proc) return;
    const self = this;
    proc.onaudioprocess = function (e) {
      const inp = e.inputBuffer;
      const L = inp.getChannelData(0);
      const R = inp.numberOfChannels > 1 ? inp.getChannelData(1) : L;
      const n = L.length;
      for (let i = 0; i < n; i++) {
        self._capL[self._capW] = L[i];
        self._capR[self._capW] = R[i];
        self._capW = (self._capW + 1) % self._capN;
      }
      const oL = e.outputBuffer.getChannelData(0);
      const oR = e.outputBuffer.numberOfChannels > 1 ? e.outputBuffer.getChannelData(1) : null;
      for (let i = 0; i < oL.length; i++) {
        oL[i] = 0;
        if (oR) oR[i] = 0;
      }
    };
    this.sampTap = this._add(this.ctx.createGain());
    this.sampTap.gain.setValueAtTime(1, this.ctx.currentTime);
    this.mixBus.connect(this.sampTap);
    this.sampTap.connect(proc);
    const mute = this._add(this.ctx.createGain());
    mute.gain.setValueAtTime(0, this.ctx.currentTime);
    proc.connect(mute);
    mute.connect(this.outputNode);
    this._sampProc = proc;
  }

  _gparam(id, d) {
    const v = this.params[id];
    return Math.max(0, Math.min(1, v == null ? d : v));
  }

  _cloudIntervals() {
    const h = this._gparam('harmony', 0.4);
    const out = [0];
    if (h > 0.18) out.push(7);
    if (h > 0.4) out.push(4);
    if (h > 0.62) out.push(-5);
    if (h > 0.82) out.push(12);
    return out;
  }

  _quantizeCloud(st) {
    const ints = this._scaleIntervals();
    let best = st;
    let bestD = 99;
    for (let o = -12; o <= 12; o += 12) {
      for (let i = 0; i < ints.length; i++) {
        const c = ints[i] + o;
        const d = Math.abs(c - st);
        if (d < bestD) { best = c; bestD = d; }
      }
    }
    return best;
  }

  _scheduleCloud() {
    this._cloudTimer = null;
    if (!this.isRunning) return;
    const spray = this._gparam('spray', 0.35);
    const decay = this._gparam('decay', 0.28);
    const pitch = this._gparam('grainPitch', 0.5);
    const base = Math.round((pitch - 0.5) * 12);
    const ints = this._cloudIntervals();
    for (let i = 0; i < ints.length; i++) {
      this._playCloudGrain(this._quantizeCloud(base + ints[i]), spray, decay);
    }
    if (this.cloudSend) {
      const now = this.ctx.currentTime;
      try { this.cloudSend.gain.setTargetAtTime(0.03 + decay * 0.62, now, 0.25); } catch (e) {}
    }
    const gap = 70 + (1 - spray) * 90 + Math.random() * spray * 160;
    this._cloudTimer = setTimeout(() => this._scheduleCloud(), Math.max(42, gap));
  }

  _playCloudGrain(st, spray, decay) {
    if (!this.ctx || !this._capL || !this.cloudBus) return;
    if (this._gActive >= 16) return;
    const sr = this.ctx.sampleRate;
    const dur = 0.04 + Math.pow(decay, 0.85) * 0.55;
    const n = Math.max(128, Math.floor(sr * dur));
    const buf = this.ctx.createBuffer(2, n, sr);
    const back = Math.floor(sr * (0.06 + decay * 0.35));
    const jitter = Math.floor(spray * this._capN * 0.35);
    const guard = Math.floor(sr * 0.03);
    let start = this._capW - back - guard - Math.floor(Math.random() * (jitter + 1));
    if (start < 0) start = 0;
    if (start + n >= this._capN) start = Math.max(0, this._capN - n - 1);
    if (start + n > this._capW && start < this._capW) start = Math.max(0, this._capW - n - guard);
    const fadeN = Math.max(Math.floor(sr * 0.012), Math.min(Math.floor(n * 0.28), Math.floor((n - 2) / 2)));
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      let w = 1;
      if (i < fadeN) {
        const t = i / fadeN;
        w = 0.5 - 0.5 * Math.cos(Math.PI * t);
      } else if (i > n - 1 - fadeN) {
        const t = (n - 1 - i) / fadeN;
        w = 0.5 - 0.5 * Math.cos(Math.PI * t);
      }
      L[i] = this._capL[idx] * w;
      R[i] = this._capR[idx] * w;
    }
    L[0] = 0; R[0] = 0;
    L[n - 1] = 0; R[n - 1] = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const now = this.ctx.currentTime;
    const wob = 1 + (Math.random() * 2 - 1) * spray * 0.03;
    const rate = Math.max(0.4, Math.min(2.2, Math.pow(2, st / 12) * wob));
    src.playbackRate.setValueAtTime(rate, now);
    const peak = (0.16 + (1 - decay) * 0.12) / Math.sqrt(1 + this._cloudIntervals().length);
    const playDur = dur / rate;
    const fadeSec = Math.max(0.012, Math.min(0.028, playDur * 0.3));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + fadeSec);
    g.gain.setValueAtTime(peak, now + Math.max(fadeSec, playDur - fadeSec));
    g.gain.linearRampToValueAtTime(0, now + playDur);
    if (this.ctx.createStereoPanner) {
      const pan = this.ctx.createStereoPanner();
      pan.pan.setValueAtTime((Math.random() * 2 - 1) * (0.15 + spray * 0.75), this.ctx.currentTime);
      src.connect(g);
      g.connect(pan);
      pan.connect(this.cloudBus);
    } else {
      src.connect(g);
      g.connect(this.cloudBus);
    }
    this._gActive++;
    src.onended = () => { this._gActive = Math.max(0, this._gActive - 1); };
    try { src.start(now); src.stop(now + playDur + 0.004); } catch (e) { this._gActive = Math.max(0, this._gActive - 1); }
  }

  _softClip(n) {
    const lim = 0.92;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.12) * lim;
    }
    return curve;
  }

  _makeWindow(len) {
    this._window = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      this._window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (len - 1)));
    }
  }

  _buildGrainBuffers() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * 0.48);
    const buf = this.ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.sin(Math.PI * (i / (n - 1)));
      let s = 0;
      s += Math.sin(2 * Math.PI * 220 * t) * 0.55;
      s += Math.sin(2 * Math.PI * 330 * t) * 0.2;
      s += Math.sin(2 * Math.PI * 440 * t) * 0.12;
      s += Math.sin(2 * Math.PI * 554 * t) * 0.06;
      s += (Math.random() * 2 - 1) * 0.012 * env;
      const v = s * env * 0.42;
      const wob = Math.sin(2 * Math.PI * 0.65 * t) * 0.07;
      L[i] = v * (1 - wob);
      R[i] = v * (1 + wob);
    }
    this._grainBuf = buf;

    const ns = Math.floor(sr * 0.1);
    const spark = this.ctx.createBuffer(2, ns, sr);
    const sL = spark.getChannelData(0);
    const sR = spark.getChannelData(1);
    for (let i = 0; i < ns; i++) {
      const env = Math.sin(Math.PI * (i / (ns - 1)));
      const t = i / sr;
      let s = Math.sin(2 * Math.PI * 1760 * t) * 0.32;
      s += Math.sin(2 * Math.PI * 2349 * t) * 0.15;
      s += (Math.random() * 2 - 1) * 0.03;
      const v = s * env * env * 0.24;
      sL[i] = v;
      sR[i] = v * (0.85 + Math.random() * 0.3);
    }
    this._sparkleBuf = spark;
  }

  _buildNoise() {
    if (!this.ctx || this._noiseSrc) return;
    const sr = this.ctx.sampleRate;
    const n = sr; // 1s loop
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.noiseHp);
    if (this.wildHp) src.connect(this.wildHp);
    try { src.start(); } catch (e) {}
    this._noiseSrc = src;
  }

  /** 0 until breeze 50%, then up to ~0.019 at full right (another −5 dB). Spice. */
  _breezeNoiseAmt() {
    const b = Math.max(0, Math.min(1, this.params.breeze));
    if (b <= 0.5) return 0;
    return ((b - 0.5) / 0.5) * 0.0106;
  }

  _applyBreezeNoise() {
    if (!this.ctx || !this.noiseGain) return;
    const b = Math.max(0, Math.min(1, this.params.breeze));
    const amt = this._breezeNoiseAmt();
    const now = this.ctx.currentTime;
    // Lowpass starts at 48% (was 60%) and closes slowly. Peak 15% earlier (67%, was 82%).
    let lpHz = 16000;
    let lpQ = 0.5;
    if (b > 0.48) {
      const t = (b - 0.48) / 0.52;
      const shaped = Math.pow(t, 1.55);
      lpHz = 14000 - shaped * 10800; // 14k → ~3.2k
      if (b > 0.67) {
        const qT = (b - 0.67) / 0.33;
        lpQ = 0.55 + qT * qT * 1.7; // up to ~2.25
      }
    }
    lpHz = Math.max(2800, Math.min(16000, lpHz));
    try { this.noiseGain.gain.setTargetAtTime(amt, now, 0.35); } catch (e) {}
    if (this.noiseLp) {
      try {
        this.noiseLp.frequency.setTargetAtTime(lpHz, now, 0.45);
        this.noiseLp.Q.setTargetAtTime(lpQ, now, 0.4);
      } catch (e) {}
    }
  }

  /** 0 at start / garden / seed, smoothsteps to 1 over ~52s. */
  _evolveAmt() {
    if (!this.ctx || !this._evolveOrigin) return 0;
    const t = Math.max(0, this.ctx.currentTime - this._evolveOrigin);
    const x = Math.max(0, Math.min(1, t / 52));
    return x * x * (3 - 2 * x);
  }

  _markEvolveStart() {
    if (this.ctx) this._evolveOrigin = this.ctx.currentTime;
  }

  /** Pitch 0..1 → ±10 semitones, stepped. No glissando. */
  _pitchSt() {
    const p = Math.max(0, Math.min(1, this.params.pitch));
    return Math.round((p - 0.5) * 20);
  }

  _applyPitch() {
    if (this._growOn && this._growRootHz) {
      this._rootHz = this._growRootHz;
      return;
    }
    const st = this._pitchSt();
    this._rootHz = this._rootBaseHz * Math.pow(2, st / 12);
    if (!this.ctx || !this.isRunning) {
      this._soundingPitchSt = st;
      return;
    }
    if (this._soundingPitchSt === st) return;
    this._soundingPitchSt = st;
    if (!this._padVoices.length) return;
    this._restrikePads();
  }

  _patternBank() {
    // Ordered simple pulse → sparkly arp. Melody sifts this. Pitch unlocks the right side.
    return [
      { n: 8, ev: [[0, -7], [4, -7]] },
      { n: 8, ev: [[0, -5], [4, -12]] },
      { n: 8, ev: [[0, -5], [2, -5], [4, -7], [6, -5]] },
      { n: 8, ev: [[0, -12], [3, -5], [6, -8]] },
      { n: 8, ev: [[0, -5], [4, -3], [6, -7]] },
      { n: 8, ev: [[0, 0], [4, 7], [6, 4]] },
      { n: 8, ev: [[0, 2], [2, 4], [4, 7], [6, 4]] },
      { n: 8, ev: [[0, 4], [3, 7], [5, 9], [7, 4]] },
      { n: 16, ev: [[0, 0], [4, 4], [8, 7], [12, 4]] },
      { n: 16, ev: [[0, 2], [3, 4], [6, 7], [8, 9], [12, 7]] },
      { n: 16, ev: [[0, 4], [2, 7], [4, 11], [8, 7], [10, 4], [14, 2]] },
      { n: 16, ev: [[0, 7], [2, 4], [4, 2], [6, 0], [8, 4], [12, 7]] },
      { n: 16, ev: [[0, 0], [2, 2], [4, 4], [6, 7], [8, 9], [10, 11], [12, 12], [14, 7]] },
      { n: 16, ev: [[0, 12], [1, 14], [3, 16], [4, 19], [6, 16], [8, 12], [10, 14], [12, 16], [14, 19]] },
      { n: 16, ev: [[0, 4], [1, 7], [2, 11], [4, 14], [6, 16], [8, 11], [9, 14], [10, 19], [12, 16], [14, 12]] },
      { n: 16, ev: [[0, 7], [2, 11], [3, 12], [4, 14], [6, 16], [8, 19], [10, 16], [11, 14], [12, 12], [14, 19], [15, 23]] }
    ];
  }

  _patternComplexity() {
    const m = this._melodyAmt();
    const p = Math.max(0, Math.min(1, this.params.pitch));
    return Math.max(0, Math.min(0.999, m * (0.22 + p * 0.78)));
  }

  _patternStepMs() {
    const p = Math.max(0, Math.min(1, this.params.pitch));
    const m = this._melodyAmt();
    return Math.max(180, 1040 - p * 760 - m * 40);
  }

  _latchPattern() {
    const bank = this._patternBank();
    const idx = Math.min(bank.length - 1, Math.floor(this._patternComplexity() * bank.length));
    if (idx !== this._patIdx) {
      this._patIdx = idx;
      this._patStep = 0;
    }
    return bank[this._patIdx];
  }

  _patternRegister(rel) {
    const p = Math.max(0, Math.min(1, this.params.pitch));
    let st = rel;
    if (p < 0.42 && st > 2) st -= 12;
    if (p < 0.22 && st > -5) st -= 5;
    if (p > 0.72 && rel >= 7) st += 0;
    return st;
  }

  _hitAllowed(at) {
    const p = Math.max(0, Math.min(1, this.params.pitch));
    if (p < 0.28 && (at % 4) !== 0) return false;
    if (p < 0.48 && (at % 2) === 1) return false;
    return true;
  }

  _snapScale(rel) {
    const ints = this._scaleIntervals();
    if (!ints.length || rel == null || !Number.isFinite(rel)) return rel;
    const pc = ((Math.round(rel) % 12) + 12) % 12;
    let best = ints[0];
    let bestD = 99;
    for (let i = 0; i < ints.length; i++) {
      let d = Math.abs(ints[i] - pc);
      if (d > 6) d = 12 - d;
      if (d < bestD) { bestD = d; best = ints[i]; }
    }
    let st = Math.floor(rel / 12) * 12 + best;
    if (st - rel > 6) st -= 12;
    if (rel - st > 6) st += 12;
    while (st > 5) st -= 12;
    while (st < -16) st += 12;
    return st;
  }

  _neighborScale(rel, dir) {
    const ints = this._scaleIntervals();
    const snapped = this._snapScale(rel);
    if (!ints.length) return snapped;
    const pc = ((snapped % 12) + 12) % 12;
    let i = ints.indexOf(pc);
    if (i < 0) i = 0;
    const step = dir < 0 ? -1 : 1;
    const ni = (i + step + ints.length) % ints.length;
    let st = Math.floor(snapped / 12) * 12 + ints[ni];
    if (step < 0 && ni > i) st -= 12;
    if (step > 0 && ni < i) st += 12;
    while (st > 5) st -= 12;
    while (st < -16) st += 12;
    return st;
  }

  _composeGrowthLoop(src) {
    const ints = this._scaleIntervals();
    const pool = [];
    const list = src || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].rel != null) pool.push(this._snapScale(list[i].rel));
    }
    if (!pool.length) {
      const base = ints.length ? (ints[0] - 12) : -7;
      const next = ints.length > 2 ? (ints[2] - 12) : (base + 3);
      pool.push(this._snapScale(base), this._snapScale(next));
    }
    const recent = pool.slice(-6);
    const a = this._snapScale(recent[recent.length - 1]);
    let b = null;
    for (let i = recent.length - 2; i >= 0; i--) {
      if (recent[i] !== a) { b = this._snapScale(recent[i]); break; }
    }
    if (b == null) b = this._neighborScale(a, Math.random() < 0.5 ? 1 : -1);
    const c = this._neighborScale(b, Math.random() < 0.5 ? 1 : -1);
    const phrase = [];
    const push = (rel, gap, vel) => {
      phrase.push({
        rel: rel == null ? null : this._snapScale(rel),
        gap: gap,
        vel: vel == null ? null : Math.max(0.5, Math.min(1.5, vel))
      });
    };
    const shape = (Math.random() * 3) | 0;
    if (shape === 0) {
      push(a, 0.7, 1.32);
      push(b, 0.46, 0.58);
      push(a, 1.05, 0.9);
      push(null, 0.8, null);
      push(b, 0.58, 1.08);
      push(a, 0.52, 0.55);
      push(null, 2.35 + Math.random() * 0.8, null);
      push(c, 0.64, 0.96);
      push(b, 0.86, 1.24);
      push(a, 1.1, 0.68);
      push(null, 1.7, null);
      push(a, 0.48, 0.52);
      push(b, 0.74, 1.38);
    } else if (shape === 1) {
      push(c, 0.62, 1.16);
      push(b, 0.5, 0.7);
      push(a, 0.78, 0.92);
      push(a, 0.44, 0.54);
      push(null, 1.9 + Math.random() * 0.6, null);
      push(b, 0.66, 1.3);
      push(a, 0.55, 0.62);
      push(b, 1.15, 0.84);
      push(null, 2.5, null);
      push(a, 0.7, 1.05);
      push(c, 0.48, 0.58);
      push(b, 0.9, 1.22);
    } else {
      push(a, 0.8, 1.26);
      push(a, 0.55, 0.6);
      push(null, 0.7, null);
      push(a, 0.62, 0.88);
      push(b, 1.05, 1.18);
      push(null, 2.2 + Math.random() * 0.9, null);
      push(b, 0.5, 0.56);
      push(a, 0.68, 1.1);
      push(c, 0.84, 0.78);
      push(b, 0.6, 0.64);
      push(null, 1.8, null);
      push(a, 0.72, 1.36);
    }
    push(null, 2.0 + Math.random() * 0.7, null);
    return phrase;
  }

  _syncLoopDelay(stepMs) {
    if (!this.ctx || !this.loopDly || !this.loopWet) return;
    const sec = Math.max(0.12, Math.min(0.9, (stepMs || 420) / 1000));
    const now = this.ctx.currentTime;
    try {
      this.loopDly.delayTime.setTargetAtTime(sec, now, 0.05);
      this.loopIn.gain.setTargetAtTime(1, now, 0.08);
      this.loopWet.gain.setTargetAtTime(0.1, now, 0.12);
    } catch (e) {}
  }

  _wildAmt() {
    const f = Math.max(0, Math.min(1, this.params.flowers == null ? 1 : this.params.flowers));
    if (f >= 0.8) return 0;
    const t = (0.8 - f) / 0.8;
    return Math.pow(t, 0.7);
  }

  _fmDev(hz, kind) {
    const w = this._wildAmt();
    const f = Math.max(70, hz || 196);
    if (kind === 'line') return Math.min(380, f * 1.25) * w;
    if (kind === 'mel') return Math.min(160, f * 0.62) * w;
    return Math.min(220, f * 0.75) * w;
  }

  _applyFlowers() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const w = this._wildAmt();
    if (this.wildLfo) {
      try { this.wildLfo.frequency.setTargetAtTime(0.55 + w * 1.5, now, 0.12); } catch (e) {}
    }
    if (this.lineLfoDepth) {
      try { this.lineLfoDepth.gain.setTargetAtTime(w * 0.2, now, 0.1); } catch (e) {}
    }
    const lists = [this._padVoices, this._lineVoices];
    for (let li = 0; li < lists.length; li++) {
      const list = lists[li] || [];
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v || !v.fmGain) continue;
        const dev = this._fmDev(v.hz, v.role === 'line' ? 'line' : 'pad');
        try {
          v.fmGain.gain.setTargetAtTime(dev, now, 0.08);
          if (v.fmDepth) v.fmDepth.gain.setTargetAtTime(dev * 0.62, now, 0.08);
          if (v.fmGrit) v.fmGrit.gain.setTargetAtTime(0.05 * w, now, 0.08);
        } catch (e) {}
      }
    }
    if (this.wildGain) {
      try { this.wildGain.gain.setTargetAtTime(w * 0.0016, now, 0.15); } catch (e) {}
    }
  }

  _pluckPattern(rel, growPad, vel, exact) {
    const st = exact ? rel : this._patternRegister(rel);
    const v = (vel == null) ? 1 : Math.max(0.5, Math.min(1.5, vel));
    if (growPad && this._growOn) {
      const prev = this._lineVoices || [];
      this._lineVoices = [];
      for (let i = 0; i < prev.length; i++) this._fadeOutVoice(prev[i], 0.1);
      this._spawnPadVoice(st, true, true);
    }
    this._spawnMelodyNote(st, false, v, !!exact);
  }

  _ensurePatternClock() {
    if (this._patTimer || !this.isRunning) return;
    this._patTimer = setTimeout(() => this._advancePattern(), 60);
  }

  _advancePattern() {
    this._patTimer = null;
    if (!this.isRunning) return;
    const stepMs = this._patternStepMs();

    if ((this._patMode === 'loop' || this._patMode === 'audition') && this._patLoop.length) {
      const ev = this._patLoop[this._patPlay % this._patLoop.length];
      this._patPlay = (this._patPlay + 1) % this._patLoop.length;
      const gap = (ev && ev.gap) ? ev.gap : 1;
      if (ev && ev.rel != null) {
        const vel = (ev.vel == null) ? 0.9 : Math.max(0.5, Math.min(1.5, ev.vel));
        this._pluckPattern(ev.rel, true, vel, true);
      }
      const clock = this._lockedStepMs || stepMs;
      const wait = Math.max(130, clock * gap);
      this._patTimer = setTimeout(() => this._advancePattern(), wait);
      return;
    }

    const pat = this._latchPattern();
    const at = this._patStep % pat.n;
    for (let i = 0; i < pat.ev.length; i++) {
      if (pat.ev[i][0] !== at) continue;
      if (!this._hitAllowed(at)) continue;
      const rel = pat.ev[i][1];
      this._pluckPattern(rel, this._growOn && !this._listenOnly);
      if (this._patMode === 'rec') {
        this._patBuf.push({ rel: rel, gap: 1 });
        if (this._patBuf.length > 48) this._patBuf.shift();
      }
    }
    this._patStep++;
    this._patTimer = setTimeout(() => this._advancePattern(), stepMs);
  }

  _startGrowLine() {
    // Same seed. No reseed. Just bring in the lower line so it can be judged.
    this._listenOnly = false;
    this._growOn = true;
    if (!this._growRootHz) this._growRootHz = this._rootHz;
    if (!this._patLoop.length || this._patMode === 'live' || this._patMode === 'rec') {
      this._patLoop = this._composeGrowthLoop([]);
      this._patPlay = 0;
    }
    this._lockedStepMs = this._patternStepMs();
    this._patMode = 'audition';
    this._ensurePatternClock();
    this._rememberTake();
  }

  _fadeGrowLine() {
    const prev = this._lineVoices || [];
    this._lineVoices = [];
    for (let i = 0; i < prev.length; i++) this._fadeOutVoice(prev[i], 0.18);
    if (!this._padVoices) return;
    const keep = [];
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (v && v.role === 'harm') this._fadeOutVoice(v, 0.18);
      else keep.push(v);
    }
    this._padVoices = keep;
  }

  _lockPattern() {
    this._listenOnly = false;
    this._growOn = true;
    if (!this._growRootHz) this._growRootHz = this._rootHz;
    if (!this._patLoop.length) this._patLoop = this._composeGrowthLoop([]);
    if (!this._lockedStepMs) this._lockedStepMs = this._patternStepMs();
    this._patMode = 'loop';
    this._syncLoopDelay(this._lockedStepMs);
    this._ensurePatternClock();
    this._rememberTake();
  }

  _freezeRoot() {
    this._growRootHz = this._rootHz;
    this._captureHold();
    let best = null;
    let bestAbs = 99;
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (!v || !v.alive) continue;
      v.role = 'harm';
      const d = Math.abs(v.st || 0);
      if (d < bestAbs) { best = v; bestAbs = d; }
    }
    if (best) best.role = 'root';
  }

  _releaseHarmony() {
    const extra = this._harmVoices.slice();
    this._harmVoices = [];
    for (let i = 0; i < extra.length; i++) this._fadeOutVoice(extra[i], 0.2);
  }

  /** Harmony under the frozen root. Melody slider sets how full it is. Root voice stays. */
  _strikeHarmony(relSt) {
    if (!this.ctx || !this.isRunning || !this._growOn) return;
    if (this._growRootHz) this._rootHz = this._growRootHz;
    const m = this._melodyAmt();
    let st = relSt;
    if (!Number.isFinite(st)) st = -5;
    if (st === 0 || st % 12 === 0) st = m > 0.65 ? 7 : -5;
    if (m < 0.55 && st > 2) st -= 12;
    while (st > 14) st -= 12;
    while (st < -12) st += 12;

    // Drop previous harmony pads, never the root
    const keep = [];
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (v && v.role === 'root') keep.push(v);
      else this._fadeOutVoice(v, 0.12);
    }
    this._padVoices = keep;
    this._spawnPadVoice(st, true);
    const harm = this._padVoices[this._padVoices.length - 1];
    if (harm) harm.role = 'harm';

    this._spawnMelodyNote(st, false);
    if (m > 0.42) {
      const extra = (st <= 0) ? (st + (m > 0.7 ? 4 : 7)) : (st - 7);
      this._spawnMelodyNote(extra, true);
    }
    if (m > 0.72) this._spawnMelodyNote(st - 12, true);
  }

  _captureHold() {
    const sts = [];
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (v && v.alive && typeof v.st === 'number') sts.push(v.st);
    }
    if (!sts.length) {
      const ints = this._scaleIntervals();
      for (let i = 0; i < this._growthVoices(); i++) sts.push(ints[i % ints.length]);
    }
    this._heldSt = sts;
    return sts;
  }

  /** Release the sounding chord, then strike the same intervals at the new pitch. */
  _restrikePads() {
    if (!this.ctx || !this.isRunning) return;
    if (!this._heldSt || !this._heldSt.length) this._captureHold();
    const sts = this._heldSt.slice();
    const voices = this._padVoices.slice();
    this._padVoices = [];
    for (let i = 0; i < voices.length; i++) this._fadeOutVoice(voices[i], 0.14);
    this._voiceTarget = Math.max(this._growthVoices(), sts.length);
    const n = Math.min(6, Math.max(this._growthVoices(), Math.min(sts.length, 4)));
    for (let i = 0; i < n; i++) {
      let st = sts[i % sts.length];
      if (this._growOn && Math.random() < 0.16) {
        const ints = this._scaleIntervals();
        st = ints[(Math.random() * ints.length) | 0];
        sts[i % sts.length] = st;
      }
      this._spawnPadVoice(st, true);
    }
    this._heldSt = sts;
  }

  /**
   * Six garden seed colours — cheerful / curious / soft-mystery (never dark).
   * Ordered L→R. Garden movement does Space-style stop→reseed.
   */
  _gardenSeeds() {
    return [
      { // sweet major / penta
        scale: [0, 2, 4, 7, 9, 12],
        arp: [0, 4, 7, 9, 12, 16, 19, 12],
        sparkle: 0.05,
        rootBias: 0
      },
      { // open add9
        scale: [0, 2, 4, 7, 9, 11, 12, 14],
        arp: [0, 2, 7, 9, 11, 14, 16, 19],
        sparkle: 0.14,
        rootBias: 0.3
      },
      { // bright Lydian-ish
        scale: [0, 2, 4, 6, 7, 9, 11, 14],
        arp: [0, 4, 6, 9, 11, 14, 16, 18],
        sparkle: 0.26,
        rootBias: 0.9
      },
      { // cheerful Mixolydian colour
        scale: [0, 2, 4, 7, 9, 10, 12, 14],
        arp: [0, 4, 7, 10, 12, 14, 16, 19],
        sparkle: 0.2,
        rootBias: -0.2
      },
      { // soft mystery — gift-friendly, never dark
        scale: [0, 2, 3, 7, 8, 10, 12, 15],
        arp: [0, 3, 7, 8, 10, 12, 15, 19],
        sparkle: 0.34,
        rootBias: -0.5
      },
      { // floating major7 / ninth sparkle
        scale: [0, 2, 4, 7, 11, 12, 14, 16],
        arp: [0, 4, 7, 11, 14, 16, 19, 23],
        sparkle: 0.4,
        rootBias: 0.6
      }
    ];
  }

  _pickGardenSeed(g, randomizeZone) {
    const seeds = this._gardenSeeds();
    const max = seeds.length - 1;
    const x = Math.max(0, Math.min(1, g)) * max;
    const i0 = Math.floor(x);
    const i1 = Math.min(max, i0 + 1);
    const t = x - i0;
    let idx = (t < 0.5 || i0 === i1) ? i0 : i1;
    if (randomizeZone) {
      // Beautiful reshuffle near the local garden zone
      if (Math.random() < 0.55) {
        idx = Math.max(0, Math.min(max, idx + (Math.random() < 0.5 ? -1 : 1)));
      }
      if (Math.random() < 0.18) {
        idx = (Math.random() * seeds.length) | 0;
      }
    }
    return seeds[idx];
  }

  _commitGardenSeed(g, randomizeZone) {
    const seed = this._pickGardenSeed(g, !!randomizeZone);
    this._activeGardenSeed = seed;
    this._gardenSparkle = seed.sparkle;
    this._gardenRootBias = seed.rootBias;
    return seed;
  }

  _applyDelayIdx() {
    if (!this.ctx || !this.delayNode) return;
    const idx = Math.max(0, Math.min(this._delayPresets.length - 1, this._delayPresetIdx || 0));
    const dt = this._delayPresets[idx];
    const now = this.ctx.currentTime;
    try {
      this.delayNode.delayTime.setValueAtTime(this.delayNode.delayTime.value, now);
      this.delayNode.delayTime.linearRampToValueAtTime(dt, now + 0.04);
    } catch (e) {
      try { this.delayNode.delayTime.setValueAtTime(dt, now); } catch (e2) {}
    }
  }

  _rememberTake() {
    const seed = this._activeGardenSeed;
    if (!seed) return;
    const loop = (this._patLoop || []).map((ev) => ({
      rel: ev && ev.rel != null ? ev.rel : null,
      gap: ev && ev.gap ? ev.gap : 1,
      vel: ev && ev.vel != null ? ev.vel : null
    }));
    this.params._take = {
      scale: seed.scale.slice(),
      arp: seed.arp.slice(),
      sparkle: seed.sparkle,
      rootBias: seed.rootBias,
      delayIdx: this._delayPresetIdx || 0,
      flowers: this.params.flowers,
      garden: this.params.garden,
      pitch: this.params.pitch,
      melody: this.params.melody,
      bloom: this.params.bloom,
      breeze: this.params.breeze,
      growth: this.params.growth,
      patLoop: loop,
      patMode: this._patMode || 'live',
      lockedStepMs: this._lockedStepMs || 0
    };
  }

  _restoreTake(take) {
    if (!take || !take.scale || !take.arp) return;
    this._activeGardenSeed = {
      scale: take.scale.slice(),
      arp: take.arp.slice(),
      sparkle: take.sparkle || 0.12,
      rootBias: take.rootBias || 0
    };
    this._gardenSparkle = this._activeGardenSeed.sparkle;
    this._gardenRootBias = this._activeGardenSeed.rootBias;
    if (typeof take.delayIdx === 'number') this._delayPresetIdx = take.delayIdx;
    if (Array.isArray(take.patLoop)) this._patLoop = take.patLoop.map((ev) => ({ rel: ev.rel, gap: ev.gap, vel: ev.vel }));
    if (take.patMode) this._patMode = take.patMode;
    if (take.lockedStepMs) this._lockedStepMs = take.lockedStepMs;
    this._holdTake = true;
  }

  _scaleIntervals() {
    const seed = this._activeGardenSeed || this._pickGardenSeed(this.params.garden, false);
    return seed.scale.slice();
  }

  _arpIntervals() {
    const seed = this._activeGardenSeed || this._pickGardenSeed(this.params.garden, false);
    return seed.arp.slice();
  }

  _pickSemitone() {
    const ints = this._scaleIntervals();
    const oct = Math.random() < 0.28 ? 12 : (Math.random() < 0.08 ? -12 : 0);
    return ints[(Math.random() * ints.length) | 0] + oct;
  }

  /** Pick discrete delay preset — never live-scrub delayTime. */
  _pickDelayPreset(randomize) {
    if (randomize) {
      this._delayPresetIdx = (Math.random() * this._delayPresets.length) | 0;
    } else {
      // Map air lightly to preset band without continuous morph
      const a = Math.max(0, Math.min(1, this.params.air));
      this._delayPresetIdx = Math.min(
        this._delayPresets.length - 1,
        Math.round(a * (this._delayPresets.length - 1))
      );
    }
    return this._delayPresets[this._delayPresetIdx];
  }

  _setDelayTimeDiscrete(randomize) {
    if (!this.ctx || !this.delayNode) return;
    const dt = this._pickDelayPreset(!!randomize);
    const now = this.ctx.currentTime;
    try {
      this.delayNode.delayTime.cancelScheduledValues(now);
      // Short settle — not a long morph howl
      this.delayNode.delayTime.setValueAtTime(this.delayNode.delayTime.value, now);
      this.delayNode.delayTime.linearRampToValueAtTime(dt, now + 0.04);
    } catch (e) {
      try { this.delayNode.delayTime.setValueAtTime(dt, now); } catch (e2) {}
    }
  }

  _softStopForGarden() {
    if (this._evolveTimer) { clearTimeout(this._evolveTimer); this._evolveTimer = null; }
    if (this._grainTimer) { clearTimeout(this._grainTimer); this._grainTimer = null; }
    if (this._melodyTimer) { clearTimeout(this._melodyTimer); this._melodyTimer = null; }
    if (this._patTimer) { clearTimeout(this._patTimer); this._patTimer = null; }
    if (this._cloudTimer) { clearTimeout(this._cloudTimer); this._cloudTimer = null; }
    const voices = this._padVoices.slice();
    this._padVoices = [];
    for (let i = 0; i < voices.length; i++) this._fadeOutVoice(voices[i], 0.18);
    if (this.ctx && this.padBus) {
      const t = this.ctx.currentTime;
      try {
        this.padBus.gain.cancelScheduledValues(t);
        this.padBus.gain.setValueAtTime(Math.max(0.0001, this.padBus.gain.value), t);
        this.padBus.gain.linearRampToValueAtTime(0.0001, t + 0.1);
      } catch (e) {}
    }
    // Duck delay FB briefly so restart is clean
    if (this.ctx && this.delayFb) {
      const t = this.ctx.currentTime;
      try { this.delayFb.gain.setTargetAtTime(0.02, t, 0.02); } catch (e) {}
    }
  }

  _restartFromGarden() {
    if (!this.ctx || !this.isRunning) return;
    this._commitGardenSeed(this.params.garden, true);
    this._gardenLastReseedAt = this.params.garden;
    this._markEvolveStart();
    this._setDelayTimeDiscrete(true);
    this._applyTone();
    this._applyAir();
    this._applyBreezeNoise();
    this._ensurePadVoices();
    if (!this._evolveTimer) this._evolvePads();
    if (!this._grainTimer) this._scheduleGrains();
    if (!this._melodyTimer) this._scheduleMelody();
  }

  /**
   * Garden knob: Space-like stop→restart on movement past a small delta.
   * Discrete reseed — not continuous morph wash.
   */
  _applyGarden() {
    const g = Math.max(0, Math.min(1, this.params.garden));
    this._gardenPrev = g;
    if (!this.ctx || !this.isRunning) {
      if (!this._holdTake) this._commitGardenSeed(g, false);
      this._gardenLastReseedAt = g;
      return;
    }
    if (this._activeGardenSeed == null) this._commitGardenSeed(g, false);
    const last = this._gardenLastReseedAt;
    const delta = last == null ? 1 : Math.abs(g - last);
    if (delta < 0.04 && !this._gardenPendingStop) return;

    if (!this._gardenPendingStop) {
      this._gardenPendingStop = true;
      this._softStopForGarden();
    }
    if (this._gardenReseedTimer) clearTimeout(this._gardenReseedTimer);
    this._gardenReseedTimer = setTimeout(() => {
      this._gardenReseedTimer = null;
      this._gardenPendingStop = false;
      if (!this.isRunning) return;
      this._restartFromGarden();
      this._holdTake = false;
      this._rememberTake();
    }, 100);
  }

  /**
   * Growth sweet-spot curve: most of the travel stays sparse (2–4 voices).
   * Only the far right densifies gently (max 6).
   */
  _growthVoices() {
    const g = Math.max(0, Math.min(1, this.params.growth));
    // Ease: 0→2, 0.5→3, 0.75→4, 1→6
    const shaped = Math.pow(g, 1.35);
    return 2 + Math.round(shaped * 4);
  }

  _grainHz() {
    const g = Math.max(0, Math.min(1, this.params.growth));
    const b = Math.max(0, Math.min(1, this.params.breeze));
    // Sparse: ~0.8–6 Hz useful range (v1 went denser)
    const shaped = Math.pow(g, 1.25);
    return 0.8 + shaped * 4.2 + b * 1.6;
  }

  /** Air 0..1: dry intimate → soft garden air. Hard FB caps. */
  _airAmt() {
    this.params.air = 0.5;
    return 0.5;
  }

  /** Melody 0..1: silence → sparse evolving notes (no wash/FB coupling). */
  _melodyAmt() {
    return Math.max(0, Math.min(1, this.params.melody == null ? 0.4 : this.params.melody));
  }

  _applyTone() {
    if (!this.ctx || !this.toneLp) return;
    const bl = Math.max(0, Math.min(1, this.params.bloom));
    const air = this._airAmt();
    const now = this.ctx.currentTime;
    const tauF = 0.28;
    const tauG = 0.24;
    // Bloom opens sweetly; air softens highs a touch at high end
    const bloomHz = 1400 + Math.pow(bl, 0.8) * 5200;
    const hzClamped = Math.max(1400, Math.min(7200, bloomHz - air * 400));
    this.toneLp.frequency.setTargetAtTime(hzClamped, now, tauF);
    this.toneLp.Q.setTargetAtTime(0.24 + bl * 0.12, now, tauF);
    if (this.toneHp) {
      this.toneHp.frequency.setTargetAtTime(50 + bl * 25, now, tauF);
    }
    if (this.padBus) {
      const padLvl = 0.52 + bl * 0.22;
      this.padBus.gain.setTargetAtTime(Math.max(0.28, Math.min(0.82, padLvl)), now, tauG);
    }
    if (this.grainBus) {
      const gLvl = 0.38 + bl * 0.14 - air * 0.04;
      this.grainBus.gain.setTargetAtTime(Math.max(0.16, Math.min(0.62, gLvl)), now, tauG);
    }
    if (this.melodyBus) {
      const m = this._melodyAmt();
      const e = this._evolveAmt();
      // Walks in: quiet at start, stronger as it evolves. Still not a wash.
      const walk = 0.28 + e * 1.05;
      const mLvl = (0.07 + m * 0.3) * walk * (0.85 + bl * 0.15) * 5.623;
      this.melodyBus.gain.setTargetAtTime(Math.max(0.04, Math.min(1.4, mLvl)), now, tauG);
    }
  }

  _applyAir() {
    if (!this.ctx || !this.spaceWet) return;
    const air = this._airAmt();
    // Soft curve: most travel is light air, top is still capped
    const a = Math.pow(air, 0.9);
    const now = this.ctx.currentTime;
    const tauG = 0.3;
    const tauF = 0.35;
    // HARD CAPS — no mid howl / long sustain pile
    const wet = Math.min(0.46, 0.14 + a * 0.32);
    const dry = Math.max(0.54, 0.88 - a * 0.24);
    this.spaceWet.gain.setTargetAtTime(wet, now, tauG);
    this.spaceDry.gain.setTargetAtTime(dry, now, tauG);
    this.delaySend.gain.setTargetAtTime(Math.min(0.28, 0.1 + a * 0.16), now, tauG);
    this.delayReturn.gain.setTargetAtTime(Math.min(0.26, 0.12 + a * 0.14), now, tauG);
    // FB hard cap ~0.16 — still no mid howl
    this.delayFb.gain.setTargetAtTime(Math.min(0.16, 0.05 + a * 0.1), now, tauG);
    // delayTime NOT scrubbed here — only discrete on Seed/garden
    this.delayTone.frequency.setTargetAtTime(3600 + a * 800 - a * a * 600, now, tauF);
    if (this.delayTone) this.delayTone.Q.setTargetAtTime(0.2, now, tauF);
    this.spaceLp.frequency.setTargetAtTime(6400 + a * 1200 - a * a * 1800, now, tauF);
    const fb = Math.min(0.12, 0.05 + a * 0.06);
    for (let i = 0; i < this.spaceFbs.length; i++) {
      this.spaceFbs[i].gain.setTargetAtTime(fb * (0.8 + (i % 3) * 0.05), now, tauG);
    }
    this._applyTone();
  }

  _hzFromSt(st) {
    const bias = this._gardenRootBias || 0;
    return this._rootHz * Math.pow(2, (st + bias) / 12);
  }

  _ensurePadVoices() {
    if (!this.ctx || !this.isRunning) return;
    const target = this._growthVoices();
    this._voiceTarget = target;
    while (this._padVoices.length < target) this._spawnPadVoice();
    while (this._padVoices.length > target) {
      const v = this._padVoices.pop();
      this._fadeOutVoice(v, 0.7);
    }
  }

  _spawnPadVoice(stOverride, pluck, asLine) {
    if (!this.ctx || !this.padBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const st = (typeof stOverride === 'number') ? stOverride : this._pickSemitone();
    const hz = this._hzFromSt(st);
    const bloom = Math.max(0, Math.min(1, this.params.bloom));
    const breeze = Math.max(0, Math.min(1, this.params.breeze));

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = bloom > 0.6 ? 'triangle' : 'sine';
    const det = 0.06 + breeze * 0.28 + Math.random() * 0.1;
    oscA.frequency.setValueAtTime(hz, now);
    oscB.frequency.setValueAtTime(hz * (1 + det / 100), now);
    const kind = asLine ? 'line' : 'pad';
    const dev = this._fmDev(hz, kind);
    const fm = ctx.createGain();
    fm.gain.setValueAtTime(dev, now);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(hz * (asLine ? 0.5 : 1.0), now);
    mod.connect(fm);
    fm.connect(oscA.frequency);
    if (asLine) fm.connect(oscB.frequency);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(dev * 0.62, now);
    if (this.wildLfo) this.wildLfo.connect(depth);
    depth.connect(fm.gain);
    const grit = asLine ? ctx.createGain() : null;
    if (grit) {
      grit.gain.setValueAtTime(0.05 * this._wildAmt(), now);
      mod.connect(grit);
      grit.connect(this.lineBus);
    }
    try { mod.start(now); } catch (e) {}

    let oscC = null;
    let gC = null;
    if (bloom > 0.4) {
      oscC = ctx.createOscillator();
      oscC.type = 'sine';
      oscC.frequency.setValueAtTime(hz * 2 * (1 + (Math.random() * 0.003 - 0.0015)), now);
      gC = ctx.createGain();
      gC.gain.setValueAtTime(0.0001, now);
      gC.gain.linearRampToValueAtTime(0.03 + bloom * 0.07, now + (pluck ? 0.04 : 1.6));
    }

    const gA = ctx.createGain();
    const gB = ctx.createGain();
    gA.gain.setValueAtTime(0, now);
    gB.gain.setValueAtTime(0, now);
    const peak = (0.05 + (1 / Math.max(2, this._voiceTarget)) * 0.09) * (pluck ? 0.3162 : 0.0562);
    if (pluck) {
      gA.gain.linearRampToValueAtTime(peak, now + 0.012);
      gA.gain.linearRampToValueAtTime(peak * 0.5, now + 0.26);
      gB.gain.linearRampToValueAtTime(peak * 0.62, now + 0.014);
      gB.gain.linearRampToValueAtTime(peak * 0.32, now + 0.3);
    } else {
      gA.gain.linearRampToValueAtTime(peak, now + 1.8 + Math.random());
      gB.gain.linearRampToValueAtTime(peak * 0.65, now + 2.1 + Math.random());
    }

    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      const p0 = (Math.random() * 2 - 1) * (0.22 + breeze * 0.5);
      pan.pan.setValueAtTime(p0, now);
    }

    const vGain = ctx.createGain();
    vGain.gain.setValueAtTime(1, now);

    oscA.connect(gA);
    oscB.connect(gB);
    gA.connect(vGain);
    gB.connect(vGain);
    if (oscC && gC) {
      oscC.connect(gC);
      gC.connect(vGain);
    }
    const dest = (asLine && this.lineBus) ? this.lineBus : this.padBus;
    if (pan) {
      vGain.connect(pan);
      pan.connect(dest);
    } else {
      vGain.connect(dest);
    }

    try { oscA.start(now); } catch (e) {}
    try { oscB.start(now); } catch (e) {}
    if (oscC) try { oscC.start(now); } catch (e) {}

    const voice = { oscA, oscB, oscC, fmMod: mod, gA, gB, gC, pan, vGain, fmGain: fm, fmDepth: depth, fmGrit: grit, st, hz, pan0: pan ? pan.pan.value : 0, alive: true, role: asLine ? 'line' : null };
    if (asLine) {
      if (!this._lineVoices) this._lineVoices = [];
      this._lineVoices.push(voice);
    } else {
      this._padVoices.push(voice);
    }
  }

  _fadeOutVoice(v, sec) {
    if (!v || !this.ctx || !v.alive) return;
    v.alive = false;
    const t = this.ctx.currentTime;
    const s = Math.max(0.08, sec || 1.0);
    try {
      v.vGain.gain.cancelScheduledValues(t);
      v.vGain.gain.setValueAtTime(Math.max(0.0001, v.vGain.gain.value), t);
      v.vGain.gain.linearRampToValueAtTime(0.0001, t + s);
    } catch (e) {}
    setTimeout(() => {
      try { v.oscA.stop(); } catch (e) {}
      try { v.oscB.stop(); } catch (e) {}
      if (v.oscC) try { v.oscC.stop(); } catch (e) {}
      if (v.fmMod) try { v.fmMod.stop(); } catch (e) {}
      try { v.oscA.disconnect(); } catch (e) {}
      try { v.oscB.disconnect(); } catch (e) {}
      if (v.oscC) try { v.oscC.disconnect(); } catch (e) {}
      try { v.vGain.disconnect(); } catch (e) {}
      if (v.pan) try { v.pan.disconnect(); } catch (e) {}
    }, (s + 0.08) * 1000);
  }

  _evolvePads() {
    this._evolveTimer = null;
    if (!this.isRunning || !this.ctx) return;
    const breeze = Math.max(0, Math.min(1, this.params.breeze));
    const now = this.ctx.currentTime;

    this._ensurePadVoices();

    const midEvolve = !this._growOn || this._patMode === 'loop';
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (!v || !v.alive || v.role === 'line' || v.role === 'harm') continue;
      if (v.pan && breeze > 0.08 && midEvolve) {
        const pEnd = Math.max(-1, Math.min(1, v.pan0 + (Math.random() * 2 - 1) * breeze * 0.5));
        try { v.pan.pan.setTargetAtTime(pEnd, now, 1.3); } catch (e) {}
      }
    }

    // Evolve only the mid pad. Never the captured lower line.
    if (midEvolve && this._padVoices.length && Math.random() < 0.12 + breeze * 0.1) {
      const mids = [];
      for (let i = 0; i < this._padVoices.length; i++) {
        const v = this._padVoices[i];
        if (v && v.role !== 'line' && v.role !== 'harm') mids.push(i);
      }
      if (mids.length) {
        const idx = mids[(Math.random() * mids.length) | 0];
        const old = this._padVoices.splice(idx, 1)[0];
        this._fadeOutVoice(old, 1.4);
        this._spawnPadVoice();
      }
    }

    const next = 2200 + (1 - breeze) * 2600 + Math.random() * 1400;
    this._evolveTimer = setTimeout(() => this._evolvePads(), next);
  }

  /**
   * Sparse evolving melody — amount from Melody slider.
   * No coupling to delay wash/FB (that was the v1 mid-howl path).
   */
  _scheduleMelody() {
    this._melodyTimer = null;
    if (!this.isRunning || !this.ctx) return;
    const m = this._melodyAmt();
    const e = this._evolveAmt();
    this._applyTone();

    if (this._patTimer || this._patMode === 'rec' || this._patMode === 'loop' || this._patMode === 'audition') {
      this._melodyTimer = setTimeout(() => this._scheduleMelody(), 2000);
      return;
    }
    this._ensurePatternClock();
    this._melodyTimer = setTimeout(() => this._scheduleMelody(), 2000);
    return;

    if (m < 0.03) {
      this._melodyTimer = setTimeout(() => this._scheduleMelody(), 1600);
      return;
    }

    const pattern = this._arpIntervals();
    this._melIdx = ((this._melIdx % pattern.length) + pattern.length) % pattern.length;
    let st = pattern[this._melIdx] + this._melOct;
    // Neighbour colour arrives as the line evolves, not at the first steps
    if (e > 0.22 && m > 0.28 && Math.random() < 0.08 + e * 0.22 + m * 0.12) {
      const opts = [-2, 2, 5, 7];
      st += opts[(Math.random() * opts.length) | 0];
    }

    this._spawnMelodyNote(st, false);
    if (e > 0.18 && m > 0.22 && Math.random() < 0.08 + e * 0.34 + m * 0.16) {
      const harm = st + (Math.random() < 0.55 ? 4 : 7);
      this._spawnMelodyNote(harm, true);
    }
    if (e > 0.62 && m > 0.45 && Math.random() < 0.12 + e * 0.18) {
      this._spawnMelodyNote(st + 12, true);
    }

    this._melIdx += this._melDir;
    if (e > 0.7 && Math.random() < 0.08) this._melIdx += this._melDir;
    if (this._melIdx >= pattern.length - 1) {
      this._melDir = -1;
      if (Math.random() < 0.16 + e * 0.2) this._melOct = Math.random() < 0.45 ? 12 : 0;
    } else if (this._melIdx <= 0) {
      this._melDir = 1;
      if (Math.random() < 0.22) this._melOct = 0;
    }

    // Starts with space, tightens as it evolves. Still leaves breath.
    const baseMs = (1080 - m * 340) * (1.2 - e * 0.48);
    const jitter = (Math.random() * 0.32 - 0.08) * baseMs;
    const breeze = Math.max(0, Math.min(1, this.params.breeze));
    let next = Math.max(260, baseMs + jitter + (1 - breeze) * 60);
    if (e < 0.25 && Math.random() < 0.35) next += 280 + Math.random() * 420;
    else if (m > 0.55 && e > 0.4 && Math.random() < 0.1) next += 160 + Math.random() * 200;
    this._melodyTimer = setTimeout(() => this._scheduleMelody(), next);
  }

  _spawnMelodyNote(st, isHarm, vel, exact) {
    if (!this.ctx || !this.melodyBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const m = this._melodyAmt();
    const bloom = Math.max(0, Math.min(1, this.params.bloom));
    const e = this._evolveAmt();
    let hz = this._hzFromSt(st);
    const phrase = !!exact;
    const fm = ctx.createGain();
    const dev = this._fmDev(hz, phrase ? 'line' : 'mel');
    fm.gain.setValueAtTime(dev, now);
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(hz * (phrase ? 0.5 : 1.0), now);
    mod.connect(fm);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(dev * 0.62, now);
    if (this.wildLfo) this.wildLfo.connect(depth);
    depth.connect(fm.gain);
    if (!exact && e > 0.35 && m > 0.4 && Math.random() < 0.2) {
      const cents = (Math.random() * 2 - 1) * (4 + m * 10 + e * 6);
      hz *= Math.pow(2, cents / 1200);
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);
    fm.connect(osc.frequency);

    let osc2 = null;
    if (!isHarm && (bloom > 0.4 || e > 0.45)) {
      osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(hz * 1.0014, now);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    if (phrase) {
      const grit = ctx.createGain();
      grit.gain.setValueAtTime(0.18 * this._wildAmt(), now);
      mod.connect(grit);
      grit.connect(env);
    }
    // Walks in louder. Still capped so it cannot become a second pad.
    const walk = exact ? 0.72 : (0.34 + e * 1.15);
    const vMul = (vel == null) ? 1 : Math.max(0.5, Math.min(1.5, vel));
    const peak = Math.min(0.55, (isHarm ? 0.04 : 0.086) * (0.62 + m * 0.55) * walk / Math.max(1, Math.sqrt(this._voiceTarget * 0.45)) * 5.623 * vMul);
    const dur = exact ? 0.34 : Math.min(0.7, (0.16 + m * 0.16 + e * 0.22) + Math.random() * 0.07);
    env.gain.linearRampToValueAtTime(peak, now + (exact ? 0.018 : 0.02 + Math.random() * 0.02));
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      const side = isHarm ? 0.32 : -0.18;
      pan.pan.setValueAtTime(exact ? side : (side + (Math.random() * 2 - 1) * 0.2), now);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1700 + bloom * 1600 + m * 280 + e * 700, now);
    lp.Q.setValueAtTime(0.28, now);

    osc.connect(env);
    if (osc2) {
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(peak * 0.3, now);
      osc2.connect(g2);
      g2.connect(env);
    }
    env.connect(lp);
    if (pan) {
      lp.connect(pan);
      pan.connect(this.melodyBus);
    } else {
      lp.connect(this.melodyBus);
    }

    try { osc.start(now); osc.stop(now + dur + 0.04); } catch (e) {}
    try { mod.start(now); mod.stop(now + dur + 0.04); } catch (e) {}
    if (osc2) try { osc2.start(now); osc2.stop(now + dur + 0.04); } catch (e) {}
    osc.onended = () => {
      try { osc.disconnect(); } catch (e) {}
      try { env.disconnect(); } catch (e) {}
      try { lp.disconnect(); } catch (e) {}
      if (pan) try { pan.disconnect(); } catch (e) {}
      if (osc2) try { osc2.disconnect(); } catch (e) {}
    };
  }

  _scheduleGrains() {
    this._grainTimer = null;
    if (!this.isRunning || !this.ctx) return;
    const growth = Math.max(0, Math.min(1, this.params.growth));
    const breeze = Math.max(0, Math.min(1, this.params.breeze));
    if (growth > 0.06) {
      this._spawnGrain(false);
      const sparkleP = this._gardenSparkle != null ? this._gardenSparkle * 0.85 : 0.1;
      if (Math.random() < sparkleP) this._spawnGrain(true);
    }
    const hz = this._grainHz();
    const intervalMs = Math.max(70, 1000 / Math.max(0.4, hz));
    const jitter = (Math.random() * 0.45 - 0.12) * intervalMs * (0.35 + breeze);
    this._grainTimer = setTimeout(() => this._scheduleGrains(), Math.max(50, intervalMs + jitter));
  }

  _spawnGrain(sparkle) {
    if (!this.ctx || !this.grainBus) return;
    if (this._activeGrains >= this._maxGrains) return;
    const buf = sparkle ? this._sparkleBuf : this._grainBuf;
    if (!buf) return;

    const now = this.ctx.currentTime;
    const breeze = Math.max(0, Math.min(1, this.params.breeze));
    const bloom = Math.max(0, Math.min(1, this.params.bloom));
    const growth = Math.max(0, Math.min(1, this.params.growth));

    const st = this._pickSemitone();
    const targetHz = this._hzFromSt(st + (sparkle ? 12 : 0));
    const rate = Math.max(0.28, Math.min(2.8, targetHz / 220));
    const dur = sparkle
      ? 0.045 + Math.random() * 0.05
      : 0.1 + Math.random() * (0.1 + bloom * 0.14);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate * (1 + (Math.random() * 2 - 1) * breeze * 0.035), now);

    const env = this.ctx.createGain();
    const peak = (sparkle ? 0.08 : 0.11) * (0.48 + growth * 0.35) / Math.max(1, Math.sqrt(this._voiceTarget));
    const fade = Math.max(0.008, Math.min(0.016, dur * 0.28));
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + fade);
    env.gain.setValueAtTime(peak, now + Math.max(fade, dur - fade));
    env.gain.linearRampToValueAtTime(0, now + dur);

    let pan = null;
    if (this.ctx.createStereoPanner) {
      pan = this.ctx.createStereoPanner();
      const scatter = 0.18 + breeze * 0.7;
      pan.pan.setValueAtTime((Math.random() * 2 - 1) * scatter, now);
    }

    const gLevel = this.ctx.createGain();
    gLevel.gain.setValueAtTime(peak, now);

    const bp = this.ctx.createBiquadFilter();
    bp.type = sparkle ? 'highpass' : 'bandpass';
    bp.frequency.setValueAtTime(sparkle ? 1900 + bloom * 2000 : 480 + bloom * 1300, now);
    bp.Q.setValueAtTime(sparkle ? 0.5 : 0.5 + bloom * 0.28, now);

    src.connect(bp);
    bp.connect(env);
    env.connect(gLevel);
    if (pan) {
      gLevel.connect(pan);
      pan.connect(this.grainBus);
    } else {
      gLevel.connect(this.grainBus);
    }

    const playDur = Math.min(dur, Math.max(0.03, buf.duration / Math.max(0.25, rate)));
    this._activeGrains++;
    try {
      src.start(now, 0, playDur + 0.02);
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
      try { bp.disconnect(); } catch (e) {}
      if (pan) try { pan.disconnect(); } catch (e) {}
    };
  }

  /**
   * Seed — Space-equivalent hard reseed:
   * hard stop → clear delay/space FB → brief silence → start with new
   * randomized beautiful state (garden + delay preset + soft param nudges).
   */
  reseedBeautiful() {
    if (!this.ctx) return;
    if (this._seedTimer) { clearTimeout(this._seedTimer); this._seedTimer = null; }
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    this._gardenPendingStop = false;
    this.stop();
    const t = this.ctx.currentTime;
    try {
      if (this.delayFb) this.delayFb.gain.setTargetAtTime(0, t, 0.015);
      if (this.delaySend) this.delaySend.gain.setTargetAtTime(0, t, 0.015);
      if (this.delayReturn) this.delayReturn.gain.setTargetAtTime(0, t, 0.015);
      if (this.spaceFbs) {
        for (let i = 0; i < this.spaceFbs.length; i++) {
          this.spaceFbs[i].gain.setTargetAtTime(0, t, 0.015);
        }
      }
    } catch (e) {}
    this._seedTimer = setTimeout(() => {
      this._seedTimer = null;
      if (!this.ctx) return;
      // Nudge into sweet musical zones (not extreme edges)
      this.params.garden = 0.12 + Math.random() * 0.76;
      this.params.melody = 0.22 + Math.random() * 0.5;
      this.params.air = 0.5;
      this.params.bloom = 0.4 + Math.random() * 0.4;
      this.params.growth = 0.25 + Math.random() * 0.45;
      this.params.breeze = 0.3 + Math.random() * 0.45;
      // Soft pitch wander within ±4 st of current
      const p0 = this.params.pitch;
      this.params.pitch = Math.max(0.15, Math.min(0.85, p0 + (Math.random() * 2 - 1) * 0.18));
      this._setDelayTimeDiscrete(true);
      this._freshSeed = true;
      this.start();
      this._rememberTake();
    }, 220);
  }

  setParameter(paramId, value) {
    if (paramId === '_take') {
      this.params._take = value;
      this._restoreTake(value);
      return;
    }
    if (paramId === 'seed' || paramId === '__seed') {
      this._growOn = false;
      this._listenOnly = false;
      this._heldSt = null;
      this._growRootHz = null;
      this._patMode = 'live';
      this._patLoop = [];
      this._patPlay = 0;
      this._lockedStepMs = 0;
      this._fadeGrowLine();
      this.reseedBeautiful();
      return;
    }
    if (paramId === 'grow' || paramId === '__grow') {
      const v = Number(value);
      if (v === 0 || value === false) {
        this._growOn = false;
        this._listenOnly = false;
        this._patMode = 'live';
        this._patBuf = [];
        this._patLoop = [];
        this._patPlay = 0;
        this._lockedStepMs = 0;
        this._releaseHarmony();
        this._fadeGrowLine();
        if (this.loopWet && this.ctx) {
          try { this.loopWet.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); } catch (e) {}
        }
        return;
      }
      if (v >= 1.5) {
        this._lockPattern();
        return;
      }
      // First Grow: same seed, add the lower line. Do not randomize.
      this._startGrowLine();
      return;
    }
    if (paramId === 'harm' || paramId === '__harm') {
      const st = Math.round(Number(value) * 24 - 12);
      this._strikeHarmony(st);
      return;
    }
    if (paramId === 'air') {
      this.params.air = 0.5;
      this._applyAir();
      return;
    }
    if (paramId === 'grainPitch' || paramId === 'harmony' || paramId === 'spray' || paramId === 'decay') {
      this.params[paramId] = value;
      return;
    }
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'bloom') this._applyTone();
    else if (paramId === 'air') this._applyAir();
    else if (paramId === 'pitch') this._applyPitch();
    else if (paramId === 'garden') this._applyGarden();
    else if (paramId === 'melody') this._applyTone();
    else if (paramId === 'flowers') this._applyFlowers();
    else if (paramId === 'growth' && this.isRunning) this._ensurePadVoices();
    else if (paramId === 'breeze') this._applyBreezeNoise();
    // breeze pitch/pan: live via evolve/grains — no delay morph
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
    this.outputNode.gain.linearRampToValueAtTime(0.86, t + 0.14);
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    this._gardenPendingStop = false;
    if (this._freshSeed) {
      this._freshSeed = false;
      this._commitGardenSeed(this.params.garden, true);
      this._markEvolveStart();
    } else if (!this._activeGardenSeed && this.params._take) {
      this._restoreTake(this.params._take);
    } else if (!this._activeGardenSeed) {
      this._commitGardenSeed(this.params.garden, false);
    }
    this._gardenLastReseedAt = this.params.garden;
    this._gardenPrev = this.params.garden;
    if (!this._evolveOrigin) this._markEvolveStart();
    if (this._holdTake || this.params._take) this._applyDelayIdx();
    else this._setDelayTimeDiscrete(false);
    this._rememberTake();
    this._applyPitch();
    this._applyTone();
    this._applyAir();
    this._ensurePadVoices();
    this._evolvePads();
    this._scheduleGrains();
    this._scheduleMelody();
    this._patMode = this._patMode || 'live';
    this._ensurePatternClock();
    if (!this._cloudTimer) this._scheduleCloud();
  }

  stop() {
    this.isRunning = false;
    this._gardenPendingStop = false;
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    if (this._grainTimer) { clearTimeout(this._grainTimer); this._grainTimer = null; }
    if (this._evolveTimer) { clearTimeout(this._evolveTimer); this._evolveTimer = null; }
    if (this._melodyTimer) { clearTimeout(this._melodyTimer); this._melodyTimer = null; }
    const voices = this._padVoices.slice();
    this._padVoices = [];
    for (let i = 0; i < voices.length; i++) this._fadeOutVoice(voices[i], 0.3);
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.1);
    if (this.delayFb) this.delayFb.gain.setTargetAtTime(0, t, 0.04);
    if (this.delaySend) this.delaySend.gain.setTargetAtTime(0, t, 0.04);
    if (this.spaceFbs) {
      for (let i = 0; i < this.spaceFbs.length; i++) {
        this.spaceFbs[i].gain.setTargetAtTime(0, t, 0.04);
      }
    }
  }

  dispose() {
    if (this._seedTimer) { clearTimeout(this._seedTimer); this._seedTimer = null; }
    this.stop();
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this.spaceTaps = [];
    this.spaceFbs = [];
    this._grainBuf = null;
    this._sparkleBuf = null;
    if (this._noiseSrc) {
      try { this._noiseSrc.stop(); } catch (e) {}
      try { this._noiseSrc.disconnect(); } catch (e) {}
      this._noiseSrc = null;
    }
    if (this.wildLfo) {
      try { this.wildLfo.stop(); } catch (e) {}
      this.wildLfo = null;
    }
    if (this._chorusLfos) {
      for (let i = 0; i < this._chorusLfos.length; i++) {
        try { this._chorusLfos[i].stop(); } catch (e) {}
      }
      this._chorusLfos = [];
    }
    this.ctx = null;
    this.outputNode = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = BloomV2DSP;
  window.BloomV2DSP = BloomV2DSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BloomV2DSP };
}
