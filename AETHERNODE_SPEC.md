# .aethernode Modular Plugin Specification

> **Status:** Draft / Iterative. Interface contracts define baseline expectations but can adapt to experimental DSP and visual needs.

## 1. Overview
An `.aethernode` is a self-contained audio/visual instrument, effect, or kinetic controller that runs inside the Aether host canvas. Each node marries its own Web Audio DSP graph with dedicated HTML5 Canvas 2D rendering.

## 2. Typical Node Structure
- `manifest.json`: Human-readable identifier, name, node category (generator, effect, modulator), and exposed parameter definitions.
- `dsp.js`: Web Audio node graph construction, custom synthesis logic, or worklet routing.
- `ui.js`: Visual footprint, responsive touch/pointer handling, visualizers, and state animations.

## 3. Node Lifecycle Hooks
Nodes should expose predictable hooks for clean host lifecycle management:
- `init(audioCtx, options)`: Creates audio nodes, connects DSP, and returns connection endpoints (audio input/output).
- `updateParams(key, value)`: Smoothly modulates parameters in real time without audio clicks or thread locks.
- `render(ctx, state)`: Lightweight 2D canvas drawing routine executed inside the host animation loop.
- `destroy()`: Disconnects audio nodes, clears memory references, and prevents audio thread leaks.

## 4. Development Principles
- **Lean Vanilla Modules:** Rely on modern JavaScript and standard browser Web APIs. Avoid heavy external node_modules or bloated runtime dependencies.
- **Thread Separation:** Keep CPU-heavy canvas drawing isolated from audio calculations.
- **Safety First:** Adapt gracefully to the host's current sample rate and dynamic frame rates.
