# Project saving — 8 September 2026

Uncommitted work on codex/stabilization, exclusively in aether-codex-stabilization. Existing UI and animation work retained. No commits, merges or pushes.

## Implemented

- Project format 3.1 embeds every playlist File (original bytes, filename, MIME type), current order, selected index and shuffle flag. Restores real File objects so next/previous and automatic advancement use embedded content.
- Retains embedded current audio, exposed instrument parameters/bundles, position, EQ, channel gain, mute/solo, movement and master level. Also embeds host audio attached to an effect node.
- Captures settings before asynchronous serialization; unreadable/undecodable playlist files and source changes abort saving. Pending file/project loads block saving.
- Validates track indexes, numeric settings, motion and playlist structure, decodes all embedded audio, and checks instrument JavaScript syntax before stopping the current transport. Older embedded and path-only audio project branches remain supported. Missing old path-only samples reject the load.
- Instrument instantiation can still fail after validation. These failures are reported as partial loads with track details, and failed sources are cleaned up. They are never followed by a success toast.
- Live inputs and streams stay disconnected after loading. Their external-source intent and stream URL survive re-saving; a project note explains reconnection. Instrument private state beyond exposed parameters remains explicitly unguaranteed.
- Native saves and write_file_at_path write a sibling temporary file, sync it, then rename over the destination. A failed write/rename preserves the previous destination and removes the temporary file. Cancellation and native errors no longer trigger browser download fallbacks. Browser downloads are described as requested, not confirmed saved.

## Verified

- JavaScript syntax and git diff whitespace checks.
- Native Codex preview compiled and launched on port 3467 with identifier com.aether.desktop.codex; Antigravity processes were not stopped.
- Rust test through the actual Cargo app build: simulated failure after writing partial bytes preserves the old project exactly; successful replacement works; failed rename cleans up its temporary file.
- Browser regression page desktop/tests/project-storage.html uses the real app classes and Web Audio decoder. Three short synthetic WAV files, a stereo recording and a minimal JavaScript instrument were serialized through JSON and reopened after discarding original File/buffer references, with an unavailable original path and all fetch access blocked.
- Verified playlist bytes/order/index/shuffle, selected duration, next/previous decoding, gain/EQ/position/movement, stereo recording and instrument parameter restore.
- Damaged unselected audio, duplicate/out-of-range indexes, unreadable files, source changes and pending source loads were rejected. Damaged incoming audio did not call stopMaster or replace the active buffer.
- Older 3.0 embedded project reopened without stale playlists. External intent survived re-saving. Deliberate instrument runtime failure produced partial-load details.
- Native cancellation, native write failure and malformed native JSON were checked with a mocked Tauri bridge in the browser harness; no misleading success/download fallback.

## Limits / next manual checks

No cross-Mac verification, Finder-dialog end-to-end round trip, listening comparison, large-folder stress test, disk-full hardware test or abrupt power-loss test was performed. The original-path test uses synthetic in-memory File sources and blocked path access; it is not a physical source-folder deletion test. Legacy path-only fallback was inspected but not exercised end-to-end.

Full folder files remain compressed/original media, embedded as base64 in JSON. Large projects consume substantial memory during encoding/validation and have not been profiled. Standalone/current-buffer WAV encoding remains the existing 16-bit path. Arbitrary instrument private state and external asset dependencies are not captured by a new state protocol; instrument notes make this limit explicit. Only the existing JavaScript DSP path can be restored; unsupported DSP bundles fail preflight.

The native preview was launched during implementation. Later frontend changes need a Codex-window reload to appear; do not reload an unsaved user session. Browser verification used the final frontend independently.
