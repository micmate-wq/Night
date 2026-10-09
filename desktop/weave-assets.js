// Aether Weave v0.1 — asset integrity helpers (Phase 1, slice S2).
//
// Pure helpers only: no DOM, no Web Audio, no Tauri, no file I/O, no audio
// decoding, no bundle execution. Not loaded by the app; nothing in index.html
// or weave.js uses this file. S1 (weave-model.js) checks the document
// structure; this module checks the asset payloads S1 deliberately skipped:
// canonical base64, decoded byte length, and SHA-256 identity.
//
// Public API. Contract: every function that takes untrusted input returns a plain
// result object `{ ok, ... }` and never throws; on failure it carries `error` (text),
// `code` and `path`. No function mutates its arguments. Two small synchronous
// utilities are the deliberate exceptions and are meant for trusted internal values:
//   encodeBase64(bytes) returns a string and THROWS a TypeError on non-binary input;
//   base64LengthForBytes(n) returns a number, or NaN when n is not a non-negative
//   safe integer. Use toBytes()/checkLimits() first when the value is untrusted.
//
//   ASSET_ID_PREFIX                       'sha256:'
//   LIMIT_KEYS                            names accepted in opts.limits
//   toBytes(input)                        -> { ok, bytes: Uint8Array } | { ok: false, ... }
//                                            ArrayBuffer or any ArrayBufferView; a view's
//                                            byteOffset/byteLength are respected exactly. The
//                                            returned view shares the caller's memory.
//   encodeBase64(bytes)                   -> canonical base64 string (throws on non-binary input)
//   base64LengthForBytes(n)               -> encoded length of n bytes, or NaN
//   decodedLengthOfBase64(str)            -> { ok, bytes } | { ok: false, ... }
//                                            from the string's length and padding only
//                                            (no decoding, no allocation).
//   decodeBase64Strict(str)               -> { ok, bytes: Uint8Array } | { ok: false, ... }
//                                            canonical only: standard alphabet, length % 4 === 0,
//                                            padding only at the end, zero unused trailing bits.
//   sha256Hex(input, opts?)      (async) -> { ok, hex } | { ok: false, ... }
//                                            WebCrypto (crypto.subtle) in browsers and Node;
//                                            opts.engine 'node' forces Node's crypto module.
//                                            Hashes the bytes as they are when called; it does
//                                            not copy, so the caller must not change the view
//                                            until the promise settles if the hash is to
//                                            describe the bytes it keeps.
//   assetIdForBytes(input, opts?)(async) -> { ok, id, byteLength } | { ok: false, ... }
//   checkLimits(limits)                   -> { ok, limits } | { ok: false, ... }
//   measureAssets(assets)                 -> { ok, errors, count, declaredBytes, encodedChars,
//                                            projectedBytes } — accounting from declared
//                                            metadata and encoded lengths; decodes nothing.
//   verifyAssets(assets, opts?)  (async) -> { ok, errors, verified, totals }
//                                            Preflight (structure, projected lengths, limits)
//                                            runs over the whole table BEFORE any payload is
//                                            decoded or hashed, and captures each payload string
//                                            and declared size then; later changes to the
//                                            caller's asset objects do not affect the result.
//                                            On any error, verified is null: there are no
//                                            partially accepted payloads.
//   addAssetBytes(assets, input, meta, opts?) (async)
//                                         -> { ok, assets, id, deduplicated, asset } | { ok: false, ... }
//                                            After size preflight it snapshots the exact input
//                                            slice and the metadata fields; the same snapshot is
//                                            hashed and stored, so changes the caller makes while
//                                            the promise is pending cannot reach the asset.
//                                            New bytes: a new table with one added entry.
//                                            Identical bytes: the stored payload is decoded and
//                                            compared byte for byte (a matching key alone is not
//                                            proof); if it matches, deduplicated = true, the table
//                                            is returned unchanged and the existing entry's
//                                            metadata is kept, whatever the new name or origin.
//                                            A corrupted stored payload, a different kind, or a
//                                            different bundle manifestId/version is rejected.
//                                            Limits: a payload that could never fit (per-asset,
//                                            or alone above an aggregate limit), or a table that
//                                            already breaks an aggregate limit, is rejected
//                                            before hashing, duplicate or not. Otherwise
//                                            aggregate limits charge only real growth: a
//                                            duplicate adds nothing. Identifying a duplicate
//                                            needs a hash (bounded by maxAssetBytes when
//                                            supplied); when no stored entry has the same byte
//                                            count the bytes are certainly new and the aggregate
//                                            check runs before hashing.
//                                            Table snapshot: the table is read once, before the
//                                            await: key order, totals, and one copy of every
//                                            entry (own fields and the storage object copied,
//                                            the payload string shared by reference; nothing
//                                            large is copied). Both success paths return a
//                                            FRESH table built only from that snapshot (on a
//                                            duplicate it is deeply equal to the input as it was
//                                            when called), and `asset` is `assets[id]` of that
//                                            table. Entries the caller adds, removes or rewrites
//                                            while the promise is pending, and later edits to
//                                            its own entry objects, never reach the result.
//
// What this module proves and does not prove:
//   * It proves that stored bytes are exactly the bytes named by their key.
//   * It never infers that a rendered buffer equals an original file. Two assets
//     with different bytes are two assets, whatever their names or origins. A
//     playlist override that points at a rendered-buffer asset is left alone.
//   * Sizes reported are unique stored bytes and their base64 text. They are not
//     the serialized document size, decoded PCM size, DSP memory or a safe native
//     memory budget. Limits are caller-supplied; there is no built-in product
//     limit (D10 is unapproved).
//   * Empty payloads: hashing zero bytes works (sha256 of "" is well defined), but
//     an asset with zero bytes is refused by verifyAssets and addAssetBytes,
//     because an empty audio file or node bundle is never a usable asset. This is
//     an S2 policy, provisional until Matt confirms it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.AetherWeaveAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ASSET_ID_PREFIX = 'sha256:';
  const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_VALUE = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) B64_VALUE[B64.charCodeAt(i)] = i;
  const KINDS = { audio: ['original-file', 'rendered-buffer'], 'node-bundle': ['aethernode-zip', 'unpacked-json'] };
  const LIMIT_KEYS = Object.freeze(['maxAssetBytes', 'maxTotalBytes', 'maxEncodedChars', 'maxAssetCount']);

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isStr = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
  const fail = (error, code, path) => ({ ok: false, error, code, path });

  // ---------- bytes ----------
  function toBytes(input) {
    if (input instanceof ArrayBuffer) return { ok: true, bytes: new Uint8Array(input) };
    if (ArrayBuffer.isView(input)) return { ok: true, bytes: new Uint8Array(input.buffer, input.byteOffset, input.byteLength) };
    return fail('bytes must be an ArrayBuffer or an ArrayBuffer view (Uint8Array, DataView, Buffer…)', 'bytes');
  }

  function hex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  // ---------- base64 (canonical, RFC 4648 §4, no line breaks, no URL alphabet) ----------
  function base64LengthForBytes(n) {
    if (!Number.isSafeInteger(n) || n < 0) return NaN;
    return Math.ceil(n / 3) * 4;
  }

  function encodeBase64(input) {
    const r = toBytes(input);
    if (!r.ok) throw new Error(r.error);
    const b = r.bytes;
    let out = '';
    let i = 0;
    for (; i + 2 < b.length; i += 3) {
      const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < b.length) {
      const rem = b.length - i;
      const n = rem === 1 ? (b[i] << 16) : ((b[i] << 16) | (b[i + 1] << 8));
      out += B64[n >> 18] + B64[(n >> 12) & 63] + (rem === 2 ? B64[(n >> 6) & 63] : '=') + '=';
    }
    return out;
  }

  // Length from shape only: no decoding, no allocation. Character validity is checked by decodeBase64Strict.
  function decodedLengthOfBase64(str) {
    if (typeof str !== 'string') return fail('base64 payload must be a string', 'base64');
    const L = str.length;
    if (L % 4 !== 0) return fail('base64 length must be a multiple of 4 (' + L + ')', 'base64');
    if (L === 0) return { ok: true, bytes: 0 };
    let pad = 0;
    if (str.charCodeAt(L - 1) === 61) pad++;
    if (pad === 1 && str.charCodeAt(L - 2) === 61) pad++;
    return { ok: true, bytes: (L / 4) * 3 - pad };
  }

  function decodeBase64Strict(str) {
    const shape = decodedLengthOfBase64(str);
    if (!shape.ok) return shape;
    const L = str.length;
    const out = new Uint8Array(shape.bytes);
    let pad = (L / 4) * 3 - shape.bytes;
    const body = L - pad;
    for (let i = 0; i < body; i++) {
      const c = str.charCodeAt(i);
      if (c === 61) return fail('base64 padding must only appear at the end (found "=" at index ' + i + ')', 'base64');
      if (c > 255 || B64_VALUE[c] < 0) return fail('base64 contains a character outside the canonical alphabet at index ' + i, 'base64');
    }
    for (let i = body; i < L; i++) if (str.charCodeAt(i) !== 61) return fail('base64 padding must only appear at the end', 'base64');
    let o = 0;
    for (let i = 0; i < L; i += 4) {
      const a = B64_VALUE[str.charCodeAt(i)], b = B64_VALUE[str.charCodeAt(i + 1)];
      const c = i + 2 < body ? B64_VALUE[str.charCodeAt(i + 2)] : 0;
      const d = i + 3 < body ? B64_VALUE[str.charCodeAt(i + 3)] : 0;
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      out[o++] = n >> 16;
      if (i + 2 < body) out[o++] = (n >> 8) & 255;
      if (i + 3 < body) out[o++] = n & 255;
    }
    // Canonical form: the unused low bits of the last data character must be zero.
    if (pad === 1 && (B64_VALUE[str.charCodeAt(body - 1)] & 3) !== 0) return fail('base64 is not canonical: unused trailing bits are set', 'base64');
    if (pad === 2 && (B64_VALUE[str.charCodeAt(body - 1)] & 15) !== 0) return fail('base64 is not canonical: unused trailing bits are set', 'base64');
    return { ok: true, bytes: out };
  }

  // ---------- SHA-256 ----------
  async function sha256Hex(input, opts) {
    const r = toBytes(input);
    if (!r.ok) return r;
    const engine = opts && opts.engine;
    if (engine !== undefined && engine !== 'subtle' && engine !== 'node') return fail('opts.engine must be "subtle" or "node"', 'engine');
    try {
      const subtle = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
      if (engine !== 'node' && subtle && typeof subtle.digest === 'function') {
        // The view carries its own offset and length; digest hashes exactly those bytes.
        const d = await subtle.digest('SHA-256', r.bytes);
        return { ok: true, hex: hex(new Uint8Array(d)) };
      }
      if (engine !== 'subtle' && typeof require === 'function') {
        const nodeCrypto = require('crypto');
        return { ok: true, hex: nodeCrypto.createHash('sha256').update(r.bytes).digest('hex') };
      }
      return fail('no SHA-256 implementation available (needs crypto.subtle or Node crypto)', 'engine');
    } catch (e) {
      return fail('SHA-256 failed: ' + (e && e.message ? e.message : String(e)), 'engine');
    }
  }

  async function assetIdForBytes(input, opts) {
    const h = await sha256Hex(input, opts);
    if (!h.ok) return h;
    return { ok: true, id: ASSET_ID_PREFIX + h.hex, byteLength: toBytes(input).bytes.byteLength };
  }

  // ---------- limits ----------
  function checkLimits(limits) {
    if (limits === undefined || limits === null) return { ok: true, limits: {} };
    if (!isObj(limits)) return fail('limits must be an object', 'limit');
    const out = {};
    for (const k of Object.keys(limits)) {
      if (!LIMIT_KEYS.includes(k)) return fail('unknown limit "' + k + '" (allowed: ' + LIMIT_KEYS.join(', ') + ')', 'limit');
      const v = limits[k];
      if (v === undefined) continue;
      if (!Number.isSafeInteger(v) || v < 0) return fail('limit ' + k + ' must be a non-negative safe integer', 'limit');
      out[k] = v;
    }
    return { ok: true, limits: out };
  }

  // ---------- table preflight (structure + projected sizes; decodes nothing) ----------
  function preflightTable(assets) {
    const errors = [];
    const err = (path, message, code) => errors.push({ path, message, code });
    if (!isObj(assets)) { err('assets', 'must be an object keyed by asset ID', 'container'); return { errors, entries: [] }; }
    const entries = [];
    for (const key of Object.keys(assets)) {
      const p = 'assets["' + key + '"]';
      const a = assets[key];
      if (!ASSET_ID.test(key)) err(p, 'key must be sha256:<64 lowercase hex>', 'key');
      if (!isObj(a)) { err(p, 'must be an object', 'container'); continue; }
      if (!own(KINDS, a.kind)) err(p + '.kind', 'must be audio or node-bundle', 'metadata');
      const declared = a.bytes;
      if (!(Number.isSafeInteger(declared) && declared >= 0)) err(p + '.bytes', 'must be a non-negative integer', 'metadata');
      if (!isObj(a.storage)) { err(p + '.storage', 'must be an object', 'container'); continue; }
      if (a.storage.kind !== 'inline-base64') err(p + '.storage.kind', 'must be inline-base64', 'storage');
      const data = a.storage.data;
      if (typeof data !== 'string') { err(p + '.storage.data', 'must be a base64 string', 'storage'); continue; }
      const shape = decodedLengthOfBase64(data);
      if (!shape.ok) { err(p + '.storage.data', shape.error, 'base64'); continue; }
      if (shape.bytes === 0) err(p + '.storage.data', 'asset payload is empty (zero bytes)', 'empty');
      if (Number.isSafeInteger(declared) && declared !== shape.bytes) err(p + '.bytes', 'declares ' + declared + ' bytes but the base64 encodes ' + shape.bytes, 'length');
      entries.push({ key, asset: a, kind: a.kind, data, projected: shape.bytes, encodedChars: data.length });
    }
    return { errors, entries };
  }

  function applyLimits(limits, entries, errors) {
    const err = (path, message) => errors.push({ path, message, code: 'limit' });
    if (own(limits, 'maxAssetCount') && entries.length > limits.maxAssetCount) err('assets', entries.length + ' assets exceed maxAssetCount ' + limits.maxAssetCount);
    let total = 0, chars = 0;
    for (const e of entries) {
      total += e.projected; chars += e.encodedChars;
      if (own(limits, 'maxAssetBytes') && e.projected > limits.maxAssetBytes) err('assets["' + e.key + '"]', 'projected ' + e.projected + ' bytes exceed maxAssetBytes ' + limits.maxAssetBytes);
    }
    if (own(limits, 'maxTotalBytes') && total > limits.maxTotalBytes) err('assets', 'projected total ' + total + ' bytes exceed maxTotalBytes ' + limits.maxTotalBytes);
    if (own(limits, 'maxEncodedChars') && chars > limits.maxEncodedChars) err('assets', chars + ' base64 characters exceed maxEncodedChars ' + limits.maxEncodedChars);
    return { total, chars };
  }

  // Accounting only. declaredBytes sums asset.bytes; projectedBytes comes from the base64 shape.
  // Neither is the serialized document size, decoded audio size or DSP memory.
  function measureAssets(assets) {
    const { errors, entries } = preflightTable(assets);
    let declaredBytes = 0, encodedChars = 0, projectedBytes = 0;
    for (const e of entries) { declaredBytes += e.asset.bytes; encodedChars += e.encodedChars; projectedBytes += e.projected; }
    return { ok: errors.length === 0, errors, count: entries.length, declaredBytes, encodedChars, projectedBytes };
  }

  // ---------- verification ----------
  async function verifyAssets(assets, opts) {
    const lim = checkLimits(opts && opts.limits);
    if (!lim.ok) return { ok: false, errors: [{ path: 'limits', message: lim.error, code: 'limit' }], verified: null };
    const { errors, entries } = preflightTable(assets);
    const sums = applyLimits(lim.limits, entries, errors);
    const totals = { count: entries.length, projectedBytes: sums.total, encodedChars: sums.chars };
    // Nothing below runs unless the whole table passed preflight and limits.
    if (errors.length) return { ok: false, errors, verified: null, totals };
    const verified = {};
    for (const e of entries) {
      const p = 'assets["' + e.key + '"]';
      const dec = decodeBase64Strict(e.data);
      if (!dec.ok) { errors.push({ path: p + '.storage.data', message: dec.error, code: 'base64' }); continue; }
      if (dec.bytes.byteLength !== e.projected) { errors.push({ path: p + '.bytes', message: 'decoded ' + dec.bytes.byteLength + ' bytes, declared ' + e.projected, code: 'length' }); continue; }
      const h = await sha256Hex(dec.bytes, opts && opts.engine ? { engine: opts.engine } : undefined);
      if (!h.ok) { errors.push({ path: p, message: h.error, code: 'engine' }); continue; }
      if (ASSET_ID_PREFIX + h.hex !== e.key) { errors.push({ path: p, message: 'bytes hash to ' + ASSET_ID_PREFIX + h.hex + ', not the key', code: 'hash' }); continue; }
      verified[e.key] = { bytes: dec.bytes, byteLength: dec.bytes.byteLength, kind: e.kind };
    }
    if (errors.length) return { ok: false, errors, verified: null, totals };
    return { ok: true, errors, verified, totals };
  }

  // ---------- adding bytes with dedupe ----------
  function checkMeta(meta) {
    if (!isObj(meta)) return fail('meta must be an object', 'metadata', 'meta');
    const allowed = ['kind', 'name', 'mime', 'origin'].concat(meta.kind === 'node-bundle' ? ['manifestId', 'version'] : []);
    for (const k of Object.keys(meta)) if (!allowed.includes(k)) return fail('unexpected meta field "' + k + '"', 'metadata', 'meta.' + k);
    if (!own(KINDS, meta.kind)) return fail('meta.kind must be audio or node-bundle', 'metadata', 'meta.kind');
    if (!KINDS[meta.kind].includes(meta.origin)) return fail('meta.origin must be one of ' + KINDS[meta.kind].join(', '), 'metadata', 'meta.origin');
    if (!isStr(meta.name, 1, 200)) return fail('meta.name must be a string of 1–200 characters', 'metadata', 'meta.name');
    if (!isStr(meta.mime, 1, 100)) return fail('meta.mime must be a non-empty string', 'metadata', 'meta.mime');
    if (meta.kind === 'node-bundle') {
      if (!isStr(meta.manifestId, 1, 200)) return fail('meta.manifestId must be a non-empty string', 'metadata', 'meta.manifestId');
      if (!isStr(meta.version, 1, 50)) return fail('meta.version must be a non-empty string', 'metadata', 'meta.version');
    }
    return { ok: true };
  }

  // Does the stored entry really hold these bytes? A matching key is a claim, not proof.
  // `ex` is the snapshot of the entry as it was when addAssetBytes was called.
  function storedPayloadEquals(id, ex, bytes) {
    const p = 'assets["' + id + '"]';
    if (!isObj(ex)) return fail('existing asset ' + id + ' is not an object', 'container', p);
    if (!isObj(ex.storage) || ex.storage.kind !== 'inline-base64' || typeof ex.storage.data !== 'string') return fail('existing asset has no inline-base64 payload', 'storage', p + '.storage');
    const shape = decodedLengthOfBase64(ex.storage.data);
    if (!shape.ok) return fail('existing payload: ' + shape.error, 'base64', p + '.storage.data');
    if (shape.bytes !== bytes.byteLength || ex.bytes !== bytes.byteLength) return fail('existing asset declares ' + ex.bytes + ' bytes and encodes ' + shape.bytes + ', new bytes are ' + bytes.byteLength, 'length', p + '.bytes');
    const dec = decodeBase64Strict(ex.storage.data);
    if (!dec.ok) return fail('existing payload: ' + dec.error, 'base64', p + '.storage.data');
    for (let i = 0; i < bytes.byteLength; i++) if (dec.bytes[i] !== bytes[i]) return fail('stored payload under ' + id + ' differs from the new bytes at offset ' + i + '; the key is not proof of content', 'hash', p);
    return { ok: true };
  }

  // Table concurrency contract: addAssetBytes works on the table as it is when called. Before the
  // await it takes one snapshot of every entry (own fields copied, the storage object copied, the
  // payload string shared by reference: strings are immutable, so nothing large is copied) plus the
  // key order and measured totals. Both success paths return a FRESH table built only from that
  // snapshot, so entries the caller adds, removes or rewrites while the promise is pending are
  // neither counted, consulted nor carried into the result, and later caller edits to its own
  // entry objects do not reach the result either. The input table is never modified.
  function snapshotEntry(a) {
    if (!isObj(a)) return a;
    const copy = Object.assign({}, a);
    if (isObj(a.storage)) copy.storage = Object.assign({}, a.storage);
    return copy;
  }
  async function addAssetBytes(assets, input, meta, opts) {
    if (!isObj(assets)) return fail('assets must be an object keyed by asset ID', 'container', 'assets');
    const m = checkMeta(meta);
    if (!m.ok) return m;
    const r = toBytes(input);
    if (!r.ok) return r;
    const n = r.bytes.byteLength;
    if (n === 0) return fail('asset payload is empty (zero bytes)', 'empty', 'bytes');
    const lim = checkLimits(opts && opts.limits);
    if (!lim.ok) return lim;
    const L = lim.limits;
    const enc = base64LengthForBytes(n);
    // Provable before any hashing or allocation: this payload could never fit, duplicate or not.
    if (own(L, 'maxAssetBytes') && n > L.maxAssetBytes) return fail(n + ' bytes exceed maxAssetBytes ' + L.maxAssetBytes, 'limit', 'bytes');
    if (own(L, 'maxTotalBytes') && n > L.maxTotalBytes) return fail(n + ' bytes alone exceed maxTotalBytes ' + L.maxTotalBytes, 'limit', 'bytes');
    if (own(L, 'maxEncodedChars') && enc > L.maxEncodedChars) return fail(enc + ' base64 characters alone exceed maxEncodedChars ' + L.maxEncodedChars, 'limit', 'bytes');
    const aggregate = own(L, 'maxTotalBytes') || own(L, 'maxEncodedChars') || own(L, 'maxAssetCount');
    let measured = null;
    if (aggregate) {
      measured = measureAssets(assets);
      if (!measured.ok) return { ok: false, error: 'existing asset table failed preflight: ' + measured.errors[0].path + ' ' + measured.errors[0].message, code: measured.errors[0].code, path: measured.errors[0].path };
      // A table that already breaks a limit is refused outright, duplicate or not, before hashing.
      if (own(L, 'maxTotalBytes') && measured.projectedBytes > L.maxTotalBytes) return fail('existing assets already total ' + measured.projectedBytes + ' bytes, over maxTotalBytes ' + L.maxTotalBytes, 'limit', 'assets');
      if (own(L, 'maxEncodedChars') && measured.encodedChars > L.maxEncodedChars) return fail('existing assets already hold ' + measured.encodedChars + ' base64 characters, over maxEncodedChars ' + L.maxEncodedChars, 'limit', 'assets');
      if (own(L, 'maxAssetCount') && measured.count > L.maxAssetCount) return fail('existing table already has ' + measured.count + ' assets, over maxAssetCount ' + L.maxAssetCount, 'limit', 'assets');
    }
    // Aggregate limits charge only real growth. A duplicate adds nothing, but it can only be
    // identified by hashing (bounded by maxAssetBytes when supplied). A duplicate must already be
    // stored with the same byte count, so when no entry has that count the bytes are certainly new
    // and the aggregate check still runs before hashing.
    const growthFails = () => {
      if (own(L, 'maxTotalBytes') && measured.projectedBytes + n > L.maxTotalBytes) return fail('projected total ' + (measured.projectedBytes + n) + ' bytes exceed maxTotalBytes ' + L.maxTotalBytes, 'limit', 'assets');
      if (own(L, 'maxEncodedChars') && measured.encodedChars + enc > L.maxEncodedChars) return fail('projected ' + (measured.encodedChars + enc) + ' base64 characters exceed maxEncodedChars ' + L.maxEncodedChars, 'limit', 'assets');
      if (own(L, 'maxAssetCount') && measured.count + 1 > L.maxAssetCount) return fail((measured.count + 1) + ' assets exceed maxAssetCount ' + L.maxAssetCount, 'limit', 'assets');
      return null;
    };
    // Snapshot the table: key order and one copy of every entry (see the contract above).
    const keys = Object.keys(assets);
    const entries = keys.map(k => snapshotEntry(assets[k]));
    const candidates = new Map();
    for (let i = 0; i < keys.length; i++) if (isObj(entries[i]) && entries[i].bytes === n) candidates.set(keys[i], entries[i]);
    if (aggregate && candidates.size === 0) { const g = growthFails(); if (g) return g; }
    // Snapshot the input slice and metadata fields: the caller keeps ownership of its view and
    // metadata object and may change them while hashing is pending.
    const bytes = r.bytes.slice();
    const snap = Object.freeze({ kind: meta.kind, name: meta.name, mime: meta.mime, origin: meta.origin, manifestId: meta.manifestId, version: meta.version });
    const h = await sha256Hex(bytes, opts && opts.engine ? { engine: opts.engine } : undefined);
    if (!h.ok) return h;
    const id = ASSET_ID_PREFIX + h.hex;
    if (candidates.has(id)) {
      // Same key already stored: verify its payload really is these bytes, then keep the existing
      // entry's metadata (first writer wins) unless the kind or bundle identity contradicts.
      const ex = candidates.get(id);
      const same = storedPayloadEquals(id, ex, bytes);
      if (!same.ok) return same;
      if (ex.kind !== snap.kind) return fail('identical bytes already stored as kind "' + ex.kind + '", cannot add as "' + snap.kind + '"', 'metadata', 'assets["' + id + '"].kind');
      if (snap.kind === 'node-bundle' && (ex.manifestId !== snap.manifestId || ex.version !== snap.version)) {
        return fail('identical bundle bytes already stored as ' + ex.manifestId + '@' + ex.version + ', cannot add as ' + snap.manifestId + '@' + snap.version, 'metadata', 'assets["' + id + '"]');
      }
      // Deeply equal to the input as it was when called, but a fresh table of snapshot entries.
      const table = {};
      for (let i = 0; i < keys.length; i++) table[keys[i]] = entries[i];
      return { ok: true, assets: table, id, deduplicated: true, asset: ex };
    }
    if (keys.includes(id)) {
      // Same key but a different byte count than the new bytes: the stored entry cannot be these bytes.
      const ex = entries[keys.indexOf(id)];
      return fail('existing asset ' + id + ' declares ' + (isObj(ex) ? ex.bytes : 'no') + ' bytes, new bytes are ' + n + '; the key is not proof of content', 'length', 'assets["' + id + '"].bytes');
    }
    if (aggregate && candidates.size > 0) { const g = growthFails(); if (g) return g; }
    const asset = { kind: snap.kind, name: snap.name, mime: snap.mime, bytes: n, origin: snap.origin };
    if (snap.kind === 'node-bundle') { asset.manifestId = snap.manifestId; asset.version = snap.version; }
    asset.storage = { kind: 'inline-base64', data: encodeBase64(bytes) };
    const next = {};
    for (let i = 0; i < keys.length; i++) next[keys[i]] = entries[i];
    next[id] = asset;
    return { ok: true, assets: next, id, deduplicated: false, asset };
  }

  return Object.freeze({
    ASSET_ID_PREFIX, LIMIT_KEYS,
    toBytes, encodeBase64, base64LengthForBytes, decodedLengthOfBase64, decodeBase64Strict,
    sha256Hex, assetIdForBytes, checkLimits, measureAssets, verifyAssets, addAssetBytes
  });
});
