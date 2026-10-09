# WEAVE DESIGN SPEC v0.1

Design handoff for the approved Weave mockup **E: BUILD / PLAY toggle** (Loom build view + Set list play view). This describes the design only. Implement it inside Aether using the app's existing architecture, components and styling approach.

Every value is tagged **[obs]** observed (read from the mockup source/render), **[est]** estimated, or **[sug]** suggested (not shown in the mockup: behaviour, data model or missing states). Values are CSS px at a 1440×900 window. Reference renders and a runnable copy of the mockup are in `reference/`.

---

## 1. Layout (window 1440×900)

| Element | Value |
|---|---|
| App background | `#ececea` [obs] |
| Top bar (existing, don't redesign) | inset 12px left/right, top 10px, height 46px, bg `#f7f7f5`, 1px `#dcdcd8`, radius 10px [obs] |
| Left gutter = Weave panel | x 12, top 66, bottom 12, **width 300px**, bg `#fff`, 1px `#dcdcd8`, radius 10px, overflow hidden [obs] |
| Right gutter = Transition panel | mirror of left: right 12, width 300px [obs] |
| Centre canvas (existing, don't redesign) | left/right 324px, top 66, bottom 12, bg `#fbfbfa` [obs] |
| Gutter gap to canvas | 12px [obs] |

Channel strips (existing) open over the gutters; Weave is the layer underneath (see §7.18).

## 2. Typography

**Families:** `Inter Tight` (sans, variable 100–900) and `Geist Mono` (mono, variable), both bundled as TTF in the mockup, with fallbacks `system-ui, sans-serif` / `ui-monospace, monospace` [obs]. If Aether already bundles these fonts, reuse them. Both are SIL Open Font License 1.1 (free to bundle and embed). **Rules:** heavy sans for names, numbers and buttons; mono for time, bars and readouts; uppercase is used only for labels, set-list names and PLAY-panel titles [obs].

| Role | Family | Size | Weight | Tracking | Line-height | Case | Status |
|---|---|---|---|---|---|---|---|
| Label (section, meta) | sans | 10px | 700 | .14em | normal | UPPER | obs |
| Micro (lane labels T1–T4, slider ticks, fade-bar rows) | mono | 9px | 700 (ticks 400, muted) | 0 | normal | as is | obs |
| Button (pill) | sans | 11px | 800 | .02em | normal | as is | obs |
| Mode toggle BUILD / PLAY | sans | 19px | 900 | −.03em | normal | UPPER | obs |
| Key-cap hint "TAB" / "switch" | mono 10px 700 / sans 7.5px, .12em, muted | | | | 1.1 | | obs |
| Loom scene number | sans | dynamic 14–46px (§7.4) | 900 | −.06em | .85 | digits, zero-padded "03" | obs |
| Loom scene name | sans | 12.5px (11px compact) | 800 | −.01em | normal | as is, ellipsis | obs |
| Loom bars count "16b" | mono | 10px | 700, 70% opacity | 0 | | lower | obs |
| Loom playing countdown "−00:11.3 → 04" | mono | 11px | 700 | 0 | | | obs |
| Playhead tag | mono | 10px | 700, white on ink | 0 | | | obs |
| Set-list countdown | mono | 60px (48 compact) | 800 | −.07em | 1 | | obs |
| Set-list NOW name | sans | 54px (42 compact) | 900 | −.065em | .9 | UPPER | obs |
| Set-list NOW number badge | sans | 17px | 900 | 0 | 1 | | obs |
| Set-list row name | sans | 26px (17 compact) | 900 | −.045em | 1 | UPPER, ellipsis | obs |
| Set-list row number / bars | mono | 11px | 700 | 0 | | | obs |
| Transition title (BUILD) | sans | 30px | 900 | −.045em | .9 | as is (truncate at 15 chars + "…") | obs |
| Transition length number | sans | 40px | 900 | −.05em | | | obs |
| JUMP/MORPH/FADE | sans | 11px | 800 | .1em | | UPPER | obs |
| "Starts in" countdown | mono | 22px | 700 | −.02em | | | obs |
| PLAY "bars to go" number | mono | 76px | 800 | −.07em | 1 | | obs |
| PLAY caption "bars / to go" | sans | 22px | 900 | −.04em | stacked 2 lines | | obs |
| PLAY next-scene name | sans | 40px | 900 | −.045em | .9 | UPPER | obs |
| GO NOW / HOLD | sans | 30px | 900 | −.05em | | UPPER | obs |
| Fade-bar length label "8 BARS" | sans | 13px | 900 | 0 | | UPPER | obs |

## 3. Colour

| Token | HEX | RGB | Use | Status |
|---|---|---|---|---|
| text-primary ("ink") | `#141414` | 20,20,20 | text, rules, strong borders, solid buttons, playhead, loom scene bars | obs |
| text-muted | `#8a8a86` | 138,138,134 | secondary labels, ticks | obs |
| surface | `#ffffff` | 255,255,255 | gutter panels, set-list sheet | obs |
| surface-raised | `#f7f7f5` | 247,247,245 | top bar, channel strip | obs |
| surface-canvas | `#fbfbfa` | 251,251,250 | canvas, morph map | obs |
| app-bg | `#ececea` | 236,236,234 | window | obs |
| gutter-play-bg | `#e4e4e0` | 228,228,224 | Weave gutter in PLAY (behind sheet) | obs |
| tint | `#f3f3f0` | 243,243,240 | transition overlap zone, pressed curve button | obs |
| border-subtle | `#dcdcd8` | 220,220,216 | panel outlines, unpressed curve buttons | obs |
| tick-empty | `#d0d0cc` | 208,208,204 | 1px inset outline of an empty colour tick | obs |
| progress-track | `#e2e2de` | 226,226,222 | set-list progress track | obs |
| **node-t1** red | `#f2463a` | 242,70,58 | T1 | obs |
| **node-t2** yellow | `#f7dc38` | 247,220,56 | T2 | obs |
| **node-t3** purple | `#8f63c8` | 143,99,200 | T3 | obs |
| **node-t4** green | `#56c83a` | 86,200,58 | T4 | obs |
| node-t2-text | `#b59a00` | 181,154,0 | "T2" text on white (legibility) | obs |
| playing (sticky yellow) | `#f6d24a` | 246,210,74 | playing Loom band; NOW-badge digits | obs |
| tape | `#efe3a6` @ .9 | 239,227,166 | tape strip on set-list sheet | obs |

Opacities [obs]: played rows .45 · future beat blocks .15 · slider disabled (JUMP) .3 · Loom bars count .7. **Node colours must match Aether's existing T1–T4 colours.** If the app's values differ, the app wins [sug].

## 4. Borders, radii, shadows, spacing

- **Borders** [obs]: 1px `#dcdcd8` panel outlines · **1.5px ink** as the default rule (rows, buttons, segmented switch, morph map, footer divider) · 2px mode toggle · 2.5px GO/HOLD · key cap 1.5px with 4px bottom · Loom scene bar 7px solid ink (4px when crowded) · playhead 2px.
- **Radii** [obs]: 6px (segmented switch, curve buttons, key cap, morph map) · 7px (mode toggle) · 8px (GO/HOLD) · 10px (panels, strip) · 999px (pills).
- **Shadows** [obs]: only the set-list sheet has one, `3px 5px 10px rgba(20,20,20,.10)` (soft, offset down-right). No glows anywhere.
- **Spacing scale** [est, derived]: 3 · 6 · 8 · 12 · 14 · 16 · 18 · 22px. Panel padding 14–16px horizontal. Header `.ph` padding 14px 16px 10px [obs].

## 5. Motion

- **Mode switch** [obs]: 460ms, easeInOutQuad (CSS approx. `cubic-bezier(.45,0,.55,1)` [est]). A single progress value p goes 0→1 (BUILD→PLAY) or back:
  - The toggle's black block slides `translateX(p·100%)`, and the labels invert colour under it.
  - Loom layer opacity `clamp(0, 1.6 − 2.2p, 1)`, so it is gone by p≈.73.
  - Loom threads `scaleX(clamp(.04, 1 − 1.9p, 1))` about x=217px, so the four threads squeeze into thin lines.
  - Loom labels and bars `translateX(−40p px)`.
  - Set-list layer opacity `clamp(0, 2.2p − 1.2, 1)`, so it starts at p≈.55, with `translateX((1−p)·60px) rotate((1−p)·3deg)`.
  - The gutter background switches to `#e4e4e0` at the start of the switch to PLAY.
  - The whole sequence is sequential (out, then in), not a double exposure. See `reference/E-toggle-switch.png` (p=.3).
- **Reduced motion** [obs]: the switch jumps instantly (0ms). [sug] Also freeze marquees (show ellipsis) and move the playhead in steps (once per bar).
- **Marquee** [obs]: text repeated with a "  ·  " separator, linear infinite translate to −50%. One loop takes max(6s, characters × 0.45s); the set-list NOW name uses 7s. Only the **playing** scene name scrolls; other names ellipsize.
- **Countdown** [obs]: `mm:ss.t` (tenths), redrawn every frame. It counts time until the playing scene ends, which is when the transition starts.
- **Playhead** [obs]: moves continuously down the playing Loom band (y = band top + bar × px-per-bar).
- **Transition preview playhead** [obs]: vertical 2px ink line sweeping the fade bars, 4s linear loop.
- **PLAY beat blocks** [obs]: 4 blocks; blocks up to the current beat are at opacity 1, the rest at .15.

## 6. Interaction & keyboard

- **Tab** toggles BUILD/PLAY; the toggle's two halves are also clickable [obs]. [sug] Don't steal Tab while a text field has focus.
- **Click a scene** (Loom band or set-list row) to select it. In BUILD the right panel shows *selected → next* [obs]. The PLAY panel always shows *playing → next* [obs].
- **Selection and playhead persist** across modes; both views draw the same scenes [obs].
- **Space = GO NOW** (jump to the next transition immediately), **H = HOLD** (loop the current scene) [obs as on-screen hint; behaviour sug].
- **+ Scene** (Loom footer) captures the current canvas as a new scene [sug behaviour].
- Transition controls (length, curve, mode) edit the *selected* transition and redraw the fade bars and Loom tapers live [obs in mockup].
- Hover [sug]: scene band/row gets cursor pointer plus a `#f3f3f0` tint (not in mockup). Disabled [obs]: length slider at .3 opacity when mode = JUMP, and the length readout shows 0.

## 7. Components

Suggested data shapes [sug]:
`scene {id, number, name, bars: 8|16|32…, nodes:[{track:'T1'…'T4', level:0..1}], positions?:{T1:[x,y]…}}`
`transition {fromSceneId, toSceneId, lengthBars: 1|2|4|8|16|32, curve:'lin'|'ease'|'late', mode:'jump'|'morph'|'fade'}`
`transport {bpm, playingSceneId, barInScene, secondsToTransition}`

### 7.1 WeavePanel
Left gutter container (300px). Holds ModeToggle (top) and two stacked layers, LoomView and SetListView, of which only one is interactive. Class `weave-panel`, modifier `--play` (bg `#e4e4e0`) [obs]. Props: scenes, selectedId, playingId, transport, mode.

### 7.2 ModeToggle (BUILD | PLAY)
- Position: top 12, left/right 14, height 40, gap 8 to the key cap [obs].
- Switch: flex 1, border 2px ink, radius 7, white bg. Two equal buttons; 19px/900 caps text.
- A solid ink block, 50% wide, slides under the active half. Text colour inverts where the block is behind it (`mix-blend-mode:difference` with white text inside an isolated white container) [obs].
- Key cap: 44×40, border 1.5 (bottom 4), radius 6. "TAB" mono 10/700 with "switch" 7.5px muted underneath [obs].
- States: BUILD active / PLAY active / mid-switch. `aria-pressed` on each half [obs].

### 7.3 LoomView (BUILD)
- Lane header: T1–T4 labels in mono 9px/700 in node colours (T2 in `#b59a00`) at y 56, centred on the lanes [obs].
- Scenes stack vertically from y 70 [obs]. Band height = bars × pxPerBar, where pxPerBar = min(5, availableHeight / totalBars) and availableHeight = gutter height − 70 − 46 footer − 10 [obs].
- Footer: 46px high, 1.5px ink top border, white. Contains a "+ Scene" solid pill on the left and "136 bars · 04:32" in mono 11/700 on the right [obs].
- Layers, bottom to top: band backgrounds → threads → scene bars and labels → playhead [obs].

### 7.4 SceneBar (Loom band)
- Heavy 7px ink bar across the full width at the band top (4px when crowded), and one more closing bar after the last scene [obs].
- Label block: left 14, top = band top + bar + 2, width 136 [obs].
  - Number 900, sized by band height h: compact (h<30, or playing with h<72) = max(14, min(22, .5h)); playing = min(34, .4h); otherwise max(15, min(46, .55(h−12))) [obs].
  - Bars count "16b" beside the number; name below, ellipsized, width 124 [obs].
  - Compact layout puts number, bars and name on one line with a 7px gap [obs].
- States [obs]:
  - **Playing**: the whole band is filled `#f6d24a`, the name scrolls (marquee) and the countdown sits under the name. If compact, the countdown moves to the playhead tag instead.
  - **Selected** (not playing): a 150px-wide ink block behind the label with white text.
  - **Default**: white.
  - **Selected + playing**: playing wins.
  - Hover: [sug] see §6.

### 7.5 LoomThread
- One vertical thread per node, lane centres at x 172 / 202 / 232 / 262 [obs].
- Width = level × 24px (minimum 3px while present, 0 when absent) [obs].
- At each scene start the width tapers linearly from the previous scene's width to this scene's width over the transition length (lengthBars × pxPerBar, capped at the band height). JUMP = no taper [obs]. A node that leaves tapers to a point; a node that enters grows from a point.
- Weave effect: at each scene bar, the lane where (sceneIndex + lane) is even is drawn **over** the ink bar, and the others pass under it [obs].
- Colours: node-t1…t4, flat [obs].

### 7.6 NowPlayingMarquee / Countdown / Playhead
- **Marquee**: see §5 for speed. Used in the Loom playing label (12.5px) and the set-list NOW name (54px) [obs].
- **Countdown**: `−mm:ss.t → NN` in the Loom; `mm:ss.t` on the set list [obs].
- **Playhead**: 2px ink line across the whole panel, with a tag at the right edge (58×18 ink rectangle, white mono 10/700) showing the bar number to one decimal, or `−mm:ss` when the playing label is compact [obs].

### 7.7 SetListView (PLAY)
- **Sheet**: inset left 14, right 12, top 72, bottom 14; white; padding 20/18/16; `rotate(−0.8deg)`; shadow as in §4; overflow hidden [obs].
- **Tape**: 96×24 at `#efe3a6`, opacity .9, centred on the top edge 10px above it, `rotate(2.5deg)` [obs].
- **Content, in order** [obs]:
  1. Label row: "Set · 7 scenes" on the left, "136 bars" muted on the right.
  2. Countdown 60px.
  3. Label "till 04 · morph 8 bars".
  4. NOW line:
     - Number badge: 17px/900, `#f6d24a` digits on an ink background, padding 3/5/2.
     - Scene name: 54px caps marquee, 216px wide.
  5. Mix bars, indented 33px: one flat node-colour bar per present node, 10px high, width 14 + level × 40, gap 3.
  6. Progress bar: track 4px `#e2e2de` with a 12px-tall ink fill at frac × 100%.
  7. Rows (the playing scene is omitted from the list because it's the NOW line).

### 7.8 SetListRow
- **Full** [obs]:
  - Grid `28px 1fr auto`, gap 6, padding 9/7, bottom border 1.5 ink.
  - Contents: number (mono 11) · name 26px caps · bars (mono 11, right-aligned).
  - Colour ticks on a second line spanning columns 2–3, margin-top 3: 22×6 each, gap 3. A present node is filled with its colour; an absent node has a 1px `#d0d0cc` inset outline.
- **Compact / crowded**, used when the list would not fit (14 scenes) [obs]:
  - Grid `24px 1fr auto auto`, padding 4/3, name 17px.
  - Ticks inline as 9×9 squares.
  - The countdown drops to 48px and the NOW name to 42px.
  - [sug] Switch to compact when full rows overflow the sheet.
- **States** [obs]:
  - **Played**: name struck through (3px), and name, ticks and bars at opacity .45.
  - **Selected**: ink background with white text, bleeding 8px each side (negative margin plus padding).
  - **Upcoming**: default.
  - Hover: [sug].

### 7.9 TransitionPanel (BUILD, full)
- Header "Transition" label, with "03 → 04" (mono 11/700) on the right [obs].
- From-name 30px/900, then a down arrow (14×18 SVG, stroke 2.4) with a muted label ("8 bars · nodes glide" / "volumes cross" / "cut on the bar"), then the to-name 30px [obs].
- Then, top to bottom: TransitionFadeBars → Length (label + 40px number + "bars") → LengthSlider → Curve row → TransitionModeSwitch → MorphMap with "Starts in" and Preview [obs].
- Horizontal padding 16 [obs].

### 7.10 TransitionFadeBars
- Width 236, indented 18px so the row labels fit on the left [obs].
- Time axis: 4 bars of the outgoing scene | transition lengthBars | 4 bars of the incoming scene [obs].
- Overlap zone: filled `#f3f3f0`, bounded by two 1.5px ink lines extending 8px below the rows [obs].
- One row per node present in either scene [obs]:
  - Row height 30; bar centred; thickness = level × 22px.
  - A node in both scenes stays solid, and its thickness morphs from A to B along the curve.
  - A node only in A fades from opacity 1 to 0 across the overlap along the curve.
  - A node only in B fades from 0 to 1.
- The opacity fade is functional and is **the only gradient in the design** [obs].
- Labels [obs]: T1–T4 in mono 9 at the left · "8 BARS" 13px/900 centred under the zone · "03 OUT" / "04 IN" in mono 9 muted at the ends.
- Preview playhead: 2px ink line [obs].

### 7.11 LengthSlider
- Stops 1 · 2 · 4 · 8 · 16 · 32, evenly spaced (index-based, not linear) [obs].
- Track 2px ink; fill 6px ink from the left up to the knob [obs].
- Knob: 18px ink circle with a 3px white border and a 1.5px ink outer ring [obs].
- Tick labels in mono 9 muted underneath [obs].
- Disabled (JUMP): opacity .3 [obs].

### 7.12 CurvePicker
- Three buttons, 48×36, border 1.5 `#dcdcd8`, radius 6, gap 8 [obs].
- Each holds a 34×22 SVG curve drawn with a 2px ink stroke: linear, S-ease, late (slow start) [obs].
- Pressed: ink border with a `#f3f3f0` fill [obs].

### 7.13 TransitionModeSwitch (JUMP / MORPH / FADE)
- Segmented control: 1.5 ink border, radius 6; three equal parts, 11px/800 caps with .1em tracking, padding 7 [obs].
- Pressed segment is an ink fill with white text [obs].
- Meaning: JUMP = cut on the bar; MORPH = positions and volumes glide; FADE = volumes cross, positions snap [obs labels; sug semantics].

### 7.14 MorphMap
- 112×112 box, border 1.5 ink, radius 6, bg `#fbfbfa`, with a centre cross in `#dcdcd8` [obs].
- Per node: a hollow ring for the A position, a filled dot for the B position, and a dashed line between them in MORPH mode (dash .08/.06 in −1..1 map units) [obs].
- Beside it: "Positions glide/snap" (muted label), "Starts in" label, the countdown in mono 22, and a Preview pill with an 8×9 play triangle [obs].

### 7.15 PlayTransitionPanel (PLAY, stripped)
- Header "Next" with "03 → 04" [obs].
- **Bars to go**: 76px mono number, with the caption "bars / to go" (22px/900) beside it [obs].
- Four beat blocks, 22×8, gap 5, followed by a "beat" label [obs].
- Next scene name: 40px caps [obs].
- Summary label: "morph · 8 bars · ease curve" [obs].
- TransitionFadeBars, read-only [obs].
- GoHoldButtons pinned to the bottom (inset 16) [obs].
- No length, curve, mode or map controls in PLAY [obs].

### 7.16 GoHoldButtons
- Full-width buttons: border 2.5 ink, radius 8, padding 12/13, 30px/900 caps [obs].
- **GO NOW** is solid ink with white text; **HOLD 03** (current scene number) is outlined, 10px below it [obs].
- A muted, centred hint underneath reads "Space = go · H = hold (loops the scene)" [obs].
- [sug] The HOLD pressed state inverts to solid ink while a hold is active.

### 7.17 Buttons, labels, icons (general)
- Pill button: 11px/800, border 1.5 ink, radius 999, padding 5/11, white. Solid variant is an ink fill with white text [obs].
- Icons: inline SVG, 1.6 stroke, 17px in the top bar; no icon font. The play triangle is SVG because it's not in the font subset [obs].

### 7.18 ChannelStripOverlay (coexistence)
- An existing channel strip opens **over** the gutter; in the mock, the T2 strip covers the lower half of the left gutter (left 18, top 440, 288×442) [obs in `A-loom-strip-overlay.png`].
- The Weave stays visible above the strip and keeps playing underneath [obs].
- The strip foot carries a note under a 1.5px dashed ink rule: label "Weave continues under", and the hidden scene range (e.g. "04–07") in mono on the right [obs].
- Don't restyle the strip beyond adding that note [sug].

## 8. Token table (compact)

Full list with status in `weave-tokens.json` / `weave-tokens.css`.

| Token | Value |
|---|---|
| `--aether-surface` / `-surface-raised` / `-surface-canvas` | #fff / #f7f7f5 / #fbfbfa |
| `--aether-border-subtle` | #dcdcd8 |
| `--aether-text-primary` / `-text-muted` | #141414 / #8a8a86 |
| `--aether-node-t1..t4` | #f2463a · #f7dc38 · #8f63c8 · #56c83a |
| `--aether-playing` | #f6d24a |
| `--aether-radius-sm / -toggle / -md / -lg / -pill` | 6 / 7 / 8 / 10 / 999px |
| `--aether-border-base / -toggle / -go` | 1.5 / 2 / 2.5px |
| `--aether-space-1..8` | 3 · 6 · 8 · 12 · 14 · 16 · 18 · 22px |
| `--aether-shadow-sheet` | 3px 5px 10px rgba(20,20,20,.10) |
| `--aether-motion-mode-switch-duration` | 460ms |

## 9. Suggested class structure [sug]

`.weave-panel` (`--play`) · `.weave-toggle`, `__half` (`--active`), `__block`, `__key` · `.weave-loom`, `__lanes`, `__thread`, `__bar`, `__label`, `__playhead`, `__footer` · `.weave-scene` (`--playing`, `--selected`, `--compact`) · `.weave-setlist`, `__sheet`, `__tape`, `__countdown`, `__now`, `__mix`, `__progress` · `.weave-row` (`--past`, `--selected`, `--compact`), `__ticks` · `.weave-tx`, `__fadebars`, `__length`, `__slider`, `__curves`, `__mode`, `__map` · `.weave-tx-play`, `__barsleft`, `__beats`, `__go`, `__hold` · `.weave-strip-note`.

### Optional: Tailwind-style equivalents (optional, reference only)
> **Implement these tokens using Aether's existing styling approach. Do not introduce Tailwind unless the project already uses it.**

Label = `text-[10px] font-bold tracking-[.14em] uppercase` · Row name = `text-[26px] font-black tracking-[-.045em] leading-none uppercase truncate` · GO = `w-full border-[2.5px] border-[#141414] rounded-lg py-3 text-[30px] font-black tracking-[-.05em] bg-[#141414] text-white` · Sheet = `bg-white -rotate-[.8deg] shadow-[3px_5px_10px_rgba(20,20,20,.1)] p-[20px_18px_16px]`.

## 10. Mockup inconsistencies (flagged)

1. **T2 text colour.** Lane label `#b59a00`, strip title `#c9ad00`, strip timer `#e8c800`. Resolved in tokens: one `node-t2-text` = `#b59a00` for yellow text on white. The strip's own colours are the existing app's, so don't change them.
2. **Two yellows.** `playing` #f6d24a (Aether sticky yellow) vs `node-t2` #f7dc38 are near-identical. Kept separate as in the mockup. Flag for Matt: merge them, or make the playing band clearly distinct from T2.
3. **Scene number style differs by view.** Heavy sans (dynamic 14–46px) in the Loom, but mono 11px in set-list rows (17px badge for NOW). Intentional per view; documented as observed.
4. **Scene-name sizes.** 12.5 / 11 Loom · 26 / 17 set list · 54 / 42 NOW · 30 BUILD title · 40 PLAY title. These are role-specific, not a conflict.
5. **Countdown in two units.** The set list shows time (`mm:ss.t`); the PLAY panel shows bars to go. This was a deliberate change to avoid duplication, so keep both.
6. **Radii 6 / 7 / 8 / 10** are close together. Kept as observed; [sug] they could collapse to 6 / 8 / 10 (toggle 7→8) if Aether's scale prefers that.
7. **Hover, focus and empty states are not designed** in the mockup. Suggestions in §6 and §7.

## 11. Notes for the implementing agent

- Don't redesign the centre canvas, top bar or existing channel strips. Weave lives in the gutters and sits under strips.
- Reuse Aether's existing fonts, colours and tokens where they already match. The node colours must equal the app's T1–T4.
- Scene names ("Slow emergence", "Open water", "Afterglow", …), bar counts, 120 BPM and levels are **placeholder example data**.
- Taste rules:
  - Light, flat and raw, with heavy bold type and moving type (marquee, ticking countdown).
  - The node colours carry the meaning: thread width = level; fade bars = the crossfade; ticks = which nodes a scene contains.
  - No glows and no decorative gradients. The only gradients are the functional opacity fades in the transition bars.
  - The only shadow is the soft offset shadow on the set-list sheet.
  - No hardware-mixer rectangles of many labelled controls, and no generic DAW-timeline look.
- Live reference: `reference/e-toggle.html` (`?mode=play`, `?mode=play&crowded=1`, `?p=0.3` freezes the switch).
