# Aether v1.3 — consolidation brief and agent handoff

Prepared 7 October 2026. This is a strategy and implementation brief, not evidence that v1.3 has been built.

## 1. Project and environment

Matt wants a coherent, responsive, expressive four-track spatial instrument that can be packaged and given to a few people. He values Antigravity's direct, playable approach, GrokBot's visual character and Codex's clarity. Do not combine three complete implementations. Choose behaviours deliberately and keep one working implementation.

Working baseline:

- Checkout: `/Users/matt/Documents/Codex/2026-10-04/referenced-chatgpt-conversation-this-is-an/work/aether-journey-v01-lab`
- Branch: `feature/weave-v01`; verified HEAD `e7f9bca`, tag `v1.2`. `v1.1` is `33f2e4c`.
- Source tree was clean at this planning turn. Recheck before editing.
- Stack: Tauri/Rust, vanilla JavaScript, Web Audio, Canvas 2D, CSS. Keep it.
- Frontend: `desktop/index.html`; Journey UI/engine: `desktop/journey.css` and `desktop/journey.js`.
- Native code/config: `desktop/src-tauri/`. Launcher: `launch-journey-v01.sh`.
- Development URL: `http://localhost:3472/desktop/index.html`. Check existing processes before launching; never kill unrelated apps or servers.
- v1.2 identity: `com.aether.desktop.journey-v1-2`, version `1.2.0`.
- v1.2 app: checkout root `Aether Journey v1.2 Lab.app`; build copy under `desktop/src-tauri/target/debug/bundle/macos/`. It is a local debug bundle, not an established distribution release.
- Canonical Aether checkout: `/Users/matt/.gemini/antigravity/scratch/aether`. It has unrelated uncommitted work. Do not substitute it for this Journey baseline or alter it to implement this brief.

Read `AGENTS.md`, `project-state/README.md`, CURRENT, WORKSPACES, GOALS, PROTOCOL and `JOURNEY-V1.2-REVIEW.md`. These files contain inherited history: the newest Journey entries and actual code take precedence. Older Weave/Claude plans are references, not requirements to reintroduce everything.

## 2. What is approved, and what is proposed

**Matt's direction:** use the simple playable approach; unify the interface; make the 2D canvas more prominent; eliminate wasted space, conflicting fonts/buttons/behaviours and accidental overlaps; retain the best features; move toward a packaged usable app. Provide a portable handoff.

**Stable instrument constraints:** four persistent track slots, x = pan, y = volume, existing depth behaviour, distinctive animated nodes and track colours. Clearing a sound should preserve useful movement/channel settings. Preserve user material and prior snapshots.

**Recommendations below are proposed choices, not claims that Matt has approved every feature restriction.** The immediate next step is a bounded layout comparison, then selection and consolidation. This planning turn does not authorize a whole engine rewrite, publishing, or deleting old development lines.

## 3. Product boundary for the first usable build

The basic loop is: open app → load sounds → play and move nodes → capture two states → arrange and play them → stop reliably → save → reopen and continue.

Keep visible: transport, master level, four track selectors, project open/save, capture and access to Journey. Avoid two separate visible transports with unclear ownership. Define one transport behaviour whether invoked by Space or a button.

Keep reachable: source loading, gain/EQ, mute/solo, motion recording/playback, clear sound, state naming/removal/reordering and Stay/Travel settings. Present detailed controls on demand rather than permanently consuming canvas width.

Proposed initial Journey scope: states of the same four loaded sources, with positions and supported channel settings; JUMP and MORPH first, FADE retained only where its actual source/envelope behaviour is dependable. Do not label a position morph as an instrument crossfade. Sample replacement can be added where verified. Arbitrary instrument swaps require preparation and cancellation rules before becoming a promised feature.

Park outside the primary workspace: live streaming setup, live input configuration, loudness matching, deep instrument editing, broadcast scheduling and experimental scene modes. Hiding these from the default view need not delete their code or existing project support. Matt may choose a different priority after playing the prototype.

## 4. Visual direction

A blank canvas means a clean, intentional starting instrument; it does not mean blank white styling or erasing Aether's personality.

- The canvas is the dominant surface. Panels open because the player needs them.
- One UI font family, one deliberate numeric treatment, a small type scale and consistent labels/capitalization.
- One spacing scale, button sizing system, border/radius treatment and interaction vocabulary.
- Near-white and charcoal surfaces, graphite controls, track colour used meaningfully. Preserve animated node character and the arena grid where it helps orientation.
- Compact status information belongs with transport or a small canvas edge strip; avoid a full-width banner consuming space for idle text.
- No invisible panels reserving large empty columns when Journey is off. No accidental overlap, cropped content or permanent duplicate controls.
- Preserve useful padding, separation and readable pointer targets. “No gaps” means no wasted layout regions, not zero spacing everywhere.
- A panel covering the canvas is a deliberate, dismissible interaction state; keep nodes controllable and avoid covering the active interaction.

Build two reversible layouts with identical behaviour and source data:

**A — Canvas first (recommended):** compact top bar, near-full canvas, one selected-track inspector, Journey opened on demand in a compact rail/drawer.

**B — Compact Journey rail:** compact top bar, large canvas, narrow Journey rail while arranging, state collection opened on demand. Compare information density and editing comfort against A.

Use one prototype setting or a separate prototype file, not two engines or independently evolving apps. Compare at laptop size and 960×600 as well as larger windows. Matt should load sounds, drag nodes and arrange two states in both before selecting.

## 5. Functional findings that affect usability

v1.2 verification covered browser layouts at five sizes, basic transport/MORPH and channel panels; JavaScript/shell checks and a debug Tauri build passed. Native listening, instrument-import roundtrips, long background playback and CPU comparisons were not performed. A simpler orchestration layer plausibly explains the quick feel; it is not a performance measurement.

Known findings in the current source:

- Journey states/steps are in memory and absent from normal project serialization. Reload loses them.
- Journey time uses animation-frame elapsed time and discards excess time at phase changes. It is not host-clock scheduling.
- Asynchronous bundle recall lacks Journey cancellation/version guards; stale work can arrive after Stop or another recall.
- Pause during a fade cleans temporary sources without reconstructing the remaining fade on resume.
- Empty captured sample slots do not explicitly unload a previous sample.
- FADE overlaps differing sample buffers; it is not a general two-instrument crossfade. Sine/cosine envelope identities do not promise constant perceived loudness.

Also verify master volume zero is respected, source cleanup is complete, failures leave the previous playable state intact, and unsupported imported sources are reported honestly. These are focused product checks, not a mandate for a new architecture.

## 6. Execution sequence

1. **Protect and inventory.** Recheck Git/workspaces/processes. Preserve v1.2 and unrelated changes. Identify what the page actually loads. List visible controls as keep, reveal on demand or park. State a short plan and continue within Matt's authorized scope; do not invent repeated approval gates.
2. **Make the layout comparison.** Change presentation first. Reuse existing handlers/audio. Show the two real layouts and describe their tradeoffs. Let Matt choose before turning one layout into the final v1.3 interface.
3. **Consolidate the chosen layout.** Replace conflicting layout/typography/button rules with a coherent active stylesheet. Avoid piling another broad override layer onto years of CSS. Remove active duplicate behaviour only after checking callers; archive history without destroying it.
4. **Make the core loop dependable.** Add versioned Journey project persistence with embedded/referenced assets handled deliberately; preserve older project compatibility. Fix empty-slot recall, stale async work and transport/source cleanup. Tie phase accounting to a dependable clock; keep rendering separate. Scope changes narrowly and verify each.
5. **Package and playtest.** Build the production app from the exact source snapshot. Open it without the development server. Verify resources and project roundtrip in that packaged app, and test sharing on another Mac before claiming it is ready for recipients. Check current signing/distribution requirements when actually preparing that step.

v1.3 is an internal development milestone. It need not determine the public release number. Decide public branding/version only when the usable packaged baseline passes the checks.

## 7. Completion criteria

- The chosen interface has one visual language and predictable interactions. Canvas gains the space vacated by closed controls.
- All four nodes and essential controls remain usable at supported window sizes, with no unintended clipping/overlap; scrolling belongs to the active panel.
- The core loop works with two states and four sources; repeated Stop/Pause/Resume and source removal do not leave stray sound.
- Save, quit and reopen restores the supported sources, settings, motion, states and Journey order/timing. Missing/unsupported material produces a clear outcome, never false success.
- Foreground/background playback is checked in the native app. Measure CPU under the same sound/project before and after rather than inferring performance from lines of code.
- The packaged app launches without a development server and contains its required DSP/fonts/node resources. Record exact source commit, build type, app path and validation limits.
- Update shared state and preserve the chosen source snapshot. No unsolicited push, install, publication or removal of other apps.

## 8. How the next agent should begin

Report the verified checkout/HEAD and any unexpected changes. Propose the smallest layout experiment using the existing Journey engine. Start with the recommended canvas-first layout and one compact-rail comparison. Do not bring back the full Weave architecture just because its files are present. Carry the working audio forward, preserve Aether's visual character, and judge success by the playable core loop.
