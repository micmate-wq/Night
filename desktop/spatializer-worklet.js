// Aether Spatializer AudioWorklet
// Loads the Rust DSP Wasm module (raw C ABI — no wasm-bindgen glue needed).
// The main thread fetches dsp_wasm_bg.wasm and posts it here.

class SpatializerWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.port.onmessage = (e) => {
      if (e.data.type === 'load-wasm') {
        this._initWasm(e.data.wasmBytes).catch(err =>
          console.error('[SpatializerWorklet] Wasm init failed:', err)
        );
      }
    };
  }

  async _initWasm(wasmBytes) {
    // Compile and instantiate with minimal imports.
    // The Rust module only needs a memory import; all allocations are internal.
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 256 });

    const { instance } = await WebAssembly.instantiate(wasmBytes, {
      env: { memory },
    });

    this._wasm   = instance.exports;
    this._memory = memory;

    // Create the Spatializer instance on the Wasm heap.
    this._spatPtr = this._wasm.spatializer_new(sampleRate);

    // Allocate four 128-sample float32 buffers in Wasm linear memory.
    const BLOCK = 128;
    const BYTES = BLOCK * 4; // f32 = 4 bytes

    this._inLPtr  = this._wasm.alloc(BYTES);
    this._inRPtr  = this._wasm.alloc(BYTES);
    this._outLPtr = this._wasm.alloc(BYTES);
    this._outRPtr = this._wasm.alloc(BYTES);
    this._blockBytes = BYTES;
    this._block = BLOCK;

    this.ready = true;
    this.port.postMessage({ type: 'wasm-loaded' });
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
    const input  = inputs[0];
    const output = outputs[0];

    // Safety checks
    if (!input || !output || input.length === 0 || output.length === 0) return true;

    // If Wasm is not ready yet, pass audio through unchanged.
    if (!this.ready) {
      const iL = input[0],  iR = input[1] || input[0];
      const oL = output[0], oR = output[1] || output[0];
      if (oL) oL.set(iL || new Float32Array(128));
      if (oR) oR.set(iR || new Float32Array(128));
      return true;
    }

    const inL = input[0]  || new Float32Array(this._block);
    const inR = input[1]  || inL;

    // Write input into Wasm memory
    const mem = new Float32Array(this._memory.buffer);
    mem.set(inL, this._inLPtr  / 4);
    mem.set(inR, this._inRPtr  / 4);

    // Read a[0] or a k-rate (single-value) parameter
    const param = (a) => a[a.length > 1 ? 0 : 0];

    this._wasm.spatializer_process(
      this._spatPtr,
      this._inLPtr,  this._block,
      this._inRPtr,  this._block,
      this._outLPtr, this._block,
      this._outRPtr, this._block,
      param(parameters.x),
      param(parameters.y),
      param(parameters.z),
      param(parameters.intensity),
    );

    // Copy output from Wasm memory
    const outL = output[0];
    const outR = output[1] || output[0];
    if (outL) outL.set(mem.subarray(this._outLPtr / 4, this._outLPtr / 4 + this._block));
    if (outR) outR.set(mem.subarray(this._outRPtr / 4, this._outRPtr / 4 + this._block));

    return true;
  }
}

registerProcessor('spatializer-worklet', SpatializerWorklet);
