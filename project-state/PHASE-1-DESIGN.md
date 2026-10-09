# Phase 1 design — Scene state and persistence (revised proposal)

Claude, 4 October 2026. **Revision 2.** This revision answers Codex's `outputs/PHASE-1-DESIGN-REVIEW.md`.

**It is still a draft for Matt and Codex to review.** It approves nothing, including S1. No code, save/load behaviour, UI, CSS or Rust was changed.

- **Checkout:** `work/aether-weave-v01-lab`, branch `feature/weave-v01`, HEAD `359fb12fee6651c4df0765c4ce81d6fab7e83843`.
- **Uncommitted work kept as is:** the earlier edits to `CURRENT.md` and `ACTIVITY.md`, and this file, which is untracked.
- **Binding UI rule:** nothing here changes proportions, fonts, nodes, colours, spacing, panel or canvas geometry, the toolbar, the inspector or the V/P/Z labels. Any visible or menu addition is listed as a decision in §7.
- **Example evidence:** the §1.9 example is a real file with real bytes. It was generated and checked by throwaway design scripts in `project-state/audits/phase1-design-2026-10-04/`:
  - `gen.py` generates the file;
  - `check.js` encodes the v1 rules and runs 13 rejection cases;
  - `check-output.txt` holds the run result.
  - These scripts are **not** S1 code.

## What changed from revision 1 (review item → section)

1. **Thread identity is separate from slot and colour.** A thread has a stable ID and a canonical colour token. Slot is an optional per-Scene display and runtime assignment. Source identity is its own concept. The model allows any number of threads; the four-slot limit is a separate compact-runtime capacity check. See §1.2, §1.3 and §1.5.
2. **The example is valid.** It uses real WAV and zip bytes, full SHA-256 values and a precise ID grammar. Validation rules now cover:
   - source-kind exclusivity;
   - references;
   - numeric ranges;
   - unique slots;
   - edge adjacency;
   - positive duration;
   - optional legacy fields.

   See §1.1, §1.7 and §1.9.
3. **Normal open is strict.** All referenced assets are checked before anything is replaced, and any failure rejects the open. A labelled recovery open is only a later proposal. Unreferenced assets are rejected, and size limits apply before decoding. See §3.2 and §3.8.
4. **No exact-rollback promise.** Outgoing resources are kept until the incoming ones succeed where feasible. The design states what is lost (private DSP state), that rollback itself can fail, and what a failure does to transport, master and motion. Implementation is deferred beyond S1. See §4.2.
5. **No autoplay.** Automatic same-source writes are now distinct from explicit, stopped full recall and rebind. Bindings check the Weave ID, thread and source identity, and a playlist's selected item counts separately for morph. Capture and DONE never erase detached slots' saved states. See §3.2–§3.5.
6. **Deduplication is by equal bytes only.** Derived or changed buffers are kept as an explicit playback override asset. Sample, bundle, playlist identity and morph compatibility are separate concepts. See §1.5 and §1.6.
7. **Duration is a policy structure.** v1 implements `{mode: "beats"}` only. `source` and `open` are reserved, with a migration rule. Motion stays `seconds-free`. Tempo 120 is a runtime limit, not a schema range. See §1.4.

---

# 0. Code facts the design depends on (unchanged from rev. 1 except item 8)

1. Weave Scenes are memory-only (`WeaveEngine.scenes`, `weave.js` l.58). The only real captured state is `spatialState` (x/y/z keyed by T1–T4). `levels` and `positions` are values computed for the view, and the seed Scenes use made-up ones. The `.aether` writer (`getCurrentSessionData`, `index.html` l.7060) stores no Weave data.
2. Scene `id`s are stable (`scene-N` and `scene-uid-N`). Playing, selected, editing, glide and Preview all use array indices. Rename, duration, duplicate and reorder don't exist.
3. Transition length, curve and mode are single global engine fields.
4. Tempo is fixed at 120. `masterBpm` (l.5721) is never written, and Weave reads `studio.currentBpm`, which doesn't exist. No tempo is saved.
5. Per-track `.aether` v3.1 fields are as listed in rev. 1. Project-level fields are `masterVolume` and `loudnessDb`.
6. `p0-roundtrip.aether` stores T1's audio as a re-encoded buffer **and** as original playlist bytes. It stores the Tick Tok bundle four times (zip plus JSON on two tracks), plus an absolute `file_path`.
   - **Correction:** rev. 1 called the T1 pair "the same audio". It is the same *source* in two forms (decoded-then-re-encoded versus original bytes). They are not byte-equal, and in general a track buffer can differ from its playlist file. See §1.6.
7. Native save is atomic (`replace_project`). Load prepares everything before replacing, but commits per track, not all-or-nothing.
8. **Corrected:** the frozen baseline (`3b087c2` and this checkout) rejects any `type` other than `aether_project` in `prepareSession`, and its dialogs only list `.aether` and `.json`. Whether *every* historical reader (5.1.1, the 6.0 line) refuses it has **not been tested**. That check is part of S5 native verification.
9. Motion uses wall-clock seconds × `motionSpeed`. Points are `{t, x, y, z?, generatedReturn?}`.
10. v2 manifests use typed `parameters`. Granular uses the track sample as a tape. No node exposes private state.
11. Opening a `.aether` doesn't touch the Weave. Its slot-keyed positions then drive whatever is loaded.
12. Host value ranges, from the strip controls and `setPosition`:
    - x and y are clamped to 0.02–0.98; z to 0–50.
    - EQ is −15 to +15 dB; gain −24 to +6 dB; motion speed 0.0001–2.
    - Master volume is 0–1; `prepareSession` accepts loudness from −18 to +12 dB.

---

# 1. Schema v1

## 1.1 ID grammar

| Entity | Pattern | Made by |
|---|---|---|
| Weave | `wv_` + lowercase UUID v4 (`^wv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`) | `crypto.randomUUID()` |
| Thread, Scene, edge | `th_`, `sc_`, `ed_` + the same UUID v4 form | same |
| Asset | `sha256:` + 64 lowercase hex characters (`^sha256:[0-9a-f]{64}$`) | hash of the exact stored bytes |

IDs are never reused, never derived from position or name, and never rewritten on reorder, rename or duplicate. Duplicating a Scene makes a new `sc_` ID and keeps thread and asset references.

## 1.2 Identity concepts (all separate)

| Concept | What it is | Stored as |
|---|---|---|
| **Thread** | A continuing musical voice across Scenes. "Same thread" means continuity is intended. | `threads[].id` |
| **Colour** | How a thread is shown. Always a canonical token (`track-1`…`track-4`), resolved by the app to `--track-1..4`, never an RGB value. | `threads[].color` |
| **Slot** | Where a thread sits on the compact canvas *in a given Scene*. Display and runtime assignment only. | `threadStates[t].slot` (optional, 0–3) |
| **Source identity** | Which content a thread plays: the bundle, the sample, or the playlist's item list. It ignores parameters, position and the selected item. | Computed, never stored (§3.4) |
| **Selected item** | For playlists, which item is the current one, plus any playback override. Part of morph compatibility, not source identity. | `source.playlist.index`, `source.override` |
| **Node type** | `manifestId` plus version. Names a type, never a thread or an instance. | `source.node.manifestId`, `version` |
| **Asset** | Exact bytes. | `assets` key |

**Compact v0.1 capacity, a separate runtime check and not a schema rule:**

- at most four active threads per Scene, each with a unique slot;
- each active thread sits in the slot that matches its colour token (`track-k` in slot k−1). That keeps today's canvas colours exactly as they are.

A document that breaks this is valid but **not playable in v0.1**. Preflight reports it plainly. `createWeave()` makes four threads coloured `track-1..4` by default, and the model accepts more.

## 1.3 Document

The validator rejects unknown fields. New fields require a `schemaVersion` bump with a migration.

| Field | Rule |
|---|---|
| `type` | `"aether_weave"` |
| `schemaVersion` | `1`. A reader refuses a higher version. |
| `id` | Weave ID (§1.1) |
| `name` | String, 1–120 characters |
| `createdAt`, `modifiedAt` | ISO-8601 UTC strings |
| `writer` | `{app, version}`, provenance only |
| `tempo` | `{bpm: 20–400, beatsPerBar: integer 1–16, source}`. The schema range is wide on purpose. **v0.1 runtime:** only 120 and 4 are playable, recorded as `source: "host-fixed"`. Anything else is valid but reported as not playable yet. |
| `master` | `{volume: 0–1, loudnessDb: −18 to +12}`. Weave-level (D6). |
| `assets` | Map of asset ID → asset (§1.6). Every asset must be referenced. |
| `threads` | Array of `{id, label (1–40 characters), color}`. IDs unique; there is no count limit in the schema. |
| `scenes` | Map of Scene ID → Scene. Its key equals `scene.id`. |
| `order` | Array of Scene IDs. Each Scene appears exactly once and nothing is missing. It may be empty in the schema (§3.2 covers opening an empty one). |
| `edges` | Exactly one per adjacent pair in `order`: `{id, from, to, overlapBeats ≥ 0, curve: lin, ease or late, mode: jump, morph or fade}`. Edges for pairs that aren't adjacent are rejected. |
| `ending` | `null` in v1, meaning "not defined". It does not mean wrap. |

## 1.4 Scene and duration policy

`{id, name (1–80 characters), duration, createdAt, modifiedAt, provenance, completeness, threadStates}`

- **`duration`** is a policy object.
  - v1 implements only `{mode: "beats", beats: finite, ≥ 0.25}`. The UI shows bars (beats ÷ `beatsPerBar`), and migration multiplies today's `bars` × 4.
  - **Reserved for later, rejected in v1 as "unsupported in this version":**
    - `{mode: "source", threadId}` uses the natural length of a source;
    - `{mode: "open"}` holds until a command.
  - Adding them later is a `schemaVersion` 2 change: v1 documents migrate unchanged because they use `beats`, and v1 readers refuse v2 files instead of misreading them.
- **`provenance`** is `{kind: "capture" | "import-aether", capturedAt, fileName?}`. It never holds a path.
- **`completeness`** is `{status: "complete" | "incomplete", reasons[]}`. A normal save only writes `complete` Scenes (§3.5).
- **`threadStates`** maps thread ID → ThreadState **only for threads active in this Scene**. A missing key means the thread is silent or absent. There are no `null` entries.

## 1.5 ThreadState

```
slot?:    0–3                                  // display/runtime placement (§1.2)
source:   { kind, <exactly the member that kind needs>, override? }
          kind "empty"      → no member
          kind "sample"     → sample:   { assetId }                       // audio with no original file
          kind "playlist"   → playlist: { items: [assetId, …≥1], index, shuffle, repeat }
          kind "node"       → node:     { bundleAssetId, manifestId, version, params, tapeAssetId? }
          kind "live-input" → external: {}                                // intent only
          kind "stream"     → external: { streamUrl }
          override?: { assetId, reason: "derived-buffer" }               // see §1.6
channel:  { gainDb −24…+6, eq: { low, mid, high: −15…+15 }, mute, solo }
spatial:  { x 0…1, y 0…1, z? 0…50 }           // z optional → 0 (legacy files lack it)
motion:   null | { points: [ {t, x, y, z?, generatedReturn?} ≥2, t non-decreasing ],
                   timeBase: "seconds-free", speed 0.0001…2, playing, captureBpm? }
unsupported: [ code ]
```

- **Exclusivity:** a source carries exactly the member its `kind` needs. A `node` source can't also carry `playlist`, and so on.
- **Node parameters** are finite numbers or booleans. Their IDs come from the bundle manifest and are not renamed. S1 checks only the types; checking against the manifest's ranges happens when bundles are unpacked (S5), not in S1.
- **Motion points** are copied exactly, including `generatedReturn` and a missing `z`. A later beat-based time base would be a new `timeBase` value; existing `seconds-free` points never change.
- **Morph compatibility** is computed, not stored. It is true only when two Scenes have the same thread, the same source identity, the same selected playlist item and override, and the same node type and version. A playlist source alone does not imply it. Phase 1 only *records* this; it doesn't use it.

## 1.6 Assets and the deduplication rule

`{kind: "audio" | "node-bundle", name, mime, bytes, origin, manifestId?, version?, storage: {kind: "inline-base64", data}}`

- **Equal bytes means the same asset, and nothing else does.** File name, slot or "same source" never merge two assets.
- **The capture policy (S4) applies per track.**
  - Store the playlist's original file bytes as playlist items.
  - Also store the live `audioBuffer` as an `override` asset (`origin: "rendered-buffer"`) **unless** the host can prove the buffer is the plain decode of the selected item.
  - S4 adds a runtime `_bufferOrigin` marker to track this. Until it exists, the conservative default keeps both. That costs space but never loses derived or changed audio.
  - Granular's tape is `tapeAssetId` and follows the same rule.
- **Bundles:** store the `.aethernode` zip (`origin: "aethernode-zip"`). Canonical unpacked JSON (`"unpacked-json"`) is a fallback only. `file_path` is never stored.
- **Storage is the container seam:** a later zip container uses `{kind: "zip-entry", path}` under a new `schemaVersion`.

## 1.7 Validation rules (structural, S1)

- Field types, the ID grammar, required fields and no unknown fields. Strings are bounded and numbers finite and inside the §1.3–§1.5 ranges.
- Every reference resolves:
  - order → scenes;
  - edge endpoints → adjacent order pairs;
  - every adjacent pair → exactly one edge;
  - threadState keys → threads;
  - asset IDs → assets of the right kind;
  - node `manifestId` and `version` → the bundle asset's metadata.
- Uniqueness: Scene, thread and edge IDs; slots within a Scene; Scene IDs within `order`.
- Playlist index inside its items; duration mode supported; `ending === null`.
- Every asset is referenced.
- Optional legacy fields (`z`, `generatedReturn`, `captureBpm`) may be missing and are kept exactly as given.
- **S1 checks structure only. S2 checks the bytes:** base64 round-trips, the length equals `bytes`, and the SHA-256 equals the key. S1 never claims a document is playable. The design check in `check.js` already does both on the example.

## 1.8 State that is absent, unsupported, private or external

The codes and meanings are unchanged from rev. 1: `node-private-state`, `live-input-not-stored`, `stream-external`, `tempo-host-fixed` (Weave-level), `motion-free-time`, `fade-not-implemented` (edge-level).

Never part of a Scene:

- HOLD, transport position, glide progress;
- Icecast output configuration, audio input device;
- the spatializer comparison path;
- inspector and panel UI state, bindings and runtime revisions.

## 1.9 Valid two-Scene example (S1 fixture candidate)

- **Assets:**
  - two real 16-frame, 8 kHz mono 16-bit WAVs (440 Hz and 660 Hz);
  - one real 630-byte stored zip, a **test-only** node `com.aether.test.fixture-pulse` with `manifest.json` and a syntax-valid `dsp.js`. It is test content, not a musical instrument.
- **Scene "Open water" (64 beats):**
  - T1 plays the playlist with item 0 selected, with a 3-point motion loop.
  - T2 plays the fixture node at level 0.5 with 4 steps.
- **Scene "Afterglow" (32 beats):**
  - T1 keeps the same thread and source identity but selects item 1, so it is **not** morph-compatible.
  - T2 is absent (an exit).
  - T4 enters with the same node type at different parameters, and leaves out `z` to show the legacy default.
- **Assets are stored once:** the bundle is used twice, and each audio asset is referenced from both Scenes.
- **Check result** (`check-output.txt`): the fixture has 0 errors. The 13 bad variants are all rejected: bad hash, missing asset, order pointing at a missing Scene, duplicate slot, mixed source kind, edge between non-adjacent Scenes, zero duration, reserved `source` mode, non-finite x, schema version too new, malformed ID, unknown thread, playlist index out of range. Python's `wave` and `zipfile` modules open the decoded assets.

```json
{
  "type": "aether_weave",
  "schemaVersion": 1,
  "id": "wv_0b6f2c1e-7d4a-4e8b-9c31-5a2f8e6d4b10",
  "name": "Fixture two-Scene Weave",
  "createdAt": "2026-10-05T19:00:00.000Z",
  "modifiedAt": "2026-10-05T19:10:00.000Z",
  "writer": {
    "app": "Aether Weave v0.1 Lab",
    "version": "weave-model/1"
  },
  "tempo": {
    "bpm": 120,
    "beatsPerBar": 4,
    "source": "host-fixed"
  },
  "master": {
    "volume": 0.8,
    "loudnessDb": 0
  },
  "assets": {
    "sha256:d63057c6b23c9a0498300dc7bd17a081c6092d47733b7c4e339a66f9c07ccaba": {
      "kind": "audio",
      "name": "fixture-a440.wav",
      "mime": "audio/wav",
      "bytes": 76,
      "origin": "original-file",
      "storage": {
        "kind": "inline-base64",
        "data": "UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAAOAP4R1YKAsuTC4TKf8eQRF4AYTxRuNt2EHSf9E81g=="
      }
    },
    "sha256:b522adc47b2becae2e0c6b427028c4d5b9fcc390762a3983eb91a9b10d34f367": {
      "kind": "audio",
      "name": "fixture-a660.wav",
      "mime": "audio/wav",
      "bytes": 76,
      "origin": "original-file",
      "storage": {
        "kind": "inline-base64",
        "data": "UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAADkXWCjeLhMpfRh4ARHqbdgu0TzWROYP/Z8UxCa7Lg=="
      }
    },
    "sha256:7fbf14ebd62962a158b788f56b9f785103dab5c4691aab350164b8e4d4a04b6a": {
      "kind": "node-bundle",
      "name": "Fixture Pulse",
      "mime": "application/zip",
      "bytes": 630,
      "origin": "aethernode-zip",
      "manifestId": "com.aether.test.fixture-pulse",
      "version": "0.0.1",
      "storage": {
        "kind": "inline-base64",
        "data": "UEsDBBQAAAAAAAAAIQAg0bn+KQEAACkBAAANAAAAbWFuaWZlc3QuanNvbnsiaWQiOiJjb20uYWV0aGVyLnRlc3QuZml4dHVyZS1wdWxzZSIsIm5hbWUiOiJGaXh0dXJlIFB1bHNlIiwidmVyc2lvbiI6IjAuMC4xIiwicm9sZSI6Imluc3RydW1lbnQiLCJpbnB1dHMiOjAsIm91dHB1dHMiOjIsImVudHJ5Ijp7ImRzcCI6ImRzcC5qcyJ9LCJpbnNwZWN0b3IiOiJob3N0IiwicGFyYW1ldGVycyI6W3siaWQiOiJsZXZlbCIsInR5cGUiOiJmbG9hdCIsIm1pbiI6MCwibWF4IjoxLCJkZWZhdWx0IjowLjV9LHsiaWQiOiJzdGVwcyIsInR5cGUiOiJpbnQiLCJtaW4iOjEsIm1heCI6OCwiZGVmYXVsdCI6NH1dfVBLAwQUAAAAAAAAACEALUb6gXkAAAB5AAAABgAAAGRzcC5qc2NsYXNzIEZpeHR1cmVQdWxzZXtjb25zdHJ1Y3Rvcigpe3RoaXMucGFyYW1zPXtsZXZlbDowLjUsc3RlcHM6NH19c2V0UGFyYW1ldGVyKGlkLHYpe3RoaXMucGFyYW1zW2lkXT12fXN0YXJ0KCl7fXN0b3AoKXt9fQpQSwECFAMUAAAAAAAAACEAING5/ikBAAApAQAADQAAAAAAAAAAAAAApAEAAAAAbWFuaWZlc3QuanNvblBLAQIUAxQAAAAAAAAAIQAtRvqBeQAAAHkAAAAGAAAAAAAAAAAAAACkAVQBAABkc3AuanNQSwUGAAAAAAIAAgBvAAAA8QEAAAAA"
      }
    }
  },
  "threads": [
    {
      "id": "th_3c9e1a52-8f04-4b7d-a6e2-91d05c7f3b28",
      "label": "T1",
      "color": "track-1"
    },
    {
      "id": "th_7a14d6e0-2b9c-4f53-8e71-c4a8b3f2d690",
      "label": "T2",
      "color": "track-2"
    },
    {
      "id": "th_c5e82f17-4a63-4d09-b1f8-6e2a97d3c541",
      "label": "T3",
      "color": "track-3"
    },
    {
      "id": "th_e91b4d38-6c27-4a85-9f0e-3d7c52a1b864",
      "label": "T4",
      "color": "track-4"
    }
  ],
  "scenes": {
    "sc_4f2a8c61-9e3b-4d70-a5c8-1b6e09f7d322": {
      "id": "sc_4f2a8c61-9e3b-4d70-a5c8-1b6e09f7d322",
      "name": "Open water",
      "duration": {
        "mode": "beats",
        "beats": 64
      },
      "createdAt": "2026-10-05T19:02:00.000Z",
      "modifiedAt": "2026-10-05T19:02:00.000Z",
      "provenance": {
        "kind": "capture",
        "capturedAt": "2026-10-05T19:02:00.000Z"
      },
      "completeness": {
        "status": "complete",
        "reasons": []
      },
      "threadStates": {
        "th_3c9e1a52-8f04-4b7d-a6e2-91d05c7f3b28": {
          "slot": 0,
          "source": {
            "kind": "playlist",
            "playlist": {
              "items": [
                "sha256:d63057c6b23c9a0498300dc7bd17a081c6092d47733b7c4e339a66f9c07ccaba",
                "sha256:b522adc47b2becae2e0c6b427028c4d5b9fcc390762a3983eb91a9b10d34f367"
              ],
              "index": 0,
              "shuffle": false,
              "repeat": true
            }
          },
          "channel": {
            "gainDb": 0,
            "eq": {
              "low": 0,
              "mid": 0,
              "high": 0
            },
            "mute": false,
            "solo": false
          },
          "spatial": {
            "x": 0.21,
            "y": 0.87,
            "z": 0
          },
          "motion": {
            "points": [
              {
                "t": 0,
                "x": 0.21,
                "y": 0.87,
                "z": 0
              },
              {
                "t": 0.5,
                "x": 0.4,
                "y": 0.7,
                "z": 0
              },
              {
                "t": 1.0,
                "x": 0.21,
                "y": 0.87,
                "z": 0,
                "generatedReturn": true
              }
            ],
            "timeBase": "seconds-free",
            "speed": 1,
            "playing": true,
            "captureBpm": 120
          },
          "unsupported": []
        },
        "th_7a14d6e0-2b9c-4f53-8e71-c4a8b3f2d690": {
          "slot": 1,
          "source": {
            "kind": "node",
            "node": {
              "bundleAssetId": "sha256:7fbf14ebd62962a158b788f56b9f785103dab5c4691aab350164b8e4d4a04b6a",
              "manifestId": "com.aether.test.fixture-pulse",
              "version": "0.0.1",
              "params": {
                "level": 0.5,
                "steps": 4
              }
            }
          },
          "channel": {
            "gainDb": -3,
            "eq": {
              "low": 0,
              "mid": 2,
              "high": -1
            },
            "mute": false,
            "solo": false
          },
          "spatial": {
            "x": 0.25,
            "y": 0.5,
            "z": 0
          },
          "motion": null,
          "unsupported": [
            "node-private-state"
          ]
        }
      }
    },
    "sc_8d17e3b5-0c42-4a96-b8f1-7e5c2a3d9064": {
      "id": "sc_8d17e3b5-0c42-4a96-b8f1-7e5c2a3d9064",
      "name": "Afterglow",
      "duration": {
        "mode": "beats",
        "beats": 32
      },
      "createdAt": "2026-10-05T19:08:00.000Z",
      "modifiedAt": "2026-10-05T19:10:00.000Z",
      "provenance": {
        "kind": "capture",
        "capturedAt": "2026-10-05T19:08:00.000Z"
      },
      "completeness": {
        "status": "complete",
        "reasons": []
      },
      "threadStates": {
        "th_3c9e1a52-8f04-4b7d-a6e2-91d05c7f3b28": {
          "slot": 0,
          "source": {
            "kind": "playlist",
            "playlist": {
              "items": [
                "sha256:d63057c6b23c9a0498300dc7bd17a081c6092d47733b7c4e339a66f9c07ccaba",
                "sha256:b522adc47b2becae2e0c6b427028c4d5b9fcc390762a3983eb91a9b10d34f367"
              ],
              "index": 1,
              "shuffle": false,
              "repeat": true
            }
          },
          "channel": {
            "gainDb": -2,
            "eq": {
              "low": 1,
              "mid": 0,
              "high": -2
            },
            "mute": false,
            "solo": false
          },
          "spatial": {
            "x": 0.5,
            "y": 0.3,
            "z": 4
          },
          "motion": null,
          "unsupported": []
        },
        "th_e91b4d38-6c27-4a85-9f0e-3d7c52a1b864": {
          "slot": 3,
          "source": {
            "kind": "node",
            "node": {
              "bundleAssetId": "sha256:7fbf14ebd62962a158b788f56b9f785103dab5c4691aab350164b8e4d4a04b6a",
              "manifestId": "com.aether.test.fixture-pulse",
              "version": "0.0.1",
              "params": {
                "level": 0.8,
                "steps": 6
              }
            }
          },
          "channel": {
            "gainDb": 0,
            "eq": {
              "low": 0,
              "mid": 0,
              "high": 0
            },
            "mute": false,
            "solo": false
          },
          "spatial": {
            "x": 0.75,
            "y": 0.4
          },
          "motion": null,
          "unsupported": [
            "node-private-state"
          ]
        }
      }
    }
  },
  "order": [
    "sc_4f2a8c61-9e3b-4d70-a5c8-1b6e09f7d322",
    "sc_8d17e3b5-0c42-4a96-b8f1-7e5c2a3d9064"
  ],
  "edges": [
    {
      "id": "ed_2e6b9f40-5d18-4c7a-9a3e-8f1c64b07d25",
      "from": "sc_4f2a8c61-9e3b-4d70-a5c8-1b6e09f7d322",
      "to": "sc_8d17e3b5-0c42-4a96-b8f1-7e5c2a3d9064",
      "overlapBeats": 32,
      "curve": "ease",
      "mode": "morph"
    }
  ],
  "ending": null
}
```

---

# 2. Persistence and container format (D1)

The recommendation is unchanged, but its compatibility claim is now precise.

- **Separate `.aetherweave`**, plus a deduplicated, content-addressed asset table. `.aether` stays the reusable state, with its reader and writer byte-for-byte unchanged (golden test).
- **Why not extend `.aether`:** the frozen baseline's `prepareSession` ignores unknown keys. It would open such a file and silently drop every Scene on its next save.
- **Why a separate type is safer:** a separate `type` is refused by the frozen baseline (fact 8). Other historical readers are untested, and S5 checks 5.1.1 natively.
- **Container:**
  - Phase 1 writes one UTF-8 JSON file with inline base64 assets, for small, measured documents only.
  - Saves are atomic, using the existing `replace_project`. Browser fallbacks are not atomic, and the notes say so.
  - Zip comes later, under a new `schemaVersion`.

---

# 3. Save and open semantics

## 3.1 Explicit document type, no toolbar change (D2)

- **The app tracks one active document:** "Aether state" or "Weave".
  - It is set by the last explicit Open or Save, or by the first real capture into a new Weave.
  - It is shown in the existing window title, `Aether Weave v0.1 Lab — <name>.<ext>`. Changing the title text is not a layout change, but it is listed under D2.
- **Proposed File-menu commands**, added to the macOS menu bar that `lib.rs` already builds (l.243–257):
  - **Open…** (both types; the dialog lists `.aether` and `.aetherweave`)
  - **Save Weave** and **Save Weave As…**
  - **Save Aether State As…**
  - These are a small, functional menu addition, which needs Matt's decision.
- **The toolbar** Save and Open buttons stay identical in look, proportions and position.
  - Save performs **Save** for the active document type.
  - With no active document, it keeps today's behaviour (Save Aether State).
  - Its meaning never changes just because a Scene exists.
  - Its tooltip text names the active type ("Save Weave" or "Save project"). The tooltip is text only and is under D2.
- **No hidden-only shortcuts.** ⌘S, ⇧⌘S and ⌥⌘S may mirror the menu items, but the menu is how you find them.

## 3.2 Opening a Weave: strict, prepared first, no autoplay (D4)

1. Check for unsaved Weave changes (§3.6).
2. Run size checks before parsing (§3.8).
3. Do a full structural validation (§1.7).
4. Check the bytes of **every** asset: base64, length and hash.
5. Decode every audio asset and unpack and syntax-check every bundle, in the prepare area.
6. Run the compact-capacity and tempo playability checks (§1.2, §1.3).

**Any failure rejects the open.** The current Weave, live sound, transport, master and motion are all unchanged, and the failure is named in the existing notes alert.

On success:

- **Transport is STOPPED.** If it was running, it is stopped first, as `.aether` load does today.
- The Weave session is replaced.
- Scene 01 is applied explicitly (§4.2) and its slots are bound.
- Scene 01 is selected. **Nothing plays** until Matt presses play.

**An empty Weave** (`order: []`) is valid in the schema, but v0.1 **refuses to open it** ("This Weave has no Scenes"), with everything kept. It also refuses to save one (§3.5). Nothing ever tries to apply a Scene 01 that doesn't exist.

**Recovery open:** an explicitly labelled "open what's readable" mode that marks broken Scenes incomplete is a *later* proposal. It is not in Phase 1.

## 3.3 Opening an Aether state while a Weave exists: detached (D3)

- `.aether` load is unchanged and replaces the live sound.
- The Weave is kept but becomes **detached**:
  - every slot binding is cleared;
  - **every automatic Weave write is suspended**: auto-advance moves, GO NOW moves, the auto-glide and Preview moves, and drag-end updates.
- Weave's own bar counter may keep running, as it does today, but it moves nothing.
- A toast says "Weave detached — live sound is now <file>. Apply a Scene (stopped) to reattach." The existing Set List and Loom don't change.
- Any *persistent* on-screen detached indicator would be a visible change and is a decision (D3).
- **Capture is still allowed while detached.** + SCENE turns the new live content into a new Scene, which binds its slots. That is the explicit way to bring outside content into the Weave.
- **Reattaching** means an explicit, stopped full apply of any Scene (§3.4).

## 3.4 Bindings: automatic writes versus explicit full recall

- Each live track carries a runtime-only binding: `{weaveId, threadId, sceneId, sourceIdentity, selectedKey}`.
  - `sourceIdentity` is `node:<bundle>`, `sample:<asset>`, `playlist:<item ids in order>`, `live-input`, `stream:<url>` or `empty`.
  - `selectedKey` covers the selected playlist item plus any override or tape asset.
  - Any source change outside Weave clears it (`_sourceRevision`).
- **Automatic writes** are glides during GO NOW, auto-advance or Preview, and drag-end spatial updates while in ADJUST.
  - They write only spatial data (Phase 1 keeps today's spatial-only transitions).
  - They act only on tracks whose binding matches the *active* Weave ID, the target thread and the target thread state's `sourceIdentity` and `selectedKey`.
  - They never write while the Weave is detached.
  - A skipped slot is reported once by toast and **never shown as a completed move**.
- **Explicit full recall (rebind)** is ADJUST on a Scene while **stopped**, after a successful preflight.
  - It applies the Scene's complete thread states: sources, parameters, channel, spatial and motion.
  - It binds the slots.
  - Binding checks never prevent this explicit stopped rebind.
- **ADJUST while playing (D5):**
  - Recall is allowed only for slots whose binding already matches. It sets parameters, channel and spatial.
  - Any slot that would need a different source is **not recalled**. ADJUST stays open with a toast naming those slots and "Stop to recall the full Scene". That Scene isn't marked as successfully recalled.

## 3.5 Capture, DONE and saving never erase detached data

- **+ SCENE** captures every slot as it is live, including detached content. That is the purpose of capture.
- **DONE, and drag-end during ADJUST,** update only slots bound to *that Scene*.
  - A detached or unbound slot keeps its saved thread state unchanged.
  - The toast lists slots that were not updated.
  - A slot is never removed from a Scene because it wasn't bound.
- **Saving** writes only `complete` Scenes. A Weave with zero real Scenes can't be saved as a Weave.

## 3.6 Unsaved changes

- The Weave is **dirty** after capture, DONE-update, delete, any model edit (rename, duration, duplicate, reorder) and edge edits. Saving clears it.
- These check for unsaved changes: Open (either type, if it would replace the Weave session), New Weave, and window close if the existing Tauri close hook is used.
- The check uses the native `confirm()`, so no layout change.
- `.aether` open under D3 detaches but does not replace, so it doesn't prompt.

## 3.7 Demo placeholders (D8)

- Today's three seed Scenes become a **demo set**: a separate, flagged, read-only list.
  - It is never part of the session model.
  - It is never saved.
  - It is never advanced, applied or edited.
- A fresh session shows the demo set in the existing Loom and Set List, so the visuals are unchanged.
- **Once real content starts** (the first + SCENE capture, or a Weave open), the demo set is removed from the active view and the real composition alone is shown, saved and played.
- The Loom keeps the same layout; it just shows the real Scenes.
- While only the demo set exists, GO NOW, auto-advance and Preview don't move anything (there is no state to apply). This is a behaviour change from today, so it is under D8.

## 3.8 Size and junk limits (D10)

- **Before reading:** Rust checks the file size from metadata and refuses anything over the ceiling before `read_to_string`.
- **Before parsing:** the JS side checks the string length again.
- **Before decoding:** the total declared `bytes` must be within the limit. The decoded-audio estimate (frames × channels × 4 bytes, from WAV headers or a first-pass decode limit) must be within a separate memory budget.
- Unreferenced assets are rejected (§1.7), so a document can't carry junk.
- The proposed ceiling of 256 MB per document is **a placeholder to be measured natively**, not a proven safe limit.

---

# 4. Capture and apply transactions

## 4.1 Capture

Unchanged from rev. 1, with §1.6's rule:

1. A synchronous snapshot of every control value at one moment.
2. Asynchronous encoding and hashing.
3. Refuse if any source identity changed meanwhile (`_sourceRevision`, playlist or bundle). Parameter or position moves during encoding don't matter, because step 1 fixed them.
4. A single synchronous commit, then bind and mark dirty.

## 4.2 Apply (explicit, stopped): honest preservation limits

**Prepare** is done off to the side, as in rev. 1, and touches no track.

**Commit:**

- **Order:**
  1. Create the incoming source objects first: decoded buffers ready, and a node instance built and syntax-checked *before* the outgoing one is disposed **where `AudioTrack` allows it**.
  2. Then swap.
  3. Dispose of the outgoing source only after the incoming one has initialised successfully.
- **Today's limit:** `loadNodeBundle` disposes the old DSP before building the new one (l.4897 onward). Keeping both needs a host change, scoped in S5. Until that exists, applying a node source is **dispose-then-create**.
- **What rollback can and can't restore:**
  - Sample and playlist sources: the old `AudioBuffer` and `File` objects are kept until success and reattached on failure. That is reliable.
  - Nodes: rollback re-creates the old node from its bundle and exposed parameters. **Private DSP state is lost** (grain buffers, random state, phases), and **re-initialisation itself can fail**.
  - Source buffers and plain objects don't prove that a DSP will initialise.
- **No all-or-nothing guarantee.** The report states exactly what was preserved.
- **What a failure leaves behind:**
  - Transport stays stopped, since apply always runs stopped.
  - Master volume and loudness are unchanged; apply never touches them.
  - Motion is stopped on failed slots and left as it was on untouched slots.
  - The Weave session isn't swapped (on open) or edited (on ADJUST).
  - A slot whose rollback also failed is left **empty and unbound**, with status "Scene apply failed — reload source". It is not left half-configured.
- **Live input:** apply never opens a device and never closes one opened outside Weave. `live-input` thread states record intent only, and the toast says to reconnect.

**This is implementation work after S1.** S1 contains none of it.

## 4.3 Saved versus runtime

Unchanged from rev. 1, plus the binding fields (§3.4), the detached flag and the demo set, which are all runtime-only.

---

# 5. Code integration map

The file and symbol targets are as in rev. 1, with these changes:

- **`desktop/weave-model.js` (S1, pure):**
  - Threads carry `color`, and slots live in thread states.
  - `checkCompactCapacity(doc)` is separate from `validateDocument(doc)`.
  - Duration uses the policy object, and IDs follow the §1.1 grammar.
  - It contains no hashing, no DOM and no audio.
- **`desktop/weave-assets.js` (S2):** hashing and byte checks, the deduplication rule, and size accounting.
- **`AudioTrack` (S4):** the binding fields and `_bufferOrigin`.
- **`AudioTrack` (S5):** an optional incoming-first node build, so the old node is disposed only after the new one succeeds.
- **`weave.js`:** detached state; the demo set as a separate view list; automatic writes behind the binding gate; ADJUST split into stopped full recall and playing same-source recall.
- **`lib.rs`:** the File-menu items (D2), the Weave dialogs, and the size check before reading.

Not in Phase 1 (unchanged): the tempo map, quantised scheduling, transport revisions for queued commands, parameter morph, real FADE and dual voices, HOLD, the ending, Preview isolation, and the label overlap.

---

# 6. Sequence and tests

The slices S1–S6 are as in rev. 1. Every slice after S1 also needs its own decisions approved: S4 needs D3, D5 and D8; S5 needs D1, D2, D4, D6 and D10. The test list gains:

- **Strict open:** corruption in **any** Scene's asset rejects the open with everything kept (replaces rev. 1 test 9).
- **No autoplay:** after a successful open the transport is stopped and only Scene 01 is applied.
- **Empty Weave:** refused on open and save, with nothing changed.
- **Detached:** after a `.aether` open, GO NOW, auto-advance, Preview and drag-end write nothing, capture still works, and a stopped ADJUST reattaches.
- **DONE with a detached slot:** that slot's saved thread state is byte-identical before and after.
- **Derived audio:** a buffer that is not proved to be the plain decode of its playlist item is saved as an override, and on reapply is used instead of the item.
- **Rollback honesty:** an injected DSP init failure gives the documented end state and report. There is no claim of exact restoration.
- **Old readers (native):** the frozen baseline and 5.1.1 both refuse a `.aetherweave` file.

---

# 7. Decisions for Matt (revised; none approved)

| # | Decision | Recommended default | Tradeoff |
|---|---|---|---|
| D1 | Weave format | Separate `.aetherweave` (inline JSON for now; zip later) | Old frozen baseline refuses it, and `.aether` is untouched. But it's a second file type. |
| D2 | Save and Open | Active document type; File menu: Open, Save Weave, Save Weave As, Save Aether State As. Toolbar Save does Save for the active type; window title shows name and type; tooltip text follows the type | No toolbar change and no context-switching meaning. But it adds menu items and changes title and tooltip text. |
| D3 | `.aether` open with a Weave | Keep the Weave, detach it, suspend all automatic Weave writes, toast. No persistent indicator for now. | Nothing lost and no misleading moves. But detached status is only told once, by the toast. |
| D4 | Weave open | Prepare everything, stop transport, apply Scene 01, **no autoplay**. Refuse empty Weaves. | Predictable. But it stops current playback. |
| D5 | ADJUST | Stopped: full recall and rebind after preflight. Playing: same-source slots only; others stay unrecalled and are reported. | No source cuts while playing. But full recall needs Stop. |
| D6 | Master level | Weave-level. Apply never changes master or live-input routing. | Simple and safe. But a Scene can't carry its own master level. |
| D7 | Transition panel | Per outgoing edge. Migration copies today's global length, curve and mode to every existing pair once, and the panel then edits the selected Scene's outgoing edge. | Matches what the panel shows. But edits stop applying to all edges at once. |
| D8 | Demo Scenes | A separate, unsaved, inert demo set, shown only until real content begins. With only the demo set present, GO NOW and auto-advance move nothing. | Real compositions stay clean and the visuals unchanged. But the demo stops "moving" the nodes. |
| D9 | Rename, duration, duplicate, reorder | Model and tests only; controls reviewed later | Proven without UI risk. But not usable from the app yet. |
| D10 | Limits | 256 MB per document as a placeholder, plus a decoded-memory budget, both enforced before reading and decoding. Measure natively before fixing them. | Avoids memory failures. But it limits long sample-heavy Weaves. |
| **S1** | Approve slice S1 only | §8 | Approving S1 decides none of D1–D10. |

HOLD, the ending, FADE behaviour and the reserved `source` and `open` duration modes are later-phase decisions.

---

# 8. S1: exact scope (pure model, tests and fixture; no app wiring)

**New files (exactly three):**

1. **`desktop/weave-model.js`**: a UMD module like `motion-loop.js`. No DOM, no Web Audio, no Tauri, no hashing. It exports:
   - `SCHEMA_VERSION = 1`, `ID_PATTERNS`, `newId(prefix)` (UUID v4 with a prefix);
   - `createWeave({name})`: four threads `track-1..4`, no Scenes, `ending: null`, tempo `{120, 4, "host-fixed"}`;
   - `validateDocument(doc) → {ok, errors[]}`, implementing every structural rule in §1.7 (no byte or hash checks);
   - `checkCompactCapacity(doc) → {ok, problems[]}`, kept separate from validation;
   - ID-keyed commands that return a new document and never change the input: `addScene`, `renameScene`, `setDuration` (beats only; reserved modes rejected), `duplicateScene`, `moveScene`, `deleteScene` (refuses the only Scene and a `protectedId` passed in);
   - `syncEdges(doc)`: keeps an edge's ID for an unchanged pair, adds a default edge (from passed values) for a new pair, drops edges for pairs that are no longer adjacent;
   - `sceneFromAetherState(session, ctx)`: maps a parsed v3.1 `.aether` object to thread states using **caller-supplied** asset IDs and thread IDs. No hashing, no I/O. Motion is copied exactly, and `unsupported` codes are filled in;
   - `deriveView(scene, threads)`: `levels` and `positions` for the existing Loom and mini-map.
2. **`tests/test-weave-model.js`**: run with plain `node`, like the other tests. It covers:
   - the fixture validates;
   - each §1.9 rejection case, plus: a thread-state key for an unknown thread; source-kind mixing; a bundle manifest mismatch; a missing edge for an adjacent pair; an unreferenced asset; an unknown top-level field;
   - stable IDs through duplicate, move and delete, with edges re-derived by pair;
   - commands leave their input unchanged;
   - motion points with `generatedReturn` and missing `z` survive migration exactly;
   - compact-capacity problems are reported without making a document invalid;
   - `deriveView` returns the same `levels` and `positions` as today's `onNodeDragEnd` for the same x/y.
3. **`tests/fixtures/weave-v1-two-scenes.json`**: exactly the §1.9 document (the copy in `project-state/audits/phase1-design-2026-10-04/`).

**Not touched in S1:**

- `index.html`, `weave.js`, `weave.css`, all markup, Rust, `launch-weave-v01.sh`, and the `.aether` reader and writer;
- no `<script>` tag is added; source lifecycle, save/load, bindings and activation are untouched;
- the throwaway design scripts are not used as S1 code.

**Verification:**

- `node tests/test-weave-model.js`, plus the existing `test-weave-spatial-recall.js`, `test-ticktok-v2.js` and `test-weave-swipe-gesture.js` all still passing;
- `git diff --stat` shows only the three new files plus project-state notes.

**Commit, only after Matt approves S1:**

- the three files, plus the design, CURRENT and ACTIVITY updates (this file and the evidence folder);
- message: `Weave v0.1 phase 1 S1: pure Scene model, validator and fixture (no app wiring)`;
- then stop for review.

---

# 9. S1 implementation record — 4 October 2026 (Claude), not committed

S1 is implemented as scoped in §8 and is awaiting Codex review. It is not committed, and S2 has not started.

- **Files:** `desktop/weave-model.js` (751 lines), `tests/test-weave-model.js` (498 lines, 29 tests), and `tests/fixtures/weave-v1-two-scenes.json`, which is byte-identical to the §1.9 evidence copy.
- **No wiring:** no `<script>` tag, and no change to `index.html`, `weave.js`, CSS, Rust, the launcher, save/load, the source lifecycle, DSP or the clock.
- **Tests:** `test-weave-model` 29/29, `test-weave-spatial-recall`, `test-ticktok-v2` 9/9 and `test-weave-swipe-gesture` all pass, and `git diff --check` is clean. The log is in `audits/phase1-s1-2026-10-04/test-run.txt`.
- **Sabotage checks** (each run on a scratch copy outside the repo) made the suite fail as expected:
  - no edge adjacency check: 1 test fails;
  - no duplicate-slot check: 1 fails;
  - no unreferenced-asset check: 1 fails;
  - commands mutating their input: 7 fail;
  - migration inventing z: 1 fails;
  - validator rethrowing: 1 fails.

**Places where the implementation adds detail to §8:**

- `deleteScene` also prunes assets that no remaining Scene references. Without that, deleting a Scene would leave an invalid document under §1.7's "every asset referenced" rule. It returns `removedAssets`.
- `addScene` takes caller-supplied assets in `opts.assets`, with no hashing. It refuses an existing ID that has different metadata.
- `sceneFromAetherState`:
  - keeps a saved buffer as a playlist `override` unless the caller sets `sampleEqualsSelectedItem: true`. Without either, it is an error, never a silent merge;
  - never copies `file_path`;
  - adds `captureBpm` only if the caller supplies one.
- Every command validates its input first and its result last, and returns `{ok: false, error}` instead of throwing or producing an invalid document.
- `checkCompactCapacity` also reports `tempo-not-playable` (anything other than 120 BPM in 4/4).
- Defaults are provisional until D1–D10 are decided: edge defaults (32 beats, ease, morph, matching today's engine), master volume 0.8, and four `track-1..4` threads.

**Not in S1:** payload decode and hash checks (S2), any app wiring, and any change in behaviour.

## 9.1 S1 correction after Codex review — 4 October 2026 (Claude), not committed

Codex found two migration gaps in `sceneFromAetherState`. Both were reproduced with regression tests before fixing them. Evidence: `audits/phase1-s1-2026-10-04/regression-before-fix.txt`, which records 29 passed and 2 failed, listing every broken case.

1. **Thread IDs.**
   - Before: IDs were checked only for being strings. Two tracks given the same ID silently overwrote each other: two empty tracks gave 1 thread state, and four gave 3.
   - Now: each migrated track needs a valid `th_<uuid v4>` that no other migrated track uses. A duplicate in an unused slot is ignored.
2. **Saved playlist buffer.**
   - Before: an `override` of `null`, `false`, `0` or another number skipped both keeping the buffer and the missing-override error.
   - Now: a supplied override must be `sha256:<64 lowercase hex>`, checked by syntax only (hashing stays in S2).
   - A saved buffer needs **exactly one** of a valid override or `sampleEqualsSelectedItem === true`. Both together is rejected as contradictory, and truthy look-alikes such as `"true"` or `1` don't count.
   - An override supplied for a track with no saved playlist buffer is rejected rather than ignored.

Inputs are deep-frozen in the new tests and checked to be unchanged. Results after the fix: weave-model 31/31, and the other three suites and every whitespace check pass. Evidence: `audits/phase1-s1-2026-10-04/test-run-after-fix.txt`. Correction diff: sibling `outputs/S1-correction-2026-10-04.diff`. The full current patch is `outputs/S1-weave-model-2026-10-04-r2.patch`, which applies to a clean `359fb12` and passes 31/31 there.

---

# 10. S2 implementation record — 4 October 2026 (Claude), not committed

S2 (asset integrity helpers) is implemented to the scope Matt approved on 4 October (`…-2/outputs/S2-PROPOSED-SCOPE-2026-10-04.md`), corrected after Codex's three reviews (§10.4–§10.6), and is awaiting Codex's checkpoint decision. It is not committed, S3 has not started, and D1–D10 remain unapproved. Baseline: S1 commit `1c253b0`, backed up to `origin/feature/weave-v01`.

**Files:** `desktop/weave-assets.js` (new, UMD like S1, ~420 lines) and `tests/test-weave-assets.js` (new, 28 tests). The S1 fixture is reused unchanged. No `<script>` tag, and no change to `index.html`, `weave.js`, `weave-model.js`, CSS, Rust, the launcher, save/load, the source lifecycle, DSP or the clock.

## 10.1 Public API and return contract

Every function that takes untrusted input returns a plain result object with `ok`; failures carry `error` (text), `code` and `path`, nothing throws, and nothing mutates its arguments. Two deliberate exceptions are synchronous utilities for trusted values: `encodeBase64` returns a string and throws a `TypeError` on non-binary input, and `base64LengthForBytes` returns a number or `NaN`. Codes: `bytes`, `base64`, `length`, `hash`, `key`, `container`, `storage`, `metadata`, `empty`, `limit`, `engine`.

- `toBytes(input)` → `{ ok, bytes }`. Accepts an `ArrayBuffer` or any `ArrayBuffer` view (`Uint8Array`, `DataView`, Node `Buffer`…). A view's `byteOffset` and `byteLength` are respected exactly; the backing buffer is never hashed by accident.
- `encodeBase64(bytes)`, `base64LengthForBytes(n)`, `decodedLengthOfBase64(str)` → shape-only length from string length and padding (no decoding, no allocation), `decodeBase64Strict(str)` → canonical base64 only: standard alphabet, length a multiple of 4, padding only at the end, zero unused trailing bits. Whitespace, line breaks and the URL alphabet are rejected.
- `sha256Hex(input, opts?)` (async) → `{ ok, hex }`. Uses `crypto.subtle.digest` (browsers and Node), with Node's `crypto` module as a fallback; `opts.engine` (`'subtle'` | `'node'`) selects explicitly and is used by the tests to exercise both paths. `assetIdForBytes(input)` → `{ ok, id: 'sha256:<hex>', byteLength }`.
- `checkLimits(limits)` → normalised limits. Allowed keys: `maxAssetBytes`, `maxTotalBytes`, `maxEncodedChars`, `maxAssetCount`, each a non-negative safe integer. Unknown keys and bad values are rejected. There is no default limit.
- `measureAssets(assets)` → `{ ok, errors, count, declaredBytes, encodedChars, projectedBytes }`. Accounting from declared metadata and the base64 shape; decodes and hashes nothing. These are unique stored bytes and their base64 text, not the serialized document size, decoded PCM size or DSP memory.
- `verifyAssets(assets, opts?)` (async) → `{ ok, errors, verified, totals }`. Preflight (key syntax, container shape, `storage.kind`, declared `bytes` versus the base64 shape, empty payloads, and all limits) runs over the whole table before any payload is decoded or hashed. Only when the whole table passes are payloads decoded, length-checked and hashed against their keys. On any error `verified` is `null`: there are no partially accepted payloads. On success `verified[id] = { bytes: Uint8Array, byteLength, kind }`.
- `addAssetBytes(assets, bytes, meta, opts?)` (async) → `{ ok, assets, id, deduplicated, asset }`. `meta` is `{ kind, name, mime, origin, manifestId?, version? }` (bundle fields only for `node-bundle`; the caller may not set `bytes`). After size preflight the exact input slice and the metadata fields are snapshotted; the same snapshot is hashed and stored. A duplicate is accepted only after the stored payload is decoded and compared byte for byte with the new bytes. The table is read once, before the `await` (§10.5). Limits: see §10.4 and §10.5. New bytes: a new table (shallow copy plus one entry; existing entries are the same objects) with `bytes` and canonical `inline-base64` storage. Identical bytes: `deduplicated: true`, a fresh table deeply equal to the input as it was when called is returned, and the existing entry's metadata is kept, whatever the new name, mime or origin (first writer wins; origin is never upgraded by a later claim). In both cases `asset` is `assets[id]` of the returned table (§10.6). Identical bytes claimed as a different `kind`, or as a bundle with a different `manifestId`/`version`, are rejected rather than silently replaced.

## 10.2 Policies decided inside S2 (provisional, not D1–D10)

- Empty payloads: `sha256Hex` of zero bytes works, but `verifyAssets` and `addAssetBytes` refuse a zero-byte asset (`code: 'empty'`). An empty audio file or bundle is never a usable asset.
- Deduplication is by bytes only. Different bytes with the same name stay two assets. A playlist `override` pointing at a `rendered-buffer` asset is left exactly as the caller stored it; S2 never infers that rendered audio equals an original file, and S1's `sceneFromAetherState` rule (explicit override or explicit equality proof) is unchanged.
- Limits are caller-supplied. There is no built-in 256 MB limit and no claim about a safe native memory budget; D10 is still to be measured and decided.

## 10.3 Evidence

- `node tests/test-weave-assets.js` 21/21; `test-weave-model` 31/31; spatial-recall, Tick Tok 9/9 and swipe pass; `git diff --check` clean; the two new files have no trailing whitespace. Log: `audits/phase1-s2-2026-10-04/test-run.txt`.
- Independent oracles: SHA-256 of `""`, `"abc"` and one million `a` match the published vectors through both engines; decoded fixture bytes are re-hashed with Node's `crypto` inside the test.
- Over-budget inputs fail before decode or hash work: a 4 MB payload with an illegal base64 character is rejected with only a `limit` error (2 ms), `crypto.subtle.digest` is counted at zero calls, and the same table without a limit reaches decoding and reports the `base64` error instead. Per-limit boundaries pass at the exact value and fail one unit over.
- Sabotage checks on a scratch copy (eight deliberate breaks, each caught): `audits/phase1-s2-2026-10-04/sabotage-checks.txt`.
- Pure/mocked only. Hashing ran through Node's WebCrypto and Node's crypto module; no browser, native app, listening or CPU work was done.

## 10.4 Corrections after Codex review — 4 October 2026 (Claude), not committed

Codex's source review found three gaps. Each was reproduced with a failing regression before the fix (`audits/phase1-s2-2026-10-04/regression-before-fix.txt`: 21 passed, 3 failed) and passes after it (`test-run-after-fix.txt`: 24/24).

1. **Duplicates were charged against limits.** `addAssetBytes` added the candidate's bytes, encoded size and count to the aggregate check before knowing whether the bytes were already stored, so re-adding identical content at an exact limit failed. Now a payload that could never fit (above `maxAssetBytes`, or alone above `maxTotalBytes`/`maxEncodedChars`) is still rejected before hashing. Aggregate limits charge only real growth. Because a duplicate can only be identified by hashing, the hash (bounded by `maxAssetBytes` when the caller supplies it) is taken first when some stored entry has the same byte count; when no entry has that count the bytes are certainly new and the aggregate check runs before hashing, as before.
2. **A matching key was trusted.** The dedupe path compared metadata only, so a corrupted payload under a correct-looking key was returned as a successful duplicate. Now the existing entry's payload is checked (canonical base64, declared and encoded length, then exact byte equality) before `deduplicated: true`; a mismatch is rejected with `code: 'hash'` (or `base64`/`length`) and the input is untouched. A hash-key claim alone is not proof.
3. **Input could change between hashing and encoding.** The caller's view was hashed, then after the `await` the same mutable view was encoded. Now the exact input slice is copied and the metadata fields captured after size preflight, and that snapshot is both hashed and stored; the regression scribbles over the bytes and metadata immediately after obtaining the promise and the result still verifies with the intended metadata. `verifyAssets` was reviewed for the same issue: it already captured each payload string at preflight, and now also uses the declared size and kind captured then rather than re-reading the caller's objects after the `await`. `sha256Hex`/`assetIdForBytes` hash the bytes as they are at call time without copying, and the header says so.

Also corrected: the header's contract now states the two deliberate exceptions (`encodeBase64` throws on non-binary input; `base64LengthForBytes` returns `NaN`) instead of claiming every function returns a result object. Five further sabotage checks cover the new guards (`sabotage-checks.txt`). Empty-asset rejection and first-writer display metadata stand as accepted for this unwired slice; no broader product decision follows.

## 10.5 Second correction after Codex review — 5 October 2026 (Claude), not committed

Codex accepted the three corrections in §10.4 and found one remaining aggregate-limit gap in `addAssetBytes`. Both parts were reproduced first (`audits/phase1-s2-2026-10-04/regression-before-fix-2.txt`: 24 passed, 2 failed) and pass after the fix (`test-run-after-fix-2.txt`: 26/26).

1. **An already-over-budget table was accepted on the duplicate path.** Re-adding the fixture's 76-byte WAV with `maxTotalBytes: 781`, `maxEncodedChars: 1047` or `maxAssetCount: 2` returned success although the existing table (782 bytes, 1048 characters, 3 assets) already broke the limit. Now, once the table is measured, any aggregate limit the existing totals already exceed is refused with `code: 'limit'` before hashing (digest calls: 0), duplicate or not. Duplicates still succeed at exactly the limits.
2. **Table accounting could drift across the `await`.** Totals were measured before hashing, but the live table was consulted and copied afterwards, so an entry added while hashing was pending reached the result and could bypass the limits. Now the table is read once, before the `await`: key order, entry references, measured totals, and for same-length candidates the fields a duplicate decision needs with the payload string by reference (strings are immutable; nothing large is copied). The result is derived from that snapshot. Entries the caller adds, removes or rewrites while the promise is pending are neither counted, consulted nor carried into the returned table, and on the duplicate path the returned `asset` is rebuilt from the snapshot. The regression grows the live table past the budget immediately after obtaining the promise; the result stays within the supplied limits, excludes the intruder and verifies. A second case swaps a stored payload mid-flight; the verdict reached on the snapshot stands.

A small consequence made explicit: a key that already exists with a different byte count than the new bytes is now reported as `code: 'length'` (the stored entry cannot be these bytes) instead of falling through to the growth check. The header documents the table snapshot contract. Four further sabotage checks cover the new guards (`sabotage-checks.txt`). The byte/metadata snapshot and payload-equality protections from §10.4 are unchanged.

## 10.6 Third correction after Codex review — 5 October 2026 (Claude), not committed

Codex accepted the over-budget-table refusal (§10.5) and found that the table snapshot was incomplete: the duplicate path still returned the live caller table as `assets`, and the new-entry path filled the result with live entry objects (including their mutable `storage` objects), so caller changes while hashing was pending, or afterwards, could leak into a returned table. Reproduced first with regressions on both paths (`audits/phase1-s2-2026-10-04/regression-before-fix-3.txt`: 25 passed, 3 failed, including the review-5 duplicate case extended to check the whole returned table); pass after the fix (`test-run-after-fix-3.txt`: 28/28).

Fix: before the `await`, one snapshot is taken of every entry (own fields copied, the `storage` object copied, the payload string shared by reference, since strings are immutable and nothing large needs copying), together with the key order and measured totals. Both success paths build a fresh table from that snapshot only: on a duplicate it is deeply equal to the input as it was when called; on new bytes it is the snapshot plus the new entry. `asset` is `assets[id]` of the returned table. The input table is never modified. Two identity assertions that expected the same table object back on dedupe were relaxed to deep equality, as Codex allowed.

Regressions cover both paths: an existing entry's payload and declared size rewritten mid-flight, a nested `storage` object replaced, keys added and deleted mid-flight, and later caller edits to its own entry objects. Every successful result is checked as a whole: the entire returned table verifies, `result.asset` deep-equals `result.assets[result.id]`, and the table satisfies every supplied limit. Three further sabotage checks each fail three tests (`sabotage-checks.txt`). This completes the correction Codex requested; nothing else changed.

---

# 11. S3 implementation record — 5 October 2026 (Claude), not committed

**Matt explicitly approved S3 only on 5 October 2026**, on `…-2/outputs/S3-PROPOSED-SCOPE-2026-10-05.md` revision 2 with three mandatory corrections: (1) every asset entry and its nested storage object is copied before the first `await`, not referenced; (2) path-only refusal applies only to sources that need embedded content — live-input and stream tracks ignore a leftover `filePath`; (3) digest counters stay in tests and evidence only, there is no `report.digestCalls`. The bare `file_name` display field is accepted in the JSON fallback. D1–D10 remain unapproved. Baseline: S2 commit `8718363`, backed up to `origin/feature/weave-v01`.

**Revision 1 of this design was not recoverable** (its Git history starts with revision 2 at S1), so the S3 boundary is the new one proposed and reviewed on 5 October: a pure legacy `.aether` import joining S1 and S2. It proves data migration only, not the native "old `.aether` loads" acceptance (S5).

**Files:** `desktop/weave-import.js` (new, UMD like S1/S2, ~585 lines, exported as `AetherWeaveImport`), `tests/test-weave-import.js` (new, 17 test groups), `tests/fixtures/aether-v31-tiny.json` (new, ≤ 5 KB synthetic v3.1 session built from the S1 fixture's own WAV and zip bytes; no paths, no private material). No `<script>` tag; no change to `index.html`, `weave.js`, `weave-model.js`, `weave-assets.js`, CSS, Rust, the launcher, save/load, the source lifecycle, DSP or the clock. S1 and S2 are byte-identical (md5 `e48af481…` and `11062ace…` before and after).

## 11.1 Public API and return contract

Same contract as S2: result objects, nothing throws, nothing mutates its arguments. Failures carry `error`, `code`, `path`, `track` where applicable, and `stage: "preflight" | "growth"` on limit failures. Codes: S2's set plus `session`, `track`, `thread`, `model`, `conflict`, `path-only`, `bundle-metadata`, `encoding`.

- `canonicalJsonBytes(value)` → `{ ok, bytes, text }`: keys sorted by UTF-16 code units at every level, arrays in order, `JSON.stringify` escapes and number text, no whitespace, UTF-8. Only plain objects, arrays, strings, finite numbers, booleans and `null`; anything else (including cycles, `Date`, `Map`) is `code: "encoding"`.
- `extractAetherAssets(session, assets, opts?)` (async) → `{ ok, assets, perTrack, report }`; on failure `assets` and `perTrack` are `null` (never a partial table). `perTrack[index]` is exactly S1's `ctx.assetIds[index]`.
- `importAetherState(doc, session, ctx?, opts?)` (async) → `{ ok, doc, sceneId, report }`; `doc` is S1's validated clone; on failure `doc` is absent and the input document unchanged. `ctx`: `threadIds`, `name`, `fileName`, `durationBeats`, `captureBpm`, `now`, `uuid`, `index` (unknown keys refused; `manifestId`/`manifestVersion` are deliberately not accepted). `opts`: `limits`, `allowOmissions`, `verifyExisting`, `engine`.
- **Snapshot:** before the first `await` the import captures the session's relevant nested values (payload strings by reference), a deep copy of every asset entry including its `storage` object, a deep clone of the document, the thread mapping, ctx values and S2-normalised limits; the result derives from these only. In a browser the module uses the `AetherWeaveModel`/`AetherWeaveAssets` globals and fails with `code: "engine"` (never throws) if they are absent.
- **Precedence and content loss:** S1's order (node → live-input → stream → playlist → sample → empty). Unreferenced payloads (a node track's playlist; a live-input/stream track's buffer or playlist) are `code: "conflict"` by default; with `allowOmissions` they are left out and disclosed as Scene `completeness: { status: "incomplete", reasons: [...] }` and in the report. A would-be empty track or a node track with neither zip nor bundle whose `filePath` is set is `code: "path-only"`. No path is stored, echoed or reported.
- **Equality proof:** `sampleEqualsSelectedItem` is set only when S2 returns `deduplicated: true` (stored payload compared byte for byte) with the selected playlist item's ID; otherwise the buffer is a `rendered-buffer` override.
- **Node bundles:** zip → `aethernode-zip` with `manifestId`/`version` as the session declares them (`bundleMetadataVerified: false` in the report; zip not opened); zip present without manifest id/version → `bundle-metadata`; zip absent with a bundle → `unpacked-json` of `canonicalJsonBytes({ file_name, manifest_raw, manifest, ui_html, dsp_wasm_base64, dsp_js })` with `file_path` excluded; neither → `track`.
- **Limits:** `stage: "preflight"` refusals happen before any decode or hash (existing table already over; one payload over `maxAssetBytes` or alone over an aggregate; certain growth — payloads whose length matches no stored entry and no other payload — over an aggregate). `stage: "growth"` is a limit S2 reports after hashing same-length candidates. Both all-or-nothing.
- **Existing assets:** structural check (`measureAssets`) by default, bytes only for what the import adds or deduplicates onto, `existingVerified: false`; with `verifyExisting` S2 `verifyAssets` runs first and `existingVerified: true`.
- **Master:** the document's `master` is kept; `report.legacyMaster = { masterVolume, loudnessDb, imported: false }`.

## 11.2 Evidence (`audits/phase1-s3-2026-10-05/`)

- `test-run.txt`: `test-weave-import` 17/17, `test-weave-model` 31/31, `test-weave-assets` 28/28, spatial recall, Tick Tok 9/9 and swipe all pass on the Mac (Node 22.23.2). `git diff --check` clean; no trailing whitespace in the new files.
- Test 1 compares the imported document with an oracle built from S1 primitives and Node `crypto` alone; test 13 mutates the session, table, document, ctx and limits while the promise is pending; test 10 separates preflight (digest counter 0) from growth (digest counter > 0) limit failures; test 12 loads the module in a browser-style context without S1/S2 and expects a clean `engine` failure.
- `sabotage-checks.txt`: 16 deliberate breaks on a scratch copy outside the repository (`sabotage.py`), each caught — including table-by-reference, legacy master applied, live session read after the `await`, certain-growth dropped, path-only allowed, zip metadata invented, `file_path` kept, omitted payload stored, existing assets reported verified.
- `migration-output.json`: the report and resulting document for the fixture session, plus a conflict example and an `allowOmissions` example.
- Pure/mocked only: no browser, native app, listening or CPU work. Nothing here is the native "old `.aether` loads" acceptance.

## 11.3 Corrections after Codex review — 5 October 2026 (Claude), not committed

Codex's source review of S3 found three gaps. Each was reproduced with a failing regression first (`audits/phase1-s3-2026-10-05/regression-before-fix.txt`: 17 passed, 3 failed against the unfixed module, md5 `23f0464d…`) and passes after the fix (`test-run-after-fix.txt`: 20/20, module md5 `54a88a3c…`, plus the five existing suites).

1. **Malformed supplied state was converted to absence or a default.** A non-array `motionPath`, a non-object `eq` or `customNodeParams`, a non-string `name`/`sampleName`/`filePath`/`streamUrl` or playlist item `type`, a non-integer `playlistIndex`, and empty-string `sampleData`/`customNodeZipBase64` were silently treated as "not supplied". Now they are refused: `code: "track"` with the field path and track (`code: "empty"` for the empty strings), inputs untouched, no document and no partial table. Legitimate absence from the current writer (`null` payloads, bundle and params; undefined `motionPath`, `eq`, `z`; `filePath: ''`; empty playlist) still imports (test 18).
2. **Cyclic nested data rejected the promise.** `deepCopy` recursed without cycle detection, so a cyclic `eq`, `motionPath`, `customNodeParams` or existing-table entry produced a `RangeError` rejection. `deepCopy` now detects cycles and both public async functions resolve to structured failures: `session` with the field path and track, `container` with the asset key, `encoding` for a cyclic bundle (already handled), and a last-resort `engine` for any unexpected throw. Messages are fixed text; no input value is echoed. `assets`/`perTrack` stay `null` on extraction failure (test 19, including a throwing getter that reaches the last-resort guard).
3. **`canonicalJsonBytes` mishandled sparse arrays.** `Array.prototype.map` skipped holes, so `[1, , 3]` encoded as the invalid text `[1,,3]` and `[ , ]` as `[]` (contents changed). Holes are now refused with `code: "encoding"` and the offending path, consistent with the refusal of `undefined` entries; dense arrays, including `null` entries and nested empties, round-trip through `JSON.parse` exactly (test 20, including a sparse `manifest.parameters` surfacing as an import failure on its track).

Also: the module header states the taken-as-written rule and the resolve-never-reject rule. Nine focused sabotage checks cover the new guards (`sabotage-checks-2.txt`: 25/25 caught, on a scratch copy outside the repository). S1 and S2 remain byte-identical; nothing else changed. D1–D10 remain unapproved.

## 11.4 Fourth correction after Codex review — 5 October 2026 (Claude), not committed

Codex asked that the last-resort unexpected-error result be completely independent of the thrown value. The guard read `e.name` to build its message, so a thrown object whose `name` getter itself throws escaped as a rejected promise (reproduced: `audits/phase1-s3-2026-10-05/regression-before-fix-2.txt`, 19 passed, 1 failed against module md5 `54a88a3c…`). Now `unexpected()` takes no argument and returns the fixed object `{ ok: false, error: 'unexpected internal failure during import', code: 'engine', path: '' }`; the thrown value is not read, stringified or inspected at all. Regressions in test 19 throw, from an input getter in each public async function, (a) an object whose `name` getter throws and whose `toString` throws, and (b) an `Error` whose custom name carries a private marker; both functions resolve to exactly the fixed result (extract with `assets`/`perTrack` `null`) and no marker appears anywhere in the result. After the fix: `test-run-after-fix-2.txt` 20/20 plus the five existing suites; `sabotage-checks-3.txt` 27/27 (two new cases: reading `e.name`, and stringifying `e.message` into the result). Module md5 `3e60243f…`. S1/S2 and app/UI byte-identical; D1–D10 unapproved.

# 12. S4 — live capture, bindings and gated writes — 5 October 2026 (Claude), implemented, NOT committed

**Approval:** Matt explicitly approved S4 proposal revision 2 (`…-2/outputs/S4-PROPOSED-SCOPE-2026-10-05.md`) on 5 October 2026 with Codex's four final conditions, plus D3, provisional D5 and D8. D1, D2, D4, D6, D7, D9 and D10 remain unapproved. Base: `feature/weave-v01` at `ed0cad7` (S3 checkpoint; origin at the same hash).

**Codex's four conditions and how each is met:**

1. *S1–S3 modules and their tests unchanged; capture uses S3 `extractAetherAssets` plus S1 `sceneFromAetherState`/`addScene`; capture provenance set in S4 composition; no S3 provenance extension.* `weave-model.js`, `weave-assets.js`, `weave-import.js` and their three suites are byte-identical (md5 `e48af481…`, `11062ace…`, `3e60243f…`; tests unchanged in `git status`). `WeaveEngine.captureCurrentScene()` calls S3 `extractAetherAssets(session, doc.assets)` for the asset table, then S1 `sceneFromAetherState` with the S3 `perTrack` mapping, sets `scene.provenance = { kind: 'capture', capturedAt }` itself, and commits through S1 `addScene(latestDoc, scene, { assets })` followed by S1 `validateDocument` and `checkCompactCapacity`. The proposed `ctx.provenanceKind` S3 extension was dropped.
2. *Copy origin metadata while preserving actual File/AudioBuffer references; no deep copy of referenced objects.* `_pressSnapshot()` stores `bufferRef = track.audioBuffer`, `playlistRefs = track.playlist.slice()` (same `File` objects) and `origin = Object.assign({}, track._bufferOrigin)` — a shallow copy whose `bufferRef`/`fileRef` are the live references. Session test 17 proves the references are identical (`===`) and that the origin copy is not the live object.
3. *Suspension released on every exit including errors; overlapping operations must not release each other's suspension.* `onSourcesReplacing()` returns a fresh token per call; `onSourcesReplaced(token, info)` deletes only that token from a `Set`; `suspended` is `size > 0`. The host wrappers `_applySession` and `rebuildAudioGraph` issue the token before calling the renamed cores (`_applySessionCore`, `_rebuildAudioGraphCore`) and release in `finally`. Host tests H8–H11 and session test 14 cover success, throw, early return and two overlapping tokens.
4. *Exercise the actual modified host methods with mocked dependencies; mirrored implementations and source-text checks are insufficient.* `tests/test-weave-host.js` extracts the real `AudioTrack` and `SpatialStudio` class source from `desktop/index.html` (brace-matched) and evaluates it in a `vm` context with stubbed leaf dependencies (audio context, decoder, DOM, storage); H1–H11 call the real `_noteSourceReplaced`, `clearSource`, `connectLiveInput`, `loadStreamUrl`, `_loadAudioFile`, `loadDemoStems`, `stopNodeOnly`, `_applySession`/`_applySessionCore`, `rebuildAudioGraph`/`_rebuildAudioGraphCore`. H12 is the only markup check (script order).

## 12.1 Files

- `desktop/weave.js` (modified, +570/−120 by `git diff --stat`; md5 `9758fbc0…`). The view list `this.scenes` is now derived from `this.session.doc` (S1 document) or, when the document is empty, from the read-only demo set (D8). Adds: `session` (`available`, `doc`, `epoch`, `docRevision`, `detached`, `dirty`, `demo`), suspension set, capture sequencing (`_captureSeq`, `_captureChain`, `_pendingCaptures`), `_previewToken`, `_skipReported`; methods `captureCurrentScene`, `_pressSnapshot`, `_recheckAgainstPress`, `_pruneByOrigin`, `_bindSlots`, `bindingFor`, `bindingValid`, `_slotMatchesScene`, `glideSlotWritable`, `adjustRecallWritable`, `adjustEditWritable`, `onSourcesReplacing`, `onSourcesReplaced`, `get suspended`, `syncViewFromDoc`, `_viewFromSpatial`, `_threadIdForSlot`, `_demoRows`, `_toast`, `_nowIso`; gated `startGlide`/`stepGlide` (per frame), `previewTransition` (token in the delayed callback), `adjustScene`/`tweakScene` (bound spatial recall), `onNodeDragEnd` (bound-and-same-Scene slots only, cloned document, validate + capacity, `docRevision++`), `deleteScene` (S1 `deleteScene` with the playing Scene protected; demo refused). `_nextSceneUid` removed. The literal `levels`/`pan` formula lines that S1's test greps for are kept in `_viewFromSpatial`.
- `desktop/index.html` (modified, +62; md5 `4fe19c88…`). Three `<script>` tags (`weave-model.js`, `weave-assets.js`, `weave-import.js`) before `weave.js`; `AudioTrack` fields `_bufferOrigin`/`_weaveBinding` (runtime only, never saved); `_noteSourceReplaced()` (revision bump + origin cleared; deliberately not in `cleanupSources` nor the transport paths); calls in `clearSource` (origin), `connectLiveInput`, `loadStreamUrl`, `loadDemoStems` (`{ kind: 'synthetic' }`); `_loadAudioFile` records `{ kind: 'decoded-item', revision, bufferRef, fileRef }`; `rebuildAudioGraph` → wrapper + `_rebuildAudioGraphCore` (bumps every track, restored buffers `{ kind: 'rebuilt' }`); `_applySession` → wrapper + `_applySessionCore` (restored saved buffers `{ kind: 'session' }`; `replaced: true` only when the core returns; `failures` from the core's result). No CSS, Rust, launcher, save/load format, DSP, clock, FADE, HOLD, ending or old-Lab change.
- `tests/test-weave-session.js` (new, 18 tests, 505 lines): WeaveEngine against a writer-like `getCurrentSessionData` mock (sync snapshot, async encode), mock tracks with the host discipline, a frozen S3 wrapper with `hashHooks` to act during hashing, fake timers and a fake performance clock.
- `tests/test-weave-host.js` (new, 12 tests, 265 lines): real host classes as described under condition 4.
- `tests/test-weave-swipe-gesture.js`, `tests/test-weave-spatial-recall.js` (updated): load S1–S3 on `window`, provide the writer mock, await captures, expect D8 (first capture → one real row, demo gone) and S1 IDs (`sc_<uuid>`); the gesture, ADJUST, DONE, deletion-guard and overflow assertions are otherwise the same.
- `project-state/audits/phase1-s4-2026-10-05/`: `test-run.txt`, `sabotage-s4.py`, `sabotage-checks.txt`, `browser-check.js`, `browser-check.json`, `browser-01-fresh.png`, `browser-02-after-capture.png`, `browser-03-adjust.png`.

## 12.2 Capture transaction (as implemented)

Press → `_pressSnapshot()` (per slot: `sourceRevision`, identity, selected key, `bufferRef`, `playlistRefs`, origin copy; plus `epoch`, `docRevision`, `playingIndex`) → `studio.getCurrentSessionData()` (unchanged writer; sync snapshot, async encode) → `_pruneByOrigin()` (`sampleData` dropped only when the press origin is `decoded-item` with the same revision, the same buffer object and the selected playlist `File`; `rebuilt`, `session`, `synthetic` and `null` origins keep the rendered-buffer override) → S3 `extractAetherAssets` (hashing; captures may overlap here) → serialized commit turn on `_captureChain` → `_recheckAgainstPress()` (epoch, every slot's revision/identity/selection/buffer/playlist references, suspension, detached) → compose with S1 onto `this.session.doc` as it is *now* (not the press-time document, so deletions and ADJUST edits made during hashing survive) → validate + `checkCompactCapacity` → commit, `_bindSlots()` (binding `{ weaveId, threadId, sceneId, sourceIdentity, selectedKey, sourceRevision }` on each track), `docRevision++`, `dirty`, `detached = false`. Result: `{ ok, sceneId, captureId, index, pruned }` or `{ ok: false, code }` with codes `unavailable`, `suspended`, `detached`, `refused`, `writer`, `changed`, `asset`, `model`, `capacity`, `conflict`, `stale`. A failed turn never blocks the next (`_captureChain = turn.catch(() => {})`); press order is kept.

Binding validity is lazy: `bindingValid(track)` requires `track._sourceRevision === binding.sourceRevision` and the same identity/selection. Gates: `glideSlotWritable(k, sceneId)` evaluated per frame in `stepGlide` and inside the delayed Preview callback (plus `_previewToken` for a newer Preview, suspension, detach); `adjustRecallWritable(k, sceneId)`; `adjustEditWritable(k, sceneId)` additionally requires `binding.sceneId === sceneId`. Skipped slots are reported once per slot per glide (`_skipReported`). D3: `onSourcesReplaced` with `replaced: true` on a non-empty document sets `detached = true`, clears every binding and shows the toast; a failed preflight (`replaced: false`) does not detach. D8: demo rows are `demo: true`, cannot be adjusted, deleted or captured over; GO NOW/auto-advance/Preview on the demo set move nothing; the first successful capture replaces the set.

## 12.3 Evidence (`audits/phase1-s4-2026-10-05/`)

- `test-run.txt` (Mac, Node 22.23.2): `test-weave-session` 18/18, `test-weave-host` 12/12, `test-weave-model` 31/31, `test-weave-assets` 28/28, `test-weave-import` 20/20, spatial recall, Tick Tok 9/9 and swipe all pass. `git diff --check` clean.
- Revision-2 acceptance cases in the session suite: source change after encoding and before commit (test 4, including while queued behind another capture); deletion during hashing (5); ADJUST drag-end during hashing (6); failed-then-successful capture in press order (7); stale epoch (8); every replacement path invalidates, transport does not (9); per-frame glide gating and once-only reporting (10); demo-only behaviour (11); delayed Preview cancelled by invalidation, suspension or a newer Preview (12); provisional D5 same-source/different-Scene refusal and DONE writing nothing (13); suspension/detach outcomes (14); live-input and stream replacement (15); capacity and validity before every commit (16); immutability and reference preservation (17); engine without the model scripts (18).
- `sabotage-checks.txt`: 23 deliberate breaks on a scratch copy outside the repository (`sabotage-s4.py`), each caught by the named suite — including composing onto the press-time document, skipping the recheck, ignoring the buffer reference or the epoch, binding after a failed recheck, origin proof from the live origin, drag-end without the same-Scene requirement, glide gate at start only, token-less delayed Preview, releasing all suspensions, adjustable demo Scenes, a failed capture blocking later ones, import provenance, detach without replacement, revision bump in `cleanupSources`, unmarked live-input/stream/demo-stem replacement, wrong `fileRef`, `replaced: true` after a throw, rebuild not releasing on error, rebuilt/session origins dropped.
- Browser check (headless Chromium in the cloud container against the Lab page served from the working tree; `browser-check.js`/`browser-check.json`): S1–S3 and the engine load (`available: true`); the demo set renders exactly as before; a real `getCurrentSessionData` capture produces `Scene 01` with provenance `capture`, a valid document, four `empty` bindings and no demo rows; a second capture plus a JUMP GO NOW moves the bound slots; ADJUST recalls the bound positions, a drag-end writes `{ x: 0.33, y: 0.66, z: 0 }` into that Scene only, DONE renders, `docRevision` reaches 3; detach via the real hooks blocks further moves. Console: only the pre-existing Google Fonts fetch (blocked by the sandbox proxy) and the optional WebSocket notice. Layout rectangles — left panel `[7,57,299,835]`, inspector `[1134,57,299,835]`, arena `[319,56,802,837]`, toolbar `[6,4,1428,46]` — and the three screenshots match the 4 October baseline (BUILD/PLAY, + SCENE, Loom rows, T1–T4 nodes with V/P/Z labels, inspector, curve/JUMP-MORPH-FADE controls); differences are environmental only (fallback font, no loaded audio, 1440×900 viewport).

## 12.4 Limitations and separate checkpoints

- Headless Chromium is not the native app: no Tauri launch, no audio device, no listening. Native launch via `launch-weave-v01.sh`, the Phase 0 build/install, and Matt's three listening checkpoints (L1 capture during playback, L2 GO NOW/auto-advance with bound sources, L3 ADJUST/Preview) are separate approvals before S4 acceptance.
- Capture performance was not measured natively; the unchanged writer still encodes buffers and decodes playlist files even when `sampleData` is pruned. If a real session shows audio degradation during capture, worker/chunked encoding is a separate scope.
- S4 ADJUST is bound spatial recall only (provisional D5); full recall, rebind, reattach, prepare/apply, open/save/file/menu, FADE/HOLD/ending and D1/D2/D4/D6/D7/D9/D10 remain S5+.
- Not committed: HEAD is still `ed0cad7`; `.git/HEAD.lock` and `.git/objects/maintenance.lock` are untouched and still need Matt's delete approval before the next commit. No push, merge, branch change, launch, build or install.

## 12.5 Corrections after Codex review — 5 October 2026 (Claude), not committed

Codex reviewed the S4 source against `ed0cad7` and asked for four bounded corrections. Each engine/host gap was reproduced with a failing regression first (`audits/phase1-s4-2026-10-05/regression-before-fix.txt`: session 18 passed / 2 failed, host 11 passed / 2 failed against the unfixed sources, weave.js md5 `9758fbc0…`, index.html `4fe19c88…`) and passes after the fix (`test-run-after-fix.txt`: session 20/20, host 13/13, model 31/31, assets 28/28, import 20/20, spatial recall, Tick Tok 9/9, swipe; `git diff --check` clean). After: weave.js md5 `b1696cbf…`, index.html `52bf3c0f…`. S1–S3 and their tests remain byte-identical.

1. **Deletion lost the playing, selected and editing identities.** `syncViewFromDoc()` clamps indices to the new length before `deleteScene` decremented them, so with three Scenes and the last one played/selected/edited, deleting the first clamped the index to 1 and then decremented it to 0 — the references silently moved to a different Scene. Now `deleteScene` remembers the playing, selected and editing rows by stable S1 ID before the document change and re-resolves them with a new `sceneIndexById(id)` afterwards; deleting the edited Scene itself ends ADJUST (`editingIndex = null`). Regression: session test 19 (three captured Scenes, last one playing + selected + adjusting, delete the first: all three references keep the Scene 03 ID; then deleting the edited Scene ends ADJUST while the other identities are kept). The browser check repeats it through the real delete swipe.
2. **Delayed jump Preview recomputed its target from the mutable `selectedIndex`.** Previewing from Scene 01 and then selecting Scene 02 before the one-bar callback moved the nodes to Scene 03. The callback now carries the intended target by Scene ID captured at Preview time, and before executing it re-validates: the Preview token, suspension/detach, and that the Scene still exists in the view (a deleted target cancels; a replaced set cancels). Regression: session test 20 (selection change while waiting → the originally intended Scene; target deleted while waiting → nothing moves; a Scene appended while waiting shifts indices but the move still reaches the intended Scene). Note: `moveToScene` already ignores an absent index, so the explicit existence check is defensive; the ID-based targeting is the load-bearing change (sabotage case "recomputes its target from selectedIndex" is caught, 20 → 19 passed).
3. **`_applySession` reported replacement by whether the core returned.** A throw after the tracks had been cleared and rehydrated (for example in the master solo refresh or limit report) reported `replaced: false`, so the Weave stayed attached to Scenes whose live sources were gone. The core now takes an `onReplacing` callback and calls it at the destructive boundary — immediately before the first track's `_sourceRevision++`/`cleanupSources()` — and the wrapper keeps that flag through errors and always releases its token in `finally`. Preflight throws (before the boundary) still report `replaced: false`. Regression: host test H9b runs the real core with (a) `updateSoloState` throwing after every track was replaced → `replaced: true`, token released, track revision bumped; (b) a per-track `loadNodeBundle` failure → returns with `failures`, `replaced: true`; (c) a preflight failure → `replaced: false`, revisions untouched. H8's wrapper contract now includes a late throw with `replaced: true`.
4. **The browser check only recorded observations.** `browser-check.js` is now an acceptance script (24 assertions, non-zero exit on any failure, `browser-check.json` lists each check): it runs the pre-S4 `ed0cad7` tree and the S4 tree in the same headless Chromium under matching conditions (1440×900, same fallback fonts, animations/transitions frozen by injected CSS, `performance.now`/`Date.now` pinned so the transport clock and transition playhead cannot differ by load time) and asserts the fresh S4 page has the same demo rows, the same panel and row rectangles and is pixel-equivalent to the pre-S4 page (tolerance: ≤ 0.05 % of pixels, no channel differing by more than 4/255 — measured 137 of 1 296 000 pixels at max delta 2, anti-aliasing on rounded edges of the inspector buttons). It then drives the real UI: the demo row ADJUST swipe is refused with the `#aether-toast` text "Demo Scene — press + SCENE to capture a real one"; the real `+ SCENE` button (re-queried after each re-render) captures three Scenes; GO NOW (jump) moves the bound slots; the ADJUST swipe on Scene 02 recalls but its drag-end is refused with "Positions not saved to Scene 02 for T1, T2, T3, T4 — they belong to another Scene or play a different source" (the slots are bound to Scene 03); the swipe on Scene 03 accepts the drag-end and renders DONE; the delete swipe keeps the Scene 03 identity for playing and selected; a delayed Preview with a selection change meanwhile lands on the intended Scene; a session replacement through the real hooks detaches with the toast "Weave detached — live sound is now x.aether. + SCENE to capture it into the Weave." and every binding reads invalid. Run against the pre-fix S4 tree the same script fails exactly the deletion-identity and Preview-target checks (`browser-check-before-fix.txt`, 22/24). The claim is now exactly what is measured: the S4 page is unchanged versus `ed0cad7` under identical headless conditions; the native 4 October screenshot (retina, real fonts, loaded audio) is not compared pixel-wise and is cited only as the reference for what the layout is.

Sabotage: `sabotage-s4.py` has five new cases (deletion clamps instead of re-resolving; editing identity dropped; Preview target from `selectedIndex`; core never marks the boundary; wrapper reports replacement only on return) and the old wrapper case rewritten for the new contract; `sabotage-checks-2.txt`: 28/28 caught on a scratch copy outside the repository. Evidence folder adds `browser-00-baseline-ed0cad7.png` (pre-S4 render) beside the three S4 screenshots. D1/D2/D4/D6/D7/D9/D10 remain unapproved; no native launch, build, lock deletion, commit or push.

### 12.6 Matt-approved addition: BUILD Scene drag reorder

Matt reported the native Lab working fine and explicitly requested click/hold/vertical drag to reorder Scenes in BUILD, with no HTML text highlighting. Added this bounded scope to S4: reorderScene uses unchanged S1 moveScene, composes onto latest document, preserves playing/selected/editing Scene IDs and runtime source bindings/assets, advances docRevision and cancels stale Preview/glide. Pointer gestures distinguish vertical reorder from existing rightward ADJUST/delete swipes; drop feedback and edge scrolling added, cancellation never commits. WebKit user selection/user dragging disabled on Scene rows; BUILD cards disable native touch panning. Demo rows stay read-only, PLAY refuses reorder.

Changed desktop/weave.js, desktop/weave.css and tests/test-weave-session.js (two new meaningful tests), preserving all earlier S4 work. Session 22/22, swipe and spatial recall pass; browser UI verified downward/upward reordering, empty text selection, ADJUST/DONE through actual gestures in a separate in-app test page. Evidence: audits/phase1-s4-build-reorder-2026-10-05. Matt's running native page was not reloaded because that resets its in-memory Scenes; source addition needs a fresh page before native gesture verification. His 'all working fine' report is qualitative; required capture performance measurements and detailed L2/L3 evidence still pending. Earlier S4 patch predates this addition; refreshed combined patch in 2026-10-05 thread outputs. No commit/push, lock deletion or housekeeping deletion. Next: Matt reloads Lab when ready for reset, tests BUILD dragging, then completes remaining native acceptance.

### 12.7 Hold to pick up and drop a Scene

Matt confirmed highlighting was gone but requested actual pick-up/drop ordering again. Refined BUILD gesture: a 220ms hold arms reorder before direction classification, so subsequent diagonal movement cannot become ADJUST/delete; Scene follows pointer with display-scale compensation. Insertion line now renders above opaque cards, including end-of-list placement. Corrected touch-action selector to .weave-panel.is-build (the class is on the panel, not its gutter) and update it during mode switches. Extracted actual pointer wiring into bindSceneRowGestures for regression coverage. Session test 23 exercises held diagonal drag across several positions and cancelled drop without document changes; session 23/23, host13/13, spatial and swipe suites pass; diff --check clean; S1–S3 unchanged.

Separate browser UI verified Scene 05 moved from fifth to second ([01,05,02,03,04]), and that the new order survives clicking another Scene; no text selection, touch-action none. Evidence: audits/phase1-s4-build-reorder-2026-10-05/test-run-hold-drop.txt and hold-drop-browser-check.txt. Refreshed combined patch revision 2 in thread outputs. Running native page preserved; this correction requires reload before native gesture verification, which resets its in-memory Scenes. No commit/push, lock deletion or native restart. Remaining S4 native acceptance unchanged.

### 12.8 Held-card visibility and panel text selection — 5 October 2026 (Claude), not committed

The BUILD reorder gesture (Codex, 5 Oct) translates the held `.weave-loom-row-card` inside its `.weave-loom-row-wrap`, whose `overflow: hidden` exists for the horizontal ADJUST/delete reveal. That clip cut the held card off as soon as it left its row, which is what Matt saw natively as the card disappearing behind its neighbours. Rule: while a row carries `.is-reordering` its overflow is `visible` and it stacks at z-index 6 (above the playhead SVG at 4 and the current-bar rule at 2); the row's under-layer shows a dashed placeholder; the card keeps Codex's grabbing cursor, 0.88 opacity and shadow. Nothing in the gesture, hold timing, thresholds, `reorderScene` or S1 `moveScene` changed.

Text selection is refused for the whole `.weave-panel` (BUILD Loom and PLAY sheet, including WebKit's prefixed property and touch callout), restored for `input`, `textarea` and `[contenteditable]`; `attach()` additionally cancels `selectstart` inside the panel unless the press is in an editable field, because WebKit can begin a selection on the panel background and sweep it across unselectable rows. Evidence: `audits/phase1-s4-drag-visibility-2026-10-05/`; session test 24 pins both rules and the guard. Native confirmation by Matt after a reload is still required.

### 12.9 The two-Scene instrument — 5 October 2026 (Claude), not committed

Priority change by Matt: the Weave must play. Rule set, kept deliberately simple: `+ SCENE` captures a usable state (unchanged S1 Scene: source, strip, XYZ, motion). Play from Stop recalls Scene 01 whole before the first tick; every Scene boundary recalls the next Scene whole (`applySceneState`): the slot's sound from the capture-time buffer cache or decoded once from the stored asset, strip gain/EQ/mute/solo through the strip controls, XYZ at the first point of the Scene's motion, and the Scene's own motion loop from phase 0 — a Scene with no motion for a slot leaves the loop off. Arrangement moves take the nodes over (only a recording or dragged node is left alone); ADJUST and Preview keep the S4 bound/matching gates. MORPH: discrete sources switch at glide start, outgoing motion frozen, XYZ + gain + EQ glide, destination motion starts on arrival. FADE: master gain dips to silence over the last half of the transition length and recovers over the first half of the next Scene; the destination is recalled at the boundary. JUMP: cut at the boundary. One-bar entrance fade at Play and after the wrap; one-bar ending fade on the last Scene. Stop rewinds to Scene 01; Pause keeps the place. Unsupported, reported once per Scene: switching custom nodes, live input or streams. Evidence: `audits/playable-two-scenes-2026-10-05/` (session tests 25–28, `playable-check.js` 21/21 in headless Chromium). Native listening pending.

### 12.10 PLAY and BUILD as two rooms — 5 October 2026 (Claude), not committed

PLAY is the live room: WEAVE ON opens it; `+ SCENE` appends a snapshot of what is sounding; Play runs the list with the default FADE; double-click a Scene moves there now with the current transition (JUMP cut; MORPH wall-clock glide over the length; FADE: dip over half the length, recall at the half, fade in over the first half of the new Scene); while stopped, double-click starts the transport on that Scene. BUILD is the quiet room: entering it stops the transport. Audio in BUILD comes only from auditions: swipe LEFT on a row → AUDITION tag (speaker) on the right; release → the Scene is recalled and plays, holding on it, until swiped again, Stop/Space, or PLAY. The right-panel AUDITION button plays the end of the selected Scene, the transition and the first bars of the next, then stops itself. Double-tap a row → inline rename (S1 `renameScene`). Rightward ADJUST/DELETE, hold-to-reorder, bar-length handles and ADJUST's write rule are unchanged. Evidence: `audits/play-build-rooms-2026-10-05/` (session tests 29–30; `rooms-check.js` 17/17 with real gestures in headless Chromium). Native listening pending.

### 12.11 GO NEXT, prepare-then-launch and the PLAY set list — 5 October 2026 (Claude), not committed

Launch model: `launchScene(idx)` → `_planFor(sceneId)` → `_launch = { sceneId, token, plan, ready, atTransport }`. If `plan.needsPrepare`, `_prepareScene` builds an aether session from the Scene's assets and hands it to the host (`prepareSession`; sample-only fallback through `_decodeAsset`); on success `arm()` sets `ready` and `atTransport = _nextBarTransport()` from the host clock snapshot. `onTransportTick` fires `_fireLaunch` when `clock.transportTime >= atTransport`, anchoring every curve at the bar's audio time. Per-slot plans: `same` | `swap` | `install` | `silence` | `unsupported`. Installs go through `_switchTo` (master fade down over the preceding half bar, `_installPrepared` per slot while `_switching` holds the level at 0, fade up over `LAUNCH_CROSSFADE_BARS`); everything else is `_beginTransition(idx, {bars, endsAtBar}, 'fade', startAt)` + `_arriveAt`. Stale guards: `_launchSeq` token on the launch, `_enableSeq` bumped by WEAVE OFF, `session.epoch`, per-track `_sourceRevision`; a resolve whose guard moved is dropped. Outgoing crossfade sources live in `_fadeSources` and are stopped by `_stopFadeSources` on Stop/Pause/WEAVE OFF and by `_stopFadeSourcesFor(k)` before a newer swap on the same slot. Captured empty slots → `_silenceSlot`. Node params: `_applyNodeParams(t, ts, mode)` restores manifest parameters (discrete kinds switch, floats glide via `g.np`). The broadcast plan auto-prepares the next Scene `PREPARE_LEAD_BARS` bars ahead and holds the current one looping with PREPARING when late.

PLAY set list: `.weave-set-wrap[data-scene-id]` rows over an under-layer with RENAME (left swipe) and DELETE (right swipe, tap to confirm; disabled for the sounding row) — `bindSetRowGestures`; `_undo = { doc, revision, label, until }` with `undoDelete()` valid for `UNDO_MS` while `docRevision` is unchanged; a click selects the GO NEXT destination; `_lastSetTap` turns a second tap into `jumpToScene`. `beginRename` serves both rooms through `[data-scene-name]`. Space: `isTextEditingTarget(e.target)` in the window-capture handlers of `index.html` lets text fields keep the key.

Evidence: `audits/gonext-prepare-2026-10-05/` — session 34/34 (31: Stop/Pause/WEAVE OFF/newer change own the outgoing source; 32: stale decode/preparation never arms or installs; 33: empty slot restores silence; 34: same AetherNode reused with continuous/discrete params), host 15/15 (H15: text targets type a space), `gonext-check.js` 21/21, `playable-check.js` 24/24, `rooms-check.js` 18/18 on the real page in headless Chromium; `regression-before-r8.txt` shows 31–33 failing on the r7 tree. AetherNode preparation is mock-verified only (no Tauri headless). Patch r8 in `outputs/`.
