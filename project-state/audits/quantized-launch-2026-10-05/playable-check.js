// Playable two-Scene loop — headless Chromium acceptance check (Claude, 5 Oct 2026).
// Real page, real WeaveEngine, real AudioTrack/SpatialStudio and a real (silent, headless)
// AudioContext. Two synthesized sounds stand in for Matt's samples. Asserts: capture of two
// different states; Play puts the instrument into State 1; the arrangement reaches State 2
// through JUMP, MORPH (glide seen mid-way, changed sound switched in) and FADE (true crossfade, no dip); GO NOW quantized;
// Stop rewinds and Play repeats without rebuilding; Space toggles transport; no page errors.
// NOT native listening: nothing is heard here. Usage: node playable-check.js <url> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const [URL, OUT = '.'] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' — ' + JSON.stringify(detail))); };
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(1000);
  const S = (fn, ...args) => page.evaluate(fn, ...args);
  const snap = () => S(() => ({
    idx: window.weaveEngine.playingIndex, bar: window.weaveEngine.currentBarInScene, fade: window.weaveEngine.fadeLevel, glide: !!window.weaveEngine.glide,
    master: window.studio.masterGain ? +window.studio.masterGain.gain.value.toFixed(3) : null, playing: window.studio.isPlaying,
    t: window.studio.tracks.map(t => ({ x: +t.x.toFixed(3), y: +t.y.toFixed(3), z: +t.z.toFixed(1), gain: +(t.stripGainDb || 0).toFixed(1), buf: t.audioBuffer ? t.audioBuffer.__tag : null, motion: t.isPlayingMotion, path: t.motionPath.length, src: !!t.bufferSource, muted: t.isMuted }))
  }));
  // --- set up: Weave on, audio graph running, two synthesized sounds on T1/T2
  await S(async () => {
    await window.studio.ensureAudioRunning();
    const ctx = window.studio.audioCtx;
    const mk = (f, tag) => { const b = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * f * i / ctx.sampleRate); } b.__tag = tag; return b; };
    window.__bufA = mk(220, 'A'); window.__bufB = mk(330, 'B'); window.__bufC = mk(440, 'C');
    const put = (k, b) => { const t = window.studio.tracks[k]; t.stopNodeOnly(); t._noteSourceReplaced(); t.audioBuffer = b; t.duration = b.duration; t.isLoaded = true; t.playlist = []; t.useMediaElement = false; };
    put(0, window.__bufA); put(1, window.__bufB);
    window.weaveEngine.setEnabled(true);
  });
  await sleep(300);
  check('demo set shown before any capture, nothing applied', await S(() => window.weaveEngine.session.demo));
  // --- State 1: T1 front-left with a 2-point loop, gain -9; T2 muted. Capture.
  await S(() => { const [a, b] = window.studio.tracks; a.setPosition(0.2, 0.8, 0); a.motionPath = [{ t: 0, x: 0.2, y: 0.8, z: 0 }, { t: 1.5, x: 0.35, y: 0.65, z: 5 }]; a.isPlayingMotion = true; a.updateStripGain(-9); b.isMuted = true; b.setPosition(0.5, 0.3, 0); });
  const c1 = await S(() => window.weaveEngine.captureCurrentScene()); check('State 1 captured', c1.ok, c1);
  // --- State 2: T1 far right/deep, no loop, gain 0, T2 unmuted and plays a different sound (C). Capture.
  await S(() => { const [a, b] = window.studio.tracks; a.isPlayingMotion = false; a.motionPath = []; a.setPosition(0.85, 0.35, 30); a.updateStripGain(0); b.isMuted = false; b.setPosition(0.7, 0.7, 10); b.stopNodeOnly(); b._noteSourceReplaced(); b.audioBuffer = window.__bufC; b.duration = 2; });
  const c2 = await S(() => window.weaveEngine.captureCurrentScene()); check('State 2 captured', c2.ok, c2);
  check('two real Scenes, demo gone', await S(() => window.weaveEngine.scenes.length === 2 && !window.weaveEngine.session.demo));
  // short Scenes so the loop runs in seconds: 1 bar each at 120 bpm = 2 s
  await S(() => { const e = window.weaveEngine; e.setMode('build'); e.scenes.forEach(s => e.setSceneBars(s.id, 1)); e.setMode('play'); });
  check('Scene lengths snapped to 1 bar', await S(() => window.weaveEngine.scenes.every(s => s.bars === 1)));
  await S(() => { window.weaveEngine.transitionMode = 'jump'; window.weaveEngine.renderTransitionRight(); });
  // --- Play (Space) from stop: State 1 must be on the instrument at once
  await page.keyboard.press('Space'); await sleep(250);
  let s = await snap();
  check('Space starts the transport', s.playing, s);
  check('Play puts T1 at State 1 (near 0.2,0.8: its loop is already running), gain -9, loop running, T2 muted with sound B', s.idx === 0 && Math.abs(s.t[0].x - 0.2) < 0.06 && Math.abs(s.t[0].y - 0.8) < 0.06 && s.t[0].gain === -9 && s.t[0].motion && s.t[0].path === 2 && s.t[1].muted && s.t[1].buf === 'B', s);
  check('entrance fade in progress (master below slider)', s.fade < 1, s);
  await sleep(2300); s = await snap();
  check('JUMP reached State 2: T1 at (0.85,0.35,30) gain 0 no loop; T2 unmuted at (0.7,0.7,10)', s.idx === 1 && s.t[0].x === 0.85 && s.t[0].z === 30 && s.t[0].gain === 0 && !s.t[0].motion && !s.t[1].muted && s.t[1].z === 10, s);
  check('changed sound switched in for T2 (C) and playing', s.t[1].buf === 'C' && s.t[1].src, s);
  await sleep(2000); s = await snap();
  check('wrapped back to State 1 with sound B again, loop restarted', s.idx === 0 && s.t[1].buf === 'B' && s.t[0].motion, s);
  // --- Stop (via the studio) freezes motion and rewinds; Play repeats from State 1
  await S(() => window.studio.stopMaster()); await sleep(200);
  const pos1 = await snap(); await sleep(400); const pos2 = await snap();
  check('Stop: transport off, arrangement rewound, nothing moves', !pos1.playing && pos1.idx === 0 && pos1.bar === 0 && JSON.stringify(pos1.t) === JSON.stringify(pos2.t) && pos1.fade === 1, [pos1, pos2]);
  // --- MORPH over the last bar of 2-bar Scenes (4 s each): glide seen mid-way, sound switched at glide start
  await S(() => { const e = window.weaveEngine; e.setMode('build'); e.scenes.forEach(sc => e.setSceneBars(sc.id, 2)); e.setMode('play'); e.transitionMode = 'morph'; e.transitionLengthBars = 1; e.transitionCurve = 'lin'; e.renderTransitionRight(); });
  await page.keyboard.press('Space'); await sleep(200); s = await snap();
  check('repeat without rebuilding: Play from stop recalls State 1 again', s.idx === 0 && Math.abs(s.t[0].x - 0.2) < 0.06 && s.t[0].gain === -9 && s.t[1].buf === 'B' && !s.glide, s);
  await sleep(2800); s = await snap();
  check('MORPH mid-glide: T1 between the states, gain between -9 and 0, loop frozen, T2 already on sound C', s.idx === 0 && s.glide && s.t[0].x > 0.3 && s.t[0].x < 0.8 && s.t[0].gain < -1 && s.t[0].gain > -8 && !s.t[0].motion && s.t[1].buf === 'C', s);
  await sleep(1300); s = await snap();
  check('MORPH arrived at State 2 exactly', s.idx === 1 && !s.glide && s.t[0].x === 0.85 && s.t[0].gain === 0, s);
  // --- FADE is a crossfade: the master never dips; scenes alternate; a changed sample overlaps old/new on the slot
  const samples = [];
  for (let i = 0; i < 48; i++) { samples.push(await snap()); await sleep(100); }
  const minFade = Math.min(...samples.map(x => x.fade));
  check('FADE: master level never dips (no silence between Scenes)', minFade === 1 && samples.every(x => Math.abs(x.master - 0.8) < 0.05), { minFade, masters: samples.map(x => x.master) });
  check('FADE: scenes still alternate and states recalled (positions change with the index)', new Set(samples.map(x => x.idx)).size === 2 && samples.some(x => x.idx === 0 && Math.abs(x.t[0].x - 0.2) < 0.2) && samples.some(x => x.idx === 1 && x.t[0].x === 0.85), samples.map(x => [x.idx, x.t[0].x, x.fade]));
  check('FADE: T2 sound B/C crossfaded through a real overlap (gain curves scheduled, no page errors)', await S(() => { const t = window.studio.tracks[1]; return !!t.bufferSource && t.isPlaying; }));
  // --- GO NOW: quantized to the next bar line, one-bar crossfade, plan resumes after
  await S(() => { const e = window.weaveEngine; e.setMode('build'); e.scenes.forEach(sc => e.setSceneBars(sc.id, 4)); e.setMode('play'); e.transitionMode = 'fade'; e.transitionLengthBars = 2; });
  await S(() => window.studio.stopMaster()); await sleep(200); await page.keyboard.press('Space'); await sleep(300);
  // wait until we are clearly mid-bar (bar 0.4..0.7), then pick Scene 02 and press GO NOW
  for (let i = 0; i < 40; i++) { const b = (await snap()).bar; if (b > 0.35 && b < 0.6) break; await sleep(50); }
  await S(() => { window.weaveEngine.selectScene(1); });
  await page.click('[data-go-now]'); await sleep(50);
  let s1 = await snap(); const armed = await S(() => window.weaveEngine._launch && window.weaveEngine._launch.atBar);
  check('GO NOW arms a launch for the next bar line and does not move yet', s1.idx === 0 && armed === 1 && Math.abs(s1.t[0].x - 0.2) < 0.1, { s1, armed });
  await sleep(2 * 1000 * (1 - s1.bar) + 150); let s2 = await snap();
  check('…fires on the bar line: Scene 02 playing, crossfade glide running, master at full', s2.idx === 1 && s2.glide && s2.fade === 1 && s2.bar < 0.4, s2);
  await sleep(2200); s2 = await snap();
  check('…one bar later the crossfade is done and T1 sits at State 2', !s2.glide && s2.t[0].x === 0.85, s2);
  // --- Space toggles even with a focused control
  await S(() => { const b = document.querySelector('[data-mode-btn="build"]'); b && b.focus(); });
  await page.keyboard.press('Space'); await sleep(150); s = await snap(); check('Space pauses with a focused button', !s.playing, s);
  await page.keyboard.press('Space'); await sleep(150); s = await snap(); check('Space resumes', s.playing, s);
  await S(() => window.studio.stopMaster()); await sleep(200);
  await page.screenshot({ path: `${OUT}/playable-final.png` });
  const real = errs.filter(m => !/ws:\/\/localhost:8765|Failed to load resource/.test(m));   // the controller WebSocket and Google Fonts are unreachable headless (pre-existing)
  check('no page errors', real.length === 0, real);
  fs.writeFileSync(`${OUT}/playable-check.json`, JSON.stringify({ checks, errs }, null, 2));
  const failed = checks.filter(c => !c.ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
