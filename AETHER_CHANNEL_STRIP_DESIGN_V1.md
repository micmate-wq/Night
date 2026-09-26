# Aether Channel Strip Design v1.0 Specification

> **Status:** Approved Checkpoint (26 September 2026)  
> **Reference File:** [desktop/aether-channel-strip-design-v1.0.html](file:///Users/matt/.gemini/antigravity/scratch/aether/desktop/aether-channel-strip-design-v1.0.html)  
> **Preview URL:** `http://localhost:3456/desktop/aether-channel-strip-design-v1.0.html`

---

## 1. Core Visual Principles ("Numbers Are Controls")
- **No Knobs or Sliders:** Traditional rotary knobs and horizontal slider thumbs are removed.
- **Draggable Numerals:** All parameter values are large, light-weight numerals (`Space Grotesk`, font-weight 300). Vertical dragging scrubs value up/down; double-click resets to default.
- **Micro-Labels:** Parameter names are set in tiny, spaced uppercase typography (`JetBrains Mono`, 8.5px, letter-spacing 1.2px, color `var(--text-muted)`).
- **Active Underline:** Dragging a numerical control displays an active hairline underline in the node's accent color (`var(--accent-track)`).

---

## 2. Layout & Component Specification

### A. Track Identification & Header
- **Track Tag:** `T1` / `T2` / `T3` / `T4` displayed in bold accent color.
- **File Name:** Primary file name with subtitle marquee in muted grey.
- **Close Button:** Subtle multiplication cross `✕` in top-right, visible on card hover.

### B. Source Selection
- **Load Action:** Horizontal left-to-right arrow (`→`), resting in subtle grey and turning black (`var(--text-main)`) on hover.
- **No Dot:** Red indicator dot removed from the source action bar.
- **Secondary Sources:** `🎤 Live In` and `📶 Stream` hide at rest and reveal on card hover.

### C. Hero Timer & Sample Progress Line
- **Hero Readout:** Large light-weight clock numerals (`01:24.3`) rendered permanently in the active node's accent color (`var(--accent-track)`).
- **Sample Progress Bar:** Positioned directly beneath the timer readout. Hairline track with scrubbable fill in `var(--accent-track)` and hover expansion thumb.

### D. Playlist & Transport Row
- **Playlist Navigation:** `|◀`, `03/12`, `▶|`, with a seamless vector SVG shuffle button (`🔀` replaced by crossed-arrows icon) sitting in a matching 1px square box revealed on hover.
- **Transport Buttons (`M S ○ ▷ ✕`):**
  - **Uniform Square Boxes:** All 5 buttons sit in 22×22px square frames with 1-pixel width borders.
  - **Mute (`M`) & Solo (`S`):** Clean typography letters in `Space Grotesk`.
  - **Record Automation Motion (`○`):** Pure geometric circle outline.
  - **Play (`▷`):** Clean equilateral triangle outline; fills solid with accent color when engaged.
  - **Clear Sound (`✕`):** Multiplication cross matching the exact shape and optical proportion of the top close button.
  - **Engaged State:** Border and symbol turn into `var(--accent-track)` with `font-weight: 800` and an inset hairline accent glow.

### E. Parameter Grid
- **Top Row (3 Columns):**
  - `VOL` (`0%` – `100%`, default `80%`)
  - `PAN` (`L50` – `C` – `R50`, default `C`)
  - `SPEED` (`0.10x` – `3.00x`, default `1.00x`)
- **Bottom Row (4 Columns):**
  - `BASS` (`-15dB` – `+15dB`, default `0dB`)
  - `MID` (`-15dB` – `+15dB`, default `0dB`)
  - `TREBLE` (`-15dB` – `+15dB`, default `0dB`)
  - `GAIN` (`-15dB` – `+15dB`, default `0dB`)
