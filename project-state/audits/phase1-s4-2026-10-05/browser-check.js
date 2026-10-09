// S4 browser/module acceptance check in headless Chromium (Codex review 2 version).
// Runs the Lab page from the S4 working tree AND the ed0cad7 (pre-S4) tree under identical
// conditions (same browser, viewport, fallback fonts, no audio, animations frozen) and
// asserts: scripts load; the fresh page (demo set) is pixel-identical to the pre-S4 page and
// the panel rectangles are equal; the real + SCENE button captures a Scene through S1–S3;
// toasts carry the expected product wording; GO NOW, ADJUST drag-end, DONE, deletion
// identity, delayed Preview targeting and detach behave per S4. It exits non-zero on any
// failed assertion. This is NOT native verification: no Tauri, no audio device, no listening.
// Usage: node browser-check.js <outDir> <s4Url> <baselineUrl>
const { chromium } = require('playwright');
const fs = require('fs');
const [out = '.', S4_URL = 'http://localhost:3456/index.html', BASE_URL = 'http://localhost:3457/index.html'] = process.argv.slice(2);
const FREEZE_CSS = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.error('FAIL ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage(browser, url, consoleSink) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  // Same clock on both pages: time-driven marks (transport clock, transition playhead) must not differ by load time.
  await page.addInitScript(() => { const T0 = 5000, D0 = 1759680000000; performance.now = () => T0; Date.now = () => D0; });
  page.on('console', m => consoleSink.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => consoleSink.push('pageerror: ' + e.message));
  page.on('requestfailed', r => consoleSink.push('requestfailed: ' + r.url()));
  await page.goto(url, { waitUntil: 'load' });
  await page.addStyleTag({ content: FREEZE_CSS });
  await sleep(1200);
  return page;
}
const layoutOf = page => page.evaluate(() => {
  const r = s => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  return { weave: r('#weave'), trans: r('#trans'), arena: r('canvas'), toolbar: r('header, .toolbar, #toolbar'), rows: Array.from(document.querySelectorAll('.weave-loom-row-wrap')).map(el => { const b = el.getBoundingClientRect(); return [Math.round(b.y), Math.round(b.height)]; }) };
});
const rowsOf = page => page.evaluate(() => window.weaveEngine.scenes.map(r => [r.name, r.bars, !!r.demo]));
const toastText = page => page.evaluate(() => { const t = document.getElementById('aether-toast'); return t ? t.textContent : null; });
async function swipeRow(page, rowIndex, dx) {
  const box = await page.evaluate(i => { const el = document.querySelectorAll('.weave-loom-row-wrap .weave-loom-row-card')[i]; const b = el.getBoundingClientRect(); return [b.x + 20, b.y + b.height / 2]; }, rowIndex);
  await page.mouse.move(box[0], box[1]); await page.mouse.down();
  for (let s = 1; s <= 8; s++) await page.mouse.move(box[0] + dx * s / 8, box[1]);
  await page.mouse.up(); await sleep(300);
}
// Pixel comparison of two PNG screenshots inside the browser (canvas), no extra dependencies.
async function pixelDiff(browser, pngA, pngB) {
  const page = await browser.newPage();
  const res = await page.evaluate(async ([a, b]) => {
    const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false };
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; const g = c.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
    g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let diff = 0, maxDelta = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0; i < da.length; i += 4) {
      const dl = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (dl > 0) { diff++; if (dl > maxDelta) maxDelta = dl; const p = i / 4, x = p % c.width, y = (p / c.width) | 0; if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    }
    return { sameSize: true, total: c.width * c.height, diff, maxDelta, bbox: diff ? [minX, minY, maxX, maxY] : null };
  }, [pngA.toString('base64'), pngB.toString('base64')]);
  await page.close();
  return res;
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const report = { s4Url: S4_URL, baselineUrl: BASE_URL, checks };
  const consoleS4 = [], consoleBase = [];

  // ---- 1. pre-S4 baseline under identical conditions ----
  const base = await openPage(browser, BASE_URL, consoleBase);
  report.baseline = { rows: await rowsOf(base), layout: await layoutOf(base) };
  const basePng = await base.screenshot({ path: out + '/browser-00-baseline-ed0cad7.png' });
  await base.close();

  // ---- 2. S4 fresh page ----
  const page = await openPage(browser, S4_URL, consoleS4);
  report.scriptsLoaded = await page.evaluate(() => ({ S1: typeof AetherWeaveModel, S2: typeof AetherWeaveAssets, S3: typeof AetherWeaveImport, engine: typeof window.weaveEngine, available: !!(window.weaveEngine && window.weaveEngine.session.available) }));
  check('S1–S3 and the engine load; session.available', report.scriptsLoaded.S1 === 'object' && report.scriptsLoaded.S2 === 'object' && report.scriptsLoaded.S3 === 'object' && report.scriptsLoaded.available === true, report.scriptsLoaded);
  report.initial = { rows: await rowsOf(page), demo: await page.evaluate(() => window.weaveEngine.session.demo), docScenes: await page.evaluate(() => window.weaveEngine.session.doc.order.length), layout: await layoutOf(page) };
  check('fresh page: demo set rows equal the pre-S4 rows', JSON.stringify(report.initial.rows.map(r => r.slice(0, 2))) === JSON.stringify(report.baseline.rows.map(r => r.slice(0, 2))), { s4: report.initial.rows, base: report.baseline.rows });
  check('fresh page: panel and row rectangles equal the pre-S4 page', JSON.stringify(report.initial.layout) === JSON.stringify(report.baseline.layout), { s4: report.initial.layout, base: report.baseline.layout });
  const freshPng = await page.screenshot({ path: out + '/browser-01-fresh.png' });
  report.freshPixelDiff = await pixelDiff(browser, basePng, freshPng);
  // Tolerance: GPU anti-aliasing noise only — at most 0.05% of pixels, none differing by more than 4/255 on any channel.
  check('fresh page: pixel-equivalent to the pre-S4 page (same browser, viewport, fonts, frozen clock and animations; anti-aliasing noise only)', report.freshPixelDiff.sameSize && report.freshPixelDiff.diff <= report.freshPixelDiff.total * 0.0005 && report.freshPixelDiff.maxDelta <= 4, report.freshPixelDiff);

  // ---- 3. D8: demo rows refuse ADJUST through the real swipe gesture, with the product toast ----
  await swipeRow(page, 0, 110);
  report.demoAdjustToast = await toastText(page);
  check('demo row ADJUST swipe is refused with the demo toast', report.demoAdjustToast === 'Demo Scene — press + SCENE to capture a real one', report.demoAdjustToast);
  check('demo row ADJUST swipe leaves editingIndex null', (await page.evaluate(() => window.weaveEngine.editingIndex)) === null);

  // ---- 4. + SCENE through the real button ----
  // the left panel re-renders after every change, so the button is re-queried each time
  const clickAdd = async () => { const b = await page.$('#weave [data-add-scene]'); if (!b) throw new Error('+ SCENE button missing'); await b.click(); };
  check('+ SCENE button present', !!(await page.$('#weave [data-add-scene]')));
  await clickAdd();
  await page.waitForFunction(() => window.weaveEngine.session.doc.order.length === 1 && window.weaveEngine._pendingCaptures.size === 0, null, { timeout: 15000 });
  report.capture1 = await page.evaluate(() => {
    const e = window.weaveEngine; const id = e.session.doc.order[0];
    return { rows: e.scenes.map(x => [x.name, x.bars, !!x.demo, !!x.spatialState]), docScenes: e.session.doc.order.length, dirty: e.session.dirty, detached: e.session.detached,
      provenance: e.session.doc.scenes[id].provenance.kind, valid: AetherWeaveModel.validateDocument(e.session.doc).ok, docRevision: e.session.docRevision,
      bindings: window.studio.tracks.map(t => t._weaveBinding ? [t._weaveBinding.sceneId === id, t._weaveBinding.sourceIdentity] : null), rowsInDom: document.querySelectorAll('.weave-loom-row-wrap').length };
  });
  check('first capture: one real Scene row, demo set gone', JSON.stringify(report.capture1.rows) === JSON.stringify([['Scene 01', 16, false, true]]) && report.capture1.rowsInDom === 1, report.capture1.rows);
  check('first capture: provenance capture, valid document, dirty, not detached, docRevision 1', report.capture1.provenance === 'capture' && report.capture1.valid && report.capture1.dirty && !report.capture1.detached && report.capture1.docRevision === 1, report.capture1);
  check('first capture: four slots bound to the new Scene as empty sources', JSON.stringify(report.capture1.bindings) === JSON.stringify([[true, 'empty'], [true, 'empty'], [true, 'empty'], [true, 'empty']]), report.capture1.bindings);
  await page.screenshot({ path: out + '/browser-02-after-capture.png' });
  report.afterCaptureLayout = await layoutOf(page);
  check('after capture: panel rectangles unchanged', JSON.stringify([report.afterCaptureLayout.weave, report.afterCaptureLayout.trans, report.afterCaptureLayout.arena, report.afterCaptureLayout.toolbar]) === JSON.stringify([report.initial.layout.weave, report.initial.layout.trans, report.initial.layout.arena, report.initial.layout.toolbar]), report.afterCaptureLayout);

  // ---- 5. two more captures with moved nodes (button), then GO NOW (jump) moves the bound slots ----
  for (const [x, y, x2, y2] of [[0.2, 0.8, 0.8, 0.2], [0.7, 0.3, 0.3, 0.7]]) {
    await page.evaluate(([x, y, x2, y2]) => { window.studio.tracks[0].setPosition(x, y, 0); window.studio.tracks[1].setPosition(x2, y2, 0); }, [x, y, x2, y2]);
    const n = await page.evaluate(() => window.weaveEngine.session.doc.order.length);
    await clickAdd();
    await page.waitForFunction(n => window.weaveEngine.session.doc.order.length === n + 1 && window.weaveEngine._pendingCaptures.size === 0, n, { timeout: 15000 });
  }
  report.capture3 = await page.evaluate(() => {
    const e = window.weaveEngine; const st = window.studio;
    st.tracks[0].setPosition(0.5, 0.5, 0); st.tracks[1].setPosition(0.5, 0.5, 0);
    e.transitionMode = 'jump'; e.playingIndex = 0; e.selectedIndex = 0; e.goNow();
    return { rows: e.scenes.length, playing: e.playingIndex, t1: [st.tracks[0].x, st.tracks[0].y], t2: [st.tracks[1].x, st.tracks[1].y], ids: e.scenes.map(r => r.id) };
  });
  check('three Scenes after three button captures', report.capture3.rows === 3, report.capture3.rows);
  check('GO NOW (jump) to Scene 02 moves bound T1/T2 to the captured positions', report.capture3.playing === 1 && JSON.stringify(report.capture3.t1) === '[0.2,0.8]' && JSON.stringify(report.capture3.t2) === '[0.8,0.2]', report.capture3);

  // ---- 6. ADJUST (provisional D5) through the real swipe: Scene 02 (not the binding Scene) recalls but refuses the
  //         drag-end write with the product toast; Scene 03 (the binding Scene after the last capture) accepts it ----
  await page.evaluate(() => { window.studio.tracks[0].setPosition(0.4, 0.4, 0); });
  await swipeRow(page, 1, 110);
  report.adjustOther = await page.evaluate(() => {
    const e = window.weaveEngine; const st = window.studio;
    const recalled = [st.tracks[0].x, st.tracks[0].y]; const rev = e.session.docRevision;
    st.tracks[0].setPosition(0.11, 0.22, 0); e.onNodeDragEnd();
    const sc = e.session.doc.scenes[e.scenes[1].id].threadStates[e._threadIdForSlot(0)].spatial;
    const toast = document.getElementById('aether-toast') ? document.getElementById('aether-toast').textContent : null;
    return { editing: e.editingIndex, recalled, stored: sc, docRevision: e.session.docRevision, rev, toast };
  });
  check('ADJUST on Scene 02 recalls the matching slot (same source) but the drag-end is refused: slots belong to Scene 03', report.adjustOther.editing === 1 && JSON.stringify(report.adjustOther.recalled) === '[0.2,0.8]' && report.adjustOther.stored.x === 0.2 && report.adjustOther.docRevision === report.adjustOther.rev, report.adjustOther);
  check('refused drag-end shows the product toast', report.adjustOther.toast === 'Positions not saved to Scene 02 for T1, T2, T3, T4 \u2014 they belong to another Scene or play a different source', report.adjustOther.toast);
  await page.click('[data-done-adjust]');
  await page.evaluate(() => { window.studio.tracks[0].setPosition(0.4, 0.4, 0); });
  await swipeRow(page, 2, 110);
  report.adjust = await page.evaluate(() => {
    const e = window.weaveEngine; const st = window.studio;
    const recalled = [st.tracks[0].x, st.tracks[0].y];
    st.tracks[0].setPosition(0.33, 0.66, 0); e.onNodeDragEnd();
    const sc = e.session.doc.scenes[e.scenes[2].id];
    const written = sc.threadStates[e._threadIdForSlot(0)].spatial;
    const other = e.session.doc.scenes[e.scenes[1].id].threadStates[e._threadIdForSlot(0)].spatial;
    return { editing: e.editingIndex, recalled, written, other, doneInDom: !!document.querySelector('[data-done-adjust]'), docRevision: e.session.docRevision, valid: AetherWeaveModel.validateDocument(e.session.doc).ok };
  });
  check('ADJUST swipe on Scene 03 enters adjust and recalls the bound slot', report.adjust.editing === 2 && JSON.stringify(report.adjust.recalled) === '[0.7,0.3]', report.adjust);
  check('drag-end writes the moved slot into Scene 03 only; document valid; docRevision advanced', JSON.stringify(report.adjust.written) === '{"x":0.33,"y":0.66,"z":0}' && report.adjust.other.x === 0.2 && report.adjust.valid && report.adjust.docRevision === 4, report.adjust);
  check('DONE chip rendered while adjusting', report.adjust.doneInDom);
  await page.screenshot({ path: out + '/browser-03-adjust.png' });
  await page.click('[data-done-adjust]');
  check('DONE click exits adjust', (await page.evaluate(() => window.weaveEngine.editingIndex)) === null);

  // ---- 7. deletion keeps identities (review 2): play/select Scene 03, delete Scene 01 by swipe ----
  report.deletion = await page.evaluate(() => { const e = window.weaveEngine; e.playingIndex = 2; e.selectScene(2); return { ids: e.scenes.map(r => r.id) }; });
  await swipeRow(page, 0, 230);
  report.deletion.after = await page.evaluate(() => { const e = window.weaveEngine; return { ids: e.scenes.map(r => r.id), playing: e.playingIndex, selected: e.selectedIndex, rowsInDom: document.querySelectorAll('.weave-loom-row-wrap').length }; });
  check('delete swipe removes Scene 01; playing and selected keep the Scene 03 identity', report.deletion.after.ids.length === 2 && report.deletion.after.rowsInDom === 2 && report.deletion.after.ids[report.deletion.after.playing] === report.deletion.ids[2] && report.deletion.after.ids[report.deletion.after.selected] === report.deletion.ids[2], report.deletion);

  // ---- 8. delayed jump Preview targets the intended Scene even if the selection changes meanwhile (review 2) ----
  report.preview = await page.evaluate(async () => {
    const e = window.weaveEngine; const st = window.studio;
    e.transitionMode = 'jump'; e.playingIndex = 0; e.selectScene(0);
    const target = e.scenes[1].id; const before = st.tracks[0].x;
    const ok = e.previewTransition();
    e.selectScene(1);                         // selection changes while the Preview waits
    await new Promise(r => setTimeout(r, e.getBarDurationSec() * 1000 + 300));
    return { ok, target, movedTo: [st.tracks[0].x, st.tracks[0].y], expected: e.session.doc.scenes[target].threadStates[e._threadIdForSlot(0)].spatial, before };
  });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  check('delayed Preview moved T1 to the originally intended Scene (Scene 03), not to the Scene after the new selection', report.preview.ok && near(report.preview.movedTo[0], report.preview.expected.x) && near(report.preview.movedTo[1], report.preview.expected.y) && near(report.preview.expected.x, 0.33), report.preview);

  // ---- 9. D3 detach via the real session hooks; product toast; moves blocked ----
  report.detach = await page.evaluate(() => {
    const e = window.weaveEngine; const st = window.studio;
    const tok = e.onSourcesReplacing(); st.tracks.forEach(t => t._noteSourceReplaced()); e.onSourcesReplaced(tok, { kind: 'session', replaced: true, fileName: 'x.aether', failures: [] });
    const toast = document.getElementById('aether-toast') ? document.getElementById('aether-toast').textContent : null;
    st.tracks[0].setPosition(0.5, 0.5, 0); e.playingIndex = 0; e.goNow();
    return { detached: e.session.detached, movedAfterDetach: st.tracks[0].x !== 0.5, toast, bindingsValid: st.tracks.map(t => e.bindingValid(t)) };
  });
  check('detach after a real session replacement: detached, every binding invalid, GO NOW moves nothing', report.detach.detached && !report.detach.movedAfterDetach && report.detach.bindingsValid.every(v => v === false), report.detach);
  check('detach toast carries the product wording', /^Weave detached — live sound is now x\.aether\. \+ SCENE to capture it into the Weave\./.test(report.detach.toast || ''), report.detach.toast);

  // ---- 10. console: nothing new beyond the pre-existing font fetch and the optional WebSocket notice ----
  const noise = l => /favicon|fonts\.googleapis|fonts\.gstatic|ws:\/\/|ERR_TUNNEL_CONNECTION_FAILED|WebSocket disconnected/.test(l);
  report.console = { s4: consoleS4.filter(l => !noise(l)), baseline: consoleBase.filter(l => !noise(l)), s4Raw: consoleS4, baselineRaw: consoleBase };
  check('no page errors or new console errors on the S4 page', report.console.s4.filter(l => /^(error|pageerror)/.test(l)).length === 0, report.console.s4);

  report.summary = { passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length };
  fs.writeFileSync(out + '/browser-check.json', JSON.stringify(report, null, 2));
  console.log(checks.map(c => (c.ok ? 'ok   ' : 'FAIL ') + c.name).join('\n'));
  console.log('\n' + report.summary.passed + ' passed, ' + report.summary.failed + ' failed');
  await browser.close();
  process.exit(report.summary.failed ? 1 : 0);
})().catch(e => { console.error('browser check crashed:', e); process.exit(2); });
