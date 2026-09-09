# Speed-following motion return

New recordings now use automatic return timing in the shared motion-loop.js engine; the main app calls makeLoop without a fixed duration. Previous saved paths are loaded unchanged. The existing 5.0.2 installer has not been rebuilt with this change.

Timing uses travelled distance during the final 25% of recording time divided by that window's duration. Partial segments crossing the window boundary are weighted proportionally; reversals count as distance travelled. Coordinates are normalized x/y and z/50. Return duration is endpoint separation divided by that average speed. Zero-motion endings fall back to the whole recording's average. Durations clamp to 0.04–30 seconds at 1x. Closed paths within 1e-6 normalized units and zero-duration recordings get no added return.

Original samples and timestamps remain unchanged. The 128-segment bounded smoothstep return and existing interpolation remain in place. Matching average pace does NOT match endpoint velocity or tangent direction: easing still slows at both joins. No audio smoothness claim or audio processing change.

Playground defaults to Follow gesture speed, displays computed return time, and offers Manual return time for comparison. Playback speed scales the entire stored timeline consistently.

Verified: existing 240 motion combinations plus fast/slow final quarters, time scaling, partial segments, stationary ending, closed/tiny-gap paths, empty/single/zero-duration paths, duration bounds, depth-only movement, reversals and sample-rate invariance. Main app and playground scripts parse. Browser real-app recording/release, pause/resume, clear, save/reopen twice, legacy saved loops and short recordings pass. Browser drawing produced 0.13s recording + 0.15s automatic return; manual mode gave 1.00s return for the same recording. Restored automatic mode and paused for handoff.

Preview: http://127.0.0.1:3471/desktop/motion-playground.html
Main app source preview: http://127.0.0.1:3471/desktop/index.html

The stopped port-3471 server was restarted for this task. No Antigravity processes or installed apps modified; no commits, merges or pushes. Native listening and musical evaluation of easing at the joins remain user checks.
