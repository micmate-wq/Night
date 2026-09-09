# Master output prototype — 9 September 2026

Hidden native Web Audio processing, shared by speakers, WAV capture and Icecast. Existing master slider remains upstream. No auto-normalization or additional controls.

Chain: 2:1 soft-knee compressor (-18 dB, 25 ms attack, 250 ms release), +2 dB makeup, fast 20:1 peak compressor (-3 dB, 1 ms attack, 120 ms release), bounded soft saturation guard. The guard is linear below 0.70 amplitude; its 65,537-entry curve remains below -1 dBFS. No oversampling. This is sample-peak protection, NOT a true-peak limiter or a guarantee about acoustic listening levels. Heavy overload will change timbre; no promise of transparent extreme limiting. Native compressors may apply implementation-dependent makeup gain, so perceived loudness needs matched listening tests.

No per-sample JavaScript, timers or audio-thread allocations introduced by this chain. Curve allocated only on graph creation. Native compressor latency and stereo behaviour need live musical judgment.

Verified offline in the browser at 48 kHz: silence, quiet and normal 440 Hz stereo signals, 8x amplitude overload with +/-20 impulses. Finite nonzero output for signals, exact silence for silence, all peaks below ceiling. Offline render times 4–14 ms per one-second test, not a live CPU measurement. HTML/JS syntax and whitespace checks passed.

Remaining: live CPU profile; matched-level listening with mastered music plus field recordings; WKWebView/native sound check, stereo/transient/release tests, and end-to-end WAV/stream capture comparison. No old user sessions changed or app processes stopped. Version 5.0.1 package prepared separately from 5.0.0 for comparison.
