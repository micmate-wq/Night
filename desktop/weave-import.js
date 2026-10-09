// Aether Weave v0.1 — legacy .aether import (Phase 1, slice S3).
//
// Pure glue between S1 (weave-model.js) and S2 (weave-assets.js): a parsed .aether
// v3.1 session object becomes one valid Scene inside a Weave document, and every
// payload the Scene references becomes a content-addressed, deduplicated asset.
// No DOM, no Web Audio, no Tauri, no file I/O, no audio decoding, no zip
// inspection, no bundle execution. Not loaded by the app; nothing in index.html
// or weave.js uses this file. S1 and S2 are reached through their frozen public
// exports only and are not changed by this module.
//
// What this module proves and does not prove:
//   * It proves DATA migration: the returned document validates under S1, every
//     asset it ADDS is hashed by S2, and every existing entry a duplicate lands on
//     has had its stored payload compared byte for byte by S2.
//   * It does NOT prove the native "old .aether loads" acceptance (file read,
//     decode, _applySession): that is S5 native verification.
//   * It does not verify existing assets it never touches unless the caller asks
//     (opts.verifyExisting); the report says which (existingVerified).
//   * It does not open a node zip: a bundle's manifestId/version are stored as the
//     session declares them (bundleMetadataVerified: false in the report).
//   * It never applies anything: no transport, master, motion or DSP change. The
//     destination document's master is kept; the session's masterVolume/loudnessDb
//     are reported (legacyMaster.imported: false), not imported (D6 untouched).
//
// Contract (as S2): every function that takes untrusted input returns a plain
// result object { ok, ... } and never throws; failures carry `error`, `code`,
// `path`, and `track` (0–3) where applicable; limit failures also carry
// `stage: "preflight" | "growth"`. No function mutates its arguments (session,
// document, asset table, ctx, limits). Codes: S2's set plus `session`, `track`,
// `thread`, `model`, `conflict`, `path-only`, `bundle-metadata`, `encoding`.
// The async functions resolve, never reject: a cyclic or otherwise uncopyable
// session field or asset entry is a structured failure (`session` / `container`,
// with the field path and track) whose message carries no input values, and any
// unexpected internal throw resolves to a fixed `{ error, code: "engine", path: "" }`
// that never reads the thrown value.
//
// Supplied state is taken as written or refused, never converted to absence or a
// default. "Absent" means undefined or null, which is what the current writer
// emits for nothing. A non-array motionPath, a non-object eq, customNodeParams
// or customNodeBundle, a non-string name/sampleName/filePath/streamUrl or
// playlist item type, a non-integer playlistIndex → `code: "track"` with the
// field path; an empty-string sampleData or customNodeZipBase64 → `code: "empty"`.
//
// Snapshot rule: before the first await, everything the result derives from is
// captured — the session's relevant nested values (payload strings by reference:
// strings are immutable), the asset table (every entry and its nested objects
// copied), the input document (deep clone), the thread mapping, ctx values and
// normalised limits. Nothing after that point reads the caller's objects, so
// changes made while a promise is pending cannot reach the result.
//
// Source precedence (exactly S1's, weave-model.js sceneFromAetherState):
//   node (isCustomNode || customNodeBundle || customNodeZipBase64) > live-input
//   > stream > playlist (non-empty) > sample (sampleData) > empty.
// A payload the resolved source would not reference (a node track's playlist
// items; a live-input or stream track's sampleData and playlist items) is a
// conflict: refused with code "conflict" by default, or, with
// opts.allowOmissions, left out and disclosed (Scene completeness "incomplete",
// one reason per omitted payload, and the same list in the report). A source
// that needs embedded content but has only a filePath fails with "path-only":
// a would-be empty track, or a node track with neither zip nor bundle, whose
// filePath is set. Live-input and stream tracks ignore any leftover filePath.
// No path (filePath, customNodeBundle.file_path) is ever stored, echoed in an
// error, or placed in the report.
//
// Public API:
//   canonicalJsonBytes(value)            -> { ok, bytes: Uint8Array, text } | { ok: false, code: 'encoding' }
//                                            deterministic JSON: keys sorted by UTF-16 code units at
//                                            every level, arrays in order, JSON.stringify escapes and
//                                            number text, no whitespace, UTF-8. Only plain objects,
//                                            dense arrays, strings, finite numbers, booleans and null;
//                                            a sparse array (hole), undefined, a function, a symbol,
//                                            a BigInt, a non-finite number, a non-plain object or a
//                                            cycle is refused with the offending path. Every
//                                            successful text parses back to equal contents.
//   extractAetherAssets(session, assets, opts?)   (async)
//                                         -> { ok, assets, perTrack, report } | { ok: false, ... }
//                                            perTrack[index] is exactly the ctx.assetIds[index]
//                                            object S1's sceneFromAetherState expects. On failure
//                                            assets and perTrack are null (no partial table).
//   importAetherState(doc, session, ctx?, opts?)  (async)
//                                         -> { ok, doc, sceneId, report } | { ok: false, ... }
//                                            doc is the S1 result (a validated clone of the input);
//                                            on failure doc is absent and nothing was added.
//   opts: { limits?, allowOmissions?, verifyExisting?, engine? }
//   ctx:  { threadIds?, name?, fileName?, durationBeats?, captureBpm?, now?, uuid?, index? }
//
// Limits (caller-supplied, as S2; no built-in ceiling, D10 untouched):
//   stage "preflight" — refused before any decode or hash: the existing table already breaks an
//   aggregate limit; one payload exceeds maxAssetBytes, or alone exceeds maxTotalBytes /
//   maxEncodedChars; or "certain growth" (payloads whose projected length matches no existing
//   entry's bytes and no other payload, so they can never deduplicate) already breaks an
//   aggregate limit. stage "growth" — a limit S2 reports after hashing has shown which same-length
//   payloads were duplicates. Both are all-or-nothing.
(function (root, factory) {
  const isNode = typeof module === 'object' && module && module.exports;
  const M = isNode ? require('./weave-model.js') : root.AetherWeaveModel;
  const A = isNode ? require('./weave-assets.js') : root.AetherWeaveAssets;
  const api = factory(M, A);
  if (isNode) module.exports = api;
  root.AetherWeaveImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, A) {
  'use strict';

  const SOURCE_UNSUPPORTED = { node: 'node-private-state', 'live-input': 'live-input-not-stored', stream: 'stream-external' };
  const COLOR_TOKENS = ['track-1', 'track-2', 'track-3', 'track-4'];
  const BUNDLE_KEYS = ['file_name', 'manifest_raw', 'manifest', 'ui_html', 'dsp_wasm_base64', 'dsp_js'];
  const OPT_KEYS = ['limits', 'allowOmissions', 'verifyExisting', 'engine'];
  const CTX_KEYS = ['threadIds', 'name', 'fileName', 'durationBeats', 'captureBpm', 'now', 'uuid', 'index'];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isPlain = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const isInt = (v) => Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (error, code, path, extra) => Object.assign({ ok: false, error, code, path }, extra || {});
  const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) : s);

  // Deep copy of plain data (objects, arrays, primitives). Strings are shared: immutable.
  // A cycle (or a structure too deep to walk) throws a CopyError that the public functions turn
  // into a structured failure; the message never carries input values.
  function CopyError(message) { this.name = 'CopyError'; this.message = message; }
  function deepCopy(v, seen) {
    if (!seen) seen = new Set();
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new CopyError('cyclic structure cannot be copied');
      seen.add(v);
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) out[i] = deepCopy(v[i], seen);
      seen.delete(v);
      return out;
    }
    if (isObj(v)) {
      if (seen.has(v)) throw new CopyError('cyclic structure cannot be copied');
      seen.add(v);
      const o = {};
      for (const k of Object.keys(v)) o[k] = deepCopy(v[k], seen);
      seen.delete(v);
      return o;
    }
    return v;
  }

  // ---------- deterministic JSON ----------
  function canonicalJsonBytes(value) {
    const seen = new Set();
    let out;
    try {
      out = encode(value, '');
    } catch (e) {
      return fail(e && e.message ? e.message : String(e), 'encoding', e && e.path !== undefined ? e.path : '');
    }
    return { ok: true, text: out, bytes: new TextEncoder().encode(out) };

    function problem(msg, path) { const e = new Error(msg); e.path = path; return e; }
    function encode(v, path) {
      if (v === null) return 'null';
      const t = typeof v;
      if (t === 'string') return JSON.stringify(v);
      if (t === 'boolean') return v ? 'true' : 'false';
      if (t === 'number') { if (!Number.isFinite(v)) throw problem('non-finite number cannot be encoded', path); return JSON.stringify(v); }
      if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') throw problem(t + ' cannot be encoded', path);
      if (Array.isArray(v)) {
        if (seen.has(v)) throw problem('cyclic structure cannot be encoded', path);
        seen.add(v);
        const parts = [];
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) throw problem('sparse array (hole) cannot be encoded', path + '[' + i + ']');
          parts.push(encode(v[i], path + '[' + i + ']'));
        }
        seen.delete(v);
        return '[' + parts.join(',') + ']';
      }
      if (!isPlain(v)) throw problem('only plain objects and arrays can be encoded', path);
      if (seen.has(v)) throw problem('cyclic structure cannot be encoded', path);
      seen.add(v);
      const keys = Object.keys(v).sort();
      const parts = [];
      for (const k of keys) parts.push(JSON.stringify(k) + ':' + encode(v[k], path + (path ? '.' : '') + k));
      seen.delete(v);
      return '{' + parts.join(',') + '}';
    }
  }

  // ---------- option and context snapshots ----------
  function snapshotOpts(opts) {
    if (opts === undefined || opts === null) opts = {};
    if (!isObj(opts)) return fail('opts must be an object', 'session', 'opts');
    for (const k of Object.keys(opts)) if (!OPT_KEYS.includes(k)) return fail('unknown option "' + k + '" (allowed: ' + OPT_KEYS.join(', ') + ')', 'session', 'opts.' + k);
    const lim = A.checkLimits(opts.limits);
    if (!lim.ok) return fail(lim.error, 'limit', 'opts.limits', { stage: 'preflight' });
    if (opts.engine !== undefined && opts.engine !== 'subtle' && opts.engine !== 'node') return fail('opts.engine must be "subtle" or "node"', 'engine', 'opts.engine');
    return { ok: true, opts: Object.freeze({ limits: lim.limits, allowOmissions: opts.allowOmissions === true, verifyExisting: opts.verifyExisting === true, engine: opts.engine }) };
  }

  function snapshotCtx(ctx) {
    if (ctx === undefined || ctx === null) ctx = {};
    if (!isObj(ctx)) return fail('ctx must be an object', 'session', 'ctx');
    for (const k of Object.keys(ctx)) if (!CTX_KEYS.includes(k)) return fail('unknown ctx field "' + k + '" (allowed: ' + CTX_KEYS.join(', ') + ')', 'session', 'ctx.' + k);
    if (ctx.threadIds !== undefined && !Array.isArray(ctx.threadIds)) return fail('ctx.threadIds must be an array', 'thread', 'ctx.threadIds');
    const c = {
      threadIds: ctx.threadIds === undefined ? undefined : ctx.threadIds.slice(),
      name: typeof ctx.name === 'string' ? ctx.name : undefined,
      fileName: typeof ctx.fileName === 'string' ? ctx.fileName : undefined,
      durationBeats: isNum(ctx.durationBeats) ? ctx.durationBeats : undefined,
      captureBpm: isNum(ctx.captureBpm) ? ctx.captureBpm : undefined,
      now: typeof ctx.now === 'function' ? ctx.now : undefined,
      uuid: typeof ctx.uuid === 'function' ? ctx.uuid : undefined,
      index: isInt(ctx.index) ? ctx.index : undefined
    };
    return { ok: true, ctx: Object.freeze(c) };
  }

  // ---------- session snapshot (sync, before any await) ----------
  function snapshotSession(session) {
    try { return snapshotSessionUnsafe(session); }
    catch (e) {
      if (e instanceof CopyError) return fail('session could not be copied: ' + e.message + (e.path ? ' at ' + e.path : ''), 'session', e.path || 'tracks', e.track === undefined ? undefined : { track: e.track });
      throw e;
    }
  }
  function copyField(v, path, track) {
    try { return deepCopy(v); }
    catch (e) { if (e instanceof CopyError) { e.path = path; e.track = track; } throw e; }
  }
  function snapshotSessionUnsafe(session) {
    if (!isObj(session)) return fail('Not an Aether state object.', 'session', '');
    if (session.type !== undefined && session.type !== 'aether_project') return fail('session.type must be "aether_project" when present', 'session', 'type');
    if (!Array.isArray(session.tracks) || session.tracks.length < 1 || session.tracks.length > 4) return fail('tracks must be an array of 1–4 tracks.', 'session', 'tracks');
    const seen = new Set();
    const tracks = [];
    for (let i = 0; i < session.tracks.length; i++) {
      const tr = session.tracks[i];
      const p = 'tracks[' + i + ']';
      if (!isObj(tr)) return fail('Each track must be an object.', 'session', p);
      const idx = tr.index === undefined ? 0 : tr.index;
      if (!(isInt(idx) && idx >= 0 && idx <= 3) || seen.has(idx)) return fail('Invalid or duplicate track index.', 'session', p + '.index');
      seen.add(idx);
      // Supplied state is taken as written or refused; it is never converted to absence or a
      // default. Absent means undefined or null (what the current writer emits for "nothing").
      const absent = (v) => v === undefined || v === null;
      const bad = (field, what) => fail('Track ' + (idx + 1) + ': ' + field + ' must be ' + what + ' when present.', 'track', p + '.' + field, { track: idx });
      for (const k of ['sampleData', 'customNodeZipBase64']) {
        if (!absent(tr[k]) && typeof tr[k] !== 'string') return bad(k, 'a base64 string or null');
        if (tr[k] === '') return fail('Track ' + (idx + 1) + ': ' + k + ' is an empty string; an empty payload is not a usable asset and not the same as absent.', 'empty', p + '.' + k, { track: idx });
      }
      for (const k of ['name', 'sampleName', 'filePath', 'streamUrl']) if (!absent(tr[k]) && typeof tr[k] !== 'string') return bad(k, 'a string');
      if (!absent(tr.customNodeBundle) && !isObj(tr.customNodeBundle)) return bad('customNodeBundle', 'an object or null');
      if (!absent(tr.customNodeParams) && !isObj(tr.customNodeParams)) return bad('customNodeParams', 'an object or null');
      if (!absent(tr.eq) && !isObj(tr.eq)) return bad('eq', 'an object');
      if (!absent(tr.motionPath) && !Array.isArray(tr.motionPath)) return bad('motionPath', 'an array');
      if (!absent(tr.playlistIndex) && !isInt(tr.playlistIndex)) return bad('playlistIndex', 'an integer');
      const t = {
        index: idx,
        name: absent(tr.name) ? undefined : tr.name,
        sampleName: absent(tr.sampleName) ? undefined : tr.sampleName,
        hasFilePath: typeof tr.filePath === 'string' && tr.filePath.length > 0,   // presence only; the path is not kept
        sampleData: absent(tr.sampleData) ? null : tr.sampleData,
        playlist: null,
        playlistIndex: absent(tr.playlistIndex) ? 0 : tr.playlistIndex,
        isShuffle: !!tr.isShuffle,
        isRepeat: tr.isRepeat !== false,
        isCustomNode: !!tr.isCustomNode,
        hasBundle: isObj(tr.customNodeBundle),
        bundleManifestId: undefined, bundleManifestVersion: undefined, bundleDisplayName: undefined,
        bundleFallback: null,   // { bytes, text } encoded now (only when no zip), or an encoding failure
        zip: absent(tr.customNodeZipBase64) ? null : tr.customNodeZipBase64,
        customNodeParams: absent(tr.customNodeParams) ? null : copyField(tr.customNodeParams, p + '.customNodeParams', idx),
        isLiveIn: !!tr.isLiveIn,
        isStream: !!tr.isStream,
        streamUrl: absent(tr.streamUrl) ? undefined : tr.streamUrl,
        x: tr.x, y: tr.y, hasZ: tr.z !== undefined, z: tr.z,
        isMuted: !!tr.isMuted, isSoloed: !!tr.isSoloed,
        motionSpeed: tr.motionSpeed,
        motionPath: absent(tr.motionPath) ? undefined : copyField(tr.motionPath, p + '.motionPath', idx),
        eq: absent(tr.eq) ? undefined : copyField(tr.eq, p + '.eq', idx),
        stripGainDb: tr.stripGainDb
      };
      if (tr.playlist !== undefined && tr.playlist !== null) {
        if (!Array.isArray(tr.playlist)) return fail('Track ' + (idx + 1) + ': playlist must be an array.', 'track', p + '.playlist', { track: idx });
        t.playlist = [];
        for (let j = 0; j < tr.playlist.length; j++) {
          const it = tr.playlist[j];
          const pp = p + '.playlist[' + j + ']';
          if (!isObj(it) || typeof it.name !== 'string' || !it.name.length) return fail('Track ' + (idx + 1) + ': playlist item ' + j + ' needs a name.', 'track', pp + '.name', { track: idx });
          if (typeof it.data !== 'string' || !it.data.length) return fail('Track ' + (idx + 1) + ': playlist item "' + it.name + '" has no embedded data.', 'track', pp + '.data', { track: idx });
          if (!(it.type === undefined || it.type === null || typeof it.type === 'string')) return fail('Track ' + (idx + 1) + ': playlist item ' + j + ' type must be a string when present.', 'track', pp + '.type', { track: idx });
          t.playlist.push({ name: it.name, type: typeof it.type === 'string' ? it.type : '', data: it.data });
        }
      } else t.playlist = [];
      if (t.hasBundle) {
        const b = tr.customNodeBundle;
        const man = isObj(b.manifest) ? b.manifest : null;
        t.bundleManifestId = man && typeof man.id === 'string' ? man.id : undefined;
        t.bundleManifestVersion = man && typeof man.version === 'string' ? man.version : undefined;
        t.bundleDisplayName = man && typeof man.name === 'string' && man.name.length ? man.name : (typeof b.file_name === 'string' && b.file_name.length ? b.file_name : undefined);
        if (!t.zip) {
          const subset = {};
          for (const k of BUNDLE_KEYS) if (own(b, k) && b[k] !== undefined) subset[k] = b[k];   // file_path and anything else excluded
          const enc = canonicalJsonBytes(subset);
          t.bundleFallback = enc.ok ? { bytes: enc.bytes, text: enc.text } : { error: enc.error, path: enc.path };
        }
      }
      tracks.push(t);
    }
    tracks.sort((a, b) => a.index - b.index);
    return {
      ok: true,
      snap: {
        name: typeof session.name === 'string' ? session.name : undefined,
        masterVolume: session.masterVolume,
        loudnessDb: session.loudnessDb,
        tracks
      }
    };
  }

  function snapshotTable(assets) {
    if (!isObj(assets)) return fail('assets must be an object keyed by asset ID', 'container', 'assets');
    const table = {};
    for (const k of Object.keys(assets)) {
      try { table[k] = deepCopy(assets[k]); }
      catch (e) { if (e instanceof CopyError) return fail('existing asset entry could not be copied: ' + e.message, 'container', 'assets["' + k + '"]'); throw e; }
    }
    return { ok: true, table };
  }

  // ---------- source resolution and payload plan (sync) ----------
  function resolveSource(t) {
    if (t.isCustomNode || t.hasBundle || t.zip) return 'node';
    if (t.isLiveIn) return 'live-input';
    if (t.isStream) return 'stream';
    if (t.playlist.length) return 'playlist';
    if (t.sampleData) return 'sample';
    return 'empty';
  }

  function unsupportedFor(t, kind) {
    const u = [];
    if (SOURCE_UNSUPPORTED[kind]) u.push(SOURCE_UNSUPPORTED[kind]);
    if (Array.isArray(t.motionPath) && t.motionPath.length > 1) u.push('motion-free-time');
    return u;
  }

  function audioName(t, fallback) { return clip(t.sampleName || t.name || fallback, 200); }

  // Builds, per track, the ordered list of payloads to add and the list of omitted payloads.
  // Payload: { track, field, role, data|bytes, meta, projected, encodedChars, path }.
  function planTrack(t, allowOmissions) {
    const idx = t.index;
    const p = 'tracks[' + idx + ']';
    const kind = resolveSource(t);
    const omitted = [];
    const payloads = [];
    const shape = (data, path, what) => {
      const s = A.decodedLengthOfBase64(data);
      if (!s.ok) return fail('Track ' + (idx + 1) + ': ' + what + ': ' + s.error, 'base64', path, { track: idx });
      if (s.bytes === 0) return fail('Track ' + (idx + 1) + ': ' + what + ' is empty (zero bytes).', 'empty', path, { track: idx });
      return { ok: true, projected: s.bytes, encodedChars: data.length };
    };
    const add = (field, role, data, meta, path, what) => {
      const s = shape(data, path, what);
      if (!s.ok) return s;
      payloads.push({ track: idx, field, role, data, meta, projected: s.projected, encodedChars: s.encodedChars, path });
      return { ok: true };
    };
    const omit = (field, name, data) => {
      const s = A.decodedLengthOfBase64(data);
      omitted.push({ field, name, projectedBytes: s.ok ? s.bytes : null });
    };

    if (kind === 'node') {
      if (!t.zip && !t.hasBundle) {
        return t.hasFilePath
          ? fail('Track ' + (idx + 1) + ': node source refers to a file by path only; no embedded bundle to import.', 'path-only', p, { track: idx })
          : fail('Track ' + (idx + 1) + ': node source has neither an embedded zip nor a bundle.', 'track', p, { track: idx });
      }
      if (!isStr(t.bundleManifestId, 1, 200) || !isStr(t.bundleManifestVersion, 1, 50)) {
        return fail('Track ' + (idx + 1) + ': node bundle has no manifest id/version in the session; S3 cannot derive them (zip inspection is out of scope).', 'bundle-metadata', p + '.customNodeBundle.manifest', { track: idx });
      }
      const bname = clip(t.bundleDisplayName || t.sampleName || t.bundleManifestId, 200);
      if (t.zip) {
        const r = add('customNodeZipBase64', 'bundle', t.zip,
          { kind: 'node-bundle', name: bname, mime: 'application/zip', origin: 'aethernode-zip', manifestId: t.bundleManifestId, version: t.bundleManifestVersion },
          p + '.customNodeZipBase64', 'node bundle zip');
        if (!r.ok) return r;
      } else {
        if (t.bundleFallback.error) return fail('Track ' + (idx + 1) + ': node bundle cannot be encoded: ' + t.bundleFallback.error, 'encoding', p + '.customNodeBundle' + (t.bundleFallback.path ? '.' + t.bundleFallback.path : ''), { track: idx });
        const b = t.bundleFallback.bytes;
        if (!b.byteLength) return fail('Track ' + (idx + 1) + ': node bundle is empty.', 'empty', p + '.customNodeBundle', { track: idx });
        payloads.push({ track: idx, field: 'customNodeBundle', role: 'bundle', bytes: b, projected: b.byteLength, encodedChars: A.base64LengthForBytes(b.byteLength), path: p + '.customNodeBundle',
          meta: { kind: 'node-bundle', name: bname, mime: 'application/json', origin: 'unpacked-json', manifestId: t.bundleManifestId, version: t.bundleManifestVersion } });
      }
      if (t.sampleData) {
        const r = add('sampleData', 'tape', t.sampleData, { kind: 'audio', name: audioName(t, 'Track ' + (idx + 1) + ' tape'), mime: 'audio/wav', origin: 'rendered-buffer' }, p + '.sampleData', 'tape buffer');
        if (!r.ok) return r;
      }
      for (const it of t.playlist) omit('playlist', it.name, it.data);
    } else if (kind === 'live-input' || kind === 'stream') {
      if (t.sampleData) omit('sampleData', audioName(t, 'buffer'), t.sampleData);
      for (const it of t.playlist) omit('playlist', it.name, it.data);
    } else if (kind === 'playlist') {
      for (let j = 0; j < t.playlist.length; j++) {
        const it = t.playlist[j];
        const r = add('playlist[' + j + ']', 'playlist', it.data, { kind: 'audio', name: clip(it.name, 200), mime: clip(it.type, 100) || 'application/octet-stream', origin: 'original-file' }, p + '.playlist[' + j + '].data', 'playlist item "' + it.name + '"');
        if (!r.ok) return r;
      }
      if (t.sampleData) {
        const r = add('sampleData', 'sample', t.sampleData, { kind: 'audio', name: audioName(t, 'Track ' + (idx + 1) + ' buffer'), mime: 'audio/wav', origin: 'rendered-buffer' }, p + '.sampleData', 'saved buffer');
        if (!r.ok) return r;
      }
    } else if (kind === 'sample') {
      const r = add('sampleData', 'sample', t.sampleData, { kind: 'audio', name: audioName(t, 'Track ' + (idx + 1) + ' buffer'), mime: 'audio/wav', origin: 'rendered-buffer' }, p + '.sampleData', 'saved buffer');
      if (!r.ok) return r;
    } else if (t.hasFilePath) {
      return fail('Track ' + (idx + 1) + ': source refers to a file by path only; no embedded audio to import.', 'path-only', p, { track: idx });
    }

    if (omitted.length && !allowOmissions) {
      return fail('Track ' + (idx + 1) + ': ' + omitted.length + ' embedded payload(s) would not be referenced by its ' + kind + ' source (' + omitted.map(o => o.field + (o.name ? ' "' + o.name + '"' : '')).join(', ') + '); refusing rather than discarding them. Pass allowOmissions to import without them.', 'conflict', p, { track: idx, omitted });
    }
    return { ok: true, kind, payloads, omitted, unsupported: unsupportedFor(t, kind) };
  }

  // ---------- limit preflight (sync; decodes and hashes nothing) ----------
  function preflightLimits(L, table, payloads) {
    const agg = own(L, 'maxTotalBytes') || own(L, 'maxEncodedChars') || own(L, 'maxAssetCount');
    const measured = A.measureAssets(table);
    if (!measured.ok) { const e = measured.errors[0]; return fail('existing asset table failed preflight: ' + e.path + ' ' + e.message, e.code, e.path, { stage: 'preflight' }); }
    const lim = (msg, path, track) => fail(msg, 'limit', path, Object.assign({ stage: 'preflight' }, track === undefined ? {} : { track }));
    if (own(L, 'maxTotalBytes') && measured.projectedBytes > L.maxTotalBytes) return lim('existing assets already total ' + measured.projectedBytes + ' bytes, over maxTotalBytes ' + L.maxTotalBytes, 'assets');
    if (own(L, 'maxEncodedChars') && measured.encodedChars > L.maxEncodedChars) return lim('existing assets already hold ' + measured.encodedChars + ' base64 characters, over maxEncodedChars ' + L.maxEncodedChars, 'assets');
    if (own(L, 'maxAssetCount') && measured.count > L.maxAssetCount) return lim('existing table already has ' + measured.count + ' assets, over maxAssetCount ' + L.maxAssetCount, 'assets');
    for (const pl of payloads) {
      if (own(L, 'maxAssetBytes') && pl.projected > L.maxAssetBytes) return lim('Track ' + (pl.track + 1) + ': ' + pl.projected + ' bytes exceed maxAssetBytes ' + L.maxAssetBytes, pl.path, pl.track);
      if (own(L, 'maxTotalBytes') && pl.projected > L.maxTotalBytes) return lim('Track ' + (pl.track + 1) + ': ' + pl.projected + ' bytes alone exceed maxTotalBytes ' + L.maxTotalBytes, pl.path, pl.track);
      if (own(L, 'maxEncodedChars') && pl.encodedChars > L.maxEncodedChars) return lim('Track ' + (pl.track + 1) + ': ' + pl.encodedChars + ' base64 characters alone exceed maxEncodedChars ' + L.maxEncodedChars, pl.path, pl.track);
    }
    if (!agg) return { ok: true, measured };
    // Certain growth: a payload whose length matches no existing entry and no other payload can never deduplicate.
    const existingLengths = new Set(Object.values(table).map(a => (isObj(a) ? a.bytes : undefined)));
    const counts = new Map();
    for (const pl of payloads) counts.set(pl.projected, (counts.get(pl.projected) || 0) + 1);
    let bytes = 0, chars = 0, count = 0;
    for (const pl of payloads) if (!existingLengths.has(pl.projected) && counts.get(pl.projected) === 1) { bytes += pl.projected; chars += pl.encodedChars; count++; }
    if (own(L, 'maxTotalBytes') && measured.projectedBytes + bytes > L.maxTotalBytes) return lim('certain growth: ' + (measured.projectedBytes + bytes) + ' bytes exceed maxTotalBytes ' + L.maxTotalBytes, 'assets');
    if (own(L, 'maxEncodedChars') && measured.encodedChars + chars > L.maxEncodedChars) return lim('certain growth: ' + (measured.encodedChars + chars) + ' base64 characters exceed maxEncodedChars ' + L.maxEncodedChars, 'assets');
    if (own(L, 'maxAssetCount') && measured.count + count > L.maxAssetCount) return lim('certain growth: ' + (measured.count + count) + ' assets exceed maxAssetCount ' + L.maxAssetCount, 'assets');
    return { ok: true, measured };
  }

  // ---------- prepare (sync) ----------
  function prepare(session, assets, opts) {
    const o = snapshotOpts(opts);
    if (!o.ok) return o;
    const s = snapshotSession(session);
    if (!s.ok) return s;
    const tb = snapshotTable(assets);
    if (!tb.ok) return tb;
    const plans = [];
    const payloads = [];
    for (const t of s.snap.tracks) {
      const pl = planTrack(t, o.opts.allowOmissions);
      if (!pl.ok) return pl;
      plans.push(Object.assign({ track: t }, pl));
      for (const x of pl.payloads) payloads.push(x);
    }
    const pf = preflightLimits(o.opts.limits, tb.table, payloads);
    if (!pf.ok) return pf;
    return { ok: true, opts: o.opts, snap: s.snap, table: tb.table, plans };
  }

  function baseReport(prep) {
    return {
      tracks: [], bytesAdded: 0, assetsAdded: 0, assetsDeduplicated: 0,
      existingVerified: false,
      legacyMaster: { masterVolume: prep.snap.masterVolume, loudnessDb: prep.snap.loudnessDb, imported: false }
    };
  }

  // ---------- run (async; works only on the prepared snapshot) ----------
  async function run(prep) {
    const { opts } = prep;
    const report = baseReport(prep);
    const s2opts = { limits: opts.limits };
    if (opts.engine) s2opts.engine = opts.engine;
    let table = prep.table;
    const failed = (r, track, stage) => {
      const out = fail(r.error, r.code, r.path, { track });
      if (r.code === 'limit') out.stage = stage;
      out.report = Object.assign(report, { failed: { track, stage, code: r.code } });
      return out;
    };
    if (opts.verifyExisting) {
      const v = await A.verifyAssets(table, s2opts);
      if (!v.ok) { const e = v.errors[0]; const out = fail('existing asset table failed verification: ' + e.path + ' ' + e.message, e.code, e.path, { errors: v.errors }); if (e.code === 'limit') out.stage = 'preflight'; out.report = Object.assign(report, { failed: { stage: 'verify-existing', code: e.code } }); return out; }
      report.existingVerified = true;
    }
    const perTrack = {};
    for (const plan of prep.plans) {
      const t = plan.track;
      const idx = t.index;
      const tr = { index: idx, threadId: undefined, sourceKind: plan.kind, added: [], deduplicated: [], bytesAdded: 0, unsupported: plan.unsupported.slice(), omitted: plan.omitted.map(o => Object.assign({}, o)) };
      if (plan.kind === 'node') tr.bundleMetadataVerified = false;
      const ids = {};
      const results = {};
      for (const pl of plan.payloads) {
        let bytes;
        if (pl.bytes) bytes = pl.bytes;
        else { const d = A.decodeBase64Strict(pl.data); if (!d.ok) return failed(fail('Track ' + (idx + 1) + ': ' + d.error, d.code, pl.path), idx, 'decode'); bytes = d.bytes; }
        const r = await A.addAssetBytes(table, bytes, pl.meta, s2opts);
        if (!r.ok) return failed(Object.assign({}, r, { error: 'Track ' + (idx + 1) + ': ' + r.error }), idx, 'growth');
        table = r.assets;
        if (r.deduplicated) { tr.deduplicated.push({ id: r.id, existingName: r.asset.name, field: pl.field }); report.assetsDeduplicated++; }
        else { tr.added.push(r.id); tr.bytesAdded += bytes.byteLength; report.bytesAdded += bytes.byteLength; report.assetsAdded++; }
        results[pl.field] = r;
        if (pl.role === 'playlist') { if (!ids.playlist) ids.playlist = []; ids.playlist.push(r.id); }
        else if (pl.role === 'bundle') ids.bundle = r.id;
        else if (pl.role === 'tape') ids.tape = r.id;
        else if (pl.role === 'sample') {
          if (plan.kind === 'playlist') {
            // Byte-equality proof: S2 sets deduplicated only after comparing the stored payload byte for byte.
            const sel = ids.playlist ? ids.playlist[t.playlistIndex || 0] : undefined;
            if (r.deduplicated && sel !== undefined && r.id === sel) ids.sampleEqualsSelectedItem = true;
            else ids.override = r.id;
          } else ids.sample = r.id;
        }
      }
      if (plan.kind === 'playlist' && !ids.playlist) ids.playlist = [];
      perTrack[idx] = ids;
      report.tracks.push(tr);
    }
    return { ok: true, assets: table, perTrack, report };
  }

  function depsMissing() {
    if (M && A && typeof M.validateDocument === 'function' && typeof A.addAssetBytes === 'function') return null;
    return fail('weave-model.js (S1) and weave-assets.js (S2) must be loaded before weave-import.js', 'engine', '');
  }

  // Last-resort guard: the public functions resolve to a structured failure even if something
  // inside throws unexpectedly. The result is completely independent of the thrown value: fixed
  // text, code "engine", empty path. The value is not read (no name, message, toString or
  // stringify), so a hostile throwable cannot throw again or leak into the result.
  function unexpected() {
    return { ok: false, error: 'unexpected internal failure during import', code: 'engine', path: '' };
  }

  async function extractAetherAssets(session, assets, opts) {
    let r;
    try {
      const missing = depsMissing();
      if (missing) return Object.assign(missing, { assets: null, perTrack: null });
      const prep = prepare(session, assets, opts);
      r = prep.ok ? await run(prep) : prep;
    } catch (e) { r = unexpected(); }
    if (!r.ok) { r.assets = null; r.perTrack = null; }   // never a partial table
    return r;
  }

  // ---------- import into a document ----------
  function sessionForModel(snap) {
    // The object S1 reads, rebuilt from the snapshot (never the caller's session).
    return {
      type: 'aether_project',
      name: snap.name,
      tracks: snap.tracks.map(t => {
        const o = {
          index: t.index,
          isCustomNode: t.isCustomNode,
          customNodeBundle: t.hasBundle ? { manifest: { id: t.bundleManifestId, version: t.bundleManifestVersion } } : null,
          customNodeZipBase64: t.zip,
          customNodeParams: t.customNodeParams,
          sampleData: t.sampleData,
          playlist: t.playlist.map(it => ({ name: it.name, type: it.type })),   // S1 reads only its length
          playlistIndex: t.playlistIndex, isShuffle: t.isShuffle, isRepeat: t.isRepeat,
          isLiveIn: t.isLiveIn, isStream: t.isStream, streamUrl: t.streamUrl,
          x: t.x, y: t.y, isMuted: t.isMuted, isSoloed: t.isSoloed,
          motionSpeed: t.motionSpeed, motionPath: t.motionPath, eq: t.eq, stripGainDb: t.stripGainDb
        };
        if (t.hasZ) o.z = t.z;
        if (t.sampleName !== undefined) o.sampleName = t.sampleName;
        if (t.name !== undefined) o.name = t.name;
        return o;
      })
    };
  }

  function mapThreads(doc, snap, ctx) {
    const byColor = new Map();
    for (const th of doc.threads) if (!byColor.has(th.color)) byColor.set(th.color, th.id);
    const ids = [undefined, undefined, undefined, undefined];
    for (const t of snap.tracks) {
      const i = t.index;
      const explicit = ctx.threadIds ? ctx.threadIds[i] : undefined;
      const id = explicit !== undefined ? explicit : byColor.get(COLOR_TOKENS[i]);
      if (typeof id !== 'string' || !M.ID_PATTERNS.thread.test(id)) {
        return fail('Track ' + (i + 1) + ': no thread for ' + COLOR_TOKENS[i] + ' in the document and no valid ctx.threadIds[' + i + '].', 'thread', 'threads', { track: i });
      }
      ids[i] = id;
    }
    return { ok: true, ids };
  }

  async function importAetherState(doc, session, ctx, opts) {
    try { return await importAetherStateUnsafe(doc, session, ctx, opts); }
    catch (e) { return unexpected(); }
  }
  async function importAetherStateUnsafe(doc, session, ctx, opts) {
    const missing = depsMissing();
    if (missing) return missing;
    const v = M.validateDocument(doc);
    if (!v.ok) return fail('The input document is not valid.', 'model', '', { errors: v.errors });
    const c = snapshotCtx(ctx);
    if (!c.ok) return c;
    const docSnap = JSON.parse(JSON.stringify(doc));
    const prep = prepare(session, docSnap.assets, opts);
    if (!prep.ok) return prep;
    const th = mapThreads(docSnap, prep.snap, c.ctx);
    if (!th.ok) return th;
    // Everything above is synchronous: the snapshot is complete before the first await.
    const ex = await run(prep);
    if (!ex.ok) return ex;
    const report = ex.report;
    const modelCtx = { threadIds: th.ids, assetIds: ex.perTrack };
    if (c.ctx.name !== undefined) modelCtx.name = c.ctx.name;
    if (c.ctx.fileName !== undefined) modelCtx.fileName = c.ctx.fileName;
    if (c.ctx.durationBeats !== undefined) modelCtx.durationBeats = c.ctx.durationBeats;
    if (c.ctx.captureBpm !== undefined) modelCtx.captureBpm = c.ctx.captureBpm;
    if (c.ctx.now) modelCtx.now = c.ctx.now;
    const m = M.sceneFromAetherState(sessionForModel(prep.snap), modelCtx);
    if (!m.ok) return fail(m.error, 'model', 'scene', { report });
    const scene = m.scene;
    const reasons = [];
    for (const tr of report.tracks) {
      tr.threadId = th.ids[tr.index];
      const ts = scene.threadStates[tr.threadId];
      if (ts && Array.isArray(ts.unsupported)) tr.unsupported = ts.unsupported.slice();
      for (const o of tr.omitted) reasons.push('track ' + (tr.index + 1) + ': ' + o.field + (o.name ? ' "' + o.name + '"' : '') + ' omitted (' + tr.sourceKind + ' source takes precedence)');
    }
    if (reasons.length) scene.completeness = { status: 'incomplete', reasons: reasons.map(r => clip(r, 200)) };
    report.completeness = JSON.parse(JSON.stringify(scene.completeness));
    // Only the assets the new Scene references are handed to S1 (every added asset is referenced).
    const referenced = new Set();
    for (const ids of Object.values(ex.perTrack)) {
      for (const id of (ids.playlist || [])) referenced.add(id);
      for (const k of ['sample', 'override', 'bundle', 'tape']) if (ids[k]) referenced.add(ids[k]);
    }
    const sceneAssets = {};
    for (const id of referenced) if (!own(docSnap.assets, id)) sceneAssets[id] = ex.assets[id];
    const addOpts = { assets: sceneAssets };
    if (c.ctx.index !== undefined) addOpts.index = c.ctx.index;
    if (c.ctx.now) addOpts.now = c.ctx.now;
    if (c.ctx.uuid) addOpts.uuid = c.ctx.uuid;
    const r = M.addScene(docSnap, scene, addOpts);
    if (!r.ok) return fail(r.error, 'model', 'scene', { errors: r.errors, report });
    report.sceneId = r.id;
    return { ok: true, doc: r.doc, sceneId: r.id, report };
  }

  return Object.freeze({ canonicalJsonBytes, extractAetherAssets, importAetherState });
});
