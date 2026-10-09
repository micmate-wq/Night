/**
 * Aether Weave Core Engine & UI
 * Based on Approved Mockup E: BUILD / PLAY Toggle & Specification v0.1
 */

(function () {
  'use strict';

  // Canonical node names and default fallback colors (will be updated from Aether runtime)
  const NODE_NAMES = ['T1', 'T2', 'T3', 'T4'];
  const DEFAULT_COLORS = ['#FC4037', '#FFEA00', '#8B68B9', '#00D600'];

  // LAB-5 quiet panels: thread colours are CSS variables (--wv-t1..4) so the
  // gutters can fade them to grey at rest. weave.css sets the values.
  function getNodeColors() {
    return ['var(--wv-t1)', 'var(--wv-t2)', 'var(--wv-t3)', 'var(--wv-t4)'];
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

  // Phase 1 S4: the Weave session holds a real S1 document; S2 and S3 do the
  // asset and capture work. In the app they are globals loaded before this
  // file; in Node tests they are placed on `window` before weave.js is loaded.
  // When they are absent the engine still renders the demo set, but + SCENE is
  // refused with a toast and nothing can be captured.
  const S1 = (typeof window !== 'undefined' && window.AetherWeaveModel) || null;
  const S3 = (typeof window !== 'undefined' && window.AetherWeaveImport) || null;
  const COLOR_TOKENS = ['track-1', 'track-2', 'track-3', 'track-4'];
  const LAUNCH_CROSSFADE_BARS = 1;   // GO NEXT / double-click: launch on the next bar, cross over one bar
  const PREPARE_LEAD_BARS = 2;
  const UNDO_MS = 8000;              // a deleted Scene can be brought back for this long       // the broadcast plan prepares the next Scene this many bars before its transition
  const EQUAL_POWER_OUT = Float32Array.from({ length: 33 }, (_, i) => Math.cos((i / 32) * Math.PI / 2));
  const EQUAL_POWER_IN = Float32Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * Math.PI / 2));
  const identityOf = (ts) => {
    const src = ts && ts.source;
    if (!src) return 'empty';
    switch (src.kind) {
      case 'node': return 'node:' + src.node.bundleAssetId;
      case 'sample': return 'sample:' + src.sample.assetId;
      case 'playlist': return 'playlist:' + src.playlist.items.join(',');
      case 'live-input': return 'live-input';
      case 'stream': return 'stream:' + (src.external && src.external.streamUrl ? src.external.streamUrl : '');
      default: return 'empty';
    }
  };
  const selectedKeyOf = (ts) => {
    const src = ts && ts.source;
    if (!src) return '';
    const idx = src.kind === 'playlist' ? src.playlist.index : '';
    const ov = src.override ? src.override.assetId : '';
    const tape = src.kind === 'node' && src.node.tapeAssetId ? src.node.tapeAssetId : '';
    return idx + '|' + ov + '|' + tape;
  };
  const slotLabel = (k) => NODE_NAMES[k] || ('T' + (k + 1));

  // LAB-10 housekeeping: a short demo set of 3 seed scenes (was 7).
  // Phase 1 S4 (D8): they are a read-only demo set, shown only while the Weave
  // document has no Scenes. They are never saved, advanced, applied or edited.
  const INITIAL_SCENES = [
    { name: 'Slow emergence', bars: 16, levels: [0.6, 0.0, 0.3, 0.0] },
    { name: 'Open water', bars: 32, levels: [0.8, 0.4, 0.5, 0.0] },
    { name: 'Afterglow', bars: 16, levels: [0.9, 0.3, 0.0, 0.5] }
  ];

  // Weave State Engine
  class WeaveEngine {
    constructor() {
      // Phase 1 S4 runtime session. `doc` is the S1 document (the real Scenes);
      // `this.scenes` below is the VIEW list the render code reads, re-derived
      // from `doc` by syncViewFromDoc() after every document change.
      this.session = {
        available: !!(S1 && S3),
        doc: S1 ? S1.createWeave({ name: 'Untitled Weave' }) : null,
        epoch: 1,          // changes when the session is replaced (S5 New/Open)
        docRevision: 0,    // increments on every document change
        detached: false,   // D3: automatic writes suspended until a capture binds again
        dirty: false,
        get demo() { return !this.doc || this.doc.order.length === 0; }
      };
      this._suspensions = new Set();   // tokens of host replacement/rebuild operations in flight
      this._captureSeq = 0;
      this._captureChain = Promise.resolve();
      this._pendingCaptures = new Set();
      this._previewToken = 0;
      this._skipReported = new Map();
      this._bufferCache = new Map();   // assetId -> AudioBuffer, for recalling a Scene's sound without decoding
      this._decodePending = new Map();
      this.fadeLevel = 1;
      this._fadeInAt = null;
      this._entrance = null;
      this._wasPlaying = false;
      this._audition = null;        // index of the Scene being auditioned in BUILD, or null
      this._auditionStopAt = null;  // { idx, bar } where an AUDITION TRANSITION stops itself
      this._startAt = null;         // { idx, bar } the next Play from Stop should start from
      this._launch = null;          // pending GO NEXT: { sceneId, token, ready, atTransport, plan, error }
      this._launchSeq = 0;          // every GO NEXT / launch request gets a fresh token; stale work checks it
      this._enableSeq = 0;          // bumped on WEAVE OFF: stale decodes/preparations check it
      this._prepared = new Map();   // sceneId -> { promise, result, error, revision } (prepareSession output)
      this._fadeSources = new Set(); // outgoing crossfade sources the transport still owns (Codex r6 P1)
      this._autoPrep = null;        // sceneId being prepared ahead for the broadcast plan
      this._undo = null;            // { doc, label, until } after a delete in PLAY
      this.scenes = this._demoRows();

      const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
      this.enabled = false; // the familiar instrument is the default workspace
      this.mode = q.get('mode') === 'play' ? 'play' : 'build';
      this.switchP = this.mode === 'play' ? 1 : 0;
      this.isSwitching = false;
      this.switchStartTime = 0;

      this.playingIndex = 0; // Start on scene 01
      this.selectedIndex = 0;
      this.editingIndex = null;

      // Single/shared transition properties
      this.transitionLengthBars = 8;
      this.transitionCurve = 'ease'; // 'lin' | 'ease' | 'late'
      this.transitionMode = 'fade'; // 'fade' | 'morph' | 'jump'

      // LAB-12 scene moves: the glide currently moving the nodes (or null),
      // and which scene's outgoing transition has already started.
      this.glide = null;
      this._glideStartedFor = null;

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
      return (this.scenes || []).reduce((acc, s) => acc + s.bars, 0);
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
        } else if (e.key === 'g' || e.key === 'G') {
          // LAB-10: G = GO NOW in PLAY mode. Space stays master Play/Pause
          // (index.html catches Space first, so it never reached here anyway).
          if (this.mode === 'play' && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
      // WebKit can still begin a text selection from a press on the panel background and sweep
      // it across Scene labels and set-list rows; refuse it unless the press is in an editable field.
      if (this.weaveEl && typeof this.weaveEl.addEventListener === 'function') {
        this.weaveEl.addEventListener('selectstart', (e) => {
          const t = e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
          if (t && t.closest && t.closest('input, textarea, [contenteditable]')) return;
          e.preventDefault();
        });
      }
      const add = document.getElementById('weave-add-scene');
      const toggle = document.getElementById('weave-enabled');
      if (add) add.onclick = () => { this.setEnabled(true); this.captureCurrentScene(); };
      const load = document.getElementById('weave-load-scene');
      if (load) load.onclick = () => { this.setEnabled(true); this.insertAetherFile(); };
      if (toggle) toggle.onclick = () => this.setEnabled(!this.enabled);
      this.wireQuietPanels();
      this.render();
      this.setEnabled(this.enabled);
      this.startLoop();
    }

    setEnabled(enabled) {
      const wasEnabled = this.enabled;
      this.enabled = !!enabled;
      this.lastTickTime = performance.now();
      // Turning the Weave on opens it in PLAY (Matt, 5 Oct): the arrangement view is the default.
      if (this.enabled && !wasEnabled) { this.mode = 'play'; this.switchP = 1; this.isSwitching = false; }
      if (!this.enabled) {
        this._enableSeq++;             // any decode / preparation in flight is now stale
        this._launch = null;
        this._launchSeq++;
        this._autoPrep = null;
        this._switching = false;
        this._stopFadeSources();
        this._setFade(1);
        this.glide = null;
        this._glideStartedFor = null;
        this._previewToken++;
        this.editingIndex = null;
      }
      if (document.body && document.body.classList) document.body.classList.toggle('weave-off', !this.enabled);
      const button = document.getElementById('weave-enabled');
      if (button) {
        button.textContent = 'WEAVE ' + (this.enabled ? 'ON' : 'OFF');
        button.setAttribute('aria-pressed', String(this.enabled));
      }
      if (this.enabled) this.render();
      if (window.studio && typeof window.studio.resizeCanvas === 'function') window.studio.resizeCanvas();
    }

    snapSceneBars(value) {
      const values = [1, 2, 4, 8, 16, 32, 64];
      return values.reduce((best, bars) => Math.abs(bars - value) < Math.abs(best - value) ? bars : best, values[0]);
    }

    setSceneBars(sceneId, bars) {
      if (this.mode !== 'build' || this.session.demo || !this.session.available) return false;
      const snapped = this.snapSceneBars(bars);
      const doc = this.session.doc;
      if (!doc.scenes[sceneId]) return false;
      const beats = snapped * doc.tempo.beatsPerBar;
      if (doc.scenes[sceneId].duration.beats === beats) return true;
      const result = S1.setDuration(doc, sceneId, { mode: 'beats', beats }, { now: () => this._nowIso() });
      if (!result.ok || !S1.checkCompactCapacity(result.doc).ok) return false;
      this.session.doc = result.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this._previewToken++;
      this.glide = null;
      this._glideStartedFor = null;
      this.syncViewFromDoc();
      this.render();
      return true;
    }

    bindSceneResizeHandles(loomVp) {
      this.weaveEl.querySelectorAll('[data-scene-resize]').forEach(handle => {
        const id = handle.dataset.sceneResize;
        let drag = null;
        handle.addEventListener('pointerdown', e => {
          if (e.button !== undefined && e.button !== 0) return;
          if (this.mode !== 'build' || this.session.demo || drag) return;
          const index = this.sceneIndexById(id);
          if (index < 0) return;
          e.preventDefault(); e.stopPropagation();
          const row = handle.closest('.weave-loom-row-wrap');
          const card = row.querySelector('.weave-loom-row-card');
          const rows = Array.from(this.weaveEl.querySelectorAll('.weave-loom-row-wrap'));
          drag = { pointer: e.pointerId, y: e.clientY, bars: this.scenes[index].bars, value: this.scenes[index].bars,
            scale: row.getBoundingClientRect().height / row.offsetHeight || 1,
            px: this.loomGeo.pxPerBar, scroll: loomVp ? loomVp.scrollTop : 0,
            index, rows, tops: rows.map(r => parseFloat(r.style.top)), height: row.offsetHeight, row, card };
          row.classList.add('is-resizing');
          try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        });
        handle.addEventListener('pointermove', e => {
          if (!drag || drag.pointer !== e.pointerId) return;
          e.preventDefault(); e.stopPropagation();
          const delta = (e.clientY - drag.y) / drag.scale + (loomVp ? loomVp.scrollTop - drag.scroll : 0);
          drag.value = this.snapSceneBars(drag.bars + delta / drag.px);
          const height = Math.max(46, drag.value * drag.px);
          const shift = height - drag.height;
          drag.row.style.height = height + 'px'; drag.card.style.height = height + 'px';
          const svg = drag.card.querySelector('svg');
          if (svg) { svg.setAttribute('viewBox', '0 0 300 ' + drag.height); svg.setAttribute('height', height); }
          drag.rows.forEach((row, i) => { if (i > drag.index) row.style.top = (drag.tops[i] + shift) + 'px'; });
          drag.row.querySelectorAll('[data-scene-bars-preview]').forEach(label => { label.textContent = drag.value + ' bars'; });
          const content = drag.row.parentElement;
          const last = drag.rows[drag.rows.length - 1];
          content.style.height = Math.max(688, parseFloat(last.style.top) + last.offsetHeight) + 'px';
        });
        const finish = e => {
          if (!drag || drag.pointer !== e.pointerId) return;
          e.preventDefault(); e.stopPropagation();
          const value = drag.value; drag = null;
          try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
          if (e.type === 'pointerup' && this.mode === 'build' && handle.isConnected !== false) {
            if (!this.setSceneBars(id, value)) this.renderWeaveLeft();
            else this.renderWeaveLeft(); // also restore geometry for an unchanged snapped value
          } else this.renderWeaveLeft();
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
        handle.addEventListener('keydown', e => {
          const index = this.sceneIndexById(id);
          if (index < 0 || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const values = [1, 2, 4, 8, 16, 32, 64];
          const at = values.indexOf(this.snapSceneBars(this.scenes[index].bars));
          const next = e.key === 'Home' ? 1 : e.key === 'End' ? 64 : values[Math.max(0, Math.min(values.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
          this.setSceneBars(id, next);
        });
      });
    }

    toggleMode() {
      this.setMode(this.mode === 'build' ? 'play' : 'build');
    }

    setMode(newMode) {
      if (newMode === this.mode && !this.isSwitching) return;
      const st = window.studio;
      // BUILD is the quiet room (Matt, 5 Oct): switching to it stops the transport; an audition
      // that was running in BUILD ends when going back to PLAY.
      if (this.enabled && st && st.isPlaying && typeof st.stopMaster === 'function' && (newMode === 'build' || this._audition !== null)) {
        try { st.stopMaster(); } catch (e) {}
      }
      this._audition = null;
      this._auditionStopAt = null;
      this.isHolding = false;
      this.mode = newMode;
      this.isSwitching = true;
      this.switchStartTime = performance.now();
      if (this.weaveEl) {
        this.weaveEl.classList.toggle('play', this.mode === 'play');
        this.weaveEl.classList.toggle('is-build', this.mode === 'build');
      }
      // LAB-8: the right panel must swap to its PLAY / BUILD view straight away.
      this.renderTransitionRight();
      this.updateQuiet();
    }

    selectScene(idx) {
      // LAB-11 tap = inspect only: selecting a scene shows it in the panels but
      // never moves the nodes. Only ADJUST (and, later, JUMP) recall positions.
      this.selectedIndex = Math.max(0, Math.min(this.scenes.length - 1, idx));

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
      const scene = this.scenes[idx];
      if (!scene) return;
      if (scene.demo) {
        // D8: the demo set is read-only.
        this._toast('Demo Scene \u2014 press + SCENE to capture a real one', 'info');
        return;
      }
      this.editingIndex = idx;
      this.selectedIndex = idx; // LAB-12: transition panel follows the scene being adjusted
      this.glide = null;

      // Provisional D5 (S4): bound spatial recall. Only slots whose live source is the
      // one this Scene recorded for that thread are moved; the rest are left alone and
      // named. Full Scene recall (sources, parameters, channel) is not part of S4.
      if (scene.spatialState && window.studio && Array.isArray(window.studio.tracks)) {
        const skipped = [];
        NODE_NAMES.forEach((key, i) => {
          const track = window.studio.tracks[i];
          const nodeState = scene.spatialState[key];
          if (!track || !nodeState) return;
          if (!this.adjustRecallWritable(i, scene.id)) { skipped.push(slotLabel(i)); return; }
          track.setPosition(nodeState.x, nodeState.y, nodeState.z !== undefined ? nodeState.z : 0);
        });
        if (typeof window.studio.drawArena === 'function') {
          window.studio.drawArena();
        }
        if (skipped.length) {
          this._toast('Scene ' + pad2(idx + 1) + ': ' + skipped.join(', ') + ' play a different source and were left alone. Full Scene recall isn\u2019t available in this version.', 'info');
        }
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
      const row = this.scenes[this.editingIndex];
      if (!row || row.demo) return;
      if (!window.studio || !Array.isArray(window.studio.tracks) || window.studio.tracks.length < 4) return;
      if (!this.session.doc || !this.session.doc.scenes[row.id]) return;

      // Provisional D5 (S4): a drag-end writes the Scene only for slots BOUND TO THIS
      // SCENE (binding.sceneId must match); matching sources alone do not permit
      // editing another Scene. Writes go through S1 (clone, edit, validate).
      const tracks = window.studio.tracks;
      const doc = this.session.doc;
      const next = JSON.parse(JSON.stringify(doc));
      const scene = next.scenes[row.id];
      const written = [], skipped = [];
      for (let k = 0; k < 4; k++) {
        const t = tracks[k];
        const tid = this._threadIdForSlot(k);
        const ts = tid ? scene.threadStates[tid] : null;
        if (!t || !ts) continue;
        if (!this.adjustEditWritable(k, row.id)) { skipped.push(slotLabel(k)); continue; }
        ts.spatial = { x: t.x, y: t.y };
        if (t.z !== undefined) ts.spatial.z = t.z;
        written.push(k);
      }
      if (written.length) {
        const t = this._nowIso();
        scene.modifiedAt = t;
        next.modifiedAt = t;
        const v = S1.validateDocument(next);
        const cap = v.ok ? S1.checkCompactCapacity(next) : { ok: false };
        if (v.ok && cap.ok) {
          this.session.doc = next;
          this.session.docRevision++;
          this.session.dirty = true;
        } else {
          this._toast('Positions not saved \u2014 the Scene would no longer be valid', 'error');
        }
      }
      if (skipped.length) {
        this._toast('Positions not saved to Scene ' + pad2(this.editingIndex + 1) + ' for ' + skipped.join(', ') + ' \u2014 they belong to another Scene or play a different source', 'info');
      }
      this.syncViewFromDoc();
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    reorderScene(sceneId, toIndex) {
      if (this.mode !== 'build' || !this.session.available || this.session.demo) return false;
      const from = this.sceneIndexById(sceneId);
      if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.scenes.length) return false;
      if (from === toIndex) return true;
      const playingId = this.scenes[this.playingIndex]?.id;
      const selectedId = this.scenes[this.selectedIndex]?.id;
      const editingId = this.editingIndex === null ? null : this.scenes[this.editingIndex]?.id;
      const result = S1.moveScene(this.session.doc, sceneId, toIndex, { now: () => this._nowIso() });
      if (!result.ok) return false;
      this.session.doc = result.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this._previewToken++;
      this.glide = null;
      this._glideStartedFor = null;
      this.syncViewFromDoc();
      this.playingIndex = this.sceneIndexById(playingId);
      this.selectedIndex = this.sceneIndexById(selectedId);
      this.editingIndex = editingId ? this.sceneIndexById(editingId) : null;
      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
    }

    deleteScene(idx) {
      if (idx < 0 || idx >= this.scenes.length) return false;
      const row = this.scenes[idx];
      if (row && row.demo) {
        // D8: the demo set is read-only.
        this._toast('Demo Scene \u2014 press + SCENE to capture a real one', 'info');
        return false;
      }
      // Guard against deleting actively playing scene
      if (idx === this.playingIndex) {
        console.warn(`[Weave] Cannot delete actively playing scene ${pad2(idx + 1)}`);
        return false;
      }
      if (this.scenes.length <= 1) {
        console.warn('[Weave] Cannot delete the only remaining scene');
        return false;
      }
      if (!this.session.doc || !this.session.doc.scenes[row.id]) return false;
      if (this._launch && this._launch.sceneId === row.id) { this._launch = null; this._launchSeq++; }   // a pending destination dies with its Scene
      this._prepared.delete(row.id);
      if (this._autoPrep === row.id) this._autoPrep = null;
      const undoDoc = this.session.doc;
      const playingRow = this.scenes[this.playingIndex];
      // Remember the playing / selected / editing Scenes by stable ID: syncViewFromDoc()
      // renumbers and clamps indices, so they are re-resolved by ID afterwards.
      const selectedRow = this.scenes[this.selectedIndex];
      const editingRow = this.editingIndex !== null ? this.scenes[this.editingIndex] : null;
      const r = S1.deleteScene(this.session.doc, row.id, { protectedId: playingRow ? playingRow.id : undefined, now: () => this._nowIso() });
      if (!r.ok) {
        console.warn('[Weave] Delete refused: ' + r.error);
        return false;
      }
      this.session.doc = r.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this._undo = { doc: undoDoc, revision: this.session.docRevision, label: row.name, index: idx, until: Date.now() + UNDO_MS };
      this.syncViewFromDoc();   // rebuilds rows and renumbers; stable S1 IDs are preserved
      this.totalBarsInProject = this.calcTotalBars();

      const playingAfter = this.sceneIndexById(playingRow ? playingRow.id : null);
      this.playingIndex = playingAfter >= 0 ? playingAfter : Math.max(0, Math.min(this.scenes.length - 1, this.playingIndex));

      const selectedAfter = this.sceneIndexById(selectedRow ? selectedRow.id : null);
      this.selectedIndex = selectedAfter >= 0 ? selectedAfter : Math.min(idx, this.scenes.length - 1);

      const editingAfter = editingRow ? this.sceneIndexById(editingRow.id) : -1;
      this.editingIndex = editingAfter >= 0 ? editingAfter : null;   // deleting the edited Scene ends ADJUST

      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
    }

    /* GO NOW (Matt, 5 Oct): the performer's override. Launches the picked Scene (the selected
       one, or the next in order) on the NEXT BAR of the master clock with a one-bar true
       crossfade — never the long transition programmed in BUILD. Once there, the plan quietly
       resumes: the launched Scene plays its length and its programmed transition carries on.
       HOLD is "keep it going until I say so": loop the current Scene; on release it finishes
       the pass and the plan resumes. Pressing GO NOW cancels a hold and any running transition. */
    goNow() { return this.goNext(); }
    goNext() {
      if (!this.enabled) return false;
      if (this.session.demo || this.scenes.length < 2) return false;   // D8: demo rows never drive the instrument
      const picked = this.selectedIndex !== this.playingIndex ? this.selectedIndex : (this.playingIndex + 1) % this.scenes.length;
      return this.launchScene(picked);
    }

    // The next Scene GO NEXT would launch (for labels).
    nextTarget() {
      if (this._launch) return this.sceneIndexById(this._launch.sceneId);
      if (this.scenes.length < 2) return -1;
      return this.selectedIndex !== this.playingIndex ? this.selectedIndex : (this.playingIndex + 1) % this.scenes.length;
    }

    /* GO NEXT: launch on the next bar once the destination is ready. The current Scene keeps
       playing while the destination is prepared (decoded sounds, parsed instrument bundles);
       a compatible destination (same instruments in the four slots) is ready at once. A new
       destination replaces the pending one; stale preparation never takes over (token). */
    launchScene(idx) {
      if (!this.enabled || this.session.demo) return false;
      if (idx < 0 || idx >= this.scenes.length) return false;
      const st = window.studio;
      if (!st || !st.isPlaying) {           // stopped: start the transport on that Scene
        this._startAt = { idx, bar: 0 };
        this._startTransport();
        return true;
      }
      if (idx === this.playingIndex && !this._launch) return true;
      this.isHolding = false;
      this.glide = null;                     // a programmed transition in progress is abandoned
      this._glideStartedFor = this.playingIndex;   // and not restarted before the launch
      const sceneId = this.scenes[idx].id;
      const token = ++this._launchSeq;
      const plan = this._planFor(sceneId);
      const launch = { sceneId, token, plan, ready: false, atTransport: null, error: null, enableSeq: this._enableSeq, epoch: this.session.epoch };
      this._launch = launch;
      const arm = () => {
        if (this._launch !== launch) return;             // replaced or cancelled meanwhile
        launch.ready = true;
        launch.atTransport = this._nextBarTransport();
        this.renderWeaveLeft(); this.renderTransitionRight();
      };
      if (!plan.needsPrepare) arm();
      else {
        this._prepareScene(sceneId).then(res => {
          if (this._launch !== launch || this._enableSeq !== launch.enableSeq || this.session.epoch !== launch.epoch) return;
          if (!res.ok) {
            launch.error = res.error || 'could not be prepared';
            this._toast('Scene ' + pad2(idx + 1) + ' not ready \u2014 ' + launch.error + '. Still playing ' + this.scenes[this.playingIndex].name, 'error');
            this._launch = null;             // the current Scene keeps playing
            this.renderWeaveLeft(); this.renderTransitionRight();
            return;
          }
          launch.plan = this._planFor(sceneId);
          arm();
        });
      }
      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
    }

    cancelLaunch() { this._launch = null; this._launchSeq++; this.renderTransitionRight(); }

    _launchName() {
      if (!this._launch) return '';
      const idx = this.sceneIndexById(this._launch.sceneId);
      return idx >= 0 ? this.scenes[idx].name : '';
    }

    // Transport time (seconds) of the next bar line on the host grid; falls back to the Weave counter.
    _nextBarTransport() {
      const c = this._clock();
      const barSec = this.getBarDurationSec();
      const next = (Math.floor(c.transportTime / barSec + 1e-6) + 1) * barSec;
      return next;
    }

    _hostBpm() {
      const st = window.studio;
      if (st && typeof st.getClockSnapshot === 'function') { try { const c = st.getClockSnapshot(); if (c && c.bpm > 0) return c.bpm; } catch (e) {} }
      if (st && typeof st.masterBpm === 'number' && st.masterBpm > 0) return st.masterBpm;
      return (st && st.currentBpm) || this.bpm || 120;
    }

    // Host clock view: transport seconds, audio-context seconds, bpm.
    _clock() {
      const st = window.studio;
      let transportTime = this._transportSec || 0, audioTime = 0, bpm = this._hostBpm();
      if (st && typeof st.getClockSnapshot === 'function') { try { const c = st.getClockSnapshot(); transportTime = c.transportTime || 0; audioTime = c.audioCtxTime || 0; } catch (e) {} }
      else if (st && typeof st.getCurrentPlaybackTime === 'function') transportTime = st.getCurrentPlaybackTime() || 0;
      if (!audioTime && st && st.audioCtx) audioTime = st.audioCtx.currentTime || 0;
      return { transportTime, audioTime, bpm };
    }

    _fireLaunch() {
      const l = this._launch; this._launch = null;
      const idx = this.sceneIndexById(l.sceneId);
      if (idx < 0) return;
      const c = this._clock();
      const late = Math.max(0, c.transportTime - (l.atTransport || c.transportTime));   // seconds past the bar line (one frame at most)
      const startAt = c.audioTime > 0 ? Math.max(0, c.audioTime - late) : 0;           // crossfade curves anchored on the bar
      const bars = Math.min(LAUNCH_CROSSFADE_BARS, this.scenes[idx].bars);
      if (l.plan && l.plan.installs.length) {
        // Different instruments: fade down (already at zero on the bar), switch, fade up over one bar.
        this._switchTo(idx, l, startAt);
        return;
      }
      // the crossfade runs inside the launched Scene: bar 0 → bar 1 of its clock
      this._beginTransition(idx, { bars, endsAtBar: bars }, 'fade', startAt);
      this._arriveAt(idx, { keepGlide: true });
      this.currentBarInScene = late / this.getBarDurationSec();
      if (this.glide) this.glide.startBar = 0;
    }

    // Fade down → switch the changed slots to their prepared instruments → fade up (one bar).
    _switchTo(idx, l, startAt) {
      const sceneId = this.scenes[idx].id;
      const prep = this._prepared.get(sceneId);
      const items = prep && prep.result ? prep.result : null;
      this._switching = true;           // holds the master at silence until the switch is done
      this._setFade(0);
      const token = l.token, enableSeq = this._enableSeq, epoch = this.session.epoch;
      const finish = (failures) => {
        this._switching = false;
        if (this._enableSeq !== enableSeq || this.session.epoch !== epoch) return;
        this.glide = null;
        this._arriveAt(idx, {});                 // the whole state, positions snap
        this.currentBarInScene = 0;
        this._entrance = { idx, bars: Math.min(LAUNCH_CROSSFADE_BARS, this.scenes[idx].bars) };   // fade up over one bar
        if (failures.length) this._toast('Scene ' + pad2(idx + 1) + ': ' + failures.join('; '), 'error');
        this.renderWeaveLeft(); this.renderTransitionRight();
      };
      const work = (async () => {
        const failures = [];
        for (const k of l.plan.installs) {
          if (this._enableSeq !== enableSeq || this.session.epoch !== epoch) return failures;
          const item = items && items[k];
          try { await this._installPrepared(k, item, sceneId); }
          catch (e) { failures.push(slotLabel(k) + ' ' + (e && e.message ? e.message : 'could not start')); }
        }
        return failures;
      })();
      work.then(finish, e => finish([e && e.message ? e.message : 'switch failed']));
    }

    /* Compatibility: compare the actual instruments and required sources in the four slots.
       'same' — the slot already plays this Scene's source; 'swap' — a sample/playlist slot that can
       crossfade (decoded buffer cached or decodable); 'install' — a different instrument / live /
       stream / sample-over-instrument that must be prepared and switched; 'silence' — captured empty. */
    _planFor(sceneId) {
      const st = window.studio;
      const doc = this.session.doc;
      const plan = { slots: [], installs: [], swaps: [], needsPrepare: false };
      if (!st || !Array.isArray(st.tracks) || !doc || !doc.scenes[sceneId]) return plan;
      const sc = doc.scenes[sceneId];
      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        const tid = this._threadIdForSlot(k);
        const ts = tid ? sc.threadStates[tid] : null;
        let kind = 'same';
        if (t && ts) {
          const src = ts.source ? ts.source.kind : 'empty';
          const live = this._liveSourceKind(t);
          if (this._slotMatchesScene(k, sceneId)) kind = 'same';
          else if (src === 'empty') kind = live === 'empty' ? 'same' : 'silence';
          else if (src === 'sample' || src === 'playlist') kind = (live === 'sample' || live === 'empty') ? 'swap' : 'install';
          else if (src === 'node') kind = 'install';
          else if (src === 'live-input') kind = live === 'live-input' ? 'same' : 'unsupported';
          else if (src === 'stream') kind = live === 'stream' ? 'same' : 'unsupported';
        }
        plan.slots.push(kind);
        if (kind === 'install') plan.installs.push(k);
        if (kind === 'swap') { plan.swaps.push(k); const id = ts ? this._audioAssetOf(ts) : null; if (id && !this._bufferCache.has(id)) plan.needsPrepare = true; }
      }
      if (plan.installs.length) plan.needsPrepare = true;
      return plan;
    }

    _liveSourceKind(t) {
      if (!t) return 'empty';
      if (t.isCustomNode) return 'node';
      if (t.isLiveIn) return 'live-input';
      if (t.isStream) return 'stream';
      if (t.audioBuffer || t.isLoaded || (Array.isArray(t.playlist) && t.playlist.length) || t.useMediaElement) return 'sample';
      return 'empty';
    }

    // Decode everything a Scene needs without touching the live tracks (host prepareSession).
    _prepareScene(sceneId) {
      const doc = this.session.doc;
      const sc = doc && doc.scenes[sceneId];
      const st = window.studio;
      if (!sc || !st) return Promise.resolve({ ok: false, error: 'no such Scene' });
      const have = this._prepared.get(sceneId);
      if (have && have.revision === doc.modifiedAt && (have.promise || have.result)) return have.promise || Promise.resolve({ ok: true, result: have.result });
      const enableSeq = this._enableSeq, epoch = this.session.epoch;
      const entry = { revision: doc.modifiedAt, promise: null, result: null, error: null };
      this._prepared.set(sceneId, entry);
      entry.promise = (async () => {
        const S2 = (typeof window !== 'undefined' && window.AetherWeaveAssets) || null;
        const session = { version: '3.1', type: 'aether_project', name: sc.name, tracks: [] };
        const perSlot = [null, null, null, null];
        for (let k = 0; k < 4; k++) {
          const tid = this._threadIdForSlot(k);
          const ts = tid ? sc.threadStates[tid] : null;
          if (!ts || !ts.source) continue;
          const src = ts.source;
          const data = id => { const a = doc.assets[id]; return a && a.storage ? a.storage.data : null; };
          const tr = { index: k, name: 'Track ' + (k + 1), x: ts.spatial ? ts.spatial.x : 0.5, y: ts.spatial ? ts.spatial.y : 0.5, z: ts.spatial && ts.spatial.z !== undefined ? ts.spatial.z : 0, playlist: [], playlistIndex: 0 };
          if (src.kind === 'node') {
            tr.isCustomNode = true; tr.customNodeZipBase64 = data(src.node.bundleAssetId); tr.customNodeParams = src.node.params || {};
            tr.sampleName = (src.node.manifestId || 'instrument') + '.aethernode';
            if (src.node.tapeAssetId) tr.sampleData = data(src.node.tapeAssetId);
            if (!tr.customNodeZipBase64) throw new Error('Track ' + (k + 1) + ': instrument bundle is missing from the Weave');
          } else if (src.kind === 'sample' || src.kind === 'playlist') {
            const id = this._audioAssetOf(ts);
            if (this._bufferCache.has(id)) continue;              // already decoded: nothing to prepare
            tr.sampleData = data(id);
            if (!tr.sampleData) throw new Error('Track ' + (k + 1) + ': sound is missing from the Weave');
          } else continue;
          session.tracks.push(tr); perSlot[k] = tr;
        }
        if (!session.tracks.length) return { ok: true, result: [null, null, null, null] };
        if (typeof st.prepareSession !== 'function') {
          // No host preparation (tests, plain browser): sounds can still be decoded one by one; instruments cannot.
          if (session.tracks.some(tr => tr.isCustomNode)) throw new Error('the app cannot prepare instruments here');
          for (const tr of session.tracks) { const ts = sc.threadStates[this._threadIdForSlot(tr.index)]; const buf = await this._decodeAsset(this._audioAssetOf(ts)); if (!buf) throw new Error('Track ' + (tr.index + 1) + ': sound could not be decoded'); }
          if (this._enableSeq !== enableSeq || this.session.epoch !== epoch) return { ok: false, error: 'cancelled' };
          return { ok: true, result: [null, null, null, null] };
        }
        const prepared = await st.prepareSession(session);
        if (this._enableSeq !== enableSeq || this.session.epoch !== epoch) return { ok: false, error: 'cancelled' };
        const out = [null, null, null, null];
        for (const item of prepared) { out[item.index] = item; const k = item.index; const ts = sc.threadStates[this._threadIdForSlot(k)]; const id = ts ? this._audioAssetOf(ts) : null; if (id && item._decoded && !ts.source.node) this._bufferCache.set(id, item._decoded); }
        return { ok: true, result: out };
      })().then(r => { if (r.ok) entry.result = r.result; else entry.error = r.error; entry.promise = null; if (!r.ok) this._prepared.delete(sceneId); return r; },
               e => { entry.error = e && e.message ? e.message : String(e); entry.promise = null; this._prepared.delete(sceneId); return { ok: false, error: entry.error }; });
      return entry.promise;
    }

    // Put a prepared instrument/sound on slot k (the host's own load discipline, per track).
    async _installPrepared(k, item, sceneId) {
      const st = window.studio;
      const t = st.tracks[k];
      const doc = this.session.doc;
      const sc = doc.scenes[sceneId];
      const ts = sc.threadStates[this._threadIdForSlot(k)];
      if (!t || !ts) return;
      this._stopFadeSourcesFor(k);
      const wasPlaying = !!st.isPlaying;
      if (typeof t.stopNodeOnly === 'function') t.stopNodeOnly();
      t._sourceRevision = (t._sourceRevision || 0) + 1; t._bufferOrigin = null;
      if (typeof t.cleanupSources === 'function') t.cleanupSources();
      t.playlist = []; t.playlistIndex = 0; t.isShuffle = false; t.duration = 0; t.isLoaded = false; t.useMediaElement = false; t.audioBuffer = null;
      t.isLiveIn = false; t.isStream = false; t.streamUrl = ''; t._projectExternal = null;
      const src = ts.source;
      if (src.kind === 'node') {
        if (!item || !item._bundle) throw new Error('instrument not prepared');
        if (item._decoded) { t.audioBuffer = item._decoded; t.duration = item._decoded.duration; t.isLoaded = true; t._bufferOrigin = { kind: 'session' }; }
        await t.loadNodeBundle(item._bundle, false);
        if (!t.isCustomNode || t.customNodeBundle !== item._bundle) throw new Error('instrument could not start');
        t.customNodeZipBase64 = item.customNodeZipBase64 || null;
        if (item.customNodeParams && t.customNodeDSP) {
          for (const [id, value] of Object.entries(item.customNodeParams)) {
            if (typeof t.customNodeDSP.setParameter === 'function') t.customNodeDSP.setParameter(id, value);
            else if (t.customNodeDSP.params) t.customNodeDSP.params[id] = value;
          }
        }
        if (t.customNodeDSP && typeof t.customNodeDSP.stop === 'function') t.customNodeDSP.stop();
        if (t.nameEl && item.sampleName) t.nameEl.textContent = item.sampleName;
      } else if (src.kind === 'sample' || src.kind === 'playlist') {
        if (t.isCustomNode && typeof t.cleanupCustomNode === 'function') t.cleanupCustomNode();
        const id = this._audioAssetOf(ts);
        const buf = this._bufferCache.get(id) || (item && item._decoded) || null;
        if (!buf) throw new Error('sound not prepared');
        this._bufferCache.set(id, buf);
        t.audioBuffer = buf; t.duration = buf.duration; t.isLoaded = true; t._bufferOrigin = { kind: 'session' };
        if (t.statusEl) t.statusEl.textContent = buf.duration.toFixed(1) + 's \u2022 Scene sound';
      }
      t._weaveBinding = { weaveId: doc.id, threadId: this._threadIdForSlot(k), sceneId, sourceIdentity: identityOf(ts), selectedKey: selectedKeyOf(ts), sourceRevision: t._sourceRevision };
      if (typeof t.updatePlaylistUI === 'function') { try { t.updatePlaylistUI(); } catch (e) {} }
      if (wasPlaying && typeof t.play === 'function' && t.isLoaded) { const at = typeof st.getCurrentPlaybackTime === 'function' ? st.getCurrentPlaybackTime() : 0; try { t.play(at); } catch (e) {} }
      if (typeof t.updateAudioParamsFromPosition === 'function') t.updateAudioParamsFromPosition();
    }

    // Transport ownership of outgoing crossfade sources (Codex r6 P1).
    _stopFadeSources() { for (const f of Array.from(this._fadeSources)) this._stopFade(f); }
    _stopFadeSourcesFor(k) { for (const f of Array.from(this._fadeSources)) if (f.k === k) this._stopFade(f); }
    _stopFade(f) {
      this._fadeSources.delete(f);
      if (f.timer) clearTimeout(f.timer);
      try { if (f.old) { try { f.old.stop(0); } catch (e) {} f.old.disconnect(); } } catch (e) {}
      try { if (f.gOut) f.gOut.disconnect(); } catch (e) {}
    }

    toggleHold() {
      this.isHolding = !this.isHolding;
      if (this.isHolding) { this._launch = null; this.glide = null; this._glideStartedFor = null; }
      else this._glideStartedFor = null;   // released: the plan resumes at the end of this pass
      this.renderTransitionRight();
    }

    /* PLAY: double-click a Scene to move there now with the current transition. While stopped it
       starts the transport from that Scene. */
    jumpToScene(idx) {
      if (!this.enabled || this.session.demo || this.mode !== 'play') return false;
      if (idx < 0 || idx >= this.scenes.length) return false;
      const st = window.studio;
      if (!st || !st.isPlaying) {
        this._startAt = { idx, bar: 0 };
        this._startTransport();
        return true;
      }
      // double-click = launch: the same quantized one-bar crossfade as GO NOW
      return this.launchScene(idx);
    }

    _startTransport() {
      const st = window.studio;
      if (!st) return false;
      if (typeof st.ensureAudioRunning === 'function') {
        return Promise.resolve(st.ensureAudioRunning()).then(() => { if (!st.isPlaying && typeof st.playMaster === 'function') st.playMaster(); return true; }).catch(() => false);
      }
      if (!st.isPlaying && typeof st.playMaster === 'function') st.playMaster();
      return true;
    }

    /* BUILD: swipe left on a Scene to AUDITION it — the Scene's state is recalled and plays,
       holding (looping) on that Scene. Swiping it again, Stop/Space, or going to PLAY ends it. */
    auditionScene(idx) {
      if (!this.enabled || this.mode !== 'build' || this.session.demo) return false;
      if (idx < 0 || idx >= this.scenes.length) return false;
      const st = window.studio;
      if (this._audition === idx && st && st.isPlaying) { this.stopAudition(); return true; }
      this._audition = idx;
      this._auditionStopAt = null;
      this.selectedIndex = idx;
      if (st && st.isPlaying) {
        this.playingIndex = idx; this.currentBarInScene = 0; this.glide = null; this._glideStartedFor = null;
        this.isHolding = true;
        this.applySceneState(this.scenes[idx].id, {});
      } else {
        this.isHolding = true;
        this._startAt = { idx, bar: 0 };
        this._startTransport();
      }
      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
    }

    stopAudition() {
      const st = window.studio;
      this._audition = null; this._auditionStopAt = null; this.isHolding = false;
      if (st && st.isPlaying && typeof st.stopMaster === 'function') { try { st.stopMaster(); } catch (e) {} }
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    /* BUILD: audition the transition from the selected Scene into the next — the last bars of
       the selected Scene, the transition, and the first bars of the next; then it stops. */
    auditionTransition() {
      if (!this.enabled || this.mode !== 'build' || this.session.demo || this.scenes.length < 2) return false;
      const a = this.selectedIndex, b = (a + 1) % this.scenes.length;
      const bars = this.scenes[a].bars;
      const L = Math.min(this.transitionLengthBars, bars);
      const lead = this.transitionMode === 'jump' ? 1 : L;          // how much of A to hear before the change
      const tail = 1;   // one bar of B after the change
      const st = window.studio;
      if (st && st.isPlaying && typeof st.stopMaster === 'function') { try { st.stopMaster(); } catch (e) {} }
      this._audition = a;
      this.isHolding = false;
      this._auditionStopAt = { idx: b, bar: Math.min(tail, this.scenes[b].bars) };
      this._startAt = { idx: a, bar: Math.max(0, bars - lead - 0.5) };
      this._startTransport();
      this.renderTransitionRight();
      return true;
    }

    /* BUILD: rename a Scene in place (double-click the row). */
    renameScene(sceneId, name) {
      if (!this.session.available || this.session.demo) return false;
      const clean = String(name || '').trim().slice(0, 80);
      if (!clean) return false;
      const r = S1.renameScene(this.session.doc, sceneId, clean, { now: () => this._nowIso() });
      if (!r.ok) return false;
      this.session.doc = r.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this.syncViewFromDoc();
      this.renderWeaveLeft();
      this.renderTransitionRight();
      return true;
    }

    /* PLAY set list (Matt, 5 Oct): click a row to pick the GO NEXT destination; swipe left to
       reveal RENAME, swipe right to reveal DELETE; the revealed button must be tapped. */
    bindSetRowGestures() {
      const REVEAL = 96, THRESHOLD = 40;
      this.weaveEl.querySelectorAll('.weave-set-wrap').forEach(wrap => {
        const row = wrap.querySelector('.weave-set-row');
        const sceneId = wrap.dataset.sceneId;
        const idx = +wrap.dataset.sceneIndex;
        let down = false, startX = 0, startY = 0, locked = null, dx = 0, pointerId = null;
        const open = (which) => { wrap.classList.toggle('open-rename', which === 'rename'); wrap.classList.toggle('open-delete', which === 'delete'); row.style.transform = which === 'rename' ? `translateX(${-REVEAL}px)` : which === 'delete' ? `translateX(${REVEAL}px)` : ''; wrap.dataset.open = which || ''; };
        const closeOthers = () => this.weaveEl.querySelectorAll('.weave-set-wrap').forEach(w => { if (w !== wrap && w.dataset.open) { w.dataset.open = ''; w.classList.remove('open-rename', 'open-delete'); const r = w.querySelector('.weave-set-row'); if (r) { r.style.transition = 'transform 0.18s ease'; r.style.transform = ''; } } });
        const onDown = (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          if (e.target && e.target.closest && e.target.closest('input, [data-set-rename], [data-set-delete]')) return;
          down = true; pointerId = e.pointerId; startX = e.clientX; startY = e.clientY; locked = null; dx = 0;
          row.style.transition = 'none';
          try { row.setPointerCapture(e.pointerId); } catch (_) {}
        };
        const onMove = (e) => {
          if (!down || e.pointerId !== pointerId) return;
          const mx = e.clientX - startX, my = e.clientY - startY;
          if (locked === null) { if (Math.hypot(mx, my) < 6) return; locked = Math.abs(mx) > Math.abs(my) ? 'h' : 'v'; if (locked === 'h') closeOthers(); }
          if (locked !== 'h') return;
          e.preventDefault();
          const base = wrap.dataset.open === 'rename' ? -REVEAL : wrap.dataset.open === 'delete' ? REVEAL : 0;
          dx = Math.max(-REVEAL, Math.min(REVEAL, base + mx));
          row.style.transform = `translateX(${dx}px)`;
          wrap.classList.toggle('peek-rename', dx < 0); wrap.classList.toggle('peek-delete', dx > 0);
        };
        const onUp = (e) => {
          if (!down || e.pointerId !== pointerId) return;
          down = false; try { row.releasePointerCapture(e.pointerId); } catch (_) {}
          row.style.transition = 'transform 0.18s ease';
          wrap.classList.remove('peek-rename', 'peek-delete');
          if (e.type === 'pointercancel' || e.type === 'lostpointercapture') { open(wrap.dataset.open || null); locked = null; return; }
          if (locked === 'h') {
            if (dx <= -THRESHOLD) open('rename');
            else if (dx >= THRESHOLD) open('delete');
            else open(null);
          } else if (locked === null) {
            if (wrap.dataset.open) { open(null); }
            else {
              closeOthers();
              // a second tap on the same row within 350 ms launches it (the row re-renders on select,
              // so native dblclick cannot be relied on); a single tap picks it
              const now = performance.now(), last = this._lastSetTap; this._lastSetTap = { id: sceneId, at: now };
              if (last && last.id === sceneId && now - last.at < 350) { this._lastSetTap = null; this.jumpToScene(this.sceneIndexById(sceneId)); }
              else if (this.selectedIndex !== idx) this.selectScene(idx);
            }
          }
          locked = null;
        };
        row.addEventListener('pointerdown', onDown);
        row.addEventListener('pointermove', onMove);
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onUp);
        row.addEventListener('lostpointercapture', onUp);
        const ren = wrap.querySelector('[data-set-rename]');
        if (ren) ren.onclick = (e) => { e.stopPropagation(); open(null); this.beginRename(sceneId); };
        const del = wrap.querySelector('[data-set-delete]');
        if (del) del.onclick = (e) => { e.stopPropagation(); if (!this.deleteScene(this.sceneIndexById(sceneId))) { open(null); this._toast('The sounding Scene cannot be deleted', 'info'); } };
      });
    }

    // Bring back the last deleted Scene (within the undo window, if nothing else changed since).
    undoDelete() {
      const u = this._undo; this._undo = null; clearTimeout(this._undoTimer);
      if (!u) return false;
      if (this.session.docRevision !== u.revision || Date.now() > u.until + 2000) { this._toast('Too late to undo', 'info'); this.renderWeaveLeft(); return false; }
      const playingId = this.scenes[this.playingIndex] ? this.scenes[this.playingIndex].id : null;
      this.session.doc = u.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this.syncViewFromDoc();
      const p = this.sceneIndexById(playingId); if (p >= 0) this.playingIndex = p;
      this.selectedIndex = Math.min(u.index, this.scenes.length - 1);
      this.renderWeaveLeft(); this.renderTransitionRight();
      this._toast('Restored ' + u.label, 'info');
      return true;
    }

    beginRename(sceneId) {
      if (this.session.demo || !this.weaveEl || !this.weaveEl.querySelector) return false;
      const row = this.mode === 'build'
        ? this.weaveEl.querySelector('.weave-loom-row-wrap[data-scene-id="' + sceneId + '"]')
        : this.weaveEl.querySelector('.weave-set-wrap[data-scene-id="' + sceneId + '"]');
      const label = row && row.querySelector('[data-scene-name]');
      if (!label || label.querySelector('input')) return false;
      const idx = this.sceneIndexById(sceneId);
      const input = document.createElement('input');
      input.type = 'text'; input.value = this.scenes[idx] ? this.scenes[idx].name : ''; input.maxLength = 80;
      input.className = 'weave-scene-name-input'; input.setAttribute('aria-label', 'Scene name');
      label.textContent = ''; label.appendChild(input);
      label.style.pointerEvents = 'auto';
      let done = false;
      const finish = (commit) => {
        if (done) return; done = true;
        if (commit && input.value.trim() && this.renameScene(sceneId, input.value)) return;
        this.renderWeaveLeft();
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
      input.addEventListener('keyup', (e) => e.stopPropagation());
      input.addEventListener('keypress', (e) => e.stopPropagation());
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.focus(); input.select();
      return true;
    }

    // Advance clock from master transport
    onTransportTick(isPlaying, bpm = 120, deltaSec = 0) {
      this.bpm = bpm;
      if (!this.enabled || !isPlaying) return;
      if (this.session.demo) return;   // D8: the demo set is never played

      const barSec = this.getBarDurationSec();
      const barsElapsed = deltaSec / barSec;
      const currentScene = this.scenes[this.playingIndex];

      this.currentBarInScene += barsElapsed;
      this._transportSec = (this._transportSec || 0) + deltaSec;   // fallback grid when the host has no clock snapshot

      const nextIdx = (this.playingIndex + 1) % this.scenes.length;
      const L = Math.min(this.transitionLengthBars, currentScene.bars);
      const barsToEnd = currentScene.bars - this.currentBarInScene;
      // A pending launch (GO NEXT / double-click / a late broadcast step) fires on its bar line of
      // the host grid once the destination is ready, and replaces everything below.
      if (this._launch && this._launch.ready) {
        const c = this._clock();
        if (c.transportTime >= this._launch.atTransport - 1e-3) { this._fireLaunch(); this._updateFade(); return; }
      }
      // Broadcast plan: prepare the next Scene ahead of its transition when it needs instruments.
      const nextScene = this.scenes[nextIdx];
      if (!this.isHolding && !this._launch && this.scenes.length > 1 && nextScene && barsToEnd <= L + PREPARE_LEAD_BARS && this._autoPrep !== nextScene.id) {
        this._autoPrep = nextScene.id;
        if (this._planFor(nextScene.id).needsPrepare) this._prepareScene(nextScene.id).then(() => { this.renderTransitionRight(); });
      }
      // Programmed transitions (BUILD): over the last L bars, arriving exactly on the next Scene's
      // bar 1. MORPH glides the continuous values and switches a changed sample at the start;
      // FADE glides them too and crossfades a changed sample over the whole window. JUMP cuts.
      // A Scene that needs new instruments is not glided into: it is switched at the boundary.
      if (this.transitionMode !== 'jump' && !this.isHolding && !this._launch && this.scenes.length > 1 && this._glideStartedFor !== this.playingIndex && barsToEnd <= L) {
        this._glideStartedFor = this.playingIndex;
        const plan = this._planFor(nextScene.id);
        if (!plan.installs.length && !plan.needsPrepare) this._beginTransition(nextIdx, { bars: Math.max(0.001, barsToEnd), endsAtBar: currentScene.bars }, this.transitionMode);
      }
      if (this.isHolding && this.glide && this.glide.endsAtBar !== undefined) {
        this.glide = null; // HOLD: stop gliding where we are
        this._glideStartedFor = null;
      }
      this._updateFade();

      if (this._auditionStopAt && this.playingIndex === this._auditionStopAt.idx && this.currentBarInScene >= this._auditionStopAt.bar) {
        this._auditionStopAt = null; this._audition = null; this.isHolding = false;
        const st = window.studio;
        if (st && typeof st.stopMaster === 'function') { try { st.stopMaster(); } catch (e) {} }
        return;
      }

      if (this.currentBarInScene >= currentScene.bars) {
        if (this.isHolding || this.scenes.length === 1 || this._launch) {
          // Loop the current Scene (HOLD, a single Scene, or a launch still being prepared)
          this.currentBarInScene = this.currentBarInScene % currentScene.bars;
        } else {
          const plan = this._planFor(nextScene.id);
          if (plan.installs.length || plan.needsPrepare) {
            // The broadcast's next Scene needs instruments: keep this Scene playing and launch it
            // (fade down → switch → fade up) on the first bar line after it is ready.
            this.currentBarInScene = this.currentBarInScene % currentScene.bars;
            this._autoPrep = null;
            this.launchScene(nextIdx);
          } else {
            // Advance: the next Scene's whole state is recalled on its bar 1 (JUMP/FADE snap here).
            this.currentBarInScene = this.currentBarInScene - currentScene.bars;
            this._arriveAt(nextIdx, { wrapped: nextIdx === 0 });
          }
        }
      }
    }

    /* Playable arrangement (5 Oct 2026, Matt's priority) -------------------------
       + SCENE captures a usable state. Play starts from Scene 01 and every Scene
       change recalls the whole captured state through the ordinary track methods:
       the slot's sound (sample/playlist buffers held in the Weave's assets), the
       channel strip (gain, EQ, mute, solo), the XYZ position and that Scene's own
       recorded motion, which replaces the previous Scene's motion. MORPH glides the
       continuous values (XYZ, gain, EQ); FADE dips the master level around the
       boundary; JUMP cuts. Custom nodes, live input and streams are not switched
       (their position/levels still follow); this is reported once per Scene. */

    // Called by the host loop on the transport's rising/falling edges.
    _onTransportStarted() {
      if (!this.enabled || this.session.demo) return;
      const st = window.studio;
      const fromStop = !(st && st.transportPosition > 0);
      if (!fromStop) return;   // resume after Pause: keep the place in the arrangement
      const at = this._startAt; this._startAt = null;
      const idx = at && at.idx >= 0 && at.idx < this.scenes.length ? at.idx : 0;
      this.playingIndex = idx;
      this.selectedIndex = idx;
      this.currentBarInScene = at && at.bar ? at.bar : 0;
      this._transportSec = this.currentBarInScene * this.getBarDurationSec();
      this.glide = null;
      this._glideStartedFor = null;
      this._fadeInAt = null;
      this._launch = null;
      this._entrance = at ? null : { idx: 0, bars: 1 };   // arrangement entrance: one bar in (not for an audition)
      this.applySceneState(this.scenes[idx].id, {});
      this._updateFade();
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    _onTransportStopped() {
      const st = window.studio;
      this._stopFadeSources();        // Stop/Pause own every outgoing crossfade source (Codex r6 P1)
      if (this._audition !== null) { this._audition = null; this._auditionStopAt = null; this.isHolding = false; this.renderTransitionRight(); }
      this._launch = null; this._launchSeq++;
      if (st && st.transportPosition > 0) return;   // Pause: hold the place
      // Stop: rewind the arrangement so the next Play starts from Scene 01 again.
      this.currentBarInScene = 0;
      this.glide = null;
      this._glideStartedFor = null;
      this._fadeInAt = null;
      this._entrance = null;
      this._setFade(1);
      if (this.enabled && !this.session.demo) {
        this.playingIndex = 0;
        this.renderWeaveLeft();
        this.renderTransitionRight();
      }
      this.updateQuiet();
    }

    // Land on Scene idx: recall everything (positions snap unless a glide already carried them).
    _arriveAt(idx, opts) {
      opts = opts || {};
      this.playingIndex = idx;
      this.selectedIndex = idx;
      if (!opts.keepGlide) { this.glide = null; }
      this._glideStartedFor = null;
      this._fadeInAt = null;
      if (opts.wrapped) this._entrance = null;   // the wrap is a transition like any other now
      if (!opts.keepGlide) this.applySceneState(this.scenes[idx].id, {});
      this.renderWeaveLeft();
      this.renderTransitionRight();
    }

    // Start the MORPH into Scene nextIdx: discrete sources switch now, the outgoing
    // motion is frozen so it cannot fight the glide, and XYZ/gain/EQ glide to the
    // destination (to the first point of its recorded motion when it has one).
    _beginMorph(nextIdx, timing) { return this._beginTransition(nextIdx, timing, 'morph'); }

    // mode 'fade': a changed sample crossfades over the window (old and new sound overlap on the
    // slot); 'morph': it switches at the start. Both glide XYZ, gain and EQ and freeze the old motion.
    _beginTransition(nextIdx, timing, mode, startAt) {
      const next = this.scenes[nextIdx];
      if (!next || next.demo) return false;
      let ms = 0;
      if (mode === 'fade') ms = timing.ms !== undefined ? timing.ms : Math.max(0, (timing.bars || 0)) * this.getBarDurationSec() * 1000;
      this.applySceneState(next.id, { positions: false, channel: false, motion: false, crossfadeMs: ms, startAt: startAt || 0 });
      return this.startGlide(next, timing, null, { arrangement: true });
    }

    // Recall a Scene's captured state into the live tracks. opts: { positions, channel, source, motion } (default all true).
    applySceneState(sceneId, opts) {
      opts = opts || {};
      const st = window.studio;
      const doc = this.session.doc;
      if (!this.enabled || !st || !Array.isArray(st.tracks) || !doc || !doc.scenes[sceneId]) return false;
      if (this._suspensions.size || this.session.detached) return false;
      if (this.editingIndex !== null) return false;   // ADJUST owns the nodes while open
      const sc = doc.scenes[sceneId];
      const want = k => opts[k] !== false;
      let unsupported = [];
      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        const tid = this._threadIdForSlot(k);
        const ts = tid ? sc.threadStates[tid] : null;
        if (!t || !ts) continue;
        if (want('source')) { const r = this._applySourceToSlot(k, ts, sceneId, opts.crossfadeMs || 0, opts.startAt || 0); if (r === 'unsupported') unsupported.push(k); }
        if (want('channel')) { this._applyChannel(t, ts); this._applyNodeParams(t, ts, null); }
        const busy = t.isRecordingMotion || (st.activeDragNodeIndex === k);
        if (want('positions') && !busy && ts.spatial) {
          const start = this._motionStartOf(ts);
          t.setPosition(start.x, start.y, start.z);
        }
        if (want('motion') && !busy) this._applyMotion(t, ts);
      }
      if (want('channel') && typeof st.updateSoloState === 'function') st.updateSoloState();
      if (typeof st.drawArena === 'function') st.drawArena();
      if (unsupported.length) {
        const key = sceneId + ':src';
        if (!this._skipReported.has(key)) {
          this._skipReported.set(key, true);
          const idx = this.sceneIndexById(sceneId);
          this._toast('Scene ' + (idx >= 0 ? pad2(idx + 1) : '') + ': ' + unsupported.map(slotLabel).join(', ') + ' sound not switched (custom node, live input or stream) — position and levels recalled', 'info');
        }
      }
      return true;
    }

    // Where the Scene puts the node: the first point of its recorded motion, else its position.
    _motionStartOf(ts) {
      const sp = ts.spatial || { x: 0.5, y: 0.5 };
      const m = ts.motion;
      if (m && Array.isArray(m.points) && m.points.length > 1 && m.points[0]) {
        const p = m.points[0];
        return { x: p.x, y: p.y, z: p.z !== undefined ? p.z : (sp.z !== undefined ? sp.z : 0) };
      }
      return { x: sp.x, y: sp.y, z: sp.z !== undefined ? sp.z : 0 };
    }

    /* AetherNode settings. The Scene stores the instrument's parameters; when the slot already runs
       that instrument they are restored in place (pitch and other supported settings included).
       mode null: set everything now. mode 'discrete': set the discrete ones (bool, int, option
       lists) now and return { id: [from, to] } for the continuous ones to glide. */
    _applyNodeParams(t, ts, mode) {
      const src = ts && ts.source;
      if (!t || !t.isCustomNode || !src || src.kind !== 'node' || !src.node || !src.node.params) return null;
      const b = t._weaveBinding; const ident = identityOf(ts);
      if (!(b && b.sourceIdentity === ident) && !(t.customNodeBundle && t.customNodeBundle.manifest && src.node.manifestId && t.customNodeBundle.manifest.id === src.node.manifestId)) return null;
      const manifest = t.customNodeBundle && t.customNodeBundle.manifest;
      const defs = {}; if (manifest && Array.isArray(manifest.parameters)) manifest.parameters.forEach(pr => { defs[pr.id] = pr; });
      const continuous = {};
      for (const [id, value] of Object.entries(src.node.params)) {
        const d = defs[id];
        const isNum = typeof value === 'number' && Number.isFinite(value);
        const discrete = !isNum || !d || d.type === 'bool' || d.type === 'int' || (Array.isArray(d.options) && d.options.length) || d.unit === 'st' || d.unit === 'bpm';
        if (mode === 'discrete' && !discrete) {
          let cur = t.customNodeDSP && t.customNodeDSP.params ? Number(t.customNodeDSP.params[id]) : NaN;
          if (!Number.isFinite(cur)) cur = value;
          continuous[id] = [cur, value];
        } else this._setNodeParam(t, id, value);
      }
      return mode === 'discrete' ? continuous : null;
    }

    _setNodeParam(t, id, value) {
      const st = window.studio;
      if (st && typeof st.applyNodeParam === 'function') { try { st.applyNodeParam(t, id, value); return; } catch (e) {} }
      const dsp = t.customNodeDSP; if (!dsp) return;
      if (typeof dsp.setParameter === 'function') dsp.setParameter(id, value); else if (dsp.params) dsp.params[id] = value;
    }

    _applyChannel(t, ts) {
      const ch = ts.channel;
      if (!ch) return;
      if (t.knobGain && typeof t.knobGain.setValue === 'function') t.knobGain.setValue(ch.gainDb);
      else if (typeof t.updateStripGain === 'function') t.updateStripGain(ch.gainDb);
      else t.stripGainDb = ch.gainDb;
      const eq = ch.eq || { low: 0, mid: 0, high: 0 };
      const knobs = { low: t.knobLow, mid: t.knobMid, high: t.knobHigh };
      for (const band of ['low', 'mid', 'high']) {
        if (knobs[band] && typeof knobs[band].setValue === 'function') knobs[band].setValue(eq[band] || 0);
        else if (typeof t.updateEQ === 'function') t.updateEQ(band, eq[band] || 0);
        else if (t.eqValues) t.eqValues[band] = eq[band] || 0;
      }
      if (!!t.isMuted !== !!ch.mute) { t.isMuted = !!ch.mute; if (t.muteBtn && t.muteBtn.classList) t.muteBtn.classList.toggle('active', t.isMuted); }
      if (!!t.isSoloed !== !!ch.solo) { t.isSoloed = !!ch.solo; if (t.soloBtn && t.soloBtn.classList) t.soloBtn.classList.toggle('active', t.isSoloed); }
      if (typeof t.updateAudioParamsFromPosition === 'function') t.updateAudioParamsFromPosition();
    }

    // The Scene's own motion replaces whatever was running: it starts from its first point now.
    _applyMotion(t, ts) {
      const m = ts.motion;
      const now = performance.now();
      if (m && Array.isArray(m.points) && m.points.length > 1) {
        t.motionPath = m.points.map(p => Object.assign({}, p));
        if (typeof t.setMotionSpeed === 'function') t.setMotionSpeed(m.speed === undefined ? 1 : m.speed); else t.motionSpeed = m.speed === undefined ? 1 : m.speed;
        t.isPlayingMotion = m.playing !== false;
        t.motionAccumulatedTime = 0;
        t.lastMotionFrameTime = now;
      } else {
        t.isPlayingMotion = false;   // the path stays on the track; this Scene just does not run it
        t.lastMotionFrameTime = 0;
      }
      if (t.playMotionBtn && t.playMotionBtn.classList) t.playMotionBtn.classList.toggle('active', !!t.isPlayingMotion);
      if (t.recBtn && t.recBtn.classList) t.recBtn.classList.toggle('greyed-out', !!t.isPlayingMotion);
      if (typeof t.updateMotionButtons === 'function') t.updateMotionButtons();
    }

    // The asset that holds a thread state's audio, or null when it is not a sample/playlist.
    _audioAssetOf(ts) {
      const src = ts && ts.source;
      if (!src) return null;
      if (src.kind === 'sample') return src.sample.assetId;
      if (src.kind === 'playlist') {
        if (src.override) return src.override.assetId;
        const items = src.playlist.items;
        return items[src.playlist.index] || items[0] || null;
      }
      return null;
    }

    // Make the slot play the Scene's sound. Returns 'same' | 'switched' | 'pending' | 'unsupported' | 'empty'.
    _applySourceToSlot(k, ts, sceneId, crossfadeMs, startAt) {
      const st = window.studio;
      const t = st.tracks[k];
      if (this._slotMatchesScene(k, sceneId)) return 'same';
      const kind = ts.source ? ts.source.kind : 'empty';
      const live = this._liveSourceKind(t);
      if (kind === 'empty') {
        // A captured empty slot recalls silence (Codex r6 P2): the previous sound goes, fading out
        // over the crossfade window when there is one.
        if (live === 'empty') return 'same';
        if (live === 'node' || live === 'live-input' || live === 'stream') return 'unsupported';
        this._silenceSlot(k, ts, sceneId, crossfadeMs, startAt);
        return 'silenced';
      }
      if (kind !== 'sample' && kind !== 'playlist') return 'unsupported';
      if (t.isCustomNode || t.isLiveIn || t.isStream || t.useMediaElement) return 'unsupported';
      const assetId = this._audioAssetOf(ts);
      if (!assetId) return 'unsupported';
      const cached = this._bufferCache.get(assetId);
      if (cached) { this._swapBuffer(k, cached, ts, sceneId, crossfadeMs, startAt); return 'switched'; }
      // Not decoded yet (an inserted Scene that was never prepared): decode, then apply only if
      // nothing changed meanwhile — Weave still on, same session, same Scene playing, the slot's
      // source untouched by anyone else (Codex r6 P1).
      const guard = { enableSeq: this._enableSeq, epoch: this.session.epoch, rev: t._sourceRevision, launch: this._launchSeq };
      this._decodeAsset(assetId).then(buf => {
        if (!buf) return;
        if (!this.enabled || this._enableSeq !== guard.enableSeq || this.session.epoch !== guard.epoch) return;
        if (t._sourceRevision !== guard.rev) return;
        const idx = this.sceneIndexById(sceneId);
        if (idx < 0 || idx !== this.playingIndex || this._suspensions.size || this.session.detached) return;
        if (!this._slotMatchesScene(k, sceneId)) this._swapBuffer(k, buf, ts, sceneId, Math.min(crossfadeMs || 0, 500), 0);
      });
      return 'pending';
    }

    // Recall silence on a slot: fade the running sound out (or cut) and unload it.
    _silenceSlot(k, ts, sceneId, crossfadeMs, startAt) {
      const st = window.studio;
      const t = st.tracks[k];
      this._stopFadeSourcesFor(k);
      const ctx = st.audioCtx;
      const old = t.bufferSource;
      if (crossfadeMs > 0 && st.isPlaying && ctx && old && t.eqLowNode && typeof ctx.createGain === 'function') {
        try {
          const sec = crossfadeMs / 1000, now = Math.max(ctx.currentTime, startAt || 0);
          const gOut = ctx.createGain(); gOut.gain.setValueAtTime(1, now);
          old.disconnect(); old.connect(gOut); gOut.connect(t.eqLowNode);
          gOut.gain.setValueCurveAtTime(EQUAL_POWER_OUT, now, sec);
          old.onended = null;
          try { old.stop(now + sec + 0.05); } catch (e) {}
          const f = { k, old, gOut, timer: null };
          f.timer = setTimeout(() => this._stopFade(f), crossfadeMs + 200);
          this._fadeSources.add(f);
          t.bufferSource = null;
        } catch (e) {}
      }
      if (typeof t.stopNodeOnly === 'function') t.stopNodeOnly();
      if (typeof t._noteSourceReplaced === 'function') t._noteSourceReplaced(); else t._sourceRevision = (t._sourceRevision || 0) + 1;
      t.audioBuffer = null; t.duration = 0; t.isLoaded = false; t.useMediaElement = false; t.playlist = []; t.playlistIndex = 0;
      if (t.statusEl) t.statusEl.textContent = 'No file loaded';
      if (typeof t.updatePlaylistUI === 'function') { try { t.updatePlaylistUI(); } catch (e) {} }
      t._weaveBinding = { weaveId: this.session.doc.id, threadId: this._threadIdForSlot(k), sceneId, sourceIdentity: identityOf(ts), selectedKey: selectedKeyOf(ts), sourceRevision: t._sourceRevision };
      if (typeof t.updatePlaybackDisplay === 'function') { try { t.updatePlaybackDisplay(); } catch (e) {} }
    }

    _swapBuffer(k, buf, ts, sceneId, crossfadeMs, startAt) {
      const st = window.studio;
      const t = st.tracks[k];
      const wasPlaying = !!st.isPlaying;
      // True crossfade: hand the running source its own gain, ramp it out while the new sound
      // ramps in on the same slot (equal-power), then stop the old one. Falls back to a switch
      // when the slot has no running Web Audio source. The outgoing source is registered so that
      // Stop/Pause, WEAVE OFF or a newer change on this slot can end it at once (Codex r6 P1).
      this._stopFadeSourcesFor(k);
      const ctx = st.audioCtx;
      const old = t.bufferSource;
      const canCross = !!(crossfadeMs > 0 && wasPlaying && ctx && old && t.eqLowNode && typeof ctx.createGain === 'function');
      let fadeIn = null;
      if (canCross) {
        try {
          const sec = crossfadeMs / 1000, now = Math.max(ctx.currentTime, startAt || 0);   // curves anchored on the bar line
          const gOut = ctx.createGain(); gOut.gain.setValueAtTime(1, now);
          old.disconnect(); old.connect(gOut); gOut.connect(t.eqLowNode);
          gOut.gain.setValueCurveAtTime(EQUAL_POWER_OUT, now, sec);
          old.onended = null;
          try { old.stop(now + sec + 0.05); } catch (e) {}
          const f = { k, old, gOut, timer: null };
          f.timer = setTimeout(() => this._stopFade(f), crossfadeMs + 200);
          this._fadeSources.add(f);
          t.bufferSource = null;   // so stopNodeOnly below leaves the outgoing sound alone
          fadeIn = ctx.createGain(); fadeIn.gain.setValueAtTime(0, now); fadeIn.gain.setValueCurveAtTime(EQUAL_POWER_IN, now, sec);
        } catch (e) { fadeIn = null; }
      }
      if (typeof t.stopNodeOnly === 'function') t.stopNodeOnly();
      if (typeof t._noteSourceReplaced === 'function') t._noteSourceReplaced(); else t._sourceRevision = (t._sourceRevision || 0) + 1;
      t.audioBuffer = buf;
      t.duration = buf && buf.duration !== undefined ? buf.duration : t.duration;
      t.isLoaded = true;
      t.useMediaElement = false;
      t._bufferOrigin = { kind: 'session' };
      t.playlist = [];
      t.playlistIndex = 0;
      if (t.statusEl) t.statusEl.textContent = (t.duration ? t.duration.toFixed(1) + 's • ' : '') + 'Scene sound';
      if (typeof t.updatePlaylistUI === 'function') { try { t.updatePlaylistUI(); } catch (e) {} }
      // The slot now plays this Scene's sound: bind it so later gates see a matching source.
      t._weaveBinding = { weaveId: this.session.doc.id, threadId: this._threadIdForSlot(k), sceneId, sourceIdentity: identityOf(ts), selectedKey: selectedKeyOf(ts), sourceRevision: t._sourceRevision };
      if (wasPlaying && typeof t.play === 'function') {
        const at = typeof st.getCurrentPlaybackTime === 'function' ? st.getCurrentPlaybackTime() : 0;
        try { t.play(at); } catch (e) {}
        if (fadeIn && t.bufferSource) {
          try { t.bufferSource.disconnect(); t.bufferSource.connect(fadeIn); fadeIn.connect(t.eqLowNode); } catch (e) {}
        }
      }
      if (typeof t.updateAudioParamsFromPosition === 'function') t.updateAudioParamsFromPosition();
    }

    // Decode an asset's bytes once (imported Scenes); captured Scenes are cached at capture time.
    _decodeAsset(assetId) {
      if (this._bufferCache.has(assetId)) return Promise.resolve(this._bufferCache.get(assetId));
      const pending = this._decodePending.get(assetId);
      if (pending) return pending;
      const st = window.studio;
      const S2 = (typeof window !== 'undefined' && window.AetherWeaveAssets) || null;
      const a = this.session.doc && this.session.doc.assets[assetId];
      if (!a || !a.storage || !S2 || !st || !st.audioCtx || typeof st.audioCtx.decodeAudioData !== 'function') return Promise.resolve(null);
      const dec = S2.decodeBase64Strict(a.storage.data);
      if (!dec.ok) return Promise.resolve(null);
      const bytes = dec.bytes;
      const p = Promise.resolve(st.audioCtx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
        .then(buf => { this._bufferCache.set(assetId, buf); this._decodePending.delete(assetId); return buf; })
        .catch(() => { this._decodePending.delete(assetId); this._toast('Scene sound could not be decoded', 'error'); return null; });
      this._decodePending.set(assetId, p);
      return p;
    }

    // Master-level dip for FADE and for the arrangement's entrance/ending (one bar each).
    _updateFade() {
      if (!this.enabled || this.session.demo) { this._setFade(1); return; }
      let level = 1;
      const cur = this.scenes[this.playingIndex];
      if (!cur) { this._setFade(1); return; }
      const bar = this.currentBarInScene;
      // Nothing ever dips to silence between Scenes any more (true crossfades instead); the only
      // master-level move left is the one-bar entrance when the arrangement starts from Stop.
      if (this._entrance && this._entrance.idx === this.playingIndex) {
        const p = bar / this._entrance.bars;
        if (p < 1) level = Math.min(level, Math.max(0, p)); else this._entrance = null;
      }
      if (this._switching) level = 0;   // instruments being switched: silent until they are in
      // A ready launch that must switch instruments fades the master down over the half bar before its bar line.
      if (this._launch && this._launch.ready && this._launch.plan && this._launch.plan.installs.length) {
        const c = this._clock(); const half = this.getBarDurationSec() / 2;
        const left = this._launch.atTransport - c.transportTime;
        if (left <= half) level = Math.min(level, Math.max(0, left / half));
      }
      this._setFade(level);
    }

    _setFade(level) {
      level = Math.max(0, Math.min(1, level));
      if (this.fadeLevel === level) return;
      this.fadeLevel = level;
      const st = window.studio;
      if (!st || !st.masterGain || !st.masterGain.gain) return;
      const base = st.masterVolumeSlider ? parseFloat(st.masterVolumeSlider.value) : 1;
      const target = (Number.isFinite(base) ? base : 1) * level;
      const g = st.masterGain.gain;
      try {
        if (st.audioCtx && typeof g.linearRampToValueAtTime === 'function') {
          const now = st.audioCtx.currentTime;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.linearRampToValueAtTime(target, now + 0.03);
        } else g.value = target;
      } catch (e) { g.value = target; }
    }

    /* LAB-12: scenes move the nodes ---------------------------------------
       A scene with saved positions (spatialState, set with ADJUST or + Scene)
       moves the nodes when it starts playing. The node being dragged or recording
       a motion is never moved. For ADJUST/Preview a running motion loop still owns
       its node; for the arrangement the Scene takes the node over (its own motion
       is restored on arrival). While ADJUST is open the set doesn't move anything. */
    nodeIsFree(track, k, takeOver) {
      if (!track) return false;
      if (track.isRecordingMotion) return false;
      if (!takeOver && track.isPlayingMotion) return false;
      const st = window.studio;
      if (st && st.activeDragNodeIndex === k) return false;
      return true;
    }

    // opts: null = snap now; { ms } = glide over wall time; { bars, endsAtBar } = glide with the set clock
    // flags.arrangement: the Scene takes over the nodes (freezes their motion, glides gain/EQ too, lands on the motion's first point).
    startGlide(scene, opts, fromScene, flags) {
      const st = window.studio;
      flags = flags || {};
      if (!this.enabled) return false;
      if (!scene || scene.demo || !scene.spatialState || !st || !Array.isArray(st.tracks)) return false;
      if (this.editingIndex !== null) return false;
      if (this._suspensions.size || this.session.detached) return false;
      const keys = ['T1', 'T2', 'T3', 'T4'];
      const doc = this.session.doc;
      const sc = doc && doc.scenes[scene.id];
      const from = [], to = [], chFrom = [], chTo = [], npFrom = [];
      keys.forEach((key, k) => {
        const t = st.tracks[k];
        let target = scene.spatialState[key];
        const tid = this._threadIdForSlot(k);
        const ts = sc && tid ? sc.threadStates[tid] : null;
        if (flags.arrangement && ts && target) target = this._motionStartOf(ts);
        const src = fromScene && fromScene.spatialState ? fromScene.spatialState[key] : null;
        from.push(t ? (src ? { x: src.x, y: src.y, z: src.z } : { x: t.x, y: t.y, z: t.z }) : null);
        to.push(t && target ? { x: target.x, y: target.y, z: target.z } : null);
        if (flags.arrangement && t && ts && ts.channel) {
          const eq = t.eqValues || { low: 0, mid: 0, high: 0 };
          chFrom.push({ gainDb: t.stripGainDb || 0, low: eq.low || 0, mid: eq.mid || 0, high: eq.high || 0 });
          const teq = ts.channel.eq || { low: 0, mid: 0, high: 0 };
          chTo.push({ gainDb: ts.channel.gainDb || 0, low: teq.low || 0, mid: teq.mid || 0, high: teq.high || 0 });
          if (t.isPlayingMotion && !t.isRecordingMotion) { t.isPlayingMotion = false; t.lastMotionFrameTime = 0; if (t.playMotionBtn && t.playMotionBtn.classList) t.playMotionBtn.classList.remove('active'); }
          // Same instrument, different settings: discrete settings switch now, continuous ones glide.
          npFrom.push(this._applyNodeParams(t, ts, 'discrete'));
        } else { chFrom.push(null); chTo.push(null); npFrom.push(null); }
      });
      this.glide = Object.assign({ from, to, chFrom, chTo, np: npFrom, arrangement: !!flags.arrangement, curve: this.transitionCurve, startMs: performance.now(), startBar: this.currentBarInScene, sceneId: scene.id, glideId: ++this._captureSeq }, opts || {});
      if (!opts) this.stepGlide(1);
      return true;
    }

    moveToScene(idx, opts) {
      this.glide = null;
      return this.startGlide(this.scenes[idx], opts);
    }

    stepGlide(p) {
      const g = this.glide;
      const st = window.studio;
      if (!g || !st || !Array.isArray(st.tracks)) { this.glide = null; return; }
      // S4: every frame is gated. A slot that stops being writable mid-glide stops
      // where it is and is reported once for this glide.
      if (this._suspensions.size || this.session.detached) { this.glide = null; return; }
      const e = easeCurve(p, g.curve);
      const skipped = [];
      g.to.forEach((b, k) => {
        const a = g.from[k];
        const t = st.tracks[k];
        if (!a || !b) return;
        const writable = g.arrangement ? this.nodeIsFree(t, k, true) : this.glideSlotWritable(k, g.sceneId);
        if (!writable) { if (!g.arrangement) skipped.push(k); return; }
        const az = a.z !== undefined ? a.z : 0, bz = b.z !== undefined ? b.z : az;
        t.setPosition(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, az + (bz - az) * e);
        const ca = g.chFrom && g.chFrom[k], cb = g.chTo && g.chTo[k];
        if (ca && cb) {
          const mix = (x, y) => x + (y - x) * e;
          if (typeof t.updateStripGain === 'function') t.updateStripGain(mix(ca.gainDb, cb.gainDb)); else t.stripGainDb = mix(ca.gainDb, cb.gainDb);
          if (typeof t.updateEQ === 'function') { t.updateEQ('low', mix(ca.low, cb.low)); t.updateEQ('mid', mix(ca.mid, cb.mid)); t.updateEQ('high', mix(ca.high, cb.high)); }
          else if (t.eqValues) { t.eqValues.low = mix(ca.low, cb.low); t.eqValues.mid = mix(ca.mid, cb.mid); t.eqValues.high = mix(ca.high, cb.high); }
        }
        const np = g.np && g.np[k];
        if (np) for (const id of Object.keys(np)) this._setNodeParam(t, id, np[id][0] + (np[id][1] - np[id][0]) * e);
      });
      if (skipped.length) this.reportSkipped(g.sceneId, g.glideId, skipped);
      if (typeof st.drawArena === 'function') st.drawArena();
      if (p >= 1) {
        const done = g;
        this.glide = null;
        // An arrangement glide lands on the Scene: start its motion and sync the strip controls.
        if (done.arrangement) this.applySceneState(done.sceneId, { positions: false, source: false });
      }
    }

    updateGlide(now) {
      const g = this.glide;
      if (!g) return;
      if (this.editingIndex !== null) { this.glide = null; return; }
      if (g.ms !== undefined) {
        this.stepGlide(Math.min(1, (now - g.startMs) / g.ms));
      } else if (g.endsAtBar !== undefined) {
        const span = g.endsAtBar - g.startBar;
        this.stepGlide(span <= 0 ? 1 : Math.min(1, (this.currentBarInScene - g.startBar) / span));
      }
    }

    // Preview: play the selected transition once on the canvas (doesn't change the set).
    previewTransition() {
      if (!this.enabled) return false;
      const a = this.scenes[this.selectedIndex];
      const b = this.scenes[(this.selectedIndex + 1) % this.scenes.length];
      if (!b || !b.spatialState) return false;
      const ms = this.transitionMode === 'morph' ? this.transitionLengthBars * this.getBarDurationSec() * 1000 : 0;
      if (b.demo || this._suspensions.size || this.session.detached) return false;   // D8 / S4: nothing to apply
      this.glide = null;
      const token = ++this._previewToken;
      const targetId = b.id;   // the intended target, by stable Scene ID (not the mutable selectedIndex)
      if (a && a.spatialState) this.startGlide(a, null); // start from the outgoing scene
      if (ms > 0) return this.startGlide(b, { ms }, a && a.spatialState ? a : null);
      setTimeout(() => {
        // S4: a delayed Preview runs only if nothing cancelled it meanwhile and the
        // intended Scene still exists; the per-slot gate is re-evaluated inside
        // startGlide/stepGlide at that moment.
        if (token !== this._previewToken) return;
        if (!this.enabled || this._suspensions.size || this.session.detached) return;
        const targetIdx = this.sceneIndexById(targetId);
        if (targetIdx < 0 || this.scenes[targetIdx].demo) return;   // deleted, or the set was replaced
        this.moveToScene(targetIdx, null);
      }, this.getBarDurationSec() * 1000);
      return true;
    }

    // ------------------------------------------------------------------
    // Phase 1 S4: session, capture transaction, bindings, gates, host hooks
    // ------------------------------------------------------------------

    _toast(message, type) {
      const st = window.studio;
      if (st && typeof st.showToast === 'function') { try { st.showToast(message, type || 'info'); } catch (e) {} }
    }

    _nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

    // A new project starts with no Scenes (Matt, 5 Oct): the list is empty until the first
    // + SCENE. The old seed set (Slow emergence / Open water / Afterglow) is kept in
    // DEMO_SET_ROWS for a future demo project and is never shown by default.
    _demoRows() {
      return [];
    }

    _demoSetRows() {
      return INITIAL_SCENES.map((s, idx) => ({
        id: 'scene-' + idx,
        index: idx,
        name: s.name,
        bars: s.bars,
        levels: [...s.levels],
        // Mock spatial positions [-1..1] for morph mini-map
        positions: [0, 1, 2, 3].map(k => [
          Math.sin(idx * 1.7 + k * 2.1) * 0.7,
          Math.cos(idx * 1.3 + k * 1.9) * 0.7
        ]),
        spatialState: null,
        demo: true
      }));
    }

    _threadIdForSlot(k) {
      const doc = this.session.doc;
      if (!doc) return null;
      const th = doc.threads.find(t => t.color === COLOR_TOKENS[k]);
      return th ? th.id : null;
    }

    // Loom ribbon levels and mini-map positions from a Scene's slot positions. This is the
    // formula S1's deriveView mirrors (level = y; position = (v - 0.5) * 2); a slot the Scene
    // does not hold gets level 0 and a placeholder mini-map point.
    _viewFromSpatial(spatialState, idx) {
      const present = NODE_NAMES.map(key => !!(spatialState && spatialState[key]));
      const tracks = NODE_NAMES.map(key => (spatialState && spatialState[key]) || { x: 0.5, y: 0 });
      const scene = {};
      scene.levels = [tracks[0].y, tracks[1].y, tracks[2].y, tracks[3].y];
      scene.positions = [0, 1, 2, 3].map(k => [
        (tracks[k].x - 0.5) * 2.0,
        (tracks[k].y - 0.5) * 2.0
      ]);
      scene.positions = scene.positions.map((p, k) => present[k] ? p : [Math.sin(idx * 1.7 + k * 2.1) * 0.7, Math.cos(idx * 1.3 + k * 1.9) * 0.7]);
      return scene;
    }

    // Rebuild the view list the render code reads from the S1 document.
    syncViewFromDoc() {
      const doc = this.session.doc;
      if (!doc || doc.order.length === 0) {
        this.scenes = this._demoRows();
      } else {
        const threads = doc.threads;
        this.scenes = doc.order.map((sid, idx) => {
          const sc = doc.scenes[sid];
          const spatialState = {};
          let any = false;
          for (let k = 0; k < 4; k++) {
            const tid = this._threadIdForSlot(k);
            const ts = tid ? sc.threadStates[tid] : null;
            if (!ts || !ts.spatial) continue;
            spatialState[NODE_NAMES[k]] = { x: ts.spatial.x, y: ts.spatial.y, z: ts.spatial.z !== undefined ? ts.spatial.z : 0 };
            any = true;
          }
          const view = this._viewFromSpatial(any ? spatialState : null, idx);
          return {
            id: sid,
            index: idx,
            name: sc.name,
            bars: Math.max(1, Math.round(sc.duration.beats / doc.tempo.beatsPerBar)),
            levels: view.levels,
            positions: view.positions,
            spatialState: any ? spatialState : null,
            demo: false
          };
        });
      }
      const n = this.scenes.length;
      this.playingIndex = Math.max(0, Math.min(n - 1, this.playingIndex));
      this.selectedIndex = Math.max(0, Math.min(n - 1, this.selectedIndex));
      if (this.editingIndex !== null && (this.editingIndex >= n || this.scenes[this.editingIndex].demo)) this.editingIndex = null;
      this.totalBarsInProject = this.calcTotalBars();
    }

    // Index of a Scene in the current view list by its stable ID; -1 when absent.
    sceneIndexById(id) {
      if (!id) return -1;
      for (let i = 0; i < this.scenes.length; i++) if (this.scenes[i].id === id) return i;
      return -1;
    }

    // ---- bindings ----
    bindingFor(track) { return track && track._weaveBinding ? track._weaveBinding : null; }

    bindingValid(track) {
      const b = this.bindingFor(track);
      if (!b || !this.session.doc) return false;
      return b.weaveId === this.session.doc.id && track._sourceRevision === b.sourceRevision;
    }

    _slotMatchesScene(k, sceneId) {
      const st = window.studio;
      const doc = this.session.doc;
      if (!st || !Array.isArray(st.tracks) || !doc) return false;
      const track = st.tracks[k];
      if (!track || !this.bindingValid(track)) return false;
      const b = track._weaveBinding;
      const sc = doc.scenes[sceneId];
      const tid = this._threadIdForSlot(k);
      if (!sc || !tid || b.threadId !== tid) return false;
      const ts = sc.threadStates[tid];
      if (!ts) return false;
      return identityOf(ts) === b.sourceIdentity && selectedKeyOf(ts) === b.selectedKey;
    }

    glideSlotWritable(k, sceneId) {
      if (this._suspensions.size || this.session.detached) return false;
      const st = window.studio;
      const track = st && Array.isArray(st.tracks) ? st.tracks[k] : null;
      if (!track || !this.nodeIsFree(track, k)) return false;
      return this._slotMatchesScene(k, sceneId);
    }

    adjustRecallWritable(k, sceneId) {
      if (this._suspensions.size || this.session.detached) return false;
      const st = window.studio;
      const track = st && Array.isArray(st.tracks) ? st.tracks[k] : null;
      if (!track || !this.nodeIsFree(track, k)) return false;
      return this._slotMatchesScene(k, sceneId);
    }

    adjustEditWritable(k, sceneId) {
      if (!this.adjustRecallWritable(k, sceneId)) return false;
      const b = window.studio.tracks[k]._weaveBinding;
      return b.sceneId === sceneId;
    }

    // Each slot is reported once per glide: a slot that becomes unwritable mid-glide is
    // reported when it first stops; slots already reported for this glide are not repeated.
    reportSkipped(sceneId, glideId, slots) {
      const key = sceneId + ':' + glideId;
      let seen = this._skipReported.get(key);
      if (!seen) { seen = new Set(); this._skipReported.set(key, seen); if (this._skipReported.size > 64) { this._skipReported = new Map([[key, seen]]); } }
      const fresh = slots.filter(k => !seen.has(k));
      if (!fresh.length) return;
      fresh.forEach(k => seen.add(k));
      const idx = this.scenes.findIndex(r => r.id === sceneId);
      this._toast('Scene ' + (idx >= 0 ? pad2(idx + 1) : '') + ': ' + fresh.map(slotLabel).join(', ') + ' not moved \u2014 playing a different source', 'info');
    }

    // ---- host hooks (suspension is per operation: a token per call) ----
    onSourcesReplacing() {
      const token = { at: Date.now() };
      this._suspensions.add(token);
      this.glide = null;
      this._glideStartedFor = null;
      this._previewToken++;
      return token;
    }

    onSourcesReplaced(token, info) {
      if (!token || !this._suspensions.has(token)) return;
      this._suspensions.delete(token);
      info = info || {};
      if (info.replaced && this.session.doc && this.session.doc.order.length > 0) {
        this.session.detached = true;
        if (info.kind === 'rebuild') {
          this._toast('Audio engine restarted — + SCENE to rebind the Weave', 'info');
        } else {
          const extra = Array.isArray(info.failures) && info.failures.length ? ' Tracks that failed to load: ' + info.failures.join('; ') + '.' : '';
          this._toast('Weave detached — live sound is now ' + (info.fileName || 'the loaded Aether state') + '. + SCENE to capture it into the Weave.' + extra, 'info');
        }
      }
    }

    get suspended() { return this._suspensions.size > 0; }

    // ---- capture transaction ----
    _pressSnapshot() {
      const st = window.studio;
      const tracks = st.tracks;
      const press = { epoch: this.session.epoch, docRevision: this.session.docRevision, tracks: [] };
      for (let k = 0; k < 4; k++) {
        const t = tracks[k];
        const origin = t._bufferOrigin;
        press.tracks.push({
          sourceRevision: t._sourceRevision,
          bufferRef: t.audioBuffer || null,                      // reference, not copied
          playlistRefs: Array.isArray(t.playlist) ? t.playlist.slice() : [],   // File references
          playlistIndex: t.playlistIndex || 0,
          isShuffle: !!t.isShuffle,
          isRepeat: t.isRepeat !== false,
          isCustomNode: !!t.isCustomNode,
          isLiveIn: !!t.isLiveIn,
          isStream: !!t.isStream,
          streamUrl: t.streamUrl || '',
          dspRef: t.customNodeDSP || null,
          zipRef: t.customNodeZipBase64 || null,
          // origin metadata is copied; the File/AudioBuffer it refers to are kept by reference
          origin: origin ? Object.assign({}, origin) : null
        });
      }
      return press;
    }

    _recheckAgainstPress(press) {
      const st = window.studio;
      if (!st || !Array.isArray(st.tracks)) return 'the app is not available';
      if (press.epoch !== this.session.epoch) return 'the Weave was replaced during capture';
      if (this._suspensions.size) return 'sources are being replaced';
      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k], p = press.tracks[k];
        if (!t) return 'Track ' + (k + 1) + ' is missing';
        const same = t._sourceRevision === p.sourceRevision
          && (t.audioBuffer || null) === p.bufferRef
          && (Array.isArray(t.playlist) ? t.playlist.length : 0) === p.playlistRefs.length
          && (Array.isArray(t.playlist) ? t.playlist.every((f, i) => f === p.playlistRefs[i]) : p.playlistRefs.length === 0)
          && (t.playlistIndex || 0) === p.playlistIndex
          && !!t.isShuffle === p.isShuffle && (t.isRepeat !== false) === p.isRepeat
          && !!t.isCustomNode === p.isCustomNode && !!t.isLiveIn === p.isLiveIn && !!t.isStream === p.isStream
          && (t.streamUrl || '') === p.streamUrl
          && (t.customNodeDSP || null) === p.dspRef && (t.customNodeZipBase64 || null) === p.zipRef;
        if (!same) return 'Track ' + (k + 1) + ' changed during capture';
      }
      return null;
    }

    // Origin proof from the press snapshot only: prune the saved buffer when it is provably
    // the plain decode of the selected playlist item. Otherwise S3 keeps it as an override.
    _pruneByOrigin(snapshot, press) {
      const out = Object.assign({}, snapshot, { tracks: snapshot.tracks.map(tr => Object.assign({}, tr)) });
      for (const tr of out.tracks) {
        const k = tr.index === undefined ? 0 : tr.index;
        const p = press.tracks[k];
        if (!p || !tr.sampleData || !Array.isArray(tr.playlist) || !tr.playlist.length) continue;
        const o = p.origin;
        const proven = !!(o && o.kind === 'decoded-item' && o.revision === p.sourceRevision
          && o.bufferRef === p.bufferRef && p.bufferRef && o.fileRef && o.fileRef === p.playlistRefs[p.playlistIndex]);
        if (proven) { tr.sampleData = null; tr._bufferPruned = true; }
      }
      return out;
    }

    captureCurrentScene() {
      const st = window.studio;
      if (!this.session.available) { this._toast('Weave capture is not available — model scripts not loaded', 'error'); return Promise.resolve({ ok: false, code: 'unavailable' }); }
      if (!st || !Array.isArray(st.tracks) || st.tracks.length < 4 || typeof st.getCurrentSessionData !== 'function') {
        this._toast('Weave capture is not available in this view', 'error');
        return Promise.resolve({ ok: false, code: 'unavailable' });
      }
      if (this._suspensions.size) { this._toast('Wait — sources are being replaced', 'info'); return Promise.resolve({ ok: false, code: 'suspended' }); }
      // 1. Press-time snapshot, then the writer's own synchronous snapshot, in one task.
      const press = this._pressSnapshot();
      let writer;
      try { writer = Promise.resolve(st.getCurrentSessionData('Scene')); }
      catch (e) { this._toast('Scene not added — ' + (e && e.message ? e.message : 'capture refused'), 'error'); return Promise.resolve({ ok: false, code: 'refused' }); }
      const captureId = ++this._captureSeq;
      const entry = { id: captureId, press };
      this._pendingCaptures.add(entry);
      const fail = (code, message) => { this._pendingCaptures.delete(entry); this._toast('Scene not added — ' + message, 'error'); return { ok: false, code, captureId }; };
      const doc0 = this.session.doc;
      // 2. Hashing runs now; the commit waits for its turn in press order.
      const hashing = (async () => {
        let snapshot;
        try { snapshot = await writer; } catch (e) { return { error: 'refused', message: e && e.message ? e.message : 'capture refused' }; }
        if (!snapshot || !Array.isArray(snapshot.tracks)) return { error: 'refused', message: 'no capture data' };
        const session = this._pruneByOrigin(snapshot, press);
        const ex = await S3.extractAetherAssets(session, doc0.assets, {});
        if (!ex.ok) return { error: ex.code || 'extract', message: ex.error + (ex.track !== undefined ? ' (Track ' + (ex.track + 1) + ')' : '') };
        return { session, ex };
      })();
      const turn = this._captureChain.then(async () => {
        const h = await hashing.catch(e => ({ error: 'engine', message: e && e.message ? e.message : 'capture failed' }));
        if (h.error) return fail(h.error, h.message);
        // 3. Recheck immediately before commit, after hashing and after waiting.
        const why = this._recheckAgainstPress(press);
        if (why) return fail('changed', why);
        // 4. Compose onto the LATEST document through S1.
        const doc = this.session.doc;
        const threadIds = [0, 1, 2, 3].map(k => this._threadIdForSlot(k));
        if (threadIds.some(id => !id)) return fail('thread', 'the Weave has no thread for every slot');
        const now = () => this._nowIso();
        const m = S1.sceneFromAetherState(h.session, { threadIds, assetIds: h.ex.perTrack, name: 'Scene ' + pad2(doc.order.length + 1), now });
        if (!m.ok) return fail('model', m.error);
        const scene = m.scene;
        scene.provenance = { kind: 'capture', capturedAt: now() };   // live capture, not an import
        const referenced = new Set();
        for (const ts of Object.values(scene.threadStates)) {
          const src = ts.source;
          if (src.kind === 'sample') referenced.add(src.sample.assetId);
          if (src.kind === 'playlist') { src.playlist.items.forEach(a => referenced.add(a)); if (src.override) referenced.add(src.override.assetId); }
          if (src.kind === 'node') { referenced.add(src.node.bundleAssetId); if (src.node.tapeAssetId) referenced.add(src.node.tapeAssetId); }
        }
        const assets = {};
        for (const id of referenced) {
          if (!Object.prototype.hasOwnProperty.call(doc.assets, id)) {
            if (!h.ex.assets[id]) return fail('asset', 'a captured asset is missing');
            assets[id] = h.ex.assets[id];
          }
        }
        const r = S1.addScene(doc, scene, { assets, now });
        if (!r.ok) return fail('model', r.error);
        const cap = S1.checkCompactCapacity(r.doc);
        if (!cap.ok) return fail('capacity', cap.problems.map(p => p.message).join(' '));
        // 5. Commit (synchronous) and bind from the press snapshot.
        this.session.doc = r.doc;
        this.session.docRevision++;
        this.session.dirty = true;
        this._bindSlots(r.id, press, threadIds, scene);
        this._cacheCapturedBuffers(press, threadIds, scene);
        this.session.detached = false;
        this._pendingCaptures.delete(entry);
        this.syncViewFromDoc();
        const newIndex = this.scenes.findIndex(row => row.id === r.id);
        this.selectScene(newIndex >= 0 ? newIndex : this.scenes.length - 1);
        const vp = this.weaveEl ? this.weaveEl.querySelector('#weave-loom-viewport') : null;
        if (vp && typeof vp.scrollTo === 'function') {
          vp.scrollTo({ top: vp.scrollHeight, behavior: 'smooth' });
        }
        return { ok: true, sceneId: r.id, captureId, index: newIndex, pruned: h.session.tracks.filter(t => t._bufferPruned).map(t => t.index) };
      });
      // A failed capture never blocks the next one.
      this._captureChain = turn.catch(() => {});
      return turn;
    }

    // The live AudioBuffer a captured slot was playing IS the decoded form of the asset the
    // Scene refers to (its WAV encoding, or the proven decode of the selected playlist item), so
    // keep it for recall: no re-decoding when the arrangement comes back to this Scene.
    _cacheCapturedBuffers(press, threadIds, scene) {
      for (let k = 0; k < 4; k++) {
        const ts = scene.threadStates[threadIds[k]];
        const buf = press.tracks[k] && press.tracks[k].bufferRef;
        const assetId = ts ? this._audioAssetOf(ts) : null;
        if (assetId && buf && !this._bufferCache.has(assetId)) this._bufferCache.set(assetId, buf);
      }
    }

    _bindSlots(sceneId, press, threadIds, scene) {
      const st = window.studio;
      for (let k = 0; k < 4; k++) {
        const t = st.tracks[k];
        const ts = scene.threadStates[threadIds[k]];
        if (!t || !ts) continue;
        t._weaveBinding = {
          weaveId: this.session.doc.id,
          threadId: threadIds[k],
          sceneId,
          sourceIdentity: identityOf(ts),
          selectedKey: selectedKeyOf(ts),
          sourceRevision: press.tracks[k].sourceRevision
        };
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
        const playing = !!(window.studio && window.studio.isPlaying);
        if (playing && !this._wasPlaying) this._onTransportStarted();
        if (!playing && this._wasPlaying) this._onTransportStopped();
        this._wasPlaying = playing;
        if (playing) {
          this.onTransportTick(true, this._hostBpm(), dt);
        }

        if (this.enabled) this.updateGlide(now);
        this.updateDynamicReadouts();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    updateDynamicReadouts() {
      if (!this.weaveEl || !this.scenes.length) return;
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

    // LAB-5 quiet panels: a gutter is engaged while hovered, focused, while a
    // scene is being ADJUSTed (pointer is on the canvas then), and the right
    // gutter stays engaged in PLAY. Otherwise it rests in grey.
    wireQuietPanels() {
      this._quiet = { left: { hover: false, focus: false }, right: { hover: false, focus: false } };
      const wire = (el, side) => {
        const g = el && el.closest('.weave-gutter');
        if (!g) return;
        const st = this._quiet[side];
        g.addEventListener('pointerenter', () => { st.hover = true; this.updateQuiet(); });
        g.addEventListener('pointerleave', () => { st.hover = false; this.updateQuiet(); });
        // Only keyboard focus keeps a panel awake; a mouse click shouldn't pin it on.
        g.addEventListener('focusin', (e) => { st.focus = !!(e.target && e.target.matches && e.target.matches(':focus-visible')); this.updateQuiet(); });
        g.addEventListener('focusout', (e) => { if (!g.contains(e.relatedTarget)) { st.focus = false; this.updateQuiet(); } });
      };
      wire(this.weaveEl, 'left');
      wire(this.transEl, 'right');
    }

    updateQuiet() {
      if (!this._quiet) return;
      const editing = this.editingIndex !== null && this.editingIndex !== undefined;
      const set = (el, side, extra) => {
        const g = el && el.closest('.weave-gutter');
        if (!g) return;
        const st = this._quiet[side];
        const engaged = st.hover || st.focus || editing || extra;
        g.classList.toggle('is-engaged', !!engaged);
        g.classList.toggle('is-quiet', !engaged);
      };
      set(this.weaveEl, 'left', false);
      // The transition panel rests greyscale while the arrangement plays, but hovering it (or
      // keyboard focus, or ADJUST) wakes it like the left panel (Matt, 5 Oct).
      set(this.transEl, 'right', false);
    }

    bindSceneRowGestures(loomVp) {
      // Bind horizontal swipe gesture on Loom scene rows
      const THRESHOLD_TWEAK = 64;
      const THRESHOLD_DELETE = 185;
      const THRESHOLD_AUDITION_MAX = 120;
      const MAX_DRAG = 240;
      const delTarget = this.weaveEl.querySelector('#weave-del-target');

      this.weaveEl.querySelectorAll('.weave-loom-row-wrap').forEach(rowWrap => {
        const sceneIdx = +rowWrap.dataset.sceneIndex;
        const card = rowWrap.querySelector('.weave-loom-row-card');
        if (!card) return;

        let startX = 0;
        let startY = 0;
        let isDown = false;
        let gestureLocked = null; // null | 'horizontal' | 'vertical' | 'reorder'
        let dragX = 0;
        let dropIndex = sceneIdx;
        let startScroll = 0;
        let pointerId = null;
        let holdTimer = null;
        let scaleY = 1;
        const sceneId = rowWrap.dataset.sceneId;
        const canReorder = () => this.mode === 'build' && !this.session.demo && this.sceneIndexById(sceneId) >= 0;
        const canAudition = () => this.mode === 'build' && !this.session.demo && this.sceneIndexById(sceneId) >= 0;
        const clearDropMarks = () => this.weaveEl.querySelectorAll('.weave-loom-row-wrap').forEach(row => row.classList.remove('is-drop-target', 'is-drop-after'));

        const onPointerDown = (e) => {
          if (e.button !== undefined && e.button !== 0) return;
          if (e.target && e.target.closest('[data-done-adjust]')) return;
          if (isDown || e.isPrimary === false) return;
          e.preventDefault(); // WebKit must not turn dragging a Scene label into text selection.
          isDown = true;
          pointerId = e.pointerId;
          startScroll = loomVp ? loomVp.scrollTop : 0;
          scaleY = rowWrap.getBoundingClientRect().height / rowWrap.offsetHeight || 1;
          dropIndex = this.sceneIndexById(sceneId);
          try { card.setPointerCapture(e.pointerId); } catch (_) {}
          startX = e.clientX;
          startY = e.clientY;
          gestureLocked = null;
          dragX = 0;
          card.style.transition = 'none';
          // Holding picks the Scene up before movement direction is judged. This lets
          // diagonal drags reorder without accidentally entering ADJUST/delete.
          holdTimer = setTimeout(() => {
            if (!isDown || gestureLocked !== null || !canReorder() || card.isConnected === false) return;
            gestureLocked = 'reorder';
            rowWrap.classList.add('is-reordering');
          }, 220);
        };

        const onPointerMove = (e) => {
          if (!isDown || e.pointerId !== pointerId) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          if (gestureLocked === null) {
            const dist = Math.hypot(dx, dy);
            if (dist >= 6) {
              if (Math.abs(dy) >= Math.abs(dx)) {
                gestureLocked = canReorder() ? 'reorder' : 'vertical';
              } else if (dx < 0) {
                // leftward swipe: AUDITION the Scene (BUILD only); elsewhere it is just a scroll
                gestureLocked = canAudition() ? 'audition' : 'vertical';
                if (gestureLocked === 'audition') { try { card.setPointerCapture(e.pointerId); } catch (_) {} }
              } else {
                gestureLocked = 'horizontal';
                try {
                  card.setPointerCapture(e.pointerId);
                } catch (_) {}
              }
            }
          }

          if (gestureLocked === 'reorder') {
            e.preventDefault();
            if (!canReorder()) return;
            if (loomVp) {
              const rect = loomVp.getBoundingClientRect();
              if (e.clientY < rect.top + 28) loomVp.scrollTop -= 14;
              else if (e.clientY > rect.bottom - 28) loomVp.scrollTop += 14;
            }
            card.style.transform = `translateY(${dy / scaleY + (loomVp ? loomVp.scrollTop - startScroll : 0)}px)`;
            rowWrap.classList.add('is-reordering');
            clearDropMarks();
            const rows = Array.from(this.weaveEl.querySelectorAll('.weave-loom-row-wrap'));
            dropIndex = 0;
            for (const row of rows) {
              if (row === rowWrap) continue; // insertion index after removing the dragged Scene
              const rect = row.getBoundingClientRect();
              if (e.clientY >= rect.top + rect.height / 2) dropIndex++;
            }
            const remaining = rows.filter(row => row !== rowWrap);
            const marker = remaining[dropIndex] || remaining[remaining.length - 1];
            if (marker) {
              marker.classList.add('is-drop-target');
              if (dropIndex === remaining.length) marker.classList.add('is-drop-after');
            }
          } else if (gestureLocked === 'audition') {
            e.preventDefault();
            dragX = Math.max(-THRESHOLD_AUDITION_MAX, Math.min(0, dx));
            card.style.transform = `translateX(${dragX}px)`;
            rowWrap.classList.toggle('state-audition', dragX <= -THRESHOLD_TWEAK);
            rowWrap.classList.add('is-auditioning-swipe');
          } else if (gestureLocked === 'horizontal') {
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
          if (!isDown || e.pointerId !== pointerId) return;
          isDown = false;
          clearTimeout(holdTimer);
          holdTimer = null;
          try { card.releasePointerCapture(e.pointerId); } catch (_) {}
          clearDropMarks();
          rowWrap.classList.remove('is-reordering');
          if (e.type === 'pointercancel' || e.type === 'lostpointercapture') {
            card.style.transform = '';
            card.style.transition = '';
            rowWrap.classList.remove('state-tweak', 'state-delete', 'state-audition', 'is-auditioning-swipe');
            if (delTarget) delTarget.classList.remove('active');
            gestureLocked = null;
            return;
          }
          if (delTarget) delTarget.classList.remove('active');

          if (gestureLocked === 'reorder') {
            card.style.transform = '';
            card.style.transition = '';
            if (card.isConnected !== false && canReorder()) this.reorderScene(sceneId, dropIndex);
          } else if (gestureLocked === 'audition') {
            const finalDrag = dragX;
            card.style.transition = 'transform 0.22s cubic-bezier(0.18, 0.9, 0.32, 1)';
            card.style.transform = 'translateX(0px)';
            setTimeout(() => { rowWrap.classList.remove('state-audition', 'is-auditioning-swipe'); }, 230);
            if (finalDrag <= -THRESHOLD_TWEAK && canAudition()) this.auditionScene(this.sceneIndexById(sceneId));
          } else if (gestureLocked === 'horizontal') {
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
            // pointerdown preventDefault() suppresses native dblclick, so a double tap is detected here:
            // in BUILD it opens the inline rename field.
            const now = performance.now();
            const last = this._lastTap;
            this._lastTap = { id: sceneId, at: now };
            if (last && last.id === sceneId && now - last.at < 350 && this.mode === 'build' && !this.session.demo) {
              this._lastTap = null;
              this.selectScene(sceneIdx);
              this.beginRename(sceneId);
            } else {
              this.selectScene(sceneIdx);
            }
          }
          gestureLocked = null;
        };

        card.addEventListener('pointerdown', onPointerDown);
        card.addEventListener('pointermove', onPointerMove);
        card.addEventListener('pointerup', onPointerUp);
        card.addEventListener('pointercancel', onPointerUp);
        card.addEventListener('lostpointercapture', onPointerUp);
      });

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

      this.bindSceneRowGestures(loomVp);
      this.bindSceneResizeHandles(loomVp);

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
      this.bindSetRowGestures();
      const undoBtn = this.weaveEl.querySelector('[data-undo]');
      if (undoBtn) undoBtn.onclick = (e) => { e.stopPropagation(); this.undoDelete(); };
      if (this._undo && Date.now() < this._undo.until) { clearTimeout(this._undoTimer); this._undoTimer = setTimeout(() => { if (this._undo && Date.now() >= this._undo.until) { this._undo = null; this.renderWeaveLeft(); } }, Math.max(50, this._undo.until - Date.now() + 20)); }


      this.weaveEl.style.setProperty('--p', this.mode === 'play' ? 1 : 0);
      this.weaveEl.classList.toggle('play', this.mode === 'play');
      this.weaveEl.classList.toggle('is-build', this.mode === 'build');
      this.updateQuiet();
    }

    buildLoomHTML() {
      if (!this.scenes.length) return this._emptyHTML('build');
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
            : 'var(--wv-row-bg, #ffffff)';

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
              <div class="weave-loom-under-content audition-msg">
                <span class="wluc-hint">Release to hear</span>
                <span class="wluc-tag audition"><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M16 8a4.5 4.5 0 0 1 0 8M18.5 5a8 8 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> AUDITION</span>
              </div>
            </div>
            <div class="weave-loom-row-card ${isEditing ? 'is-editing' : ''} ${isPlaying ? 'is-playing' : ''}" data-scene-index="${b.s.index}" style="position:absolute;inset:0;width:${width}px;height:${b.h}px;">
              ${!b.s.demo ? `<button type="button" class="weave-scene-resize side" data-scene-resize="${b.s.id}" aria-label="Resize Scene ${pad2(b.s.index + 1)} length" title="Drag up/down to resize · ${b.s.bars} bars"><span data-scene-bars-preview>${b.s.bars} bars</span></button><button type="button" class="weave-scene-resize boundary" data-scene-resize="${b.s.id}" aria-label="Resize Scene ${pad2(b.s.index + 1)} bottom boundary" title="Drag to resize Scene length"></button>` : ''}
              <svg width="${width}" height="${b.h}" style="position:absolute;left:0;top:0;display:block">
                <rect x="0" y="0" width="${width}" height="${b.h}" fill="${bgFill}"/>
                ${isSel ? `<rect x="0" y="0" width="150" height="${b.h}" fill="var(--weave-ink)"/>` : ''}
                <g class="threads">${threadsBandSVG}</g>
                <rect x="0" y="0" width="${width}" height="${curBarH}" fill="var(--wv-rule, var(--weave-ink))"/>
                ${overWeaveBandSVG}
              </svg>
              <div class="weave-loom-band-label labels" style="position:absolute;left:14px;top:2px;width:136px;height:${b.h - 2}px;color:${textColor};display:flex;${small ? 'align-items:center;gap:7px;' : 'flex-direction:column;justify-content:center;'};overflow:hidden;pointer-events:none;">
                <div style="display:flex;align-items:baseline;gap:6px">
                  <b style="font-size:${bigFontSize}px;font-weight:900;letter-spacing:-0.06em;line-height:0.85">${pad2(b.s.index + 1)}</b>
                  <span class="weave-mono" style="font-size:10px;font-weight:700;opacity:0.7">${b.s.bars}b</span>
                  ${isEditing ? `<button type="button" class="weave-btn-done" data-done-adjust onclick="window.weaveEngine.exitAdjust(event)" title="Done adjusting scene">DONE</button>` : ''}
                </div>
                <div style="font-size:${small ? 11 : 12.5}px;font-weight:800;width:${small ? (isPlaying ? 92 : 118) : 124}px;margin-top:${small ? 0 : 3}px">
                  ${isPlaying ? `<div data-scene-name>${marqueeHTML(b.s.name)}</div>` : `<div data-scene-name style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHTML(b.s.name)}</div>`}
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

    _emptyHTML(kind) {
      const hint = kind === 'play'
        ? 'Set up your sound, then press <b>+ SCENE</b>. Each press adds a Scene here; Play runs them in order.'
        : 'No Scenes yet. Capture them in PLAY with <b>+ SCENE</b>, then shape them here.';
      return `<div class="weave-empty" data-weave-empty><div class="weave-empty-title">No Scenes</div><div class="weave-empty-hint">${hint}</div></div>`;
    }

    buildSetListHTML(isCrowded) {
      if (!this.scenes.length) return this._emptyHTML('play');
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

          <div class="ws-now">
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
          </div>

          <div style="margin-top:4px">
            ${this.scenes.map((s, idx) => {
              // The set list keeps its fixed order (Matt, 5 Oct): every Scene stays in its place,
              // the playing one is simply bold black ("now"), nothing is struck through.
              const isNow = idx === this.playingIndex;
              const isSel = idx === this.selectedIndex && !isNow;
              const isArmed = !!(this._launch && this._launch.sceneId === s.id);
              return `
                <div class="weave-set-wrap" data-scene-id="${s.id}" data-scene-index="${idx}">
                  <div class="weave-set-under">
                    <button type="button" class="weave-set-action delete" data-set-delete ${isNow ? 'disabled title="The sounding Scene cannot be deleted"' : 'title="Delete this Scene"'}>DELETE</button>
                    <button type="button" class="weave-set-action rename" data-set-rename title="Rename this Scene">RENAME</button>
                  </div>
                <div class="weave-set-row ${isNow ? 'now' : ''} ${isSel ? 'sel' : ''} ${isArmed ? 'armed' : ''}" data-scene-index="${idx}">
                  <span class="sr-no">${pad2(idx + 1)}</span>
                  <span class="sr-title" data-scene-name>${escHTML(s.name)}</span>
                  ${isCrowded ? '' : `<span class="sr-bars">${s.bars}</span><span></span>`}
                  <span class="sr-ticks">
                    ${s.levels.map((v, k) => `<i style="background:${v ? colors[k] : 'transparent'};${v ? '' : 'box-shadow:inset 0 0 0 1px var(--weave-tick-empty)'}"></i>`).join('')}
                  </span>
                  ${isCrowded ? `<span class="sr-bars">${s.bars}</span>` : ''}
                </div>
                </div>
              `;
            }).join('')}
          </div>
          ${this._undo && Date.now() < this._undo.until ? `<div class="weave-undo" data-undo-bar><span>Deleted ${escHTML(this._undo.label)}</span><button type="button" class="weave-btn" data-undo>UNDO</button></div>` : ''}
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
      this.updateQuiet();
    }

    renderBuildTransition() {
      if (!this.scenes.length) { this.transEl.innerHTML = `<div class="weave-tx-panel">${this._emptyHTML('build')}</div>`; return; }
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
            ${['fade', 'morph', 'jump'].map(m => `
              <button type="button" aria-pressed="${this.transitionMode === m}" data-mode="${m}">${m.toUpperCase()}</button>
            `).join('')}
          </div>

          <div style="display:flex;gap:14px;margin-top:18px;align-items:flex-end">
            ${this.buildMorphMapSVG(fromScene, toScene)}
            <div>
              <div class="weave-label weave-mute" style="margin-bottom:4px">
                ${!toScene.spatialState ? 'ADJUST ' + pad2(toScene.index + 1) + ' to set' : this.transitionMode === 'morph' ? 'Positions glide' : 'Positions snap'}
              </div>
              <div class="weave-label">Starts in</div>
              <div class="weave-mono" data-txcd style="font-size:22px;font-weight:700;letter-spacing:-0.02em">
                00:00.0
              </div>
              <button type="button" class="weave-btn" data-preview-btn style="margin-top:8px" title="Hear the end of this Scene, the transition and the start of the next">
                <svg width="8" height="9" viewBox="0 0 8 9" style="margin-right:5px"><path d="M0 0l8 4.5L0 9z" fill="var(--weave-ink)"/></svg>
                ${this._audition !== null && this._auditionStopAt ? 'Stop' : 'Audition'}
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
          if (this._audition !== null && this._auditionStopAt) this.stopAudition(); else this.auditionTransition();
        };
      }
      const insertBtn = this.transEl.querySelector('[data-insert-weave]');
      if (insertBtn) insertBtn.onclick = () => this.insertAetherFile();
    }

    // INSERT IN WEAVE: pick a saved .aether session and add it as a playable Scene after the
    // selected one (S3 importAetherState: its assets are stored in the Weave; the sound is decoded
    // the first time the Scene plays). The live instrument is not touched.
    async insertAetherFile() {
      if (!this.session.available) { this._toast('Insert is not available \u2014 model scripts not loaded', 'error'); return { ok: false }; }
      let session = null, fileName = '';
      try {
        if (typeof invokeTauri === 'function' && (window.__TAURI__ || window.__TAURI_INTERNALS__)) {
          const res = await invokeTauri('load_project_dialog');
          if (res === null) return { ok: false, code: 'cancelled' };
          if (res && res.content) { session = JSON.parse(res.content); fileName = res.filename || 'Project'; }
        }
        if (!session && typeof window.showOpenFilePicker === 'function') {
          const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Aether session (*.aether, *.json)', accept: { 'application/json': ['.json', '.aether'] } }], multiple: false });
          const file = await handle.getFile();
          session = JSON.parse(await file.text()); fileName = file.name;
        }
        if (!session) {
          session = await new Promise((resolve, reject) => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.aether,.json,application/json';
            input.onchange = () => { const f = input.files && input.files[0]; if (!f) return resolve(null); fileName = f.name; f.text().then(t => resolve(JSON.parse(t))).catch(reject); };
            input.click();
          });
          if (!session) return { ok: false, code: 'cancelled' };
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, code: 'cancelled' };
        this._toast('Insert failed \u2014 ' + (e && e.message ? e.message : 'could not read the file'), 'error');
        return { ok: false, code: 'read' };
      }
      return this.insertAetherSession(session, fileName);
    }

    async insertAetherSession(session, fileName) {
      if (!this.session.available || this._suspensions.size) return { ok: false, code: 'unavailable' };
      const doc = this.session.doc;
      const threadIds = [0, 1, 2, 3].map(k => this._threadIdForSlot(k));
      if (threadIds.some(id => !id)) return { ok: false, code: 'thread' };
      const after = this.session.demo ? -1 : this.selectedIndex;
      const name = typeof session.name === 'string' && session.name && session.name !== 'Untitled Project' ? session.name.slice(0, 80) : (fileName || 'Inserted').replace(/\.(aether|json)$/i, '');
      const ctx = { threadIds, name, fileName: fileName || undefined, now: () => this._nowIso(), index: after + 1 };
      const r = await S3.importAetherState(doc, session, ctx, {});
      if (!r.ok) { this._toast('Insert failed \u2014 ' + (r.error || 'the session could not be imported'), 'error'); return { ok: false, code: r.code || 'import', error: r.error }; }
      const cap = S1.checkCompactCapacity(r.doc);
      if (!cap.ok) { this._toast('Insert failed \u2014 ' + cap.problems.map(p => p.message).join(' '), 'error'); return { ok: false, code: 'capacity' }; }
      this.session.doc = r.doc;
      this.session.docRevision++;
      this.session.dirty = true;
      this._previewToken++;
      this.glide = null;
      this._glideStartedFor = null;
      this.syncViewFromDoc();
      const idx = this.sceneIndexById(r.sceneId);
      this.selectScene(idx >= 0 ? idx : this.scenes.length - 1);
      this._toast('Inserted ' + name + ' as Scene ' + pad2(idx + 1), 'info');
      return { ok: true, sceneId: r.sceneId, index: idx };
    }

    renderPlayTransition() {
      if (!this.scenes.length) { this.transEl.innerHTML = `<div class="weave-tx-panel">${this._emptyHTML('play')}</div>`; return; }
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
            ${this._launch ? `<div class="weave-label weave-mute" data-launch-status style="text-align:center;margin-bottom:6px">${this._launch.ready ? 'NEXT BAR' : 'PREPARING'} \u2192 ${escHTML(this._launchName())}</div>` : ''}
            <button type="button" class="weave-gobtn solid ${this._launch ? (this._launch.ready ? 'armed' : 'preparing') : ''}" data-go-now title="Launch the picked Scene on the next bar once it is ready">
              ${this._launch ? (this._launch.ready ? 'NEXT BAR \u2192 ' : 'PREPARING \u2192 ') + pad2(this.sceneIndexById(this._launch.sceneId) + 1) : (this.nextTarget() >= 0 ? 'GO NEXT \u2192 ' + pad2(this.nextTarget() + 1) : 'GO NEXT')}
            </button>
            <button type="button" class="weave-gobtn ${this.isHolding ? 'held' : ''}" data-hold style="margin-top:10px">
              ${this.isHolding ? 'HOLDING' : 'HOLD'} ${pad2(fromScene.index + 1)}
            </button>
            <div class="weave-mute" style="text-align:center;font-size:9.5px;font-weight:700;letter-spacing:0.04em;margin-top:8px">
              G = go next · H = hold (loops the scene) · click a Scene to pick it
            </div>
          </div>
        </div>
      `;

      const goBtn = this.transEl.querySelector('[data-go-now]');
      if (goBtn) goBtn.onclick = () => { if (this._launch && !this._launch.ready) return; this.goNext(); };

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
      // LAB-12: draw saved positions only, same way up as the canvas.
      const saved = (s, k) => {
        const n = s && s.spatialState ? s.spatialState[NODE_NAMES[k]] : null;
        return n ? [(n.x - 0.5) * 2, (0.5 - n.y) * 2] : null;
      };
      if (!(a && a.spatialState) || !(b && b.spatialState)) {
        nodesMarkup += `<text x="0" y="1.0" text-anchor="middle" font-family="var(--weave-font-mono)" font-size=".2" fill="var(--weave-text-muted)">${!(b && b.spatialState) ? 'next' : 'this'} scene: no positions</text>`;
      }
      [0, 1, 2, 3].forEach(k => {
        const posA = saved(a, k);
        const posB = saved(b, k);
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
