/**
 * Weave v0.1 Phase 1 S3 — legacy .aether import tests.
 * Run: node tests/test-weave-import.js
 * Pure/mocked only: no DOM, audio, Tauri, native app or browser. Hashing runs through Node's
 * WebCrypto (crypto.subtle) by way of S2. These tests prove DATA migration; they do not prove
 * the native "old .aether loads" acceptance.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const I = require(path.join(__dirname, '..', 'desktop', 'weave-import.js'));
const M = require(path.join(__dirname, '..', 'desktop', 'weave-model.js'));
const A = require(path.join(__dirname, '..', 'desktop', 'weave-assets.js'));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weave-v1-two-scenes.json'), 'utf8'));
const SESSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'aether-v31-tiny.json'), 'utf8'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (o) => { if (o && typeof o === 'object' && !ArrayBuffer.isView(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const sha = (b) => 'sha256:' + nodeCrypto.createHash('sha256').update(b).digest('hex');
const b64 = (s) => Buffer.from(s, 'base64');
const toB64 = (buf) => Buffer.from(buf).toString('base64');

const FX = Object.keys(FIXTURE.assets);
const A440 = FIXTURE.assets[FX[0]].storage.data, A660 = FIXTURE.assets[FX[1]].storage.data, ZIP = FIXTURE.assets[FX[2]].storage.data;
const ID_A440 = FX[0], ID_A660 = FX[1], ID_ZIP = FX[2];
assert.strictEqual(sha(b64(A440)), ID_A440); assert.strictEqual(sha(b64(A660)), ID_A660); assert.strictEqual(sha(b64(ZIP)), ID_ZIP);

// Count calls into crypto.subtle.digest so tests can prove whether hashing happened (test evidence only;
// the production report carries no digest counter).
let digestCalls = 0;
const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = function (alg, data) { digestCalls++; return realDigest(alg, data); };

// Deterministic IDs and times, exactly as S1's tests inject them.
function det() { let n = 0; return { uuid: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'), now: () => '2026-10-05T12:00:00.000Z' }; }
function weave(d) { d = d || det(); return { d, doc: M.createWeave({ uuid: d.uuid, now: d.now, name: 'Import target' }) }; }
function baseTrack(index, extra) {
  return Object.assign({ index, name: 'T' + (index + 1), sampleName: 'T' + (index + 1), filePath: '', sampleData: null, playlist: [], playlistIndex: 0,
    isShuffle: false, isRepeat: true, isCustomNode: false, customNodeBundle: null, customNodeParams: null, customNodeZipBase64: null,
    isLiveIn: false, x: 0.5, y: 0.5, z: 0, isMuted: false, isSoloed: false, motionSpeed: 1, motionPath: [], eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0, isStream: false, streamUrl: '' }, extra);
}
function session(tracks) { return { version: '3.1', type: 'aether_project', name: 'Synthetic', masterVolume: 0.8, loudnessDb: 0, tracks }; }
const BUNDLE = () => ({ file_path: '/Users/matt/secret/pulse.aethernode', file_name: 'pulse.aethernode', manifest_raw: '{"id":"com.aether.test.fixture-pulse","version":"0.0.1"}', manifest: { id: 'com.aether.test.fixture-pulse', version: '0.0.1', name: 'Fixture Pulse' }, dsp_js: 'class P extends AudioWorkletProcessor {}\nregisterProcessor("p", P);\n' });
const PATH_MARKERS = ['/Users/', '/dev/', 'secret', '.aethernode'];
function noPathIn(obj, allowed) {
  const text = JSON.stringify(obj);
  for (const m of PATH_MARKERS) if (!(allowed || []).includes(m)) assert.strictEqual(text.includes(m), false, 'path marker "' + m + '" leaked into the result');
}
function fails(r, code, track) {
  assert.strictEqual(r.ok, false, 'expected failure, got ' + JSON.stringify(r).slice(0, 200));
  assert.strictEqual(r.code, code, 'code: ' + r.error);
  assert.strictEqual(typeof r.error, 'string');
  if (track !== undefined) assert.strictEqual(r.track, track, 'track');
  assert.strictEqual('doc' in r, false, 'failure carries no doc');
  if ('assets' in r) assert.strictEqual(r.assets, null);
  if ('perTrack' in r) assert.strictEqual(r.perTrack, null);
}
// Independent oracle: build the expected document with S1 primitives and Node crypto only (no S3 code).
function expectedDocument(sess, d) {
  const w = M.createWeave({ uuid: d.uuid, now: d.now, name: 'Import target' });
  const enc = (data, meta) => Object.assign({}, meta, { bytes: b64(data).length, storage: { kind: 'inline-base64', data } });
  const assets = {
    [ID_A440]: enc(A440, { kind: 'audio', name: 'fixture-a440.wav', mime: 'audio/wav', origin: 'original-file' }),
    [ID_A660]: enc(A660, { kind: 'audio', name: 'fixture-a660.wav', mime: 'audio/wav', origin: 'original-file' }),
    [ID_ZIP]: enc(ZIP, { kind: 'node-bundle', name: 'Fixture Pulse', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'com.aether.test.fixture-pulse', version: '0.0.1' })
  };
  const m = M.sceneFromAetherState(sess, { threadIds: w.threads.map(t => t.id), now: d.now, fileName: 'aether-v31-tiny.json',
    assetIds: { 0: { playlist: [ID_A440, ID_A660], sampleEqualsSelectedItem: true }, 1: { bundle: ID_ZIP, tape: ID_A440 } } });
  assert.strictEqual(m.ok, true, m.error);
  const r = M.addScene(w, m.scene, { assets, now: d.now, uuid: d.uuid });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  return { doc: r.doc, sceneId: r.id };
}

// ---------- 1. happy path, deterministic, oracle-checked ----------
test('1. fixture session imports into a valid document equal to the S1-built oracle; master kept and reported', async () => {
  const { d, doc } = weave();
  const frozenDoc = deepFreeze(clone(doc)), frozenSession = deepFreeze(clone(SESSION));
  const r = await I.importAetherState(frozenDoc, frozenSession, { now: d.now, uuid: d.uuid, fileName: 'aether-v31-tiny.json' });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(M.validateDocument(r.doc).ok, true);
  assert.strictEqual(M.checkCompactCapacity(r.doc).ok, true);
  const exp = expectedDocument(clone(SESSION), det());
  assert.deepStrictEqual(r.doc, exp.doc, 'document equals the S1-built oracle');
  assert.strictEqual(r.sceneId, exp.sceneId);
  assert.deepStrictEqual(r.doc.master, doc.master, 'destination master kept');
  assert.deepStrictEqual(r.report.legacyMaster, { masterVolume: 0.7, loudnessDb: -3, imported: false });
  assert.deepStrictEqual(r.report.tracks.map(t => t.sourceKind), ['playlist', 'node', 'live-input', 'empty']);
  assert.deepStrictEqual(r.report.tracks.map(t => t.unsupported), [['motion-free-time'], ['node-private-state'], ['live-input-not-stored'], []]);
  assert.strictEqual(r.report.assetsAdded, 3); assert.strictEqual(r.report.assetsDeduplicated, 2); assert.strictEqual(r.report.bytesAdded, 76 + 76 + 630);
  assert.strictEqual(r.report.existingVerified, false);
  assert.strictEqual(r.report.tracks[1].bundleMetadataVerified, false);
  assert.strictEqual('digestCalls' in r.report, false, 'no production digest counter');
  assert.deepStrictEqual(r.report.completeness, { status: 'complete', reasons: [] });
  // Inputs untouched
  assert.deepStrictEqual(clone(frozenDoc), doc); assert.deepStrictEqual(clone(frozenSession), SESSION);
  // Same inputs again with the same injected clocks → identical output (determinism)
  const w3 = weave();
  const r3 = await I.importAetherState(w3.doc, clone(SESSION), { now: w3.d.now, uuid: w3.d.uuid, fileName: 'aether-v31-tiny.json' });
  assert.deepStrictEqual(r3.doc, exp.doc);
  assert.deepStrictEqual(r3.report, r.report);
});

// ---------- 2. dedupe across tracks ----------
test('2. identical bytes on two tracks become one asset; first writer\'s name kept', async () => {
  const { d, doc } = weave();
  const s = session([baseTrack(0, { playlist: [{ name: 'first.wav', type: 'audio/wav', data: A440 }] }), baseTrack(1, { playlist: [{ name: 'second.wav', type: 'audio/wav', data: A440 }] })]);
  const r = await I.importAetherState(doc, s, { now: d.now, uuid: d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(Object.keys(r.doc.assets), [ID_A440]);
  assert.strictEqual(r.doc.assets[ID_A440].name, 'first.wav');
  assert.deepStrictEqual(r.report.tracks[0].added, [ID_A440]);
  assert.deepStrictEqual(r.report.tracks[1].deduplicated, [{ id: ID_A440, existingName: 'first.wav', field: 'playlist[0]' }]);
  assert.strictEqual(r.report.assetsAdded, 1); assert.strictEqual(r.report.assetsDeduplicated, 1);
});

// ---------- 3. dedupe against an existing table ----------
test('3. importing into a document that already holds the bytes adds nothing', async () => {
  const { d } = weave();
  const doc = clone(FIXTURE);
  const s = session([baseTrack(0, { playlist: [{ name: 'renamed.wav', type: 'audio/wav', data: A440 }] })]);
  const r = await I.importAetherState(doc, s, { now: d.now, uuid: d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.report.bytesAdded, 0); assert.strictEqual(r.report.assetsAdded, 0);
  assert.deepStrictEqual(r.doc.assets, FIXTURE.assets, 'table unchanged, existing metadata kept');
  assert.strictEqual(r.report.existingVerified, false);
  assert.strictEqual(r.doc.order.length, 3);
});

// ---------- 4. override kept ----------
test('4. a saved buffer that differs from the selected item is kept as a rendered-buffer override', async () => {
  const { d, doc } = weave();
  const s = session([baseTrack(0, { sampleName: 'buf.wav', sampleData: A660, playlist: [{ name: 'orig.wav', type: 'audio/wav', data: A440 }], playlistIndex: 0 })]);
  const r = await I.importAetherState(doc, s, { now: d.now, uuid: d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  const ts = Object.values(r.doc.scenes[r.sceneId].threadStates)[0];
  assert.deepStrictEqual(ts.source.override, { assetId: ID_A660, reason: 'derived-buffer' });
  assert.strictEqual(r.doc.assets[ID_A660].origin, 'rendered-buffer');
  assert.strictEqual(r.doc.assets[ID_A440].origin, 'original-file');
  assert.strictEqual(Object.keys(r.doc.assets).length, 2);
});

// ---------- 5. equality by bytes, not by key ----------
test('5. equality: (a) byte-equal buffer → sampleEqualsSelectedItem; (b) same name/different bytes → override; (c) corrupted matching key fails', async () => {
  // (a)
  let w = weave();
  let s = session([baseTrack(0, { sampleName: 'orig.wav', sampleData: A440, playlist: [{ name: 'orig.wav', type: 'audio/wav', data: A440 }] })]);
  let r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  let ts = Object.values(r.doc.scenes[r.sceneId].threadStates)[0];
  assert.strictEqual('override' in ts.source, false);
  assert.deepStrictEqual(Object.keys(r.doc.assets), [ID_A440]);
  assert.strictEqual(r.doc.assets[ID_A440].origin, 'original-file', 'first writer (playlist item) wins');
  // buffer equal to a NON-selected item is still an override (equality is to the selected item only)
  w = weave();
  s = session([baseTrack(0, { sampleData: A660, playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }, { name: 'b.wav', type: 'audio/wav', data: A660 }], playlistIndex: 0 })]);
  r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  ts = Object.values(r.doc.scenes[r.sceneId].threadStates)[0];
  assert.deepStrictEqual(ts.source.override, { assetId: ID_A660, reason: 'derived-buffer' });
  // (b) same name, different bytes
  w = weave();
  s = session([baseTrack(0, { sampleName: 'orig.wav', sampleData: A660, playlist: [{ name: 'orig.wav', type: 'audio/wav', data: A440 }] })]);
  r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  ts = Object.values(r.doc.scenes[r.sceneId].threadStates)[0];
  assert.deepStrictEqual(ts.source.override, { assetId: ID_A660, reason: 'derived-buffer' });
  // (c) existing entry under the right key whose stored payload differs
  const doc = clone(FIXTURE);
  doc.assets[ID_A440].storage.data = A660; // same length, wrong bytes under A440's key
  const frozen = deepFreeze(clone(doc));
  s = session([baseTrack(0, { sampleData: A440, playlist: [{ name: 'orig.wav', type: 'audio/wav', data: A440 }] })]);
  r = await I.importAetherState(frozen, s, { now: w.d.now, uuid: w.d.uuid });
  fails(r, 'hash', 0);
  assert.deepStrictEqual(clone(frozen), doc);
  r = await I.extractAetherAssets(s, frozen.assets);
  fails(r, 'hash', 0);
});

// ---------- 6. node tracks and canonical JSON ----------
test('6. node: zip with metadata; zip without metadata; JSON fallback is canonical and path-free; neither → track', async () => {
  // zip with metadata
  let w = weave();
  let s = session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE(), customNodeParams: { level: 0.5 } })]);
  let r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.doc.assets[ID_ZIP], FIXTURE.assets[ID_ZIP], 'zip stored with the session\'s declared manifest id/version');
  assert.strictEqual(r.report.tracks[0].bundleMetadataVerified, false);
  noPathIn(r);
  // zip without manifest metadata (no bundle at all)
  w = weave();
  s = session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP })]);
  r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  fails(r, 'bundle-metadata', 0);
  // zip with a bundle lacking version
  s = session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: { manifest: { id: 'x' } } })]);
  fails(await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid }), 'bundle-metadata', 0);
  // ctx.manifestId is not an accepted way round it (unknown ctx field)
  fails(await I.importAetherState(w.doc, s, { manifestId: 'x', manifestVersion: '1' }), 'session');
  // JSON fallback
  w = weave();
  const bundle = BUNDLE();
  s = session([baseTrack(0, { isCustomNode: true, customNodeBundle: bundle, customNodeParams: { level: 0.5 } })]);
  r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  const [id] = Object.keys(r.doc.assets);
  const stored = r.doc.assets[id];
  assert.strictEqual(stored.kind, 'node-bundle'); assert.strictEqual(stored.origin, 'unpacked-json'); assert.strictEqual(stored.mime, 'application/json');
  assert.strictEqual(stored.manifestId, 'com.aether.test.fixture-pulse'); assert.strictEqual(stored.version, '0.0.1');
  const expectedObj = { file_name: bundle.file_name, manifest_raw: bundle.manifest_raw, manifest: bundle.manifest, dsp_js: bundle.dsp_js };
  const canon = I.canonicalJsonBytes(expectedObj);
  assert.strictEqual(canon.ok, true);
  assert.deepStrictEqual(b64(stored.storage.data), Buffer.from(canon.bytes), 'stored bytes equal canonicalJsonBytes of the key subset');
  assert.strictEqual(id, sha(Buffer.from(canon.bytes)));
  const text = Buffer.from(b64(stored.storage.data)).toString('utf8');
  const parsed = JSON.parse(text);
  assert.strictEqual('file_path' in parsed, false, 'file_path excluded');
  assert.strictEqual(text.includes('/Users/'), false);
  assert.strictEqual(parsed.dsp_js, bundle.dsp_js, 'DSP text byte-identical');
  assert.strictEqual(parsed.manifest_raw, bundle.manifest_raw, 'manifest text byte-identical');
  noPathIn(r, ['.aethernode']); // the bare file_name is accepted display metadata
  assert.strictEqual(JSON.stringify(r).includes('/Users/'), false);
  // neither zip nor bundle
  w = weave();
  fails(await I.importAetherState(w.doc, session([baseTrack(0, { isCustomNode: true })]), {}), 'track', 0);
  // canonicalJsonBytes unit cases
  const a = I.canonicalJsonBytes({ b: 1, a: [3, { z: null, y: 'ü ' }], c: true });
  const b = I.canonicalJsonBytes({ c: true, a: [3, { y: 'ü ', z: null }], b: 1 });
  assert.strictEqual(a.ok, true); assert.deepStrictEqual(a.bytes, b.bytes, 'key order independent');
  assert.strictEqual(a.text, '{"a":[3,{"y":"ü ","z":null}],"b":1,"c":true}');
  assert.notStrictEqual(JSON.stringify({ b: 1, a: 2 }), I.canonicalJsonBytes({ b: 1, a: 2 }).text, 'JSON.stringify is not canonical');
  assert.deepStrictEqual(I.canonicalJsonBytes([2, 1]).text, '[2,1]', 'arrays keep order');
  assert.strictEqual(Buffer.from(a.bytes).toString('utf8'), a.text, 'UTF-8');
  for (const bad of [{ x: NaN }, { x: Infinity }, { x: undefined }, [undefined], { f() {} }, { x: 1n }, { d: new Date(0) }, new Map()]) {
    const r2 = I.canonicalJsonBytes(bad); assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, 'encoding');
  }
  const cyc = { a: 1 }; cyc.self = cyc;
  assert.strictEqual(I.canonicalJsonBytes(cyc).code, 'encoding');
  // an unencodable bundle surfaces as code encoding at import
  w = weave();
  fails(await I.importAetherState(w.doc, session([baseTrack(0, { isCustomNode: true, customNodeBundle: { manifest: { id: 'x', version: '1', bad: NaN } } })]), {}), 'encoding', 0);
});

// ---------- 7. unsupported disclosure ----------
test('7. live-input, stream, node and motion tracks carry the expected unsupported codes', async () => {
  const w = weave();
  const s = session([
    baseTrack(0, { isLiveIn: true }),
    baseTrack(1, { isStream: true, streamUrl: 'https://example.invalid/stream' }),
    baseTrack(2, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() }),
    baseTrack(3, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }], motionPath: [{ t: 0, x: 0.1, y: 0.1 }, { t: 1, x: 0.2, y: 0.2 }] })
  ]);
  const r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  const scene = r.doc.scenes[r.sceneId];
  const codes = r.report.tracks.map(t => scene.threadStates[t.threadId].unsupported);
  assert.deepStrictEqual(codes, [['live-input-not-stored'], ['stream-external'], ['node-private-state'], ['motion-free-time']]);
  assert.deepStrictEqual(r.report.tracks.map(t => t.unsupported), codes, 'report matches the Scene');
  assert.strictEqual(Object.keys(r.doc.assets).length, 2);
});

// ---------- 8. malformed input ----------
test('8. malformed sessions fail clearly without mutation', async () => {
  const w = weave();
  const docF = deepFreeze(clone(w.doc));
  const cases = [
    [null, 'session'], [5, 'session'], [[], 'session'], [{}, 'session'], [{ tracks: null }, 'session'], [{ tracks: [] }, 'session'],
    [{ tracks: [1, 2, 3, 4, 5].map(i => baseTrack(i - 1)) }, 'session'], [{ type: 'aether_weave', tracks: [baseTrack(0)] }, 'session'],
    [session([baseTrack(0), baseTrack(0)]), 'session'], [session([baseTrack(7)]), 'session'], [session([null]), 'session'],
    [session([baseTrack(0, { playlist: [{ name: 'x.wav' }] })]), 'track'],
    [session([baseTrack(0, { playlist: [{ name: 'x.wav', data: '' }] })]), 'track'],
    [session([baseTrack(0, { playlist: [{ data: A440 }] })]), 'track'],
    [session([baseTrack(0, { playlist: 'nope' })]), 'track'],
    [session([baseTrack(0, { sampleData: 42 })]), 'track'],
    [session([baseTrack(0, { customNodeZipBase64: {} })]), 'track'],
    [session([baseTrack(0, { customNodeBundle: 'pulse' })]), 'track'],
    [session([baseTrack(0, { playlist: [{ name: 'x.wav', type: 'audio/wav', data: 'not*base64!' }] })]), 'base64'],
    [session([baseTrack(0, { playlist: [{ name: 'x.wav', type: 'audio/wav', data: A440.slice(0, -1) }] })]), 'base64'],
    [session([baseTrack(0, { playlist: [{ name: 'x.wav', type: 'audio/wav', data: 'QUJD\n' }] })]), 'base64'],
    [session([baseTrack(0, { sampleData: 'QUJ=' })]), 'base64'],   // non-canonical trailing bits
    [session([baseTrack(0, { playlist: [{ name: 'x.wav', type: 'audio/wav', data: '====' }] })]), 'base64'],
    [session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: 'QUJD', customNodeBundle: { manifest: { id: 'x', version: '1' } }, sampleData: 'QUJDRQ==' }), baseTrack(1, { playlist: [{ name: 'x.wav', type: 'audio/wav', data: 'QUJDRA==' }] })]), undefined]
  ];
  for (const [bad, code] of cases) {
    const frozen = deepFreeze(clone(bad));
    const before = JSON.stringify(frozen);
    let r;
    await assert.doesNotReject(async () => { r = await I.importAetherState(docF, frozen, { now: w.d.now, uuid: w.d.uuid }); });
    if (code) fails(r, code); else assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(JSON.stringify(frozen), before);
    let e;
    await assert.doesNotReject(async () => { e = await I.extractAetherAssets(frozen, {}); });
    if (code) fails(e, code); else assert.strictEqual(e.ok, true);
  }
  assert.deepStrictEqual(clone(docF), w.doc);
  // bad document, ctx and opts
  fails(await I.importAetherState({ type: 'nope' }, session([baseTrack(0)])), 'model');
  fails(await I.importAetherState(w.doc, session([baseTrack(0)]), { threadIds: 'x' }), 'thread');
  fails(await I.importAetherState(w.doc, session([baseTrack(0)]), { bogus: 1 }), 'session');
  fails(await I.importAetherState(w.doc, session([baseTrack(0)]), {}, { bogus: 1 }), 'session');
  fails(await I.importAetherState(w.doc, session([baseTrack(0)]), {}, { limits: { maxTotalBytes: -1 } }), 'limit');
  fails(await I.importAetherState(w.doc, session([baseTrack(0)]), {}, { engine: 'bogus' }), 'engine');
  fails(await I.extractAetherAssets(session([baseTrack(0)]), null), 'container');
  // existing table that fails structural preflight (no limits needed)
  const badTable = { ['sha256:' + 'a'.repeat(64)]: { kind: 'audio', bytes: 3, storage: { kind: 'inline-base64', data: 'QUJDRA==' } } };
  fails(await I.extractAetherAssets(session([baseTrack(0)]), badTable), 'length');
});

// ---------- 9. failure preservation ----------
test('9. a bad payload on a later track leaves no partial table and the document unchanged', async () => {
  const w = weave();
  const docF = deepFreeze(clone(w.doc));
  const s = deepFreeze(session([
    baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }),
    baseTrack(1, { playlist: [{ name: 'b.wav', type: 'audio/wav', data: A660 }] }),
    baseTrack(2, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() }),
    baseTrack(3, { playlist: [{ name: 'c.wav', type: 'audio/wav', data: 'QUJD' }, { name: 'd.wav', type: 'audio/wav', data: 'QUJ=' }] })
  ]));
  const r = await I.extractAetherAssets(s, {});
  fails(r, 'base64', 3);
  assert.strictEqual(r.assets, null); assert.strictEqual(r.perTrack, null);
  const r2 = await I.importAetherState(docF, s, { now: w.d.now, uuid: w.d.uuid });
  fails(r2, 'base64', 3);
  assert.deepStrictEqual(clone(docF), w.doc);
  // a conflict found after good tracks is also all-or-nothing
  const s2 = session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }), baseTrack(1, { isLiveIn: true, sampleData: A660 })]);
  const r3 = await I.extractAetherAssets(s2, {});
  fails(r3, 'conflict', 1); assert.strictEqual(r3.assets, null);
});

// ---------- 10. limits, two classes ----------
test('10. limits: preflight refusals hash nothing; growth refusals after dedupe may hash; exact limits pass', async () => {
  const w = weave();
  const items = (n) => [{ name: 'a.wav', type: 'audio/wav', data: A440 }, { name: 'b.wav', type: 'audio/wav', data: A660 }].slice(0, n);
  // (a) preflight: a single payload over maxAssetBytes
  digestCalls = 0;
  let r = await I.importAetherState(w.doc, session([baseTrack(0, { playlist: items(2) })]), {}, { limits: { maxAssetBytes: 75 } });
  fails(r, 'limit', 0); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0);
  // (a) preflight: existing table already over
  digestCalls = 0;
  r = await I.importAetherState(clone(FIXTURE), session([baseTrack(0, { playlist: items(1) })]), {}, { limits: { maxTotalBytes: 781 } });
  fails(r, 'limit'); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0);
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(1) })]), FIXTURE.assets, { limits: { maxAssetCount: 2 } });
  fails(r, 'limit'); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0);
  // (a) preflight: certain growth (lengths match nothing) over maxTotalBytes
  digestCalls = 0;
  const bundleOnly = session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() })]);
  r = await I.extractAetherAssets(bundleOnly, {}, { limits: { maxTotalBytes: 629 } });
  fails(r, 'limit'); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0);
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(2) })]), {}, { limits: { maxEncodedChars: 1 } });
  fails(r, 'limit', 0); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0);
  // (a) certain growth alone: the zip (630) matches no stored length and no other payload, the WAV (76) might deduplicate;
  // 76 stored + 630 certain = 706 > 700 is provable before any hashing, although 630 alone fits.
  digestCalls = 0;
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(1) }), baseTrack(1, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() })]),
    { [ID_A440]: clone(FIXTURE.assets[ID_A440]) }, { limits: { maxTotalBytes: 700 } });
  fails(r, 'limit'); assert.strictEqual(r.stage, 'preflight'); assert.strictEqual(digestCalls, 0); assert.ok(/certain growth/.test(r.error), r.error);
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(1) }), baseTrack(1, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() })]),
    { [ID_A440]: clone(FIXTURE.assets[ID_A440]) }, { limits: { maxTotalBytes: 706 } });
  assert.strictEqual(r.ok, true, 'exactly at the limit with the WAV deduplicated: ' + r.error);
  assert.strictEqual(r.report.assetsAdded, 1); assert.strictEqual(r.report.assetsDeduplicated, 1);
  // (b) growth: both payloads share a length with existing entries, only one is a duplicate; real growth breaks the limit
  const existing = { [ID_A440]: clone(FIXTURE.assets[ID_A440]) };   // 76 bytes stored
  digestCalls = 0;
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(2) })]), existing, { limits: { maxTotalBytes: 76 } });
  fails(r, 'limit', 0); assert.strictEqual(r.stage, 'growth'); assert.ok(digestCalls > 0, 'dedupe needed hashing');
  assert.strictEqual(r.assets, null);
  // (c) exactly at the limits: duplicates charge nothing
  digestCalls = 0;
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(2) })]), existing, { limits: { maxTotalBytes: 152, maxAssetBytes: 76, maxAssetCount: 2, maxEncodedChars: 2 * A440.length } });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(Object.keys(r.assets), [ID_A440, ID_A660]);
  r = await I.extractAetherAssets(session([baseTrack(0, { playlist: items(1) }), baseTrack(1, { playlist: items(1) })]), existing, { limits: { maxTotalBytes: 76, maxAssetCount: 1 } });
  assert.strictEqual(r.ok, true, 'pure duplicates at an exact limit: ' + r.error);
  assert.strictEqual(r.report.assetsAdded, 0);
});

// ---------- 11. thread mapping ----------
test('11. thread mapping by colour token, explicit ctx.threadIds, and S1 refusals surface', async () => {
  const w = weave();
  const s = session([baseTrack(2, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]);
  let r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.report.tracks[0].threadId, w.doc.threads[2].id, 'track 3 → track-3 thread');
  // document without a track-3 thread
  const doc = clone(w.doc); doc.threads[2].color = 'track-1';
  assert.strictEqual(M.validateDocument(doc).ok, true);
  fails(await I.importAetherState(doc, s, {}), 'thread', 2);
  // explicit override
  r = await I.importAetherState(doc, s, { threadIds: [undefined, undefined, doc.threads[3].id], now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.report.tracks[0].threadId, doc.threads[3].id);
  fails(await I.importAetherState(doc, s, { threadIds: [undefined, undefined, 'not-a-thread'] }), 'thread', 2);
  // S1's own duplicate-thread refusal reaches the caller as a model failure
  const two = session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }), baseTrack(1)]);
  const dup = await I.importAetherState(w.doc, two, { threadIds: [w.doc.threads[0].id, w.doc.threads[0].id] });
  fails(dup, 'model');
});

// ---------- 12. frozen exports only ----------
test('12. S1 and S2 are reached through their frozen public exports', () => {
  assert.strictEqual(Object.isFrozen(M), true); assert.strictEqual(Object.isFrozen(A), true); assert.strictEqual(Object.isFrozen(I), true);
  assert.deepStrictEqual(Object.keys(I).sort(), ['canonicalJsonBytes', 'extractAetherAssets', 'importAetherState']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'weave-import.js'), 'utf8');
  const used = new Set((src.match(/\b[MA]\.([A-Za-z_0-9]+)/g) || []).map(x => x.slice(2)));
  for (const u of used) assert.ok((u in M) || (u in A), 'uses only exported S1/S2 members: ' + u);
  // Browser-style load: globals instead of require; missing S1/S2 globals fail cleanly, never throw.
  const vm = require('vm');
  const noDeps = {}; vm.runInNewContext(src, Object.assign(noDeps, { globalThis: noDeps, TextEncoder }));
  assert.deepStrictEqual(Object.keys(noDeps.AetherWeaveImport).sort(), ['canonicalJsonBytes', 'extractAetherAssets', 'importAetherState']);
  return (async () => {
    const r = await noDeps.AetherWeaveImport.importAetherState({}, {});
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'engine');
    const e = await noDeps.AetherWeaveImport.extractAetherAssets({}, {});
    assert.strictEqual(e.ok, false); assert.strictEqual(e.code, 'engine'); assert.strictEqual(e.assets, null);
    const withDeps = { AetherWeaveModel: M, AetherWeaveAssets: A, TextEncoder, crypto: globalThis.crypto };
    withDeps.globalThis = withDeps;
    vm.runInNewContext(src, withDeps);
    const w = weave();
    const ok = await withDeps.AetherWeaveImport.importAetherState(w.doc, session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]), { now: w.d.now, uuid: w.d.uuid });
    assert.strictEqual(ok.ok, true, ok.error);
  });
});

// ---------- 13. complete snapshot ----------
test('13. mutations to the session, table, document, ctx and limits while pending do not reach the result', async () => {
  const w = weave();
  const mk = () => session([
    baseTrack(0, { sampleName: 'buf.wav', sampleData: A660, playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }], playlistIndex: 0, eq: { low: 1, mid: 2, high: 3 }, motionPath: [{ t: 0, x: 0.1, y: 0.1 }, { t: 1, x: 0.2, y: 0.2 }] }),
    baseTrack(1, { isCustomNode: true, customNodeBundle: BUNDLE(), customNodeParams: { level: 0.5 } })
  ]);
  const ctxOf = (d) => ({ now: d.now, uuid: d.uuid, name: 'Snapshot', threadIds: [FIXTURE.threads[0].id, FIXTURE.threads[1].id] });
  const limits = { maxTotalBytes: 100000, maxAssetCount: 10 };
  const docIn = clone(FIXTURE);   // holds the zip already (referenced by its own Scenes)
  // reference run on untouched inputs
  const ref = await I.importAetherState(clone(docIn), mk(), ctxOf(det()), { limits: clone(limits) });
  assert.strictEqual(ref.ok, true, ref.error);
  assert.strictEqual(Object.keys(ref.doc.assets).length, 4, 'fixture 3 + JSON fallback bundle; a440/a660 deduplicate');
  // mutated run
  const live = mk(), liveDoc = clone(docIn), liveCtx = ctxOf(det()), liveLimits = clone(limits);
  const p = I.importAetherState(liveDoc, live, liveCtx, { limits: liveLimits });
  // (a) session nested values
  live.tracks[0].playlist[0].name = 'renamed.wav'; live.tracks[0].playlist[0].data = A660; live.tracks[0].sampleData = A440;
  live.tracks[0].eq.low = 99; live.tracks[0].motionPath[1].x = 0.9; live.tracks[0].motionPath.push({ t: 2, x: 0, y: 0 });
  live.tracks[1].customNodeBundle.dsp_js = 'tampered'; live.tracks[1].customNodeBundle.manifest.version = '9.9.9'; live.tracks[1].customNodeParams.level = 1;
  live.tracks.push(baseTrack(2, { playlist: [{ name: 'z.wav', type: 'audio/wav', data: A440 }] }));
  live.masterVolume = 0.1; live.name = 'changed';
  // (b) asset table: intruder, rewritten payload, nested storage object swapped
  liveDoc.assets['sha256:' + 'f'.repeat(64)] = clone(FIXTURE.assets[ID_A440]);
  liveDoc.assets[ID_ZIP].storage.data = A440; liveDoc.assets[ID_ZIP].storage = { kind: 'inline-base64', data: 'QUJD' }; liveDoc.assets[ID_ZIP].name = 'tampered';
  // (c) document: thread, scene, master
  liveDoc.threads[0].id = 'th_ffffffff-ffff-4fff-8fff-ffffffffffff'; liveDoc.threads[0].color = 'track-4';
  liveDoc.scenes = { bogus: {} }; liveDoc.order = ['bogus']; liveDoc.master.volume = 0.01; liveDoc.name = 'changed';
  // (d) ctx and (e) limits
  liveCtx.threadIds[0] = 'th_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; liveCtx.name = 'changed'; liveLimits.maxTotalBytes = 1;
  const r = await p;
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.doc, ref.doc, 'result identical to the untouched run');
  assert.deepStrictEqual(r.report, ref.report);
  assert.strictEqual(M.validateDocument(r.doc).ok, true);
  assert.strictEqual('sha256:' + 'f'.repeat(64) in r.doc.assets, false, 'intruder absent');
  assert.deepStrictEqual(r.doc.master, docIn.master, 'master equals the captured value');
  assert.strictEqual(r.doc.name, FIXTURE.name);
  // extract alone: same rule for the table and session
  const live2 = mk(), tbl = { [ID_ZIP]: clone(FIXTURE.assets[ID_ZIP]) };
  const p2 = I.extractAetherAssets(live2, tbl, { limits: clone(limits) });
  live2.tracks[0].sampleData = A440; tbl['sha256:' + 'f'.repeat(64)] = clone(FIXTURE.assets[ID_A440]); tbl[ID_ZIP].storage.data = 'QUJD';
  const e = await p2;
  assert.strictEqual(e.ok, true, e.error);
  assert.strictEqual(Object.keys(e.assets).length, 4);
  assert.strictEqual(e.assets[ID_ZIP].storage.data, ZIP, 'stored zip payload is the captured one');
  // The result never aliases the caller's entry objects, even when nothing was added (no S2 call re-copied them).
  const tbl3 = { [ID_ZIP]: clone(FIXTURE.assets[ID_ZIP]) };
  const e3 = await I.extractAetherAssets(session([baseTrack(0, { isLiveIn: true }), baseTrack(1)]), tbl3);
  assert.strictEqual(e3.ok, true, e3.error); assert.strictEqual(e3.report.assetsAdded, 0);
  tbl3[ID_ZIP].name = 'edited later'; tbl3[ID_ZIP].storage.data = 'QUJD'; tbl3[ID_ZIP].storage = { kind: 'inline-base64', data: 'QUJD' };
  assert.deepStrictEqual(e3.assets, { [ID_ZIP]: FIXTURE.assets[ID_ZIP] }, 'no live entry or storage references in the result');
  const tbl4 = { [ID_ZIP]: clone(FIXTURE.assets[ID_ZIP]) };
  tbl4[ID_ZIP].storage.data = 'UEsDBA' + ZIP.slice(6);   // same length, wrong bytes: passes the sync preflight, fails the hash after the await
  const p4 = I.extractAetherAssets(session([baseTrack(0, { isLiveIn: true })]), tbl4, { verifyExisting: true });
  tbl4[ID_ZIP].storage.data = ZIP;   // "repaired" while pending
  const e4 = await p4;
  fails(e4, 'hash'); // verification saw the captured (corrupted) entry, not the later repair
});

// ---------- 14. legacy fields kept exactly ----------
test('14. absent z, generatedReturn and captureBpm survive import exactly', async () => {
  const w = weave();
  const s = session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }], motionPath: [{ t: 0, x: 0.2, y: 0.8, z: 0 }, { t: 0.058, x: 0.25, y: 0.77 }, { generatedReturn: true, t: 30.2, x: 0.2, y: 0.8, z: 0 }] })]);
  delete s.tracks[0].z;
  const r = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid, captureBpm: 120 });
  assert.strictEqual(r.ok, true, r.error);
  const ts = Object.values(r.doc.scenes[r.sceneId].threadStates)[0];
  assert.strictEqual('z' in ts.spatial, false);
  assert.deepStrictEqual(ts.motion.points, s.tracks[0].motionPath);
  assert.strictEqual('z' in ts.motion.points[1], false);
  assert.strictEqual(ts.motion.points[2].generatedReturn, true);
  assert.strictEqual(ts.motion.captureBpm, 120);
  const r2 = await I.importAetherState(w.doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual('captureBpm' in Object.values(r2.doc.scenes[r2.sceneId].threadStates)[0].motion, false, 'no invented captureBpm');
});

// ---------- 15. conflicts and omissions ----------
test('15. unreferenced payloads are refused by default, or disclosed as incomplete with allowOmissions', async () => {
  const w = weave();
  const nodeWithPlaylist = () => session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE(), playlist: [{ name: 'left.wav', type: 'audio/wav', data: A440 }, { name: 'over.wav', type: 'audio/wav', data: A660 }] })]);
  let r = await I.importAetherState(w.doc, nodeWithPlaylist(), { now: w.d.now, uuid: w.d.uuid });
  fails(r, 'conflict', 0);
  assert.deepStrictEqual(r.omitted, [{ field: 'playlist', name: 'left.wav', projectedBytes: 76 }, { field: 'playlist', name: 'over.wav', projectedBytes: 76 }]);
  r = await I.importAetherState(w.doc, nodeWithPlaylist(), { now: w.d.now, uuid: w.d.uuid }, { allowOmissions: true });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(Object.keys(r.doc.assets), [ID_ZIP], 'omitted payloads are not stored');
  const scene = r.doc.scenes[r.sceneId];
  assert.strictEqual(scene.completeness.status, 'incomplete');
  assert.deepStrictEqual(scene.completeness.reasons, ['track 1: playlist "left.wav" omitted (node source takes precedence)', 'track 1: playlist "over.wav" omitted (node source takes precedence)']);
  assert.deepStrictEqual(r.report.completeness, scene.completeness);
  assert.deepStrictEqual(r.report.tracks[0].omitted, [{ field: 'playlist', name: 'left.wav', projectedBytes: 76 }, { field: 'playlist', name: 'over.wav', projectedBytes: 76 }]);
  assert.strictEqual(M.validateDocument(r.doc).ok, true);
  // live-input with a buffer and a playlist item
  const liveWithBuf = () => session([baseTrack(0, { isLiveIn: true, sampleName: 'rec.wav', sampleData: A440, playlist: [{ name: 'x.wav', type: 'audio/wav', data: A660 }] })]);
  r = await I.importAetherState(w.doc, liveWithBuf(), {});
  fails(r, 'conflict', 0);
  r = await I.importAetherState(w.doc, liveWithBuf(), { now: w.d.now, uuid: w.d.uuid }, { allowOmissions: true });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(Object.keys(r.doc.assets), []);
  assert.deepStrictEqual(r.doc.scenes[r.sceneId].completeness.reasons, ['track 1: sampleData "rec.wav" omitted (live-input source takes precedence)', 'track 1: playlist "x.wav" omitted (live-input source takes precedence)']);
  // stream likewise
  r = await I.importAetherState(w.doc, session([baseTrack(0, { isStream: true, streamUrl: 'https://x.invalid/s', sampleData: A440 })]), {});
  fails(r, 'conflict', 0);
  // a node's sampleData is the tape, not an omission
  r = await I.importAetherState(w.doc, session([baseTrack(0, { isCustomNode: true, customNodeZipBase64: ZIP, customNodeBundle: BUNDLE(), sampleData: A440 })]), { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.report.tracks[0].omitted, []);
  assert.strictEqual(r.doc.scenes[r.sceneId].completeness.status, 'complete');
});

// ---------- 16. path-only sources ----------
test('16. path-only sources fail; live-input/stream ignore a leftover path; no path ever appears in a result', async () => {
  const w = weave();
  let r = await I.importAetherState(w.doc, session([baseTrack(0, { filePath: '/Users/matt/secret/loop.wav' })]), {});
  fails(r, 'path-only', 0); noPathIn(r);
  r = await I.importAetherState(w.doc, session([baseTrack(0, { isCustomNode: true, filePath: '/Users/matt/secret/node.aethernode' })]), {});
  fails(r, 'path-only', 0); noPathIn(r);
  // live-input and stream with a leftover path import fine and keep no path
  r = await I.importAetherState(w.doc, session([baseTrack(0, { isLiveIn: true, filePath: '/dev/secret' }), baseTrack(1, { isStream: true, streamUrl: 'https://x.invalid/s', filePath: '/Users/matt/secret/x' })]), { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error); noPathIn(r);
  // a path alongside real payloads is simply dropped
  r = await I.importAetherState(w.doc, session([
    baseTrack(0, { filePath: '/Users/matt/secret/a.wav', playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }),
    baseTrack(1, { filePath: '/Users/matt/secret/b.wav', sampleData: A660 }),
    baseTrack(2, { isCustomNode: true, filePath: '/Users/matt/secret/n.aethernode', customNodeZipBase64: ZIP, customNodeBundle: BUNDLE() })
  ]), { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  noPathIn(r);
  assert.strictEqual(JSON.stringify(r.doc).includes('secret'), false);
  const e = await I.extractAetherAssets(session([baseTrack(0, { filePath: '/Users/matt/secret/a.wav', playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]), {});
  assert.strictEqual(e.ok, true); noPathIn(e);
});

// ---------- 17. existing-table verification ----------
test('17. verifyExisting catches a corrupted untouched entry; the default does not and says so', async () => {
  const w = weave();
  const doc = clone(FIXTURE);
  doc.assets[ID_ZIP].storage.data = 'UEsDBA' + ZIP.slice(6);   // same length, corrupted bytes, never touched by the import
  assert.strictEqual(M.validateDocument(doc).ok, true);
  const s = session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]);
  let r = await I.importAetherState(doc, s, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.report.existingVerified, false, 'default: not byte-verified, and the report says so');
  r = await I.importAetherState(doc, s, { now: w.d.now, uuid: w.d.uuid }, { verifyExisting: true });
  fails(r, 'hash');
  assert.strictEqual(r.report.failed.stage, 'verify-existing');
  const good = clone(FIXTURE);
  r = await I.importAetherState(good, s, { now: w.d.now, uuid: w.d.uuid }, { verifyExisting: true, limits: { maxTotalBytes: 10000 } });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.report.existingVerified, true);
  // verifyExisting also applies limits to the existing table (reported as preflight)
  r = await I.importAetherState(good, s, {}, { verifyExisting: true, limits: { maxAssetBytes: 100 } });
  fails(r, 'limit'); assert.strictEqual(r.stage, 'preflight');
});

// ---------- 18. malformed supplied state is rejected, never defaulted (Codex review, 5 Oct) ----------
test('18. malformed motionPath/eq/customNodeParams/playlist-type and empty payload strings are rejected with field and track', async () => {
  const w = weave();
  const docF = deepFreeze(clone(w.doc));
  const ok = (extra) => session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }), baseTrack(1, extra)]);
  const cases = [
    [{ motionPath: 'nope' }, 'track', 'tracks[1].motionPath'],
    [{ motionPath: { t: 0 } }, 'track', 'tracks[1].motionPath'],
    [{ motionPath: 7 }, 'track', 'tracks[1].motionPath'],
    [{ eq: 'flat' }, 'track', 'tracks[1].eq'],
    [{ eq: [0, 0, 0] }, 'track', 'tracks[1].eq'],
    [{ eq: 3 }, 'track', 'tracks[1].eq'],
    [{ customNodeParams: 7 }, 'track', 'tracks[1].customNodeParams'],
    [{ customNodeParams: [1, 2] }, 'track', 'tracks[1].customNodeParams'],
    [{ customNodeParams: 'bpm=120' }, 'track', 'tracks[1].customNodeParams'],
    [{ sampleData: '' }, 'empty', 'tracks[1].sampleData'],
    [{ isCustomNode: true, customNodeZipBase64: '', customNodeBundle: BUNDLE() }, 'empty', 'tracks[1].customNodeZipBase64'],
    [{ playlist: [{ name: 'x.wav', type: 7, data: A440 }] }, 'track', 'tracks[1].playlist[0].type'],
    [{ name: 5 }, 'track', 'tracks[1].name'],
    [{ sampleName: {} }, 'track', 'tracks[1].sampleName'],
    [{ filePath: 9 }, 'track', 'tracks[1].filePath'],
    [{ isStream: true, streamUrl: ['https://x.invalid'] }, 'track', 'tracks[1].streamUrl'],
    [{ playlistIndex: 'first' }, 'track', 'tracks[1].playlistIndex']
  ];
  for (const [extra, code, path] of cases) {
    const bad = deepFreeze(ok(extra));
    const before = JSON.stringify(bad);
    let r;
    await assert.doesNotReject(async () => { r = await I.importAetherState(docF, bad, { now: w.d.now, uuid: w.d.uuid }); });
    fails(r, code, 1);
    assert.strictEqual(r.path, path, 'path for ' + JSON.stringify(extra));
    assert.strictEqual(JSON.stringify(bad), before);
    let e;
    await assert.doesNotReject(async () => { e = await I.extractAetherAssets(bad, {}); });
    fails(e, code, 1); assert.strictEqual(e.assets, null); assert.strictEqual(e.perTrack, null);
  }
  assert.deepStrictEqual(clone(docF), w.doc);
  // Legitimate absence from the current writer still imports: null payloads/bundle, undefined motionPath/eq/params/z, empty playlist.
  const legit = session([baseTrack(0, { sampleData: null, customNodeBundle: null, customNodeZipBase64: null, customNodeParams: null, playlist: [], playlist_unused: undefined }), { index: 1, playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] }]);
  delete legit.tracks[0].playlist_unused; delete legit.tracks[1].motionPath; delete legit.tracks[1].eq; delete legit.tracks[1].customNodeParams; delete legit.tracks[1].z;
  const r = await I.importAetherState(w.doc, legit, { now: w.d.now, uuid: w.d.uuid });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.report.tracks.map(t => t.sourceKind), ['empty', 'playlist']);
});

// ---------- 19. snapshot failures are structured results, never rejected promises ----------
test('19. cyclic nested session data and cyclic existing-table data give structured failures; nothing leaks or throws', async () => {
  const w = weave();
  const docF = deepFreeze(clone(w.doc));
  const mkCyclic = (field) => {
    const s = session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]);
    const o = { secretValue: 'DO-NOT-ECHO' }; o.self = o;
    if (field === 'eq') s.tracks[0].eq = { low: 0, mid: 0, high: 0, nested: o };
    if (field === 'motionPath') s.tracks[0].motionPath = [{ t: 0, x: 0.1, y: 0.1, extra: o }, { t: 1, x: 0.2, y: 0.2 }];
    if (field === 'customNodeParams') { s.tracks[0].isCustomNode = true; s.tracks[0].customNodeZipBase64 = ZIP; s.tracks[0].customNodeBundle = BUNDLE(); s.tracks[0].customNodeParams = { level: 0.5, deep: o }; }
    if (field === 'bundle') { s.tracks[0].isCustomNode = true; s.tracks[0].customNodeBundle = Object.assign(BUNDLE(), { manifest: { id: 'x', version: '1', loop: o } }); }
    return s;
  };
  for (const field of ['eq', 'motionPath', 'customNodeParams', 'bundle']) {
    let r;
    await assert.doesNotReject(async () => { r = await I.importAetherState(docF, mkCyclic(field), { now: w.d.now, uuid: w.d.uuid }); }, field);
    fails(r, field === 'bundle' ? 'encoding' : 'session', 0);
    assert.strictEqual(JSON.stringify(r).includes('DO-NOT-ECHO'), false, 'no input values echoed');
    let e;
    await assert.doesNotReject(async () => { e = await I.extractAetherAssets(mkCyclic(field), {}); }, field);
    fails(e, field === 'bundle' ? 'encoding' : 'session', 0); assert.strictEqual(e.assets, null); assert.strictEqual(e.perTrack, null);
  }
  // cyclic existing table (extract) and a deep cyclic entry under a valid key
  const entry = clone(FIXTURE.assets[ID_A440]); entry.storage.meta = { secretValue: 'DO-NOT-ECHO' }; entry.storage.meta.loop = entry.storage;
  const tbl = { [ID_A440]: entry };
  let e;
  await assert.doesNotReject(async () => { e = await I.extractAetherAssets(session([baseTrack(0, { playlist: [{ name: 'a.wav', type: 'audio/wav', data: A440 }] })]), tbl); });
  fails(e, 'container'); assert.strictEqual(e.assets, null); assert.strictEqual(e.perTrack, null);
  assert.strictEqual(JSON.stringify(e).includes('DO-NOT-ECHO'), false);
  const tbl2 = {}; tbl2.self = tbl2;
  await assert.doesNotReject(async () => { e = await I.extractAetherAssets(session([baseTrack(0)]), tbl2); });
  fails(e, 'container');
  // the document stays untouched and valid afterwards
  assert.deepStrictEqual(clone(docF), w.doc);
  // Last-resort guard: an unexpected throw inside (a getter that explodes after validation) still resolves to code engine.
  const trap = clone(w.doc); let reads = 0;
  Object.defineProperty(trap, 'ending', { enumerable: true, get() { if (++reads > 1) throw new Error('SECRET-BOOM'); return null; } });
  await assert.doesNotReject(async () => { e = await I.importAetherState(trap, session([baseTrack(0)]), {}); });
  fails(e, 'engine'); assert.strictEqual(JSON.stringify(e).includes('SECRET-BOOM'), false);
  const trapTrack = baseTrack(0); let idxReads = 0;
  Object.defineProperty(trapTrack, 'index', { enumerable: true, get() { if (++idxReads > 1) throw new Error('SECRET-BOOM'); return 0; } });
  await assert.doesNotReject(async () => { e = await I.extractAetherAssets(session([trapTrack]), {}); });
  fails(e, 'engine'); assert.strictEqual(e.assets, null); assert.strictEqual(e.perTrack, null); assert.strictEqual(JSON.stringify(e).includes('SECRET-BOOM'), false);
  // The last-resort result is independent of the thrown value: a thrown object whose own `name` getter
  // throws, and a custom exception name carrying a private marker, must leave a fixed, marker-free result.
  const hostile = () => { const o = { message: 'SECRET-MSG' }; Object.defineProperty(o, 'name', { get() { throw new Error('SECRET-NAME-GETTER'); } }); o.toString = () => { throw new Error('SECRET-TOSTRING'); }; return o; };
  const named = () => { const err = new Error('SECRET-MSG'); err.name = 'SecretPrivateMarkerError'; return err; };
  for (const thrower of [hostile, named]) {
    const trap2 = clone(w.doc); let n2 = 0;
    Object.defineProperty(trap2, 'ending', { enumerable: true, get() { if (++n2 > 1) throw thrower(); return null; } });
    await assert.doesNotReject(async () => { e = await I.importAetherState(trap2, session([baseTrack(0)]), {}); });
    assert.deepStrictEqual(e, { ok: false, error: 'unexpected internal failure during import', code: 'engine', path: '' }, 'fixed result, importAetherState');
    const tt = baseTrack(0); let n3 = 0;
    Object.defineProperty(tt, 'index', { enumerable: true, get() { if (++n3 > 1) throw thrower(); return 0; } });
    await assert.doesNotReject(async () => { e = await I.extractAetherAssets(session([tt]), {}); });
    assert.deepStrictEqual(e, { ok: false, error: 'unexpected internal failure during import', code: 'engine', path: '', assets: null, perTrack: null }, 'fixed result, extractAetherAssets');
    assert.strictEqual(JSON.stringify(e).includes('SECRET'), false);
  }
});

// ---------- 20. canonicalJsonBytes sparse arrays ----------
test('20. sparse arrays are rejected as encoding errors; every successful encoding parses back to the same array contents', () => {
  const sparse1 = [1, , 3];
  const sparse2 = [, , 2, , ];
  const nested = { a: [[0], [1, , 2]] };
  const trailing = [1, 2, , ];
  for (const bad of [sparse1, sparse2, nested, trailing, { k: sparse1 }, [[[, ]]]]) {
    const r = I.canonicalJsonBytes(bad);
    assert.strictEqual(r.ok, false, 'sparse must fail: ' + String(bad));
    assert.strictEqual(r.code, 'encoding');
    assert.ok(/hole|sparse/i.test(r.error), r.error);
  }
  assert.strictEqual(I.canonicalJsonBytes([1, , 3]).path, '[1]');
  assert.strictEqual(I.canonicalJsonBytes({ a: [[0], [1, , 2]] }).path, 'a[1][1]');
  // dense arrays round-trip exactly, including null entries and empty arrays
  for (const good of [[], [null], [1, null, 3], [[]], [[[]]], { a: [1, [2, [3, null]]], b: [] }, ['', 'x', { y: [0] }]]) {
    const r = I.canonicalJsonBytes(good);
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(JSON.parse(r.text), good);
    assert.deepStrictEqual(JSON.parse(Buffer.from(r.bytes).toString('utf8')), good);
  }
  // a sparse array inside a bundle fallback surfaces as an import encoding failure on that track
  const bundle = Object.assign(BUNDLE(), { manifest: { id: 'x', version: '1', parameters: [{ id: 'a' }, , { id: 'c' }] } });
  return I.importAetherState(weave().doc, session([baseTrack(0, { isCustomNode: true, customNodeBundle: bundle })]), {}).then(r => { fails(r, 'encoding', 0); assert.ok(/parameters\[1\]/.test(r.path), r.path); });
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('✔ ' + t.name); }
    catch (e) { failed++; console.log('✘ ' + t.name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
