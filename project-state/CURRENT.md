# Current state — verified 2026-09-29

## Where we are

There are two divergent development lines. Neither a larger version number nor a newer folder timestamp proves that one contains the other's improvements.

- **Newest inspected feature source:** canonical checkout, branch `feature/weave-functional`, application commit `3ab6e22` (2026-09-28). Product version still **5.1.1 Codex-AGY**. New work is the Weave interface and scene editing.
- **Newest installed packaged app found:** `/Applications/Aether 6.0 Codex.app`, version **6.0.0**, built September 26. Its source is the separate, unversioned `aether-codex-6` directory. Do not overwrite or delete it.
- **App running during audit:** `target/debug/aether-desktop`, working directory canonical `desktop/src-tauri`. This is the Weave development workspace, not the installed 6.0 app. Process identity is a point-in-time observation.
- Canonical release bundle **Aether 5.1.1 Codex-AGY.app** dates September 28 00:06, before later Weave commits. It is not evidence of a packaged latest Weave build.

## Verified in current Weave source

- Anchored play/pause transport and clock snapshot API exist.
- Native project save and save-to-path use atomic project replacement.
- TickTok v2 and a node-v2 template/contract exist.
- Weave captures spatial scenes; selecting a scene applies positions to live tracks.
- ADJUST/DONE and swipe deletion are implemented, with regression tests.
- Nodes were enlarged a further 15% in commit `f9470e2`.

## Weave is still a prototype

- Automatic advancement and GO NOW advance the interface but do not perform the intended audio scene recall.
- Its timer uses animation-frame elapsed time and BPM instead of the host clock snapshot.
- JUMP/MORPH/FADE and curve displays do not yet implement the promised transitions.
- Weave scenes are absent from project serialization; they are not yet preserved by .aether save/load.
- Selection changes live sound; Preview is not isolated audition.
- Existing motion automation can overwrite recalled scene positions.
- Production frontend copy command omits Weave CSS and fonts. Current development appearance does not prove release packaging is complete.

See [the Claude audit](audits/CLAUDE-WEAVE-2026-09-29.md) for further candidates. Its remote/workspace observations are superseded by this local audit: `night` is configured, and local Rust checks are available.

## Separate 6.0 work to preserve and reconcile

Its September 26 handover describes cleaner UI, sample Details/queue/seek improvements, independent sample playback positions, reduced hidden-panel drawing, and editable Icecast connection guidance. Local tests confirm nine covered playback/frontend cases pass. Inspection confirms a dedicated frontend builder and configurable native Icecast connection code, bounded socket connection attempts and worker cleanup. This does not establish that all these changes exist in the Weave branch, or that live streaming is fully validated.

## Checks run in this audit

Canonical checkout:
- `node tests/test-ticktok-v2.js` — 9 passed.
- `node tests/test-weave-spatial-recall.js` — passed.
- `node tests/test-weave-swipe-gesture.js` — passed.
- `cargo check --locked --offline` from `desktop/src-tauri` — passed.

Separate 6.0 folder:
- `npm test` — 9 passed.

These are targeted JavaScript tests (including mocked host/audio behavior) and Rust compilation. No listening test, sustained CPU benchmark, native save roundtrip, live Icecast broadcast or eight-hour scheduler soak was performed. No app was restarted and no application code was changed during this audit.

## Git backup at audit start

`origin` is `micmate-wq/aether-desktop`. Remote `feature/aether-core` was at `b55ee2d`; `codex/stabilization` at `171c09f`. `feature/weave-functional` was absent remotely. `night` points to `micmate-wq/Night`; its HEAD lookup returned no ref. Use existing Aether origin for this handoff. Publication outcome is recorded in ACTIVITY.md.

Old `HANDOFF-2026-09-27.md`, `AETHER_CORE.md` and `WEAVE-DECISIONS.md` remain historical/design references, not a verified current completion checklist.
