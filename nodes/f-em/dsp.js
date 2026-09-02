/**
 * F* 'EM AudioWorklet DSP Engine (Optimized High-Performance Refactor)
 * 3-Voice Algorithmic Drum Machine & Multiplexer with Macro Shapers
 * Voices: Kick, Snare, Hat
 */

const TWO_PI = 6.283185307179586;

class FEM_DSP extends (typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : Object) {
  constructor() {
    super();

    this.sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    this.twoPiOverSr = TWO_PI / this.sr; // CPU OPTIMIZATION: Pre-calculated constant for phase increments
    this.bpm = 120.0;
    this.sampleCount = 0;
    this.stepIndex = 0;
    this.samplesPer16th = Math.floor((15.0 / this.bpm) * this.sr);

    this.params = {
      macro_kick: 0.50,
      macro_snare: 0.50,
      macro_hat: 0.50,
      evolution: 0.0,
      congestion: 0.50,
      space: 0.50,
      bpm: 120.0,
      character: 0.50,
      wtf: 0.00
    };

    // Filter states for Master Bus Tilt EQ
    this.tiltLpL = 0.0;
    this.tiltLpR = 0.0;

    // CPU OPTIMIZATION: Dedicated 3-voice fixed state objects (no dead perc1/perc2 memory)
    this.voices = {
      kick: { active: false, phase: 0, phaseFM: 0, pitchEnv: 0, ampEnv: 0, velocity: 1.0, pitchScale: 1.0, timbre: 0.0 },
      snare: { active: false, phase: 0, noiseEnv: 0, toneEnv: 0, velocity: 1.0, pitchScale: 1.0, timbre: 0.0 },
      hat: { active: false, noiseEnv: 0, hpfState: 0, velocity: 1.0, timbre: 0.0 }
    };

    // Voice Volume Multipliers
    this.voiceVolumes = {
      kick: 0.8,
      snare: 0.8,
      hat: 0.8
    };

    // Ratchet sub-step roll state
    this.ratchetRemaining = 0;
    this.ratchetInterval = 0;
    this.ratchetTimer = 0;

    // Snare Echo lookahead queue for delay throw
    this.snareEchoQueue = [];

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
            this.samplesPer16th = Math.floor((15.0 / this.bpm) * this.sr);
          }
        }

        if (id && this.params[id] !== undefined) {
          const numVal = typeof val === 'number' ? val : parseFloat(val);
          this.params[id] = numVal;
          if (id === 'bpm') {
            this.bpm = numVal;
            this.samplesPer16th = Math.floor((15.0 / this.bpm) * this.sr);
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
      v.phaseFM = 0;
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

  // CPU OPTIMIZATION: Inlined anti-gravity velocity jitter helper
  applyAntiGravity(baseVelocity) {
    const floatJitter = 0.9 + (Math.random() * 0.2); 
    return Math.max(0.0, Math.min(1.0, baseVelocity * floatJitter));
  }

  advanceSequencerStep() {
    const evo = this.params.evolution;
    const congestion = this.params.congestion;
    const character = this.params.character;
    const wtfAmount = this.params.wtf;

    const totalSteps = this.stepIndex;
    const step = totalSteps % 16;
    const triggers = [];

    // Calculate base WTF jitter per step (-0.30 to +0.30 max)
    const wtfJitter = (Math.random() * 2 - 1) * wtfAmount;
    const characterOffset = (character - 0.5) * 2.0;

    let triggerKick = false;
    let kickGhost = false;

    let triggerSnare = false;
    let snareGhost = false;
    let snareVelocity = 0.0;

    let triggerHat = false;
    let hatGhost = false;

    let hatRatchets = 1;
    const isFillBar = (totalSteps % 256) >= 240;

    // CPU OPTIMIZATION: Non-allocating in-place echo queue retrieval & sweep
    let scheduledEchoVel = 0.0;
    let writeIdx = 0;
    for (let j = 0; j < this.snareEchoQueue.length; j++) {
      const echo = this.snareEchoQueue[j];
      if (echo.targetStepIndex === totalSteps) {
        if (echo.vel > scheduledEchoVel) scheduledEchoVel = echo.vel;
      } else if (echo.targetStepIndex > totalSteps) {
        this.snareEchoQueue[writeIdx++] = echo;
      }
    }
    this.snareEchoQueue.length = writeIdx;

    // ==========================================
    // 16-BAR HIJACK FILL OR EVOLUTION SEQUENCING
    // ==========================================
    if (isFillBar && Math.random() < (wtfAmount * 4.0)) {
      triggerKick = (step % 2 === 0 || step % 3 === 0); 
      triggerSnare = (step % 4 !== 0 && Math.random() > 0.5); 
      triggerHat = true; 
      hatRatchets = Math.random() > 0.5 ? 3 : 2; 
    } else {
      // --- 1. Kick Evolution Logic ---
      if (evo <= 0.45) {
        // Left Hemisphere: 4/4 -> Sparse
        if (step === 0) {
          triggerKick = true;
        } else if (step === 8 && evo < 0.35) {
          triggerKick = true;
        } else if ((step === 4 || step === 12) && evo < 0.20) {
          triggerKick = true;
        } else if (evo >= 0.15 && evo < 0.40 && step === 15) {
          if (Math.random() > 0.4) {
            triggerKick = true;
            kickGhost = true;
          }
        }
      } else if (evo >= 0.55) {
        // Right Hemisphere: Sparse -> IDM Glitch
        const rightEvo = (evo - 0.55) * 2.222222; // Normalized (0.0 to 1.0)
        if (step === 0) {
          triggerKick = true;
        } else if (rightEvo < 0.5 && step === 10) {
          triggerKick = true;
        } else if (rightEvo >= 0.25 && step === 7 && Math.random() < rightEvo) {
          triggerKick = true;
        } else if (rightEvo >= 0.5 && step === 13) {
          triggerKick = true;
        } else if (rightEvo >= 0.7 && (step === 3 || step === 9 || step === 14) && Math.random() < (rightEvo * 0.75)) {
          triggerKick = true;
          kickGhost = true;
        }
      }

      // --- 2. Snare Evolution Logic ---
      if (evo > 0.45 && evo < 0.55) {
        if (step === 12) {
          triggerSnare = true;
          snareVelocity = this.applyAntiGravity(0.8);
        }
      } else if (evo <= 0.45) {
        if (step === 4 || step === 12) {
          triggerSnare = true;
          snareVelocity = this.applyAntiGravity(1.0);
        } else if (evo > 0.25 && step === 14 && Math.random() > 0.5) {
          triggerSnare = true;
          snareGhost = true;
          snareVelocity = this.applyAntiGravity(0.4);
        }
      } else {
        const rightEvo = (evo - 0.55) * 2.222222;
        if (step === 8) {
          triggerSnare = true;
          snareVelocity = this.applyAntiGravity(1.0);
        } else if (rightEvo >= 0.3 && step === 15) {
          triggerSnare = true;
          snareVelocity = this.applyAntiGravity(0.7);
        } else if (rightEvo >= 0.7 && (step === 5 || step === 11) && Math.random() < rightEvo) {
          triggerSnare = true;
          snareGhost = true;
          snareVelocity = this.applyAntiGravity(0.6 - (rightEvo * 0.2));
        }
      }

      // --- 3. Hat Evolution Logic ---
      if (evo < 0.35) {
        const subEvo = evo * 2.85714;
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
          hatRatchets = 2;
        }
      }

      // --- Apply Scheduled Echoes ---
      if (scheduledEchoVel > 0.0) {
        triggerSnare = true;
        snareGhost = true;
        snareVelocity = scheduledEchoVel;
      }

      // --- Congestion Intercept Logic ---
      if (congestion === 0.0) {
        triggerSnare = triggerHat = false;
        triggerKick = (step % 4 === 0);
      } else if (congestion < 0.5) {
        const dropProb = (0.5 - congestion) * 2.0;
        if (Math.random() < dropProb) triggerKick = false;
        if (Math.random() < dropProb) triggerSnare = false;
        if (Math.random() < dropProb) triggerHat = false;
      } else if (congestion > 0.5) {
        const fillProb = (congestion - 0.5);
        if (!triggerHat && Math.random() < fillProb) {
          triggerHat = true;
          hatGhost = true;
        }
      }

      // --- Post-Logic WTF Modifiers ---
      if (triggerHat && Math.random() < (wtfAmount * 3.0)) {
        hatRatchets = Math.floor(Math.random() * 3) + 2; 
      }
      
      if (triggerSnare && Math.random() < (wtfAmount * 2.0)) {
        this.snareEchoQueue.push({ targetStepIndex: totalSteps + 3, vel: this.applyAntiGravity(0.5) });
        this.snareEchoQueue.push({ targetStepIndex: totalSteps + 6, vel: this.applyAntiGravity(0.2) });
      }
    }

    // Set up sub-step ratchet roll timer
    if (hatRatchets > 1) {
      this.ratchetRemaining = hatRatchets - 1;
      this.ratchetInterval = Math.floor(this.samplesPer16th / hatRatchets);
      this.ratchetTimer = this.ratchetInterval;
    } else {
      this.ratchetRemaining = 0;
    }

    // ==========================================
    // VOICE TRIGGER DISPATCH
    // ==========================================
    if (triggerKick) {
      const baseVel = kickGhost ? 0.6 : 1.0;
      const kickVel = this.applyAntiGravity(baseVel);
      const kickPitchScale = 1.0 + wtfJitter;
      const kickTimbre = characterOffset + (wtfJitter * 0.5);
      this.triggerVoice('kick', kickVel, kickPitchScale, kickTimbre);
      triggers.push({ voice: 'kick', lane: 0, isGhost: kickGhost, vel: kickVel });
    }

    if (triggerSnare) {
      const baseVel = snareVelocity > 0 ? snareVelocity : (snareGhost ? 0.5 : 1.0);
      const sVel = this.applyAntiGravity(baseVel);
      const snarePitchScale = 1.0 + wtfJitter;
      const snareTimbre = characterOffset + (wtfJitter * 0.5);
      this.triggerVoice('snare', sVel, snarePitchScale, snareTimbre);
      triggers.push({ voice: 'snare', lane: 1, isGhost: snareGhost, vel: sVel });
    }

    if (triggerHat) {
      const baseVel = hatGhost ? 0.45 : 0.85;
      const hVel = this.applyAntiGravity(baseVel);
      const hatTimbre = characterOffset + wtfJitter;
      this.triggerVoice('hat', hVel, 1.0, hatTimbre);
      triggers.push({ voice: 'hat', lane: 2, isGhost: hatGhost, vel: hVel });
    }

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

    // =========================================================================
    // BLOCK-RATE PARAMETER SEGREGATION (CPU OPTIMIZATION)
    // All math, envelope rates, macro scalers, and filter gains computed here.
    // =========================================================================
    const space = this.params.space;
    const character = this.params.character;
    const mKick = this.params.macro_kick;
    const mSnare = this.params.macro_snare;
    const mHat = this.params.macro_hat;

    // 1. Kick Macro Shaping
    let kickBasePitchScale = 1.0;
    let kickWavefoldDrive = 1.0;
    let kickAmpDecayScale = 1.0;
    let kickPitchDecayScale = 1.0;
    let kickFmIndex = 0.0;

    if (mKick < 0.499) {
      const mkLeft = (0.5 - mKick) * 2.0;
      kickBasePitchScale = 1.0 - (mkLeft * 0.35);
      kickWavefoldDrive = 1.0 + (mkLeft * 4.0);
      kickAmpDecayScale = 1.0 - (mkLeft * 0.45);
    } else if (mKick > 0.501) {
      const mkRight = (mKick - 0.5) * 2.0;
      kickFmIndex = mkRight * 3.5;
      kickAmpDecayScale = 1.0 + (mkRight * 1.5);
      kickPitchDecayScale = 1.0 + (mkRight * 1.8);
    }

    // 2. Snare Macro Shaping
    let snareToneAmp = 0.5;
    let snareNoiseAmp = 0.7;
    let snareToneDecayScale = 1.0;
    let snareNoiseDecayScale = 1.0;

    if (mSnare < 0.499) {
      const msLeft = (0.5 - mSnare) * 2.0;
      snareToneAmp = 0.5 + (msLeft * 0.9);
      snareToneDecayScale = 1.0 + (msLeft * 1.4);
      snareNoiseAmp = 0.7 * (1.0 - msLeft * 0.7);
    } else if (mSnare > 0.501) {
      const msRight = (mSnare - 0.5) * 2.0;
      snareNoiseDecayScale = 1.0 + (msRight * 1.6);
    }

    // 3. Hat Macro Shaping
    let hatNoiseFreqScale = 1.0;
    let hatDecayScale = 1.0;
    let hatHpfCoeff = 0.45;

    if (mHat < 0.499) {
      const mhLeft = (0.5 - mHat) * 2.0;
      hatNoiseFreqScale = 1.0 - (mhLeft * 0.55);
      hatHpfCoeff = 0.45 * (1.0 - mhLeft * 0.65);
      hatDecayScale = 1.0 - (mhLeft * 0.60);
    } else if (mHat > 0.501) {
      const mhRight = (mHat - 0.5) * 2.0;
      hatDecayScale = 1.0 + (mhRight * 1.8);
      hatHpfCoeff = 0.45 + (mhRight * 0.48);
    }

    // Envelope Decay Rates (Pre-computed exp rates for block)
    const kickDecay = Math.exp(-1.0 / (this.sr * (0.08 + space * 0.35) * kickAmpDecayScale));
    const kickPitchDecay = Math.exp(-1.0 / (this.sr * 0.025 * kickPitchDecayScale));
    const snareNoiseDecay = Math.exp(-1.0 / (this.sr * (0.04 + space * 0.22) * snareNoiseDecayScale));
    const snareToneDecay = Math.exp(-1.0 / (this.sr * (0.02 + space * 0.08) * snareToneDecayScale));
    const hatDecay = Math.exp(-1.0 / (this.sr * (0.015 + space * 0.09) * hatDecayScale));

    // Master Tilt EQ (Pivot ~650Hz)
    const tiltCutoffHz = 650.0;
    const tiltAlpha = Math.min(0.95, (TWO_PI * tiltCutoffHz) / this.sr);

    let lowGain = 1.0;
    let highGain = 1.0;

    if (character < 0.499) {
      const darkAmount = (0.5 - character) * 2.0;
      lowGain = 1.0 + (darkAmount * 0.85);
      highGain = 1.0 - (darkAmount * 0.55);
    } else if (character > 0.501) {
      const brightAmount = (character - 0.5) * 2.0;
      lowGain = 1.0 - (brightAmount * 0.45);
      highGain = 1.0 + (brightAmount * 0.90);
    }

    // Musical Tape Glue Saturation (0.75 to 1.0)
    const isGlueActive = character > 0.75;
    const glueNorm = isGlueActive ? ((character - 0.75) * 4.0) : 0.0;
    const glueInputGain = 1.0 + (glueNorm * 0.50);
    const glueMakeup = 0.88 / (1.0 + glueNorm * 0.12);

    // Pre-scaled Volume Multipliers (CPU OPTIMIZATION)
    const volKickStereo = this.voiceVolumes.kick * 0.9;
    const volSnareL = this.voiceVolumes.snare * 0.75;
    const volSnareR = this.voiceVolumes.snare * 0.65;
    const volHatL = this.voiceVolumes.hat * 0.2475; // 0.45 * 0.55
    const volHatR = this.voiceVolumes.hat * 0.3375; // 0.45 * 0.75

    // References to voice objects for fast field access
    const vk = this.voices.kick;
    const vs = this.voices.snare;
    const vh = this.voices.hat;

    const kickFreqScale = (vk.pitchScale || 1.0) * kickBasePitchScale * this.twoPiOverSr;
    const snarePhaseInc = 165.0 * (vs.pitchScale || 1.0) * this.twoPiOverSr;
    const effHatHpf = Math.min(0.96, hatHpfCoeff + (vh.timbre || 0.0) * 0.15);

    // =========================================================================
    // PER-SAMPLE AUDIO SYNTHESIS & PROCESSING LOOP
    // =========================================================================
    for (let i = 0; i < blockSize; i++) {
      if (this.sampleCount % this.samplesPer16th === 0) {
        this.advanceSequencerStep();
      }
      this.sampleCount++;

      // Ratchet sub-step roll trigger check
      if (this.ratchetRemaining > 0) {
        this.ratchetTimer--;
        if (this.ratchetTimer <= 0) {
          this.ratchetRemaining--;
          this.ratchetTimer = this.ratchetInterval;
          this.triggerVoice('hat', 0.55);
          if (this.port) {
            this.port.postMessage({
              type: 'aether:voice-trigger',
              step: this.stepIndex % 16,
              triggers: [{ voice: 'hat', lane: 2, isGhost: true, vel: 0.55 }],
              evolution: this.params.evolution,
              bpm: this.bpm
            });
          }
        }
      }

      let sampleL = 0.0;
      let sampleR = 0.0;

      // 1. Kick Voice (FM + Wavefolding)
      if (vk.active) {
        const curFreq = 48.0 + 95.0 * vk.pitchEnv;
        vk.phase += curFreq * kickFreqScale;
        
        let kickOsc = Math.sin(vk.phase);
        if (kickFmIndex > 0) {
          vk.phaseFM += curFreq * 1.5 * kickFreqScale;
          kickOsc = Math.sin(vk.phase + Math.sin(vk.phaseFM) * kickFmIndex * vk.pitchEnv);
        }

        let kickOut = kickOsc * vk.ampEnv * vk.velocity * volKickStereo;
        if (kickWavefoldDrive > 1.0 || vk.timbre > 0) {
          const drive = kickWavefoldDrive + (vk.timbre > 0 ? vk.timbre * 1.5 : 0.0);
          kickOut = Math.tanh(kickOut * drive);
        }
        sampleL += kickOut;
        sampleR += kickOut;

        vk.pitchEnv *= kickPitchDecay;
        vk.ampEnv *= kickDecay;
        if (vk.ampEnv < 0.0005) vk.active = false;
      }

      // 2. Snare Voice (Dual-Tone body + filtered noise)
      if (vs.active) {
        vs.phase += snarePhaseInc;
        const rawNoise = (Math.random() * 2.0 - 1.0);
        const tone = Math.sin(vs.phase) * vs.toneEnv * snareToneAmp;
        const noise = rawNoise * vs.noiseEnv * snareNoiseAmp;
        const totalSnare = (noise + tone) * vs.velocity;
        
        sampleL += totalSnare * volSnareL;
        sampleR += totalSnare * volSnareR;

        vs.noiseEnv *= snareNoiseDecay;
        vs.toneEnv *= snareToneDecay;
        if (vs.noiseEnv < 0.0005 && vs.toneEnv < 0.0005) vs.active = false;
      }

      // 3. Hat Voice (Highpass filtered noise)
      if (vh.active) {
        const rawNoise = (Math.random() * 2.0 - 1.0) * hatNoiseFreqScale;
        vh.hpfState += (rawNoise - vh.hpfState) * effHatHpf;
        const hatOut = (rawNoise - vh.hpfState) * vh.noiseEnv * vh.velocity;
        
        sampleL += hatOut * volHatL;
        sampleR += hatOut * volHatR;

        vh.noiseEnv *= hatDecay;
        if (vh.noiseEnv < 0.0005) vh.active = false;
      }

      // Master Tilt EQ Processing (1-Pole filter network)
      this.tiltLpL += (sampleL - this.tiltLpL) * tiltAlpha;
      this.tiltLpR += (sampleR - this.tiltLpR) * tiltAlpha;

      const tiltL = (this.tiltLpL * lowGain) + ((sampleL - this.tiltLpL) * highGain);
      const tiltR = (this.tiltLpR * lowGain) + ((sampleR - this.tiltLpR) * highGain);

      // Musical Glue Saturation or Safe Output Limit (< -1dBFS)
      if (isGlueActive) {
        outL[i] = Math.tanh(tiltL * glueInputGain) * glueMakeup;
        outR[i] = Math.tanh(tiltR * glueInputGain) * glueMakeup;
      } else {
        outL[i] = Math.max(-0.88, Math.min(0.88, tiltL * 0.95));
        outR[i] = Math.max(-0.88, Math.min(0.88, tiltR * 0.95));
      }
    }

    return true;
  }
}

if (typeof registerProcessor !== 'undefined') {
  registerProcessor('com.aether.node.f-em', FEM_DSP);
}
