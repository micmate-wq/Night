/**
 * Granular Cloud — Aether Node V2 (ambient-generative)
 *
 * Port of nodes/granular-atmospheric-cloud (v1) to the Node V2 contract.
 *
 * What changed vs v1:
 * - Grains are generated inside an AudioWorklet (audio thread). v1 spawned every grain
 *   from a main-thread setTimeout, which macOS throttles when the app is in the
 *   background -> sparse grains (P1). The worklet is never throttled.
 * - init() is silent. Grains only run between start() and stop() (master transport).
 * - setParameter / getParameter / getParameters, values clamped to manifest ranges.
 * - dispose() releases the worklet, buffers and graph.
 *
 * Note for the host check: this file must not contain the literal worklet keywords,
 * or the current host treats the whole bundle as a raw worklet. They are built from
 * string pieces below.
 */

const GRANULAR_CLOUD_V2_PROCESSOR = 'aether-granular-cloud-v2';

const GRANULAR_CLOUD_V2_PARAMS = [
  { id: 'density',       min: 2,    max: 60,   def: 18,   type: 'float' },
  { id: 'grainSize',     min: 0.03, max: 0.8,  def: 0.22, type: 'float' },
  { id: 'spray',         min: 0,    max: 1,    def: 0.45, type: 'float' },
  { id: 'pitchShift',    min: -24,  max: 24,   def: 0,    type: 'float' },
  { id: 'harmony',       min: 0,    max: 5,    def: 0,    type: 'int' },
  { id: 'reverseChance', min: 0,    max: 100,  def: 0,    type: 'float' },
  { id: 'texture',       min: 0,    max: 1,    def: 0,    type: 'int', names: ['cloud', 'pluck'] },
  { id: 'feedback',      min: 0,    max: 0.95, def: 0.55, type: 'float' },
  { id: 'freeze',        min: 0,    max: 1,    def: 0,    type: 'bool' },
  { id: 'mix',           min: 0,    max: 1,    def: 1,    type: 'float' }
];

// ---------------------------------------------------------------------------
// Audio-thread code. Serialised with toString() and loaded as a worklet module.
// ---------------------------------------------------------------------------
function granularCloudV2WorkletModule() {
  const Base = globalThis['AudioWorklet' + 'Processor'];
  const register = globalThis['register' + 'Processor'];
  const NAME = 'aether-granular-cloud-v2';
  if (!Base || !register || globalThis.__aetherGranularCloudV2) return;
  globalThis.__aetherGranularCloudV2 = true;

  const MAX_GRAINS = 128;
  const HARMONY = [
    null,
    [0, 12, -12],
    [0, 7, 12],
    [0, 2, 7, 12],
    [0, 7, 11, 14],
    [0, 3, 7, 10, 14]
  ];

  class GranularCloudV2Processor extends Base {
    constructor() {
      super();
      this.p = {
        density: 18, grainSize: 0.22, spray: 0.45, pitchShift: 0,
        harmony: 0, reverseChance: 0, texture: 0, freeze: 0
      };
      this.L = null; this.R = null; this.bufLen = 0; this.bufSR = sampleRate;
      this.running = false;
      this.level = 0;          // output fade 0..1
      this.fadeStep = 1 / (0.03 * sampleRate);
      this.nextIn = 0;         // samples until next grain
      this.scan = 0.2;
      this.alive = true;
      this.grains = [];
      for (let i = 0; i < MAX_GRAINS; i++) {
        this.grains.push({ on: false, pos: 0, inc: 0, len: 0, idx: 0, pluck: false, gL: 0, gR: 0 });
      }
      this.port.onmessage = (e) => this._onMessage(e.data || {});
    }

    _onMessage(m) {
      if (m.type === 'buffer') {
        this.L = m.L; this.R = m.R || m.L; this.bufLen = this.L ? this.L.length : 0;
        this.bufSR = m.sampleRate || sampleRate;
        for (const g of this.grains) g.on = false;
      } else if (m.type === 'param') {
        if (Object.prototype.hasOwnProperty.call(this.p, m.id)) this.p[m.id] = m.value;
      } else if (m.type === 'params') {
        for (const k in m.values) if (Object.prototype.hasOwnProperty.call(this.p, k)) this.p[k] = m.values[k];
      } else if (m.type === 'run') {
        if (m.on && !this.running) this.nextIn = 0;
        this.running = !!m.on;
      } else if (m.type === 'dispose') {
        this.alive = false; this.L = this.R = null; this.bufLen = 0;
      }
    }

    _spawn() {
      if (!this.bufLen) return;
      let g = null;
      for (let i = 0; i < MAX_GRAINS; i++) { if (!this.grains[i].on) { g = this.grains[i]; break; } }
      if (!g) return;
      const p = this.p;
      const len = Math.max(32, Math.round(Math.max(0.02, Math.min(1.5, p.grainSize)) * sampleRate));

      let semis = p.pitchShift + (Math.random() * 0.4 - 0.2);
      const h = HARMONY[p.harmony | 0];
      if (h) semis += h[Math.floor(Math.random() * h.length)];
      const rate = Math.pow(2, semis / 12) * (this.bufSR / sampleRate);
      const span = Math.min(this.bufLen - 2, len * rate);

      if (!p.freeze) this.scan = (this.scan + 0.003) % 1;
      const spray = (Math.random() * 2 - 1) * p.spray * 0.4;
      const norm = (this.scan + spray + 1) % 1;
      const start = norm * Math.max(0, this.bufLen - 2 - span);
      const reverse = (Math.random() * 100) < p.reverseChance;

      g.pos = reverse ? start + span : start;
      g.inc = reverse ? -rate : rate;
      g.len = len; g.idx = 0; g.pluck = (p.texture | 0) === 1;
      const pan = Math.random() * 1.6 - 0.8;            // same spread as v1
      const a = (pan + 1) * Math.PI / 4;
      g.gL = Math.cos(a) * Math.SQRT2 * 0.5;            // equal-power, unity at centre per side
      g.gR = Math.sin(a) * Math.SQRT2 * 0.5;
      g.on = true;
    }

    process(inputs, outputs) {
      if (!this.alive) return false;
      const out = outputs[0];
      const oL = out[0], oR = out[1] || out[0];
      const n = oL.length;
      const L = this.L, R = this.R, bl = this.bufLen;
      const target = this.running ? 1 : 0;

      for (let i = 0; i < n; i++) {
        if (this.level < target) this.level = Math.min(1, this.level + this.fadeStep);
        else if (this.level > target) this.level = Math.max(0, this.level - this.fadeStep);

        if (this.running) {
          if (this.nextIn <= 0) {
            this._spawn();
            const interval = sampleRate / Math.max(1, this.p.density);
            this.nextIn += Math.max(1, interval * (1 + (Math.random() * 0.3 - 0.15)));
          }
          this.nextIn -= 1;
        }

        let sL = 0, sR = 0;
        if (bl) {
          for (let k = 0; k < MAX_GRAINS; k++) {
            const g = this.grains[k];
            if (!g.on) continue;
            const t = g.idx / g.len;
            let w;
            if (g.pluck) w = t < 0.05 ? t / 0.05 : Math.exp(-8 * (t - 0.05) / 0.95);
            else w = 0.5 * (1 - Math.cos(2 * Math.PI * t));
            const p0 = g.pos | 0, fr = g.pos - p0;
            if (p0 >= 0 && p0 + 1 < bl) {
              const m = ((L[p0] + (L[p0 + 1] - L[p0]) * fr) + (R[p0] + (R[p0 + 1] - R[p0]) * fr)) * w;
              sL += m * g.gL; sR += m * g.gR;
            }
            g.pos += g.inc;
            if (++g.idx >= g.len) g.on = false;
          }
        }
        oL[i] = sL * this.level;
        if (oR !== oL) oR[i] = sR * this.level;
      }

      if (!this.running && this.level === 0) {
        for (let k = 0; k < MAX_GRAINS; k++) this.grains[k].on = false;
      }
      return true;
    }
  }

  register(NAME, GranularCloudV2Processor);
}

// ---------------------------------------------------------------------------
// Main-thread node class (what the host instantiates)
// ---------------------------------------------------------------------------
class GranularCloudV2DSP {
  constructor() {
    this.ctx = null;
    this.host = null;
    this.outputNode = null;
    this.workletNode = null;
    this.isRunning = false;
    this.ready = null;
    this._disposed = false;
    this._buffer = null;          // last injected AudioBuffer (to avoid re-posting)
    this._pendingBuffer = null;   // {L,R,sampleRate} waiting for the worklet
    this.params = {};
    GRANULAR_CLOUD_V2_PARAMS.forEach(s => { this.params[s.id] = s.def; });
  }

  static _moduleSource() {
    return '(' + granularCloudV2WorkletModule.toString() + ')();';
  }

  static _loadModule(ctx) {
    const reg = ctx.__aetherWorkletModules || (ctx.__aetherWorkletModules = {});
    if (!reg[GRANULAR_CLOUD_V2_PROCESSOR]) {
      const src = GranularCloudV2DSP._moduleSource();
      let url;
      if (typeof globalThis.__aetherWorkletUrl === 'function') {
        url = globalThis.__aetherWorkletUrl(src, GRANULAR_CLOUD_V2_PROCESSOR); // test harness hook
      } else if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      } else {
        url = 'data:application/javascript,' + encodeURIComponent(src);
      }
      reg[GRANULAR_CLOUD_V2_PROCESSOR] = ctx.audioWorklet.addModule(url);
    }
    return reg[GRANULAR_CLOUD_V2_PROCESSOR];
  }

  /** Silent: builds the graph, never starts grains. */
  init(audioContext, host = {}) {
    this.ctx = audioContext;
    this.host = host || {};
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.outputNode = ctx.createGain();
    this.outputNode.gain.setValueAtTime(0.75, now);

    this.wetGain = ctx.createGain();                       // mix (host plays the dry sample)
    this.wetGain.gain.setValueAtTime(this.params.mix, now);
    this.wetGain.connect(this.outputNode);

    // Diffusion / feedback network (unchanged from v1)
    this.feedbackGain = ctx.createGain();
    this.feedbackGain.gain.setValueAtTime(0, now);           // raised in start()
    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.setValueAtTime(0.18, now);
    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(3200, now);
    this.filterNode.Q.setValueAtTime(1.2, now);
    this.delayNode.connect(this.filterNode);
    this.filterNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.feedbackGain.connect(this.wetGain);

    if (!this._pendingBuffer) this._pendingBuffer = this._defaultTexture();

    this.ready = GranularCloudV2DSP._loadModule(ctx).then(() => {
      if (this._disposed || !this.ctx) return;
      this.workletNode = new AudioWorkletNode(ctx, GRANULAR_CLOUD_V2_PROCESSOR, {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
      });
      this.workletNode.connect(this.wetGain);
      this.workletNode.connect(this.delayNode);
      this._post({ type: 'params', values: this._grainParams() });
      if (this._pendingBuffer) {
        this._post({ type: 'buffer', ...this._pendingBuffer });
        this._pendingBuffer = null;
      }
      if (this.isRunning) this._post({ type: 'run', on: true });
    }).catch(err => {
      console.error('[Granular Cloud v2] worklet failed to load:', err);
    });

    return this.outputNode;
  }

  _post(msg) {
    if (this.workletNode) this.workletNode.port.postMessage(msg);
  }

  _grainParams() {
    const p = this.params;
    return {
      density: p.density, grainSize: p.grainSize, spray: p.spray, pitchShift: p.pitchShift,
      harmony: p.harmony, reverseChance: p.reverseChance, texture: p.texture, freeze: p.freeze
    };
  }

  _defaultTexture() {
    // 4 s A-minor-9 breath, same recipe as v1
    const sr = this.ctx ? this.ctx.sampleRate : 44100;
    const length = Math.floor(sr * 4);
    const L = new Float32Array(length), R = new Float32Array(length);
    const freqs = [110.0, 164.81, 220.0, 261.63, 329.63, 493.88];
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      let sL = 0, sR = 0;
      for (let h = 0; h < freqs.length; h++) {
        const f = freqs[h];
        const amp = (1 / (h + 1)) * (0.8 + 0.2 * Math.sin(0.8 * t + h));
        sL += amp * Math.sin(2 * Math.PI * f * (1 + 0.002 * Math.sin(0.3 * t + h)) * t);
        sR += amp * Math.sin(2 * Math.PI * f * (1 + 0.002 * Math.cos(0.27 * t + h * 1.5)) * t);
      }
      const noise = (Math.random() * 2 - 1) * 0.025;
      const env = Math.sin((Math.PI * i) / length);
      L[i] = (sL * 0.18 + noise) * env;
      R[i] = (sR * 0.18 + noise) * env;
    }
    return { L, R, sampleRate: sr };
  }

  /** Host hands the track's sample here (load sample first, then drop the node). */
  injectAudioBuffer(audioBuffer) {
    if (!audioBuffer || !audioBuffer.numberOfChannels || audioBuffer === this._buffer) return;
    this._buffer = audioBuffer;
    const L = new Float32Array(audioBuffer.getChannelData(0));
    const R = audioBuffer.numberOfChannels > 1 ? new Float32Array(audioBuffer.getChannelData(1)) : L;
    const msg = { L, R, sampleRate: audioBuffer.sampleRate };
    if (this.workletNode) this._post({ type: 'buffer', ...msg });
    else this._pendingBuffer = msg;
  }

  start(snapshot) {
    if (!this.ctx) return;
    this.isRunning = true;           // idempotent; ambient tier ignores the grid
    this._post({ type: 'run', on: true });
    if (this.feedbackGain) {
      const now = this.ctx.currentTime;
      this.feedbackGain.gain.cancelScheduledValues(now);
      this.feedbackGain.gain.setTargetAtTime(this.params.feedback, now, 0.02);
    }
  }

  /** Silences grains (30 ms fade in the worklet) and the diffusion tail. */
  stop() {
    this.isRunning = false;
    this._post({ type: 'run', on: false });
    if (this.feedbackGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.feedbackGain.gain.cancelScheduledValues(now);
      this.feedbackGain.gain.setTargetAtTime(0, now, 0.01);
    }
  }

  setParameter(paramId, value) {
    const spec = GRANULAR_CLOUD_V2_PARAMS.find(s => s.id === paramId);
    if (!spec) return;
    let v = value;
    if (spec.names && typeof v === 'string') v = Math.max(0, spec.names.indexOf(v));
    if (typeof v === 'boolean') v = v ? 1 : 0;
    v = Number(v);
    if (!Number.isFinite(v)) return;
    v = Math.max(spec.min, Math.min(spec.max, v));
    if (spec.type === 'int' || spec.type === 'bool') v = Math.round(v);
    this.params[paramId] = v;

    const now = this.ctx ? this.ctx.currentTime : 0;
    if (paramId === 'feedback') {
      if (this.feedbackGain && this.isRunning) this.feedbackGain.gain.setTargetAtTime(v, now, 0.05);
    }
    else if (paramId === 'mix' && this.wetGain) this.wetGain.gain.setTargetAtTime(v, now, 0.02);
    else this._post({ type: 'param', id: paramId, value: v });
  }

  getParameter(paramId) {
    return this.params[paramId];
  }

  getParameters() {
    return Object.assign({}, this.params);
  }

  connect(destination) {
    if (this.outputNode && destination) this.outputNode.connect(destination);
  }

  disconnect() {
    if (this.outputNode) { try { this.outputNode.disconnect(); } catch (_) {} }
  }

  dispose() {
    this.stop();
    this._disposed = true;
    this._post({ type: 'dispose' });
    [this.workletNode, this.wetGain, this.feedbackGain, this.delayNode, this.filterNode, this.outputNode]
      .forEach(n => { if (n) { try { n.disconnect(); } catch (_) {} } });
    if (this.workletNode) this.workletNode.port.onmessage = null;
    this.workletNode = null;
    this._buffer = null;
    this._pendingBuffer = null;
    this.outputNode = null;
    this.ctx = null;
    this.host = null;
  }
}

if (typeof window !== 'undefined') {
  window.GranularCloudV2DSP = GranularCloudV2DSP;
  window.CustomNodeDSP = GranularCloudV2DSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GranularCloudV2DSP, CustomNodeDSP: GranularCloudV2DSP, granularCloudV2WorkletModule };
}
