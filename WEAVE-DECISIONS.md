# Weave Implementation Decisions & Architecture Record

## 1. Implemented Behaviour
- **Dual-Mode Left Gutter (Weave Panel):**
  - **Mode Toggle:** Seamless BUILD / PLAY switcher with animated sliding ink block, inverted text contrast, and dedicated `Tab` keycap trigger.
  - **BUILD (Loom View):** Renders all scenes stacked vertically, proportional to bar length. Dynamic node thread ribbons with lane centers ($x = 172, 202, 232, 262\text{px}$), linear tapers across transitions, and alternating weave over/under occlusion logic across black scene bars ($7\text{px}$ standard, $4\text{px}$ crowded). Live playhead sweeping down the active scene with real-time bar tag ($58\times18\text{px}$). Bottom footer with `+ Scene` capture button and total project bars/time.
  - **PLAY (Set List View):** Renders a tactile paper sheet tilted at $-0.8^\circ$ with a top tape strip ($2.5^\circ$ angle, $\#efe3a6$ at $0.9$ opacity) and soft offset drop shadow. Displays large $60\text{px}$ ($48\text{px}$ compact) countdown timer, NOW badge with marquee scene name, node mix bars, scene progress bar, struck-through past scene titles ($0.45$ opacity), and upcoming rows with node track color ticks.
- **Dual-Mode Right Gutter (Transition Panel):**
  - **BUILD Mode:** Shows From $\to$ To scene names, functional SVG crossfade diagram with shaded overlap zone and live sweeping playhead, logarithmic length slider ($1, 2, 4, 8, 16, 32\text{b}$), 3 curve buttons (linear, ease, late), JUMP/MORPH/FADE segmented mode control, and a $112\times112\text{px}$ spatial morph mini-map with position glides and Preview trigger.
  - **PLAY Mode:** Stripped live performance view showing Next scene name, $76\text{px}$ mono "bars to go" counter, 4 active/inactive beat blocks, read-only fade diagram, and full-width $30\text{px}$ `GO NOW` and `HOLD` action buttons.
- **Transport & Keyboard Controls:**
  - `Tab`: Toggles between BUILD and PLAY views.
  - `Space`: In PLAY mode, immediately triggers `GO NOW` to advance to the next scene.
  - `H`: In PLAY mode, toggles `HOLD` on the active scene, looping it and preventing automatic progression.
  - `GO NOW`: Instantly advances transport to the start of the next scene.
  - URL parameter: Supports `?mode=play` for direct deep-linking into the Set List view.
- **Channel Strip Coexistence:**
  - Preserves existing channel strips with elevated `z-index` so opening a channel strip overlays the gutter without interrupting underlying Weave playback.
  - Adds the approved footer note with dashed rule: `WEAVE CONTINUES UNDER [range]`.

## 2. Simplifications
- **Shared Transition Configuration:** For this initial prototype, a single shared transition configuration (length, curve, mode) is maintained across scenes rather than per-transition serialization.
- **Linear Schematic Tapers in Loom:** Transition tapers in the Loom view are rendered as linear geometry even when nonlinear curves (ease, late) are selected in the inspector.
- **Position Glide Mockup in Morph Map:** Mini-map node coordinates use deterministic spatial points for visualization.

## 3. Visual Deviations from Reference Mockups
- **Canonical Node Track Colors:** Preserved Aether's canonical CSS track colors (`--track-1: #FC4037`, `--track-2: #FFEA00`, `--track-3: #8B68B9`, `--track-4: #00D600`) as instructed, rather than replacing them with generic Grok mockup colors.
- **Pale Warm Playing Scene Background:** Used a pale warm surface (`#fdf6dc`) for the playing Loom band instead of saturated T2 canary yellow, ensuring strong legibility and distinct contrast against Track 2 while reserving punchy yellow for the NOW badge.

## 4. Deferred Functionality
- **Deep Scene Audio Persistence:** Scene captures (`+ Scene`) instantiate new scene nodes within the Weave runtime model. Deep persistence into `.aether` session project bundles is cleanly decoupled and deferred to preserve stability.
- **Channel Strip Range Detection:** The channel strip footer note currently displays static representative ranges (`01–03`, `04–07`, `TRANSITION`) based on strip quadrant position. Dynamic calculation based on live DOM intersection is deferred.

## 5. Assumptions for Playtest Review
- **Tab Key Interception:** Tab is bound to mode toggle when focus is outside text inputs; evaluate whether `T` or another key should be supported if keyboard-centric canvas workflows require native Tab navigation.
- **HOLD Toggle Semantics:** HOLD prevents progression at the scene boundary while allowing the transport to freely play and loop the active scene.
