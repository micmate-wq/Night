# Crowd — David pack URLs (samples-for-matt)

Source page: https://atlas.anarchive.earth/view/samples-for-matt  
JSON: https://atlas.anarchive.earth/samples-for-matt.json  
BASE: `https://atlas.anarchive.earth/assets/samples-for-matt/`  
CORS: `Access-Control-Allow-Origin: *` (verified). Prefer `.mp3` for WKWebView preload.

## Gather → shuffled catalog

On gather, Crowd fetches `samples-for-matt.json` and builds a **shuffled** voice URL list:

1. All `palette/*.mp3` (16 × ~8s Kokoro stems)
2. Careful extras from `multilingual/*` and `demos/*` (layered/battle, distance-sweep)
3. **Skipped from voice pool:** `loops/*`, `spanish-quarter`, `street-journey-mix`, `synthetic-then-human` (beds / long authored mixes)

Fallback if JSON is unreachable: hardcoded palette + the same careful extras. Beds stay separate (`street-murmur` + `two-beacons`).

Initial preload: up to **16** unique shuffled files into the pool (unlock when density-need is ready). Remaining catalog URLs stay pending for drip.

## Drip (while sounding)

- Interval: **8–15 s** random between drip cycles
- Per drip: **1–2** unused (or least-recent) URLs → `fetch` + `decodeAudioData` → push to pool
- Does **not** reload the whole catalog each cycle
- Pool cap: **36** buffers; when full, **drop oldest** before push

## Spawn

Random index into the in-memory pool (not round-robin).

## Loops (seamless ~30s beds)

- `loops/street-murmur-30s.mp3` — primary murmur bed
- `loops/two-beacons-30s.mp3` — optional clear beacons layer
- Optional (not auto-bed): `loops/region-murmur-30s.mp3`, `loops/district-quarter-30s.mp3`

## Density pool — palette (~8s each) + extras

Loaded toward density during gathering; drip expands variety over time. **Loaded ≠ sounding**: sounding slider goes **5–30**; clips retrigger/overlap staggered.

1. `palette/adam-albania-1998-rev-2016.mp3`
2. `palette/alice-australia-1901-rev-1985.mp3`
3. `palette/bella-algeria-1989-reinst-1996.mp3`
4. `palette/daniel-k-andorra-1993.mp3`
5. `palette/emma-central-african-republic.mp3`
6. `palette/fable-china-peoples-republic-o.mp3`
7. `palette/fenrir-afghanistan-1964.mp3`
8. `palette/george-benin-1990.mp3`
9. `palette/heart-bolivia-plurinational-st.mp3`
10. `palette/isabella-azerbaijan-1995-rev-2016.mp3`
11. `palette/lewis-armenia-1995-rev-2020.mp3`
12. `palette/lily-antigua-and-barbuda-1981.mp3`
13. `palette/michael-algeria-2020.mp3`
14. `palette/nicole-cape-verde-1980-rev-1992.mp3`
15. `palette/onyx-angola-2010.mp3`
16. `palette/sarah-afghanistan-2004.mp3`

### Careful voice extras (drip / catalog)

- `multilingual/*-en-es-layered.mp3`, `*-en-es-battle.mp3` (windowed; not beds)
- `demos/distance-sweep-bolivia.mp3`

## Parameters

- **chatter** — entry snappiness: higher = faster voice starts + shorter windows
- **wander** — pitch/pan drift (×1.2) over each voice window
- **focus** — continuous 0→1 maps to ~0 clear … ~4–6 intelligible upfront
- **granular** — at full, ~20% denser/snippetier/hotter than v1.0

## Offline / inject

- Zip: `samples-for-matt.zip`
- DSP accepts `injectAudioBuffer` / `injectPlaylist` if HTTP/CORS fails in a build
