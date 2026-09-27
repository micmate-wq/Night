# Aether 5.1.1 Codex-AGY — Evidence-Based Stability Audit

**Date:** 2026-09-27  
**Auditor:** Antigravity  
**Git Target:** `feature/aether-core` (`3d1dabd` / `v5.1.1` + local working tree)  
**Scope:** Review and verification only. No application code modified.

---

## 1. Application Architecture & Entry Points

- **Host & Shell:** Tauri v2 (`desktop/src-tauri/`) wrapping a macOS WKWebView.
  - Native entry point: [desktop/src-tauri/src/lib.rs:run()](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/src-tauri/src/lib.rs#L223)
  - Window setup: Fixed 1440×900 non-resizable stage ([tauri.conf.json](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/src-tauri/tauri.conf.json#L19-L31)).
  - Native commands: Project save/load dialogs, node bundle unpacker (`.aethernode`), audio file base64 reader, Icecast streaming engine.
- **Frontend & DSP Core:** Single-page application served at `http://localhost:3456/desktop/index.html`.
  - DOM/UI entry point: [desktop/index.html](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L8624) (`new SpatialStudio()` on `DOMContentLoaded`).
  - Graph architecture: 4 persistent spatial audio tracks (`AudioTrack`). Each track features:
    - Source: Decoded `AudioBufferSourceNode`, streaming `HTMLAudioElement`, `MediaStreamAudioSourceNode` (Live In), or custom `.aethernode` DSP (`AudioWorkletNode` or script class).
    - Insert strip: 3-band bipolar EQ (`BiquadFilterNode`: LowShelf 150 Hz, Peaking 1000 Hz, HighShelf 6000 Hz) + Track Gain.
    - Routing branches:
      1. Dry Stereo Path: Equal-power `StereoPannerNode` -> `directPanGain` -> `masterGain`.
      2. 3D Spatial Path: `depthFilterNode` (distance lowpass) -> `pannerNode` (HRTF) or `spatializerNode` (Wasm worklet) -> `spatialGainNode` -> `masterGain`.
      3. Distance Reverb: `reverbSendGain` -> `reverbConvolver` -> `reverbDampingFilter` -> `reverbPanNode` -> `masterGain`.
    - Master Processing: Master Gain -> Compressor -> Peak Limiter -> Safety Waveshaper Curve ([desktop/master-output.js](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/master-output.js)) -> Destination.
- **Build, Run & Test Commands:**
  - Dev server: `npm run dev` (`python3 -m http.server 3456 -d /Users/matt/.gemini/antigravity/scratch/aether`)
  - Tauri dev: `npm run tauri dev`
  - Tauri check & unit tests: `cargo check` & `cargo test` in `desktop/src-tauri/`
  - Syntax check: `node -e "..."` VM parsing on `desktop/index.html` inline script and helper files.

---

## 2. State Model Relationships

- **UI State:** Tracks spatial position $(x, y, z)$, channel panel dial values (EQ, Gain, Speed), playlist index, mute/solo flags, and inspector modal states. Canvas $Y$ is inverted $(0=\text{bottom}, 1=\text{top})$ matching volume.
- **Audio Engine State:** Web Audio API node graph (`AudioContext`, `BiquadFilterNodes`, `GainNodes`, `PannerNodes`). Volume is calculated non-linearly: $\text{vol} = y^{1.5} \times 10^{\text{gainDb}/20}$.
- **Saved Projects (`.aether` JSON):** Stored as self-contained JSON (v3.1 schema). Playlists and sample audio buffers are serialized as base64-encoded binary data alongside motion automation keyframes and DSP parameters.

---

## 3. Verification & Test Results

### Checks That Passed
- **JavaScript Syntax & VM Parsing:** Main inline script in [desktop/index.html](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html) and all 8 external scripts (`motion-loop.js`, `node-ripple.js`, `node-art.js`, `master-output.js`, `loudness-match.js`, `spatializer-worklet.js`, `icecast-capture-worklet.js`, `icecast-pcm-worklet.js`) parsed cleanly without syntax errors.
- **Rust Tauri Compilation:** `cargo check` compiled in 5.56s with 0 errors.
- **Rust Unit Tests:** `cargo test` ran 5 tests (4 passed, 0 failed, 1 ignored network test).
- **HTTP Server Connectivity:** `http://127.0.0.1:3456/desktop/index.html` returned HTTP 200.
- **Spatializer Wasm Asset:** `desktop/dsp-wasm/pkg/dsp_wasm_bg.wasm` is present (33 KB) and accessible via HTTP 200.
- **Node DSP Bundle Compatibility:** All 20 bundled node DSP scripts in `nodes/` successfully passed `new Function()` validation.
- **Shape-Picker Cleanup:** Verification confirmed zero references or activation calls to `initMotionShapePicker` remain in `desktop/index.html`.

### Confirmed Defects
1. **Unanchored Transport Playhead and Time Jumps (High):**
   - **Location:** [desktop/index.html:L6988-6997](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6988-L6997), [desktop/index.html:L4691-4693](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L4691-L4693), [desktop/index.html:L7812-7817](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L7812-L7817)
   - **Consequence:** Playback start position and master clock are tied directly to raw `audioCtx.currentTime` (seconds since context creation). Pressing Stop resets the clock display to `00:00.0`, but pressing Play immediately jumps the clock and starts playback at `(audioCtx.currentTime % duration)` rather than the beginning.
   - **Fix:** Track session transport time (`transportPosition`, `transportStartTime`) and calculate sample offset relative to transport position instead of raw `audioCtx.currentTime`.
2. **Non-Atomic File Writing in Save Dialog (High):**
   - **Location:** [desktop/src-tauri/src/lib.rs:L104](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/src-tauri/src/lib.rs#L104)
   - **Consequence:** `save_project_dialog` uses `std::fs::write(&path, content.as_bytes())` directly, truncating the destination file in place. If an error occurs mid-write on a large file, the existing project is corrupted.
   - **Fix:** Replace `std::fs::write` with the existing, tested `project_write::replace_project(&path, content.as_bytes())` in `lib.rs:L104`.
3. **Packaging Build Script Omits DSP Wasm Module (Medium):**
   - **Location:** [desktop/src-tauri/tauri.conf.json:L7](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/src-tauri/tauri.conf.json#L7)
   - **Consequence:** `beforeBuildCommand` only copies `index.html *.js *.svg` into `dist/`. In a production packaged DMG/app, `dsp-wasm/` is missing, resulting in 404s when loading the spatializer Wasm module and silently falling back to un-spatialized pass-through.
   - **Fix:** Update `beforeBuildCommand` to copy `dsp-wasm/` into `dist/`.
4. **All-or-Nothing Project Loading Aborts on Single Missing Asset (Medium):**
   - **Location:** [desktop/index.html:L6809](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6809), [desktop/index.html:L6824](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6824)
   - **Consequence:** In `prepareSession()`, if one track fails to decode an audio file or find a bundle, it throws an error that aborts the entire project load, discarding all other valid tracks and mix settings.
   - **Fix:** Collect per-track failures in `prepareSession()` and stage missing tracks as empty instead of throwing and aborting the session.
5. **Redundant Base64 Audio Serialization (Medium):**
   - **Location:** [desktop/index.html:L6528-6552](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6528-L6552), [desktop/index.html:L6789](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6789)
   - **Consequence:** Active samples are serialized twice (in `sampleData` as 16-bit WAV and in `playlist[i].data`). On load, `saved.sampleData` unconditionally overwrites the original playlist audio buffer with the downsampled 16-bit version.
   - **Fix:** Serialize `sampleData` only when `playlist` is empty (e.g., recorded live input).
6. **Insert Node Dry Loop Plays Unconditionally on Load (Low):**
   - **Location:** [desktop/index.html:L4501](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L4501), [desktop/index.html:L4619](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L4619)
   - **Consequence:** Loading an insert effect node bundle into a track with audio tape calls `_armInsertDry()`, which immediately starts playing audio even when the transport is stopped.
   - **Fix:** Only start `_insertDrySource` if `this.studio.isPlaying` is true.
7. **Object URL Leaks in Worklet and Audio Fallbacks (Low):**
   - **Location:** [desktop/index.html:L6274](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L6274), [desktop/index.html:L4315](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/index.html#L4315)
   - **Consequence:** `_initIcecastCapture()` creates a blob URL for `icecast-capture-worklet` without revoking it.
   - **Fix:** Call `URL.revokeObjectURL` in a `finally` block.

### Suspected Risks Requiring Investigation
- **Main-Thread Base64 String Decoding:** `prepareSession()` uses `Uint8Array.from(atob(entry.data), c => c.charCodeAt(0))` for playlist entries. On large audio files (>20 MB), running this synchronous loop on the main thread causes UI hitches.
- **AudioWorklet Message Listener Retention:** `loadNodeBundle()` assigns `workletNode.port.onmessage` without nulling it in `dispose()`, potentially retaining references across repeated bundle reloads.

### Behaviour Not Tested
- Multi-hour continuous memory profiling under high DSP load.
- Multi-channel physical hardware output routing (> 2 channels).
- Outbound Icecast live stream broadcast to an active remote server.

---

## 4. Manual Listening Checklist for User

1. **Clean Playback Start:** Load an audio sample into Track 1. Wait 15 seconds. Press Spacebar (Play). Note whether playback starts immediately from the start of the sample or jumps ahead.
2. **Stop & Restart:** Press Spacebar to pause, press the Stop button (`■`), then press Spacebar again. Verify whether audio restarts from 0:00.0.
3. **Insert Node Dry Leak:** Load an audio sample into Track 2, stop playback, and drop an insert node (e.g. `nodes/spectral-smear.aethernode`). Listen for unexpected sound output while stopped.
4. **Spatial Panning Sweep:** Drag Track 1 across the arena horizontally (L to R) and vertically (front to back). Verify stereo pan and distance lowpass filtering react smoothly without crackling.
5. **Master Limiter Guard:** Boost Track 1 gain to +6 dB, set EQ High to +12 dB, and drag to maximum volume ($Y=1.0$). Verify the master limiter gracefully compresses without harsh digital clipping.

---

## 5. Ordered Repair Plan

### Blockers (Must fix before adding scheduler/snapshots)
1. **Fix Transport Playhead Anchoring:** Decouple playback timing and clock UI from monotonic `audioCtx.currentTime`.
2. **Switch Save Dialog to Atomic Replacement:** Update `save_project_dialog` in `lib.rs` to call `project_write::replace_project`.
3. **Include DSP Wasm in Build Command:** Update `desktop/src-tauri/tauri.conf.json` `beforeBuildCommand` to copy `dsp-wasm` into `dist`.

### Non-Blockers (Can wait for subsequent iteration)
4. **Graceful Partial Project Loading:** Prevent a single corrupted or missing sample from aborting the entire project import.
5. **Deduplicate Project Base64 Serialization:** Avoid serializing audio twice and overwriting 24-bit/32-bit buffers with 16-bit PCM.
6. **Mute Insert Dry Loop While Transport Stopped:** Guard `_armInsertDry()` against starting before Play is triggered.
7. **Clean Object URL Revocation:** Ensure all blob URLs created for worklets are explicitly revoked.

---

## 6. Ten-Minute Manual Playtest Guide

1. **Launch:** Start `npm run dev` and open `http://localhost:3456/desktop/index.html`.
2. **Drag & Drop:** Drop 4 distinct audio files onto Tracks 1–4. Verify track badges and durations update.
3. **Transport Play/Stop:** Start playback, verify all 4 stems play synchronously. Stop playback and confirm stems halt.
4. **Motion Automation:** Record a circular motion gesture on Track 1. Verify loop plays back and smoothly returns.
5. **Project Roundtrip:** Save the project as `TestProject.aether`. Reload the browser page (`Cmd+R`). Open `TestProject.aether` and verify quadrant positions, EQ dials, and motion paths restore accurately.
6. **Node Loading:** Drop a custom node bundle (`nodes/bloom.aethernode`) onto Track 3. Verify node inspector opens and controls are interactive.
7. **Clean Audio Check:** Listen through headphones during motion and node parameter adjustment to confirm zero unexpected audio pops.

---

## 7. Areas Not Covered by This Review
- Remote Icecast network streaming throughput over real WAN.
- Performance on low-end dual-core hardware or mobile WebViews.
- External MIDI hardware mapping or automation controller protocols.
