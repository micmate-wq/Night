// GO NEXT / PLAY editing — headless Chromium check on the real page (Claude, 5 Oct 2026, r8).
// Real gestures through the real handlers. Not native listening; no Tauri here, so instrument
// bundles cannot be prepared (that path is covered by the mocked suite and native use).
// Usage: node gonext-check.js <url> <outDir>
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
  const snap = () => S(() => { const e = window.weaveEngine; return { mode: e.mode, playing: window.studio.isPlaying, idx: e.playingIndex, sel: e.selectedIndex, bar: e.currentBarInScene, launch: e._launch ? { ready: e._launch.ready, idx: e.sceneIndexById(e._launch.sceneId) } : null, fade: e.fadeLevel, names: e.scenes.map(s => s.name), t0: [+window.studio.tracks[0].x.toFixed(2), +window.studio.tracks[0].y.toFixed(2)], t1buf: window.studio.tracks[1].audioBuffer ? window.studio.tracks[1].audioBuffer.__tag : null, t1src: !!window.studio.tracks[1].bufferSource, fades: e._fadeSources.size, go: (document.querySelector('[data-go-now]') || {}).textContent, status: (document.querySelector('[data-launch-status]') || {}).textContent }; });
  await S(async () => { await window.studio.ensureAudioRunning(); const ctx = window.studio.audioCtx; const mk = (f, tag) => { const b = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.2 * Math.sin(2 * Math.PI * f * i / ctx.sampleRate); } b.__tag = tag; return b; }; window.__A = mk(220, 'A'); window.__B = mk(330, 'B'); window.__C = mk(440, 'C'); const put = (k, b) => { const t = window.studio.tracks[k]; t.stopNodeOnly(); t._noteSourceReplaced(); t.audioBuffer = b; t.duration = b.duration; t.isLoaded = true; t.playlist = []; t.useMediaElement = false; }; put(0, window.__A); put(1, window.__B); });
  await page.click('#weave-enabled'); await sleep(400);
  // three Scenes: 01 (T1 left, T2 = B), 02 (T1 right, T2 = C), 03 (T1 centre, T2 empty)
  await S(() => { window.studio.tracks[0].setPosition(0.2, 0.2, 0); }); await page.click('#weave-add-scene'); await sleep(300);
  await S(() => { window.studio.tracks[0].setPosition(0.8, 0.8, 0); const t = window.studio.tracks[1]; t.stopNodeOnly(); t._noteSourceReplaced(); t.audioBuffer = window.__C; t.duration = 2; }); await page.click('#weave-add-scene'); await sleep(300);
  await S(() => { window.studio.tracks[0].setPosition(0.5, 0.5, 0); window.studio.tracks[1].clearSource(); }); await page.click('#weave-add-scene'); await sleep(300);
  let s = await snap(); check('three Scenes captured, GO NEXT shows its target', s.names.length === 3 && /GO NEXT/.test(s.go), s);
  await S(() => { const e = window.weaveEngine; e.setMode('build'); e.scenes.forEach(sc => e.setSceneBars(sc.id, 4)); e.setMode('play'); e.transitionMode = 'fade'; e.transitionLengthBars = 2; });
  await S(() => { const t = window.studio.tracks[1]; t.stopNodeOnly(); t._noteSourceReplaced(); t.audioBuffer = window.__B; t.duration = 2; t.isLoaded = true; });
  await page.keyboard.press('Space'); await sleep(400); s = await snap();
  check('Play from Stop: Scene 01 recalled (T1 left, T2 = B)', s.playing && s.idx === 0 && s.t0[0] === 0.2 && s.t1buf === 'B', s);
  // click a row = pick; GO NEXT → NEXT BAR label; lands on the host bar line
  const row = async (i) => S(i => { const el = document.querySelectorAll('.weave-set-row')[i]; const b = el.getBoundingClientRect(); return { x: b.x + 40, y: b.y + b.height / 2 }; }, i);
  let r = await row(1); await page.mouse.click(r.x, r.y); await sleep(150); s = await snap();
  check('clicking a row picks the GO NEXT destination', s.sel === 1 && /GO NEXT → 02/.test(s.go), s);
  for (let i = 0; i < 40; i++) { const b = (await snap()).bar; if (b % 1 > 0.3 && b % 1 < 0.6) break; await sleep(40); }
  await page.click('[data-go-now]'); await sleep(60); s = await snap();
  check('GO NEXT: same sound set → ready at once: NEXT BAR → Scene 02, nothing moved yet', s.launch && s.launch.ready && s.launch.idx === 1 && /NEXT BAR/.test(s.go) && /NEXT BAR → Scene 02/.test(s.status) && s.idx === 0, s);
  const armedAt = await S(() => window.weaveEngine._launch.atTransport), tt = await S(() => window.weaveEngine._clock().transportTime);
  await sleep(1000 * (armedAt - tt) + 150); s = await snap();
  check('fires on the host bar line: Scene 02 playing, T2 crossfading B→C (outgoing tracked), master full', s.idx === 1 && s.t1buf === 'C' && s.fades === 1 && s.fade === 1, s);
  // Stop mid-crossfade: the outgoing source is owned by the transport
  await S(() => window.studio.stopMaster()); await sleep(150); s = await snap();
  check('Stop mid-crossfade ends the outgoing source at once', !s.playing && s.fades === 0, s);
  // Scene 03 recalls silence on T2
  await page.keyboard.press('Space'); await sleep(300);
  r = await row(2); await page.mouse.click(r.x, r.y); await page.click('[data-go-now]'); await sleep(60);
  const a2 = await S(() => window.weaveEngine._launch && window.weaveEngine._launch.atTransport), t2 = await S(() => window.weaveEngine._clock().transportTime);
  await sleep(1000 * (a2 - t2) + 150); s = await snap();
  check('a captured empty slot recalls silence: T2 unloaded on Scene 03', s.idx === 2 && s.t1buf === null && !s.t1src, s);
  // pending destination replaced: arm 01, then pick 02 and GO NEXT again → only 02 lands
  for (let i = 0; i < 40; i++) { const b = (await snap()).bar; if (b % 1 > 0.05 && b % 1 < 0.35) break; await sleep(40); }
  r = await row(0); await page.mouse.click(r.x, r.y); await page.click('[data-go-now]'); await sleep(40);
  r = await row(1); await page.mouse.click(r.x, r.y); await page.click('[data-go-now]'); await sleep(40); s = await snap();
  check('a new destination replaces the pending one', s.launch && s.launch.idx === 1, s);
  const a3 = await S(() => window.weaveEngine._launch.atTransport), t3 = await S(() => window.weaveEngine._clock().transportTime);
  await sleep(1000 * (a3 - t3) + 150); s = await snap();
  check('…and only Scene 02 launches', s.idx === 1 && !s.launch, s);
  await S(() => window.studio.stopMaster()); await sleep(200);
  // PLAY editing: swipe left → RENAME → inline field with the name selected → type with spaces → Enter
  const swipe = async (i, dx) => { const b = await S(i => { const el = document.querySelectorAll('.weave-set-row')[i]; const r = el.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; }, i); await page.mouse.move(b.x, b.y); await page.mouse.down(); for (let k = 1; k <= 8; k++) { await page.mouse.move(b.x + dx * k / 8, b.y); await sleep(15); } await page.mouse.up(); await sleep(250); };
  await swipe(2, -110);
  const renVis = await S(() => { const w = document.querySelectorAll('.weave-set-wrap')[2]; const b = w.querySelector('[data-set-rename]'); return w.classList.contains('open-rename') && getComputedStyle(b).visibility === 'visible'; });
  check('swipe left reveals RENAME', renVis);
  await page.click('.weave-set-wrap:nth-child(3) [data-set-rename]'); await sleep(150);
  const selAll = await S(() => { const i = document.querySelector('.weave-set-wrap:nth-child(3) .weave-scene-name-input'); return i && document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length; });
  check('RENAME opens the inline field with the current name selected', selAll);
  await page.keyboard.type('Open water two'); await page.keyboard.press('Enter'); await sleep(200); s = await snap();
  check('typing with spaces and Enter renames the Scene (Space typed, transport untouched)', s.names[2] === 'Open water two' && !s.playing, s);
  await swipe(1, -110); await page.click('.weave-set-wrap:nth-child(2) [data-set-rename]'); await sleep(100); await page.keyboard.type('Nope'); await page.keyboard.press('Escape'); await sleep(200); s = await snap();
  check('Escape cancels a rename', s.names[1] === 'Scene 02', s);
  // swipe right → DELETE → tap → gone; UNDO brings it back in place
  await swipe(1, 110);
  const delVis = await S(() => { const w = document.querySelectorAll('.weave-set-wrap')[1]; return w.classList.contains('open-delete') && getComputedStyle(w.querySelector('[data-set-delete]')).visibility === 'visible'; });
  check('swipe right reveals DELETE (nothing deleted yet)', delVis && (await snap()).names.length === 3);
  await page.click('.weave-set-wrap:nth-child(2) [data-set-delete]'); await sleep(200); s = await snap();
  check('tapping DELETE removes Scene 02 and offers Undo', s.names.length === 2 && s.names[1] === 'Open water two' && (await S(() => !!document.querySelector('[data-undo]'))), s);
  await page.click('[data-undo]'); await sleep(200); s = await snap();
  check('UNDO restores it in its place with its name', s.names.length === 3 && s.names[1] === 'Scene 02' && s.names[2] === 'Open water two', s);
  // the sounding Scene cannot be deleted; deleting a pending destination cancels its launch
  await page.keyboard.press('Space'); await sleep(300);
  await swipe(0, 110); await page.click('.weave-set-wrap:nth-child(1) [data-set-delete]').catch(() => {}); await sleep(200); s = await snap();
  check('the sounding Scene cannot be deleted', s.names.length === 3 && s.idx === 0, s);
  r = await row(2); await page.mouse.click(r.x, r.y); await page.click('[data-go-now]'); await sleep(60);
  await swipe(2, 110); await page.click('.weave-set-wrap:nth-child(3) [data-set-delete]'); await sleep(200); s = await snap();
  check('deleting the pending destination cancels its launch', s.names.length === 2 && !s.launch && /GO NEXT/.test(s.go), s);
  await S(() => window.studio.stopMaster()); await sleep(200);
  // BUILD: double-tap rename still there; names everywhere
  await page.click('[data-mode-btn="build"]'); await sleep(500);
  const c = await S(() => { const el = document.querySelectorAll('.weave-loom-row-wrap .weave-loom-row-card')[1]; const b = el.getBoundingClientRect(); return { x: b.x + 60, y: b.y + b.height / 2 }; });
  await page.mouse.click(c.x, c.y); await sleep(80); await page.mouse.click(c.x, c.y); await sleep(200);
  check('BUILD double-tap opens the name field', await S(() => !!document.querySelector('.weave-loom-row-wrap .weave-scene-name-input')));
  await page.keyboard.type('Second room'); await page.keyboard.press('Enter'); await sleep(200);
  check('BUILD rename lands in the document and the right panel', await S(() => window.weaveEngine.scenes[1].name === 'Second room' && document.getElementById('trans').textContent.includes('Second room')));
  await page.screenshot({ path: `${OUT}/gonext-final.png` });
  const real = errs.filter(m => !/ws:\/\/localhost:8765|Failed to load resource/.test(m));
  check('no page errors', real.length === 0, real);
  fs.writeFileSync(`${OUT}/gonext-check.json`, JSON.stringify({ checks, errs }, null, 2));
  const failed = checks.filter(x => !x.ok).length; console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  await browser.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
