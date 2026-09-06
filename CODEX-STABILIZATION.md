# Aether 5.0 Codex

Isolated stabilization preview based on ff6056c (v4.2.1). The display name is not a release-version declaration. Handover master 80%, node trim 80%, per-channel gain/session persistence and Clear controls are applied. Clear retains EQ, gain and motion settings, and invalidates pending local file/node loads.

Branch: codex/stabilization

Launch from this folder’s desktop directory with `npx tauri dev`. Uses port 3467 and a separate application identifier. Do not kill other Aether or Tauri processes: Antigravity uses port 3456.

Keep build outputs and personal files out of commits.
