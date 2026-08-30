/**
 * Kinetic Glitch-Pond AudioWorklet DSP Engine
 * Organic Foley & Noise Burst Generator driven by kinetic particle collisions.
 * Completely silent when idle; generates rich, unpitched acoustic micro-textures on collision.
 */

class KineticGlitchPondDSP extends (typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : Object) {
  constructor() {
    super();

    this.params = {
      attack: 0.15,
      decay: 0.35,
      filter_sweep: 0.50,
      particle_speed: 0.50,
      glitch_intensity: 0.60,
      trigger_glitch: 0.0
    };

    this.sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;

    // Polyphonic Voice Pool (12 voices for rich overlapping long decays)
    this.maxVoices = 12;
    this.voices = [];
    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push({
        active: false,
        age: 0,
        totalSamples: 0,
        attackSamples: 0,
        decaySamples: 0,
        gain: 0.0,
        panL: 0.5,
        panR: 0.5,
        
        // SVF Filter State (State Variable Filter)
        svfL: 0.0,
        svfB: 0.0,
        startFreq: 1800.0,
        endFreq: 1800.0,
        currentFreq: 1800.0,
        svfQ: 0.3,
        filterMode: 'band', // 'band', 'high', 'low'

        // Noise Profile
        noiseColor: 'white', // 'white', 'pink', 'brown'
        pinkState: [0, 0, 0, 0, 0, 0, 0],
        brownState: 0.0,

        // Highpass filter for removing sub-rumble
        hpfStateL: 0.0,
        hpfStateR: 0.0
      });
    }

    this.lastTriggerSample = 0;
    this.totalProcessedSamples = 0;

    if (this.port) {
      this.port.onmessage = (event) => {
        if (!event.data) return;
        const id = event.data.paramId || event.data.id;
        const val = event.data.value;
        if (id && this.params[id] !== undefined) {
          this.params[id] = typeof val === 'number' ? val : parseFloat(val);
          if (id === 'trigger_glitch' && val > 0.1) {
            this.triggerBurst();
          }
        }
      };
    }
  }

  triggerBurst() {
    // 25ms retrigger cooldown
    if (this.totalProcessedSamples - this.lastTriggerSample < Math.floor(this.sr * 0.025)) {
      return;
    }
    this.lastTriggerSample = this.totalProcessedSamples;

    // Find available or oldest voice
    let voice = this.voices.find(v => !v.active);
    if (!voice) {
      voice = this.voices.reduce((oldest, v) => (v.age > oldest.age ? v : oldest), this.voices[0]);
    }

    const intensity = Math.max(0.1, Math.min(1.0, this.params.glitch_intensity));
    const attackParam = Math.max(0.0, Math.min(1.0, this.params.attack));
    const decayParam = Math.max(0.0, Math.min(1.0, this.params.decay));
    const sweepParam = Math.max(0.0, Math.min(1.0, this.params.filter_sweep));
    
    // Choose Foley texture category
    const profileType = Math.floor(Math.random() * 4);
    
    let baseFreq = 1800.0;
    let qFactor = 0.35;
    let mode = 'band';
    let color = 'white';

    if (profileType === 0) {
      // Dry Wood Snap / Bamboo
      baseFreq = 700.0 + Math.random() * 1100.0;
      qFactor = 0.25 + Math.random() * 0.3;
      mode = 'band';
      color = 'pink';
    } else if (profileType === 1) {
      // Raindrop / Seed Pod / Hollow Ping
      baseFreq = 1400.0 + Math.random() * 2200.0;
      qFactor = 0.18 + Math.random() * 0.22;
      mode = 'band';
      color = 'white';
    } else if (profileType === 2) {
      // Sand Hit / Vinyl Static Crackle
      baseFreq = 2600.0 + Math.random() * 3400.0;
      qFactor = 0.5 + Math.random() * 0.3;
      mode = 'high';
      color = 'white';
    } else {
      // Soft Brush / Leaf / Wind Flutter
      baseFreq = 800.0 + Math.random() * 2000.0;
      qFactor = 0.45 + Math.random() * 0.35;
      mode = 'band';
      color = 'brown';
    }

    // Dynamic Attack (0.1ms to 35ms)
    const baseAttackMs = 0.1 + Math.pow(attackParam, 2.0) * 35.0;
    // Dynamic Decay: (5ms to 2400ms when decay is 100%)
    const baseDecayMs = 5.0 + Math.pow(decayParam, 2.2) * 2400.0;

    // Humanization: +/- 12% variation
    const humanize = 1.0 + (Math.random() * 0.24 - 0.12);
    const attackMs = Math.max(0.1, baseAttackMs * humanize);
    const decayMs = Math.max(4.0, baseDecayMs * humanize);
    const centerFreq = Math.min(11000.0, Math.max(250.0, baseFreq * (0.85 + Math.random() * 0.3)));

    // Filter Sweep: modulate cutoff over duration
    const sweepRange = (sweepParam - 0.5) * 2.0; // -1.0 to +1.0
    let startFreq = centerFreq;
    let endFreq = centerFreq;
    if (sweepRange > 0.05) {
      // Sweep downwards
      startFreq = Math.min(12000.0, centerFreq * (1.0 + sweepRange * 2.5));
      endFreq = Math.max(200.0, centerFreq * (1.0 - sweepRange * 0.7));
    } else if (sweepRange < -0.05) {
      // Sweep upwards
      startFreq = Math.max(200.0, centerFreq * (1.0 + sweepRange * 0.7));
      endFreq = Math.min(12000.0, centerFreq * (1.0 - sweepRange * 2.5));
    }

    voice.active = true;
    voice.age = 0;
    voice.attackSamples = Math.max(4, Math.floor((attackMs / 1000) * this.sr));
    voice.decaySamples = Math.max(16, Math.floor((decayMs / 1000) * this.sr));
    voice.totalSamples = voice.attackSamples + voice.decaySamples;
    
    // Scale velocity
    const velocity = (0.3 + intensity * 0.7) * (0.9 + Math.random() * 0.2);
    voice.gain = velocity * 1.7;

    // Stereo spread
    const pan = (Math.random() * 2.0 - 1.0) * 0.5;
    voice.panL = 0.5 * (1.0 - pan);
    voice.panR = 0.5 * (1.0 + pan);

    voice.startFreq = startFreq;
    voice.endFreq = endFreq;
    voice.currentFreq = startFreq;
    voice.svfQ = qFactor;
    voice.filterMode = mode;
    voice.noiseColor = color;

    // Reset filter states
    voice.svfL = 0.0;
    voice.svfB = 0.0;
    voice.brownState = 0.0;
    voice.pinkState = [0, 0, 0, 0, 0, 0, 0];
    voice.hpfStateL = 0.0;
    voice.hpfStateR = 0.0;
  }

  _generateNoise(v) {
    const white = Math.random() * 2.0 - 1.0;
    if (v.noiseColor === 'pink') {
      const p = v.pinkState;
      p[0] = 0.99886 * p[0] + white * 0.0555179;
      p[1] = 0.99332 * p[1] + white * 0.0750759;
      p[2] = 0.96900 * p[2] + white * 0.1538520;
      p[3] = 0.86650 * p[3] + white * 0.3104856;
      p[4] = 0.55000 * p[4] + white * 0.5329522;
      p[5] = -0.7616 * p[5] - white * 0.0168980;
      const pink = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + white * 0.5362;
      p[6] = white * 0.115926;
      return pink * 0.22;
    } else if (v.noiseColor === 'brown') {
      v.brownState = (v.brownState + (0.04 * white)) / 1.035;
      return v.brownState * 2.2;
    }
    return white * 0.45;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;

    let anyActive = false;
    for (let v = 0; v < this.maxVoices; v++) {
      if (this.voices[v].active) {
        anyActive = true;
        break;
      }
    }

    if (!anyActive) {
      for (let i = 0; i < blockSize; i++) {
        outL[i] = 0.0;
        outR[i] = 0.0;
      }
      this.totalProcessedSamples += blockSize;
      return true;
    }

    for (let i = 0; i < blockSize; i++) {
      outL[i] = 0.0;
      outR[i] = 0.0;
    }

    for (let vIdx = 0; vIdx < this.maxVoices; vIdx++) {
      const v = this.voices[vIdx];
      if (!v.active) continue;

      for (let i = 0; i < blockSize; i++) {
        if (v.age >= v.totalSamples) {
          v.active = false;
          break;
        }

        // 1. Shaped Envelope (Sinusoidal Attack + Smooth Exponential Decay)
        let env = 0.0;
        if (v.age < v.attackSamples) {
          const normAttack = v.age / v.attackSamples;
          env = Math.sin(normAttack * 0.5 * Math.PI);
        } else {
          const decayAge = v.age - v.attackSamples;
          const normDecay = decayAge / v.decaySamples;
          // Smooth asymptotic decay curve
          env = Math.exp(-normDecay * 4.2);
          
          const remaining = v.totalSamples - v.age;
          if (remaining < 64) {
            env *= (remaining / 64);
          }
        }

        // 2. Dynamic Filter Sweep over burst lifecycle
        const progress = v.age / v.totalSamples;
        const currentFreq = v.startFreq + (v.endFreq - v.startFreq) * Math.sin(progress * 0.5 * Math.PI);
        const svfF = 2.0 * Math.sin(Math.PI * currentFreq / this.sr);

        // 3. Generate noise & process through SVF
        const rawNoise = this._generateNoise(v);
        v.svfL = v.svfL + svfF * v.svfB;
        const svfH = rawNoise - v.svfL - v.svfQ * v.svfB;
        v.svfB = v.svfB + svfF * svfH;

        let filtered = 0.0;
        if (v.filterMode === 'band') {
          filtered = v.svfB;
        } else if (v.filterMode === 'high') {
          filtered = svfH;
        } else {
          filtered = v.svfL;
        }

        // 4. Sub-rumble cleanup filter (120Hz HPF)
        const hpfCoeff = 0.02;
        v.hpfStateL += (filtered - v.hpfStateL) * hpfCoeff;
        const voiceSample = (filtered - v.hpfStateL) * env * v.gain;

        outL[i] += voiceSample * v.panL;
        outR[i] += voiceSample * v.panR;

        v.age++;
      }
    }

    // Soft master limiter
    for (let i = 0; i < blockSize; i++) {
      outL[i] = Math.tanh(outL[i]);
      outR[i] = Math.tanh(outR[i]);
    }

    this.totalProcessedSamples += blockSize;
    return true;
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('com.aether.node.kinetic-glitch-pond', KineticGlitchPondDSP);
}
