// Aether Spatializer AudioWorklet
//
// Haas delay + three low-passed early reflections, driven by the node's x / z.
// Same sound design as desktop/dsp-wasm/src/lib.rs, now computed here in JS.
//
// Why not the Wasm build any more (Claude, 1 Oct 2026, Lab branch):
// 1. The old JS called spatializer_process with 13 arguments; the Rust function
//    takes 10. `len` received a pointer (millions of samples) -> "memory access
//    out of bounds" on the first block. A worklet that throws is switched off for
//    good, so every spatialised node lost its direct sound (only reverb remained).
// 2. It wrote/read audio in a JS-created WebAssembly.Memory that the module never
//    imports (the module uses its own exported memory).
// 3. Even with 1 and 2 fixed, the Rust delay line reads one slot too far: a 0 ms
//    delay returned the sample from ~1 second ago. Centred nodes (and the near ear
//    of panned nodes) would have come out ~1 s late, like a slap echo.
// The DSP is tiny, so doing it here removes the build step and the crash risk.
// The 'load-wasm' message from the host is still accepted and simply ignored.

const MAX_DELAY_SECONDS = 1.0;

class DelayLine {
  constructor(sr) {
    this.size = Math.ceil(sr * MAX_DELAY_SECONDS) + 2;
    this.buf = new Float32Array(this.size);
    this.w = 0;       // next write position
    this.sr = sr;
  }
  write(s) {
    this.buf[this.w] = s;
    this.w = (this.w + 1) % this.size;
  }
  // Sample written `ms` milliseconds ago (0 ms = the sample just written).
  read(ms) {
    const d = Math.min(this.size - 3, Math.max(0, ms * this.sr / 1000));
    let pos = this.w - 1 - d;
    while (pos < 0) pos += this.size;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const i1 = (i0 + 1) % this.size;
    return this.buf[i0] * (1 - frac) + this.buf[i1] * frac;
  }
}

class OnePoleLpf {
  constructor(fc, sr) { this.z1 = 0; this.sr = sr; this.set(fc); }
  set(fc) {
    const b = Math.exp(-2 * Math.PI * fc / this.sr);
    this.b1 = b; this.a0 = 1 - b;
  }
  process(s) { this.z1 = s * this.a0 + this.z1 * this.b1; return this.z1; }
}

class SpatializerWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.dL = new DelayLine(sr); this.dR = new DelayLine(sr);
    this.t1L = new DelayLine(sr); this.t1R = new DelayLine(sr);
    this.t2L = new DelayLine(sr); this.t2R = new DelayLine(sr);
    this.t3L = new DelayLine(sr); this.t3R = new DelayLine(sr);
    this.f1L = new OnePoleLpf(4000, sr); this.f1R = new OnePoleLpf(4000, sr);
    this.f2L = new OnePoleLpf(3000, sr); this.f2R = new OnePoleLpf(3000, sr);
    this.f3L = new OnePoleLpf(2000, sr); this.f3R = new OnePoleLpf(2000, sr);
    this.port.onmessage = (e) => {
      // Host still posts the Wasm bytes; nothing to do, but answer so any listener is happy.
      if (e.data && e.data.type === 'load-wasm') this.port.postMessage({ type: 'wasm-loaded', engine: 'js' });
    };
  }

  static get parameterDescriptors() {
    return [
      { name: 'x',         defaultValue: 0.5, minValue: 0.0, maxValue: 1.0   },
      { name: 'y',         defaultValue: 0.5, minValue: 0.0, maxValue: 1.0   },
      { name: 'z',         defaultValue: 0.0, minValue: 0.0, maxValue: 100.0 },
      { name: 'intensity', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0   },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const oL = output[0], oR = output[1] || output[0];
    const n = oL.length;
    const iL = (input && input[0]) || null;
    const iR = (input && (input[1] || input[0])) || null;
    if (!iL) { oL.fill(0); if (oR !== oL) oR.fill(0); return true; }

    const x = parameters.x[0];
    const z = parameters.z[0];
    const intensity = parameters.intensity[0];

    if (intensity <= 0.001) {
      oL.set(iL); if (oR !== oL) oR.set(iR);
      // keep the lines fed so turning spatialisation on doesn't replay stale audio
      for (let i = 0; i < n; i++) {
        this.dL.write(0); this.dR.write(0);
        this.t1L.write(0); this.t1R.write(0); this.t2L.write(0); this.t2R.write(0); this.t3L.write(0); this.t3R.write(0);
      }
      return true;
    }

    const pan = (x - 0.5) * 2;
    const angle = (pan + 1) * Math.PI / 4;
    const ampL = Math.cos(angle), ampR = Math.sin(angle);
    const haasL = pan > 0 ? pan * 20 : 0;      // ms; delay the far ear
    const haasR = pan < 0 ? -pan * 20 : 0;

    const zn = Math.min(1, Math.max(0, z / 50));
    const fc = 5000 * Math.max(0.1, 1 - zn * 0.8);
    this.f1L.set(fc); this.f1R.set(fc);
    this.f2L.set(fc * 0.8); this.f2R.set(fc * 0.8);
    this.f3L.set(fc * 0.6); this.f3R.set(fc * 0.6);
    const tap1 = 15 + zn * 10, tap2 = 28 + zn * 20, tap3 = 42 + zn * 35;
    const erGain = 0.3 * intensity;

    for (let i = 0; i < n; i++) {
      const dryL = iL[i] * ampL, dryR = iR[i] * ampR;
      this.dL.write(dryL); this.dR.write(dryR);
      const hL = this.dL.read(haasL), hR = this.dR.read(haasR);
      this.t1L.write(hL); this.t1R.write(hR);
      this.t2L.write(hL); this.t2R.write(hR);
      this.t3L.write(hL); this.t3R.write(hR);
      const erL = this.f1L.process(this.t1L.read(tap1)) + this.f2L.process(this.t2L.read(tap2)) + this.f3L.process(this.t3L.read(tap3));
      const erR = this.f1R.process(this.t1R.read(tap1)) + this.f2R.process(this.t2R.read(tap2)) + this.f3R.process(this.t3R.read(tap3));
      oL[i] = dryL * (1 - intensity) + (hL + erL * erGain) * intensity;
      if (oR !== oL) oR[i] = dryR * (1 - intensity) + (hR + erR * erGain) * intensity;
    }
    return true;
  }
}

registerProcessor('spatializer-worklet', SpatializerWorklet);
