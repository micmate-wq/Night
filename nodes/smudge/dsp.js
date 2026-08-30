/**
 * Smudge AudioWorklet DSP Insert Effect
 * FFT/IFFT spectral freeze, magnitude low-pass smearing, spectral tilt, and phase dispersion.
 */

class SmudgeDSP extends (typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : Object) {
  constructor() {
    super();

    this.params = {
      dry_wet: 0.50,
      smudge_length: 0.60,
      spectral_tilt: 0.50,
      phase_dispersion: 0.50
    };

    this.sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;

    // FFT configuration (Radix-2, 1024 points with 75% overlap -> hop = 256)
    this.N = 1024;
    this.hop = 256;
    this.numBins = this.N / 2 + 1;

    // Precalculate Hann Window
    this.window = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.N - 1)));
    }

    // Bit reversal lookup table
    this.bitRev = new Uint32Array(this.N);
    const log2N = Math.round(Math.log2(this.N));
    for (let i = 0; i < this.N; i++) {
      let rev = 0;
      for (let j = 0; j < log2N; j++) {
        if ((i >> j) & 1) {
          rev |= 1 << (log2N - 1 - j);
        }
      }
      this.bitRev[i] = rev;
    }

    // Twiddle factors
    this.cosTable = new Float32Array(this.N / 2);
    this.sinTable = new Float32Array(this.N / 2);
    for (let i = 0; i < this.N / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / this.N);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / this.N);
    }

    // Work arrays
    this.real = new Float32Array(this.N);
    this.imag = new Float32Array(this.N);

    // Channel States (Left & Right)
    this.channels = [this._createChannelState(), this._createChannelState()];

    if (this.port) {
      this.port.onmessage = (event) => {
        if (!event.data) return;
        const id = event.data.paramId || event.data.id;
        const val = event.data.value;
        if (id && this.params[id] !== undefined) {
          this.params[id] = typeof val === 'number' ? val : parseFloat(val);
        }
      };
    }
  }

  _createChannelState() {
    return {
      inBuf: new Float32Array(this.N),
      inIdx: 0,
      outBuf: new Float32Array(this.N * 2),
      outReadIdx: 0,
      outWriteIdx: 0,
      smearedMag: new Float32Array(this.numBins),
      synthPhase: new Float32Array(this.numBins)
    };
  }

  _fft(real, imag) {
    const n = this.N;
    for (let i = 0; i < n; i++) {
      const j = this.bitRev[i];
      if (j > i) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
    }

    for (let len = 2; len <= n; len <<= 1) {
      const halfLen = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < halfLen; j++) {
          const k = j * step;
          const u_r = real[i + j];
          const u_i = imag[i + j];
          const v_r = real[i + j + halfLen] * this.cosTable[k] - imag[i + j + halfLen] * this.sinTable[k];
          const v_i = real[i + j + halfLen] * this.sinTable[k] + imag[i + j + halfLen] * this.cosTable[k];
          real[i + j] = u_r + v_r;
          imag[i + j] = u_i + v_i;
          real[i + j + halfLen] = u_r - v_r;
          imag[i + j + halfLen] = u_i - v_i;
        }
      }
    }
  }

  _ifft(real, imag) {
    for (let i = 0; i < this.N; i++) {
      imag[i] = -imag[i];
    }
    this._fft(real, imag);
    const invN = 1.0 / this.N;
    for (let i = 0; i < this.N; i++) {
      real[i] = real[i] * invN;
      imag[i] = -imag[i] * invN;
    }
  }

  _processSTFT(ch) {
    for (let i = 0; i < this.N; i++) {
      const bufIdx = (ch.inIdx - this.N + i + this.N) % this.N;
      this.real[i] = ch.inBuf[bufIdx] * this.window[i];
      this.imag[i] = 0.0;
    }

    this._fft(this.real, this.imag);

    const lengthParam = Math.max(0.05, Math.min(0.999, this.params.smudge_length));
    const tiltParam = Math.max(0.0, Math.min(1.0, this.params.spectral_tilt));
    const dispersionParam = Math.max(0.0, Math.min(1.0, this.params.phase_dispersion));

    // Smear lowpass alpha (0.75 -> 0.9992 for sustained freeze)
    const alpha = 0.75 + Math.pow(lengthParam, 1.8) * 0.248;
    const beta = 1.0 - alpha;

    // Spectral tilt slope (-1.5 to +1.5 dB/octave scaling)
    const tiltSlope = (tiltParam - 0.5) * 3.0;

    for (let k = 0; k < this.numBins; k++) {
      const r = this.real[k];
      const im = this.imag[k];
      const mag = Math.sqrt(r * r + im * im);

      ch.smearedMag[k] = alpha * ch.smearedMag[k] + beta * mag;

      // Apply spectral tilt weighting across frequency bins
      const binNorm = k / (this.numBins - 1);
      const tiltWeight = Math.pow(2.0, tiltSlope * (binNorm * 2.0 - 1.0));

      // Phase vocoder with controllable phase dispersion
      const phaseDelta = (2 * Math.PI * k * this.hop) / this.N;
      const jitter = (Math.random() - 0.5) * Math.PI * 0.9 * dispersionParam;
      ch.synthPhase[k] += phaseDelta + jitter;
      if (ch.synthPhase[k] > Math.PI) ch.synthPhase[k] -= 2 * Math.PI;
      if (ch.synthPhase[k] < -Math.PI) ch.synthPhase[k] += 2 * Math.PI;

      const synMag = ch.smearedMag[k] * tiltWeight;
      this.real[k] = synMag * Math.cos(ch.synthPhase[k]);
      this.imag[k] = synMag * Math.sin(ch.synthPhase[k]);

      if (k > 0 && k < this.N / 2) {
        this.real[this.N - k] = this.real[k];
        this.imag[this.N - k] = -this.imag[k];
      }
    }

    this._ifft(this.real, this.imag);

    const outLen = ch.outBuf.length;
    for (let i = 0; i < this.N; i++) {
      const idx = (ch.outWriteIdx + i) % outLen;
      ch.outBuf[idx] += this.real[i] * this.window[i] * 0.6;
    }

    ch.outWriteIdx = (ch.outWriteIdx + this.hop) % outLen;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;

    const inL = (input && input.length > 0) ? input[0] : null;
    const inR = (input && input.length > 1) ? input[1] : inL;

    const wet = Math.max(0.0, Math.min(1.0, this.params.dry_wet));
    const dry = 1.0 - wet;

    for (let i = 0; i < blockSize; i++) {
      const dryL = inL ? inL[i] : 0.0;
      const dryR = inR ? inR[i] : 0.0;

      // Left Channel
      const chL = this.channels[0];
      chL.inBuf[chL.inIdx] = dryL;
      chL.inIdx = (chL.inIdx + 1) % this.N;
      if (chL.inIdx % this.hop === 0) {
        this._processSTFT(chL);
      }

      const wetL = chL.outBuf[chL.outReadIdx];
      chL.outBuf[chL.outReadIdx] = 0.0;
      chL.outReadIdx = (chL.outReadIdx + 1) % chL.outBuf.length;

      // Right Channel
      const chR = this.channels[1];
      chR.inBuf[chR.inIdx] = dryR;
      chR.inIdx = (chR.inIdx + 1) % this.N;
      if (chR.inIdx % this.hop === 0) {
        this._processSTFT(chR);
      }

      const wetR = chR.outBuf[chR.outReadIdx];
      chR.outBuf[chR.outReadIdx] = 0.0;
      chR.outReadIdx = (chR.outReadIdx + 1) % chR.outBuf.length;

      outL[i] = dryL * dry + wetL * wet;
      outR[i] = dryR * dry + wetR * wet;
    }

    return true;
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('com.aether.node.smudge', SmudgeDSP);
}
