# Aether Node V2 Starter Template

This directory provides the official starting template for building **Aether Node V2** audio modules (instruments, generators, and insert effects).

It adheres strictly to **Aether Node Manifesto v1.0** and the timing/lifecycle contracts validated by Patient Zero (`tick-tok`).

---

## 1. Quick Start: Creating a New Node

1. Copy this `_template` folder to a new folder under `nodes-v2/` (e.g. `nodes-v2/my-synth/`).
2. Update `manifest.json`:
   - Set a unique reverse-DNS `id` (e.g. `com.aether.node.my-synth`).
   - Define your node's `name`, `role` (`instrument` or `insert`), and `timingTier`.
   - Declare all controllable parameters in `parameters`.
3. Choose your timing capability in `dsp.js` (see Section 2 below).
4. Implement your audio synthesis or effect graph in `dsp.js`.
5. Customize the tactile controls in `ui.html`.

---

## 2. Choosing Your Timing Tier

Do **NOT** force every node to be a step sequencer. Choose the minimal timing capability your node actually requires:

| Tier | manifest.json `timingTier` | Architecture in `dsp.js` |
| :--- | :--- | :--- |
| **Tier 1: Non-Tempo-Aware** | `"not-tempo-aware"` | **Omit the scheduler.** Remove `_tick()`, `nextStepIndex`, and `timerId`. Connect input/oscillators directly in `init()` and modulate via `setParameter()`. Zero CPU synchronization overhead. |
| **Tier 2: Ambient-Generative** | `"ambient-generative"` | Implement `start()` and `stop()` to fade or start/stop continuous generative textures or granular streams, without quantizing to musical steps or downbeats. |
| **Tier 3: Tempo-Aware** | `"tempo-aware"` | Read `snapshot.bpm` in `start()` or when parameters change. Scale delay times or LFO rates to musical fractions (e.g. `60 / bpm / 2`), without requiring downbeat locking. |
| **Tier 4: Phase-Grid-Aware** | `"phase-grid-aware"` | **Keep the included lookahead engine.** Derive step indices from `snapshot.beatsElapsed`. Anchor event timestamps against `audioCtx.currentTime`. |

---

## 3. Mandatory Architectural Invariants

Every production Node V2 must satisfy these five rules:

1. **Silent Initialization:**
   `init(ctx, host)` must allocate nodes and buffers, but **never start playback or event scheduling**. Audio leakage on instantiation is a critical defect.
2. **Clock Source of Truth:**
   Phase-aware nodes must derive musical position from `host.getClockSnapshot()`. Never run an independent unanchored step counter (`this.step++`).
3. **Three-Domain Separation:**
   - **Aether Master Clock:** Calculates musical position (`beatsElapsed`, `stepIndex`).
   - **Web Audio (`audioCtx.currentTime`):** Timestamp for hardware sample-accurate event triggers.
   - **JavaScript Timer (`setTimeout`):** Scheduler wake-up trigger only; timer jitter never affects audio timing.
4. **Deterministic Parameters & Silence on Edit:**
   All parameters must implement `setParameter(id, value)` and `getParameter(id)`. Modifying parameters while paused must not trigger preview hits.
5. **Clean Resource Disposal:**
   `dispose()` must cancel all `timerId` timeouts, disconnect all `AudioNode`s, and dereference internal buffers.

---

## 4. Packing for Distribution

When development of your node is complete, package it into a zip bundle with the `.aethernode` extension:

```bash
cd nodes-v2/my-node
zip -r ../my-node.aethernode manifest.json dsp.js ui.html
```

Aether automatically scans and loads `.aethernode` bundles from `nodes-v2/`.
