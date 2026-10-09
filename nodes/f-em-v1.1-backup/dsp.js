/**
 * F* 'EM AudioWorklet DSP Engine
 * 3-Voice Algorithmic Drum Machine & Multiplexer
 * Voices: Kick, Snare, Hat
 */

class FEM_DSP extends (typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : Object) {
  constructor() {
    super();

    this.sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    this.bpm = 120.0;
    this.sampleCount = 0;
    this.stepIndex = 0;
    this.samplesPer16th = Math.floor((60.0 / this.bpm / 4.0) * this.sr);

    this.params = {
      evolution: 0.0,
      congestion: 0.50,
      space: 0.50,
      bpm: 120.0,
      character: 0.50,
      wtf: 0.00
    };

    // Filter states for master character & tone
    this.fltL = 0.0;
    this.fltR = 0.0;

    // 3 Voices State
    this.voices = {
      kick: { active: false, phase: 0, pitchEnv: 0, ampEnv: 0, velocity: 1.0, pitchScale: 1.0, timbre: 0.0 },
      snare: { active: false, phase: 0, noiseEnv: 0, toneEnv: 0, velocity: 1.0, pitchScale: 1.0, timbre: 0.0 },
      hat: { active: false, noiseEnv: 0, hpfState: 0, velocity: 1.0, timbre: 0.0 }
    };

    // Voice Volume Multipliers
    this.voiceVolumes = {
      kick: 0.8,
      snare: 0.8,
      hat: 0.8
    };

    // Ratchet state for 32nd note IDM hat bursts
    this.ratchetPending = false;
    this.ratchetCountdown = 0;

    if (this.port) {
      this.port.onmessage = (event) => {
        if (!event.data) return;
        const type = event.data.type;
        const id = event.data.paramId || event.data.id;
        const val = event.data.value;

        if (type === 'SET_VOICE_VOL' && event.data.voice && event.data.value !== undefined) {
          const vKey = event.data.voice;
          const vVal = typeof event.data.value === 'number' ? event.data.value : parseFloat(event.data.value);
          if (this.voiceVolumes[vKey] !== undefined) {
            this.voiceVolumes[vKey] = Math.max(0.0, Math.min(1.0, vVal));
          }
        }

        if (type === 'aether:bpm' || id === 'bpm' || id === 'tempo') {
          const newBpm = Number(val);
          if (newBpm >= 30 && newBpm <= 300) {
            this.bpm = newBpm;
            this.params.bpm = newBpm;
            this.samplesPer16th = Math.floor((60.0 / this.bpm / 4.0) * this.sr);
          }
        }

        if (id && this.params[id] !== undefined) {
          const numVal = typeof val === 'number' ? val : parseFloat(val);
          this.params[id] = numVal;
          if (id === 'bpm') {
            this.bpm = numVal;
            this.samplesPer16th = Math.floor((60.0 / this.bpm / 4.0) * this.sr);
          }
        }

        if (type === 'trigger_voice') {
          const voiceName = event.data.voice;
          const vel = event.data.velocity || 1.0;
          this.triggerVoice(voiceName, vel);
        }
      };
    }
  }

  triggerVoice(name, velocity = 1.0, pitchScale = 1.0, timbre = 0.0) {
    const v = this.voices[name];
    if (!v) return;
    v.active = true;
    v.velocity = velocity;
    v.pitchScale = pitchScale;
    v.timbre = timbre;

    if (name === 'kick') {
      v.phase = 0;
      v.pitchEnv = 1.0;
      v.ampEnv = 1.0;
    } else if (name === 'snare') {
      v.phase = 0;
      v.noiseEnv = 1.0;
      v.toneEnv = 1.0;
    } else if (name === 'hat') {
      v.noiseEnv = 1.0;
    }
  }

  advanceSequencerStep() {
    const evo = Math.max(0.0, Math.min(1.0, this.params.evolution));
    const congestion = Math.max(0.0, Math.min(1.0, this.params.congestion !== undefined ? this.params.congestion : 0.50));
    const character = Math.max(0.0, Math.min(1.0, this.params.character !== undefined ? this.params.character : 0.50));
    const wtfAmount = Math.max(0.0, Math.min(0.30, this.params.wtf !== undefined ? this.params.wtf : 0.00));

    const step = this.stepIndex % 16;
    const triggers = [];

    // Velocity Anti-Gravity Jitter helper
    const applyAntiGravity = (baseVelocity) => {
      const floatJitter = 0.9 + (Math.random() * 0.2); 
      return Math.max(0.0, Math.min(1.0, baseVelocity * floatJitter));
    };

    // Calculate base WTF jitter per step (-0.30 to +0.30 max)
    const wtfJitter = (Math.random() * 2 - 1) * wtfAmount;

    // Character Offset (-1.0 to +1.0)
    const characterOffset = (character - 0.5) * 2.0;

    // ==========================================
    // 1. BASE EVOLUTION TRIGGERS
    // ==========================================

    // --- Kick Logic ---
    let triggerKick = false;
    let kickGhost = false;

    if (evo > 0.45 && evo < 0.55) {
      // CENTER BREAKDOWN: Absolute silence
      triggerKick = false;
    } 
    else if (evo <= 0.45) {
      // LEFT HEMISPHERE: 4/4 -> Sparse
      if (step === 0) triggerKick = true; // Always downbeat
      
      // Beat 3 holds on longer than Beats 2 & 4
      if (step === 8 && evo < 0.35) triggerKick = true; 
      
      // Beats 2 & 4 exist only near 0.0 (Solid 4/4)
      if ((step === 4 || step === 12) && evo < 0.20) triggerKick = true;
      
      // The "Mutation": A quirky syncopated ghost hit right before it gets too sparse
      if (evo >= 0.15 && evo < 0.40 && step === 15) {
        if (Math.random() > 0.4) {
          triggerKick = true;
          kickGhost = true;
        }
      }
    } 
    else if (evo >= 0.55) {
      // RIGHT HEMISPHERE: Sparse -> Complex / IDM
      const rightEvo = (evo - 0.55) / 0.45; // Normalized 0.0 to 1.0
      
      if (step === 0) triggerKick = true; // Anchor downbeat
      
      // Sparse 2-step anchor (Beat 3.5)
      if (rightEvo < 0.5 && step === 10) triggerKick = true; 
      
      // Breakbeat odd syncopations kick in
      if (rightEvo >= 0.25 && step === 7) {
        if (Math.random() < rightEvo) triggerKick = true;
      }
      if (rightEvo >= 0.5 && step === 13) triggerKick = true;
      
      // Extreme IDM glitch / crazy hits at the far right
      if (rightEvo >= 0.7) {
        if ((step === 3 || step === 9 || step === 14) && Math.random() < (rightEvo * 0.75)) {
          triggerKick = true;
          kickGhost = true;
        }
      }
    }

    // --- Snare Logic ---
    let triggerSnare = false;
    let snareGhost = false;
    let snareVelocity = 0.0;

    if (evo > 0.45 && evo < 0.55) {
      // Breakdown: Sparse anchor
      if (step === 12) {
        triggerSnare = true;
        snareVelocity = applyAntiGravity(0.8);
      } 
    } 
    else if (evo <= 0.45) {
      // Left Side: 4/4 Backbeat
      if (step === 4 || step === 12) {
        triggerSnare = true;
        snareVelocity = applyAntiGravity(1.0);
      }
      
      if (evo > 0.25 && step === 14) {
        if (Math.random() > 0.5) {
          triggerSnare = true;
          snareGhost = true;
          snareVelocity = applyAntiGravity(0.4);
        }
      }
    } 
    else if (evo >= 0.55) {
      // Right Side: Half-time / Breakbeat / IDM
      const rightEvo = (evo - 0.55) / 0.45;
      
      if (step === 8) {
        triggerSnare = true; 
        snareVelocity = applyAntiGravity(1.0);
      }
      
      if (rightEvo >= 0.3 && step === 15) {
        triggerSnare = true;
        snareVelocity = applyAntiGravity(0.7);
      }
      
      if (rightEvo >= 0.7) {
        if ((step === 5 || step === 11) && Math.random() < rightEvo) {
          triggerSnare = true;
          snareGhost = true;
          const idmGhostVel = 0.6 - (rightEvo * 0.2); 
          snareVelocity = applyAntiGravity(idmGhostVel); 
        }
      }
    }

    // --- Hat Logic ---
    let triggerHat = false;
    let hatGhost = false;
    if (evo < 0.35) {
      const subEvo = evo / 0.35;
      if (step % 4 === 2) {
        triggerHat = true;
      } else if ((step % 2 === 1) && Math.random() < (subEvo * 0.4)) {
        triggerHat = true;
        hatGhost = true;
      }
    } else if (evo < 0.75) {
      triggerHat = true;
      hatGhost = (step % 2 !== 0);
    } else {
      triggerHat = true;
      hatGhost = (step % 2 !== 0);
      if ((step === 6 || step === 14) && Math.random() < 0.65) {
        this.ratchetPending = true;
        this.ratchetCountdown = Math.floor(this.samplesPer16th / 2);
      }
    }

    // ==========================================
    // 2. CONGESTION INTERCEPT LOGIC
    // ==========================================
    if (congestion === 0.0) {
      // Extreme left: Solo 4/4 Kick only
      triggerSnare = triggerHat = false;
      triggerKick = (step % 4 === 0); 
    } 
    else if (congestion < 0.5) {
      // Sparse territory: Randomly drop notes based on how far left it is
      const dropProb = (0.5 - congestion) * 2; // Scales 0.0 to 1.0
      if (Math.random() < dropProb) triggerKick = false;
      if (Math.random() < dropProb) triggerSnare = false;
      if (Math.random() < dropProb) triggerHat = false;
    } 
    else if (congestion > 0.5) {
      // Complex territory: Fill empty steps
      const fillProb = (congestion - 0.5); // Scales 0.0 to 0.5 max
      
      // Only fill if the voice isn't already triggered by Evolution
      if (!triggerHat && Math.random() < fillProb) {
        triggerHat = true;
        hatGhost = true;
      }
    }

    // ==========================================
    // 3. VOICE TRIGGER DISPATCH WITH WTF / CHARACTER / ANTI-GRAVITY
    // ==========================================

    if (triggerKick) {
      const baseVel = kickGhost ? 0.6 : 1.0;
      const kickVel = applyAntiGravity(baseVel);
      const kickPitchScale = 1.0 + wtfJitter;
      const kickTimbre = characterOffset + (wtfJitter * 0.5);
      this.triggerVoice('kick', kickVel, kickPitchScale, kickTimbre);
      triggers.push({ voice: 'kick', lane: 0, isGhost: kickGhost, vel: kickVel });
    }

    if (triggerSnare) {
      const baseVel = snareVelocity > 0 ? snareVelocity : (snareGhost ? 0.5 : 1.0);
      const sVel = applyAntiGravity(baseVel);
      const snarePitchScale = 1.0 + wtfJitter;
      const snareTimbre = characterOffset + (wtfJitter * 0.5);
      this.triggerVoice('snare', sVel, snarePitchScale, snareTimbre);
      triggers.push({ voice: 'snare', lane: 1, isGhost: snareGhost, vel: sVel });
    }

    if (triggerHat) {
      const baseVel = hatGhost ? 0.45 : 0.85;
      const hVel = applyAntiGravity(baseVel);
      const hatTimbre = characterOffset + wtfJitter;
      this.triggerVoice('hat', hVel, 1.0, hatTimbre);
      triggers.push({ voice: 'hat', lane: 2, isGhost: hatGhost, vel: hVel });
    }

    // Dispatch trigger payload
    if (this.port && triggers.length > 0) {
      this.port.postMessage({
        type: 'aether:voice-trigger',
        step: step,
        triggers: triggers,
        evolution: evo,
        bpm: this.bpm
      });
    }

    this.stepIndex++;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const blockSize = outL.length;

    const space = Math.max(0.05, Math.min(1.0, this.params.space));
    const character = Math.max(0.0, Math.min(1.0, this.params.character !== undefined ? this.params.character : 0.50));

    // Decay rate scalers adjusted by space parameter
    const kickDecay = Math.exp(-1.0 / (this.sr * (0.08 + space * 0.35)));
    const kickPitchDecay = Math.exp(-1.0 / (this.sr * 0.025));

    const snareNoiseDecay = Math.exp(-1.0 / (this.sr * (0.04 + space * 0.22)));
    const snareToneDecay = Math.exp(-1.0 / (this.sr * (0.02 + space * 0.08)));

    const hatDecay = Math.exp(-1.0 / (this.sr * (0.015 + space * 0.09)));

    // Character filter cutoff: 2.5kHz (dark) to 18kHz (bright)
    const cutoffHz = 2500.0 + (15500.0 * Math.pow(character, 1.4));
    const filterAlpha = Math.min(0.95, (2.0 * Math.PI * cutoffHz) / this.sr);

    for (let i = 0; i < blockSize; i++) {
      // Step Clock Tracker
      if (this.sampleCount % this.samplesPer16th === 0) {
        this.advanceSequencerStep();
      }
      this.sampleCount++;

      // Ratchet 32nd note trigger check
      if (this.ratchetPending) {
        this.ratchetCountdown--;
        if (this.ratchetCountdown <= 0) {
          this.ratchetPending = false;
          this.triggerVoice('hat', 0.6);
          if (this.port) {
            this.port.postMessage({
              type: 'aether:voice-trigger',
              step: this.stepIndex % 16,
              triggers: [{ voice: 'hat', lane: 2, isGhost: true, vel: 0.6 }],
              evolution: this.params.evolution,
              bpm: this.bpm
            });
          }
        }
      }

      let sampleL = 0.0;
      let sampleR = 0.0;

      const volKick = this.voiceVolumes.kick !== undefined ? this.voiceVolumes.kick : 0.8;
      const volSnare = this.voiceVolumes.snare !== undefined ? this.voiceVolumes.snare : 0.8;
      const volHat = this.voiceVolumes.hat !== undefined ? this.voiceVolumes.hat : 0.8;

      // 1. Kick Voice (Sine pitch sweep with dynamic pitchScale & timbre saturation)
      const vk = this.voices.kick;
      if (vk.active) {
        const curFreq = (48.0 + 95.0 * vk.pitchEnv) * (vk.pitchScale || 1.0);
        vk.phase += (curFreq * 2.0 * Math.PI) / this.sr;
        let kickOut = Math.sin(vk.phase) * vk.ampEnv * vk.velocity * volKick;
        if (vk.timbre > 0) {
          kickOut = Math.tanh(kickOut * (1.0 + vk.timbre * 1.5));
        }
        sampleL += kickOut * 0.9;
        sampleR += kickOut * 0.9;

        vk.pitchEnv *= kickPitchDecay;
        vk.ampEnv *= kickDecay;
        if (vk.ampEnv < 0.0005) vk.active = false;
      }

      // 2. Snare Voice (Tuned body + filtered noise burst)
      const vs = this.voices.snare;
      if (vs.active) {
        const snareFreq = 165.0 * (vs.pitchScale || 1.0);
        vs.phase += (snareFreq * 2.0 * Math.PI) / this.sr;
        const noise = (Math.random() * 2.0 - 1.0) * vs.noiseEnv;
        const tone = Math.sin(vs.phase) * vs.toneEnv * 0.6;
        const snareOut = (noise * 0.7 + tone * 0.5) * vs.velocity * volSnare;
        sampleL += snareOut * 0.75;
        sampleR += snareOut * 0.65;

        vs.noiseEnv *= snareNoiseDecay;
        vs.toneEnv *= snareToneDecay;
        if (vs.noiseEnv < 0.0005 && vs.toneEnv < 0.0005) vs.active = false;
      }

      // 3. Hat Voice (Highpass filtered crisp noise)
      const vh = this.voices.hat;
      if (vh.active) {
        const rawNoise = Math.random() * 2.0 - 1.0;
        const hpfCoeff = Math.min(0.85, 0.45 + (vh.timbre || 0.0) * 0.2);
        vh.hpfState += (rawNoise - vh.hpfState) * hpfCoeff;
        const hatOut = (rawNoise - vh.hpfState) * vh.noiseEnv * vh.velocity * volHat * 0.45;
        sampleL += hatOut * 0.55;
        sampleR += hatOut * 0.75;

        vh.noiseEnv *= hatDecay;
        if (vh.noiseEnv < 0.0005) vh.active = false;
      }

      // Master tone low-pass filter (Character control)
      this.fltL += (sampleL - this.fltL) * filterAlpha;
      this.fltR += (sampleR - this.fltR) * filterAlpha;

      // Soft saturation clip
      outL[i] = Math.tanh(this.fltL * 1.15);
      outR[i] = Math.tanh(this.fltR * 1.15);
    }

    return true;
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('com.aether.node.f-em', FEM_DSP);
}
