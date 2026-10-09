# Aether Lab — Claude

**What this is:** a separate test copy of Aether. It exists so the new **v2 nodes** can be listened to and approved before they go anywhere near the main Weave build.

| | |
|---|---|
| Folder | `~/.gemini/antigravity/scratch/aether-lab-claude` (a git worktree of the main checkout) |
| Branch | `claude/lab`, started from `feature/weave-functional` |
| Window title | **Aether Lab — Claude (nodes v2 test)** |
| Dev port | **3460** (the main app uses 3456, so both can run at once) |
| App id | `com.aether.desktop.lab-claude` (its own settings and storage, separate from the main app) |
| Made by | Claude, 1 Oct 2026, at Matt's request |

**Nothing else in the app was changed.** Weave, the canvas, transport and saving are identical to `feature/weave-functional`. The only edits are the window title, the port, the app id, and the files listed below.

## Map-style depth (pinch a node back)

**How it plays:**

- A node lands **fully up front**, where it's clean, untouched stereo.
- **Pinch in** over a node (fingers together, the node gets smaller) to push it back.
- **Pinch out** to bring it forward again.
- **Two-finger drag** up or down over a node does the same, for now, so you can compare the two. If you only want pinch, set `DEPTH_TWO_FINGER_DRAG = false` in `desktop/index.html`.

**How it sounds:** curves taken from the map prototype.

- **Muffling:** 18 kHz down to 700 Hz at the back.
- **Volume:** drops to about 45%. The measured overall drop on music-like noise is about −7 dB.
- **Direction:** the browser's own 3D (HRTF) panner, using the node's left/right.
- **Height:** the sound rises slightly when far (up to about 15°).
- **Room:** Aether's dark reverb send (up to 10%) is kept.

**One continuous move:** the old version jumped from "clean stereo" to "3D" as soon as z passed 0.5. The new one crossfades over the first ~12% of depth. A +2.5 dB makeup gain keeps the 3D path from dipping when you start to pinch.

**What changed in the code:**

- The custom Haas spatializer is no longer inserted. You can still A/B it: `USE_CUSTOM_SPATIALIZER = true`.
- Pinch now works in the Mac app (WebKit gesture events), in Chromium (ctrl+wheel), and with two-finger drag.
- Page zoom on pinch is blocked.
- A pinch also updates a Weave scene during ADJUST.

**Checked in the cloud:** a render of the same audio graph shows:

- level falls smoothly as the node moves back, with no dip or jump
- sound gets steadily darker
- panning is kept

**Not checked:** the trackpad gestures themselves. Those need your Mac.

**Known:** far-away nodes lose some left/right width, because the HRTF has less to work with once the highs are gone. Say if that bothers you.

## Fix: 3D spatializer (pinch/scroll a node "further away")

**Symptom:** once a node was pushed back (z), its direct sound vanished and you heard only faint reverb.

**Cause:** three bugs, confirmed by running the real Wasm file outside the app.

1. `spatializer-worklet.js` called the Rust spatializer with **13 values; it expects 10**. The length argument got a memory address, so it crashed with "memory access out of bounds". A crashed worklet stays dead, so the spatial path went silent while the dry path was muted.
2. It used a **separate memory** that the Wasm module never reads.
3. **New, found while checking:** even with 1 and 2 fixed, the Rust delay line read one slot too far. A 0 ms delay returned audio from **about 1 second ago**, so a centred node (or the near ear of a panned node) would have come out a second late, like a slap echo.

**Fix:**

- The spatializer DSP is small, so it now runs directly in `desktop/spatializer-worklet.js` (plain JS, same sound design: Haas delay plus 3 darkened early reflections).
- There's no Wasm call any more, so it can't crash this way. Nothing else in the app changed.
- `dsp-wasm/src/lib.rs` got the same off-by-one fix and a unit test, for reference.

**Tested:** `tests/nodes-v2-lab/test-spatializer.js` passes 8/8. It checks:

- clean pass-through when off
- direct sound on time
- no 1 s echo
- Haas delay of ~16 ms on the far ear
- reflections move later with distance

**Still to listen for:** push a node back with pinch or scroll. You should hear it get darker and roomier, not silent.

The design comparison with the map (whole-canvas zoom, stronger volume drop, front/back) is a separate decision and isn't done.

## The four v2 test nodes

They live in `nodes-v2/`. Drop the `.aethernode` file onto a track.

| Node | Type | What changed from v1 | How to load |
|---|---|---|---|
| **Tick Tok** (`tick-tok.aethernode`) | rhythm, locked to the transport | Nothing. It was already v2. | Drop on an empty track. |
| **Granular Cloud** (`granular-cloud.aethernode`) | granular texture | Grains are now made on the **audio thread**. v1 made each grain with a main-thread timer, which macOS slows down when the app is in the background; that is the likely cause of the "sparse granular" P1 bug. It's now silent until you press Play, stops on Pause/Stop, and the diffusion tail stops too. | **Load a sample on the track first, then drop the node on it.** That sample becomes the grain source. On an empty track it uses a built-in chord. |
| **Singing Bowls** (`singing-bowls.aethernode`) | generative bowls | Same sound as before. It now only strikes while the transport plays (v1 kept striking and was just muted), the first strike comes straight away, and root pitch changes are smoothed. | Drop on an empty track. |
| **Tape Degrade** (`tape-degrade.aethernode`) | insert effect | Same sound. Moving a knob now changes only that knob's part of the effect (v1 rebuilt everything on every move). Damage glides smoothly instead of jumping. | **Load a sample, live input or stream first, then drop the node on it.** |

**What "v2" means for all four:**

- Each node can **report** every knob value back (`getParameter`), not just receive them. Scene snapshots and MORPH need this.
- Values are kept inside each knob's range.
- Each knob is marked in `manifest.json` as `"morph": "glide"` or `"morph": "step"`. That's how a later MORPH will know whether to slide a knob or jump it.
- Each node is silent when it loads, follows Play, Pause and Stop, and cleans up after itself when removed.

## What to listen for (Matt's approval list)

1. **Granular in the background.**
   - Play Granular Cloud with a sample, then switch to a browser and type for a minute.
   - It should stay as dense as it is in the foreground. This is the P1 test.
2. **Granular sound.**
   - Does it still sound like the old Granular Atmospheric Cloud?
   - Try a few samples, Pluck and Cloud textures, Harmony, Reverse and Freeze.
3. **Bowls.**
   - Does the character match the old ones?
   - Does root pitch move cleanly while it rings?
   - Do Pause and Play feel right? Pause now cuts the ringing (a 30 ms fade).
4. **Tape.**
   - Does it sound the same as before?
   - Sweep Damage and Wear while audio plays and listen for clicks or zipper noise.
5. **All four together** with Tick Tok: check timing and CPU (Activity Monitor).

Write down what sounds wrong. "Tweak later" is fine.

## Known limits (honest list)

- **Bowls UI: the bowls don't flash on each strike.** The host only forwards strike messages for old-style raw worklet nodes. The node records the last strike internally, but nothing shows it yet.
- **Granular can only use the track's sample as its source.** To swap the sample, load the new sample, then drop the node again. A live input isn't granulated.
- **Pause cuts tails** (bowl ring, granular diffusion). The v2 contract asks for this. If it sounds wrong musically, we can change the contract, for example with a short release tail.
- **Projects saved in the Lab** store the node's knob values the usual way. Opening them in the main app is fine, but only once the nodes are merged there.
- **Not tested on the Mac by Claude.** These checks ran in the cloud: 39 automated checks that render real audio offline. Your ears are the real test.

## Tests

```bash
cd tests/nodes-v2-lab && npm install && npm test
```

These render real audio offline (`node-web-audio-api`). They check:

- silent when loaded
- plays after Play
- silent within 0.1–0.3 s after Stop
- resumes after Stop
- density, pitch, wear and mix behave as expected
- knob ranges and unknown knobs
- removing a node twice is safe
- the file loads through the host's normal path

The harness retries a render if the library's offline `suspend()` misfires; that's a quirk of the test library, not of the nodes.

The existing tests still pass: TickTok v2 9/9, Weave spatial recall, Weave swipe gesture.

## Rules for anyone working here (people or AIs)

- This is a **lab**. Don't merge `claude/lab` into `feature/weave-functional` or `main` without Matt's OK.
- Don't change Weave here. The next Weave work follows `WEAVE-DECISIONS-2026-10-01.md` in the Claude project.
- If a node gets approved, bring it into the main build as a single small, reviewed change.
