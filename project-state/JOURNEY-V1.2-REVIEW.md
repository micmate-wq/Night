# Journey v1.2 review — 6 October 2026

Source: Journey Lab checkout, v1.1 baseline `33f2e4c`. The initial checkout was clean.

## What Antigravity did

Added a direct JourneyEngine using live AudioBuffers and captured track objects, two side panels, a status strip, and an animation-frame transport. Sample changes use outgoing/incoming GainNodes with sine/cosine curves. Cleanup tracks the outgoing sources. The existing host continues to provide DSP, rendering and transport. This is a substantially smaller orchestration layer than the retained Claude Weave model/assets/import/session system; that is a plausible explanation for the quick feel, not a measured CPU comparison. Both engine families remain in the folder, but the page loads Journey rather than weave.js.

The v1.1 commit also bundled earlier Claude code, tests and evidence (71 changed files); it was not solely a Journey patch. Version metadata was inconsistent: Cargo still said 5.1.1, npm lockfile 3.0.0.

## Findings to carry forward

- States and arrangement exist only in memory; ordinary .aether save does not serialize Journey. Reloading loses them.
- Timing uses requestAnimationFrame elapsed time and discards excess time at phase boundaries. It is not host-clock/bar-grid scheduling and needs background/native checks.
- Bundle recalls are asynchronous without cancellation/version guards. Stop or another recall can race a pending instrument load. Pause during a fade cleans the sources but does not reconstruct the remaining fade on resume.
- The fade overlaps different sample buffers; it is not a general two-instrument crossfade. The sine/cosine identity concerns envelope weights, not a guarantee of constant perceived loudness or acoustic power with correlated material.
- Empty captured sample slots do not explicitly unload the previous sample. Imported track fallback and parameter names need targeted roundtrip validation.

These are review findings, not claimed fixes in this interface release. Keep the small playable experiment; address persistence and recall/transport ownership before using it as a long-running broadcast tool.

## v1.2 scope

Removed fixed workspace zoom and replaced it with a fluid three-column grid. Window resizes from 960×600 upward. Side lists scroll independently; header wraps below 1250px. Canvas redraws immediately on resize. Simplified card surfaces, typography, controls and focus feedback, kept the cross-grid in the arena and node colours. Space repeat is ignored; arrangement length includes ending fade and updates when it changes. Version identity is consistent across npm, Cargo, Tauri and launcher. No DSP architecture rewrite.
