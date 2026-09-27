# Aether Node Manifesto & Specification v0.1

**Status:** Draft / Active Contract  
**Target Audience:** Aether Core Engineers & Coding Agents  
**Scope:** Production-grade Aether Node Architecture (beginning with Patient Zero: TickTok)

---

## 1. Core Philosophy & Identity

An Aether Node is a self-contained musical instrument, sound generator, or insert effect designed to live natively within Aether's 4-track spatial canvas.

### 1.1 Node Identity Contract
Every production node must expose a `manifest.json` providing:
- **`id`**: Globally unique reverse-DNS identifier (e.g., `com.aether.node.tick-tok`).
- **`name`**: Clean, human-readable display name.
- **`version`**: Semantic versioning (e.g., `2.0.0`).
- **`role`**: Explicit functional category:
  - `instrument` (generator: 0 audio inputs, 1 or 2 audio outputs).
  - `insert` (effect: 1 or 2 audio inputs, 1 or 2 audio outputs).
- **`timingTier`**: Declared musical timing capability (see Section 3).
- **`parameters`**: Strongly typed parameter array with default values, numerical ranges, and units.

---

## 2. Master Transport & Lifecycle Contract

Production nodes must strictly adhere to Aether's master transport state machine (`SpatialStudio`). A node must never independently assume authority over when audio is generated or played.

### 2.1 Lifecycle State Transitions

| Master State / Event | Node DSP Expected Behavior | Audio Output |
| :--- | :--- | :--- |
| **Instantiate / Init** | Create graph nodes, buffers, compile worklets. **Never start scheduling.** | **Complete silence** |
| **Play (from 0.0s)** | Reset local phase counters. Align to Bar 0, Beat 0, Step 0. Begin audio event scheduling. | Active |
| **Pause** | Cancel all queued lookahead timers (`clearTimeout` / stop scheduled events). Freeze musical phase. | Silent |
| **Resume** | Re-anchor local clock to `snapshot.beatsElapsed` and `snapshot.beatPhase`. Continue seamlessly. | Active |
| **Stop** | Halt timers immediately. Reset musical position to zero. Clear internal phase buffers. | **Complete silence** |
| **Hot Insertion** | If `studio.isPlaying === true`, query `getClockSnapshot()`. Join the running timeline in-phase. | Active (synchronous) |
| **Removal / Dispose** | Cancel all timers, disconnect all `AudioNode`s, terminate workers, clear references. | **Complete silence** |

> **Critical Invariant:** Loading or instantiating a node while transport is stopped or paused must produce complete silence. Audio leakage on instantiation is a critical defect.

---

## 3. Musical Timing Tiers & Responsibilities

Nodes vary widely in their relationship to time. Nodes are classified into one of four explicit timing tiers:

1. **`not-tempo-aware`**: Pure effects, pass-through filters, utility gains, or static sound generators.
2. **`ambient-generative`**: Evolving pads, probabilistic textures, stochastic grains (e.g., Bloom). They run continuously or respond to spatial gestures, but deliberately do **not** lock to a musical beat grid.
3. **`tempo-aware`**: Delays, LFOs, and rhythmic modulators that adjust rate based on BPM, but do not require quantized downbeat alignment.
4. **`phase-grid-aware`**: Drum machines, step sequencers, arpeggiators, and clocked groove engines (e.g., TickTok, F*EM). **Must maintain absolute phase coherence with Aether's master transport.**

---

## 4. The Master Clock Contract for Phase-Grid Nodes

Any node claiming tempo/beat synchronization must derive its musical timeline from Aether's master clock snapshot (`SpatialStudio.getClockSnapshot()`).

### 4.1 Master Clock Snapshot Structure
```typescript
interface AetherClockSnapshot {
  transportTime: number; // Current elapsed session playback time in seconds (>= 0)
  audioCtxTime: number;  // Current audioCtx.currentTime in seconds
  bpm: number;           // Master tempo (default: 120)
  state: 'playing' | 'paused' | 'stopped';
  beatsElapsed: number;  // Continuous float beat position from transport origin
  barIndex: number;      // 0-indexed bar index (e.g. 0, 1, 2...)
  beatIndex: number;     // 0-indexed beat within bar (0..3 in 4/4)
  stepIndex: number;     // 0-indexed 16th-note step within bar (0..15)
  beatPhase: number;     // Fractional progress through current beat [0.0, 1.0)
}
```

### 4.2 Concept of Operation for Phase-Grid Nodes
- **No Private Incrementing Beat Clocks:** Do not rely solely on an internal counter (`this.step++`) without reference to Aether's timebase. Musical position must always be derived or anchored against `beatsElapsed`.
- **Hot-Insertion Phase Locking:** When a rhythm node is added while Aether is already playing:
  $$\text{targetStep} = \lfloor \text{snapshot.beatsElapsed} \times 4 \rfloor \pmod{16}$$
  The node starts on the next immediate 16th-note boundary relative to `audioCtx.currentTime`, synchronized to that calculated step.
- **Web Audio Lookahead Scheduling:**
  - Nodes must use a small lookahead window (e.g. ~25ms ticker scheduling ~100ms into the future).
  - All Web Audio parameters and buffer trigger times must be timestamped against `audioCtx.currentTime`.
  - `audioCtx.currentTime` handles hardware sample-accurate scheduling; the Aether Master Clock snapshot provides the musical coordinate space.

---

## 5. UI, State Persistence & Cleanup

### 5.1 Parameter & State Persistence
- All musical parameters (knobs, sliders, toggles, pattern indices) must be readable and writable via deterministic key-value pairs (`setParameter(id, value)` / `getParameter(id)`).
- Session hydration must cleanly restore all node parameters without triggering audio glitches or premature playback.

### 5.2 Resource Cleanup
Every node must implement an explicit `dispose()` method:
- Disconnect and destroy internal `AudioNode`s.
- `clearTimeout` / `clearInterval` / `cancelAnimationFrame` on all active handlers.
- Revoke any allocated ObjectURLs or temporary buffer caches.
- Unregister custom message listeners.

### 5.3 UI Standards
- Must match Aether's tactile, minimal aesthetic (graphite accents, restrained typography, clear parameter readouts).
- No leftover debug or prototype controls in production bundles.
- Inspector panels and canvas rendering must be decoupled from the audio thread.

---

## 6. Patient Zero Notes: Legacy TickTok Reference Audit

The existing legacy `nodes/tick-tok` implementation was inspected as the empirical baseline for Patient Zero.

### 6.1 Musical Assets & Algorithms to Preserve
1. **Morphing Analog Kick Synthesis (`_kick`):**
   - Clean pitch-swept sine oscillator ($f_0 \times 1.8 \to f_0 \times 0.52$) down to 36 Hz with punchy exponential amplitude curve.
2. **Snappy Snare/Talk Burst (`_talkBurst`):**
   - White/pink noise buffer routed through resonant dual bandpass ($400\text{--}2800\,\text{Hz}$) + highpass ($250\,\text{Hz}$) with adjustable decay.
3. **High-Frequency Crisp Hat (`_hat`):**
   - High-passed noise burst ($4200\text{--}9000\,\text{Hz}$) with microsecond envelope.
4. **Algorithmic Rhythm Generation:**
   - Morphing kick pattern blend (`_blendPattern`) across 5 rhythmic foundations (four-on-the-floor, double kick, drop/gap, cluster, clave).
   - Dynamic snare accent climb (`_talkMask`).
   - Turing-machine pseudo-shift register with probabilistic ghost-note injections (`_rollGhosts`).

### 6.2 Contract Violations in Legacy TickTok
1. **Audio Leakage on Init:** `init()` directly called `this.start()`. If instantiated when transport was paused, it immediately began ticking in the background.
2. **Independent Unsynchronized Clock:** Relied exclusively on private `this.step = 0`, `this.bar = 0`, and `this.nextStepTime = this.ctx.currentTime + 0.05`. It had zero awareness of Aether's master transport or musical position.
3. **No Hot-Insertion Sync:** When added during master playback, it started at Step 0, drifting arbitrarily against any existing track rhythm.
4. **Unanchored Resumes:** Pausing and resuming reset `this.nextStepTime` to `now + 0.05`, causing phase-offset drift across repeated pause/resume cycles.
5. **No Parameter Serialization Hook:** Parameter state was kept in an ad-hoc dictionary without a unified serialization/restoration contract.

### 6.3 Patient Zero Implementation Strategy
- **Rewrite:** The transport lifecycle, scheduling loop, and clock anchor logic will be rewritten from scratch to adhere to Manifesto v0.1.
- **Port:** The core analog DSP synthesis routines (`_kick`, `_talkBurst`, `_hat`, `_blendPattern`, `_talkMask`, `_rollGhosts`) will be preserved verbatim into the new structure.
