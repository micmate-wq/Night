# Motion playground

Open http://127.0.0.1:3471/desktop/motion-playground.html in a browser while the existing worktree server is running. Alternatively open desktop/motion-playground.html directly from Finder; all dependencies are local and no server is required.

Standalone, silent experiment. No main app, project format, native code, installed app or master processing changes. No commits or builds.

Drag the node, release to loop, compare Original jump / Smooth return. Return time is expressed at 1×; speed scales the entire loop. Original duration stays the recorded duration. Pause/resume, replay, clear and grabbing the node again are supported. Track colours and black/near-white backgrounds come from the current app.

Engineering: motion-loop.js contains the actual AudioTrack.updateMotionPlayback method verbatim. The regression test fails if the main app method changes, avoiding silent drift; future integration should make it a shared module. No app extraction was needed for this experiment. Original timestamped {t,x,y,z} samples are copied unchanged. A bounded straight-line smoothstep return is represented by 128 extra timestamped segments, using the same interpolation engine. This is an approximation of smoothstep, not continuous velocity: tiny segment slope changes and slowing at the joins remain. Nearly closed paths keep the requested return duration, which can feel like a dwell. Zero return retains the original jump; very short returns may occur between display frames. No overshoot beyond endpoint bounds.

On release smooth playback starts at the end of the gesture, so the first action is returning home. Mode/time edits restart the playback clock for comparison; speed edits preserve phase. The clock retains Aether's 250 ms frame-gap cap. No sound or audio graph is created.

Verification: node desktop/tests/motion-loop.test.cjs passes 240 endpoint/duration/return/speed combinations, unchanged recording data, bounds, endpoint joins, interpolation, speed accumulation, pause, empty/single-point paths and source parity. Inline script syntax and git diff whitespace checks pass. Browser interaction verified recording/release, original versus extended duration, pause, zero return, 2× duration scaling, themes, clear and replacement drawing. Visual layout inspected in both modes. Touch hardware, long-session CPU profiling and audio have not been tested.

Musical judgment remaining: whether the slowdown feels like a useful breath or an unwanted stop, how much return suits long open gestures versus almost-closed ones, and whether direction-aware shaping is warranted. Visual results cannot establish smooth audio.
