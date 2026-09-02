// Icecast outbound capture — audio-thread ring buffer tap.
// Separate from inbound icecast-pcm-worklet (playback). Do not mix them.
class IcecastCaptureWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 16384;
    this.L = new Float32Array(this.cap);
    this.R = new Float32Array(this.cap);
    this.w = 0;
    this.r = 0;
    this.n = 0;
    this.enabled = false;
    this.batch = 4096;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'start') {
        this.enabled = true;
        this.batch = (d.batch | 0) || 4096;
        this.w = 0;
        this.r = 0;
        this.n = 0;
      } else if (d.type === 'stop') {
        this.enabled = false;
        this.n = 0;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (out && out[0]) out[0].fill(0);
    if (out && out[1]) out[1].fill(0);

    if (!this.enabled) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const lIn = input[0];
    const rIn = input[1] || lIn;
    const frames = lIn.length;
    for (let i = 0; i < frames; i++) {
      if (this.n >= this.cap - 1) {
        this.r = (this.r + 1) % this.cap;
        this.n--;
      }
      this.L[this.w] = lIn[i] || 0;
      this.R[this.w] = rIn[i] || 0;
      this.w = (this.w + 1) % this.cap;
      this.n++;
    }
    while (this.n >= this.batch) {
      const l = new Float32Array(this.batch);
      const r = new Float32Array(this.batch);
      for (let i = 0; i < this.batch; i++) {
        l[i] = this.L[this.r];
        r[i] = this.R[this.r];
        this.r = (this.r + 1) % this.cap;
      }
      this.n -= this.batch;
      this.port.postMessage({ type: 'pcm', l, r }, [l.buffer, r.buffer]);
    }
    return true;
  }
}

registerProcessor('icecast-capture-worklet', IcecastCaptureWorklet);
