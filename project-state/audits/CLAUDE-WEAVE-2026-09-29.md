> Historical audit supplied by Claude. Retained as evidence, not instructions. Local verification and corrections are in ../CURRENT.md.

# Aether: Weave Architecture & Consistency Audit

Claude, 29 Sept 2026. Read-only: I changed no application code.

## 0. What I could and couldn't verify

- **Repo:** `/Users/matt/.gemini/antigravity/scratch/aether`. HEAD is `feature/weave-functional` at `3ab6e22` ("weave: implement adjust done and delete gesture"). I read this from `.git/HEAD` and the reflog.
- **Tag:** `checkpoint-feature-weave-functional` points at `1711edc`. That's the same commit as `feature/weave-prototype`, so the tag marks the branch point, not the latest commit.
- **Other Weave tags:** `weave-match-grok-visual-handoff`, `node-v2-patient-zero`, `pre-scheduler-stable`, `v5.1.1`, `aether-working-5.0.7`.
- **Git remote:** `origin` is `github.com/micmate-wq/aether-desktop`. The new `micmate-wq/Night` repo is empty and isn't configured as a remote.
- **Tests:** all three pass, run in the cloud against copies of the files:
  - `test-ticktok-v2` (9/9)
  - `test-weave-spatial-recall`
  - `test-weave-swipe-gesture`
- **Not verified:**
  - `git status` and `cargo check`. The shell on the Mac failed to start, so I read files through the file bridge instead. I can't confirm the working tree is clean. File modification times suggest it is.
  - `icecast.rs`, `node-art.js` internals, and the older `nodes/` and `server/` directories. I didn't audit these.

### Corrections to the handoff

- **Tab is still hijacked.** `weave.js:123` intercepts Tab to toggle BUILD/PLAY. `WEAVE-DECISIONS.md` still documents it as a feature.
- **"Space = go" in PLAY doesn't work.** The studio's Space handler (`index.html:5950`) runs in the capture phase and calls `stopPropagation()`. Weave's handler never sees Space, so Space always means master Play/Pause. The on-screen hint "Space = go · H = hold" is wrong.
- **Graceful project loading is only half done.** The apply phase catches errors per track. But `prepareSession()` (`index.html:7270`) still throws for the whole project if any one track fails to decode.
- **Atomic save is done.** `save_project_dialog` and `write_file_at_path` both go through `project_write::replace_project`.
- **The layout is fluid.** The grid is `300px | min(100vw-400px, …) | 300px` with a 12px gap, plus `updateAppScale()` zoom against a 1424 × 770.67 base.

---

## 1. Architecture map

```
index.html (9,178 lines)
 ├─ SpatialStudio (window.studio)       ← transport, tracks[], save/load, canvas, render loop
 │    ├─ transportPosition / transportStartTime → getCurrentPlaybackTime()
 │    ├─ getClockSnapshot()  ← the ONLY musical clock (bpm = masterBpm = 120, fixed)
 │    ├─ getCurrentSessionData() / _applySession()  ← .aether v3.1
 │    └─ initCanvas(): mouse/touch drag → track.setPosition() → onNodeDragEnd()
 ├─ AudioTrack ×4                       ← x,y,z authoritative; setPosition() → updateAudioParamsFromPosition()
 │    └─ customNodeDSP (nodes-v2 TickTok etc.) reads studio.getClockSnapshot()
 └─ updateAppScale() → .app-container style.zoom

weave.js (window.weaveEngine, IIFE)
 ├─ scenes[] {id, index, name, bars, levels[4], positions[4], spatialState?}
 ├─ selectedIndex / editingIndex / playingIndex / isHolding / currentBarInScene
 ├─ own RAF loop: dt from performance.now(), advances only if studio.isPlaying
 ├─ single shared transition {lengthBars, curve, mode}
 └─ renderWeaveLeft / renderTransitionRight = full innerHTML rebuilds
```

Data flow that exists today:

- canvas drag ends → `weaveEngine.onNodeDragEnd()` → if a scene is being edited, the live track x/y/z is written into `scene.spatialState`.
- selecting, adjusting or capturing a scene → `track.setPosition()` → the real audio params change.
- transport → Weave: Weave only reads the `studio.isPlaying` boolean and measures its own wall-clock time.

---

## 2. Real vs simulated

| Area | Status |
|---|---|
| Transport play/pause/stop/resume with anchored position | **Real engine** |
| TickTok v2 phase-locked to transport, hot insert, clean dispose | **Real engine**, well tested |
| Atomic save (Rust) | **Real** |
| `+ Scene` capture of T1–T4 x/y/z | **Real** (from `studio.tracks`) |
| Scene recall → setPosition → Web Audio | **Real**, but only when *selecting* or *adjusting*, never on playback progression |
| ADJUST → drag → snapshot update → DONE | **Real** for mouse/touch XY drags only |
| Delete with guards + stable IDs | **Real** (in-memory) |
| Weave timeline/countdown/playhead | **Partially integrated**: its own clock, gated on `isPlaying` |
| Auto-advance, GO NOW, HOLD | **UI-only**: they change `playingIndex` but never recall state |
| JUMP / MORPH / FADE, length, curve | **UI-only**: affect drawings and labels, no audio |
| Preview button | **Not a preview**: calls `goNow()`, which advances the live set |
| Morph mini-map | **Mock** for the 7 seed scenes (sin/cos). Real for captured scenes but vertically flipped (see M6) |
| Loom thread widths / set-list ticks | **Mock** for seed scenes. For captured scenes `levels = y`, which is always ≥ 0.02 |
| Scene persistence in `.aether` | **Absent** |
| Channel-strip "WEAVE CONTINUES UNDER 01–03" | **Static text** |

---

## 3. Important inconsistencies

### H1: Weave has its own clock, separate from the master transport
- **Where:** `weave.js:395–425` (`startLoop`) and `onTransportTick`.
- **What happens:** Weave adds up `performance.now()` deltas while `studio.isPlaying` is true. It never reads `getClockSnapshot()` or `getCurrentPlaybackTime()`.
- **Why it matters:**
  - Stop doesn't reset Weave. It carries on from `currentBarInScene` wherever it was.
  - Weave drifts against the audio clock over long sets.
  - When RAF throttles (window hidden), Weave is late. A large `dt` can only cross one scene boundary per tick.
  - This breaks the MANIFESTO rule that nodes bind to the master transport. It will make any Weave-triggered audio change land off the bar.
- **Evidence:** No reference to `transportPosition` or `getClockSnapshot` anywhere in `weave.js`.
- **Smallest fix:** Derive the Weave position from `studio.getClockSnapshot().beatsElapsed / 4`, measured against the transport bar where the current scene started. Reset on stop.

### H2: Scenes never recall during playback
- **Where:** `onTransportTick` (`weave.js:339–344`) and `goNow()` (`weave.js:309`).
- **What happens:** These set `playingIndex` and `selectedIndex` directly. They skip `selectScene()`, which is the only playback path containing recall logic.
- **Why it matters:** A set of captured scenes plays back as one frozen mix with changing labels.
- **Smallest fix:** Pull out a `recallScene(scene)` helper, used by select, adjust and progression. The JUMP semantics come for free.

### H3: Selecting a scene moves the live mix
- **Where:** `selectScene()` (`weave.js:162–179`).
- **What happens:** A single tap on a captured row calls `setPosition()` on all four tracks, even mid-performance and even while a different scene is playing.
- **Why it matters:** This conflicts with the handoff's "selected, editing and playing stay separate". Once H2 is fixed, tapping a future scene to inspect its transition will audibly jump the mix.
- **Decision needed:** Should *select* recall at all? My read of the intent is that ADJUST recalls and select only inspects.

### H4: Scenes aren't saved, and they leak across project loads
- **Where:** `getCurrentSessionData()` (`index.html:6969`) and `_applySession()`.
- **What happens:** Nothing from `weaveEngine` is serialized. Loading a project doesn't reset Weave.
- **Why it matters:** Opening project B keeps project A's captured scenes, including spatial snapshots that now point at B's tracks.
- **Smallest fix:**
  - Add a `weave` block to the v3.1 JSON. Keep the version number or bump it to 3.2.
  - Save `scenes[{id,name,bars,spatialState}]`, `playingSceneId`, `transition`, `nextSceneUid`.
  - On load, replace the engine state. With no `weave` block, reset to a default.

### H5: The packaged build ships without Weave styling or fonts
- **Where:** `tauri.conf.json` `beforeBuildCommand`: `cp index.html *.js *.svg dist/`.
- **What happens:** `weave.js` gets copied, but `weave.css` and `fonts/` don't. The current `dist/` also has no Weave files at all, so it's stale.
- **Why it matters:** The dev server looks right and the DMG won't.
- **Smallest fix:** Add `*.css` and `-R fonts` to the copy.

### M1: Preview is destructive
- **Where:** `weave.js:1004–1009`.
- **What happens:** The Preview button calls `goNow()`, which changes the playing scene.
- **Smallest fix:** Disable it or relabel it until a real preview exists.

### M2: The transition length slider destroys itself mid-drag
- **Where:** `weave.js:979`.
- **What happens:** `oninput` calls `renderTransitionRight()`, which replaces the `<input>` being dragged. The drag probably dies after one step.
- **Needs checking:** by hand in the app.
- **Smallest fix:** Update the label and diagram in place, and re-render fully on `change`.

### M3: Full re-renders while a gesture is in progress
- **What happens:** An auto-advance in the RAF loop calls `renderWeaveLeft()` while a row swipe is in progress. The card under the pointer is rebuilt and the swipe is silently dropped.
- **Why it matters:** Rare but it happens, and it's more likely with short scenes.
- **Smallest fix:** Skip or defer the re-render while `isDown`.

### M4: ADJUST only picks up XY mouse/touch drags
- **What happens:** These changes move the track but never reach the scene:
  - Z via trackpad wheel (`index.html:7823`)
  - inspector vol/pan/depth sliders (`7993–7999`)
  - reset (`7649`)
- **Smallest fix:** Call `onNodeDragEnd` from those paths too. Or, cleaner, have `AudioTrack.setPosition` emit a debounced "position committed" hook.

### M5: Motion loops fight scene recall
- **What happens:** `AetherMotionLoop` writes `this.x`/`y` on every frame for automated tracks. Recalling a scene onto an automated track is overwritten on the next frame. Capturing one records a random point in the loop.
- **Decision needed:** Does a scene own a motion loop, override it, or skip automated tracks?

### M6: The mini-map is vertically flipped
- **What happens:** The canvas uses y-up (`normY = 1 - …`). The mini-map maps `(y-0.5)*2` straight into SVG y-down, so a loud node shows at the bottom.
- **Why it matters:** Minor now, but it's the view you'll use to judge MORPH.

### M7: The Space hint is wrong, and so is the doc
- **What happens:** See §0. There are two choices:
  - drop Space = GO NOW from the hint and the docs, or
  - route it deliberately, for example Shift+Space.

### M8: The Tab hijack is still live
- **Where:** `weave.js:123`.
- **What happens:** It breaks keyboard focus navigation across the whole app, as the handoff already says.

### M9: Loading a stream fakes transport "playing"
- **Where:** `index.html:4364–4367` and `4429–4432`.
- **What happens:** Loading a stream sets `studio.isPlaying = true` without setting `transportStartTime` or calling `playMaster()`.
- **Consequences:**
  - `getCurrentPlaybackTime()` then returns `audioCtx.currentTime` since page load.
  - Weave starts advancing.
  - The play button's SVG gets replaced with the text "⏸ PAUSE".
- **Smallest fix:** Call `playMaster()`, or leave transport alone.

### L1: Weave reads `studio.currentBpm`, which doesn't exist
- **What happens:** Weave falls back to 120. That's correct today only because `masterBpm` is hard-coded to 120.
- **Why it matters:** It breaks the moment tempo becomes editable. H1's fix removes this.

### L2: Two meanings of `levels`
- **What happens:**
  - In seed scenes, `levels[k] = 0` means the track is absent.
  - In captured scenes, `levels = y`, clamped to ≥ 0.02, so every captured scene shows all four threads.
- **Why it matters:** The fade diagram and set-list ticks use `levels > 0` to mean "in this scene". Muted or empty tracks still look present.

### L3: DONE is bound twice
- **What happens:** An inline `onclick` plus `addEventListener('click')` run `exitAdjust` twice.
- **Why it matters:** Harmless double render.

### L4: Seed IDs and new IDs use different formats
- **What happens:** Seed scenes are `scene-0…6` and captured scenes are `scene-uid-7…`.
- **Why it matters:** Fine now. Once scenes persist, `_nextSceneUid` must be restored from the file. Otherwise IDs collide after reload.

### L5: The Loom has hard-coded geometry
- **What happens:** 300px width, 688px viewport, lane x-positions.
- **Why it matters:** It's safe under `zoom`, since the whole app scales. It will need revisiting if the gutter width changes.

### Checked and fine

- **Pointer → audio coordinates.** `getCanvasCoords` normalizes by `getBoundingClientRect()` on both axes, so zoom cancels out and audio x/y stays correct at any scale.
- **Delete guards and index maintenance.** They're correct for selected, editing and playing.

---

## 4. Hidden technical debt that will hurt the next Weave steps

1. **Scenes are addressed by array index everywhere:** `playingIndex`, row `data-scene-index`, the swipe closures. The shared transition is fine. Per-transition data, persistence and deleting mid-playback all need `playingSceneId` and a transition keyed by `fromId→toId` or owned by the outgoing scene.
2. **Recall is copy-pasted three times** (select, tweak, capture). There's no single recall path to hang JUMP/MORPH/FADE on.
3. **Weave has no reset or hydrate API**, so project load can't clear it cleanly (H4).
4. **The render model is innerHTML plus rebinding:** 95 `addEventListener` calls in `index.html`, and Weave rebinds per render. It works, but any continuous control in Weave (sliders, knobs) will keep hitting M2.
5. **Seed scenes are mixed in with real ones.** The 7 mock scenes are still the default. They have no `spatialState`, so recall silently skips them, and ADJUST on a seed scene quietly snapshots whatever the canvas shows.

---

## 5. Test gaps

What the tests protect today:

- TickTok transport semantics. These tests are strong.
- Weave engine methods against a **mock** AudioTrack.
- HTML string contents.

What they don't protect:

- **The real AudioTrack.** The mock re-implements `setPosition`, so a change to the real clamping or param path wouldn't be caught.
- **Swipe thresholds and direction lock.** No pointer events are simulated. The "swipe" test calls engine methods directly.
- **Space and Tab handling.** Given M7 and M8, this is worth a small test.
- **Weave ↔ transport.** Nothing covers stop → Weave reset, or bar alignment at non-120 BPM.
- **Save → load round trip for `weave`.** It doesn't exist yet, but should be written with H4.
- **Project load resetting Weave.**
- **Progression recall.** Scene N+1's positions should be applied at the boundary.

---

## 6. Recommended sequence

Each step is small enough to test on its own.

1. **Housekeeping, zero risk.** Fix the build copy (H5), remove the Tab hijack and correct the Space hint (M7, M8), and disable or relabel Preview (M1). Update `WEAVE-DECISIONS.md`.
2. **One `recallScene()` path, and decide what select does** (H3). Tests: select doesn't move nodes (if that's the decision); adjust does.
3. **Clock Weave to the transport** (H1, L1). Scene start is a transport bar number, and Stop resets it. Tests: stop → bar 0; 10 pause/resume cycles → no drift; bpm ≠ 120.
4. **JUMP on progression** (H2). At the boundary, `recallScene(next)` runs. GO NOW does the same, quantized to the next bar or immediate (your call). Tests at the boundary.
5. **Persistence** (H4, L4). Add a `weave` block, reset on load, restore `nextSceneUid`, and switch to `playingSceneId`. Round-trip test.
6. **ADJUST completeness** (M4, M5). Z, sliders and reset commit to the scene, plus a decision on motion loops.
7. **MORPH.** Interpolate x/y/z over `transitionLengthBars` using the curve, driven from the transport. Fix the mini-map orientation (M6) and use real snapshots.
8. **FADE, then a real Preview.** Only after we know what FADE means for audio (see questions).
