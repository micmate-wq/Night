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
      this.editingIndex = null;
      this._nextSceneUid = INITIAL_SCENES.length;

      // Single/shared transition properties
      this.transitionLengthBars = 8;
      this.transitionCurve = 'ease'; // 'lin' | 'ease' | 'late'
      this.transitionMode = 'morph'; // 'jump' | 'morph' | 'fade'

      // Transport / Timing state
      this.bpm = 120;
      this.isHolding = false;
      this.currentBarInScene = 0; // Float: e.g. 9.2 bars into scene
      this.totalBarsInProject = this.calcTotalBars();
      this.loomScrollTop = 0;

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
      const scene = this.scenes[this.selectedIndex];

      // Recall spatial state if this scene contains a captured real snapshot
      if (scene && scene.spatialState && window.studio && Array.isArray(window.studio.tracks)) {
        const keys = ['T1', 'T2', 'T3', 'T4'];
        keys.forEach((key, i) => {
          const track = window.studio.tracks[i];
          const nodeState = scene.spatialState[key];
          if (track && nodeState) {
            track.setPosition(nodeState.x, nodeState.y, nodeState.z !== undefined ? nodeState.z : 0);
          }
        });
        if (typeof window.studio.drawArena === 'function') {
          window.studio.drawArena();
        }
      }

      this.renderWeaveLeft();
      this.renderTransitionRight();

      // Keep selected scene within Loom viewport
      if (this.loomGeo && this.loomGeo.bands) {
        const targetBand = this.loomGeo.bands[this.selectedIndex];
        const vp = this.weaveEl ? this.weaveEl.querySelector('#weave-loom-viewport') : null;
        if (vp && targetBand) {
          if (targetBand.y < vp.scrollTop) {
            vp.scrollTo({ top: targetBand.y, behavior: 'smooth' });
          } else if (targetBand.y + targetBand.h > vp.scrollTop + vp.clientHeight) {
            vp.scrollTo({ top: targetBand.y + targetBand.h - vp.clientHeight, behavior: 'smooth' });
          }
        }
      }
    }

    adjustScene(idx) {
      this.tweakScene(idx);
    }

    tweakScene(idx) {
      if (idx < 0 || idx >= this.scenes.length) return;
      this.editingIndex = idx;
      const scene = this.scenes[this.editingIndex];
      if (!scene) return;

      // 1. Recall spatial snapshot into the real Aether canvas
      if (scene.spatialState && window.studio && Array.isArray(window.studio.tracks)) {
        const keys = ['T1', 'T2', 'T3', 'T4'];
        keys.forEach((key, i) => {
          const track = window.studio.tracks[i];
          const nodeState = scene.spatialState[key];
          if (track && nodeState) {
            track.setPosition(nodeState.x, nodeState.y, nodeState.z !== undefined ? nodeState.z : 0);
          }
        });
        if (typeof window.studio.drawArena === 'function') {
          window.studio.drawArena();
        }
      } else if (window.studio && Array.isArray(window.studio.tracks) && window.studio.tracks.length >= 4) {
        // Initialize authoritative spatial snapshot from current tracks
        const tracks = window.studio.tracks;
        scene.spatialState = {
          T1: { x: tracks[0].x, y: tracks[0].y, z: tracks[0].z },
          T2: { x: tracks[1].x, y: tracks[1].y, z: tracks[1].z },
          T3: { x: tracks[2].x, y: tracks[2].y, z: tracks[2].z },
          T4: { x: tracks[3].x, y: tracks[3].y, z: tracks[3].z }
        };
      }

      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    exitAdjust(e) {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      this.editingIndex = null;
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    onNodeDragEnd() {
      if (this.editingIndex === null || this.editingIndex < 0 || this.editingIndex >= this.scenes.length) return;
      const scene = this.scenes[this.editingIndex];
      if (!scene) return;
      if (!window.studio || !Array.isArray(window.studio.tracks) || window.studio.tracks.length < 4) return;

      const tracks = window.studio.tracks;
      scene.spatialState = {
        T1: { x: tracks[0].x, y: tracks[0].y, z: tracks[0].z },
        T2: { x: tracks[1].x, y: tracks[1].y, z: tracks[1].z },
        T3: { x: tracks[2].x, y: tracks[2].y, z: tracks[2].z },
        T4: { x: tracks[3].x, y: tracks[3].y, z: tracks[3].z }
      };
      scene.levels = [tracks[0].y, tracks[1].y, tracks[2].y, tracks[3].y];
      scene.positions = [0, 1, 2, 3].map(k => [
        (tracks[k].x - 0.5) * 2.0,
        (tracks[k].y - 0.5) * 2.0
      ]);

      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    deleteScene(idx) {
      if (idx < 0 || idx >= this.scenes.length) return false;
      // Guard against deleting actively playing scene
      if (idx === this.playingIndex) {
        console.warn(`[Weave] Cannot delete actively playing scene ${pad2(idx + 1)}`);
        return false;
      }
      if (this.scenes.length <= 1) {
        console.warn('[Weave] Cannot delete the only remaining scene');
        return false;
      }

      this.scenes.splice(idx, 1);
      // Renumber visible position/index only; preserve stable internal scene IDs
      this.scenes.forEach((s, i) => {
        s.index = i;
      });
      this.totalBarsInProject = this.calcTotalBars();

      if (this.selectedIndex === idx) {
        this.selectedIndex = Math.min(idx, this.scenes.length - 1);
      } else if (this.selectedIndex > idx) {
        this.selectedIndex--;
      }

      if (this.editingIndex === idx) {
        this.editingIndex = null;
      } else if (this.editingIndex !== null && this.editingIndex > idx) {
        this.editingIndex--;
      }

      if (this.playingIndex > idx) {
        this.playingIndex--;
      }

      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
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

    // Capture current scene snapshot from live Aether spatial state
    captureCurrentScene() {
      const newIndex = this.scenes.length;
      let spatialState = null;
      let levels = [0.7, 0.5, 0.5, 0.6];
      let positions = [0, 1, 2, 3].map(k => [
        Math.sin(newIndex * 1.7 + k * 2.1) * 0.7,
        Math.cos(newIndex * 1.3 + k * 1.9) * 0.7
      ]);

      if (window.studio && Array.isArray(window.studio.tracks) && window.studio.tracks.length >= 4) {
        const tracks = window.studio.tracks;
        spatialState = {
          T1: { x: tracks[0].x, y: tracks[0].y, z: tracks[0].z },
          T2: { x: tracks[1].x, y: tracks[1].y, z: tracks[1].z },
          T3: { x: tracks[2].x, y: tracks[2].y, z: tracks[2].z },
          T4: { x: tracks[3].x, y: tracks[3].y, z: tracks[3].z }
        };
        // Normalized volume level for Loom ribbon thickness
        levels = [tracks[0].y, tracks[1].y, tracks[2].y, tracks[3].y];
        // Normalized coordinate map [-1..1] for transition mini-map
        positions = [0, 1, 2, 3].map(k => [
          (tracks[k].x - 0.5) * 2.0,
          (tracks[k].y - 0.5) * 2.0
        ]);
      }

      const sceneUid = this._nextSceneUid++;
      const newScene = {
        id: 'scene-uid-' + sceneUid,
        index: newIndex,
        name: `Scene ${pad2(newIndex + 1)}`,
        bars: 16,
        levels,
        positions,
        spatialState
      };
      this.scenes.push(newScene);
      this.totalBarsInProject = this.calcTotalBars();
      this.selectScene(newIndex);
      const vp = this.weaveEl ? this.weaveEl.querySelector('#weave-loom-viewport') : null;
      if (vp) {
        vp.scrollTo({ top: vp.scrollHeight, behavior: 'smooth' });
      }
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

      // Preserve scroll position across renders
      const prevVp = this.weaveEl.querySelector('#weave-loom-viewport');
      if (prevVp) {
        this.loomScrollTop = prevVp.scrollTop;
      }

      this.weaveEl.innerHTML = `
        <div class="weave-toggle">
          <div class="wt-switch">
            <span class="wt-block"></span>
            <button type="button" data-mode-btn="build">BUILD</button>
            <button type="button" data-mode-btn="play">PLAY</button>
          </div>
          <div class="wt-key-wrap">
            <button type="button" class="wt-key" data-add-scene title="Capture current scene (+ Scene)">
              <span class="wt-key-plus">+</span>
              <small>scene</small>
            </button>
            <div class="weave-del-target" id="weave-del-target" title="Delete Scene">
              <span class="wdt-x">×</span>
            </div>
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

      // Bind "+ Scene" keycap button in header (available in both BUILD and PLAY)
      const addSceneBtn = this.weaveEl.querySelector('[data-add-scene]');
      if (addSceneBtn) {
        addSceneBtn.onclick = () => this.captureCurrentScene();
      }

      // Restore scroll and bind Loom scroll viewport + side buttons
      const loomVp = this.weaveEl.querySelector('#weave-loom-viewport');
      if (loomVp) {
        loomVp.scrollTop = this.loomScrollTop;
        loomVp.addEventListener('scroll', () => {
          this.loomScrollTop = loomVp.scrollTop;
        }, { passive: true });
      }
      const scrollUpBtn = this.weaveEl.querySelector('[data-loom-scroll="up"]');
      const scrollDownBtn = this.weaveEl.querySelector('[data-loom-scroll="down"]');
      if (scrollUpBtn && loomVp) {
        scrollUpBtn.onclick = () => loomVp.scrollBy({ top: -110, behavior: 'smooth' });
      }
      if (scrollDownBtn && loomVp) {
        scrollDownBtn.onclick = () => loomVp.scrollBy({ top: 110, behavior: 'smooth' });
      }

      // Bind horizontal swipe gesture on Loom scene rows
      const THRESHOLD_TWEAK = 64;
      const THRESHOLD_DELETE = 185;
      const MAX_DRAG = 240;
      const delTarget = this.weaveEl.querySelector('#weave-del-target');

      this.weaveEl.querySelectorAll('.weave-loom-row-wrap').forEach(rowWrap => {
        const sceneIdx = +rowWrap.dataset.sceneIndex;
        const card = rowWrap.querySelector('.weave-loom-row-card');
        if (!card) return;

        let startX = 0;
        let startY = 0;
        let isDown = false;
        let gestureLocked = null; // null | 'horizontal' | 'vertical'
        let dragX = 0;

        const onPointerDown = (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          if (e.target && e.target.closest('[data-done-adjust]')) return;
          isDown = true;
          startX = e.clientX;
          startY = e.clientY;
          gestureLocked = null;
          dragX = 0;
          card.style.transition = 'none';
        };

        const onPointerMove = (e) => {
          if (!isDown) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          if (gestureLocked === null) {
            const dist = Math.hypot(dx, dy);
            if (dist >= 6) {
              if (Math.abs(dy) >= Math.abs(dx) || dx < 0) {
                gestureLocked = 'vertical';
              } else {
                gestureLocked = 'horizontal';
                try {
                  card.setPointerCapture(e.pointerId);
                } catch (_) {}
              }
            }
          }

          if (gestureLocked === 'horizontal') {
            e.preventDefault();
            dragX = Math.max(0, Math.min(MAX_DRAG, dx));
            card.style.transform = `translateX(${dragX}px)`;

            if (dragX < THRESHOLD_TWEAK) {
              rowWrap.classList.remove('state-tweak', 'state-delete');
              if (delTarget) delTarget.classList.remove('active');
            } else if (dragX < THRESHOLD_DELETE) {
              rowWrap.classList.add('state-tweak');
              rowWrap.classList.remove('state-delete');
              if (delTarget) delTarget.classList.remove('active');
            } else {
              rowWrap.classList.remove('state-tweak');
              rowWrap.classList.add('state-delete');
              if (delTarget) delTarget.classList.add('active');
            }
          }
        };

        const onPointerUp = (e) => {
          if (!isDown) return;
          isDown = false;
          if (delTarget) delTarget.classList.remove('active');

          if (gestureLocked === 'horizontal') {
            try {
              card.releasePointerCapture(e.pointerId);
            } catch (_) {}

            const finalDrag = dragX;
            card.style.transition = 'transform 0.22s cubic-bezier(0.18, 0.9, 0.32, 1)';
            card.style.transform = 'translateX(0px)';

            setTimeout(() => {
              rowWrap.classList.remove('state-tweak', 'state-delete');
            }, 230);

            if (finalDrag >= THRESHOLD_DELETE) {
              this.deleteScene(sceneIdx);
            } else if (finalDrag >= THRESHOLD_TWEAK) {
              this.tweakScene(sceneIdx);
            }
          } else if (gestureLocked === null) {
            this.selectScene(sceneIdx);
          }
          gestureLocked = null;
        };

        card.addEventListener('pointerdown', onPointerDown);
        card.addEventListener('pointermove', onPointerMove);
        card.addEventListener('pointerup', onPointerUp);
        card.addEventListener('pointercancel', onPointerUp);
      });

      // Bind DONE button on adjusting scene card
      this.weaveEl.querySelectorAll('[data-done-adjust]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.exitAdjust();
        });
        btn.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
        });
      });

      // Bind scene selections in Set List
      this.weaveEl.querySelectorAll('.weave-set-row').forEach(el => {
        el.onclick = () => this.selectScene(+el.dataset.sceneIndex);
      });

      this.weaveEl.style.setProperty('--p', this.mode === 'play' ? 1 : 0);
      this.weaveEl.classList.toggle('play', this.mode === 'play');
    }

    buildLoomHTML() {
      const width = 300;
      const viewportH = 688;
      const totalBars = this.calcTotalBars();
      const laneX = [172, 202, 232, 262];
      const maxThick = 24;
      const minSceneH = 46;
      const rawPxPerBar = viewportH / Math.max(1, totalBars);
      const pxPerBar = Math.min(5, Math.max(2.4, rawPxPerBar));
      const isCrowded = this.scenes.length > 8;
      const barH = isCrowded ? 4 : 7;
      const edgeBarH = 1.5;
      const colors = getNodeColors();

      let currY = 0;
      const bands = this.scenes.map(s => {
        const h = Math.max(minSceneH, s.bars * pxPerBar);
        const b = { s, y: currY, h };
        currY += h;
        return b;
      });
      const totalContentH = Math.max(viewportH, currY);
      const hasScroll = currY > viewportH;
      this.loomGeo = { bands, pxPerBar };

      const getThick = (s, k) => s.levels[k] ? Math.max(3, s.levels[k] * maxThick) : 0;

      let rowsHTML = '';
      bands.forEach((b, bi) => {
        const prev = bands[bi - 1];
        const curBarH = bi === 0 ? edgeBarH : barH;
        const isPlaying = b.s.index === this.playingIndex;
        const isEditing = b.s.index === this.editingIndex;
        const isSel = b.s.index === this.selectedIndex && !isPlaying && !isEditing;
        const textColor = isSel ? '#ffffff' : 'var(--weave-ink)';
        const small = b.h < 30 || (isPlaying && b.h < 72);
        const bigFontSize = small
          ? Math.max(14, Math.min(22, b.h * 0.5))
          : isPlaying
            ? Math.min(34, b.h * 0.4)
            : Math.max(15, Math.min(46, (b.h - 12) * 0.55));

        let threadsBandSVG = '';
        [0, 1, 2, 3].forEach(k => {
          const w1 = prev ? getThick(prev.s, k) : getThick(b.s, k);
          const w2 = getThick(b.s, k);
          const taperZone = Math.min(b.h, this.transitionMode === 'jump' ? 0.01 : this.transitionLengthBars * pxPerBar);
          if (!w1 && !w2) return;
          const x = laneX[k];
          threadsBandSVG += `<path d="M${x - w1 / 2},0L${x + w1 / 2},0L${x + w2 / 2},${taperZone}L${x + w2 / 2},${b.h}L${x - w2 / 2},${b.h}L${x - w2 / 2},${taperZone}Z" fill="${colors[k]}"/>`;
        });

        let overWeaveBandSVG = '';
        [0, 1, 2, 3].forEach(k => {
          if ((bi + k) % 2 === 0) {
            const pw = getThick(b.s, k);
            const pp = bands[bi - 1] ? getThick(bands[bi - 1].s, k) : pw;
            const w = Math.max(pw, pp);
            if (w) {
              overWeaveBandSVG += `<rect x="${laneX[k] - w / 2}" y="0" width="${w}" height="${curBarH}" fill="${colors[k]}"/>`;
            }
          }
        });

        const bgFill = isPlaying
          ? 'var(--weave-playing-band)'
          : isEditing
            ? 'var(--weave-surface-wake, #fffbf2)'
            : '#ffffff';

        rowsHTML += `
          <div class="weave-loom-row-wrap" data-scene-index="${b.s.index}" data-scene-id="${b.s.id}" style="position:absolute;left:0;top:${b.y}px;width:${width}px;height:${b.h}px;">
            <div class="weave-loom-row-under">
              <div class="weave-loom-under-content adjust-msg">
                <span class="wluc-tag">ADJUST</span>
                <span class="wluc-hint">Release to edit</span>
              </div>
              <div class="weave-loom-under-content delete-msg">
                <span class="wluc-tag delete">DELETE</span>
                <span class="wluc-hint">Release to delete</span>
              </div>
            </div>
            <div class="weave-loom-row-card ${isEditing ? 'is-editing' : ''}" data-scene-index="${b.s.index}" style="position:absolute;inset:0;width:${width}px;height:${b.h}px;">
              <svg width="${width}" height="${b.h}" style="position:absolute;left:0;top:0;display:block">
                <rect x="0" y="0" width="${width}" height="${b.h}" fill="${bgFill}"/>
                ${isSel ? `<rect x="0" y="0" width="150" height="${b.h}" fill="var(--weave-ink)"/>` : ''}
                <g class="threads">${threadsBandSVG}</g>
                <rect x="0" y="0" width="${width}" height="${curBarH}" fill="var(--weave-ink)"/>
                ${overWeaveBandSVG}
              </svg>
              <div class="weave-loom-band-label labels" style="position:absolute;left:14px;top:2px;width:136px;height:${b.h - 2}px;color:${textColor};display:flex;${small ? 'align-items:center;gap:7px;' : 'flex-direction:column;justify-content:center;'};overflow:hidden;pointer-events:none;">
                <div style="display:flex;align-items:baseline;gap:6px">
                  <b style="font-size:${bigFontSize}px;font-weight:900;letter-spacing:-0.06em;line-height:0.85">${pad2(b.s.index + 1)}</b>
                  <span class="weave-mono" style="font-size:10px;font-weight:700;opacity:0.7">${b.s.bars}b</span>
                  ${isEditing ? `<button type="button" class="weave-btn-done" data-done-adjust onclick="window.weaveEngine.exitAdjust(event)" title="Done adjusting scene">DONE</button>` : ''}
                </div>
                <div style="font-size:${small ? 11 : 12.5}px;font-weight:800;width:${small ? (isPlaying ? 92 : 118) : 124}px;margin-top:${small ? 0 : 3}px">
                  ${isPlaying ? marqueeHTML(b.s.name) : `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(b.s.name)}</div>`}
                </div>
                ${isPlaying && !small ? `<div class="weave-mono" data-loom-cd style="font-size:11px;font-weight:700;margin-top:4px;color:var(--weave-ink)"></div>` : ''}
              </div>
            </div>
          </div>
        `;
      });

      return `
        <div class="weave-loom-lanes-header">
          ${laneX.map((x, k) => `<span style="position:absolute;left:${x - 8}px;color:${k === 1 ? 'var(--weave-node-t2-text)' : colors[k]}">${NODE_NAMES[k]}</span>`).join('')}
        </div>
        <div class="weave-loom-viewport" id="weave-loom-viewport">
          <div class="weave-loom-content" style="position:relative;width:${width}px;height:${totalContentH}px;">
            ${rowsHTML}
            <div style="position:absolute;left:0;top:${currY}px;width:${width}px;height:${edgeBarH}px;background:var(--weave-ink);z-index:2;"></div>
            <svg class="weave-loom-playhead-svg" width="${width}" height="${totalContentH}" style="position:absolute;left:0;top:0;pointer-events:none;z-index:4;">
              <g data-ph>
                <line x1="0" x2="${width}" y1="0" y2="0" stroke="var(--weave-ink)" stroke-width="2"/>
                <rect x="${width - 58}" y="-9" width="58" height="18" fill="var(--weave-ink)"/>
                <text data-phl x="${width - 29}" y="4" text-anchor="middle" font-family="var(--weave-font-mono)" font-weight="700" font-size="10" fill="#ffffff"></text>
              </g>
            </svg>
          </div>
        </div>
        ${hasScroll ? `
          <div class="weave-loom-scroll-nav">
            <button type="button" class="weave-loom-scroll-btn up" data-loom-scroll="up" title="Scroll up">▲</button>
            <button type="button" class="weave-loom-scroll-btn down" data-loom-scroll="down" title="Scroll down">▼</button>
          </div>
        ` : ''}
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
