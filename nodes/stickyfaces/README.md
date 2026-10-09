# stickyfaces

Canvas-facing AetherNode UI experiments — sticky-note fill, Swiss grid type, real track telemetry.

Always **Aether** / **AetherNodes**.

## Use case (v0)
**Sticky Pad** — sample / pad face on the 2D canvas. Canary yellow sticky fills the whole circle. Shows live:
- Track slot as `T1`…`T4` (host track index, not a fake label)
- Sample / source name when known
- Playback time **or** BPM (whichever the host actually exposes for that slot)
- Mode tag (`SMPL` / `PAD` / `LOOP`) from real state

Visual language from Boss Bruh + Matt mocks in `refs/`.

## Layout
- `refs/` — approved circular mockups
- `sticky-pad/` — live node source
- Packed: `../sticky-pad.aethernode`

## Load
1. Cmd+R Desktop (picks up sticky face host hook in `desktop/index.html` + `node-art.js`)
2. Load / drop `nodes/sticky-pad.aethernode` onto a track pad
3. Orb should fill canary yellow with `AETHERNODE` / `T#` / source / timer-or-BPM / mode / `MIX`

## Host hooks (minimal, uncommitted)
- `desktop/node-art.js` — `sticky` art family (outer chrome)
- `desktop/index.html` — `_stickyFaceSettings` / `_stickyTelemetry` + canary orb face draw

## Direction note (2026-09-22, Matt)
Sticky Pad on the **canvas orb** was useful as a probe, not the intended product.

**Keep exploring:** when you open a **sample** (not only an AetherNode effect/player), show an enlarged AetherNode-style face with real info (track, name, time/BPM, mode) — historically plain samples did not open a control window; only loaded AetherNodes did.

Orb sticky face = experiment. Sample-open enlarged face = the thread to pursue next.
