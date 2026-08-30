// Icecast PCM ring — audio-thread playback so canvas XY cannot underrun.
class IcecastPcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null;
    this.R = null;
    this.cap = 0;
    this.w = 0;
    this.r = 0;
    this.n = 0;
    this.paused = false;
    this.primed = false;
    this.primeNeed = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'setup') {
        this.cap = d.cap | 0;
        this.L = new Float32Array(this.cap);
        this.R = new Float32Array(this.cap);
        this.w = 0;
        this.r = 0;
        this.n = 0;
        this.primed = false;
        this.paused = !!d.paused;
        this.primeNeed = d.prime | 0;
      } else if (d.type === 'pcm') {
        const l = d.l;
        const rr = d.r;
        if (!this.L || !l) return;
        const len = l.length;
        for (let i = 0; i < len; i++) {
          if (this.n >= this.cap - 8) {
            this.r = (this.r + 1) % this.cap;
            this.n--;
          }
          this.L[this.w] = l[i] || 0;
          this.R[this.w] = (rr && rr[i]) || 0;
          this.w = (this.w + 1) % this.cap;
          this.n++;
        }
        if (!this.primed && this.n >= this.primeNeed) this.primed = true;
      } else if (d.type === 'pause') {
        this.paused = true;
      } else if (d.type === 'resume') {
        this.paused = false;
        const keep = d.keep | 0;
        if (this.L && keep >= 0 && this.n > keep) {
          const drop = this.n - keep;
          this.r = (this.r + drop) % this.cap;
          this.n = keep;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const o = outputs[0];
    if (!o || !o[0]) return true;
    const outL = o[0];
    const outR = o[1] || outL;
    const frames = outL.length;
    if (this.paused || !this.primed || !this.L) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      return true;
    }
    for (let i = 0; i < frames; i++) {
      if (this.n <= 0) {
        outL[i] = 0;
        outR[i] = 0;
        continue;
      }
      outL[i] = this.L[this.r];
      outR[i] = this.R[this.r];
      this.r = (this.r + 1) % this.cap;
      this.n--;
    }
    return true;
  }
}

registerProcessor('icecast-pcm-worklet', IcecastPcmWorklet);
