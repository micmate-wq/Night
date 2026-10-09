// Spatializer worklet: renders an impulse through the real worklet file.
const { wa, check, done } = require('./harness');
const SR = 48000;
async function impulse(params) {
  const ctx = new wa.OfflineAudioContext(2, SR, SR);
  await ctx.audioWorklet.addModule(__dirname + '/../../desktop/spatializer-worklet.js');
  const node = new wa.AudioWorkletNode(ctx, 'spatializer-worklet', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  for (const k in params) node.parameters.get(k).value = params[k];
  const b = ctx.createBuffer(2, SR, SR); b.getChannelData(0)[0] = 1; b.getChannelData(1)[0] = 1;
  const s = ctx.createBufferSource(); s.buffer = b; s.connect(node); node.connect(ctx.destination); s.start(0);
  node.port.postMessage({ type: 'load-wasm', wasmBytes: new ArrayBuffer(8) });   // host still sends this
  const out = await ctx.startRendering();
  const first = a => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > 0.05) return { ms: i / 48, v: Math.abs(a[i]) }; return null; };
  const late = a => { let m = 0; for (let i = Math.floor(0.2 * SR); i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
  return { L: out.getChannelData(0), R: out.getChannelData(1), first, late };
}
(async () => {
  console.log('Spatializer worklet');
  let r = await impulse({ x: 0.5, z: 0, intensity: 0 });
  check('intensity 0 = clean pass-through', r.first(r.L).ms === 0 && Math.abs(r.first(r.L).v - 1) < 1e-6);
  r = await impulse({ x: 0.5, z: 20, intensity: 1 });
  let f = r.first(r.L);
  check('centre node: direct sound on time (not 1 s late)', f && f.ms < 0.1, f && `${f.ms} ms, ${f.v.toFixed(2)}`);
  check('nothing arrives after 200 ms (no 1 s echo)', r.late(r.L) < 0.01 && r.late(r.R) < 0.01, r.late(r.L).toExponential(1));
  r = await impulse({ x: 0.9, z: 10, intensity: 1 });
  const fL = r.first(r.L), fR = r.first(r.R);
  check('panned right: right (near) ear on time', fR && fR.ms < 0.1, fR && `${fR.ms} ms`);
  check('panned right: left (far) ear delayed ~16 ms (Haas)', fL && Math.abs(fL.ms - 16) < 0.5, fL && `${fL.ms} ms`);
  check('panned right: no 1 s echo', r.late(r.L) < 0.01 && r.late(r.R) < 0.01);
  // early reflections present and later when far
  const er = (a, t0, t1) => { let m = 0; for (let i = Math.floor(t0 * 48); i < t1 * 48; i++) m = Math.max(m, Math.abs(a[i])); return m; };
  const near = await impulse({ x: 0.5, z: 0, intensity: 1 }), far = await impulse({ x: 0.5, z: 50, intensity: 1 });
  check('early reflections near (~15-45 ms)', er(near.L, 14, 45) > 0.005, er(near.L, 14, 45).toFixed(4));
  check('far: reflections move later (first tap ~25 ms)', er(far.L, 14, 22) < er(near.L, 14, 22) && er(far.L, 24, 80) > 0.003);
  done();
})().catch(e => { console.error(e); process.exit(1); });
