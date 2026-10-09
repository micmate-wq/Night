# Journey Lab — v1.2, 6 October 2026

Current task checkout: `/Users/matt/Documents/Codex/2026-10-04/referenced-chatgpt-conversation-this-is-an/work/aether-journey-v01-lab`, branch `feature/weave-v01`, v1.2 local source snapshot. Native identifier `com.aether.desktop.journey-v1-2`, dev port 3472, launcher `launch-journey-v01.sh`. App saved at checkout root and under `desktop/src-tauri/target/debug/bundle/macos/`. This is separate from canonical Weave and Claude Labs.

# Source and build map — 2026-09-29

| Location | Identity | Handling |
|---|---|---|
| `/Users/matt/.gemini/antigravity/scratch/aether` | Git branch `feature/weave-functional`, application commit `3ab6e22` | Canonical shared state; latest inspected Weave source |
| sibling `aether-codex-6` | Independent directory; **not a Git repository**; version 6.0.0 | Preserve; inventory/import onto a dedicated Git branch before reconciling |
| sibling `aether-codex-stabilization` | `codex/stabilization` at `171c09f` | Historical 5.0.7 baseline with uncommitted playground files; do not clean |
| `/Users/matt/.codex/worktrees/47d9/aether` | Detached `171c09f`, modified index and UI drafts | Preserve local changes; not canonical latest source |
| sibling `aether-ui-4` | branch `4.0`, `17dcccf` | Older UI line |
| sibling `aether-v3` | detached `2dc4b09` | Historical line |

Installed applications: **6.0 Codex** is version 6.0.0 (September 26); **5.0 Codex** is version 5.0.1 (September 9); **Aether Desktop** is 4.2.1 (September 3). Names can be misleading: inspect bundle version, source and timestamp.

Canonical code: `desktop/index.html`, `desktop/weave.js`, `desktop/weave.css`, `desktop/src-tauri/`, `nodes-v2/`, root `tests/`. Desktop development server uses port 3456; separate 6.0 Tauri configuration uses 3468. Do not launch one against the other's frontend.

Historical tags: `aether-working-5.0.7` at `171c09f`; `pre-scheduler-stable` at `b55ee2d`; `node-v2-patient-zero` at `89e6878`; `checkpoint-feature-weave-functional` at `1711edc` (not the latest Weave application commit).

Git worktrees share repository history/remotes, but not uncommitted files. The separate 6.0 copy shares neither automatically. Do not assume a merge has happened merely because both directories contain similar files.
