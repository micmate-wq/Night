/**
 * Polyphonic Singing Bowls DSP Engine
 * 5-voice generative additive synthesis with stochastic strikes, acoustic beating, and per-voice tone filtering.
 */

class PolyphonicSingingBowlsDSP extends (typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : Object) {
  constructor() {
    super();

    this.params = {
      rootPitch: 120.0,
      activity: 0.5,
      resonance: 0.7,
      beatingMix: 0.6,
      tone_1: 0.8,
      tone_2: 0.8,
      tone_3: 0.8,
      tone_4: 0.8,
      tone_5: 0.8
    };

    // Minor Pentatonic tuning ratios
    this.ratios = [1.0, 1.1892, 1.3348, 1.4983, 1.7818]; // 1, b3, 4, 5, b7
    this.numVoices = 5;

    // Voice states
    this.voices = [];
    for (let k = 0; k < this.numVoices; ++k) {
      this.voices.push({
        phaseF1: Math.random() * Math.PI * 2,
        phaseF2: Math.random() * Math.PI * 2,
        phaseO1: Math.random() * Math.PI * 2,
        phaseO2: Math.random() * Math.PI * 2,
        lfoPhase: Math.random() * Math.PI * 2,
        beatOffset: 0.6 + k * 0.35, // 0.6Hz to 2.0Hz wobble
        env: 0.0,
        targetEnv: 0.0,
        envSpeed: 0.0005,
        attackRate: 0.0001,
        decayRate: 0.00005,
        stage: 'idle', // 'attack', 'decay', 'idle'
        lpState: 0.0
      });
    }

    this.sampleCount = 0;

    if (this.port) {
      this.port.onmessage = (event) => {
        if (!event.data) return;
        const id = event.data.paramId || event.data.id;
        const val = event.data.value;
        if (id && this.params[id] !== undefined) {
          this.params[id] = val;
        }
      };
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const sampleRate = globalThis.sampleRate || 44100;
    const invSampleRate = 1.0 / sampleRate;
    const overtoneRatio = 2.98;

    // Stochastic strike trigger check
    const blockSize = output[0].length;
    this.sampleCount += blockSize;
    
    // Dynamic trigger probability based on activity
    const intervalSamples = Math.max(4000, Math.floor((1.05 - this.params.activity) * sampleRate * 1.8));
    if (this.sampleCount >= intervalSamples) {
      this.sampleCount = 0;
      // Select random voice to strike
      const chosenVoice = Math.floor(Math.random() * this.numVoices);
      const v = this.voices[chosenVoice];
      v.stage = 'attack';
      v.targetEnv = 0.5 + Math.random() * 0.5; // velocity
      v.attackRate = 1.0 / (sampleRate * (1.2 + Math.random() * 0.8)); // ~1.2s - 2.0s attack
      
      // Decay time scaled by resonance: 3s up to 18s
      const decayDuration = 3.0 + (this.params.resonance * 15.0);
      v.decayRate = 1.0 / (sampleRate * decayDuration);

      if (this.port) {
        try {
          this.port.postMessage({ type: 'aether:voice-trigger', voiceIndex: chosenVoice });
        } catch (_) {}
      }
    }

    const channelL = output[0];
    const channelR = output[1] || output[0];

    // Pre-calculate per-voice filter coefficients
    const alphaPerVoice = new Float32Array(this.numVoices);
    const minCutoff = 180.0;
    const maxCutoff = 14000.0;

    for (let k = 0; k < this.numVoices; ++k) {
      const toneVal = Math.max(0.0, Math.min(1.0, this.params[`tone_${k + 1}`] ?? 0.8));
      const cutoff = minCutoff * Math.pow(maxCutoff / minCutoff, toneVal);
      alphaPerVoice[k] = Math.min(1.0, 1.0 - Math.exp(-2.0 * Math.PI * cutoff * invSampleRate));
    }

    for (let i = 0; i < blockSize; ++i) {
      let mixL = 0.0;
      let mixR = 0.0;

      for (let k = 0; k < this.numVoices; ++k) {
        const v = this.voices[k];
        
        // Envelope advancement
        if (v.stage === 'attack') {
          v.env += v.attackRate;
          if (v.env >= v.targetEnv) {
            v.env = v.targetEnv;
            v.stage = 'decay';
          }
        } else if (v.stage === 'decay') {
          v.env -= v.decayRate;
          if (v.env <= 0.0001) {
            v.env = 0.0;
            v.stage = 'idle';
          }
        }

        if (v.env <= 0.00001) {
          // Slowly decay any filter residue when idle
          v.lpState *= 0.99;
          continue;
        }

        // Frequencies for voice k
        const f1 = this.params.rootPitch * this.ratios[k];
        const f2 = f1 + v.beatOffset;
        const o1 = f1 * overtoneRatio;
        const o2 = o1 + (v.beatOffset * 1.25);

        // Advance phases
        v.phaseF1 = (v.phaseF1 + f1 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        v.phaseF2 = (v.phaseF2 + f2 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        v.phaseO1 = (v.phaseO1 + o1 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        v.phaseO2 = (v.phaseO2 + o2 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        
        // Slow organic swell per bowl
        v.lfoPhase = (v.lfoPhase + 0.15 * Math.PI * 2 * invSampleRate) % (Math.PI * 2);
        const swell = 0.85 + 0.15 * Math.sin(v.lfoPhase);

        // Additive oscillators with beating mix
        const fundamental = Math.sin(v.phaseF1) + Math.sin(v.phaseF2) * this.params.beatingMix;
        const overtone = (Math.sin(v.phaseO1) + Math.sin(v.phaseO2) * this.params.beatingMix) * 0.45;
        
        const rawSignal = (fundamental + overtone) * v.env * swell * 0.35;

        // Dedicated per-voice low-pass tone filter
        const alpha = alphaPerVoice[k];
        v.lpState += alpha * (rawSignal - v.lpState);
        const voiceSignal = v.lpState;
        
        // Spatial stereo distribution across the 5 bowls
        const pan = (k / (this.numVoices - 1)) * 1.4 - 0.7; // -0.7 to +0.7
        const gainL = 0.5 * (1.0 - pan);
        const gainR = 0.5 * (1.0 + pan);

        mixL += voiceSignal * gainL;
        mixR += voiceSignal * gainR;
      }

      channelL[i] = mixL;
      channelR[i] = mixR;
    }

    return true;
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('polyphonic-singing-bowls-dsp', PolyphonicSingingBowlsDSP);
}

if (typeof window !== 'undefined') {
  window.PolyphonicSingingBowlsDSP = PolyphonicSingingBowlsDSP;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PolyphonicSingingBowlsDSP };
}
