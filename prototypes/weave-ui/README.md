# Weave visual playground

Open `index.html` directly in a browser. No build, installation or server required. Optional: from this folder run `python3 -m http.server 3471`, then open http://localhost:3471.

All state is disposable and resets on reload. No production scripts, audio, storage or project schemas are connected. Google Fonts is optional; system fonts work offline.

- A: compact cards foreground names, durations and node contents.
- B: miniature channel surfaces with frozen fader marks suggest captured configurations.
- C: a quiet connected spine reveals names and contents on selection.

Switch concepts without losing Scenes. The count selector resets to 1, 4 or 12 dummy Scenes. Capture appends; the bottom editor renames, changes duration or deletes the selection. The right surface describes the following Scene, with editable dummy controls. The last Scene explicitly ends the sequence.

Four coloured toolbar buttons and canvas nodes toggle channel overlays: channels 1/2 cover the upper/lower left; 3/4 cover the upper/lower right. Close individually or press Escape to reveal the underlying layer. Selection, edits and scroll position survive overlays.

Visual reference: `desktop/index.html`, especially its theme tokens, compact toolbar, channel-strip styling and final fixed-workspace overrides. Imitates its exact four track colours, near-white/dark surfaces, Space Grotesk / Inter / JetBrains Mono typography, rounded strips, subdued shadows, knobs and dotted spatial field. This is a small independent HTML/CSS/JS study; controls and canvas are illustrations, not copied application logic.

Layout: retains the production 912 × 760 canvas and 1424 px workspace. Narrow windows scroll horizontally instead of shrinking the instrument; short windows scroll vertically. Scene lists scroll independently at high counts. Fully opened channel pairs deliberately obscure the whole underlying side; individual strips let you judge partial coverage. The fixed-width side areas constrain long names (ellipsis); the editor exposes the full name. No final concept is chosen.
