# Matt — Icecast on the MacMini (brief for Antigravity)

Paste this whole file into Antigravity as the task. It is accurate as of
2026-08-20 and every URL below was probed live.

## The server

An Icecast 2.4.4 server runs on David's Mac Mini, listening on **port 4250 on
all interfaces**. You can reach it three ways — try them in this order:

| Route | Host to use | Notes |
|---|---|---|
| Tailnet (MagicDNS) | `macmini` | preferred; works anywhere on the tailnet |
| Tailnet (raw IP) | `100.87.63.16` | fallback if MagicDNS is not resolving |
| LAN (mDNS) | `macmini.local` | only when on the same Wi‑Fi |
| LAN (raw IP) | `192.168.0.210` | fallback |

There is also a public HTTPS front for two of the mounts, if you are off the
network entirely: `https://finsburypark.tv/stream` and
`https://finsburypark.tv/marvin`.

**Gotcha:** this Icecast answers `HEAD` requests with `400`. Always probe with
`GET` (`curl -s -o /dev/null -w '%{http_code}'`), never `curl -I`. A `curl -I`
returning 400 does NOT mean the server is down.

Check what is live at any moment:

```bash
curl -s http://macmini:4250/status-json.xsl | python3 -m json.tool
```

## Part 1 — Listen to the two existing streams

Two mounts are currently broadcasting, both MP3 128 kbps stereo:

- **`/stream`** — "Hitchhiker FM", continuous constitutional transmission
  - `http://macmini:4250/stream`
- **`/marvin`** — "Marvin Station", a robot reads the wiki, reluctantly
  - `http://macmini:4250/marvin`

### VLC (recommended)

Install if needed, then open both:

```bash
brew install --cask vlc
```

```bash
open -a VLC http://macmini:4250/stream
```

In the VLC GUI the equivalent is **File → Open Network…** and paste the URL.
To have both playing at once, open a second VLC instance:

```bash
open -na VLC --args http://macmini:4250/marvin
```

### Alternatives

- Any browser: pasting `http://macmini:4250/stream` into Safari or Chrome
  plays it — the mount serves `audio/mpeg`.
- Terminal, no GUI: `ffplay -nodisp -autoexit http://macmini:4250/stream`
  (`brew install ffmpeg`).
- QuickTime is unreliable with Icecast — do not bother.

Do not use `mpv`/`ffplay` to "test" and then report failure without also
trying VLC; Icecast quirks bite the CLI players more often.

## Part 2 — Broadcast your own stream

There is a mount **reserved for you**: `/matt` ("Matt Live", up to 50
listeners). It is idle right now, so `http://macmini:4250/matt` correctly
returns 404 until you connect a source. Once you are streaming it will also be
live at `https://finsburypark.tv/matt`.

### Source connection settings

```
Server type : Icecast 2
Host        : macmini          (or 100.87.63.16)
Port        : 4250
Mount       : /matt
Username    : source
Password    : ask David — he is sending it separately, do not guess
Format      : MP3, 128 kbps, 44100 Hz, stereo
```

### Option A — BUTT (easiest, GUI, good for music)

```bash
brew install --cask butt
```

Open BUTT → **Settings → Main → Server → Add**, enter the settings above,
pick your audio input under **Audio**, then hit **Play**. Verify from the
terminal that the mount went live:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://macmini:4250/matt
```

`200` means you are on air. Confirm the metadata landed by checking
`status-json.xsl` for a source whose `listenurl` ends in `/matt`.

### Option B — ffmpeg from the command line

List your input devices first:

```bash
ffmpeg -f avfoundation -list_devices true -i ""
```

Then stream the mic (replace `:0` with the audio device index you found, and
`PASSWORD` with the one David sent):

```bash
ffmpeg -f avfoundation -i ":0" -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 -content_type audio/mpeg -f mp3 "icecast://source:PASSWORD@macmini:4250/matt"
```

To stream a file or playlist instead of the mic, swap the input:

```bash
ffmpeg -re -i track.mp3 -c:a libmp3lame -b:a 128k -content_type audio/mpeg -f mp3 "icecast://source:PASSWORD@macmini:4250/matt"
```

Keep the password out of shell history — put it in an env var read from a file,
or use BUTT.

### Option C — Ladiocast / Mixxx

Both speak Icecast 2 and take the same settings. Mixxx is the right choice if
you are DJing.

## Part 3 — Taking over the existing station (ask David first)

Hitchhiker FM's `/stream` mount has a **live door**: a Liquidsoap
`input.harbor` on **port 4261, mount `live`**. Anything connected there
*replaces* the station's playlist on `/stream` for as long as you stay
connected, then it falls back to the playlist automatically when you stop.

```
Host     : macmini
Port     : 4261
Mount    : live          (no leading slash in some clients)
Username : source
Password : separate harbor password — ask David
```

This pre-empts the main station output for everyone listening, so **do not
connect here without David's go-ahead**. Use `/matt` for anything
experimental. Note the port moved 4260 → 4261 on 2026-08-15; older notes
saying 4260 are stale.

## Constraints worth knowing

- Icecast is configured for a maximum of **4 concurrent sources**; 2 are
  permanently in use (`/stream`, `/marvin`), so there is room for `/matt` and
  the harbor, and no more.
- Port 4250 is **not** reachable from the open internet — you must be on the
  tailnet or the LAN to source a stream. Public listening goes through
  `finsburypark.tv` only.
- Do not restart Icecast. Restarting it drops the Hitchhiker FM `/stream`
  mount for roughly two minutes while Liquidsoap reconnects.
