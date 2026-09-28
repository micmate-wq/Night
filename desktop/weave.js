/**
 * Aether Weave Core Engine & UI
 * Based on Approved Mockup E: BUILD / PLAY Toggle & Specification v0.1
 */

(function () {
  'use strict';

  // Canonical node names and default fallback colors (will be updated from Aether runtime)
  const NODE_NAMES = ['T1', 'T2', 'T3', 'T4'];
  const DEFAULT_COLORS = ['#FC4037', '#FFEA00', '#8B68B9', '#00D600'];

  function getNodeColors() {
    const rootStyle = getComputedStyle(document.documentElement);
    return [
      rootStyle.getPropertyValue('--track-1').trim() || DEFAULT_COLORS[0],
      rootStyle.getPropertyValue('--track-2').trim() || DEFAULT_COLORS[1],
      rootStyle.getPropertyValue('--track-3').trim() || DEFAULT_COLORS[2],
      rootStyle.getPropertyValue('--track-4').trim() || DEFAULT_COLORS[3],
    ];
  }

  // Helper formatting routines
  const pad2 = n => String(Math.floor(Math.max(0, n))).padStart(2, '0');
  const escHTML = s => String(s).replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c] || c));

  const formatMinSecTenths = sec => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const remainder = s % 60;
    const wholeSec = Math.floor(remainder);
    const tenths = Math.floor((remainder % 1) * 10);
    return `${pad2(m)}:${pad2(wholeSec)}.${tenths}`;
  };

  const marqueeHTML = (text, cls = '', duration) => {
    const d = duration || Math.max(6, text.length * 0.45);
    return `<div class="weave-mq ${cls}"><span style="--d:${d}s">${escHTML(text)}&nbsp;&nbsp;·&nbsp;&nbsp;${escHTML(text)}&nbsp;&nbsp;·&nbsp;&nbsp;</span></div>`;
  };

  // Easing curve calculations
  function easeCurve(t, type) {
    const clamped = Math.max(0, Math.min(1, t));
    if (type === 'lin') return clamped;
    if (type === 'late') return clamped * clamped * clamped;
    // S-curve ease (smoothstep)
    return clamped * clamped * (3 - 2 * clamped);
  }

  // Initial reference scenes (7 scenes matching design reference)
  const INITIAL_SCENES = [
    { name: 'Slow emergence', bars: 16, levels: [0.6, 0.0, 0.3, 0.0] },
    { name: 'Open water', bars: 32, levels: [0.8, 0.4, 0.5, 0.0] },
    { name: 'Afterglow', bars: 16, levels: [0.9, 0.3, 0.0, 0.5] },
    { name: 'Suspended', bars: 8, levels: [0.0, 0.7, 0.6, 0.0] },
    { name: 'Distant voices over the harbour', bars: 16, levels: [0.3, 0.0, 0.6, 0.8] },
    { name: 'Low tide', bars: 32, levels: [0.9, 0.5, 0.4, 0.6] },
    { name: 'First light', bars: 16, levels: [0.0, 0.7, 0.0, 0.5] }
  ];

  // Weave State Engine
  class WeaveEngine {
    constructor() {
      this.scenes = INITIAL_SCENES.map((s, idx) => ({
        id: 'scene-' + idx,
        index: idx,
        name: s.name,
        bars: s.bars,
        levels: [...s.levels],
        // Mock spatial positions [-1..1] for morph mini-map
        positions: [0, 1, 2, 3].map(k => [
          Math.sin(idx * 1.7 + k * 2.1) * 0.7,
          Math.cos(idx * 1.3 + k * 1.9) * 0.7
        ])
      }));

      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
      this.mode = q.get('mode') === 'play' ? 'play' : 'build';
      this.switchP = this.mode === 'play' ? 1 : 0;
      this.isSwitching = false;
      this.switchStartTime = 0;

      this.playingIndex = 2; // Default starting on scene 03 (Afterglow)
      this.selectedIndex = 2;

      // Single/shared transition properties
      this.transitionLengthBars = 8;
      this.transitionCurve = 'ease'; // 'lin' | 'ease' | 'late'
      this.transitionMode = 'morph'; // 'jump' | 'morph' | 'fade'

      // Transport / Timing state
      this.bpm = 120;
      this.isHolding = false;
      this.currentBarInScene = 0; // Float: e.g. 9.2 bars into scene
      this.totalBarsInProject = this.calcTotalBars();

      this.weaveEl = null;
      this.transEl = null;

      this.lastTickTime = performance.now();
      this.initKeyboard();
    }

    calcTotalBars() {
      return this.scenes.reduce((acc, s) => acc + s.bars, 0);
    }

    getBarDurationSec() {
      return (60 / this.bpm) * 4; // 4/4 time signature
    }

    initKeyboard() {
      window.addEventListener('keydown', e => {
        // Ignore keystrokes when typing in inputs/textareas
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        if (e.key === 'Tab') {
          e.preventDefault();
          this.toggleMode();
        } else if (e.code === 'Space') {
          // In PLAY mode, space acts as GO NOW
          if (this.mode === 'play') {
            e.preventDefault();
            this.goNow();
          }
        } else if (e.key === 'h' || e.key === 'H') {
          if (this.mode === 'play') {
            e.preventDefault();
            this.toggleHold();
          }
        }
      });
    }

    attach(weaveContainer, transContainer) {
      this.weaveEl = weaveContainer;
      this.transEl = transContainer;
      this.render();
      this.startLoop();
    }

    toggleMode() {
      this.setMode(this.mode === 'build' ? 'play' : 'build');
    }

    setMode(newMode) {
      if (newMode === this.mode && !this.isSwitching) return;
      this.mode = newMode;
      this.isSwitching = true;
      this.switchStartTime = performance.now();
      if (this.weaveEl) {
        this.weaveEl.classList.toggle('play', this.mode === 'play');
      }
    }

    selectScene(idx) {
      this.selectedIndex = Math.max(0, Math.min(this.scenes.length - 1, idx));
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    goNow() {
      // Immediately advance to next scene
      this.currentBarInScene = 0;
      this.playingIndex = (this.playingIndex + 1) % this.scenes.length;
      this.selectedIndex = this.playingIndex;
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    toggleHold() {
      this.isHolding = !this.isHolding;
      this.renderTransitionRight();
    }

    // Advance clock from master transport
    onTransportTick(isPlaying, bpm = 120, deltaSec = 0) {
      this.bpm = bpm;
      if (!isPlaying) return;

      const barSec = this.getBarDurationSec();
      const barsElapsed = deltaSec / barSec;
      const currentScene = this.scenes[this.playingIndex];

      this.currentBarInScene += barsElapsed;

      if (this.currentBarInScene >= currentScene.bars) {
        if (this.isHolding) {
          // Loop current scene
          this.currentBarInScene = this.currentBarInScene % currentScene.bars;
        } else {
          // Advance to next scene
          this.currentBarInScene = this.currentBarInScene - currentScene.bars;
          this.playingIndex = (this.playingIndex + 1) % this.scenes.length;
          this.selectedIndex = this.playingIndex;
          this.renderWeaveLeft();
          this.renderTransitionRight();
        }
      }
    }

    // Capture current scene snapshot seam (as requested in prompt decisions)
    captureCurrentScene() {
      const newIndex = this.scenes.length;
      const newScene = {
        id: 'scene-' + newIndex,
        index: newIndex,
        name: `Scene ${pad2(newIndex + 1)}`,
        bars: 16,
        levels: [0.7, 0.5, 0.5, 0.6],
        positions: [0, 1, 2, 3].map(k => [
          Math.sin(newIndex * 1.7 + k * 2.1) * 0.7,
          Math.cos(newIndex * 1.3 + k * 1.9) * 0.7
        ])
      };
      this.scenes.push(newScene);
      this.totalBarsInProject = this.calcTotalBars();
      this.selectScene(newIndex);
    }

    startLoop() {
      const loop = (now) => {
        // Handle mode switch animation progress p
        if (this.isSwitching) {
          const elapsed = now - this.switchStartTime;
          const duration = 460;
          let p = elapsed / duration;
          if (p >= 1) {
            p = 1;
            this.isSwitching = false;
          }
          this.switchP = this.mode === 'play' ? p : 1 - p;
          if (this.weaveEl) {
            this.weaveEl.style.setProperty('--p', this.switchP);
          }
        }

        // Internal timing progression if audio context master clock is active
        const dt = (now - this.lastTickTime) / 1000;
        this.lastTickTime = now;

        // Sync with Aether's master transport if available
        if (window.studio && window.studio.isPlaying) {
          this.onTransportTick(true, window.studio.currentBpm || 120, dt);
        }

        this.updateDynamicReadouts();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    updateDynamicReadouts() {
      if (!this.weaveEl) return;
      const currentScene = this.scenes[this.playingIndex];
      const barSec = this.getBarDurationSec();
      const barsRemaining = Math.max(0, currentScene.bars - this.currentBarInScene);
      const secondsRemaining = barsRemaining * barSec;
      const frac = Math.max(0, Math.min(1, this.currentBarInScene / currentScene.bars));
      const currentBeat = (Math.floor(this.currentBarInScene * 4) % 4) + 1;

      // 1. Loom countdown and playhead tag
      const loomCD = this.weaveEl.querySelector('[data-loom-cd]');
      if (loomCD) {
        const nextScene = this.scenes[(this.playingIndex + 1) % this.scenes.length];
        loomCD.textContent = `-${formatMinSecTenths(secondsRemaining)} → ${pad2(nextScene.index + 1)}`;
      }

      // Playhead position in Loom
      if (this.loomGeo && this.loomGeo.bands) {
        const currentBand = this.loomGeo.bands[this.playingIndex];
        if (currentBand) {
          const phGroup = this.weaveEl.querySelector('[data-ph]');
          const phLabel = this.weaveEl.querySelector('[data-phl]');
          if (phGroup && phLabel) {
            const py = currentBand.y + (this.currentBarInScene * this.loomGeo.pxPerBar);
            phGroup.setAttribute('transform', `translate(0, ${py})`);
            phLabel.textContent = this.currentBarInScene.toFixed(1);
          }
        }
      }

      // 2. Set List countdown & progress bar
      const setCD = this.weaveEl.querySelector('[data-set-cd]');
      if (setCD) {
        setCD.textContent = formatMinSecTenths(secondsRemaining);
      }
      const setProg = this.weaveEl.querySelector('[data-set-prog]');
      if (setProg) {
        setProg.style.width = `${(frac * 100).toFixed(1)}%`;
      }

      // 3. Right transition panel countdown & playhead
      if (this.transEl) {
        const txCD = this.transEl.querySelector('[data-txcd]');
        if (txCD) {
          txCD.textContent = this.selectedIndex === this.playingIndex ? formatMinSecTenths(secondsRemaining) : '—';
        }
        // PLAY view bars-to-go and beat blocks
        const barsLeftEl = this.transEl.querySelector('[data-bars-to-go]');
        if (barsLeftEl) {
          barsLeftEl.textContent = Math.ceil(barsRemaining);
        }
        const beatBlocks = this.transEl.querySelectorAll('.weave-play-beat-block');
        beatBlocks.forEach((block, idx) => {
          block.classList.toggle('active', idx + 1 <= currentBeat);
        });

        // Transition fade bars preview sweep (4s loop)
        const txPh = this.transEl.querySelector('[data-txph]');
        if (txPh && this.txDiagramWidth) {
          const t = ((performance.now() / 4000) % 1);
          const x = t * this.txDiagramWidth;
          txPh.setAttribute('x1', x.toFixed(1));
          txPh.setAttribute('x2', x.toFixed(1));
        }
      }
    }

    /* ========================================================================
       RENDER: LEFT GUTTER (WEAVE PANEL)
       ======================================================================== */
    render() {
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    renderWeaveLeft() {
      if (!this.weaveEl) return;
      const isCrowded = this.scenes.length > 8;

      this.weaveEl.innerHTML = `
        <div class="weave-toggle">
          <div class="wt-switch">
            <span class="wt-block"></span>
            <button type="button" data-mode-btn="build">BUILD</button>
            <button type="button" data-mode-btn="play">PLAY</button>
          </div>
          <div class="wt-key" title="Press Tab to switch modes">
            TAB
            <small>switch</small>
          </div>
        </div>

        <div class="weave-lay weave-lay-build">
          ${this.buildLoomHTML()}
        </div>

        <div class="weave-lay weave-lay-play">
          ${this.buildSetListHTML(isCrowded)}
        </div>
      `;

      // Bind toggle interactions
      this.weaveEl.querySelectorAll('[data-mode-btn]').forEach(btn => {
        btn.onclick = () => this.setMode(btn.dataset.modeBtn);
      });
      const keyCap = this.weaveEl.querySelector('.wt-key');
      if (keyCap) {
        keyCap.onclick = () => this.toggleMode();
      }

      // Bind scene selections in Loom
      this.weaveEl.querySelectorAll('.weave-loom-band-label').forEach(el => {
        el.onclick = () => this.selectScene(+el.dataset.sceneIndex);
      });

      // Bind scene selections in Set List
      this.weaveEl.querySelectorAll('.weave-set-row').forEach(el => {
        el.onclick = () => this.selectScene(+el.dataset.sceneIndex);
      });

      // Bind "+ Scene" button
      const addSceneBtn = this.weaveEl.querySelector('[data-add-scene]');
      if (addSceneBtn) {
        addSceneBtn.onclick = () => this.captureCurrentScene();
      }

      this.weaveEl.style.setProperty('--p', this.mode === 'play' ? 1 : 0);
      this.weaveEl.classList.toggle('play', this.mode === 'play');
    }

    buildLoomHTML() {
      const width = 300;
      const top = 70;
      const footH = 46;
      const availH = 760 - top - footH - 10;
      const totalBars = this.calcTotalBars();
      const pxPerBar = Math.min(5, availH / Math.max(1, totalBars));
      const laneX = [172, 202, 232, 262];
      const maxThick = 24;
      const isCrowded = this.scenes.length > 8;
      const barH = isCrowded ? 4 : 7;
      const colors = getNodeColors();

      let currY = top;
      const bands = this.scenes.map(s => {
        const h = s.bars * pxPerBar;
        const b = { s, y: currY, h };
        currY += h;
        return b;
      });
      this.loomGeo = { bands, pxPerBar };

      const getThick = (s, k) => s.levels[k] ? Math.max(3, s.levels[k] * maxThick) : 0;

      // 1. Scene backgrounds
      let bgSVG = '';
      bands.forEach(({ s, y, h }) => {
        const isPlaying = s.index === this.playingIndex;
        const isSel = s.index === this.selectedIndex && !isPlaying;
        bgSVG += `<rect x="0" y="${y}" width="${width}" height="${h}" fill="${isPlaying ? 'var(--weave-playing-band)' : '#ffffff'}"/>`;
        if (isSel) {
          bgSVG += `<rect x="0" y="${y}" width="150" height="${h}" fill="var(--weave-ink)"/>`;
        }
      });

      // 2. Continuous threads with transition tapers
      let threadsSVG = '';
      bands.forEach((b, bi) => {
        const prev = bands[bi - 1];
        [0, 1, 2, 3].forEach(k => {
          const w1 = prev ? getThick(prev.s, k) : getThick(b.s, k);
          const w2 = getThick(b.s, k);
          const taperZone = Math.min(b.h, this.transitionMode === 'jump' ? 0.01 : this.transitionLengthBars * pxPerBar);
          if (!w1 && !w2) return;
          const x = laneX[k];
          const y0 = b.y;
          const y1 = b.y + taperZone;
          const y2 = b.y + b.h;
          threadsSVG += `<path d="M${x - w1 / 2},${y0}L${x + w1 / 2},${y0}L${x + w2 / 2},${y1}L${x + w2 / 2},${y2}L${x - w2 / 2},${y2}L${x - w2 / 2},${y1}Z" fill="${colors[k]}"/>`;
        });
      });

      // 3. Black scene separator bars with weave over/under logic
      let barsSVG = '';
      bands.forEach((b, bi) => {
        barsSVG += `<rect x="0" y="${b.y}" width="${width}" height="${barH}" fill="var(--weave-ink)"/>`;
        [0, 1, 2, 3].forEach(k => {
          // Weave effect: lane where (sceneIndex + lane) is even is drawn OVER the black bar
          if ((bi + k) % 2 === 0) {
            const pw = getThick(b.s, k);
            const pp = bands[bi - 1] ? getThick(bands[bi - 1].s, k) : pw;
            const w = Math.max(pw, pp);
            if (w) {
              threadsSVG += `<rect x="${laneX[k] - w / 2}" y="${b.y}" width="${w}" height="${barH}" fill="${colors[k]}"/>`;
            }
          }
        });
      });
      // Closing bar after last scene
      barsSVG += `<rect x="0" y="${currY}" width="${width}" height="${barH}" fill="var(--weave-ink)"/>`;

      // 4. Text labels block
      let labelsHTML = '';
      bands.forEach(({ s, y, h }) => {
        const isPlaying = s.index === this.playingIndex;
        const isSel = s.index === this.selectedIndex && !isPlaying;
        const textColor = isSel ? '#ffffff' : 'var(--weave-ink)';
        const small = h < 30 || (isPlaying && h < 72);
        const bigFontSize = small
          ? Math.max(14, Math.min(22, h * 0.5))
          : isPlaying
            ? Math.min(34, h * 0.4)
            : Math.max(15, Math.min(46, (h - 12) * 0.55));

        labelsHTML += `
          <div class="weave-loom-band-label" data-scene-index="${s.index}" style="position:absolute;left:14px;top:${y + barH + 2}px;width:136px;height:${h - barH - 2}px;color:${textColor};display:flex;${small ? 'align-items:center;gap:7px;' : 'flex-direction:column;justify-content:center;'};overflow:hidden;cursor:pointer;">
            <div style="display:flex;align-items:baseline;gap:6px">
              <b style="font-size:${bigFontSize}px;font-weight:900;letter-spacing:-0.06em;line-height:0.85">${pad2(s.index + 1)}</b>
              <span class="weave-mono" style="font-size:10px;font-weight:700;opacity:0.7">${s.bars}b</span>
            </div>
            <div style="font-size:${small ? 11 : 12.5}px;font-weight:800;width:${small ? (isPlaying ? 92 : 118) : 124}px;margin-top:${small ? 0 : 3}px">
              ${isPlaying ? marqueeHTML(s.name) : `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(s.name)}</div>`}
            </div>
            ${isPlaying && !small ? `<div class="weave-mono" data-loom-cd style="font-size:11px;font-weight:700;margin-top:4px;color:var(--weave-ink)"></div>` : ''}
          </div>
        `;
      });

      const totalTimeSec = totalBars * this.getBarDurationSec();

      return `
        <div class="weave-loom-lanes-header">
          ${laneX.map((x, k) => `<span style="position:absolute;left:${x - 8}px;color:${k === 1 ? 'var(--weave-node-t2-text)' : colors[k]}">${NODE_NAMES[k]}</span>`).join('')}
        </div>
        <svg width="${width}" height="760" style="position:absolute;left:0;top:0">${bgSVG}</svg>
        <svg class="threads" width="${width}" height="760" style="position:absolute;left:0;top:0">${threadsSVG}</svg>
        <div class="labels">
          <svg width="${width}" height="760" style="position:absolute;left:0;top:0">
            ${barsSVG}
            <g data-ph>
              <line x1="0" x2="${width}" y1="0" y2="0" stroke="var(--weave-ink)" stroke-width="2"/>
              <rect x="${width - 58}" y="-9" width="58" height="18" fill="var(--weave-ink)"/>
              <text data-phl x="${width - 29}" y="4" text-anchor="middle" font-family="var(--weave-font-mono)" font-weight="700" font-size="10" fill="#ffffff"></text>
            </g>
          </svg>
          ${labelsHTML}
        </div>
        <div class="weave-loom-footer">
          <button type="button" class="weave-btn solid" data-add-scene>+ Scene</button>
          <span class="weave-mono" style="font-size:11px;font-weight:700">${totalBars} bars · ${pad2(totalTimeSec / 60)}:${pad2(totalTimeSec % 60)}</span>
        </div>
      `;
    }

    buildSetListHTML(isCrowded) {
      const playingScene = this.scenes[this.playingIndex];
      const nextScene = this.scenes[(this.playingIndex + 1) % this.scenes.length];
      const totalBars = this.calcTotalBars();
      const colors = getNodeColors();

      return `
        <div class="weave-sheet ${isCrowded ? 'crowd' : ''}">
          <div class="weave-tape"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span class="weave-label">Set · ${this.scenes.length} scenes</span>
            <span class="weave-label weave-mute">${totalBars} bars</span>
          </div>

          <div class="weave-mono" data-set-cd style="font-size:${isCrowded ? 48 : 60}px;font-weight:800;letter-spacing:-0.07em;line-height:1;margin-top:${isCrowded ? 8 : 14}px">
            00:00.0
          </div>
          <div class="weave-label" style="margin-top:2px">
            till ${pad2(nextScene.index + 1)} · ${this.transitionMode} ${this.transitionLengthBars} bars
          </div>

          <div style="margin-top:${isCrowded ? 8 : 12}px;display:flex;gap:8px;align-items:flex-start">
            <b style="font-size:17px;font-weight:900;background:var(--weave-ink);color:var(--weave-playing-accent);padding:3px 5px 2px;line-height:1">
              ${pad2(playingScene.index + 1)}
            </b>
            <div style="font-size:${isCrowded ? 42 : 54}px;font-weight:900;letter-spacing:-0.065em;line-height:0.9;text-transform:uppercase;width:216px;padding-bottom:2px">
              ${marqueeHTML(playingScene.name, '', 7)}
            </div>
          </div>

          <div style="display:flex;gap:3px;margin:8px 0 4px 33px">
            ${playingScene.levels.map((v, k) => v ? `<i style="display:block;height:10px;width:${14 + v * 40}px;background:${colors[k]}"></i>` : '').join('')}
          </div>

          <div style="height:4px;background:var(--weave-progress-track);margin:10px 0 2px;position:relative">
            <i data-set-prog style="position:absolute;left:0;top:-4px;height:12px;width:0%;background:var(--weave-ink);display:block"></i>
          </div>

          <div style="margin-top:4px">
            ${this.scenes.map((s, idx) => {
              if (idx === this.playingIndex) return '';
              const isPast = idx < this.playingIndex;
              const isSel = idx === this.selectedIndex;
              return `
                <div class="weave-set-row ${isPast ? 'past' : ''} ${isSel ? 'sel' : ''}" data-scene-index="${idx}">
                  <span class="sr-no">${pad2(idx + 1)}</span>
                  <span class="sr-title">${escHTML(s.name)}</span>
                  ${isCrowded ? '' : `<span class="sr-bars">${s.bars}</span><span></span>`}
                  <span class="sr-ticks">
                    ${s.levels.map((v, k) => `<i style="background:${v ? colors[k] : 'transparent'};${v ? '' : 'box-shadow:inset 0 0 0 1px var(--weave-tick-empty)'}"></i>`).join('')}
                  </span>
                  ${isCrowded ? `<span class="sr-bars">${s.bars}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    /* ========================================================================
       RENDER: RIGHT GUTTER (TRANSITION PANEL - BUILD & PLAY)
       ======================================================================== */
    renderTransitionRight() {
      if (!this.transEl) return;
      if (this.mode === 'play') {
        this.renderPlayTransition();
      } else {
        this.renderBuildTransition();
      }
    }

    renderBuildTransition() {
      const fromScene = this.scenes[this.selectedIndex];
      const toScene = this.scenes[(this.selectedIndex + 1) % this.scenes.length];
      const LENS = [1, 2, 4, 8, 16, 32];
      const lenIdx = LENS.indexOf(this.transitionLengthBars);
      const pct = (lenIdx / (LENS.length - 1)) * 100;
      const diagram = this.generateFadeBarsSVG(fromScene, toScene, this.transitionLengthBars, this.transitionCurve);
      this.txDiagramWidth = diagram.width;

      this.transEl.innerHTML = `
        <div class="weave-tx-header">
          <span class="weave-label">Transition</span>
          <span class="weave-mono" style="font-size:11px;font-weight:700">${pad2(fromScene.index + 1)} → ${pad2(toScene.index + 1)}</span>
        </div>

        <div class="weave-tx-body">
          <h2>${escHTML(fromScene.name.length > 16 ? fromScene.name.slice(0, 15) + '…' : fromScene.name)}</h2>
          <div style="display:flex;align-items:center;gap:8px;margin:6px 0 4px">
            <svg width="14" height="18" viewBox="0 0 14 18"><path d="M7 0v15M1 10l6 6 6-6" stroke="var(--weave-ink)" stroke-width="2.4" fill="none"/></svg>
            <span class="weave-label weave-mute">
              ${this.transitionMode === 'jump' ? 'cut on the bar' : `${this.transitionLengthBars} bars · ${this.transitionMode === 'morph' ? 'nodes glide' : 'volumes cross'}`}
            </span>
          </div>
          <h2>${escHTML(toScene.name.length > 16 ? toScene.name.slice(0, 15) + '…' : toScene.name)}</h2>

          <div style="margin:22px 0 0 18px">
            ${diagram.svg}
          </div>

          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:20px">
            <span class="weave-label">Length</span>
            <span>
              <b style="font-size:40px;font-weight:900;letter-spacing:-0.05em">${this.transitionMode === 'jump' ? '0' : this.transitionLengthBars}</b>
              <span class="weave-label">bars</span>
            </span>
          </div>

          <div class="weave-sl" style="opacity:${this.transitionMode === 'jump' ? 0.3 : 1}">
            <div class="track"></div>
            <div class="fill" style="width:${pct}%"></div>
            <div class="knob" style="left:${pct}%"></div>
            <input type="range" min="0" max="${LENS.length - 1}" step="1" value="${lenIdx}" aria-label="Transition length in bars" data-len-slider>
          </div>
          <div class="weave-ticks">
            ${LENS.map(n => `<span>${n}</span>`).join('')}
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px">
            <span class="weave-label">Curve</span>
            <div class="weave-curves">
              ${[['lin', 'M2 20L32 2'], ['ease', 'M2 20C16 20 18 2 32 2'], ['late', 'M2 20C24 20 28 14 32 2']].map(([c, d]) => `
                <button type="button" aria-pressed="${this.transitionCurve === c}" data-curve="${c}" aria-label="${c} curve">
                  <svg viewBox="0 0 34 22"><path d="${d}"/></svg>
                </button>
              `).join('')}
            </div>
          </div>

          <div class="weave-seg" style="margin-top:16px">
            ${['jump', 'morph', 'fade'].map(m => `
              <button type="button" aria-pressed="${this.transitionMode === m}" data-mode="${m}">${m.toUpperCase()}</button>
            `).join('')}
          </div>

          <div style="display:flex;gap:14px;margin-top:18px;align-items:flex-end">
            ${this.buildMorphMapSVG(fromScene, toScene)}
            <div>
              <div class="weave-label weave-mute" style="margin-bottom:4px">
                ${this.transitionMode === 'morph' ? 'Positions glide' : 'Positions snap'}
              </div>
              <div class="weave-label">Starts in</div>
              <div class="weave-mono" data-txcd style="font-size:22px;font-weight:700;letter-spacing:-0.02em">
                00:00.0
              </div>
              <button type="button" class="weave-btn" data-preview-btn style="margin-top:8px">
                <svg width="8" height="9" viewBox="0 0 8 9" style="margin-right:5px"><path d="M0 0l8 4.5L0 9z" fill="var(--weave-ink)"/></svg>
                Preview
              </button>
            </div>
          </div>
        </div>
      `;

      // Slider listener
      const slider = this.transEl.querySelector('[data-len-slider]');
      if (slider) {
        slider.oninput = e => {
          this.transitionLengthBars = LENS[+e.target.value];
          this.renderTransitionRight();
          this.renderWeaveLeft();
        };
      }

      // Curve buttons
      this.transEl.querySelectorAll('[data-curve]').forEach(b => {
        b.onclick = () => {
          this.transitionCurve = b.dataset.curve;
          this.renderTransitionRight();
        };
      });

      // Mode buttons
      this.transEl.querySelectorAll('[data-mode]').forEach(b => {
        b.onclick = () => {
          this.transitionMode = b.dataset.mode;
          this.renderTransitionRight();
          this.renderWeaveLeft();
        };
      });

      // Preview button trigger
      const previewBtn = this.transEl.querySelector('[data-preview-btn]');
      if (previewBtn) {
        previewBtn.onclick = () => {
          this.goNow();
        };
      }
    }

    renderPlayTransition() {
      const fromScene = this.scenes[this.playingIndex];
      const toScene = this.scenes[(this.playingIndex + 1) % this.scenes.length];
      const diagram = this.generateFadeBarsSVG(fromScene, toScene, this.transitionLengthBars, this.transitionCurve);
      this.txDiagramWidth = diagram.width;

      this.transEl.innerHTML = `
        <div class="weave-tx-header">
          <span class="weave-label">Next</span>
          <span class="weave-mono" style="font-size:11px;font-weight:700">${pad2(fromScene.index + 1)} → ${pad2(toScene.index + 1)}</span>
        </div>

        <div class="weave-play-tx">
          <div style="display:flex;align-items:baseline;gap:8px">
            <span class="weave-play-big-num" data-bars-to-go>8</span>
            <div style="font-size:22px;font-weight:900;letter-spacing:-0.04em;line-height:0.95">
              bars<br>to go
            </div>
          </div>

          <div class="weave-play-beat-blocks">
            <i class="weave-play-beat-block active"></i>
            <i class="weave-play-beat-block"></i>
            <i class="weave-play-beat-block"></i>
            <i class="weave-play-beat-block"></i>
            <span class="weave-label weave-mute" style="margin-left:4px">BEAT</span>
          </div>

          <h2 style="font-size:40px;font-weight:900;letter-spacing:-0.045em;line-height:0.9;text-transform:uppercase;margin:8px 0 4px">
            ${escHTML(toScene.name)}
          </h2>

          <div class="weave-label weave-mute" style="margin-bottom:14px">
            ${this.transitionMode} · ${this.transitionLengthBars} bars · ${this.transitionCurve} curve
          </div>

          <div style="margin:6px 0 0 18px">
            ${diagram.svg}
          </div>

          <div style="margin-top:auto;padding-bottom:16px">
            <button type="button" class="weave-gobtn solid" data-go-now>
              GO NOW
            </button>
            <button type="button" class="weave-gobtn ${this.isHolding ? 'held' : ''}" data-hold style="margin-top:10px">
              HOLD ${pad2(fromScene.index + 1)}
            </button>
            <div class="weave-mute" style="text-align:center;font-size:9.5px;font-weight:700;letter-spacing:0.04em;margin-top:8px">
              Space = go · H = hold (loops the scene)
            </div>
          </div>
        </div>
      `;

      const goBtn = this.transEl.querySelector('[data-go-now]');
      if (goBtn) goBtn.onclick = () => this.goNow();

      const holdBtn = this.transEl.querySelector('[data-hold]');
      if (holdBtn) holdBtn.onclick = () => this.toggleHold();
    }

    generateFadeBarsSVG(a, b, lenBars, curve, widthPx = 236) {
      const colors = getNodeColors();
      const pre = 4;
      const post = 4;
      const tot = pre + lenBars + post;
      const unit = widthPx / tot;
      const x0 = pre * unit;
      const x1 = (pre + lenBars) * unit;
      const rowH = 30;
      const rows = [0, 1, 2, 3].filter(k => a.levels[k] || b.levels[k]);

      let svg = `<svg width="${widthPx}" height="${rows.length * rowH + 34}" viewBox="0 0 ${widthPx} ${rows.length * rowH + 34}" style="display:block;overflow:visible"><defs>`;

      rows.forEach(k => {
        const inA = a.levels[k] > 0;
        const inB = b.levels[k] > 0;
        const stops = Array.from({ length: 9 }, (_, i) => {
          const f = i / 8;
          const e = easeCurve(f, curve);
          const o = inA && inB ? 1 : inA ? 1 - e : e;
          return `<stop offset="${((x0 + f * (x1 - x0)) / widthPx).toFixed(3)}" stop-color="${colors[k]}" stop-opacity="${o.toFixed(2)}"/>`;
        }).join('');
        svg += `
          <linearGradient id="f${k}" gradientUnits="userSpaceOnUse" x1="0" x2="${widthPx}" y1="0" y2="0">
            <stop offset="0" stop-color="${colors[k]}" stop-opacity="${inA ? 1 : 0}"/>
            ${stops}
            <stop offset="1" stop-color="${colors[k]}" stop-opacity="${inB ? 1 : 0}"/>
          </linearGradient>
        `;
      });
      svg += '</defs>';

      // Overlap zone background
      svg += `<rect x="${x0.toFixed(1)}" y="0" width="${(x1 - x0).toFixed(1)}" height="${rows.length * rowH + 6}" fill="var(--weave-tint)"/>`;

      rows.forEach((k, r) => {
        const cy = r * rowH + rowH / 2 + 3;
        const ha = Math.max(a.levels[k], 0.08) * 22 * (a.levels[k] ? 1 : 0);
        const hb = b.levels[k] * 22;
        const pts = [];
        const N = 16;
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const e = easeCurve(f, curve);
          const h = a.levels[k] && b.levels[k] ? ha + (hb - ha) * e : a.levels[k] ? ha : hb;
          pts.push([x0 + f * (x1 - x0), h]);
        }
        const topPts = [[0, ha || hb], ...pts, [widthPx, hb || ha]];
        const d = 'M' + topPts.map(([x, h]) => `${x.toFixed(1)},${(cy - h / 2).toFixed(1)}`).join('L') +
                  'L' + topPts.reverse().map(([x, h]) => `${x.toFixed(1)},${(cy + h / 2).toFixed(1)}`).join('L') + 'Z';
        svg += `<path d="${d}" fill="url(#f${k})"/><text x="-4" y="${cy + 3.5}" text-anchor="end" font-family="var(--weave-font-mono)" font-weight="700" font-size="9" fill="var(--weave-ink)">${NODE_NAMES[k]}</text>`;
      });

      const yb = rows.length * rowH + 6;
      svg += `
        <line x1="${x0.toFixed(1)}" y1="0" x2="${x0.toFixed(1)}" y2="${yb + 8}" stroke="var(--weave-ink)" stroke-width="1.5"/>
        <line x1="${x1.toFixed(1)}" y1="0" x2="${x1.toFixed(1)}" y2="${yb + 8}" stroke="var(--weave-ink)" stroke-width="1.5"/>
        <text x="${((x0 + x1) / 2).toFixed(1)}" y="${yb + 20}" text-anchor="middle" font-family="var(--weave-font-sans)" font-weight="900" font-size="13" fill="var(--weave-ink)">${lenBars} BAR${lenBars > 1 ? 'S' : ''}</text>
        <text x="0" y="${yb + 20}" font-family="var(--weave-font-mono)" font-size="9" fill="var(--weave-text-muted)">${pad2(a.index + 1)} OUT</text>
        <text x="${widthPx}" y="${yb + 20}" text-anchor="end" font-family="var(--weave-font-mono)" font-size="9" fill="var(--weave-text-muted)">${pad2(b.index + 1)} IN</text>
        <line data-txph x1="0" y1="-4" x2="0" y2="${yb + 4}" stroke="var(--weave-ink)" stroke-width="2"/>
      </svg>`;

      return { svg, width: widthPx };
    }

    buildMorphMapSVG(a, b) {
      const colors = getNodeColors();
      let nodesMarkup = '';
      [0, 1, 2, 3].forEach(k => {
        const posA = a.levels[k] ? a.positions[k] : null;
        const posB = b.levels[k] ? b.positions[k] : null;
        if (posA && posB && this.transitionMode === 'morph') {
          nodesMarkup += `<line x1="${posA[0]}" y1="${posA[1]}" x2="${posB[0]}" y2="${posB[1]}" stroke="${colors[k]}" stroke-width=".05" stroke-dasharray=".08 .06"/>`;
        }
        if (posA) {
          nodesMarkup += `<circle cx="${posA[0]}" cy="${posA[1]}" r=".12" fill="none" stroke="${colors[k]}" stroke-width=".05"/>`;
        }
        if (posB) {
          nodesMarkup += `<circle cx="${posB[0]}" cy="${posB[1]}" r=".13" fill="${colors[k]}"/>`;
        }
      });

      return `
        <svg width="112" height="112" viewBox="-1.15 -1.15 2.3 2.3" style="border:1.5px solid var(--weave-ink);border-radius:6px;background:var(--weave-surface-canvas);flex:none">
          <line x1="-1.2" y1="0" x2="1.2" y2="0" stroke="var(--weave-border-subtle)" stroke-width=".02"/>
          <line x1="0" y1="-1.2" x2="0" y2="1.2" stroke="var(--weave-border-subtle)" stroke-width=".02"/>
          ${nodesMarkup}
        </svg>
      `;
    }
  }

  // Export engine instance to window
  window.weaveEngine = new WeaveEngine();

  // Auto-boot when DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    const weaveContainer = document.getElementById('weave');
    const transContainer = document.getElementById('trans');
    if (weaveContainer && transContainer) {
      window.weaveEngine.attach(weaveContainer, transContainer);
    }
  });

})();
