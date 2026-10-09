# Aether animation integration

The workshop calls `desktop/node-art.js` directly. No renderer copy, Three.js dependency or audio engine is involved. The six ideas deliberately reinterpret the 3D studies rather than reproduce them exactly.

## Export contract

Copy or download the JSON fragment and merge its `canvas_animation` property into the existing node's manifest. Preserve id, entry, DSP, parameters and all other properties. This is not a complete `.aethernode` package. Track colour is supplied by the host and is not exported. Energy and detail are static visual settings here, not audio-reactive bindings.

`AetherNodeArt.draw(ctx, {x, y, radius, color, time, settings})` expects pixel coordinates/radius and time in milliseconds. Draw the artwork first, then the opaque node centre so ornament can emerge from behind it. Preserve host selection, gear and interaction rendering. The current host adds 6px to its visual radius for ornament; the workshop does the same.

## Compatibility as inspected

- Codex stabilization `desktop/index.html` accepts `canvas_animation.type: "art"` with arbitrary registered families. The six exported families already exist there: ribbons, contour, cinders, filaments, shards, constellation.
- The separate Antigravity host's dispatch currently restricts its shared-art branch to bloom/sticky-related manifests, despite the renderer supporting the six families. These JSON fragments alone will not activate that branch there. A focused host change is still required: include `animType === 'art'` in that outer shared-art condition, keep its existing loaded/playback gate and fallback branches, and validate the requested family against `AetherNodeArt.types`. Do not relabel another family as bloom to bypass routing.
- No host changes were made in this task. Installed apps do not update from these files. Verify a test node in the intended host before distributing it.

## Design choices

Quiet orbit reduces the spherical cage to sparse tilted ribbons. Soft pulse uses irregular breathing contours. Drifting grains replaces a dense particle cloud with cinders. Magnetic feelers uses asymmetry and moving tips. Broken orbit preserves fracture rhythm using interrupted arcs. Pixel Spores remains a separate digital texture.

Judge at 18px as well as enlarged size; keep motion subordinate to node identification. Check four nodes at once, both themes, overlap/drag, pause/resume and host frame cost. The workshop is not a native performance benchmark. Saved variations are local to this browser/origin. Export is portable JSON; it does not save DSP or assets.
