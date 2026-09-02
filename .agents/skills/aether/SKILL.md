---
name: aether
description: Restarts or launches the Aether Tauri desktop application
---

# Goal
Ensure the Aether desktop app is running cleanly by terminating any stale or hanging Tauri/Python processes and launching `npx tauri dev`.

# Instructions

1. **Kill Hanging Processes & Free Ports**
   Run the following cleanup command to kill any running `aether-desktop` instances, background python server on port 3456, or orphan Tauri processes:
   ```bash
   killall -9 aether-desktop 2>/dev/null || true
   lsof -ti :3456 | xargs kill -9 2>/dev/null || true
   pkill -f "tauri dev" 2>/dev/null || true
   ```

2. **Launch the Development Server**
   Execute `npx tauri dev` in the background with `IsDaemon: true` from the `desktop/` directory:
   - **Working Directory**: `desktop/` (inside the workspace root)
   - **Command**: `npx tauri dev`

3. **Verify Initialization**
   Check the command logs to ensure the Rust binary compiles/runs and the local dev server (`http://localhost:3456/desktop/index.html`) is active.
