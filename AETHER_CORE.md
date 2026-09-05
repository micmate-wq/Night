# Aether Host Architecture & Core Context

> **Status:** Active development / Living prototype. Specifications are subject to creative evolution and iterative refinement.

## 1. System Vision
Aether is an experimental desktop audio-visual canvas where sound generators, modulators, and processors exist as interactive 2D graphical nodes. Instead of traditional linear DAW tracks, audio paths and modulations are shaped dynamically by spatial placement, physical interaction, and flexible graph wiring.

## 2. Technical Stack
- **Host / Window Runtime:** Tauri (Rust backend for lightweight native window management, file operations, and platform performance).
- **Audio Engine:** Standard Web Audio API (`AudioContext`, custom `AudioWorkletNode`, spatial panning, gain routing).
- **Display Layer:** HTML5 Canvas (optimized 2D rendering loop), minimal DOM overlay, vanilla ES6+/TypeScript modules.
- **External Interfaces:** Optional local WebSocket server for live MIDI/OSC or hardware controller streams.

## 3. Core Engine Responsibilities
- **AudioContext Lifecycle:** Owns the single master clock, audio context, and master output bus.
- **Node Management:** Discovers, validates, instantiates, and unmounts dynamic `.aethernode` modules.
- **2D Spatial Audio Graph:** Connects node outputs to destination inputs with spatial attenuation based on distance on the visual plane.
- **Dynamic Adaptability:** Architected to stay lean; avoid rigid global state singletons and heavy external dependencies.

---
