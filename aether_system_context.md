# Aether Desktop — System Context & Task Handoff

## Project Overview

**Aether** is a modular desktop audio canvas — a 4-track spatial audio studio and motion automation workstation — built as a **Tauri v2** application (Rust shell + Webview frontend). The entire audio engine and UI live in a single-page `index.html`; the Rust backend is a thin shell exposing file I/O Tauri commands only (no native audio).

**Workspace root:** `/Users/matt/.gemini/antigravity/scratch/aether`

---

## Directory Layout

```text
aether/
├── desktop/                        # Tauri desktop app
│   ├── index.html                  # ENTIRE app: all UI + Web Audio engine
│   ├── spatializer-worklet.js      # AudioWorklet that bridges Wasm DSP to Web Audio
│   ├── dsp-wasm/                   # Rust → Wasm DSP crate
│   │   ├── Cargo.toml              # cdylib, no wasm-bindgen, pure std
│   │   ├── src/lib.rs              # Spatializer DSP (Haas + Amplitude Panning + 3-tap ER)
│   │   └── pkg/
│   │       └── dsp_wasm_bg.wasm   # Pre-built Wasm binary
│   └── src-tauri/                  # Tauri Rust shell
│       ├── Cargo.toml
│       ├── tauri.conf.json         # devUrl: http://localhost:3456/desktop/index.html
│       └── src/
│           └── lib.rs              # Tauri commands: file dialogs, zip bundle unpacking
├── nodes/                          # .aethernode plugin bundles (source & zipped)
│   └── granular-atmospheric-cloud/
│       ├── manifest.json
│       ├── dsp.js                  # Web Audio worklet DSP
│       └── ui.html                 # Node UI (postMessage ↔ Aether host)
├── package.json                    # scripts: start/dev = python3 -m http.server 3456
└── aether_system_context.md        # This system context file
```

---

## Key Achievements & Current Architecture

### 1. Spatializer Insert Routing (Comb Filtering Fixed)
- **Previous issue:** `stereoPanNode` (undelayed dry) ran in parallel with `spatializerNode` (128-sample Worklet latency + Haas delay), causing destructive phase cancellation / comb filtering.
- **Solution (Approach A):** Added a `directPanGain` node directly after `stereoPanNode`. When spatialization is active (Z > 0.5), `directPanGain` is brought to `0`, and `spatialGainNode` is set to `1.0`. The Wasm Spatializer acts as a true insert effect containing the composite direct + Haas + Early Reflections signal.
- **Internal Amplitude Panning:** `dsp-wasm/src/lib.rs` computes equal-power amplitude panning on the source signal before passing it to the Haas delay lines.

### 2. Distance Gain Compensation & Dark Reverb
- **Gentle Attenuation:** `dryGainFactor` was adjusted to `Math.sqrt(Math.max(0.4, 1.0 - (0.315 * t)))`, making the volume drop ~30% gentler at max distance (`Z=50`).
- **Dark Convolution Reverb:** `this.studio.reverbBuffer` is generated on audio context initialization, feeding `reverbSendFilterNode` and `reverbConvolver` to bloom in 10% dark reverb (`0.10 * (t^1.3) * (y^1.2)`) as nodes move far back.

### 3. Default Opening 2D Canvas Layout
The 4 nodes open by default in a balanced diamond layout:
- **T1 (Red):** `X: 0.50` (Center), `Y: 0.80` (Volume 80%), `Z: 0.0`
- **T2 (Yellow):** `X: 0.50` (Center), `Y: 0.30` (Volume 30%), `Z: 0.0`
- **T3 (Purple):** `X: 0.25` (Pan L50), `Y: 0.50` (Volume 50%), `Z: 0.0`
- **T4 (Green):** `X: 0.75` (Pan R50), `Y: 0.50` (Volume 50%), `Z: 0.0`
*Stale `aether_saved_session` auto-restore was disabled on initial boot to ensure clean defaults, while manual project Save/Load remains fully functional.*

### 4. Top-Level Reload Shortcut
- Added top-level capture-phase keydown listener for `Cmd+R` / `Ctrl+R` in `desktop/index.html`.

---

## How to Run & Build

### Running Desktop App (Tauri v2)
```bash
# From desktop/:
npx tauri dev
```
*(Note: `tauri.conf.json` is configured with `beforeDevCommand: "python3 -m http.server 3456 -d /Users/matt/.gemini/antigravity/scratch/aether"`).*

### Rebuilding Wasm Spatializer (if lib.rs changes)
```bash
cd desktop/dsp-wasm
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/dsp_wasm.wasm pkg/dsp_wasm_bg.wasm
```

---

## Audio Signal Flow (State Summary)

### State A & B (Z <= 0.5 — 2D Panned Stereo)
```text
Track Source → EQ (3-band) → Gain (baseVol) → TrackSumNode
      ├──→ stereoPanNode → directPanGain (1.0) → masterGain
      └──→ depthFilterNode (24kHz) → spatializerNode → spatialGainNode (0.0)
```

### State C (Z > 0.5 — 3D Spatialized)
```text
Track Source → EQ (3-band) → Gain (dryVol) → TrackSumNode
      ├──→ stereoPanNode → directPanGain (0.0) [Muted to prevent comb filtering]
      ├──→ depthFilterNode → spatializerNode (Wasm: Panning + Haas + ER) → spatialGainNode (1.0) → masterGain
      └──→ reverbSendFilterNode → reverbSendGain (up to 10%) → reverbConvolver → masterGain
```
