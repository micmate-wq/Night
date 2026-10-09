/**
 * Singing Bowls — Aether Node V2 (ambient-generative)
 *
 * Port of nodes/polyphonic-singing-bowls (v1, a raw worklet) to the Node V2 contract.
 * The synthesis is unchanged: 5 bowls tuned 1, b3, 4, 5, b7 over rootPitch, each a
 * fundamental + 2.98x overtone pair with beating, per-bowl low-pass "tone".
 *
 * What changed vs v1:
 * - Wrapped in a V2 main-thread class: init / start / stop / dispose,
 *   setParameter / getParameter / getParameters (clamped to manifest ranges).
 * - Silent until start(). v1 kept striking while the transport was stopped
 *   (the host only muted it). stop() now fades out over 30 ms and resets the bowls.
 * - First strike happens right on start() instead of up to ~1.8 s later.
 * - rootPitch is smoothed for 10 ms so morphs/automation don't zipper.
 *
 * The literal worklet keywords are built from pieces so the current host loads this
 * through its class path (see granular-cloud/dsp.js for the same note).
 */

const SINGING_BOWLS_V2_PROCESSOR = 'aether-singing-bowls-v2';

const SINGING_BOWLS_V2_PARAMS = [
  { id: 'rootPitch',  min: 60,   max: 300, def: 120 },
  { id: 'activity',   min: 0.05, max: 1,   def: 0.5 },
  { id: 'resonance',  min: 0.1,  max: 1,   def: 0.7 },
  { id: 'beatingMix', min: 0,    max: 1,   def: 0.6 },
  { id: 'tone_1',     min: 0,    max: 1,   def: 0.8 },
  { id: 'tone_2',     min: 0,    max: 1,   def: 0.8 },
  { id: 'tone_3',     min: 0,    max: 1,   def: 0.8 },
  { id: 'tone_4',     min: 0,    max: 1,   def: 0.8 },
  { id: 'tone_5',     min: 0,    max: 1,   def: 0.8 }
];

function singingBowlsV2WorkletModule() {
  const Base = globalThis['AudioWorklet' + 'Processor'];
  const register = globalThis['register' + 'Processor'];
  const NAME = 'aether-singing-bowls-v2';
  if (!Base || !register || globalThis.__aetherSingingBowlsV2) return;
  globalThis.__aetherSingingBowlsV2 = true;

  const TWO_PI = Math.PI * 2;
  const RATIOS = [1.0, 1.1892, 1.3348, 1.4983, 1.7818];
  const N = 5;

  class SingingBowlsV2Processor extends Base {
    constructor() {
      super();
      this.p = { rootPitch: 120, activity: 0.5, resonance: 0.7, beatingMix: 0.6,
                 tone_1: 0.8, tone_2: 0.8, tone_3: 0.8, tone_4: 0.8, tone_5: 0.8 };
      this.root = 120;                                  // smoothed rootPitch
      this.rootCoef = 1 - Math.exp(-1 / (0.01 * sampleRate));
      this.running = false;
      this.level = 0;
      this.fadeStep = 1 / (0.03 * sampleRate);
      this.sinceStrike = 0;
      this.strikeNow = false;
      this.alive = true;
      this.alpha = new Float32Array(N);
      this.voices = [];
      for (let k = 0; k < N; k++) {
        this.voices.push({
          f1: Math.random() * TWO_PI, f2: Math.random() * TWO_PI,
          o1: Math.random() * TWO_PI, o2: Math.random() * TWO_PI,
          lfo: Math.random() * TWO_PI, beat: 0.6 + k * 0.35,
          env: 0, target: 0, attack: 0, decay: 0, stage: 0, lp: 0   // stage 0 idle, 1 attack, 2 decay
        });
      }
      this.port.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'param' && m.id in this.p) this.p[m.id] = m.value;
        else if (m.type === 'params') { for (const k in m.values) if (k in this.p) this.p[k] = m.values[k]; }
        else if (m.type === 'run') {
          if (m.on && !this.running) { this.strikeNow = true; this.root = this.p.rootPitch; }
          this.running = !!m.on;
        } else if (m.type === 'dispose') this.alive = false;
      };
    }

    _strike() {
      const k = Math.floor(Math.random() * N);
      const v = this.voices[k];
      v.stage = 1;
      v.target = 0.5 + Math.random() * 0.5;
      v.attack = 1 / (sampleRate * (1.2 + Math.random() * 0.8));
      v.decay = 1 / (sampleRate * (3 + this.p.resonance * 15));
      this.port.postMessage({ type: 'aether:voice-trigger', voiceIndex: k });
    }

    process(inputs, outputs) {
      if (!this.alive) return false;
      const out = outputs[0];
      const oL = out[0], oR = out[1] || out[0];
      const n = oL.length;
      const p = this.p;

      if (this.running) {
        this.sinceStrike += n;
        const interval = Math.max(4000, Math.floor((1.05 - p.activity) * sampleRate * 1.8));
        if (this.strikeNow || this.sinceStrike >= interval) {
          this.strikeNow = false;
          this.sinceStrike = 0;
          this._strike();
        }
      }

      const inv = 1 / sampleRate;
      for (let k = 0; k < N; k++) {
        const tone = Math.max(0, Math.min(1, p['tone_' + (k + 1)]));
        const cutoff = 180 * Math.pow(14000 / 180, tone);
        this.alpha[k] = Math.min(1, 1 - Math.exp(-TWO_PI * cutoff * inv));
      }
      const target = this.running ? 1 : 0;
      const bm = p.beatingMix;

      for (let i = 0; i < n; i++) {
        if (this.level < target) this.level = Math.min(1, this.level + this.fadeStep);
        else if (this.level > target) this.level = Math.max(0, this.level - this.fadeStep);
        this.root += (p.rootPitch - this.root) * this.rootCoef;

        let mL = 0, mR = 0;
        for (let k = 0; k < N; k++) {
          const v = this.voices[k];
          if (v.stage === 1) { v.env += v.attack; if (v.env >= v.target) { v.env = v.target; v.stage = 2; } }
          else if (v.stage === 2) { v.env -= v.decay; if (v.env <= 0.0001) { v.env = 0; v.stage = 0; } }
          if (v.env <= 0.00001) { v.lp *= 0.99; continue; }

          const f1 = this.root * RATIOS[k], f2 = f1 + v.beat;
          const o1 = f1 * 2.98, o2 = o1 + v.beat * 1.25;
          v.f1 = (v.f1 + f1 * TWO_PI * inv) % TWO_PI;
          v.f2 = (v.f2 + f2 * TWO_PI * inv) % TWO_PI;
          v.o1 = (v.o1 + o1 * TWO_PI * inv) % TWO_PI;
          v.o2 = (v.o2 + o2 * TWO_PI * inv) % TWO_PI;
          v.lfo = (v.lfo + 0.15 * TWO_PI * inv) % TWO_PI;
          const swell = 0.85 + 0.15 * Math.sin(v.lfo);
          const fund = Math.sin(v.f1) + Math.sin(v.f2) * bm;
          const over = (Math.sin(v.o1) + Math.sin(v.o2) * bm) * 0.45;
          const raw = (fund + over) * v.env * swell * 0.35;
          v.lp += this.alpha[k] * (raw - v.lp);
          const pan = (k / (N - 1)) * 1.4 - 0.7;
          mL += v.lp * 0.5 * (1 - pan);
          mR += v.lp * 0.5 * (1 + pan);
        }
        oL[i] = mL * this.level;
        if (oR !== oL) oR[i] = mR * this.level;
      }

      if (!this.running && this.level === 0) {
        for (const v of this.voices) { v.env = 0; v.stage = 0; v.lp = 0; }
      }
      return true;
    }
  }

  register(NAME, SingingBowlsV2Processor);
}

class SingingBowlsV2DSP {
  constructor() {
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
    this.workletNode = null;
    this.isRunning = false;
    this.ready = null;
    this._disposed = false;
    this.lastVoiceTrigger = null;     // { voiceIndex, time } for visuals
    this.params = {};
    SINGING_BOWLS_V2_PARAMS.forEach(s => { this.params[s.id] = s.def; });
  }

  static _loadModule(ctx) {
    const reg = ctx.__aetherWorkletModules || (ctx.__aetherWorkletModules = {});
    if (!reg[SINGING_BOWLS_V2_PROCESSOR]) {
      const src = '(' + singingBowlsV2WorkletModule.toString() + ')();';
      let url;
      if (typeof globalThis.__aetherWorkletUrl === 'function') {
        url = globalThis.__aetherWorkletUrl(src, SINGING_BOWLS_V2_PROCESSOR);
      } else if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      } else {
        url = 'data:application/javascript,' + encodeURIComponent(src);
      }
      reg[SINGING_BOWLS_V2_PROCESSOR] = ctx.audioWorklet.addModule(url);
    }
    return reg[SINGING_BOWLS_V2_PROCESSOR];
  }

  init(audioContext, host = {}) {
    this.ctx = audioContext;
    this.host = host || {};
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

    this.ready = SingingBowlsV2DSP._loadModule(this.ctx).then(() => {
      if (this._disposed || !this.ctx) return;
      this.workletNode = new AudioWorkletNode(this.ctx, SINGING_BOWLS_V2_PROCESSOR, {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
      });
      this.workletNode.port.onmessage = (e) => {
        if (e.data && e.data.type === 'aether:voice-trigger') {
          this.lastVoiceTrigger = { voiceIndex: e.data.voiceIndex, time: this.ctx ? this.ctx.currentTime : 0 };
        }
      };
      this.workletNode.connect(this.outputNode);
      this.workletNode.port.postMessage({ type: 'params', values: Object.assign({}, this.params) });
      if (this.isRunning) this.workletNode.port.postMessage({ type: 'run', on: true });
    }).catch(err => console.error('[Singing Bowls v2] worklet failed to load:', err));

    return this.outputNode;
  }

  start(snapshot) {
    if (!this.ctx) return;
    this.isRunning = true;
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'run', on: true });
  }

  stop() {
    this.isRunning = false;
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'run', on: false });
  }

  setParameter(paramId, value) {
    const spec = SINGING_BOWLS_V2_PARAMS.find(s => s.id === paramId);
    if (!spec) return;
    let v = Number(value);
    if (!Number.isFinite(v)) return;
    v = Math.max(spec.min, Math.min(spec.max, v));
    this.params[paramId] = v;
    if (this.workletNode) this.workletNode.port.postMessage({ type: 'param', id: paramId, value: v });
  }

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
    this._disposed = true;
    if (this.workletNode) {
      try { this.workletNode.port.postMessage({ type: 'dispose' }); } catch (_) {}
      this.workletNode.port.onmessage = null;
      try { this.workletNode.disconnect(); } catch (_) {}
    }
    this.disconnect();
    this.workletNode = null;
    this.outputNode = null;
    this.ctx = null;
    this.host = null;
  }
}

if (typeof window !== 'undefined') {
  window.SingingBowlsV2DSP = SingingBowlsV2DSP;
  window.CustomNodeDSP = SingingBowlsV2DSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SingingBowlsV2DSP, CustomNodeDSP: SingingBowlsV2DSP, singingBowlsV2WorkletModule };
}
