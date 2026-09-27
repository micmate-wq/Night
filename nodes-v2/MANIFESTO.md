# Aether Node Manifesto & Specification v1.0

**Status:** Official Architectural Standard (Validated by Patient Zero: TickTok V2)  
**Target Audience:** Aether Core Engineers & Coding Agents  
**Scope:** Production-grade Aether Node Architecture (Instruments, Generators, and Insert Effects)

---

## 1. Core Philosophy & Identity

An Aether Node is a self-contained musical instrument, sound generator, or insert effect designed to live natively within Aether's 4-track spatial canvas.

Every node is packaged as a portable bundle (directory or `.aethernode` zip archive) containing:
- `manifest.json`: Metadata, parameter definitions, and capability declarations.
- `dsp.js`: Web Audio DSP implementation with deterministic lifecycle and timing hooks.
- `ui.html`: Tactile, sandboxed inspector UI communicating via standard postMessage events.

### 1.1 Node Identity Contract (`manifest.json`)
Every production node must expose a valid `manifest.json` providing:
- **`id`**: Globally unique reverse-DNS identifier (e.g. `com.aether.node.tick-tok`, `com.aether.node.template`).
- **`name`**: Clean, human-readable display name.
- **`version`**: Semantic versioning (e.g. `1.0.0` or `2.0.0`).
- **`role`**: Explicit functional category:
  - `instrument` (generator: 0 audio inputs, 1 or 2 audio outputs).
  - `insert` (effect: 1 or 2 audio inputs, 1 or 2 audio outputs).
- **`timingTier`**: Declared musical timing capability (see Section 3).
- **`entry`**: Entry points object specifying `dsp` (`dsp.js`) and `ui` (`ui.html`).
- **`parameters`**: Strongly typed parameter array with default values, numerical ranges, and units.

---

## 2. Host Boundary Contract

Production V2 nodes must never receive direct or unrestricted access to the global `SpatialStudio` instance or host internals. Instead, the host passes a constrained host interface upon initialization:

```javascript
nodeDSP.init(audioContext, host);
```

### 2.1 Minimal Host Interface
The host object provides access to Aether's master musical transport without exposing application state:

```typescript
interface AetherNodeHost {
  getClockSnapshot: () => AetherClockSnapshot | null;
}
```

### 2.2 Clock Snapshot Schema
Tempo- and phase-aware nodes rely strictly upon the normalized snapshot returned by `host.getClockSnapshot()`:

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

### 2.3 Host Boundary & Standalone Fallback
For production Aether Node V2 modules, the supported application boundary is the explicit host object supplied to:

```javascript
nodeDSP.init(audioContext, host);
```

with capabilities such as `host.getClockSnapshot()`. Production nodes must not reach into `window.studio` or otherwise discover `SpatialStudio` globally.

A self-contained standalone/test fallback clock may exist inside template or test contexts if needed (e.g. synthesizing a local snapshot from `audioContext.currentTime` and internal `params.bpm`), but it must not depend on Aether application globals and must not be described as a production integration path:

1. `this.host?.getClockSnapshot()` (the sole production host integration path)
2. Standalone fallback (synthesized strictly from `audioContext.currentTime` and `params.bpm` for unit tests and offline harnesses)

---

## 3. Musical Timing Capability Model

Aether strictly rejects the "every node is a sequencer" anti-pattern. Timing awareness is an opt-in capability declared in `manifest.json`. Nodes are categorized into four distinct timing tiers:

### Tier 1: `not-tempo-aware`
- **Use Cases:** Static synthesizers, continuous drone generators, EQ/filters, waveshapers, reverbs, utility gains, manual touch instruments.
- **Contract:** Zero transport timers or tickers. Audio flows in response to incoming audio (`insert`) or direct user parameters.
- **Overhead:** 0% CPU overhead from musical clock synchronization.

### Tier 2: `ambient-generative`
- **Use Cases:** Evolving atmospheric pads, stochastic granular textures, probabilistic soundscapes (e.g. Bloom).
- **Contract:** Generative nodes start and stop with master transport (`start()` / `stop()`), but deliberately do **not** quantize to musical bars, beats, or steps. They produce unquantized continuous sound.

### Tier 3: `tempo-aware`
- **Use Cases:** BPM-synced delays, flangers, tremolos, clocked LFO modulators.
- **Contract:** Modulate rate, filter periods, or delay buffers based on `snapshot.bpm` or musical subdivisions (e.g. 1/4 note, dotted 8th). Do **not** require strict phase alignment or downbeat locking.

### Tier 4: `phase-grid-aware`
- **Use Cases:** Drum machines, step sequencers, arpeggiators, rhythmic pattern generators (e.g. TickTok, F*EM).
- **Contract:** Must derive musical coordinates and step boundaries directly from Aether's master clock snapshot. Must maintain absolute phase alignment with Aether's transport origin across starts, stops, pauses, resumes, and hot insertions.

> **Guideline for Agents:** Default to `not-tempo-aware` unless the node specifically requires time-based modulation or sequencing. If only BPM is needed, choose `tempo-aware`. Choose `phase-grid-aware` only for sequencers and clocked rhythm generators.

---

## 4. Master Transport & Lifecycle Contract

Production nodes must strictly implement the standard Aether Node V2 lifecycle.

### 4.1 Lifecycle State Table

| Host Event / Method | Node DSP Expected Behavior | Audio Output Contract |
| :--- | :--- | :--- |
| **`init(ctx, host)`** | Create Web Audio nodes, allocate buffers, compile worklets. **Never begin event scheduling.** | **Complete silence** |
| **`start(snapshot)`** | Anchor musical step pointer to `snapshot.beatsElapsed` (or origin if 0.0s). Launch lookahead scheduler. | Active playback (in-phase) |
| **`stop()`** | Cease musical scheduling, silence/stop node-owned active playback, cancel pending timers (`clearTimeout`). Do not treat the node's internal state as the authority on transport state or position. | **Complete silence** |
| **Hot Insertion** | If transport is running, query `snapshot`. Align next event to the next immediate step boundary. | Active playback (instant phase lock) |
| **Removal / Replacement** | Cancel all timers, disconnect all AudioNodes, dereference audio buffers. | **Complete silence** |
| **`dispose()`** | Full resource cleanup. Unregister listeners, clear timeouts, disconnect graph. | Disposed / Silent |

### 4.2 Unified `stop()` Semantics
In Node V2, `stop()` has simple, singular semantics:
- **Cease musical scheduling:** The node halts its lookahead event loop immediately.
- **Silence active playback:** All active voice triggers or sustained playback owned by the node are stopped/silenced.
- **Cancel timers:** Clear any pending `setTimeout` or `requestAnimationFrame` handlers.
- **No private transport state:** The node does not maintain distinct internal logic for Pause vs. Stop/Reset. Transport state, playback position, and rewinding to origin are the exclusive responsibility of Aether's master transport, which supplies the authoritative musical coordinates via `start(snapshot)`.

### 4.3 Invariants Verified by Patient Zero
1. **Silent Initialization:** `init()` must produce complete silence. Calling `init()` while transport is stopped or paused must never trigger audio clicks, bursts, or background sequencers. Audio leakage on init is a critical defect.
2. **Deterministic Hot Insertion:** When a phase-aware node is inserted into an already playing session:
   $$\text{targetStep} = \max\left(0, \lceil \text{snapshot.beatsElapsed} \times 4 - 10^{-6} \rceil\right)$$
   The node immediately calculates the upcoming step and joins the running musical grid in-phase. It must never start at Step 0 of its own private timeline.
3. **Zero Cumulative Resume Drift:** Repeated Pause and Resume cycles must exhibit zero cumulative phase divergence. The master clock's `beatsElapsed` is the single source of truth.

---

## 5. Scheduling Architecture & Principle of Separation

Patient Zero demonstrated that robust Web Audio timing requires a strict separation of three distinct timing domains:

```
[Aether Master Clock Snapshot]  -->  Musical Coordinate Space (beats, bars, steps)
           |
           v
[Web Audio audioCtx.currentTime] -->  Hardware Sample-Accurate Event Scheduling
           ^
           |
[JavaScript Lookahead Timer]     -->  Scheduler Wakeup Trigger ONLY (e.g. ~25-50ms tick)
```

### 5.1 Three-Domain Principles
1. **Musical Coordinate Space (Master Clock):**
   - The master clock snapshot determines what musical step or beat corresponds to session playback time.
   - Nodes must never maintain an unanchored private incrementing clock (`this.step++` running independently).
2. **Audio Event Timestamps (`audioCtx.currentTime`):**
   - All audio triggers, oscillator starts, and AudioParam ramps must be scheduled against `audioCtx.currentTime`.
   - Mathematical anchor for step scheduling:
     $$t_{\text{zeroCtx}} = \text{snapshot.audioCtxTime} - \text{snapshot.transportTime}$$
     $$t_{\text{event}} = t_{\text{zeroCtx}} + (\text{stepIndex} \times \text{secondsPerStep})$$
3. **Scheduler Wakeup (`_tick()` loop):**
   - The JavaScript timer (`setTimeout` or `requestAnimationFrame`) is purely a wake-up mechanism to look ahead into the future (typically 100ms–150ms window).
   - Jitter in the JS timer does not affect audio playback timing because events are queued ahead of time in the Web Audio hardware thread.
   - **Drift Recovery:** If the JS thread is blocked or delayed, the scheduler clamps `nextStepIndex` to the live step:
     $$\text{currentLiveStep} = \left\lfloor \frac{\text{nowCtx} - t_{\text{zeroCtx}}}{\text{secondsPerStep}} \right\rfloor$$
     $$\text{nextStepIndex} = \max(\text{nextStepIndex}, \text{currentLiveStep})$$
     This guarantees expired events in the past are dropped rather than bursting simultaneously.

---

## 6. Node-Local Swing & Groove Principle

Patient Zero established the rule for rhythmic swing and micro-timing:

- **Local Modification Only:** Node-local swing offsets individual audio events relative to Aether's straight master grid.
- **Non-Accumulating Timing:** Swing must **never** modify, delay, or accumulate the underlying musical clock or transport position.
- **Mathematical Form:**
  $$\text{secondsPerStep} = \frac{15}{\text{BPM}} \quad (16\text{th-note subdivision})$$
  $$\text{isOddSubdivision} = (\text{stepIndex} \pmod 2 === 1)$$
  $$\text{swingOffset} = \text{isOddSubdivision} \times (\text{secondsPerStep} \times \text{grooveFactor})$$
  $$t_{\text{event}} = \max(\text{nowCtx}, t_{\text{base}} + \text{swingOffset})$$
- By anchoring $t_{\text{base}}$ to the absolute straight grid on every step, groove never causes tempo drift.

---

## 7. Parameters, State & UI Contract

### 7.1 Parameter Access Contract
- Every parameter declared in `manifest.json` must have a deterministic identifier.
- Nodes must implement deterministic getters and setters:
  - `setParameter(paramId: string, value: number): void`
  - `getParameter(paramId: string): number`
- **Silence During Edit:** Editing parameters while transport is paused or stopped must update internal state silently without triggering audio audition hits, unless an explicit audition button is triggered by the user.
- **Session Serialization:** Parameters must be fully JSON-serializable to enable instant project save and restore without audio glitches.

### 7.2 UI Communication Contract
- The inspector UI (`ui.html`) runs inside an isolated iframe.
- Parameter edits in UI dispatch postMessage events to the host:
  ```javascript
  window.parent.postMessage({
    type: 'aether:param-change',
    paramId: id,
    value: numericValue
  }, '*');
  ```
- Host updates to the UI arrive via incoming postMessage:
  ```javascript
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'aether:param-update') {
      const { paramId, value } = event.data;
      // Update UI control
    }
  });
  ```
- Visual transport feedback in the UI inspects `window.parent.studio.getClockSnapshot()` inside `requestAnimationFrame` loops, keeping UI rendering completely decoupled from DSP.

---

## 8. Resource Disposal Contract

Every node DSP class must provide an explicit `dispose()` method:
1. Call `this.stop()` to cancel all active timers (`clearTimeout(this.timerId)`).
2. Disconnect and dereference `this.outputNode` and any internal `AudioNode`s.
3. Dereference large audio buffers or cached data arrays (`this.noiseBuffer = null`).
4. Terminate any internal Web Workers or AudioWorklet ports.
5. Nullify references to `this.ctx` and `this.host`.

---

## 9. Verification & Reference Implementation (Patient Zero)

The reference implementation validating this specification is **TickTok V2** (`nodes-v2/tick-tok/`):
- **Automated Verification:** Verified by `tests/test-ticktok-v2.js` across 9 regression tests covering dual-node phase sync, hot insertion, pause/resume stability, and silent init.
- **Manual Verification:** Listened and confirmed running live inside Aether 5.1.1 Codex-AGY desktop application with sample-accurate transient coherence.
