# AETHER 3.0
### Standalone 4-Track Spatial Audio Studio & Motion Automation Workstation

**Aether 3.0** is a client-side Web Audio performance workstation and 4-channel spatial soundboard. It allows live performers, sound designers, and producers to position, automate, EQ, and record 4 simultaneous audio sources in a 2D spatial soundstage with zero latency.

---

## Key Features

- **2D Spatial Soundstage:** Real-time spatial positioning mapped dynamically to stereo panning ($X$-axis) and volume dynamics ($Y$-axis).
- **Motion Automation Recording:** Draw or record continuous spatial motion loops with multi-speed time warping ($0.01\times$, $0.1\times$, $0.5\times$, $1.0\times$, $2.0\times$).
- **Ableton-Style 3-Band Bipolar EQ:** 
  - $0\text{ dB}$ resting at 12 o'clock (top dead center).
  - Clockwise boost ($+15\text{ dB}$) and counter-clockwise cut ($-15\text{ dB}$).
  - Smooth vertical mouse & touch dragging, <kbd>Shift</kbd> fine-precision mode, and double-click to reset.
- **Master WAV Recorder:** Live master output capture directly to 16-bit uncompressed stereo `.wav` file on disk.
- **Live Input Support:** Connect any microphone, USB audio interface, or DAW loopback stream (BlackHole, Rogue Amoeba Loopback, VB-Cable) to any track with uncompressed low-latency audio.
- **Session Save / Load:** Export and restore your complete setup, sample references, EQ curves, and automation keyframes as a `.json` project file.
- **Dual Themes:** Instant switching between **Studio Dark Mode** (matte slate with high-contrast glowing LED meters) and **Terracotta Minimal**.
- **Master Limiter Protection:** Built-in `DynamicsCompressorNode` soft-limiting to eliminate digital distortion during multi-channel summing.

---

## Quick Start

### Running Locally
You can run Aether using Python's built-in HTTP server or any static server:

```bash
# Start local server
python3 -m http.server 3456
```

Then open your browser to:
```text
http://localhost:3456/index.html
# or
http://localhost:3456/aether.html
```

---

## Controls & Shortcuts

| Action | Control |
| :--- | :--- |
| **Play / Pause Master** | <kbd>Spacebar</kbd> or Header Play Button |
| **Stop & Rewind** | Header Stop Button |
| **Record Master Live Jam** | Click `REC MASTER` $\rightarrow$ Click `STOP & SAVE WAV` |
| **Spatial Drag** | Click and drag any track node (`T1`–`T4`) in the canvas |
| **Record Motion Path** | Click `● REC` on a channel $\rightarrow$ drag node in arena $\rightarrow$ release |
| **Adjust EQ** | Drag up/down on knob. Hold <kbd>Shift</kbd> for fine adjust |
| **Reset EQ to 0dB** | Double-click any EQ knob |
| **Toggle Dark / Light Theme** | Click `🌙` / `☀️` button in header |
| **Save / Load Session** | Click `💾 Save` or `📂 Load` |

---

## License
MIT License. Open source.
