/**
 * Sticky Pad v0 — near-silent pad. Priority is the canvas sticky face.
 * Always Aether.
 */
class StickyPadDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.osc = null;
    this.filter = null;
    this.voiceGain = null;
    this.isRunning = false;
    this.params = { level: 0.08, tone: 0.45 };
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    this.outputNode = this.ctx.createGain();
    this.outputNode.gain.setValueAtTime(1, this.ctx.currentTime);

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.setValueAtTime(420, this.ctx.currentTime);
    this.filter.Q.setValueAtTime(0.4, this.ctx.currentTime);

    this.voiceGain = this.ctx.createGain();
    this.voiceGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

    this.filter.connect(this.voiceGain);
    this.voiceGain.connect(this.outputNode);

    this._applyTone();
    this.start();
    return this.outputNode;
  }

  _applyTone() {
    if (!this.filter || !this.ctx) return;
    const t = Math.max(0, Math.min(1, Number(this.params.tone) || 0));
    const hz = 180 + t * 900;
    this.filter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.05);
  }

  _applyLevel() {
    if (!this.voiceGain || !this.ctx) return;
    const lvl = Math.max(0, Math.min(1, Number(this.params.level) || 0));
    // Keep it a whisper — face canary, not a synth demo.
    const g = 0.0001 + lvl * 0.045;
    this.voiceGain.gain.setTargetAtTime(this.isRunning ? g : 0.0001, this.ctx.currentTime, 0.04);
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'tone') this._applyTone();
    if (paramId === 'level') this._applyLevel();
  }

  connect(dest) {
    if (this.outputNode && dest) this.outputNode.connect(dest);
  }

  disconnect() {
    if (this.outputNode) this.outputNode.disconnect();
  }

  start() {
    if (!this.ctx) return;
    if (this.isRunning) {
      this._applyLevel();
      return;
    }
    this.isRunning = true;
    try {
      if (this.osc) {
        try { this.osc.stop(); } catch (e) {}
        try { this.osc.disconnect(); } catch (e) {}
      }
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sine';
      this.osc.frequency.setValueAtTime(110, this.ctx.currentTime);
      this.osc.connect(this.filter);
      this.osc.start();
    } catch (e) {}
    this._applyTone();
    this._applyLevel();
  }

  stop() {
    this.isRunning = false;
    if (this.voiceGain && this.ctx) {
      this.voiceGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
    }
    if (this.osc) {
      try { this.osc.stop(); } catch (e) {}
      try { this.osc.disconnect(); } catch (e) {}
      this.osc = null;
    }
  }

  dispose() {
    this.stop();
    try { this.filter && this.filter.disconnect(); } catch (e) {}
    try { this.voiceGain && this.voiceGain.disconnect(); } catch (e) {}
    try { this.outputNode && this.outputNode.disconnect(); } catch (e) {}
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = StickyPadDSP;
