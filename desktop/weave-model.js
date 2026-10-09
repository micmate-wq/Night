// Aether Weave v0.1 — pure Scene model (Phase 1, slice S1).
//
// Pure data functions only: no DOM, no Web Audio, no Tauri, no hashing, no I/O.
// Not loaded by the app yet; nothing in index.html or weave.js uses this file.
// The schema is described in project-state/PHASE-1-DESIGN.md (revision 2).
// Defaults in this module (edge defaults, master level, four default threads)
// are provisional until Matt approves decisions D1–D10.
//
// Payload checks (base64, byte length, SHA-256) belong to S2. The structural
// validator here checks asset-key syntax and reference kinds only.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  root.AetherWeaveModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const DOC_TYPE = 'aether_weave';
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const ID_PREFIXES = { weave: 'wv', thread: 'th', scene: 'sc', edge: 'ed' };
  const ID_PATTERNS = Object.freeze({
    weave: new RegExp('^wv_' + UUID + '$'),
    thread: new RegExp('^th_' + UUID + '$'),
    scene: new RegExp('^sc_' + UUID + '$'),
    edge: new RegExp('^ed_' + UUID + '$'),
    asset: /^sha256:[0-9a-f]{64}$/
  });
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

  const LIMITS = Object.freeze({
    bpm: [20, 400], beatsPerBar: [1, 16], volume: [0, 1], loudnessDb: [-18, 12],
    gainDb: [-24, 6], eq: [-15, 15], x: [0, 1], y: [0, 1], z: [0, 50],
    speed: [0.0001, 2], captureBpm: [20, 400], durationBeats: [0.25, 1e6], overlapBeats: [0, 1e6]
  });
  const CURVES = ['lin', 'ease', 'late'];
  const MODES = ['jump', 'morph', 'fade'];
  const SOURCE_KINDS = { empty: null, sample: 'sample', playlist: 'playlist', node: 'node', 'live-input': 'external', stream: 'external' };
  const RESERVED_DURATION_MODES = ['source', 'open'];
  const UNSUPPORTED_CODES = ['node-private-state', 'live-input-not-stored', 'stream-external', 'motion-free-time'];
  const ASSET_ORIGINS = { audio: ['original-file', 'rendered-buffer'], 'node-bundle': ['aethernode-zip', 'unpacked-json'] };
  const COLOR_TOKENS = ['track-1', 'track-2', 'track-3', 'track-4'];
  // Provisional (D7): today's engine default is 8 bars, ease, MORPH.
  const DEFAULT_EDGE = Object.freeze({ overlapBeats: 32, curve: 'ease', mode: 'morph' });
  const DEFAULT_WRITER = Object.freeze({ app: 'Aether Weave v0.1 Lab', version: 'weave-model/1' });

  // ---------- small helpers ----------
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const inRange = (v, r) => isNum(v) && v >= r[0] && v <= r[1];
  const isInt = (v) => Number.isInteger(v);
  const isStr = (v, min = 1, max = Infinity) => typeof v === 'string' && v.length >= min && v.length <= max;
  const isIso = (v) => typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function nowIso(opts) {
    if (opts && typeof opts.now === 'function') return opts.now();
    if (opts && typeof opts.now === 'string') return opts.now;
    return new Date().toISOString();
  }

  // newId('sc') → 'sc_<uuid v4>'. opts.uuid may supply a generator (tests).
  function newId(prefix, opts) {
    if (!Object.values(ID_PREFIXES).includes(prefix)) throw new Error('Unknown ID prefix: ' + prefix);
    const gen = opts && typeof opts.uuid === 'function' ? opts.uuid
      : (root_crypto() && typeof root_crypto().randomUUID === 'function' ? () => root_crypto().randomUUID() : null);
    if (!gen) throw new Error('No UUID generator available.');
    const id = prefix + '_' + String(gen()).toLowerCase();
    const kind = Object.keys(ID_PREFIXES).find(k => ID_PREFIXES[k] === prefix);
    if (!ID_PATTERNS[kind].test(id)) throw new Error('Generated ID is not a valid ' + kind + ' ID: ' + id);
    return id;
  }
  function root_crypto() { return (typeof globalThis !== 'undefined' && globalThis.crypto) || null; }

  // ---------- structural validator ----------
  // Never throws. Returns { ok, errors: [{ path, message }] }.
  function validateDocument(doc) {
    const errors = [];
    const err = (path, message) => errors.push({ path, message });
    try {
      validateInto(doc, err);
    } catch (e) {
      err('', 'Validator could not read the document: ' + (e && e.message ? e.message : String(e)));
    }
    return { ok: errors.length === 0, errors };
  }

  function checkKeys(obj, path, required, optional, err) {
    for (const k of required) if (!own(obj, k)) err(path ? path + '.' + k : k, 'is required');
    const allowed = new Set(required.concat(optional || []));
    for (const k of Object.keys(obj)) if (!allowed.has(k)) err(path ? path + '.' + k : k, 'is not a known field');
  }

  function validateInto(doc, err) {
    if (!isObj(doc)) { err('', 'Document must be an object.'); return; }
    if (doc.type !== DOC_TYPE) { err('type', 'must be "' + DOC_TYPE + '"'); return; }
    if (!isInt(doc.schemaVersion)) { err('schemaVersion', 'must be an integer'); return; }
    if (doc.schemaVersion > SCHEMA_VERSION) { err('schemaVersion', 'is newer than this reader supports (' + SCHEMA_VERSION + ')'); return; }
    if (doc.schemaVersion !== SCHEMA_VERSION) { err('schemaVersion', 'must be ' + SCHEMA_VERSION); return; }

    checkKeys(doc, '', ['type', 'schemaVersion', 'id', 'name', 'createdAt', 'modifiedAt', 'writer', 'tempo',
      'master', 'assets', 'threads', 'scenes', 'order', 'edges', 'ending'], [], err);

    if (!(typeof doc.id === 'string' && ID_PATTERNS.weave.test(doc.id))) err('id', 'must be a Weave ID (wv_<uuid v4>)');
    if (!isStr(doc.name, 1, 120)) err('name', 'must be a string of 1–120 characters');
    if (!isIso(doc.createdAt)) err('createdAt', 'must be an ISO-8601 UTC time');
    if (!isIso(doc.modifiedAt)) err('modifiedAt', 'must be an ISO-8601 UTC time');

    if (!isObj(doc.writer)) err('writer', 'must be an object');
    else {
      checkKeys(doc.writer, 'writer', ['app', 'version'], [], err);
      if (!isStr(doc.writer.app, 1, 200)) err('writer.app', 'must be a non-empty string');
      if (!isStr(doc.writer.version, 1, 100)) err('writer.version', 'must be a non-empty string');
    }

    if (!isObj(doc.tempo)) err('tempo', 'must be an object');
    else {
      checkKeys(doc.tempo, 'tempo', ['bpm', 'beatsPerBar', 'source'], [], err);
      if (!inRange(doc.tempo.bpm, LIMITS.bpm)) err('tempo.bpm', 'must be a number from 20 to 400');
      if (!(isInt(doc.tempo.beatsPerBar) && inRange(doc.tempo.beatsPerBar, LIMITS.beatsPerBar))) err('tempo.beatsPerBar', 'must be an integer from 1 to 16');
      if (!isStr(doc.tempo.source, 1, 40)) err('tempo.source', 'must be a non-empty string');
    }

    if (!isObj(doc.master)) err('master', 'must be an object');
    else {
      checkKeys(doc.master, 'master', ['volume', 'loudnessDb'], [], err);
      if (!inRange(doc.master.volume, LIMITS.volume)) err('master.volume', 'must be from 0 to 1');
      if (!inRange(doc.master.loudnessDb, LIMITS.loudnessDb)) err('master.loudnessDb', 'must be from -18 to 12');
    }

    if (doc.ending !== null) err('ending', 'must be null in schema v1 (ending is not defined yet)');

    // Assets
    const assets = isObj(doc.assets) ? doc.assets : null;
    if (!assets) err('assets', 'must be an object keyed by asset ID');
    else {
      for (const [key, a] of Object.entries(assets)) {
        const p = 'assets["' + key + '"]';
        if (!ID_PATTERNS.asset.test(key)) err(p, 'key must be sha256:<64 lowercase hex>');
        validateAsset(a, p, err);
      }
    }
    const assetKind = (id) => (assets && typeof id === 'string' && isObj(assets[id])) ? assets[id].kind : undefined;
    const referenced = new Set();
    const refAsset = (id, wantKind, path) => {
      if (!(typeof id === 'string' && ID_PATTERNS.asset.test(id))) { err(path, 'must be an asset ID (sha256:<64 hex>)'); return null; }
      referenced.add(id);
      if (!assets || !own(assets, id)) { err(path, 'refers to a missing asset'); return null; }
      if (assetKind(id) !== wantKind) { err(path, 'must refer to a ' + wantKind + ' asset'); return null; }
      return assets[id];
    };

    // Threads
    const threadIds = new Set();
    if (!Array.isArray(doc.threads)) err('threads', 'must be an array');
    else {
      doc.threads.forEach((t, i) => {
        const p = 'threads[' + i + ']';
        if (!isObj(t)) { err(p, 'must be an object'); return; }
        checkKeys(t, p, ['id', 'label', 'color'], [], err);
        if (!(typeof t.id === 'string' && ID_PATTERNS.thread.test(t.id))) err(p + '.id', 'must be a thread ID (th_<uuid v4>)');
        else if (threadIds.has(t.id)) err(p + '.id', 'is a duplicate thread ID');
        else threadIds.add(t.id);
        if (!isStr(t.label, 1, 40)) err(p + '.label', 'must be a string of 1–40 characters');
        if (!COLOR_TOKENS.includes(t.color)) err(p + '.color', 'must be a canonical colour token (track-1…track-4)');
      });
    }

    // Scenes
    const scenes = isObj(doc.scenes) ? doc.scenes : null;
    if (!scenes) err('scenes', 'must be an object keyed by Scene ID');
    else {
      for (const [key, s] of Object.entries(scenes)) {
        validateScene(key, s, 'scenes["' + key + '"]', err, threadIds, refAsset);
      }
    }

    // Order
    const order = Array.isArray(doc.order) ? doc.order : null;
    if (!order) err('order', 'must be an array of Scene IDs');
    else {
      const seen = new Set();
      order.forEach((id, i) => {
        if (typeof id !== 'string') { err('order[' + i + ']', 'must be a Scene ID'); return; }
        if (seen.has(id)) err('order[' + i + ']', 'lists a Scene twice');
        seen.add(id);
        if (!scenes || !own(scenes, id)) err('order[' + i + ']', 'refers to a missing Scene');
      });
      if (scenes) for (const id of Object.keys(scenes)) if (!seen.has(id)) err('scenes["' + id + '"]', 'is not listed in order');
    }

    // Edges
    if (!Array.isArray(doc.edges)) err('edges', 'must be an array');
    else {
      const edgeIds = new Set();
      const pairs = new Map();
      doc.edges.forEach((e, i) => {
        const p = 'edges[' + i + ']';
        if (!isObj(e)) { err(p, 'must be an object'); return; }
        checkKeys(e, p, ['id', 'from', 'to', 'overlapBeats', 'curve', 'mode'], [], err);
        if (!(typeof e.id === 'string' && ID_PATTERNS.edge.test(e.id))) err(p + '.id', 'must be an edge ID (ed_<uuid v4>)');
        else if (edgeIds.has(e.id)) err(p + '.id', 'is a duplicate edge ID');
        else edgeIds.add(e.id);
        if (!inRange(e.overlapBeats, LIMITS.overlapBeats)) err(p + '.overlapBeats', 'must be a number ≥ 0');
        if (!CURVES.includes(e.curve)) err(p + '.curve', 'must be lin, ease or late');
        if (!MODES.includes(e.mode)) err(p + '.mode', 'must be jump, morph or fade');
        if (order) {
          const at = order.indexOf(e.from);
          if (at < 0 || order[at + 1] !== e.to) err(p, 'does not join two adjacent Scenes in order');
          else {
            const key = e.from + '>' + e.to;
            if (pairs.has(key)) err(p, 'duplicates the edge for this pair');
            pairs.set(key, true);
          }
        }
      });
      if (order) {
        for (let i = 0; i + 1 < order.length; i++) {
          if (!pairs.has(order[i] + '>' + order[i + 1])) err('edges', 'missing the edge from order[' + i + '] to order[' + (i + 1) + ']');
        }
      }
    }

    if (assets) for (const id of Object.keys(assets)) if (!referenced.has(id)) err('assets["' + id + '"]', 'is not referenced by any Scene');
  }

  function validateAsset(a, p, err) {
    if (!isObj(a)) { err(p, 'must be an object'); return; }
    const isBundle = a.kind === 'node-bundle';
    checkKeys(a, p, ['kind', 'name', 'mime', 'bytes', 'origin', 'storage'].concat(isBundle ? ['manifestId', 'version'] : []), [], err);
    if (!own(ASSET_ORIGINS, a.kind)) err(p + '.kind', 'must be audio or node-bundle');
    else if (!ASSET_ORIGINS[a.kind].includes(a.origin)) err(p + '.origin', 'must be one of ' + ASSET_ORIGINS[a.kind].join(', '));
    if (!isStr(a.name, 1, 200)) err(p + '.name', 'must be a string of 1–200 characters');
    if (!isStr(a.mime, 1, 100)) err(p + '.mime', 'must be a non-empty string');
    if (!(isInt(a.bytes) && a.bytes >= 0)) err(p + '.bytes', 'must be a non-negative integer');
    if (isBundle) {
      if (!isStr(a.manifestId, 1, 200)) err(p + '.manifestId', 'must be a non-empty string');
      if (!isStr(a.version, 1, 50)) err(p + '.version', 'must be a non-empty string');
    }
    if (!isObj(a.storage)) err(p + '.storage', 'must be an object');
    else {
      checkKeys(a.storage, p + '.storage', ['kind', 'data'], [], err);
      if (a.storage.kind !== 'inline-base64') err(p + '.storage.kind', 'must be inline-base64 in schema v1');
      // Payload content (base64, length, hash) is verified in S2, not here.
      if (typeof a.storage.data !== 'string') err(p + '.storage.data', 'must be a string');
    }
  }

  function validateScene(key, s, p, err, threadIds, refAsset) {
    if (!isObj(s)) { err(p, 'must be an object'); return; }
    checkKeys(s, p, ['id', 'name', 'duration', 'createdAt', 'modifiedAt', 'provenance', 'completeness', 'threadStates'], [], err);
    if (!ID_PATTERNS.scene.test(key)) err(p, 'key must be a Scene ID (sc_<uuid v4>)');
    if (s.id !== key) err(p + '.id', 'must equal its key');
    if (!isStr(s.name, 1, 80)) err(p + '.name', 'must be a string of 1–80 characters');
    if (!isIso(s.createdAt)) err(p + '.createdAt', 'must be an ISO-8601 UTC time');
    if (!isIso(s.modifiedAt)) err(p + '.modifiedAt', 'must be an ISO-8601 UTC time');
    validateDuration(s.duration, p + '.duration', err);

    const pv = s.provenance;
    if (!isObj(pv)) err(p + '.provenance', 'must be an object');
    else {
      checkKeys(pv, p + '.provenance', ['kind', 'capturedAt'], ['fileName'], err);
      if (!['capture', 'import-aether'].includes(pv.kind)) err(p + '.provenance.kind', 'must be capture or import-aether');
      if (!isIso(pv.capturedAt)) err(p + '.provenance.capturedAt', 'must be an ISO-8601 UTC time');
      if (own(pv, 'fileName') && !(isStr(pv.fileName, 1, 255) && !/[\\/]/.test(pv.fileName))) err(p + '.provenance.fileName', 'must be a file name without a path');
    }

    const cp = s.completeness;
    if (!isObj(cp)) err(p + '.completeness', 'must be an object');
    else {
      checkKeys(cp, p + '.completeness', ['status', 'reasons'], [], err);
      if (!['complete', 'incomplete'].includes(cp.status)) err(p + '.completeness.status', 'must be complete or incomplete');
      if (!(Array.isArray(cp.reasons) && cp.reasons.every(r => isStr(r, 1, 200)))) err(p + '.completeness.reasons', 'must be an array of strings');
    }

    if (!isObj(s.threadStates)) { err(p + '.threadStates', 'must be an object keyed by thread ID'); return; }
    const slots = new Set();
    for (const [tid, ts] of Object.entries(s.threadStates)) {
      const tp = p + '.threadStates["' + tid + '"]';
      if (!threadIds.has(tid)) err(tp, 'refers to an unknown thread');
      validateThreadState(ts, tp, err, refAsset, slots);
    }
  }

  function validateDuration(d, p, err) {
    if (!isObj(d)) { err(p, 'must be an object'); return; }
    if (RESERVED_DURATION_MODES.includes(d.mode)) { err(p + '.mode', '"' + d.mode + '" is reserved and unsupported in schema v1'); return; }
    if (d.mode !== 'beats') { err(p + '.mode', 'must be "beats" in schema v1'); return; }
    checkKeys(d, p, ['mode', 'beats'], [], err);
    if (!inRange(d.beats, LIMITS.durationBeats)) err(p + '.beats', 'must be a number of at least 0.25');
  }

  function validateThreadState(ts, p, err, refAsset, slots) {
    if (!isObj(ts)) { err(p, 'must be an object'); return; }
    checkKeys(ts, p, ['source', 'channel', 'spatial', 'motion', 'unsupported'], ['slot'], err);
    if (own(ts, 'slot')) {
      if (!(isInt(ts.slot) && ts.slot >= 0 && ts.slot <= 3)) err(p + '.slot', 'must be an integer from 0 to 3');
      else if (slots.has(ts.slot)) err(p + '.slot', 'is already used by another thread in this Scene');
      else slots.add(ts.slot);
    }
    validateSource(ts.source, p + '.source', err, refAsset);

    const c = ts.channel;
    if (!isObj(c)) err(p + '.channel', 'must be an object');
    else {
      checkKeys(c, p + '.channel', ['gainDb', 'eq', 'mute', 'solo'], [], err);
      if (!inRange(c.gainDb, LIMITS.gainDb)) err(p + '.channel.gainDb', 'must be from -24 to 6');
      if (!isObj(c.eq)) err(p + '.channel.eq', 'must be an object');
      else {
        checkKeys(c.eq, p + '.channel.eq', ['low', 'mid', 'high'], [], err);
        for (const k of ['low', 'mid', 'high']) if (own(c.eq, k) && !inRange(c.eq[k], LIMITS.eq)) err(p + '.channel.eq.' + k, 'must be from -15 to 15');
      }
      if (typeof c.mute !== 'boolean') err(p + '.channel.mute', 'must be true or false');
      if (typeof c.solo !== 'boolean') err(p + '.channel.solo', 'must be true or false');
    }

    const sp = ts.spatial;
    if (!isObj(sp)) err(p + '.spatial', 'must be an object');
    else {
      checkKeys(sp, p + '.spatial', ['x', 'y'], ['z'], err);
      if (!inRange(sp.x, LIMITS.x)) err(p + '.spatial.x', 'must be from 0 to 1');
      if (!inRange(sp.y, LIMITS.y)) err(p + '.spatial.y', 'must be from 0 to 1');
      if (own(sp, 'z') && !inRange(sp.z, LIMITS.z)) err(p + '.spatial.z', 'must be from 0 to 50');
    }

    if (ts.motion !== null) validateMotion(ts.motion, p + '.motion', err);

    if (!Array.isArray(ts.unsupported)) err(p + '.unsupported', 'must be an array');
    else {
      const seen = new Set();
      ts.unsupported.forEach((code, i) => {
        if (!UNSUPPORTED_CODES.includes(code)) err(p + '.unsupported[' + i + ']', 'is not a known code');
        else if (seen.has(code)) err(p + '.unsupported[' + i + ']', 'is listed twice');
        seen.add(code);
      });
    }
  }

  function validateSource(src, p, err, refAsset) {
    if (!isObj(src)) { err(p, 'must be an object'); return; }
    if (!own(SOURCE_KINDS, src.kind)) { err(p + '.kind', 'must be one of ' + Object.keys(SOURCE_KINDS).join(', ')); return; }
    const member = SOURCE_KINDS[src.kind];
    const optional = src.kind === 'playlist' ? ['override'] : [];
    checkKeys(src, p, ['kind'].concat(member ? [member] : []), optional, err);
    if (own(src, 'override') && src.kind !== 'playlist') err(p + '.override', 'is only allowed on playlist sources');

    if (src.kind === 'sample') {
      if (!isObj(src.sample)) err(p + '.sample', 'must be an object');
      else { checkKeys(src.sample, p + '.sample', ['assetId'], [], err); refAsset(src.sample.assetId, 'audio', p + '.sample.assetId'); }
    } else if (src.kind === 'playlist') {
      const pl = src.playlist;
      if (!isObj(pl)) err(p + '.playlist', 'must be an object');
      else {
        checkKeys(pl, p + '.playlist', ['items', 'index', 'shuffle', 'repeat'], [], err);
        if (!(Array.isArray(pl.items) && pl.items.length >= 1)) err(p + '.playlist.items', 'must be a non-empty array of audio asset IDs');
        else pl.items.forEach((id, i) => refAsset(id, 'audio', p + '.playlist.items[' + i + ']'));
        if (!(isInt(pl.index) && Array.isArray(pl.items) && pl.index >= 0 && pl.index < pl.items.length)) err(p + '.playlist.index', 'must select an existing item');
        if (typeof pl.shuffle !== 'boolean') err(p + '.playlist.shuffle', 'must be true or false');
        if (typeof pl.repeat !== 'boolean') err(p + '.playlist.repeat', 'must be true or false');
      }
      if (own(src, 'override')) {
        const o = src.override;
        if (!isObj(o)) err(p + '.override', 'must be an object');
        else {
          checkKeys(o, p + '.override', ['assetId', 'reason'], [], err);
          refAsset(o.assetId, 'audio', p + '.override.assetId');
          if (o.reason !== 'derived-buffer') err(p + '.override.reason', 'must be "derived-buffer"');
        }
      }
    } else if (src.kind === 'node') {
      const n = src.node;
      if (!isObj(n)) err(p + '.node', 'must be an object');
      else {
        checkKeys(n, p + '.node', ['bundleAssetId', 'manifestId', 'version', 'params'], ['tapeAssetId'], err);
        const bundle = refAsset(n.bundleAssetId, 'node-bundle', p + '.node.bundleAssetId');
        if (!isStr(n.manifestId, 1, 200)) err(p + '.node.manifestId', 'must be a non-empty string');
        if (!isStr(n.version, 1, 50)) err(p + '.node.version', 'must be a non-empty string');
        if (bundle && (bundle.manifestId !== n.manifestId || bundle.version !== n.version)) err(p + '.node', 'manifestId/version do not match the bundle asset');
        if (own(n, 'tapeAssetId')) refAsset(n.tapeAssetId, 'audio', p + '.node.tapeAssetId');
        if (!isObj(n.params)) err(p + '.node.params', 'must be an object');
        else for (const [k, v] of Object.entries(n.params)) {
          if (!k.length) err(p + '.node.params', 'has an empty parameter ID');
          if (!(typeof v === 'boolean' || isNum(v))) err(p + '.node.params.' + k, 'must be a finite number or true/false');
        }
      }
    } else if (src.kind === 'live-input') {
      if (!isObj(src.external)) err(p + '.external', 'must be an object');
      else checkKeys(src.external, p + '.external', [], [], err);
    } else if (src.kind === 'stream') {
      if (!isObj(src.external)) err(p + '.external', 'must be an object');
      else {
        checkKeys(src.external, p + '.external', ['streamUrl'], [], err);
        if (!isStr(src.external.streamUrl, 1, 2048)) err(p + '.external.streamUrl', 'must be a non-empty string');
      }
    }
  }

  function validateMotion(m, p, err) {
    if (!isObj(m)) { err(p, 'must be null or an object'); return; }
    checkKeys(m, p, ['points', 'timeBase', 'speed', 'playing'], ['captureBpm'], err);
    if (m.timeBase !== 'seconds-free') err(p + '.timeBase', 'must be "seconds-free" in schema v1');
    if (!inRange(m.speed, LIMITS.speed)) err(p + '.speed', 'must be from 0.0001 to 2');
    if (typeof m.playing !== 'boolean') err(p + '.playing', 'must be true or false');
    if (own(m, 'captureBpm') && !inRange(m.captureBpm, LIMITS.captureBpm)) err(p + '.captureBpm', 'must be from 20 to 400');
    if (!(Array.isArray(m.points) && m.points.length >= 2)) { err(p + '.points', 'must be an array of at least 2 points'); return; }
    let lastT = -Infinity;
    m.points.forEach((pt, i) => {
      const pp = p + '.points[' + i + ']';
      if (!isObj(pt)) { err(pp, 'must be an object'); return; }
      checkKeys(pt, pp, ['t', 'x', 'y'], ['z', 'generatedReturn'], err);
      for (const k of ['t', 'x', 'y']) if (!isNum(pt[k])) err(pp + '.' + k, 'must be a finite number');
      if (own(pt, 'z') && !isNum(pt.z)) err(pp + '.z', 'must be a finite number');
      if (own(pt, 'generatedReturn') && typeof pt.generatedReturn !== 'boolean') err(pp + '.generatedReturn', 'must be true or false');
      if (isNum(pt.t)) {
        if (pt.t < 0) err(pp + '.t', 'must not be negative');
        if (pt.t < lastT) err(pp + '.t', 'must not go backwards');
        lastT = pt.t;
      }
    });
  }

  // ---------- compact v0.1 capacity (separate from validity) ----------
  // A structurally valid document can still be unplayable in the compact runtime.
  function checkCompactCapacity(doc) {
    const v = validateDocument(doc);
    if (!v.ok) return { ok: false, problems: [{ code: 'invalid-document', message: 'The document is not structurally valid.' }] };
    const problems = [];
    if (doc.tempo.bpm !== 120 || doc.tempo.beatsPerBar !== 4) {
      problems.push({ code: 'tempo-not-playable', message: 'v0.1 plays only 120 BPM in 4/4.' });
    }
    const colorOf = new Map(doc.threads.map(t => [t.id, t.color]));
    for (const sid of doc.order) {
      const states = doc.scenes[sid].threadStates;
      const active = Object.keys(states);
      if (active.length > 4) problems.push({ code: 'too-many-threads', sceneId: sid, message: 'More than four active threads in one Scene.' });
      for (const tid of active) {
        const slot = states[tid].slot;
        if (slot === undefined) { problems.push({ code: 'slot-missing', sceneId: sid, threadId: tid, message: 'Active thread has no slot.' }); continue; }
        if (colorOf.get(tid) !== 'track-' + (slot + 1)) problems.push({ code: 'colour-slot-mismatch', sceneId: sid, threadId: tid, message: 'Thread colour does not match its slot.' });
      }
    }
    return { ok: problems.length === 0, problems };
  }

  // ---------- document creation and commands (pure; never mutate input) ----------
  function createWeave(opts) {
    opts = opts || {};
    const t = nowIso(opts);
    return {
      type: DOC_TYPE,
      schemaVersion: SCHEMA_VERSION,
      id: newId('wv', opts),
      name: typeof opts.name === 'string' && opts.name.length ? opts.name.slice(0, 120) : 'Untitled Weave',
      createdAt: t,
      modifiedAt: t,
      writer: { app: DEFAULT_WRITER.app, version: DEFAULT_WRITER.version },
      tempo: { bpm: 120, beatsPerBar: 4, source: 'host-fixed' },
      master: { volume: isNum(opts.masterVolume) ? opts.masterVolume : 0.8, loudnessDb: 0 },
      assets: {},
      threads: [1, 2, 3, 4].map(k => ({ id: newId('th', opts), label: 'T' + k, color: 'track-' + k })),
      scenes: {},
      order: [],
      edges: [],
      ending: null
    };
  }

  // Rebuild edges from order: keep the edge (ID and values) for every pair that is
  // still adjacent, add a default edge for a new pair, drop the rest.
  function syncEdges(doc, opts) {
    const d = clone(doc);
    if (!isObj(d) || !Array.isArray(d.order)) return d;   // nothing to derive from; validator reports it
    const defaults = Object.assign({}, DEFAULT_EDGE, opts && opts.edgeDefaults);
    const byPair = new Map((Array.isArray(d.edges) ? d.edges : []).filter(isObj).map(e => [e.from + '>' + e.to, e]));
    const edges = [];
    for (let i = 0; i + 1 < d.order.length; i++) {
      const key = d.order[i] + '>' + d.order[i + 1];
      edges.push(byPair.get(key) || {
        id: newId('ed', opts), from: d.order[i], to: d.order[i + 1],
        overlapBeats: defaults.overlapBeats, curve: defaults.curve, mode: defaults.mode
      });
    }
    d.edges = edges;
    return d;
  }

  function pruneUnreferencedAssets(d) {
    const used = new Set();
    for (const s of Object.values(d.scenes)) for (const ts of Object.values(s.threadStates)) {
      const src = ts.source;
      if (src.kind === 'sample') used.add(src.sample.assetId);
      if (src.kind === 'playlist') { src.playlist.items.forEach(a => used.add(a)); if (src.override) used.add(src.override.assetId); }
      if (src.kind === 'node') { used.add(src.node.bundleAssetId); if (src.node.tapeAssetId) used.add(src.node.tapeAssetId); }
    }
    const removed = [];
    for (const id of Object.keys(d.assets)) if (!used.has(id)) { delete d.assets[id]; removed.push(id); }
    return removed;
  }

  // Run a command on a clone. Refuses an invalid input and never returns an invalid result.
  function command(doc, fn) {
    try {
      const before = validateDocument(doc);
      if (!before.ok) return { ok: false, error: 'The input document is not valid.', errors: before.errors };
      const d = clone(doc);
      const extra = fn(d);
      if (extra && extra.refused) return { ok: false, error: extra.refused };
      const after = validateDocument(d);
      if (!after.ok) return { ok: false, error: 'The change would make the document invalid.', errors: after.errors };
      return Object.assign({ ok: true, doc: d }, extra || {});
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  // input: { name, duration?, threadStates, provenance?, completeness? }
  // opts: { index?, assets?, now?, uuid?, edgeDefaults? }. Assets carry caller-supplied IDs (no hashing here).
  function addScene(doc, input, opts) {
    opts = opts || {};
    return command(doc, (d) => {
      if (!isObj(input)) return { refused: 'Scene input must be an object.' };
      if (!isObj(input.threadStates)) return { refused: 'Scene input needs a threadStates object.' };
      if (opts.assets !== undefined && !isObj(opts.assets)) return { refused: 'assets must be an object.' };
      for (const [id, a] of Object.entries(opts.assets || {})) {
        if (own(d.assets, id) && JSON.stringify(d.assets[id]) !== JSON.stringify(a)) return { refused: 'Asset ' + id + ' already exists with different content.' };
        d.assets[id] = clone(a);
      }
      const t = nowIso(opts);
      const id = newId('sc', opts);
      d.scenes[id] = {
        id,
        name: input.name,
        duration: input.duration !== undefined ? clone(input.duration) : { mode: 'beats', beats: 64 },
        createdAt: t,
        modifiedAt: t,
        provenance: input.provenance !== undefined ? clone(input.provenance) : { kind: 'capture', capturedAt: t },
        completeness: input.completeness !== undefined ? clone(input.completeness) : { status: 'complete', reasons: [] },
        threadStates: clone(input.threadStates)
      };
      const index = opts.index === undefined ? d.order.length : opts.index;
      if (!(isInt(index) && index >= 0 && index <= d.order.length)) return { refused: 'index is out of range.' };
      d.order.splice(index, 0, id);
      Object.assign(d, syncEdges(d, opts));
      d.modifiedAt = t;
      return { id };
    });
  }

  function renameScene(doc, id, name, opts) {
    return command(doc, (d) => {
      if (!isObj(d.scenes) || !own(d.scenes, id)) return { refused: 'No Scene with that ID.' };
      const t = nowIso(opts);
      d.scenes[id].name = name;
      d.scenes[id].modifiedAt = t;
      d.modifiedAt = t;
    });
  }

  function setDuration(doc, id, duration, opts) {
    return command(doc, (d) => {
      if (!own(d.scenes, id)) return { refused: 'No Scene with that ID.' };
      if (!isObj(duration)) return { refused: 'Duration must be an object.' };
      if (RESERVED_DURATION_MODES.includes(duration.mode)) return { refused: 'Duration mode "' + duration.mode + '" is reserved and unsupported in schema v1.' };
      const t = nowIso(opts);
      d.scenes[id].duration = clone(duration);
      d.scenes[id].modifiedAt = t;
      d.modifiedAt = t;
    });
  }

  // Copy placed directly after the original: new Scene ID; thread and asset references unchanged.
  function duplicateScene(doc, id, opts) {
    opts = opts || {};
    return command(doc, (d) => {
      if (!own(d.scenes, id)) return { refused: 'No Scene with that ID.' };
      const t = nowIso(opts);
      const newSceneId = newId('sc', opts);
      const copy = clone(d.scenes[id]);
      copy.id = newSceneId;
      copy.name = typeof opts.name === 'string' ? opts.name : (copy.name + ' copy').slice(0, 80);
      copy.createdAt = t;
      copy.modifiedAt = t;
      d.scenes[newSceneId] = copy;
      d.order.splice(d.order.indexOf(id) + 1, 0, newSceneId);
      Object.assign(d, syncEdges(d, opts));
      d.modifiedAt = t;
      return { id: newSceneId };
    });
  }

  function moveScene(doc, id, toIndex, opts) {
    return command(doc, (d) => {
      const from = d.order.indexOf(id);
      if (from < 0) return { refused: 'No Scene with that ID.' };
      if (!(isInt(toIndex) && toIndex >= 0 && toIndex < d.order.length)) return { refused: 'toIndex is out of range.' };
      d.order.splice(from, 1);
      d.order.splice(toIndex, 0, id);
      Object.assign(d, syncEdges(d, opts));
      d.modifiedAt = nowIso(opts);
    });
  }

  // opts.protectedId: e.g. the playing Scene, which must not be deleted.
  function deleteScene(doc, id, opts) {
    opts = opts || {};
    return command(doc, (d) => {
      if (!own(d.scenes, id)) return { refused: 'No Scene with that ID.' };
      if (d.order.length <= 1) return { refused: 'Cannot delete the only Scene.' };
      if (opts.protectedId !== undefined && opts.protectedId === id) return { refused: 'Cannot delete the protected (playing) Scene.' };
      delete d.scenes[id];
      d.order = d.order.filter(x => x !== id);
      Object.assign(d, syncEdges(d, opts));
      const removedAssets = pruneUnreferencedAssets(d);
      d.modifiedAt = nowIso(opts);
      return { removedAssets };
    });
  }

  // ---------- migration from a parsed .aether v3.1 state ----------
  // ctx: {
  //   threadIds: [th…] indexed by track index (caller-supplied, required; valid and distinct per migrated track),
  //   assetIds:  { [trackIndex]: { playlist?: [id…], sample?: id, override?: id, bundle?: id, tape?: id,
  //                                sampleEqualsSelectedItem?: true } },   // a saved playlist buffer needs exactly one of
  //                                                                       // a valid override ID or this explicit proof
  //   name?, durationBeats?, fileName?, captureBpm?, manifestId?, manifestVersion?, now?
  // }
  // Returns { ok, scene?, error? }. The scene is not inserted; pass it to addScene with the caller's assets.
  // No hashing or I/O: the caller decides asset identity and equality.
  function sceneFromAetherState(session, ctx) {
    try {
      if (!isObj(session) || (session.type !== undefined && session.type !== 'aether_project')) return { ok: false, error: 'Not an Aether state object.' };
      if (!Array.isArray(session.tracks) || session.tracks.length < 1 || session.tracks.length > 4) return { ok: false, error: 'tracks must be an array of 1–4 tracks.' };
      if (!isObj(ctx) || !Array.isArray(ctx.threadIds)) return { ok: false, error: 'ctx.threadIds is required.' };
      const assetIds = isObj(ctx.assetIds) ? ctx.assetIds : {};
      const threadStates = {};
      const seen = new Set();
      const usedThreadIds = new Set();
      for (const tr of session.tracks) {
        if (!isObj(tr)) return { ok: false, error: 'Each track must be an object.' };
        const idx = tr.index === undefined ? 0 : tr.index;
        if (!(isInt(idx) && idx >= 0 && idx <= 3) || seen.has(idx)) return { ok: false, error: 'Invalid or duplicate track index.' };
        seen.add(idx);
        const tid = ctx.threadIds[idx];
        if (!(typeof tid === 'string' && ID_PATTERNS.thread.test(tid))) return { ok: false, error: 'Track ' + (idx + 1) + ': caller must supply a valid thread ID (th_<uuid v4>).' };
        if (usedThreadIds.has(tid)) return { ok: false, error: 'Track ' + (idx + 1) + ': thread ID is already used by another migrated track.' };
        usedThreadIds.add(tid);
        const ids = isObj(assetIds[idx]) ? assetIds[idx] : {};
        // Override syntax is checked whenever it is supplied (hashing stays in S2).
        const hasOverride = ids.override !== undefined;
        if (hasOverride && !(typeof ids.override === 'string' && ID_PATTERNS.asset.test(ids.override))) {
          return { ok: false, error: 'Track ' + (idx + 1) + ': override must be an asset ID (sha256:<64 lowercase hex>).' };
        }
        const unsupported = [];
        const need = (v, what) => { if (typeof v !== 'string') throw new Error('Track ' + (idx + 1) + ': caller must supply the ' + what + ' asset ID.'); return v; };

        let source;
        const playlist = Array.isArray(tr.playlist) ? tr.playlist : [];
        const isNode = !!(tr.isCustomNode || tr.customNodeBundle || tr.customNodeZipBase64);
        if (isNode) {
          const manifest = isObj(tr.customNodeBundle) && isObj(tr.customNodeBundle.manifest) ? tr.customNodeBundle.manifest : {};
          const node = {
            bundleAssetId: need(ids.bundle, 'bundle'),
            manifestId: typeof ctx.manifestId === 'string' ? ctx.manifestId : manifest.id,
            version: typeof ctx.manifestVersion === 'string' ? ctx.manifestVersion : manifest.version,
            params: isObj(tr.customNodeParams) ? clone(tr.customNodeParams) : {}
          };
          if (tr.sampleData) node.tapeAssetId = need(ids.tape, 'tape');
          source = { kind: 'node', node };
          unsupported.push('node-private-state');
        } else if (tr.isLiveIn) {
          source = { kind: 'live-input', external: {} };
          unsupported.push('live-input-not-stored');
        } else if (tr.isStream) {
          source = { kind: 'stream', external: { streamUrl: tr.streamUrl } };
          unsupported.push('stream-external');
        } else if (playlist.length) {
          const items = Array.isArray(ids.playlist) ? ids.playlist.slice() : null;
          if (!items || items.length !== playlist.length) throw new Error('Track ' + (idx + 1) + ': caller must supply one asset ID per playlist item.');
          source = { kind: 'playlist', playlist: { items, index: tr.playlistIndex || 0, shuffle: !!tr.isShuffle, repeat: tr.isRepeat !== false } };
          // A saved buffer may differ from the original file. The caller decides byte equality:
          // exactly one of a valid override asset ID or sampleEqualsSelectedItem === true.
          const provedEqual = ids.sampleEqualsSelectedItem === true;
          if (tr.sampleData) {
            if (hasOverride && provedEqual) throw new Error('Track ' + (idx + 1) + ': supply either an override asset ID or sampleEqualsSelectedItem, not both.');
            if (hasOverride) source.override = { assetId: ids.override, reason: 'derived-buffer' };
            else if (!provedEqual) throw new Error('Track ' + (idx + 1) + ': saved buffer needs an override asset ID unless the caller proves it equals the selected item (sampleEqualsSelectedItem: true).');
          }
        } else if (tr.sampleData) {
          source = { kind: 'sample', sample: { assetId: need(ids.sample, 'sample') } };
        } else {
          source = { kind: 'empty' };
        }

        if (hasOverride && !source.override) throw new Error('Track ' + (idx + 1) + ': override supplied, but the track has no saved playlist buffer to keep.');

        const eq = isObj(tr.eq) ? tr.eq : {};
        const state = {
          slot: idx,
          source,
          channel: {
            gainDb: tr.stripGainDb === undefined ? 0 : tr.stripGainDb,
            eq: { low: eq.low === undefined ? 0 : eq.low, mid: eq.mid === undefined ? 0 : eq.mid, high: eq.high === undefined ? 0 : eq.high },
            mute: !!tr.isMuted,
            solo: !!tr.isSoloed
          },
          spatial: { x: tr.x === undefined ? 0.5 : tr.x, y: tr.y === undefined ? 0.5 : tr.y },
          motion: null,
          unsupported
        };
        if (tr.z !== undefined) state.spatial.z = tr.z;   // keep absence exactly
        if (Array.isArray(tr.motionPath) && tr.motionPath.length > 1) {
          state.motion = { points: clone(tr.motionPath), timeBase: 'seconds-free', speed: tr.motionSpeed === undefined ? 1 : tr.motionSpeed, playing: true };
          if (isNum(ctx.captureBpm)) state.motion.captureBpm = ctx.captureBpm;
          unsupported.push('motion-free-time');
        }
        threadStates[tid] = state;
      }
      const t = nowIso(ctx);
      const provenance = { kind: 'import-aether', capturedAt: t };
      if (typeof ctx.fileName === 'string' && ctx.fileName.length) provenance.fileName = ctx.fileName;
      return {
        ok: true,
        scene: {
          name: typeof ctx.name === 'string' && ctx.name.length ? ctx.name : (typeof session.name === 'string' && session.name.length ? session.name.slice(0, 80) : 'Imported state'),
          duration: { mode: 'beats', beats: isNum(ctx.durationBeats) ? ctx.durationBeats : 64 },
          provenance,
          completeness: { status: 'complete', reasons: [] },
          threadStates
        }
      };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  }

  // ---------- view derivation for the existing Loom / mini-map ----------
  // Same formulas as WeaveEngine.onNodeDragEnd (weave.js): level = y, position = [(x-0.5)*2, (y-0.5)*2].
  // A slot with no active thread gets level 0 (no ribbon) and position null.
  function deriveView(scene, threads) {
    const levels = [0, 0, 0, 0];
    const positions = [null, null, null, null];
    if (!isObj(scene) || !isObj(scene.threadStates)) return { levels, positions };
    const colorSlot = new Map((Array.isArray(threads) ? threads : []).filter(isObj)
      .map(t => [t.id, COLOR_TOKENS.indexOf(t.color)]));
    for (const [tid, ts] of Object.entries(scene.threadStates)) {
      if (!isObj(ts) || !isObj(ts.spatial)) continue;
      const slot = isInt(ts.slot) ? ts.slot : colorSlot.get(tid);
      if (!(isInt(slot) && slot >= 0 && slot <= 3)) continue;
      const { x, y } = ts.spatial;
      if (!isNum(x) || !isNum(y)) continue;
      levels[slot] = y;
      positions[slot] = [(x - 0.5) * 2.0, (y - 0.5) * 2.0];
    }
    return { levels, positions };
  }

  return Object.freeze({
    SCHEMA_VERSION, DOC_TYPE, ID_PATTERNS, LIMITS, DEFAULT_EDGE, UNSUPPORTED_CODES, RESERVED_DURATION_MODES,
    newId, createWeave, validateDocument, checkCompactCapacity, syncEdges,
    addScene, renameScene, setDuration, duplicateScene, moveScene, deleteScene,
    sceneFromAetherState, deriveView
  });
});
