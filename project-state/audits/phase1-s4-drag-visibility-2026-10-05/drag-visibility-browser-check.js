// Reproduce: (1) held BUILD Scene card clipped/hidden while dragging; (2) PLAY text selection.
// Usage: node repro.js <url> <outDir> [label]
const { chromium } = require('playwright');
const fs = require('fs');
const [URL, OUT = '.', LABEL = 'repro'] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(1200);
  // Five real captures via the + SCENE button (replaces the read-only demo set).
  for (let i = 0; i < 5; i++) { await page.click('[data-add-scene]'); await sleep(150); }
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.weave-loom-row-wrap')).map(r => r.dataset.sceneId));
  const result = { label: LABEL, pageErrors: errs, idsBefore: ids };

  // ---- (1) BUILD hold + drag Scene 05 (last) up to position 2, sampling visibility en route.
  const cardSel = i => `.weave-loom-row-wrap:nth-child(${i + 1}) .weave-loom-row-card`;
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.weave-loom-row-wrap')).map(r => { const b = r.getBoundingClientRect(); return { y: b.y, h: b.height, x: b.x, w: b.width }; }));
  const src = rows.length - 1; const dst = 1;
  const sx = rows[src].x + 40, sy = rows[src].y + rows[src].h / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await sleep(300); // past the 220 ms hold
  const heldClass = await page.evaluate(i => document.querySelectorAll('.weave-loom-row-wrap')[i].className, src);
  const samples = [];
  const targetY = rows[dst].y + 4;
  const steps = 12;
  for (let s = 1; s <= steps; s++) {
    const y = sy + (targetY - sy) * s / steps;
    await page.mouse.move(sx, y);
    await sleep(30);
    const sample = await page.evaluate(([i, x, y]) => {
      const wrap = document.querySelectorAll('.weave-loom-row-wrap')[i];
      const card = wrap.querySelector('.weave-loom-row-card');
      const cb = card.getBoundingClientRect();
      const top = document.elementFromPoint(x, cb.y + cb.height / 2);
      const topLeft = document.elementFromPoint(cb.x + 8, cb.y + 6);
      const topRight = document.elementFromPoint(cb.x + cb.width - 8, cb.y + cb.height - 6);
      const inside = el => !!(el && card.contains(el));
      const drop = document.querySelector('.is-drop-target');
      return { y: Math.round(y), cardTop: Math.round(cb.y), transform: card.style.transform, hitCenter: inside(top), hitTL: inside(topLeft), hitBR: inside(topRight), dropIdx: drop ? Array.from(drop.parentNode.children).indexOf(drop) : null, dropAfter: !!(drop && drop.classList.contains('is-drop-after')) };
    }, [src, sx, y]);
    samples.push(sample);
  }
  await page.screenshot({ path: `${OUT}/${LABEL}-drag-mid.png` });
  const styles = await page.evaluate(i => {
    const wrap = document.querySelectorAll('.weave-loom-row-wrap')[i];
    const cs = getComputedStyle(wrap); const vp = getComputedStyle(document.getElementById('weave-loom-viewport'));
    return { wrapOverflow: cs.overflow, wrapZ: cs.zIndex, wrapPos: cs.position, vpOverflowY: vp.overflowY, vpOverflowX: vp.overflowX };
  }, src);
  await page.mouse.up(); await sleep(400);
  const idsAfter = await page.evaluate(() => Array.from(document.querySelectorAll('.weave-loom-row-wrap')).map(r => r.dataset.sceneId));
  Object.assign(result, { heldClass, samples, styles, idsAfter, movedTo2: idsAfter[1] === ids[4] });

  // ---- (2) PLAY: drag across set-list rows and read the selection.
  await page.click('[data-mode-btn="play"]'); await sleep(700);
  const prows = await page.evaluate(() => Array.from(document.querySelectorAll('.weave-set-row')).map(r => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, h: b.height, w: b.width }; }));
  const a = prows[0], b = prows[prows.length - 1];
  await page.mouse.move(a.x + 4, a.y + 2); await page.mouse.down();
  for (let s = 1; s <= 10; s++) { await page.mouse.move(a.x + 4 + (b.w - 8) * s / 10, a.y + 2 + (b.y + b.h - a.y - 4) * s / 10); await sleep(20); }
  const playSel = await page.evaluate(() => window.getSelection().toString());
  await page.screenshot({ path: `${OUT}/${LABEL}-play-drag.png` });
  await page.mouse.up();
  // Also drag starting from the sheet header (outside the rows) across rows.
  const sheet = await page.evaluate(() => { const b = document.querySelector('.weave-sheet').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.move(sheet.x + 10, sheet.y + 30); await page.mouse.down();
  for (let s = 1; s <= 10; s++) { await page.mouse.move(sheet.x + 10 + 200 * s / 10, sheet.y + 30 + (b.y + b.h - sheet.y - 30) * s / 10); await sleep(20); }
  const playSelFromHeader = await page.evaluate(() => window.getSelection().toString());
  await page.mouse.up();
  // BUILD: drag from the lanes header across rows.
  await page.click('[data-mode-btn="build"]'); await sleep(700);
  const hdr = await page.evaluate(() => { const b = document.querySelector('.weave-loom-lanes-header').getBoundingClientRect(); return { x: b.x, y: b.y }; });
  await page.mouse.move(hdr.x + 2, hdr.y - 10); await page.mouse.down();
  for (let s = 1; s <= 10; s++) { await page.mouse.move(hdr.x + 2 + 250 * s / 10, hdr.y - 10 + 400 * s / 10); await sleep(20); }
  const buildSel = await page.evaluate(() => window.getSelection().toString());
  await page.mouse.up();
  const editableOk = await page.evaluate(() => { const i = document.querySelector('#trans input, #weave input, input[type=range]'); return i ? getComputedStyle(i).userSelect : 'no-input'; });
  Object.assign(result, { playSel, playSelFromHeader, buildSel, editableUserSelect: editableOk });
  fs.writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
