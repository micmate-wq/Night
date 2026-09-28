# Aether Weave: design handoff v0.1 (approved mockup E: BUILD / PLAY)
- `WEAVE-DESIGN-SPEC.md`: the design spec (type, colour, layout, states, motion, keyboard, components). Values are tagged observed, estimated or suggested.
- `weave-tokens.json`: machine-readable tokens, each with a value and status.
- `weave-tokens.css`: the same tokens as `:root` custom properties (`--aether-*`).
- `reference/*.png`: approved renders at 1440×900 (build, play, mid-switch, crowded play, channel-strip overlay).
- `reference/e-toggle.html` + `shared/`: runnable mockup. Run `cd reference && python3 -m http.server`, then open `/e-toggle.html` (add `?mode=play`, `&crowded=1` or `?p=0.3`).
- Fonts: Inter Tight and Geist Mono, both SIL OFL 1.1.

Workflow: the spec describes the design only. Antigravity inspects the Aether codebase and implements Weave with its existing architecture, components and styling. Map tokens to existing ones where they match, and don't redesign the canvas or channel strips.
