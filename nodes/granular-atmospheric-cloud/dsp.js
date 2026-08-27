/**
 * Granular Atmospheric Cloud DSP Engine for Aether Node Ecosystem
 * 
 * Standard decoupled DSP interface:
 * - init(audioContext, config)
 * - setParameter(paramId, value)
 * - connect(destinationNode)
 * - disconnect()
 * - injectAudioBuffer(audioBuffer)
 * - dispose()
 */

class GranularAtmosphericCloudDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.feedbackNode = null;
    this.filterNode = null;
    this.pannerNode = null;

    this.sampleBuffer = null;
    this.isRunning = false;
    this.timerId = null;

    // Default Parameters
    this.params = {
      density: 18.0,      // grains per second
      grainSize: 0.22,    // duration in seconds
      spray: 0.45,        // scan pointer random spray (0..1)
      pitchShift: 0.0,    // semitones (-24..24)
      feedback: 0.55,     // diffusion loop feedback (0..0.95)
      freeze: false       // freeze scan position
    };

    this.scanPosition = 0.2; // normalized 0..1
    this.windowTable = null;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;

    // Master node output bus for this node
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(0.75, this.ctx.currentTime);

    // Diffusion & Feedback loop
    this.feedbackGain = this.ctx.createGain();
    this.feedbackGain.gain.setValueAtTime(this.params.feedback, this.ctx.currentTime);

    this.delayNode = this.ctx.createDelay(2.0);
    this.delayNode.delayTime.setValueAtTime(0.18, this.ctx.currentTime);

    // Warm high-shelf/low-pass filter inside diffusion path
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(3200, this.ctx.currentTime);
    this.filterNode.Q.setValueAtTime(1.2, this.ctx.currentTime);

    // Feedback network routing
    this.delayNode.connect(this.filterNode);
    this.filterNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.feedbackGain.connect(this.outputNode);

    // Pre-calculate Hanning window curve for smooth micro-grain edges
    this._generateHanningWindow(256);

    // Generate lush default ambient texture buffer if none provided
    if (config.sampleBuffer) {
      this.sampleBuffer = config.sampleBuffer;
    } else {
      this._generateDefaultHarmonicTexture();
    }

    this.start();
    return this.outputNode;
  }

  _generateHanningWindow(length) {
    this.windowTable = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      this.windowTable[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
    }
  }

  _generateDefaultHarmonicTexture() {
    // Generate a 4-second lush ambient chord buffer (A minor 9 / ethereal breath)
    const duration = 4.0;
    const sampleRate = this.ctx ? this.ctx.sampleRate : 44100;
    const length = Math.floor(sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const freqs = [110.0, 164.81, 220.0, 261.63, 329.63, 493.88]; // A2, E3, A3, C4, E4, B4
    const numHarmonics = freqs.length;

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sL = 0;
      let sR = 0;

      for (let h = 0; h < numHarmonics; h++) {
        const f = freqs[h];
        const detuneL = 1.0 + 0.002 * Math.sin(0.3 * t + h);
        const detuneR = 1.0 + 0.002 * Math.cos(0.27 * t + h * 1.5);
        const amp = (1.0 / (h + 1)) * (0.8 + 0.2 * Math.sin(0.8 * t + h));
        
        sL += amp * Math.sin(2 * Math.PI * f * detuneL * t);
        sR += amp * Math.sin(2 * Math.PI * f * detuneR * t);
      }

      // Subtle noise texture
      const noise = (Math.random() * 2 - 1) * 0.025;
      const env = Math.sin((Math.PI * i) / length); // smooth ends

      left[i] = (sL * 0.18 + noise) * env;
      right[i] = (sR * 0.18 + noise) * env;
    }

    this.sampleBuffer = buffer;
  }

  injectAudioBuffer(audioBuffer) {
    if (audioBuffer && audioBuffer.numberOfChannels) {
      this.sampleBuffer = audioBuffer;
    }
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;

    if (paramId === 'feedback' && this.feedbackGain && this.ctx) {
      const clamped = Math.max(0, Math.min(0.95, value));
      this.feedbackGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.05);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._scheduleNextGrain();
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  _scheduleNextGrain() {
    if (!this.isRunning || !this.ctx || !this.sampleBuffer) return;

    this._spawnGrain();

    // Calculate delay until next grain based on density
    const intervalMs = Math.max(10, (1000.0 / Math.max(1.0, this.params.density)));
    const jitter = (Math.random() * 0.3 - 0.15) * intervalMs;
    const nextTime = Math.max(8, intervalMs + jitter);

    this.timerId = setTimeout(() => this._scheduleNextGrain(), nextTime);
  }

  _spawnGrain() {
    if (!this.sampleBuffer || !this.ctx) return;

    const now = this.ctx.currentTime;
    const bufferDuration = this.sampleBuffer.duration;
    const grainDur = Math.max(0.02, Math.min(1.5, this.params.grainSize));

    // Calculate sample offset with spray jitter
    if (!this.params.freeze) {
      this.scanPosition = (this.scanPosition + 0.003) % 1.0;
    }
    const sprayOffset = (Math.random() * 2 - 1) * this.params.spray * 0.4;
    let offsetNorm = (this.scanPosition + sprayOffset + 1.0) % 1.0;
    let offsetSeconds = offsetNorm * Math.max(0, bufferDuration - grainDur);

    // Source Node
    const src = this.ctx.createBufferSource();
    src.buffer = this.sampleBuffer;

    // Pitch playback rate calculation
    const semitones = this.params.pitchShift + (Math.random() * 0.4 - 0.2);
    src.playbackRate.setValueAtTime(Math.pow(2, semitones / 12), now);

    // Envelope Gain Node (Hanning window shape)
    const envGain = this.ctx.createGain();
    envGain.gain.setValueAtTime(0.0001, now);
    envGain.gain.setValueCurveAtTime(this.windowTable, now, grainDur);

    // Stereo Panning for spatial grain spread
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const panVal = Math.random() * 1.6 - 0.8;
    if (panner) {
      panner.pan.setValueAtTime(panVal, now);
      src.connect(envGain);
      envGain.connect(panner);
      panner.connect(this.outputNode);
      panner.connect(this.delayNode);
    } else {
      src.connect(envGain);
      envGain.connect(this.outputNode);
      envGain.connect(this.delayNode);
    }

    src.start(now, offsetSeconds, grainDur);
    src.stop(now + grainDur + 0.05);

    // Clean up nodes after playback
    src.onended = () => {
      try {
        src.disconnect();
        envGain.disconnect();
        if (panner) panner.disconnect();
      } catch (_) {}
    };
  }

  connect(destinationNode) {
    if (this.outputNode && destinationNode) {
      this.outputNode.connect(destinationNode);
    }
  }

  disconnect() {
    if (this.outputNode) {
      this.outputNode.disconnect();
    }
  }

  dispose() {
    this.stop();
    this.disconnect();
    if (this.feedbackGain) this.feedbackGain.disconnect();
    if (this.delayNode) this.delayNode.disconnect();
    if (this.filterNode) this.filterNode.disconnect();
  }
}

// Universal export (Browser, Worklet, or Node context)
if (typeof window !== 'undefined') {
  window.GranularAtmosphericCloudDSP = GranularAtmosphericCloudDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GranularAtmosphericCloudDSP };
}
