/* ==========================================================================
   AETHER JOURNEY LAB ENGINE (journey.js)
   Isolated, playable four-node state capture, arrangement & timed travel.
   ========================================================================== */

(function () {
  'use strict';

  const NODE_COLORS = ['#FC4037', '#FFEA00', '#8B68B9', '#00D600'];
  const TIMING_OPTIONS = [2, 4, 8, 16, 32]; // Minimum 2 bars for safe instrument loading and recall
  const TRAVEL_TYPES = ['fade', 'morph', 'jump']; // Order: FADE, MORPH, JUMP (Fade default)

  // Standard Web Audio Equal-Power Crossfade curves (33-point Float32Array)
  const EQUAL_POWER_OUT = Float32Array.from({ length: 33 }, (_, i) => Math.cos((i / 32) * Math.PI / 2));
  const EQUAL_POWER_IN = Float32Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * Math.PI / 2));

  // Helper: clone plain objects
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Draw a miniature spatial arena on a canvas
  function renderMiniMap(canvas, nodes) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.body.classList.contains('theme-dark');
    ctx.fillStyle = isDark ? '#232527' : '#fafaf8';
    ctx.fillRect(0, 0, w, h);

    // Crosshairs
    ctx.strokeStyle = isDark ? '#3a3c3e' : '#e6e6e2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Node dots
    if (Array.isArray(nodes)) {
      nodes.forEach((n, idx) => {
        if (!n) return;
        // x is normalized 0..1, y is normalized 0..1 (top is 0 or bottom is 0)
        const nx = Math.max(0.08, Math.min(0.92, n.x !== undefined ? n.x : 0.5));
        const ny = Math.max(0.08, Math.min(0.92, n.y !== undefined ? n.y : 0.5));
        const px = nx * w;
        const py = (1 - ny) * h; // flip y so top = +vol

        // Glow ring
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = NODE_COLORS[idx % NODE_COLORS.length];
        ctx.fill();

        ctx.strokeStyle = isDark ? '#ffffff' : 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }

  // Set Master volume fade factor (1 = normal, 0 = silence)
  function setMasterFade(factor) {
    const st = window.studio;
    if (!st || !st.masterGain) return;
    const userVol = parseFloat(st.masterVolumeSlider ? st.masterVolumeSlider.value : 0.8) || 0.8;
    st.masterGain.gain.value = Math.max(0, Math.min(1, userVol * factor));
  }

  class JourneyEngine {
    constructor() {
      this.enabled = false; // Default OFF on fresh launch
      this.states = [];     // Captured postcards
      this.journey = [];    // Sequence of steps
      this.selectedStateId = null;
      this.endingFadeBars = 2; // Default ending fade duration

      // Transport state
      this.isPlaying = false;
      this.isPaused = false;
      this.currentStepIndex = 0;
      this.phase = 'idle'; // 'stay' | 'travel' | 'ending' | 'idle'
      this.elapsedInPhase = 0;
      this.durationOfPhase = 0;
      this.lastTickTime = performance.now();
      this.fadeAtMidpointTriggered = false;
      this.activeCrossfades = [];

      this.layoutMode = localStorage.getItem('aether_layout_mode') || 'canvas-first';
      this.statesDrawerOpen = false;
      this.timelineDrawerOpen = false;

      // DOM Elements
      this.el = {
        enabledBtn: document.getElementById('journey-enabled'),
        importBtn: document.getElementById('journey-import-state'),
        fileInput: document.getElementById('journey-file-import'),
        statesGutter: document.getElementById('journey-gutter-left'),
        journeyGutter: document.getElementById('journey-gutter-right'),
        statusBanner: document.getElementById('journey-status-banner'),
        stateList: document.getElementById('journey-state-list'),
        timelineList: document.getElementById('journey-timeline-list'),
        captureBtn: document.getElementById('btn-capture-state'),
        playBtn: document.getElementById('journey-play-btn'),
        stopBtn: document.getElementById('journey-stop-btn'),
        endingSelect: document.getElementById('journey-ending-fade'),
        bannerLed: document.getElementById('banner-led'),
        bannerText: document.getElementById('banner-status-text'),
        bannerMeta: document.getElementById('banner-meta-text'),
        bannerProgress: document.getElementById('banner-progress-bar'),
        statesBadge: document.getElementById('journey-states-count'),
        journeyBadge: document.getElementById('journey-steps-count'),
        clockVal: document.getElementById('journey-clock-val'),
        headerStatesBtn: document.getElementById('journey-header-states-btn'),
        headerTimelineBtn: document.getElementById('journey-header-timeline-btn'),
        headerStatesBadge: document.getElementById('journey-header-states-badge'),
        headerStepsBadge: document.getElementById('journey-header-steps-badge'),
        btnCloseStates: document.getElementById('btn-close-states'),
        btnCloseTimeline: document.getElementById('btn-close-timeline'),
        edgeTabStates: document.getElementById('edge-tab-states'),
        edgeTabTimeline: document.getElementById('edge-tab-timeline')
      };

      this.init();
    }

    init() {
      // Wire Header Buttons
      if (this.el.enabledBtn) {
        this.el.enabledBtn.onclick = () => this.toggleEnabled();
      }
      if (this.el.importBtn && this.el.fileInput) {
        this.el.importBtn.onclick = () => {
          this.el.fileInput.value = '';
          this.el.fileInput.click();
        };
        this.el.fileInput.onchange = (e) => this.handleFileImport(e);
      }

      // Wire Drawer Toggles & Close Buttons
      if (this.el.headerStatesBtn) {
        this.el.headerStatesBtn.onclick = () => this.toggleStatesDrawer();
      }
      if (this.el.headerTimelineBtn) {
        this.el.headerTimelineBtn.onclick = () => this.toggleTimelineDrawer();
      }
      if (this.el.btnCloseStates) {
        this.el.btnCloseStates.onclick = () => this.toggleStatesDrawer(false);
      }
      if (this.el.btnCloseTimeline) {
        this.el.btnCloseTimeline.onclick = () => this.toggleTimelineDrawer(false);
      }
      if (this.el.edgeTabStates) {
        this.el.edgeTabStates.onclick = () => this.toggleStatesDrawer(true);
      }
      if (this.el.edgeTabTimeline) {
        this.el.edgeTabTimeline.onclick = () => this.toggleTimelineDrawer(true);
      }

      // Wire Capture Button
      if (this.el.captureBtn) {
        this.el.captureBtn.onclick = () => this.captureCurrentState();
      }

      // Wire Transport Buttons
      if (this.el.playBtn) {
        this.el.playBtn.onclick = () => this.togglePlayPause();
      }
      if (this.el.stopBtn) {
        this.el.stopBtn.onclick = () => this.stop();
      }

      // Unify Master Play/Stop in Top Header
      const masterPlayBtn = document.getElementById('master-play-btn');
      if (masterPlayBtn) {
        masterPlayBtn.addEventListener('click', (e) => {
          if (this.enabled) {
            e.stopPropagation();
            this.togglePlayPause();
          }
        }, true);
      }
      const masterStopBtn = document.getElementById('master-stop-btn');
      if (masterStopBtn) {
        masterStopBtn.addEventListener('click', (e) => {
          if (this.enabled) {
            e.stopPropagation();
            this.stop();
          }
        }, true);
      }

      // Wire Ending Fade Selector
      if (this.el.endingSelect) {
        this.el.endingSelect.value = String(this.endingFadeBars);
        this.el.endingSelect.onchange = (e) => {
          this.endingFadeBars = parseInt(e.target.value, 10) || 2;
          this.updateBadges();
        };
      }

      // Re-render mini-maps when user toggles theme
      const themeBtn = document.getElementById('theme-toggle-btn');
      if (themeBtn) {
        themeBtn.addEventListener('click', () => {
          setTimeout(() => this.render(), 60);
        });
      }

      // Setup Keyboard (Space toggles transport exclusively)
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.key === ' ') {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
          if (this.enabled) {
            if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
            e.preventDefault();
            e.stopImmediatePropagation();
            this.togglePlayPause();
          }
        }
      }, true);

      // Start rAF Animation Loop
      this.lastTickTime = performance.now();
      requestAnimationFrame((t) => this.tick(t));

      // Initial Render & Layout Setup
      this.render();
      this.setLayout(this.layoutMode);
      this.setEnabled(false); // Default OFF
    }

    // Toggle Journey Mode ON / OFF
    toggleEnabled() {
      this.setEnabled(!this.enabled);
    }

    setEnabled(val) {
      this.enabled = !!val;
      if (this.el.enabledBtn) {
        this.el.enabledBtn.textContent = this.enabled ? 'JOURNEY ON' : 'JOURNEY OFF';
        this.el.enabledBtn.classList.toggle('is-active', this.enabled);
        this.el.enabledBtn.setAttribute('aria-pressed', String(this.enabled));
      }
      document.body.classList.toggle('journey-off', !this.enabled);

      if (this.enabled) {
        this.setLayout(this.layoutMode);
      } else {
        if (this.isPlaying) {
          this.stop();
        }
        if (this.el.statesGutter) this.el.statesGutter.classList.remove('drawer-open');
        if (this.el.journeyGutter) this.el.journeyGutter.classList.remove('drawer-open');
        this.statesDrawerOpen = false;
        this.timelineDrawerOpen = false;
      }
      this.updateBanner();
      if (window.studio && typeof window.studio.resizeCanvas === 'function') {
        setTimeout(() => window.studio.resizeCanvas(), 50);
      }
    }

    setLayout(mode) {
      this.layoutMode = 'canvas-first';
      try { localStorage.setItem('aether_layout_mode', 'canvas-first'); } catch (_) {}

      document.body.classList.add('layout-canvas-first');
      document.body.classList.remove('layout-compact-rail');

      if (this.timelineDrawerOpen === undefined) {
        this.timelineDrawerOpen = false;
      }

      if (this.el.journeyGutter) {
        this.el.journeyGutter.classList.toggle('drawer-open', this.timelineDrawerOpen);
      }
      if (this.el.headerTimelineBtn) {
        this.el.headerTimelineBtn.classList.toggle('is-active', this.timelineDrawerOpen);
      }

      if (window.studio && typeof window.studio.resizeCanvas === 'function') {
        setTimeout(() => window.studio.resizeCanvas(), 50);
      }
    }

    toggleStatesDrawer(force) {
      this.statesDrawerOpen = (typeof force === 'boolean') ? force : !this.statesDrawerOpen;
      if (this.el.statesGutter) {
        this.el.statesGutter.classList.toggle('drawer-open', this.statesDrawerOpen);
      }
      if (this.el.headerStatesBtn) {
        this.el.headerStatesBtn.classList.toggle('is-active', this.statesDrawerOpen);
      }
      if (window.studio && typeof window.studio.resizeCanvas === 'function') {
        setTimeout(() => window.studio.resizeCanvas(), 50);
      }
    }

    toggleTimelineDrawer(force) {
      this.timelineDrawerOpen = (typeof force === 'boolean') ? force : !this.timelineDrawerOpen;
      if (this.el.journeyGutter) {
        this.el.journeyGutter.classList.toggle('drawer-open', this.timelineDrawerOpen);
      }
      if (this.el.headerTimelineBtn) {
        this.el.headerTimelineBtn.classList.toggle('is-active', this.timelineDrawerOpen);
      }
      if (window.studio && typeof window.studio.resizeCanvas === 'function') {
        setTimeout(() => window.studio.resizeCanvas(), 50);
      }
    }

    // Calculate Bar Duration in seconds
    getBarDuration() {
      const bpm = (window.studio && window.studio.bpm) || 120;
      return (60 / bpm) * 4; // 4/4 time
    }

    // -------------------------------------------------------------------------
    // STATE CAPTURE & RECALL
    // -------------------------------------------------------------------------

    captureCurrentState(customName) {
      const st = window.studio;
      if (!st || !Array.isArray(st.tracks)) {
        alert('Studio tracks not available.');
        return null;
      }

      const stateId = 'state_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const name = customName || `State ${String.fromCharCode(65 + (this.states.length % 26))}`;

      const capturedNodes = [];
      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        if (!t) {
          capturedNodes.push({ x: 0.5, y: 0.5, z: 0, gainDb: 0, eq: { low: 0, mid: 0, high: 0 }, mute: false, solo: false });
          continue;
        }

        capturedNodes.push({
          index: k,
          x: typeof t.x === 'number' ? t.x : 0.5,
          y: typeof t.y === 'number' ? t.y : 0.5,
          z: typeof t.z === 'number' ? t.z : 0,
          gainDb: typeof t.stripGainDb === 'number' ? t.stripGainDb : (t.knobGain ? t.knobGain.value : 0),
          eq: {
            low: t.eqValues ? t.eqValues.low : 0,
            mid: t.eqValues ? t.eqValues.mid : 0,
            high: t.eqValues ? t.eqValues.high : 0
          },
          mute: !!t.isMuted,
          solo: !!t.isSoloed,
          // Sound buffer reference
          audioBuffer: t.audioBuffer || null,
          sampleName: t.sampleName || (t.currentFile ? t.currentFile.name : `Track ${k + 1}`),
          duration: t.duration || 0,
          // Custom node
          isCustomNode: !!t.isCustomNode,
          customNodeBundle: t.customNodeBundle ? clone(t.customNodeBundle) : null,
          customNodeZipBase64: t.customNodeZipBase64 || null,
          customNodeDSPParams: t.customNodeDSP && t.customNodeDSP.params ? clone(t.customNodeDSP.params) : null
        });
      }

      const newState = {
        id: stateId,
        name: name,
        createdAt: Date.now(),
        nodes: capturedNodes
      };

      this.states.push(newState);
      this.selectedStateId = stateId;
      this.render();
      return newState;
    }

    async recallState(stateId, opts = {}) {
      const st = window.studio;
      const state = this.states.find(s => s.id === stateId);
      if (!st || !state || !Array.isArray(st.tracks)) return false;

      this.selectedStateId = stateId;

      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        const n = state.nodes[k];
        if (!t || !n) continue;

        // Position & AudioParams
        if (opts.positions !== false) {
          t.setPosition(n.x, n.y, n.z);
          if (typeof t.updateAudioParamsFromPosition === 'function') {
            t.updateAudioParamsFromPosition();
          }
        }

        // Levels & EQ
        if (opts.channel !== false) {
          if (t.knobGain && typeof t.knobGain.setValue === 'function') {
            t.knobGain.setValue(n.gainDb);
          } else if (typeof t.updateStripGain === 'function') {
            t.updateStripGain(n.gainDb);
          }

          if (t.knobLow && typeof t.knobLow.setValue === 'function') t.knobLow.setValue(n.eq.low);
          else if (typeof t.updateEQ === 'function') t.updateEQ('low', n.eq.low);

          if (t.knobMid && typeof t.knobMid.setValue === 'function') t.knobMid.setValue(n.eq.mid);
          else if (typeof t.updateEQ === 'function') t.updateEQ('mid', n.eq.mid);

          if (t.knobHigh && typeof t.knobHigh.setValue === 'function') t.knobHigh.setValue(n.eq.high);
          else if (typeof t.updateEQ === 'function') t.updateEQ('high', n.eq.high);

          t.isMuted = !!n.mute;
          if (t.muteBtn) t.muteBtn.classList.toggle('active', t.isMuted);

          t.isSoloed = !!n.solo;
          if (t.soloBtn) t.soloBtn.classList.toggle('active', t.isSoloed);
        }

        // Custom node instrument bundle and outer ring animation restoration
        if (opts.sound !== false) {
          if (n.isCustomNode && n.customNodeBundle) {
            const isSameBundle = t.isCustomNode && t.customNodeBundle &&
              t.customNodeBundle.manifest && n.customNodeBundle.manifest &&
              t.customNodeBundle.manifest.id === n.customNodeBundle.manifest.id;

            if (!isSameBundle && typeof t.loadNodeBundle === 'function') {
              try {
                await t.loadNodeBundle(n.customNodeBundle, false);
                if (n.customNodeZipBase64) t.customNodeZipBase64 = n.customNodeZipBase64;
              } catch (err) {
                console.warn('Failed to load node bundle during recall:', err);
              }
            }

            // Restore custom node DSP parameters
            if (t.customNodeDSP && n.customNodeDSPParams) {
              for (const [pId, pVal] of Object.entries(n.customNodeDSPParams)) {
                if (typeof t.customNodeDSP.setParameter === 'function') {
                  t.customNodeDSP.setParameter(pId, pVal);
                } else if (t.customNodeDSP.params) {
                  t.customNodeDSP.params[pId] = pVal;
                }
              }
            }

            if (st.isPlaying && t.customNodeDSP && typeof t.customNodeDSP.start === 'function') {
              t.customNodeDSP.start();
            }
          } else if (!n.isCustomNode && t.isCustomNode) {
            // Unload custom node if destination is a sample/audio track
            if (t.customNodeDSP && typeof t.customNodeDSP.stop === 'function') t.customNodeDSP.stop();
            t.isCustomNode = false;
            t.customNodeBundle = null;
            t.customNodeDSP = null;
          }

          // Sound buffer swap if normal sample and buffer differs
          if (!n.isCustomNode && n.audioBuffer && t.audioBuffer !== n.audioBuffer) {
            const wasPlaying = st.isPlaying;
            if (typeof t.stopNodeOnly === 'function') t.stopNodeOnly();
            t.audioBuffer = n.audioBuffer;
            t.duration = n.duration || (n.audioBuffer ? n.audioBuffer.duration : 0);
            t.isLoaded = true;
            if (wasPlaying && typeof t.play === 'function') {
              t.play(st.getCurrentPlaybackTime ? st.getCurrentPlaybackTime() : 0);
            }
          }
        }
      }

      if (typeof st.updateSoloState === 'function') st.updateSoloState();
      if (typeof st.drawArena === 'function') st.drawArena();
      this.updateBanner();
      this.render();
      return true;
    }

    deleteState(stateId) {
      this.states = this.states.filter(s => s.id !== stateId);
      this.journey = this.journey.filter(step => step.stateId !== stateId);
      if (this.selectedStateId === stateId) {
        this.selectedStateId = this.states.length ? this.states[0].id : null;
      }
      this.render();
    }

    renameState(stateId, newName) {
      const state = this.states.find(s => s.id === stateId);
      if (state && newName.trim()) {
        state.name = newName.trim();
        this.render();
      }
    }

    // -------------------------------------------------------------------------
    // JOURNEY TIMELINE MANAGEMENT
    // -------------------------------------------------------------------------

    addToJourney(stateId) {
      const stepId = 'step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      this.journey.push({
        id: stepId,
        stateId: stateId,
        stayBars: 4,
        travelBars: 4,
        travelType: 'fade' // Default FADE
      });
      this.render();
    }

    removeStep(stepIndex) {
      if (stepIndex >= 0 && stepIndex < this.journey.length) {
        this.journey.splice(stepIndex, 1);
        this.render();
      }
    }

    reorderStep(fromIndex, toIndex) {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 ||
          fromIndex >= this.journey.length || toIndex >= this.journey.length) return;
      const [moved] = this.journey.splice(fromIndex, 1);
      this.journey.splice(toIndex, 0, moved);
      this.render();
    }

    setStepStay(stepIndex, bars) {
      if (this.journey[stepIndex]) {
        this.journey[stepIndex].stayBars = Math.max(2, bars || 2);
        this.render();
      }
    }

    setStepTravel(stepIndex, bars) {
      if (this.journey[stepIndex]) {
        this.journey[stepIndex].travelBars = Math.max(2, bars || 2);
        this.render();
      }
    }

    setStepTravelType(stepIndex, type) {
      if (this.journey[stepIndex] && TRAVEL_TYPES.includes(type)) {
        this.journey[stepIndex].travelType = type;
        this.render();
      }
    }

    // -------------------------------------------------------------------------
    // TRANSPORT & PLAYBACK
    // -------------------------------------------------------------------------

    togglePlayPause() {
      if (this.isPlaying && !this.isPaused) {
        this.pause();
      } else {
        this.play();
      }
    }

    play() {
      if (!this.journey.length) {
        alert('Please add at least one state to the Journey on the right.');
        return;
      }

      if (!this.enabled) {
        this.setEnabled(true);
      }

      const st = window.studio;
      if (st && st.audioCtx && st.audioCtx.state === 'suspended') {
        st.audioCtx.resume();
      }

      if (this.isPaused) {
        // Resume from pause
        this.isPaused = false;
        this.lastTickTime = performance.now();
        if (st && !st.isPlaying && typeof st.playMaster === 'function') {
          st.playMaster();
        }
      } else {
        // Fresh play from stop / start
        this.isPlaying = true;
        this.isPaused = false;
        this.currentStepIndex = 0;
        this.phase = 'stay';
        this.elapsedInPhase = 0;
        this.durationOfPhase = this.journey[0].stayBars * this.getBarDuration();
        this.fadeAtMidpointTriggered = false;
        this.lastTickTime = performance.now();

        // Recall Step 0 immediately
        const firstStep = this.journey[0];
        this.recallState(firstStep.stateId);

        if (st && !st.isPlaying && typeof st.playMaster === 'function') {
          st.playMaster();
        }
      }

      this.updateTransportUI();
      this.updateBanner();
      this.render();
    }

    pause() {
      if (!this.isPlaying) return;
      this.isPaused = true;
      this.cleanupCrossfades();
      const st = window.studio;
      if (st && st.isPlaying && typeof st.pauseMaster === 'function') {
        st.pauseMaster();
      }
      this.updateTransportUI();
      this.updateBanner();
    }

    stop() {
      this.isPlaying = false;
      this.isPaused = false;
      this.phase = 'idle';
      this.elapsedInPhase = 0;
      this.fadeAtMidpointTriggered = false;
      this.cleanupCrossfades();
      setMasterFade(1);

      const st = window.studio;
      if (st && typeof st.stopMaster === 'function') {
        st.stopMaster();
      }

      // Settle at first step if available
      if (this.journey.length) {
        this.currentStepIndex = 0;
        this.recallState(this.journey[0].stateId);
      }

      this.updateTransportUI();
      this.updateBanner();
      this.render();
    }

    // -------------------------------------------------------------------------
    // ANIMATION & TIMED EXECUTION
    // -------------------------------------------------------------------------

    tick(now) {
      const dt = Math.max(0, (now - this.lastTickTime) / 1000);
      this.lastTickTime = now;

      if (this.enabled && this.isPlaying && !this.isPaused) {
        this.advance(dt);
      }

      requestAnimationFrame((t) => this.tick(t));
    }

    advance(dt) {
      if (!this.journey.length || this.currentStepIndex >= this.journey.length) {
        this.stop();
        return;
      }

      const st = window.studio;
      const curStep = this.journey[this.currentStepIndex];
      const curState = this.states.find(s => s.id === curStep.stateId);
      const nextStep = this.journey[this.currentStepIndex + 1];
      const nextState = nextStep ? this.states.find(s => s.id === nextStep.stateId) : null;
      const barDur = this.getBarDuration();

      this.elapsedInPhase += dt;

      if (this.phase === 'stay') {
        // Staying on current step (minimum 2 bars)
        const stayBars = Math.max(2, curStep.stayBars || 2);
        const stayDuration = stayBars * barDur;
        const p = Math.min(1, this.elapsedInPhase / stayDuration);
        const curBar = Math.min(stayBars, Math.floor(this.elapsedInPhase / barDur) + 1);

        this.updateBannerInfo(`Staying on "${curState ? curState.name : ''}"`, `Bar ${curBar} / ${stayBars}`, p, 'stay');

        if (this.elapsedInPhase >= stayDuration) {
          // Stay complete: check if travel or ending
          if (nextStep && nextState) {
            this.phase = 'travel';
            this.elapsedInPhase = 0;
            this.durationOfPhase = Math.max(2, curStep.travelBars || 2) * barDur;
            this.fadeAtMidpointTriggered = false;

            // If JUMP: immediately recall destination
            if (curStep.travelType === 'jump') {
              this.recallState(nextState.id);
            }
            // If MORPH: swap sounds at beginning if different
            else if (curStep.travelType === 'morph') {
              this.recallState(nextState.id, { positions: false, channel: false });
            }
            // If FADE: initiate overlapping crossfade
            else if (curStep.travelType === 'fade') {
              this.initiateCrossfade(curState, nextState, this.durationOfPhase);
            }
          } else {
            // Last step finished stay: initiate ending fade
            this.phase = 'ending';
            this.elapsedInPhase = 0;
            this.durationOfPhase = this.endingFadeBars * barDur;
          }
        }
      } else if (this.phase === 'travel') {
        // Travelling from current to next step (minimum 2 bars)
        const travelBars = Math.max(2, curStep.travelBars || 2);
        const travelDuration = travelBars * barDur;
        const p = Math.min(1, this.elapsedInPhase / travelDuration);
        const curBar = Math.min(travelBars, Math.floor(this.elapsedInPhase / barDur) + 1);
        const travelType = (curStep.travelType || 'fade').toUpperCase();

        this.updateBannerInfo(`Travelling: "${curState ? curState.name : ''}" → "${nextState ? nextState.name : ''}"`, `Bar ${curBar} / ${travelBars} • ${travelType}`, p, 'travel');

        if (curStep.travelType === 'morph' || curStep.travelType === 'fade') {
          // Continuous smooth equal-power crossfade of positions, gains, EQ and mute envelope
          this.updateCrossfade(p, curState, nextState);
        }

        if (this.elapsedInPhase >= travelDuration) {
          // Arrived at next step!
          if (curStep.travelType === 'fade') {
            this.completeCrossfade(nextState.id);
          } else {
            this.recallState(nextState.id); // Settle destination exactly
          }
          this.currentStepIndex++;
          this.phase = 'stay';
          this.elapsedInPhase = 0;
          const nextStayBars = Math.max(2, this.journey[this.currentStepIndex].stayBars || 2);
          this.durationOfPhase = nextStayBars * barDur;
          this.render();
        }
      } else if (this.phase === 'ending') {
        // Ending fade to silence
        const endingDuration = this.endingFadeBars * barDur;
        const p = Math.min(1, this.elapsedInPhase / endingDuration);
        const factor = 1 - p;
        setMasterFade(factor);

        this.updateBannerInfo('Ending Journey', 'Fading to silence...', p, 'ending');

        if (this.elapsedInPhase >= endingDuration) {
          this.stop();
        }
      }
    }

    // -------------------------------------------------------------------------
    // OVERLAPPING EQUAL-POWER CROSSFADE ENGINE
    // -------------------------------------------------------------------------

    initiateCrossfade(fromState, toState, durationSec = 4) {
      this.cleanupCrossfades();
      const st = window.studio;
      if (!st || !st.audioCtx || !Array.isArray(st.tracks) || !fromState || !toState) return;

      const ctx = st.audioCtx;
      const now = ctx.currentTime;
      const sec = Math.max(0.2, durationSec);

      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        const nA = fromState.nodes[k];
        const nB = toState.nodes[k];
        if (!t || !nA || !nB || !t.eqLowNode) continue;

        const isSameBuffer = (nA.audioBuffer === nB.audioBuffer) && (!nA.isCustomNode && !nB.isCustomNode);
        if (!isSameBuffer && nB.audioBuffer) {
          // Outgoing source: ramp down with EQUAL_POWER_OUT
          const old = t.bufferSource;
          if (old) {
            try {
              const gOut = ctx.createGain();
              gOut.gain.setValueAtTime(1, now);
              old.disconnect();
              old.connect(gOut);
              gOut.connect(t.eqLowNode);
              gOut.gain.setValueCurveAtTime(EQUAL_POWER_OUT, now, sec);
              old.onended = null;
              try { old.stop(now + sec + 0.05); } catch (e) {}
              this.activeCrossfades.push({ k, old, gOut });
              t.bufferSource = null;
            } catch (err) {
              console.warn('Crossfade outgoing error:', err);
            }
          }

          // Incoming source: start with EQUAL_POWER_IN
          try {
            const fadeIn = ctx.createGain();
            fadeIn.gain.setValueAtTime(0, now);
            fadeIn.gain.setValueCurveAtTime(EQUAL_POWER_IN, now, sec);

            t.audioBuffer = nB.audioBuffer;
            t.duration = nB.duration || (nB.audioBuffer ? nB.audioBuffer.duration : 0);
            t.isLoaded = true;

            if (st.isPlaying && typeof t.play === 'function') {
              const at = typeof st.getCurrentPlaybackTime === 'function' ? st.getCurrentPlaybackTime() : 0;
              t.play(at);
              if (t.bufferSource) {
                t.bufferSource.disconnect();
                t.bufferSource.connect(fadeIn);
                fadeIn.connect(t.eqLowNode);
                this.activeCrossfades.push({ k, incoming: t.bufferSource, fadeIn, targetNode: t.eqLowNode });
              }
            }
          } catch (err) {
            console.warn('Crossfade incoming start error:', err);
          }
        }
      }
    }

    updateCrossfade(p, fromState, toState) {
      const st = window.studio;
      if (!st || !fromState || !toState) return;

      // Equal-power crossfade weights
      const wOut = Math.cos(p * Math.PI * 0.5);
      const wIn = Math.sin(p * Math.PI * 0.5);

      if (Array.isArray(st.tracks)) {
        for (let k = 0; k < 4; k++) {
          const t = st.tracks[k];
          const fromN = fromState.nodes[k];
          const toN = toState.nodes[k];
          if (!t || !fromN || !toN) continue;

          // 1. Spatial position glide across the arena
          const interpX = fromN.x + (toN.x - fromN.x) * p;
          const interpY = fromN.y + (toN.y - fromN.y) * p;
          const interpZ = fromN.z + (toN.z - fromN.z) * p;
          t.x = Math.max(0.02, Math.min(0.98, interpX));
          t.y = Math.max(0.02, Math.min(0.98, interpY));
          t.z = Math.max(0, Math.min(50, interpZ));

          // 2. Channel strip gain interpolation
          t.stripGainDb = fromN.gainDb + (toN.gainDb - fromN.gainDb) * p;

          // 3. Smooth mute crossfade: un-mute during travel and modulate gain smoothly
          const muteA = fromN.mute ? 0 : 1;
          const muteB = toN.mute ? 0 : 1;
          const muteFactor = Math.sqrt((muteA * wOut) ** 2 + (muteB * wIn) ** 2);
          t.isMuted = false;

          // 4. Update audio parameters from position
          if (typeof t.updateAudioParamsFromPosition === 'function') {
            t.updateAudioParamsFromPosition();
          }

          // 5. Modulate gainNode directly so muting/unmuting is 100% audible and smooth
          if (t.gainNode && t.gainNode.gain && st.audioCtx) {
            const currentVal = t.gainNode.gain.value;
            t.gainNode.gain.setValueAtTime(currentVal * muteFactor, st.audioCtx.currentTime);
          }

          // 6. Smooth EQ interpolation
          if (t.eqValues && fromN.eq && toN.eq) {
            t.eqValues.low = fromN.eq.low + (toN.eq.low - fromN.eq.low) * p;
            t.eqValues.mid = fromN.eq.mid + (toN.eq.mid - fromN.eq.mid) * p;
            t.eqValues.high = fromN.eq.high + (toN.eq.high - fromN.eq.high) * p;
            if (t.eqLowNode && st.audioCtx) t.eqLowNode.gain.setValueAtTime(t.eqValues.low, st.audioCtx.currentTime);
            if (t.eqMidNode && st.audioCtx) t.eqMidNode.gain.setValueAtTime(t.eqValues.mid, st.audioCtx.currentTime);
            if (t.eqHighNode && st.audioCtx) t.eqHighNode.gain.setValueAtTime(t.eqValues.high, st.audioCtx.currentTime);
          }
        }
        if (typeof st.drawArena === 'function') st.drawArena();
      }
    }

    completeCrossfade(toStateId) {
      for (const xf of this.activeCrossfades) {
        if (xf.old) {
          try { xf.old.stop(); } catch (e) {}
          try { xf.old.disconnect(); } catch (e) {}
        }
        if (xf.gOut) {
          try { xf.gOut.disconnect(); } catch (e) {}
        }
        if (xf.incoming && xf.fadeIn && xf.targetNode) {
          try {
            xf.incoming.disconnect();
            xf.fadeIn.disconnect();
            xf.incoming.connect(xf.targetNode);
          } catch (e) {}
        }
      }
      this.activeCrossfades = [];
      this.recallState(toStateId);
    }

    cleanupCrossfades() {
      if (!this.activeCrossfades || !this.activeCrossfades.length) return;
      for (const xf of this.activeCrossfades) {
        if (xf.old) {
          try { xf.old.stop(); } catch (e) {}
          try { xf.old.disconnect(); } catch (e) {}
        }
        if (xf.gOut) {
          try { xf.gOut.disconnect(); } catch (e) {}
        }
        if (xf.incoming && xf.fadeIn && xf.targetNode) {
          try {
            xf.incoming.disconnect();
            xf.fadeIn.disconnect();
            xf.incoming.connect(xf.targetNode);
          } catch (e) {}
        }
      }
      this.activeCrossfades = [];
    }

    // -------------------------------------------------------------------------
    // FILE IMPORT (.aether)
    // -------------------------------------------------------------------------

    async handleFileImport(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const session = JSON.parse(text);
        const st = window.studio;

        if (!session || !Array.isArray(session.tracks)) {
          alert('Invalid .aether project file.');
          return;
        }

        // Prepare session using studio decoder
        let prepared = null;
        if (st && typeof st.prepareSession === 'function') {
          prepared = await st.prepareSession(session);
        }

        const stateName = file.name.replace(/\.(aether|json)$/i, '');
        const stateId = 'import_' + Date.now();

        const importedNodes = [];
        for (let k = 0; k < 4; k++) {
          const sTrack = session.tracks.find(t => (t.index ?? 0) === k) || session.tracks[k];
          const prepTrack = prepared ? prepared.find(t => (t.index ?? 0) === k) : null;

          if (!sTrack) {
            importedNodes.push({ x: 0.5, y: 0.5, z: 0, gainDb: 0, eq: { low: 0, mid: 0, high: 0 }, mute: false, solo: false });
            continue;
          }

          importedNodes.push({
            index: k,
            x: sTrack.x !== undefined ? sTrack.x : 0.5,
            y: sTrack.y !== undefined ? sTrack.y : 0.5,
            z: sTrack.z !== undefined ? sTrack.z : 0,
            gainDb: sTrack.stripGainDb !== undefined ? sTrack.stripGainDb : (sTrack.gain || 0),
            eq: sTrack.eq || { low: 0, mid: 0, high: 0 },
            mute: !!sTrack.mute,
            solo: !!sTrack.solo,
            audioBuffer: prepTrack ? prepTrack._decoded : null,
            sampleName: sTrack.sampleName || `Track ${k + 1}`,
            duration: prepTrack && prepTrack._decoded ? prepTrack._decoded.duration : 0,
            isCustomNode: !!(sTrack.isCustomNode || (prepTrack && prepTrack._bundle) || sTrack.customNodeBundle),
            customNodeBundle: (prepTrack && prepTrack._bundle) || sTrack.customNodeBundle || null,
            customNodeZipBase64: sTrack.customNodeZipBase64 || null,
            customNodeDSPParams: sTrack.customNodeParams || (prepTrack && prepTrack.customNodeParams) || sTrack.customParams || null
          });
        }

        const newState = {
          id: stateId,
          name: `[Import] ${stateName}`,
          createdAt: Date.now(),
          nodes: importedNodes
        };

        this.states.push(newState);
        this.selectedStateId = stateId;
        this.render();
        alert(`State imported successfully from "${file.name}".`);
      } catch (err) {
        console.error('Import error:', err);
        alert(`Failed to import .aether state: ${err.message || err}`);
      }
    }

    // -------------------------------------------------------------------------
    // PROJECT PERSISTENCE (SERIALIZE & DESERIALIZE)
    // -------------------------------------------------------------------------

    serialize() {
      return {
        version: '1.3',
        enabled: !!this.enabled,
        endingFadeBars: this.endingFadeBars,
        layoutMode: 'canvas-first',
        states: this.states.map(s => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          nodes: (s.nodes || []).map(n => ({
            index: n.index,
            x: n.x,
            y: n.y,
            z: n.z,
            gainDb: n.gainDb,
            eq: n.eq ? { low: n.eq.low, mid: n.eq.mid, high: n.eq.high } : { low: 0, mid: 0, high: 0 },
            mute: !!n.mute,
            solo: !!n.solo,
            sampleName: n.sampleName || '',
            duration: n.duration || 0,
            isCustomNode: !!n.isCustomNode,
            customNodeBundle: n.customNodeBundle ? clone(n.customNodeBundle) : null,
            customNodeZipBase64: n.customNodeZipBase64 || null,
            customNodeDSPParams: n.customNodeDSPParams ? clone(n.customNodeDSPParams) : null
          }))
        })),
        journey: (this.journey || []).map(step => ({
          id: step.id,
          stateId: step.stateId,
          stayBars: step.stayBars,
          travelBars: step.travelBars,
          travelType: step.travelType
        }))
      };
    }

    async deserialize(data) {
      if (!data) return;
      const st = window.studio;

      if (typeof data.endingFadeBars === 'number') {
        this.endingFadeBars = data.endingFadeBars;
        if (this.el.endingSelect) this.el.endingSelect.value = String(this.endingFadeBars);
      }

      if (Array.isArray(data.states)) {
        this.states = data.states.map(s => {
          const nodes = (s.nodes || []).map((n, idx) => {
            const trackIdx = typeof n.index === 'number' ? n.index : idx;
            const liveTrack = (st && st.tracks) ? st.tracks[trackIdx] : null;
            return {
              index: trackIdx,
              x: typeof n.x === 'number' ? n.x : 0.5,
              y: typeof n.y === 'number' ? n.y : 0.5,
              z: typeof n.z === 'number' ? n.z : 0,
              gainDb: typeof n.gainDb === 'number' ? n.gainDb : 0,
              eq: n.eq || { low: 0, mid: 0, high: 0 },
              mute: !!n.mute,
              solo: !!n.solo,
              sampleName: n.sampleName || (liveTrack ? liveTrack.sampleName : `Track ${trackIdx + 1}`),
              duration: n.duration || (liveTrack ? liveTrack.duration : 0),
              audioBuffer: (liveTrack && liveTrack.audioBuffer) ? liveTrack.audioBuffer : null,
              isCustomNode: !!n.isCustomNode,
              customNodeBundle: n.customNodeBundle ? clone(n.customNodeBundle) : (liveTrack ? liveTrack.customNodeBundle : null),
              customNodeZipBase64: n.customNodeZipBase64 || (liveTrack ? liveTrack.customNodeZipBase64 : null),
              customNodeDSPParams: n.customNodeDSPParams ? clone(n.customNodeDSPParams) : null
            };
          });
          return {
            id: s.id,
            name: s.name,
            createdAt: s.createdAt || Date.now(),
            nodes: nodes
          };
        });
      } else {
        this.states = [];
      }

      if (Array.isArray(data.journey)) {
        this.journey = data.journey.map(step => ({
          id: step.id || ('step_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
          stateId: step.stateId,
          stayBars: typeof step.stayBars === 'number' ? step.stayBars : 4,
          travelBars: typeof step.travelBars === 'number' ? step.travelBars : 4,
          travelType: step.travelType || 'fade'
        }));
      } else {
        this.journey = [];
      }

      if (data.enabled) {
        this.setEnabled(true);
      }

      if (this.journey.length > 0) {
        this.selectedStateId = this.journey[0].stateId;
        await this.recallState(this.journey[0].stateId);
      } else if (this.states.length > 0) {
        this.selectedStateId = this.states[0].id;
        await this.recallState(this.states[0].id);
      } else {
        this.selectedStateId = null;
      }

      this.render();
      this.updateBanner();
      this.updateBadges();
    }

    // -------------------------------------------------------------------------
    // UI RENDERING & FEEDBACK
    // -------------------------------------------------------------------------

    updateTransportUI() {
      if (this.el.playBtn) {
        if (this.isPlaying && !this.isPaused) {
          this.el.playBtn.textContent = 'PAUSE';
          this.el.playBtn.classList.add('is-playing');
        } else if (this.isPaused) {
          this.el.playBtn.textContent = 'RESUME';
          this.el.playBtn.classList.remove('is-playing');
        } else {
          this.el.playBtn.textContent = 'PLAY';
          this.el.playBtn.classList.remove('is-playing');
        }
      }

      // Synchronize master play button in the top bar
      const mpBtn = document.getElementById('master-play-btn');
      if (mpBtn) {
        if (this.isPlaying && !this.isPaused) {
          mpBtn.classList.add('playing');
          mpBtn.title = 'Pause Journey (Space)';
          mpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        } else {
          mpBtn.classList.remove('playing');
          mpBtn.title = 'Play Journey (Space)';
          mpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        }
      }
    }

    updateBanner() {
      if (!this.enabled) return;
      if (!this.isPlaying) {
        const cur = this.states.find(s => s.id === this.selectedStateId);
        this.updateBannerInfo(cur ? `Selected: "${cur.name}"` : 'Journey Ready', 'Stopped', 0, 'stopped');
      }
    }

    updateBannerInfo(status, meta, progress, state) {
      if (this.el.bannerText) this.el.bannerText.textContent = status;
      if (this.el.bannerMeta) this.el.bannerMeta.textContent = meta;
      if (this.el.bannerProgress) this.el.bannerProgress.style.width = `${Math.round(progress * 100)}%`;

      if (this.el.bannerLed) {
        this.el.bannerLed.className = 'banner-led';
        if (state === 'stay') this.el.bannerLed.classList.add('is-playing');
        else if (state === 'travel') this.el.bannerLed.classList.add('is-travelling');
        else if (state === 'paused') this.el.bannerLed.classList.add('is-paused');
      }
    }

    render() {
      this.renderStatesList();
      this.renderJourneyTimeline();
      this.updateBadges();
      this.updateTransportUI();
    }

    updateBadges() {
      if (this.el.statesBadge) this.el.statesBadge.textContent = this.states.length;
      if (this.el.journeyBadge) this.el.journeyBadge.textContent = this.journey.length;
      if (this.el.headerStatesBadge) this.el.headerStatesBadge.textContent = this.states.length;
      if (this.el.headerStepsBadge) this.el.headerStepsBadge.textContent = this.journey.length;

      let totalBars = 0;
      this.journey.forEach((step, idx) => {
        totalBars += step.stayBars;
        if (idx < this.journey.length - 1) totalBars += step.travelBars;
      });
      if (this.el.clockVal) this.el.clockVal.textContent = `${totalBars + (this.journey.length ? this.endingFadeBars : 0)} bars`;
    }

    renderStatesList() {
      const container = this.el.stateList;
      if (!container) return;
      container.innerHTML = '';

      if (!this.states.length) {
        const empty = document.createElement('div');
        empty.className = 'journey-empty-hint';
        empty.innerHTML = '<strong>No saved states yet.</strong><br>Set up nodes and sounds, then click "+ CAPTURE STATE" above.';
        container.appendChild(empty);
        return;
      }

      this.states.forEach(state => {
        const card = document.createElement('div');
        card.className = 'journey-state-card' + (state.id === this.selectedStateId ? ' is-selected' : '');

        const top = document.createElement('div');
        top.className = 'journey-state-top';

        const map = document.createElement('canvas');
        map.className = 'state-mini-map';
        map.width = 54;
        map.height = 42;
        renderMiniMap(map, state.nodes);

        const meta = document.createElement('div');
        meta.className = 'journey-state-meta';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'journey-state-name';
        nameSpan.textContent = state.name;
        nameSpan.title = 'Double click to rename';
        nameSpan.ondblclick = (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.className = 'journey-state-name-input';
          input.value = state.name;
          nameSpan.replaceWith(input);
          input.focus();
          const save = () => {
            this.renameState(state.id, input.value);
          };
          input.onblur = save;
          input.onkeydown = (ke) => {
            if (ke.key === 'Enter') save();
            if (ke.key === 'Escape') this.render();
          };
        };

        const subSpan = document.createElement('div');
        subSpan.className = 'journey-state-sub';
        subSpan.textContent = `4 nodes captured`;

        meta.appendChild(nameSpan);
        meta.appendChild(subSpan);
        top.appendChild(map);
        top.appendChild(meta);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'journey-state-actions';

        const recallBtn = document.createElement('button');
        recallBtn.className = 'btn-state-action';
        recallBtn.textContent = 'Recall';
        recallBtn.onclick = (e) => {
          e.stopPropagation();
          this.recallState(state.id);
        };

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-state-action action-add';
        addBtn.textContent = '+ Journey';
        addBtn.onclick = (e) => {
          e.stopPropagation();
          this.addToJourney(state.id);
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-state-action action-del';
        delBtn.textContent = '×';
        delBtn.title = 'Delete state';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          this.deleteState(state.id);
        };

        actions.appendChild(recallBtn);
        actions.appendChild(addBtn);
        actions.appendChild(delBtn);

        card.appendChild(top);
        card.appendChild(actions);

        card.onclick = () => {
          this.recallState(state.id);
        };

        container.appendChild(card);
      });
    }

    renderJourneyTimeline() {
      const container = this.el.timelineList;
      if (!container) return;
      container.innerHTML = '';

      if (!this.journey.length) {
        const empty = document.createElement('div');
        empty.className = 'journey-empty-hint';
        empty.innerHTML = '<strong>No journey steps.</strong><br>Click "+ Journey" on any state on the left to add it here.';
        container.appendChild(empty);
        return;
      }

      this.journey.forEach((step, idx) => {
        const state = this.states.find(s => s.id === step.stateId);
        const card = document.createElement('div');
        card.className = 'journey-step-card' + (this.isPlaying && this.currentStepIndex === idx ? ' is-active-step' : '');
        card.dataset.index = idx;

        // Header
        const header = document.createElement('div');
        header.className = 'step-card-header';

        const handle = document.createElement('span');
        handle.className = 'step-drag-handle';
        handle.textContent = '⋮⋮';
        handle.title = 'Drag to reorder';

        const badge = document.createElement('span');
        badge.className = 'step-index-badge';
        badge.textContent = String(idx + 1).padStart(2, '0');

        const map = document.createElement('canvas');
        map.className = 'state-mini-map';
        map.width = 40;
        map.height = 30;
        if (state) renderMiniMap(map, state.nodes);

        const name = document.createElement('div');
        name.className = 'step-name-display';
        name.textContent = state ? state.name : 'Unknown State';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove-step';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove step';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          this.removeStep(idx);
        };

        header.appendChild(handle);
        header.appendChild(badge);
        header.appendChild(map);
        header.appendChild(name);
        header.appendChild(removeBtn);
        card.appendChild(header);

        // Timing & Travel Controls
        const controls = document.createElement('div');
        controls.className = 'step-card-controls';

        // Stay selector
        const stayGroup = document.createElement('div');
        stayGroup.className = 'step-param-group';
        stayGroup.innerHTML = '<span class="step-param-label">Stay Duration</span>';
        const staySelect = document.createElement('select');
        staySelect.className = 'step-param-select';
        staySelect.setAttribute('aria-label', `Step ${idx + 1} stay duration`);
        TIMING_OPTIONS.forEach(bars => {
          const opt = document.createElement('option');
          opt.value = bars;
          opt.textContent = `${bars} bars`;
          if (step.stayBars === bars) opt.selected = true;
          staySelect.appendChild(opt);
        });
        staySelect.onchange = (e) => this.setStepStay(idx, parseInt(e.target.value, 10));
        stayGroup.appendChild(staySelect);
        controls.appendChild(stayGroup);

        // Travel selector (only if not last step)
        if (idx < this.journey.length - 1) {
          const travelWrap = document.createElement('div');
          travelWrap.className = 'step-travel-controls';

          const travelDurGroup = document.createElement('div');
          travelDurGroup.className = 'step-param-group';
          travelDurGroup.innerHTML = '<span class="step-param-label">Travel Time</span>';
          const travelDurSelect = document.createElement('select');
          travelDurSelect.className = 'step-param-select';
          travelDurSelect.setAttribute('aria-label', `Step ${idx + 1} travel duration`);
          TIMING_OPTIONS.forEach(bars => {
            const opt = document.createElement('option');
            opt.value = bars;
            opt.textContent = `${bars} bars`;
            if (step.travelBars === bars) opt.selected = true;
            travelDurSelect.appendChild(opt);
          });
          travelDurSelect.onchange = (e) => this.setStepTravel(idx, parseInt(e.target.value, 10));
          travelDurGroup.appendChild(travelDurSelect);

          const travelTypeGroup = document.createElement('div');
          travelTypeGroup.className = 'step-param-group';
          travelTypeGroup.innerHTML = '<span class="step-param-label">Behaviour</span>';
          const travelTypeSelect = document.createElement('select');
          travelTypeSelect.className = 'step-param-select';
          travelTypeSelect.setAttribute('aria-label', `Step ${idx + 1} travel behaviour`);
          TRAVEL_TYPES.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t.toUpperCase();
            if (step.travelType === t) opt.selected = true;
            travelTypeSelect.appendChild(opt);
          });
          travelTypeSelect.onchange = (e) => this.setStepTravelType(idx, e.target.value);
          travelTypeGroup.appendChild(travelTypeSelect);

          travelWrap.appendChild(travelDurGroup);
          travelWrap.appendChild(travelTypeGroup);
          controls.appendChild(travelWrap);
        }

        card.appendChild(controls);

        // Setup Drag and Drop
        this.bindDragReorder(card, handle, idx);

        container.appendChild(card);
      });
    }

    bindDragReorder(card, handle, fromIndex) {
      let isDragging = false;
      let startY = 0;

      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        startY = e.clientY;
        card.classList.add('is-dragging');
        handle.setPointerCapture(e.pointerId);

        const onPointerMove = (moveEv) => {
          if (!isDragging) return;
          const deltaY = moveEv.clientY - startY;
          card.style.transform = `translateY(${deltaY}px) scale(1.02)`;

          // Highlight target drop card
          const cards = Array.from(this.el.timelineList.querySelectorAll('.journey-step-card:not(.is-dragging)'));
          cards.forEach(c => {
            const r = c.getBoundingClientRect();
            if (moveEv.clientY >= r.top && moveEv.clientY <= r.bottom) {
              c.style.borderTop = '2px solid var(--journey-accent)';
            } else {
              c.style.borderTop = '';
            }
          });
        };

        const onPointerUp = (upEv) => {
          if (!isDragging) return;
          isDragging = false;
          card.classList.remove('is-dragging');
          card.style.transform = '';
          handle.releasePointerCapture(upEv.pointerId);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);

          // Find drop target index
          const cards = Array.from(this.el.timelineList.querySelectorAll('.journey-step-card'));
          let targetIndex = fromIndex;
          cards.forEach((c, idx) => {
            c.style.borderTop = '';
            const r = c.getBoundingClientRect();
            if (upEv.clientY >= r.top && upEv.clientY <= r.bottom) {
              targetIndex = idx;
            }
          });

          if (targetIndex !== fromIndex) {
            this.reorderStep(fromIndex, targetIndex);
          }
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      };

      handle.addEventListener('pointerdown', onPointerDown);
    }
  }

  // Initialize Journey Lab once document and studio are ready
  function startJourney() {
    if (window.journeyEngine) return;
    window.journeyEngine = new JourneyEngine();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startJourney);
  } else {
    startJourney();
  }
})();
