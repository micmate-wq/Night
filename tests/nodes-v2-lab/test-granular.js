const { SR, render, rms, peak, check, done } = require('./harness');
const { GranularCloudV2DSP } = require(__dirname + '/../../nodes-v2/granular-cloud/dsp.js');
const mk = (opts = {}) => async (ctx) => { const d = new GranularCloudV2DSP(); d.init(ctx, {}); d.connect(ctx.destination);
  if (opts.buffer) d.injectAudioBuffer(opts.buffer(ctx)); for (const k in (opts.params||{})) d.setParameter(k, opts.params[k]); await d.ready; return d; };
(async () => {
  console.log('Granular Cloud v2');
  let r = await render(1.5, mk());
  check('silent init (never started)', peak(r.L, 0, 1.5) === 0, `peak=${peak(r.L,0,1.5)}`);

  r = await render(4, mk(), [[0.1, d => d.start()]]);
  const w = [0.5,1,1.5,2,2.5,3,3.5].map(t => rms(r.L, t, t + 0.5));
  check('plays after start, every 0.5 s window has sound', w.every(x => x > 0.01), w.map(x=>x.toFixed(3)).join(' '));

  r = await render(4, mk(), [[0.1, d => d.start()], [2.0, d => d.stop()]]);
  check('stop silences grains + tail within 0.3 s', peak(r.L, 2.35, 4) < 1e-4, `peak after=${peak(r.L,2.35,4).toExponential(2)} before=${rms(r.L,1,2).toFixed(3)}`);

  r = await render(4, mk(), [[0.1, d => d.start()], [1.0, d => d.stop()], [2.0, d => d.start()]]);
  check('resume after stop', rms(r.L, 2.5, 4) > 0.01, rms(r.L,2.5,4).toFixed(3));

  // density: dense vs sparse energy comparison
  const dense = await render(3, mk({ params: { density: 60, feedback: 0 } }), [[0.05, d => d.start()]]);
  const sparse = await render(3, mk({ params: { density: 2, feedback: 0 } }), [[0.05, d => d.start()]]);
  check('density changes amount of sound', rms(dense.L, 0.5, 3) > 2 * rms(sparse.L, 0.5, 3), `dense=${rms(dense.L,0.5,3).toFixed(3)} sparse=${rms(sparse.L,0.5,3).toFixed(3)}`);

  // pitch: inject 220 Hz sine, shift +12 -> ~440 Hz
  const sine = ctx => { const b = ctx.createBuffer(1, SR * 2, SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / SR); return b; };
  const zc = (a, t0, t1) => { let c = 0; for (let i = Math.floor(t0*SR)+1; i < t1*SR; i++) if (a[i-1] <= 0 && a[i] > 0) c++; return c / (t1 - t0); };
  const p0 = await render(2, mk({ buffer: sine, params: { density: 30, spray: 0, feedback: 0, grainSize: 0.3 } }), [[0.05, d => d.start()]]);
  const p12 = await render(2, mk({ buffer: sine, params: { density: 30, spray: 0, feedback: 0, grainSize: 0.3, pitchShift: 12 } }), [[0.05, d => d.start()]]);
  const f0 = zc(p0.L, 0.5, 2), f12 = zc(p12.L, 0.5, 2);
  check('injected sample is used (≈220 Hz)', Math.abs(f0 - 220) < 15, `${f0.toFixed(0)} Hz`);
  check('pitchShift +12 doubles pitch (≈440 Hz)', Math.abs(f12 - 440) < 25, `${f12.toFixed(0)} Hz`);

  // params
  const d = new GranularCloudV2DSP();
  d.setParameter('density', 999); check('clamp max', d.getParameter('density') === 60);
  d.setParameter('texture', 'pluck'); check('texture string -> 1', d.getParameter('texture') === 1);
  d.setParameter('freeze', true); check('freeze bool -> 1', d.getParameter('freeze') === 1);
  d.setParameter('harmony', 2.7); check('harmony int', d.getParameter('harmony') === 3);
  d.setParameter('bogus', 1); check('unknown param ignored', d.getParameter('bogus') === undefined);
  d.setParameter('spray', 'abc'); check('NaN ignored', d.getParameter('spray') === 0.45);
  check('getParameters copy', d.getParameters().density === 60 && d.getParameters() !== d.params);

  // dispose
  r = await render(1, mk(), [[0.1, d => d.start()], [0.5, d => { d.dispose(); d.dispose(); }]]);
  check('dispose (twice) is safe and silent', peak(r.L, 0.6, 1) < 1e-4);

  // host-compat: file must not trip the raw-worklet path
  const src = require('fs').readFileSync(__dirname + '/../../nodes-v2/granular-cloud/dsp.js', 'utf8');
  check('no raw worklet keywords in dsp.js', !src.includes('register' + 'Processor') && !src.includes('AudioWorklet' + 'Processor'));
  check('host class regex finds main class', (src.match(/class\s+(\w+DSP)\b/) || [])[1] === 'GranularCloudV2DSP');
  done();
})().catch(e => { console.error(e); process.exit(1); });
