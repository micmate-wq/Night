# Experiment Archive: Modular Node Micro-Synth Engine (`EXPERIMENT_MICRO_SYNTH_NODE`)

> **Status:** Dormant / Archived Experiment  
> **Target Scope:** Ambient texture, pad drone synthesizer module for Ether 2D/3D Canvas Nodes.

---

## 1. Executive Summary & Objective
The **Modular Node Micro-Synth Engine** allows any of the four Ether canvas spatial audio nodes to function as an ultra-lightweight, dual-oscillator ambient synthesizer. It provides low-CPU floating pad textures, poetry backdrops, and generative drone soundscapes that integrate natively into Ether's spatial 3D audio environment and remote mobile telemetry.

---

## 2. Core Audio Architecture (Web Audio API Native Nodes)

### 2.1 Dual-Oscillator Design
- **Primary Oscillator (`synthOsc1`):** Selectable basic waveforms:
  - `sine` (pure ambient tone)
  - `triangle` (warm harmonics)
  - `square` (hollow, reedy texture)
- **Secondary / Sub Oscillator (`synthOsc2`):** Frequency tuned to a sub-octave (0.5×) or fifth (1.5×) interval relative to the primary frequency. Automatically selects complementary waveform (`sine` or `triangle`).
- **Analog Drift LFO (`synthLFO` + `synthLFOGain`):** Ultra-low frequency (~0.12Hz to 0.21Hz) sine oscillator introducing subtle pitch drift (3.5Hz / ~6-10 cents deviation) to eliminate sterile digital tuning.

### 2.2 Filter & Envelope Shaper
- **2-Pole Low-Pass Filter (`BiquadFilterNode`):**
  - Type: `lowpass`
  - Cutoff range: 150Hz to 12,000Hz (default: 1,400Hz)
  - Resonance (Q): 2.5 to 2.8
- **Drone / Pad Envelope (`GainNode`):**
  - Soft linear/exponential attack ramp (1.2s from `0.0001` to `0.45`).
  - Smooth exponential decay/release release (0.6s to 0.8s down to `0.0001` on stop/mute).
  - Eliminates abrupt clicks and harsh transient pops.

### 2.3 Audio Routing Diagram
```
[Primary Osc (sine/tri/sq)] --\
                               +--> [2-Pole LPF Filter] --> [Drone Gain Envelope] --> [3-Band EQ Low Node] --> [Depth Filter] --> [Dry/Wet Track Sum] --> [Stereo/HRTF Panner]
[Sub/Fifth Osc (sine/tri)]  --/                                                                                                            |
      ^                                                                                                                                     v
[Analog Drift LFO (~0.15Hz)]                                                                                                       [Spatial Reverb Convolver]
```

### 2.4 Harmonic Scale Quantization
Pitch selection is snapped to a 15-note ambient Pentatonic / Minor 9th harmonic palette (rooted in A):

| Index | Note | Frequency (Hz) | Description |
| :--- | :--- | :--- | :--- |
| 0 | A1 | 55.00 | Deep sub fundamental |
| 1 | C2 | 65.41 | Minor third base |
| 2 | D2 | 73.42 | Fourth |
| 3 | E2 | 82.41 | Fifth base drone |
| 4 | G2 | 98.00 | Minor seventh |
| 5 | A2 | 110.00 | Fundamental (Default) |
| 6 | C3 | 130.81 | Minor third mid |
| 7 | D3 | 146.83 | Eleventh |
| 8 | E3 | 164.81 | Fifteenth |
| 9 | G3 | 196.00 | Seventh mid |
| 10 | A3 | 220.00 | Octave 2 |
| 11 | C4 | 261.63 | High minor third |
| 12 | E4 | 329.63 | High fifth |
| 13 | G4 | 392.00 | High minor seventh |
| 14 | B4 | 493.88 | Floating 9th tension |

---

## 3. Minimalist Canvas UI & Interaction Model

### 3.1 Glowing Node Visuals
- **Glowing Aura:** Synth nodes emit a subtle ambient radial glow whenever active and sounding.
- **Center Waveform Glyph:** Renders `∿` (sine), `△` (triangle), or `⊓` (square) inside the node orb. Clicking the center glyph cycles through waveforms.

### 3.2 Concentric Ring Controls (Revealed on Focus/Hover)
- **Inner Ring (Pitch / Harmonics):** Radius = `nodeRadius + 14px`. Contains 15 radial notches corresponding to scale degrees. Rotational drag snaps pitch smoothly without dissonance.
- **Outer Ring (Texture / Space):** Radius = `nodeRadius + 28px`. Circular arc representing wet/dry reverb send level. Rotational drag controls space depth from dry (0%) to fully ambient (100%).

### 3.3 Inter-Node Spatial Bleed
- Calculates Euclidean distance $d = \sqrt{(t_1.x - t_2.x)^2 + (t_1.y - t_2.y)^2}$ between synth nodes and adjacent nodes.
- When $d < 0.38$ (38% screen width), an ethereal dashed resonance beam connects the nodes with alpha proportional to proximity $(1 - d/0.38)$, feeding mutual harmonic space.

---

## 4. Mobile & Remote Telemetry Integration
- **Filter Cutoff Sweep:** Maps mobile phone pitch tilt (`beta` sensor: $-30^\circ \dots +30^\circ$) to sweep filter cutoff from 200Hz to 6,000Hz.
- **Pitch Bend:** Maps mobile phone roll tilt (`gamma` sensor: $-15^\circ \dots +15^\circ$) to smooth $\pm 2$ semitone pitch inflection.
- **WebSocket Protocol Payload:**
```json
{
  "action": "synth_gyro",
  "target": "track3",
  "beta": 14.5,
  "gamma": -3.2
}
```

---

## 5. CPU Optimization & Lifecycle
- When stopped or muted, all oscillators (`synthOsc1`, `synthOsc2`, `synthLFO`) and filter nodes are stopped and disconnected (`zero active processing`).
- Re-hydrated seamlessly upon project load or node focus.
