const wa = require('node-web-audio-api');
globalThis.AudioWorkletNode = wa.AudioWorkletNode;
const SR = 44100;
async function renderOnce(seconds, setup, actions) {
  const ctx = new wa.OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const node = await setup(ctx);
  let failed = false;
  for (const [t, fn] of actions) {
    const q = Math.round(t * SR / 128) * 128 / SR;
    ctx.suspend(q).then(async () => { await fn(node, ctx); await new Promise(r => setTimeout(r, 30)); ctx.resume(); })
      .catch((e) => { failed = true; if (process.env.DBG) console.log("action", t, e && e.stack); });
  }
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), node, failed };
}
async function render(seconds, setup, actions = []) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const r = await renderOnce(seconds, setup, actions);
    if (!r.failed) return r;
  }
  throw new Error('offline suspend kept failing (test harness)');
}
function rms(a, t0, t1) { const i0 = Math.floor(t0 * SR), i1 = Math.min(a.length, Math.floor(t1 * SR)); let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); }
function peak(a, t0, t1) { const i0 = Math.floor(t0 * SR), i1 = Math.min(a.length, Math.floor(t1 * SR)); let m = 0; for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(a[i])); return m; }
let pass = 0, fail = 0;
function check(name, ok, info = '') { if (ok) { pass++; console.log('  ok   ', name, info); } else { fail++; console.log('  FAIL ', name, info); } }
function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
module.exports = { wa, SR, render, rms, peak, check, done };
