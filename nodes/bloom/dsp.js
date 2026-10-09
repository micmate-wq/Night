/**
 * Bloom — cheerful growthy ambient generator for Aether (gift for Lera).
 * Self-voicing soft harmonic pad + BufferSource soft grains.
 * Native Web Audio only. No ScriptProcessor / AudioWorklet.
 * Class DSP like Halo / Crowd. Always Aether.
 * v1.2.4 — Drift remap + sparse mid cleanup.
 */
class BloomDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.isRunning = false;
    this._graph = [];
    this._padVoices = [];
    this._grainTimer = null;
    this._evolveTimer = null;
    this._driftTimer = null;
    this._activeGrains = 0;
    this._maxGrains = 36;
    this._grainBuf = null;
    this._sparkleBuf = null;
    this._rootBaseHz = 196; // G3 — warm garden root (Pitch=0.5)
    this._rootHz = 196;
    this._voiceTarget = 4;
    this._driftIdx = 0;
    this._driftDir = 1;
    this._driftChord = 0;
    this._gardenPrev = null;
    this._gardenLastReseedAt = null;
    this._gardenReseedTimer = null;
    this._gardenPendingStop = false;
    this._activeGardenSeed = null;
    this._gardenRootBias = 0;
    this._gardenSparkle = 0.12;
    this._seedTimer = null;
    this.params = {
      growth: 0.55,
      breeze: 0.45,
      bloom: 0.62,
      garden: 0.28,
      pitch: 0.5,
      drift: 0.5,
      dusk: 0.42
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

    this.padBus = this._add(ctx.createGain());
    this.padBus.gain.setValueAtTime(0.72, now);

    this.grainBus = this._add(ctx.createGain());
    this.grainBus.gain.setValueAtTime(0.55, now);

    this.driftBus = this._add(ctx.createGain());
    this.driftBus.gain.setValueAtTime(0.28, now);

    this.mixBus = this._add(ctx.createGain());
    this.mixBus.gain.setValueAtTime(1, now);

    this.toneLp = this._add(ctx.createBiquadFilter());
    this.toneLp.type = 'lowpass';
    this.toneLp.frequency.setValueAtTime(4200, now);
    this.toneLp.Q.setValueAtTime(0.38, now);

    this.toneHp = this._add(ctx.createBiquadFilter());
    this.toneHp.type = 'highpass';
    this.toneHp.frequency.setValueAtTime(55, now);
    this.toneHp.Q.setValueAtTime(0.5, now);

    // Airy delay (not dark hall) — also feeds evolving-harmony echoes
    this.delayNode = null;
    const delayCands = [1.6, 1.2, 0.9];
    for (let i = 0; i < delayCands.length; i++) {
      try {
        this.delayNode = this._add(ctx.createDelay(delayCands[i]));
        break;
      } catch (e) {
        this.delayNode = null;
      }
    }
    if (!this.delayNode) this.delayNode = this._add(ctx.createDelay());
    this.delayNode.delayTime.setValueAtTime(0.32, now);

    this.delayFb = this._add(ctx.createGain());
    this.delayFb.gain.setValueAtTime(0.12, now);
    this.delayTone = this._add(ctx.createBiquadFilter());
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.setValueAtTime(4800, now);
    this.delayTone.Q.setValueAtTime(0.28, now);
    this.delaySend = this._add(ctx.createGain());
    this.delaySend.gain.setValueAtTime(0.15, now);
    this.delayReturn = this._add(ctx.createGain());
    this.delayReturn.gain.setValueAtTime(0.18, now);

    // Light multi-tap air (dusk)
    this.spaceIn = this._add(ctx.createGain());
    this.spaceIn.gain.setValueAtTime(1, now);
    this.spaceWet = this._add(ctx.createGain());
    this.spaceWet.gain.setValueAtTime(0.18, now);
    this.spaceDry = this._add(ctx.createGain());
    this.spaceDry.gain.setValueAtTime(0.82, now);
    this.spaceLp = this._add(ctx.createBiquadFilter());
    this.spaceLp.type = 'lowpass';
    this.spaceLp.frequency.setValueAtTime(7800, now);
    this.spaceLp.Q.setValueAtTime(0.35, now);
    this.spaceHp = this._add(ctx.createBiquadFilter());
    this.spaceHp.type = 'highpass';
    this.spaceHp.frequency.setValueAtTime(100, now);

    this.spaceTaps = [];
    this.spaceFbs = [];
    const tapTimes = [0.021, 0.029, 0.037, 0.047, 0.061];
    for (let i = 0; i < tapTimes.length; i++) {
      let d;
      try { d = this._add(ctx.createDelay(0.2)); }
      catch (e) { d = this._add(ctx.createDelay()); }
      d.delayTime.setValueAtTime(tapTimes[i], now);
      const fb = this._add(ctx.createGain());
      fb.gain.setValueAtTime(0.06 + (i % 2) * 0.02, now);
      const tapG = this._add(ctx.createGain());
      tapG.gain.setValueAtTime(0.08 + (i % 3) * 0.015, now);
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
    this.outComp.ratio.setValueAtTime(2.6, now);
    this.outComp.attack.setValueAtTime(0.012, now);
    this.outComp.release.setValueAtTime(0.22, now);

    this.outLimit = this._add(ctx.createWaveShaper());
    this.outLimit.curve = this._softClip(1024);
    this.outLimit.oversample = '2x';

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    // Graph: pad/grain/harmony → tone → mix → delay/space → out
    this.padBus.connect(this.toneHp);
    this.grainBus.connect(this.toneHp);
    this.driftBus.connect(this.toneHp);
    this.toneHp.connect(this.toneLp);
    this.toneLp.connect(this.mixBus);

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

    this.spaceDry.connect(this.outComp);
    this.spaceWet.connect(this.outComp);
    this.outComp.connect(this.outLimit);
    this.outLimit.connect(this.outputNode);

    this._buildGrainBuffers();
    this._makeWindow(256);
    this._applyGarden();
    this._applyPitch();
    this._applyTone();
    this._applyDusk();
    this._voiceTarget = this._growthVoices();

    return this.outputNode;
  }

  _softClip(n) {
    const lim = 0.92;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.15) * lim;
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
    // Soft harmonic bloom grain (~0.55s)
    const n = Math.floor(sr * 0.55);
    const buf = this.ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.sin(Math.PI * (i / (n - 1)));
      // Warm partials — sweet, not harsh
      let s = 0;
      s += Math.sin(2 * Math.PI * 220 * t) * 0.55;
      s += Math.sin(2 * Math.PI * 330 * t) * 0.22;
      s += Math.sin(2 * Math.PI * 440 * t) * 0.14;
      s += Math.sin(2 * Math.PI * 554 * t) * 0.08;
      // Tiny soft noise dust
      s += (Math.random() * 2 - 1) * 0.015 * env;
      const v = s * env * 0.45;
      const wob = Math.sin(2 * Math.PI * 0.7 * t) * 0.08;
      L[i] = v * (1 - wob);
      R[i] = v * (1 + wob);
    }
    this._grainBuf = buf;

    // Soft sparkle grain (~0.12s) for curious garden tips
    const ns = Math.floor(sr * 0.12);
    const spark = this.ctx.createBuffer(2, ns, sr);
    const sL = spark.getChannelData(0);
    const sR = spark.getChannelData(1);
    for (let i = 0; i < ns; i++) {
      const env = Math.sin(Math.PI * (i / (ns - 1)));
      const t = i / sr;
      let s = Math.sin(2 * Math.PI * 1760 * t) * 0.35;
      s += Math.sin(2 * Math.PI * 2349 * t) * 0.18;
      s += (Math.random() * 2 - 1) * 0.04;
      const v = s * env * env * 0.28;
      sL[i] = v;
      sR[i] = v * (0.85 + Math.random() * 0.3);
    }
    this._sparkleBuf = spark;
  }

  /** Pitch 0..1 → ±12 semitones around G3 base. */
  _applyPitch() {
    const p = Math.max(0, Math.min(1, this.params.pitch));
    const st = (p - 0.5) * 24;
    this._rootHz = this._rootBaseHz * Math.pow(2, st / 12);
    if (!this.ctx || !this.isRunning) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (!v || !v.alive) continue;
      const hz = this._hzFromSt(v.st);
      v.hz = hz;
      try {
        v.oscA.frequency.setTargetAtTime(hz, now, 0.12);
        v.oscB.frequency.setTargetAtTime(hz * 1.0015, now, 0.14);
        if (v.oscC) v.oscC.frequency.setTargetAtTime(hz * 2, now, 0.16);
      } catch (e) {}
    }
  }

  /**
   * Garden seed states — the harmony+pitch colours Matt likes when Space
   * start/stop reshuffles. Ordered L→R. Garden movement stop→restarts into
   * a discrete seed (not a continuous morph wash).
   */
  _gardenSeeds() {
    return [
      { // sweet major / penta
        scale: [0, 2, 4, 7, 9, 12],
        arp: [0, 4, 7, 9, 12, 16, 19, 12],
        sparkle: 0.06,
        rootBias: 0
      },
      { // open bright / add9 colour
        scale: [0, 2, 4, 7, 9, 11, 12, 14],
        arp: [0, 2, 7, 9, 11, 14, 16, 19],
        sparkle: 0.18,
        rootBias: 0.4
      },
      { // curious Lydian-ish + maj7 (Space reshuffle favourite)
        scale: [0, 2, 4, 6, 7, 9, 11, 14],
        arp: [0, 4, 6, 9, 11, 14, 16, 18],
        sparkle: 0.32,
        rootBias: 1.1
      },
      { // soft mystery — still gift-friendly, never dark
        scale: [0, 2, 3, 7, 8, 10, 12, 15],
        arp: [0, 3, 7, 8, 10, 12, 15, 19],
        sparkle: 0.42,
        rootBias: -0.6
      }
    ];
  }

  /** Discrete seed from garden position; optional within-zone reshuffle. */
  _pickGardenSeed(g, randomizeZone) {
    const seeds = this._gardenSeeds();
    const max = seeds.length - 1;
    const x = Math.max(0, Math.min(1, g)) * max;
    const i0 = Math.floor(x);
    const i1 = Math.min(max, i0 + 1);
    const t = x - i0;
    let idx = (t < 0.5 || i0 === i1) ? i0 : i1;
    if (randomizeZone && i0 !== i1) {
      // Beautiful reshuffle within the local garden zone (like Space start)
      idx = Math.random() < (0.55 + t * 0.35) ? i1 : i0;
      if (Math.random() < 0.22) {
        const j = Math.max(0, Math.min(max, idx + (Math.random() < 0.5 ? -1 : 1)));
        idx = j;
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
    const oct = Math.random() < 0.35 ? 12 : (Math.random() < 0.12 ? -12 : 0);
    return ints[(Math.random() * ints.length) | 0] + oct;
  }

  /** Soft-stop pads/grains like Space stop — keep isRunning; restart follows. */
  _softStopForGarden() {
    if (this._evolveTimer) { clearTimeout(this._evolveTimer); this._evolveTimer = null; }
    if (this._grainTimer) { clearTimeout(this._grainTimer); this._grainTimer = null; }
    // Evolving harmony keeps a gentle bed; pads+grains are what reshuffle
    const voices = this._padVoices.slice();
    this._padVoices = [];
    for (let i = 0; i < voices.length; i++) this._fadeOutVoice(voices[i], 0.2);
    if (this.ctx && this.padBus) {
      const t = this.ctx.currentTime;
      try {
        this.padBus.gain.cancelScheduledValues(t);
        this.padBus.gain.setValueAtTime(Math.max(0.0001, this.padBus.gain.value), t);
        this.padBus.gain.linearRampToValueAtTime(0.0001, t + 0.12);
      } catch (e) {}
    }
  }

  /** Restart into a new beautiful pad state (mirrors start() voice spawn). */
  _restartFromGarden() {
    if (!this.ctx || !this.isRunning) return;
    this._commitGardenSeed(this.params.garden, true);
    this._gardenLastReseedAt = this.params.garden;
    // Restore pad bus level via tone curve, then spawn fresh voices
    this._applyTone();
    this._applyDusk();
    this._ensurePadVoices();
    if (!this._evolveTimer) this._evolvePads();
    if (!this._grainTimer) this._scheduleGrains();
    if (!this._driftTimer) this._scheduleDrift();
  }

  /**
   * Garden knob: Space-like stop→restart on movement past a small delta.
   * Discrete reseed from garden zone — not a continuous morph wash.
   */
  _applyGarden() {
    const g = Math.max(0, Math.min(1, this.params.garden));
    this._gardenPrev = g;
    if (!this.ctx || !this.isRunning) {
      this._commitGardenSeed(g, false);
      this._gardenLastReseedAt = g;
      return;
    }
    if (this._activeGardenSeed == null) this._commitGardenSeed(g, false);
    const last = this._gardenLastReseedAt;
    const delta = last == null ? 1 : Math.abs(g - last);
    // Ignore tiny flicks; require a clear step before reshuffle
    if (delta < 0.035 && !this._gardenPendingStop) return;

    // First significant move: stop current process (like Space)
    if (!this._gardenPendingStop) {
      this._gardenPendingStop = true;
      this._softStopForGarden();
    }
    // Debounce further motion — settle then restart into new harmony
    if (this._gardenReseedTimer) clearTimeout(this._gardenReseedTimer);
    this._gardenReseedTimer = setTimeout(() => {
      this._gardenReseedTimer = null;
      this._gardenPendingStop = false;
      if (!this.isRunning) return;
      this._restartFromGarden();
    }, 95);
  }

  _growthVoices() {
    const g = Math.max(0, Math.min(1, this.params.growth));
    return 2 + Math.round(Math.pow(g, 0.9) * 6); // 2..8
  }

  _grainHz() {
    const g = Math.max(0, Math.min(1, this.params.growth));
    const b = Math.max(0, Math.min(1, this.params.breeze));
    return 1.2 + Math.pow(g, 1.1) * 8 + b * 3;
  }

  /**
   * Dusk/Dawn continuous curve (param id stays "dusk"):
   *  Left  (0, dawn): gentler, fewer highs, soft early-morning filter
   *  Center (0.5): brighter + a bit busier
   *  Right (1, dusk): quieter, muffled/LPF evening
   */
  _duskCurve(d) {
    const x = Math.max(0, Math.min(1, d));
    const bright = Math.sin(x * Math.PI);          // peaks at center
    const dawn = Math.pow(Math.max(0, 1 - x * 2), 1.05);   // left lobe
    const dusk = Math.pow(Math.max(0, (x - 0.5) * 2), 1.05); // right lobe
    return { x, bright, dawn, dusk };
  }


  _driftAmt() {
    return Math.max(0, Math.min(1, this.params.drift == null ? 0.5 : this.params.drift));
  }

  /**
   * Drift remap (v1.2.4):
   *  Center (~0.5): wash/FB ≈ former good mid — leave that feel alone.
   *  Left (→0): strip feedback-like sounds — less delay FB, less wash, sparser.
   *  Right (→1): more pitch/timing/voice variety — NOT more FB/wash/mud.
   */
  _driftShape() {
    const x = this._driftAmt();
    let wash;
    if (x <= 0.5) {
      // 0 → 0, 0.5 → 1 (full mid wash reference)
      wash = Math.pow(x / 0.5, 1.05);
    } else {
      // Plateau / slight taper — right must not pile more FB
      wash = 1.0 - (x - 0.5) * 0.22;
    }
    let vary;
    if (x <= 0.5) {
      vary = (x / 0.5) * 0.38;
    } else {
      vary = 0.38 + ((x - 0.5) / 0.5) * 0.62;
    }
    return { x, wash, vary };
  }

  _applyTone() {
    if (!this.ctx || !this.toneLp) return;
    const bl = Math.max(0, Math.min(1, this.params.bloom));
    const { bright, dawn, dusk } = this._duskCurve(this.params.dusk);
    const now = this.ctx.currentTime;
    // Micro-fades on day-curve / bloom so filter+bus moves aren't clicky
    const tauF = 0.22;
    const tauG = 0.2;
    // Bloom opens the flower; dawn softens highs, center blooms bright, dusk muffles
    const bloomHz = 900 + Math.pow(bl, 0.85) * 7200;
    const hz = bloomHz * (0.42 + bright * 0.7) + dawn * 500 + dusk * 180;
    // Clamp into musical ranges: dawn ~2–3k, center up to ~8k, dusk ~1.2–2.2k
    const hzClamped = Math.max(1100, Math.min(8600, hz - dusk * 2200 - dawn * 900));
    this.toneLp.frequency.setTargetAtTime(hzClamped, now, tauF);
    this.toneLp.Q.setTargetAtTime(0.26 + bl * 0.18 - dusk * 0.06, now, tauF);
    if (this.toneHp) {
      // Dawn: soft early-morning (gentle HP lift of mud without harshness)
      this.toneHp.frequency.setTargetAtTime(45 + dawn * 55 + bright * 15, now, tauF);
    }
    if (this.padBus) {
      const padLvl = (0.55 + bl * 0.28) * (0.78 + bright * 0.28 - dusk * 0.22);
      this.padBus.gain.setTargetAtTime(Math.max(0.25, padLvl), now, tauG);
    }
    if (this.grainBus) {
      const gLvl = (0.5 + bright * 0.22 - dusk * 0.2 - dawn * 0.08);
      this.grainBus.gain.setTargetAtTime(Math.max(0.18, gLvl), now, tauG);
    }
    if (this.driftBus) {
      const { wash, vary } = this._driftShape();
      // Level from wash (center feel); slight vary lift without mud
      const dLvl = (0.12 + wash * 0.22 + vary * 0.06 + bright * 0.10 - dusk * 0.1);
      this.driftBus.gain.setTargetAtTime(Math.max(0.03, Math.min(0.40, dLvl)), now, tauG);
    }
  }

  _applyDusk() {
    if (!this.ctx || !this.spaceWet) return;
    const { x: d, bright, dawn, dusk } = this._duskCurve(this.params.dusk);
    const { wash } = this._driftShape();
    const now = this.ctx.currentTime;
    // Small crossfades / smoothed filter gains — day-curve must not click
    const tauG = 0.24;
    const tauF = 0.3;
    const tauD = 0.35;
    // Center busier/airier; dawn drier+intimate; dusk quieter wet-muffle
    // v1.2.4: wash from Drift center (not right); hard caps vs mid howl
    const wet = Math.min(0.52, 0.12 + bright * 0.26 + dusk * 0.08 + wash * 0.05);
    const dry = Math.max(0.48, 0.90 - bright * 0.16 - dusk * 0.08 - wash * 0.04);
    this.spaceWet.gain.setTargetAtTime(wet, now, tauG);
    this.spaceDry.gain.setTargetAtTime(dry, now, tauG);
    // Airy delay — wash peaking at Drift center; right does not add FB/mud
    this.delaySend.gain.setTargetAtTime(Math.min(0.34, 0.08 + bright * 0.18 + wash * 0.10 - dusk * 0.04), now, tauG);
    this.delayReturn.gain.setTargetAtTime(Math.min(0.30, 0.12 + bright * 0.14 + wash * 0.08 - dusk * 0.04), now, tauG);
    this.delayFb.gain.setTargetAtTime(Math.min(0.32, 0.09 + bright * 0.11 + dusk * 0.03 + wash * 0.12), now, tauG);
    this.delayNode.delayTime.setTargetAtTime(0.16 + bright * 0.20 + dusk * 0.16, now, tauD);
    // Dawn: soft early filter on delay; dusk: muffled evening LPF; lower mid pile
    this.delayTone.frequency.setTargetAtTime(4200 + bright * 1600 - dusk * 2200 - dawn * 900, now, tauF);
    if (this.delayTone) this.delayTone.Q.setTargetAtTime(0.26, now, tauF);
    this.spaceLp.frequency.setTargetAtTime(6800 + bright * 2200 - dusk * 3600 - dawn * 1600, now, tauF);
    const fb = Math.min(0.18, 0.055 + bright * 0.08 + dusk * 0.04 + wash * 0.055);
    for (let i = 0; i < this.spaceFbs.length; i++) {
      this.spaceFbs[i].gain.setTargetAtTime(fb * (0.82 + (i % 3) * 0.06), now, tauG);
    }
    // Keep tone curve in sync when dusk moves
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
      this._fadeOutVoice(v, 0.85);
    }
  }

  _spawnPadVoice() {
    if (!this.ctx || !this.padBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const st = this._pickSemitone();
    const hz = this._hzFromSt(st);
    const bloom = Math.max(0, Math.min(1, this.params.bloom));
    const breeze = Math.max(0, Math.min(1, this.params.breeze));

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = bloom > 0.55 ? 'triangle' : 'sine';
    const det = 0.08 + breeze * 0.35 + Math.random() * 0.12;
    oscA.frequency.setValueAtTime(hz, now);
    oscB.frequency.setValueAtTime(hz * (1 + det / 100), now);

    let oscC = null;
    let gC = null;
    if (bloom > 0.35) {
      oscC = ctx.createOscillator();
      oscC.type = 'sine';
      oscC.frequency.setValueAtTime(hz * 2 * (1 + (Math.random() * 0.004 - 0.002)), now);
      gC = ctx.createGain();
      gC.gain.setValueAtTime(0.0001, now);
      gC.gain.linearRampToValueAtTime(0.04 + bloom * 0.1, now + 1.8);
    }

    const gA = ctx.createGain();
    const gB = ctx.createGain();
    gA.gain.setValueAtTime(0.0001, now);
    gB.gain.setValueAtTime(0.0001, now);
    const peak = (0.07 + (1 / Math.max(2, this._voiceTarget)) * 0.12);
    gA.gain.linearRampToValueAtTime(peak, now + 2.2 + Math.random());
    gB.gain.linearRampToValueAtTime(peak * 0.7, now + 2.5 + Math.random());

    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      const p0 = (Math.random() * 2 - 1) * (0.25 + breeze * 0.55);
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
    if (pan) {
      vGain.connect(pan);
      pan.connect(this.padBus);
    } else {
      vGain.connect(this.padBus);
    }

    try { oscA.start(now); } catch (e) {}
    try { oscB.start(now); } catch (e) {}
    if (oscC) try { oscC.start(now); } catch (e) {}

    const voice = { oscA, oscB, oscC, gA, gB, gC, pan, vGain, st, hz, pan0: pan ? pan.pan.value : 0, alive: true };
    this._padVoices.push(voice);
  }

  _fadeOutVoice(v, sec) {
    if (!v || !this.ctx || !v.alive) return;
    v.alive = false;
    const t = this.ctx.currentTime;
    const s = Math.max(0.3, sec || 1.2);
    try {
      v.vGain.gain.cancelScheduledValues(t);
      v.vGain.gain.setValueAtTime(Math.max(0.0001, v.vGain.gain.value), t);
      v.vGain.gain.linearRampToValueAtTime(0.0001, t + s);
    } catch (e) {}
    const stopAt = t + s + 0.05;
    setTimeout(() => {
      try { v.oscA.stop(); } catch (e) {}
      try { v.oscB.stop(); } catch (e) {}
      if (v.oscC) try { v.oscC.stop(); } catch (e) {}
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
    const garden = Math.max(0, Math.min(1, this.params.garden));
    const now = this.ctx.currentTime;

    this._ensurePadVoices();

    for (let i = 0; i < this._padVoices.length; i++) {
      const v = this._padVoices[i];
      if (!v || !v.alive) continue;
      if (breeze > 0.05) {
        const drift = (Math.random() * 2 - 1) * breeze * 0.35;
        const nh = v.hz * (1 + drift / 200);
        try {
          v.oscA.frequency.setTargetAtTime(nh, now, 0.8 + Math.random());
          v.oscB.frequency.setTargetAtTime(nh * (1.001 + breeze * 0.002), now, 0.9);
          if (v.oscC) v.oscC.frequency.setTargetAtTime(nh * 2, now, 1.0);
        } catch (e) {}
      }
      if (v.pan && breeze > 0.08) {
        const pEnd = Math.max(-1, Math.min(1, v.pan0 + (Math.random() * 2 - 1) * breeze * 0.55));
        try { v.pan.pan.setTargetAtTime(pEnd, now, 1.2); } catch (e) {}
      }
    }

    if (this._padVoices.length && Math.random() < 0.18 + garden * 0.15) {
      const idx = (Math.random() * this._padVoices.length) | 0;
      const old = this._padVoices.splice(idx, 1)[0];
      this._fadeOutVoice(old, 1.55);
      this._spawnPadVoice();
    }

    const next = 1800 + (1 - breeze) * 2200 + Math.random() * 1200;
    this._evolveTimer = setTimeout(() => this._evolvePads(), next);
  }

  /**
   * Evolving harmony — slow arpeggiator / progressing melodies.
   * Soft, gift-friendly, delay-kissed; amount from Drift slider.
   */
  _scheduleDrift() {
    this._driftTimer = null;
    if (!this.isRunning || !this.ctx) return;
    const { x: drift, wash, vary } = this._driftShape();

    // Near-zero Drift: keep timer alive but don't stack notes
    if (drift < 0.02) {
      this._driftTimer = setTimeout(() => this._scheduleDrift(), 1400);
      return;
    }

    const pattern = this._arpIntervals();
    this._driftIdx = ((this._driftIdx % pattern.length) + pattern.length) % pattern.length;
    let st = pattern[this._driftIdx] + this._driftChord;
    // Right-side pitch variety (not more wash): occasional neighbor / octave colour
    if (vary > 0.45 && Math.random() < 0.18 + vary * 0.28) {
      const opts = [-2, -1, 1, 2, 5, 7, 12];
      st += opts[(Math.random() * opts.length) | 0];
    }
    // Soft third harmony above (gift-friendly)
    const harm = st + (Math.random() < 0.55 ? 4 : (Math.random() < 0.35 + vary * 0.3 ? 9 : 7));

    this._spawnDriftNote(st, false);
    // Harmony chance leans on vary (right), gated by some wash so left stays sparse
    if (wash > 0.18 && Math.random() < 0.16 + vary * 0.42) {
      this._spawnDriftNote(harm, true);
    }

    this._driftIdx += this._driftDir;
    if (this._driftIdx >= pattern.length - 1) {
      this._driftDir = -1;
      if (Math.random() < 0.22 + vary * 0.2) this._driftChord = Math.random() < 0.5 ? 0 : 12;
    } else if (this._driftIdx <= 0) {
      this._driftDir = 1;
      if (Math.random() < 0.18 + vary * 0.12) this._driftChord = 0;
    }

    // Center pace ≈ former mid; right adds timing variety (not denser mud)
    const baseMs = 760 - wash * 260 - vary * 90;
    const jitterAmt = 0.22 + vary * 0.42;
    const jitter = (Math.random() * jitterAmt - 0.08) * baseMs;
    const breeze = Math.max(0, Math.min(1, this.params.breeze));
    let next = Math.max(240, baseMs + jitter + (1 - breeze) * 100);
    // Occasional longer breath on high vary — sparse gaps, not denser cloud
    if (vary > 0.55 && Math.random() < 0.12 + vary * 0.1) next += 180 + Math.random() * 220;
    this._driftTimer = setTimeout(() => this._scheduleDrift(), next);
  }

  _spawnDriftNote(st, isHarm) {
    if (!this.ctx || !this.driftBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const { wash, vary } = this._driftShape();
    const bloom = Math.max(0, Math.min(1, this.params.bloom));
    let hz = this._hzFromSt(st);
    // Right-side micro pitch variety (cents) — not more feedback
    if (vary > 0.4 && Math.random() < 0.35 + vary * 0.35) {
      const cents = (Math.random() * 2 - 1) * (8 + vary * 28);
      hz *= Math.pow(2, cents / 1200);
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, now);

    let osc2 = null;
    if (!isHarm && bloom > 0.4) {
      osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(hz * (1 + 0.0015 + vary * 0.002), now);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    // v1.2.4 sparse: shorter sustain/release; wash sets level, not endless ring
    const peak = (isHarm ? 0.036 : 0.070) * (0.48 + wash * 0.42) / Math.max(1, Math.sqrt(this._voiceTarget * 0.5));
    const dur = Math.min(0.72, 0.24 + wash * 0.30 + Math.random() * 0.12 + vary * 0.06);
    env.gain.linearRampToValueAtTime(peak, now + 0.025 + Math.random() * 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      const side = isHarm ? 0.35 : -0.2;
      pan.pan.setValueAtTime(side + (Math.random() * 2 - 1) * (0.18 + vary * 0.28), now);
    }

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // Lower mid resonance — avoid post-Seed howl buildup
    lp.frequency.setValueAtTime(1400 + bloom * 2000 + wash * 280, now);
    lp.Q.setValueAtTime(0.32, now);

    osc.connect(env);
    if (osc2) {
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(peak * 0.35, now);
      osc2.connect(g2);
      g2.connect(env);
    }
    env.connect(lp);
    if (pan) {
      lp.connect(pan);
      pan.connect(this.driftBus);
    } else {
      lp.connect(this.driftBus);
    }

    try { osc.start(now); osc.stop(now + dur + 0.05); } catch (e) {}
    if (osc2) try { osc2.start(now); osc2.stop(now + dur + 0.05); } catch (e) {}
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
    const garden = Math.max(0, Math.min(1, this.params.garden));
    if (growth > 0.08) {
      const burst = growth > 0.75 ? 2 : 1;
      for (let i = 0; i < burst; i++) this._spawnGrain(false);
      const sparkleP = (this._gardenSparkle != null)
        ? this._gardenSparkle
        : (0.05 + garden * 0.4);
      if (Math.random() < sparkleP) this._spawnGrain(true);
    }
    const hz = this._grainHz();
    const intervalMs = Math.max(40, 1000 / Math.max(0.5, hz));
    const jitter = (Math.random() * 0.5 - 0.15) * intervalMs * (0.4 + breeze);
    this._grainTimer = setTimeout(() => this._scheduleGrains(), Math.max(30, intervalMs + jitter));
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
    const rate = Math.max(0.25, Math.min(3.2, targetHz / 220));
    const dur = sparkle
      ? 0.05 + Math.random() * 0.06
      : 0.12 + Math.random() * (0.12 + bloom * 0.18);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate * (1 + (Math.random() * 2 - 1) * breeze * 0.04), now);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    const peak = (sparkle ? 0.09 : 0.13) * (0.5 + growth * 0.4) / Math.max(1, Math.sqrt(this._voiceTarget));
    try {
      if (this._window && !sparkle) {
        env.gain.setValueCurveAtTime(this._window, now, Math.min(dur, buf.duration / rate));
      } else {
        env.gain.linearRampToValueAtTime(peak, now + dur * 0.25);
        env.gain.linearRampToValueAtTime(0.0001, now + dur);
      }
    } catch (e) {
      env.gain.linearRampToValueAtTime(peak, now + 0.03);
      env.gain.linearRampToValueAtTime(0.0001, now + dur);
    }

    let pan = null;
    if (this.ctx.createStereoPanner) {
      pan = this.ctx.createStereoPanner();
      const scatter = 0.2 + breeze * 0.75;
      pan.pan.setValueAtTime((Math.random() * 2 - 1) * scatter, now);
    }

    const gLevel = this.ctx.createGain();
    gLevel.gain.setValueAtTime(peak, now);

    const bp = this.ctx.createBiquadFilter();
    bp.type = sparkle ? 'highpass' : 'bandpass';
    bp.frequency.setValueAtTime(sparkle ? 1900 + bloom * 2200 : 450 + bloom * 1500, now);
    bp.Q.setValueAtTime(sparkle ? 0.55 : 0.55 + bloom * 0.32, now);

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
   * Seed / Space-equivalent hard reseed:
   * stop voices + clear delay/space feedback → brief silence → start with new randomized garden state.
   * Hard stop/restart — does NOT morph params while audio runs.
   */
  reseedBeautiful() {
    if (!this.ctx) return;
    if (this._seedTimer) { clearTimeout(this._seedTimer); this._seedTimer = null; }
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    this._gardenPendingStop = false;
    // Hard stop like Space pause (clears voices + delayFb)
    this.stop();
    const t = this.ctx.currentTime;
    // Kill feedback trails so restart is clean (no howl / delay scrub)
    try {
      if (this.delayFb) this.delayFb.gain.setTargetAtTime(0, t, 0.02);
      if (this.delaySend) this.delaySend.gain.setTargetAtTime(0, t, 0.02);
      if (this.delayReturn) this.delayReturn.gain.setTargetAtTime(0, t, 0.02);
      if (this.spaceFbs) {
        for (let i = 0; i < this.spaceFbs.length; i++) {
          this.spaceFbs[i].gain.setTargetAtTime(0, t, 0.02);
        }
      }
    } catch (e) {}
    this._seedTimer = setTimeout(() => {
      this._seedTimer = null;
      if (!this.ctx) return;
      // start() commits a fresh randomized garden seed (Space play path)
      this.start();
    }, 200);
  }

  setParameter(paramId, value) {
    // Seed button bang — not a stored slider
    if (paramId === 'seed' || paramId === '__seed') {
      this.reseedBeautiful();
      return;
    }
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'bloom') this._applyTone();
    else if (paramId === 'dusk') this._applyDusk();
    else if (paramId === 'pitch') this._applyPitch();
    else if (paramId === 'garden') this._applyGarden();
    else if (paramId === 'drift') { this._applyTone(); this._applyDusk(); }
    else if (paramId === 'growth' && this.isRunning) this._ensurePadVoices();
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
    this.outputNode.gain.linearRampToValueAtTime(0.88, t + 0.12);
    // Space play: commit garden seed + spawn a fresh beautiful state
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    this._gardenPendingStop = false;
    this._commitGardenSeed(this.params.garden, true);
    this._gardenLastReseedAt = this.params.garden;
    this._gardenPrev = this.params.garden;
    this._applyPitch();
    this._applyTone();
    this._applyDusk();
    this._ensurePadVoices();
    this._evolvePads();
    this._scheduleGrains();
    this._scheduleDrift();
  }

  stop() {
    this.isRunning = false;
    this._gardenPendingStop = false;
    if (this._gardenReseedTimer) { clearTimeout(this._gardenReseedTimer); this._gardenReseedTimer = null; }
    if (this._grainTimer) { clearTimeout(this._grainTimer); this._grainTimer = null; }
    if (this._evolveTimer) { clearTimeout(this._evolveTimer); this._evolveTimer = null; }
    if (this._driftTimer) { clearTimeout(this._driftTimer); this._driftTimer = null; }
    const voices = this._padVoices.slice();
    this._padVoices = [];
    for (let i = 0; i < voices.length; i++) this._fadeOutVoice(voices[i], 0.35);
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.12);
    if (this.delayFb) this.delayFb.gain.setTargetAtTime(0, t, 0.05);
    if (this.delaySend) this.delaySend.gain.setTargetAtTime(0, t, 0.05);
    if (this.spaceFbs) {
      for (let i = 0; i < this.spaceFbs.length; i++) {
        this.spaceFbs[i].gain.setTargetAtTime(0, t, 0.05);
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
    this.ctx = null;
    this.outputNode = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = BloomDSP;
  window.BloomDSP = BloomDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BloomDSP };
}
