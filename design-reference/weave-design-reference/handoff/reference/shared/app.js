/* Aether · Weave mockups — shared chrome, example data, clock, transition panel. EXAMPLE DATA ONLY. */
const COL = ['#f2463a', '#f7dc38', '#8f63c8', '#56c83a'];
const NODE = ['T1', 'T2', 'T3', 'T4'];
const BPM = 120, BAR_S = 60 / BPM * 4;          // 2 s per bar
// vols: T1..T4 volume 0..1 (0 = not in scene); pos: node x,y (-1..1) for morph preview
const SCENES7 = [
  { n: 'Slow emergence', b: 16, v: [.6, 0, .3, 0] },
  { n: 'Open water', b: 32, v: [.8, .4, .5, 0] },
  { n: 'Afterglow', b: 16, v: [.9, .3, 0, .5] },
  { n: 'Suspended', b: 8, v: [0, .7, .6, 0] },
  { n: 'Distant voices over the harbour', b: 16, v: [.3, 0, .6, .8] },
  { n: 'Low tide', b: 32, v: [.9, .5, .4, .6] },
  { n: 'First light', b: 16, v: [0, .7, 0, .5] },
];
const EXTRA = [
  { n: 'Salt glass', b: 8, v: [.4, .6, 0, 0] }, { n: 'Night ferry', b: 16, v: [0, .3, .8, .4] },
  { n: 'Undertow', b: 32, v: [.8, 0, .5, .7] }, { n: 'Signal', b: 8, v: [0, 0, 0, .9] },
  { n: 'Hollow bell', b: 16, v: [.5, .8, .3, 0] }, { n: 'Drift home', b: 16, v: [.3, .3, .3, .3] },
  { n: 'Last call', b: 8, v: [.9, 0, 0, .2] },
];
const q = new URLSearchParams(location.search);
const CROWDED = q.has('crowded') || document.documentElement.dataset.crowded === '1';
const SCENES = CROWDED ? [...SCENES7.slice(0, 5), ...EXTRA, ...SCENES7.slice(5)] : SCENES7;
SCENES.forEach((s, i) => { s.i = i; s.pos = [0, 1, 2, 3].map(k => [Math.sin(i * 1.7 + k * 2.1) * .7, Math.cos(i * 1.3 + k * 1.9) * .7]); });
const PLAY = 2;                                  // scene index playing (03 Afterglow)
const T0 = performance.now(), START_BAR = 9.2;   // 9.2 bars into the playing scene at page load
const W = { scenes: SCENES, play: PLAY, sel: PLAY, len: 8, curve: 'ease', mode: 'morph' };
const pad = n => String(n).padStart(2, '0');
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const totalBars = () => SCENES.reduce((a, s) => a + s.b, 0);
function clock() {                               // bars into the playing scene (loops for the mock)
  const sc = SCENES[PLAY], e = (performance.now() - T0) / 1000;
  const bar = (START_BAR + e / BAR_S) % sc.b;
  const left = (sc.b - bar) * BAR_S;             // seconds until the scene ends (transition starts at end)
  return { bar, beat: Math.floor((bar % 1) * 4) + 1, left, frac: bar / sc.b, app: 23.3 + e };
}
const fmtS = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${Math.floor((s % 1) * 10)}`;
const mq = (text, cls = '', d) => `<div class="mq ${cls}"><span style="--d:${d || Math.max(6, text.length * .45)}s">${esc(text)}&nbsp;&nbsp;·&nbsp;&nbsp;${esc(text)}&nbsp;&nbsp;·&nbsp;&nbsp;</span></div>`;
const dots = v => v.map((x, k) => x ? `<i style="background:${COL[k]}"></i>` : '').join('');

/* ---------- chrome ---------- */
function chrome() {
  const ico = {
    save: '<svg viewBox="0 0 20 20"><path d="M4 3h10l3 3v11H4z"/><path d="M7 3v5h6V3M7 17v-5h7v5"/></svg>',
    folder: '<svg viewBox="0 0 20 20"><path d="M2.5 5.5h5l2 2h8v9h-15z"/></svg>',
    mix: '<svg viewBox="0 0 20 20"><path d="M5 3v14M10 3v14M15 3v14"/><path d="M3 12h4M8 7h4M13 13h4"/></svg>',
    moon: '<svg viewBox="0 0 20 20"><path d="M15 12.5A6 6 0 0 1 7.5 5a6 6 0 1 0 7.5 7.5z"/></svg>',
  };
  document.body.insertAdjacentHTML('afterbegin', `
  <header class="top">
    <div class="tp"><svg viewBox="0 0 10 10"><path d="M1 0l9 5-9 5z"/></svg><svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>
      <span><i class="dot rec"></i>REC</span><span><i class="dot"></i>CONNECT</span><span class="clock" data-appclock>00:23.3</span></div>
    <div class="nodes-dots">${COL.map(c => `<i style="background:${c};color:${c}"></i>`).join('')}</div>
    <div class="right">${ico.save}${ico.folder}${ico.mix}<span class="vol">VOL <span class="tr"><b></b></span> 80%</span>${ico.moon}</div>
  </header>
  <aside class="gut l" id="weave"></aside>
  <main class="cv" id="canvas">
    <svg class="grid"><defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#d9d9d5"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <line x1="50%" y1="0" x2="50%" y2="100%" stroke="#cfcfca"/><line x1="0" y1="50%" x2="100%" y2="50%" stroke="#cfcfca"/>
      <circle cx="50%" cy="50%" r="34%" fill="none" stroke="#e6e6e2" stroke-dasharray="3 5"/></svg>
    <span class="ax" style="left:50%;top:10px;transform:translateX(-50%)">+100% VOLUME</span>
    <span class="ax" style="left:50%;bottom:10px;transform:translateX(-50%)">0% VOLUME</span>
    <span class="ax" style="left:10px;top:50%;transform:translateY(-50%)">100% LEFT</span>
    <span class="ax" style="right:10px;top:50%;transform:translateY(-50%)">100% RIGHT</span>
    ${[['T1', 38, 8, 'V:93% P:L23 Z:0.0'], ['T4', 75, 49, 'V:50% P:R50 Z:0.0'], ['T2', 50, 70, 'V:30% P:C Z:0.0'], ['T3', 80, 96, '']].map(([t, x, y, ro]) => {
      const k = +t[1] - 1; return `<div class="node ${k === 1 ? 'y' : ''}" style="left:${x}%;top:${y}%;background:${COL[k]};color:${COL[k]}"><b>${t}</b>${ro ? `<span class="ro">${ro}</span>` : ''}</div>`;
    }).join('')}
    <button class="btn reset" style="position:absolute;right:12px;bottom:12px">Reset All</button>
  </main>
  <aside class="gut r" id="trans"></aside>`);
}

/* ---------- transition panel (shared, interactive) ---------- */
function ease(x, c) { return c === 'lin' ? x : c === 'late' ? x * x * x : x * x * (3 - 2 * x); }
function txDiagram(a, b, len, curve, wpx = 236) {
  const pre = 4, post = 4, tot = pre + len + post, u = wpx / tot, x0 = pre * u, x1 = (pre + len) * u, rowH = 30;
  const rows = [0, 1, 2, 3].filter(k => a.v[k] || b.v[k]);
  let svg = `<svg width="${wpx}" height="${rows.length * rowH + 34}" viewBox="0 0 ${wpx} ${rows.length * rowH + 34}" style="display:block;overflow:visible"><defs>`;
  rows.forEach(k => {
    const inA = a.v[k] > 0, inB = b.v[k] > 0;
    const stops = Array.from({ length: 9 }, (_, i) => { const f = i / 8, e = ease(f, curve); const o = inA && inB ? 1 : inA ? 1 - e : e; return `<stop offset="${(x0 + f * (x1 - x0)) / wpx}" stop-color="${COL[k]}" stop-opacity="${o.toFixed(2)}"/>`; }).join('');
    svg += `<linearGradient id="f${k}" gradientUnits="userSpaceOnUse" x1="0" x2="${wpx}" y1="0" y2="0"><stop offset="0" stop-color="${COL[k]}" stop-opacity="${inA ? 1 : 0}"/>${stops}<stop offset="1" stop-color="${COL[k]}" stop-opacity="${inB ? 1 : 0}"/></linearGradient>`;
  });
  svg += '</defs>';
  svg += `<rect x="${x0}" y="0" width="${x1 - x0}" height="${rows.length * rowH + 6}" fill="#f3f3f0"/>`;
  rows.forEach((k, r) => {
    const cy = r * rowH + rowH / 2 + 3, ha = Math.max(a.v[k], .08) * 22 * (a.v[k] ? 1 : 0), hb = b.v[k] * 22;
    const pts = [];
    const N = 16; for (let i = 0; i <= N; i++) { const f = i / N, e = ease(f, curve); const h = a.v[k] && b.v[k] ? ha + (hb - ha) * e : a.v[k] ? ha : hb; pts.push([x0 + f * (x1 - x0), h]); }
    const top = [[0, ha || hb], ...pts, [wpx, hb || ha]];
    const d = 'M' + top.map(([x, h]) => `${x.toFixed(1)},${(cy - h / 2).toFixed(1)}`).join('L') + 'L' + top.reverse().map(([x, h]) => `${x.toFixed(1)},${(cy + h / 2).toFixed(1)}`).join('L') + 'Z';
    svg += `<path d="${d}" fill="url(#f${k})"/><text x="-4" y="${cy + 3.5}" text-anchor="end" font-family="GM" font-weight="700" font-size="9" fill="#141414">${NODE[k]}</text>`;
  });
  const yb = rows.length * rowH + 6;
  svg += `<line x1="${x0}" y1="0" x2="${x0}" y2="${yb + 8}" stroke="#141414" stroke-width="1.5"/><line x1="${x1}" y1="0" x2="${x1}" y2="${yb + 8}" stroke="#141414" stroke-width="1.5"/>
    <text x="${(x0 + x1) / 2}" y="${yb + 20}" text-anchor="middle" font-family="IT" font-weight="900" font-size="13" fill="#141414">${len} BAR${len > 1 ? 'S' : ''}</text>
    <text x="0" y="${yb + 20}" font-family="GM" font-size="9" fill="#8a8a86">${pad(a.i + 1)} OUT</text><text x="${wpx}" y="${yb + 20}" text-anchor="end" font-family="GM" font-size="9" fill="#8a8a86">${pad(b.i + 1)} IN</text>
    <line data-txph x1="0" y1="-4" x2="0" y2="${yb + 4}" stroke="#141414" stroke-width="2"/></svg>`;
  return { svg, x0, x1, wpx };
}
function transitionPanel(el, opts = {}) {
  const LENS = [1, 2, 4, 8, 16, 32];
  function render() {
    const a = SCENES[W.sel], b = SCENES[(W.sel + 1) % SCENES.length];
    const dg = txDiagram(a, b, W.len, W.curve);
    const li = LENS.indexOf(W.len), pct = li / (LENS.length - 1) * 100;
    el.innerHTML = `
    <div class="ph"><span class="lab">Transition</span><span class="mono" style="font-size:11px;font-weight:700">${pad(a.i + 1)} → ${pad(b.i + 1)}</span></div>
    <div class="tx">
      <h2 style="font-size:30px">${esc(a.n.length > 16 ? a.n.slice(0, 15) + '…' : a.n)}</h2>
      <div style="display:flex;align-items:center;gap:8px;margin:6px 0 4px"><svg width="14" height="18" viewBox="0 0 14 18"><path d="M7 0v15M1 10l6 6 6-6" stroke="#141414" stroke-width="2.4" fill="none"/></svg>
        <span class="lab mute">${W.mode === 'jump' ? 'cut on the bar' : W.len + ' bars · ' + (W.mode === 'morph' ? 'nodes glide' : 'volumes cross')}</span></div>
      <h2 style="font-size:30px">${esc(b.n.length > 16 ? b.n.slice(0, 15) + '…' : b.n)}</h2>
      <div style="margin:22px 0 0 18px">${dg.svg}</div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:20px">
        <span class="lab">Length</span><span><b style="font-size:40px;font-weight:900;letter-spacing:-.05em">${W.mode === 'jump' ? '0' : W.len}</b> <span class="lab">bars</span></span></div>
      <div class="sl" style="opacity:${W.mode === 'jump' ? .3 : 1}"><div class="track"></div><div class="fill" style="width:${pct}%"></div><div class="knob" style="left:${pct}%"></div>
        <input type="range" min="0" max="${LENS.length - 1}" step="1" value="${li}" aria-label="Transition length in bars" data-len></div>
      <div class="ticks">${LENS.map(n => `<span>${n}</span>`).join('')}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px">
        <span class="lab">Curve</span>
        <div class="curves">${[['lin', 'M2 20L32 2'], ['ease', 'M2 20C16 20 18 2 32 2'], ['late', 'M2 20C24 20 28 14 32 2']].map(([c, d]) => `<button aria-pressed="${W.curve === c}" data-curve="${c}" aria-label="${c} curve"><svg viewBox="0 0 34 22"><path d="${d}"/></svg></button>`).join('')}</div></div>
      <div class="seg" style="margin-top:16px">${['jump', 'morph', 'fade'].map(m => `<button aria-pressed="${W.mode === m}" data-mode="${m}">${m.toUpperCase()}</button>`).join('')}</div>
      <div style="display:flex;gap:14px;margin-top:18px;align-items:flex-end">
        <svg width="112" height="112" viewBox="-1.15 -1.15 2.3 2.3" style="border:1.5px solid #141414;border-radius:6px;background:#fbfbfa;flex:none">
          <line x1="-1.2" y1="0" x2="1.2" y2="0" stroke="#dcdcd8" stroke-width=".02"/><line x1="0" y1="-1.2" x2="0" y2="1.2" stroke="#dcdcd8" stroke-width=".02"/>
          ${[0, 1, 2, 3].map(k => { const A = a.v[k] ? a.pos[k] : null, B = b.v[k] ? b.pos[k] : null; let g = '';
            if (A && B && W.mode === 'morph') g += `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="${COL[k]}" stroke-width=".05" stroke-dasharray=".08 .06"/>`;
            if (A) g += `<circle cx="${A[0]}" cy="${A[1]}" r=".12" fill="none" stroke="${COL[k]}" stroke-width=".05"/>`;
            if (B) g += `<circle cx="${B[0]}" cy="${B[1]}" r=".13" fill="${COL[k]}"/>`; return g; }).join('')}
        </svg>
        <div><div class="lab mute" style="margin-bottom:4px">${W.mode === 'morph' ? 'Positions glide' : 'Positions snap'}</div>
          <div class="lab">Starts in</div><div class="mono" data-txcd style="font-size:22px;font-weight:700;letter-spacing:-.02em">00:14.0</div>
          <button class="btn" style="margin-top:8px"><svg width="8" height="9" viewBox="0 0 8 9" style="margin-right:5px"><path d="M0 0l8 4.5L0 9z" fill="#141414"/></svg>Preview</button></div>
      </div>
    </div>`;
    el.querySelector('[data-len]').oninput = e => { W.len = LENS[+e.target.value]; render(); };
    el.querySelectorAll('[data-curve]').forEach(b => b.onclick = () => { W.curve = b.dataset.curve; render(); });
    el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { W.mode = b.dataset.mode; render(); });
    el._dg = dg;
  }
  render(); W.renderTx = render;
  tick(c => { const cd = el.querySelector('[data-txcd]'); if (cd) cd.textContent = W.sel === PLAY ? fmtS(c.left) : '—'; const ph = el.querySelector('[data-txph]'); if (!ph || !el._dg) return; const t = (performance.now() - T0) / 4000 % 1; const x = t * el._dg.wpx; ph.setAttribute('x1', x); ph.setAttribute('x2', x); });
}

/* ---------- ticker ---------- */
const TICKS = [];
function tick(fn) { TICKS.push(fn); }
function loop() { const c = clock(); const a = document.querySelector('[data-appclock]'); if (a) a.textContent = fmtS(c.app); TICKS.forEach(f => f(c)); requestAnimationFrame(loop); }
function selectScene(i) { W.sel = i; W.renderTx && W.renderTx(); W.renderWeave && W.renderWeave(); }
function boot(renderWeave) { chrome(); transitionPanel(document.getElementById('trans')); W.renderWeave = () => renderWeave(document.getElementById('weave')); W.renderWeave(); requestAnimationFrame(loop); }
