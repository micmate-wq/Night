/**
 * Aether Starter Sine Generator DSP
 * Implements standard .aethernode DSP lifecycle hooks
 */

let audioCtx = null;
let oscNode = null;
let gainNode = null;
let isMuted = false;
let currentVolume = 0.25;

export function init(ctx, options = {}) {
  audioCtx = ctx;

  // Create Web Audio nodes
  oscNode = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();

  oscNode.type = 'sine';
  
  // Apply initial options or defaults
  const initialFreq = options.params?.frequency ?? 440;
  currentVolume = options.params?.volume ?? 0.25;
  isMuted = options.params?.active === false;

  const now = audioCtx.currentTime;
  oscNode.frequency.setValueAtTime(initialFreq, now);
  gainNode.gain.setValueAtTime(isMuted ? 0 : currentVolume, now);

  // Connect internal graph
  oscNode.connect(gainNode);

  // Start generator
  try {
    oscNode.start();
  } catch (err) {
    console.warn('[Sine DSP] Oscillator start error:', err);
  }

  // Return connection endpoints
  return {
    input: null,
    output: gainNode
  };
}

export function updateParams(key, value) {
  if (!audioCtx || !oscNode || !gainNode) return;

  const now = audioCtx.currentTime;
  const timeConstant = 0.03; // 30ms smooth exponential ramp to avoid clicks

  switch (key) {
    case 'frequency': {
      const freq = Math.max(20, Math.min(20000, Number(value)));
      oscNode.frequency.setTargetAtTime(freq, now, timeConstant);
      break;
    }
    case 'volume': {
      currentVolume = Math.max(0, Math.min(1, Number(value)));
      if (!isMuted) {
        gainNode.gain.setTargetAtTime(currentVolume, now, timeConstant);
      }
      break;
    }
    case 'active': {
      isMuted = !value;
      const targetGain = isMuted ? 0 : currentVolume;
      gainNode.gain.setTargetAtTime(targetGain, now, timeConstant);
      break;
    }
  }
}

export function destroy() {
  if (oscNode) {
    try {
      oscNode.stop();
      oscNode.disconnect();
    } catch (_) {}
    oscNode = null;
  }

  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch (_) {}
    gainNode = null;
  }

  audioCtx = null;
}
