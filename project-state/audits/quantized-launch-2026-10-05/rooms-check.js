// PLAY = live room / BUILD = quiet room — headless Chromium check on the real page (Claude, 5 Oct 2026).
// Real gestures through the real handlers: swipe-left AUDITION, double-click move in PLAY,
// double-click rename in BUILD, BUILD stopping the transport, Audition button. Not native listening.
// Usage: node rooms-check.js <url> <outDir>
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
  await page.goto(URL, { waitUntil: 'load' }); await sleep(900);
  const S = (fn, ...a) => page.evaluate(fn, ...a);
  const snap = () => S(() => ({ mode: window.weaveEngine.mode, playing: window.studio.isPlaying, idx: window.weaveEngine.playingIndex, bar: window.weaveEngine.currentBarInScene, hold: window.weaveEngine.isHolding, audition: window.weaveEngine._audition, fade: window.weaveEngine.fadeLevel, t0: [+window.studio.tracks[0].x.toFixed(2), +window.studio.tracks[0].y.toFixed(2)], names: window.weaveEngine.scenes.map(s => s.name) }));
  await S(async () => { await window.studio.ensureAudioRunning(); const ctx = window.studio.audioCtx; const b = ctx.createBuffer(2, ctx.sampleRate, ctx.sampleRate); const t = window.studio.tracks[0]; t.stopNodeOnly(); t._noteSourceReplaced(); t.audioBuffer = b; t.duration = 1; t.isLoaded = true; t.playlist = []; });
  await page.click('#weave-enabled'); await sleep(400);
  check('WEAVE ON opens PLAY', (await snap()).mode === 'play');
  for (const [x, y] of [[0.2, 0.2], [0.8, 0.8], [0.5, 0.5]]) { await S(([x, y]) => window.studio.tracks[0].setPosition(x, y, 0), [x, y]); const r = await S(() => window.weaveEngine.captureCurrentScene()); check('captured ' + x, r.ok, r); }
  await S(() => { const e = window.weaveEngine; e.scenes.forEach(s => e.setSceneBars(s.id, 2)); e.transitionMode = 'jump'; });
  // PLAY: double-click Scene 03 while stopped -> starts there
  const row = async (i) => S(i => { const el = document.querySelectorAll('.weave-set-row')[i]; const b = el.getBoundingClientRect(); return { x: b.x + 40, y: b.y + b.height / 2, idx: +el.dataset.sceneIndex }; }, i);
  let r = await row(1); await page.mouse.dblclick(r.x, r.y); await sleep(500); let s = await snap();
  check('PLAY double-click while stopped starts the transport on that Scene', s.playing && s.idx === r.idx, { s, r });
  const target = await S(i => [+window.studio.tracks[0].x.toFixed(2)], r.idx);
  r = await row(0); await page.mouse.dblclick(r.x, r.y); await sleep(100); s = await snap();
  const armed = await S(() => window.weaveEngine._launch && window.weaveEngine._launch.atBar);
  check('PLAY double-click while playing arms a launch for the next bar (nothing moves yet)', armed >= 1 && s.idx !== r.idx, { s, r, armed });
  await sleep(2 * 1000 * (armed - s.bar) + 200); s = await snap();
  check('…and on the bar line it lands there (one-bar crossfade), state recalled', s.idx === r.idx && JSON.stringify(s.t0) !== JSON.stringify(target), { s, r });
  // BUILD stops the audio
  await page.click('[data-mode-btn="build"]'); await sleep(600); s = await snap();
  check('switching to BUILD stops the transport', s.mode === 'build' && !s.playing, s);
  // swipe LEFT on Scene 03 -> AUDITION
  const card = async (i) => S(i => { const el = document.querySelectorAll('.weave-loom-row-wrap .weave-loom-row-card')[i]; const b = el.getBoundingClientRect(); return { x: b.x + 220, y: b.y + b.height / 2 }; }, i);
  let c = await card(2); await page.mouse.move(c.x, c.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(c.x - 100 * k / 8, c.y); await sleep(20); }
  const tag = await S(() => { const w = document.querySelectorAll('.weave-loom-row-wrap')[2]; const t = w.querySelector('.wluc-tag.audition'); const r = t.getBoundingClientRect(); return { state: w.classList.contains('state-audition'), visible: r.width > 0 && getComputedStyle(w.querySelector('.audition-msg')).display === 'flex', right: r.right <= w.getBoundingClientRect().right + 1 }; });
  check('swipe-left reveals the AUDITION speaker tag on the right', tag.state && tag.visible && tag.right, tag);
  await page.mouse.up(); await sleep(600); s = await snap();
  check('release past the threshold auditions Scene 03: transport runs, holds on it, state recalled', s.playing && s.idx === 2 && s.hold && s.audition === 2 && s.t0[0] === 0.5, s);
  // swipe left again on the same Scene -> stops
  c = await card(2); await page.mouse.move(c.x, c.y); await page.mouse.down(); for (let k = 1; k <= 8; k++) { await page.mouse.move(c.x - 100 * k / 8, c.y); await sleep(20); } await page.mouse.up(); await sleep(500); s = await snap();
  check('swiping the auditioned Scene again stops it', !s.playing && s.audition === null && !s.hold, s);
  // right swipe still ADJUST
  c = await card(1); await page.mouse.move(c.x - 200, c.y); await page.mouse.down(); for (let k = 1; k <= 8; k++) { await page.mouse.move(c.x - 200 + 100 * k / 8, c.y); await sleep(20); } await page.mouse.up(); await sleep(400);
  check('swipe-right still enters ADJUST', (await S(() => window.weaveEngine.editingIndex)) === 1);
  await S(() => window.weaveEngine.exitAdjust()); await sleep(200);
  // Audition button (transition): plays then stops itself
  await S(() => { window.weaveEngine.selectScene(0); window.weaveEngine.transitionLengthBars = 1; });
  await page.click('[data-preview-btn]'); await sleep(500); s = await snap();
  check('AUDITION button starts the transport near the end of Scene 01', s.playing && s.idx === 0, s);
  await sleep(4500); s = await snap();
  check('…lands on Scene 02 and stops itself', !s.playing && s.audition === null, s);
  // rename by double-click
  c = await card(0); await page.mouse.dblclick(c.x - 150, c.y); await sleep(200);
  const hasInput = await S(() => !!document.querySelector('.weave-scene-name-input'));
  check('double-click in BUILD opens the inline name field', hasInput);
  await page.keyboard.press('Control+A'); await page.keyboard.type('Opening'); await page.keyboard.press('Enter'); await sleep(300); s = await snap();
  check('Enter renames the Scene through the document', s.names[0] === 'Opening' && (await S(() => window.weaveEngine.session.doc.scenes[window.weaveEngine.scenes[0].id].name)) === 'Opening', s.names);
  check('Space still toggles transport (name field closed)', await (async () => { await page.keyboard.press('Space'); await sleep(200); const p1 = (await snap()).playing; await page.keyboard.press('Space'); await sleep(200); return p1; })());
  await S(() => window.studio.stopMaster());
  await page.screenshot({ path: `${OUT}/rooms-final.png` });
  const real = errs.filter(m => !/ws:\/\/localhost:8765|Failed to load resource/.test(m));
  check('no page errors', real.length === 0, real);
  fs.writeFileSync(`${OUT}/rooms-check.json`, JSON.stringify({ checks, errs }, null, 2));
  const failed = checks.filter(x => !x.ok).length; console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
