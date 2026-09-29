# Goals and next decisions

## Agreed product direction

Aether is a four-track spatial instrument: playful, musical, visually alive, lightweight on CPU. Protect characteristic node animations and good DSP. Keep the clean canvas, avoid growing a wall of controls. Projects should be self-contained. Clearing a sound should preserve useful channel/movement settings. Small experiments should reuse production components rather than become incompatible forks.

Matt's latest priorities:
- Refine side-panel colors and coherence with the canvas.
- Add a short, optional four/five-step introduction for new users.
- Add preferences/setup guidance for streaming and audio routing.
- Gradually align instrument node interfaces with the main app aesthetic.
- Build a scheduler of saved scenes/sessions, with transitions, toward long broadcasts.

## Proposed next order — discuss with Matt, not an implementation mandate

1. **Protect and reconcile the two development lines.** Put the separate 6.0 source under version control on its own branch, preserving its exact state. Compare it against Weave and select improvements deliberately. Do not replace one whole index.html with the other.
2. **One manageable visible improvement.** Matt will bring low-hanging-fruit ideas. Panel color or tutorial copy/layout can be a short session; first establish which source/build he wants to assess.
3. **Make one real Weave transition work.** Use the host clock; separate scene selection from live activation; define what wins when scene transition and drawn motion both control the same channel. Implement and test JUMP before expanding to MORPH or audio crossfade.
4. **Persist and package.** Save/load versioned Weave data with backward compatibility; clear/reset predictably; package CSS/fonts and check installed app appearance. Test reopening with original assets unavailable.
5. **Broaden only after proof.** Two scenes reliably transitioning, then longer scheduling and soak tests; instrument sound/CPU playground and node aesthetic updates as bounded parallel product interests, not a demand to spawn agents.

## Decisions still needed

- Which version does Matt currently prefer visually: installed 6.0, or Weave development app? Preserve both until reconciled.
- Weave currently stores spatial scenes, not a complete library of interchangeable saved sessions. Decide the first supported unit: same four sources with new spatial states, parameter morphs of compatible instruments, or full session swaps. These are different levels of work.
- Define automation ownership during transitions and afterward.
- Confirm the next small UI improvement; do not infer it from old notes.

## Carry forward, not falsely marked complete

Self-contained full playlists and missing-asset behavior need end-to-end proof in the chosen consolidated version. Loudness matching/limiting needs listening across quiet recordings and loud material; no DSP can guarantee safe physical listening levels. CPU cost needs controlled measurements by node and session. Live Icecast setup/reconnect, long broadcasts and mobile conducting remain unproven or future work. Account systems and automated curation are later discussions.
