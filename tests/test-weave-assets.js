/**
 * Weave v0.1 Phase 1 S2 — asset integrity helper tests.
 * Run: node tests/test-weave-assets.js
 * Pure/mocked only: no DOM, audio, Tauri, native app or browser. Hashing runs through
 * Node's WebCrypto (crypto.subtle, the same API a browser offers) and through Node's
 * crypto module; a real browser run is NOT part of this evidence.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const A = require(path.join(__dirname, '..', 'desktop', 'weave-assets.js'));
const M = require(path.join(__dirname, '..', 'desktop', 'weave-model.js'));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weave-v1-two-scenes.json'), 'utf8'));

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (o) => { if (o && typeof o === 'object' && !ArrayBuffer.isView(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const bytesOf = (s) => new TextEncoder().encode(s);
const sha = (b) => 'sha256:' + nodeCrypto.createHash('sha256').update(b).digest('hex');
const ids = Object.keys(FIXTURE.assets);
const bundleId = ids.find(k => FIXTURE.assets[k].kind === 'node-bundle');
const wavIds = ids.filter(k => FIXTURE.assets[k].kind === 'audio');
const codes = (r) => r.errors.map(e => e.code);

// Count calls into crypto.subtle.digest so tests can prove no hashing happened.
let digestCalls = 0;
const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.digest = function (alg, data) { digestCalls++; return realDigest(alg, data); };

// ---------- SHA-256 oracle and byte handling ----------
test('sha256: known vectors through WebCrypto and Node engines', async () => {
  const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const MILLION_A = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
  for (const engine of ['subtle', 'node']) {
    assert.strictEqual((await A.sha256Hex(new Uint8Array(0), { engine })).hex, EMPTY, engine);
    assert.strictEqual((await A.sha256Hex(bytesOf('abc'), { engine })).hex, ABC, engine);
    assert.strictEqual((await A.sha256Hex(new Uint8Array(1e6).fill(97), { engine })).hex, MILLION_A, engine);
  }
  assert.strictEqual((await A.sha256Hex(bytesOf('abc'))).hex, ABC, 'default engine');
  const bad = await A.sha256Hex(bytesOf('abc'), { engine: 'bogus' });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'engine');
});

test('sha256: typed-array views hash exactly their offset/length, not the backing buffer', async () => {
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  const backing = bytesOf('xxabcyy');
  const view = new Uint8Array(backing.buffer, 2, 3);
  assert.strictEqual((await A.sha256Hex(view)).hex, ABC, 'Uint8Array view');
  assert.strictEqual((await A.sha256Hex(new DataView(backing.buffer, 2, 3))).hex, ABC, 'DataView');
  assert.strictEqual((await A.sha256Hex(Buffer.from(backing.buffer, 2, 3))).hex, ABC, 'Buffer view');
  assert.strictEqual((await A.sha256Hex(view, { engine: 'node' })).hex, ABC, 'Node engine view');
  assert.notStrictEqual((await A.sha256Hex(backing.buffer)).hex, ABC, 'whole ArrayBuffer differs');
  assert.strictEqual((await A.sha256Hex(bytesOf('abc').buffer)).hex, ABC, 'exact ArrayBuffer');
  const id = await A.assetIdForBytes(view);
  assert.deepStrictEqual(id, { ok: true, id: 'sha256:' + ABC, byteLength: 3 });
});

test('toBytes: rejects non-binary inputs with a clear error', async () => {
  for (const bad of ['abc', 123, null, undefined, [1, 2], { length: 1 }]) {
    const r = A.toBytes(bad);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'bytes');
    assert.strictEqual((await A.sha256Hex(bad)).ok, false);
  }
});

// ---------- base64 ----------
test('base64: canonical encode/decode round-trips and matches Node for lengths 0–40', () => {
  for (let n = 0; n <= 40; n++) {
    const b = nodeCrypto.randomBytes(n);
    const enc = A.encodeBase64(b);
    assert.strictEqual(enc, b.toString('base64'), 'encode n=' + n);
    assert.strictEqual(A.base64LengthForBytes(n), enc.length);
    assert.deepStrictEqual(A.decodedLengthOfBase64(enc), { ok: true, bytes: n });
    const dec = A.decodeBase64Strict(enc);
    assert.strictEqual(dec.ok, true);
    assert.deepStrictEqual(Buffer.from(dec.bytes), b, 'decode n=' + n);
  }
  assert.deepStrictEqual(Array.from(A.decodeBase64Strict('QQ==').bytes), [0x41]);
  assert.deepStrictEqual(Array.from(A.decodeBase64Strict('QUI=').bytes), [0x41, 0x42]);
  assert.strictEqual(A.decodeBase64Strict('').bytes.length, 0);
  assert.ok(Number.isNaN(A.base64LengthForBytes(-1)));
});

test('base64: rejects every non-canonical form', () => {
  const cases = {
    'QUJ': 'multiple of 4', 'QUJ$': 'outside the canonical alphabet', 'QUJD\n': 'multiple of 4',
    'QUJD QUJ': 'outside the canonical alphabet', 'QUJD\nQUJ': 'outside the canonical alphabet',
    '-_-_': 'outside the canonical alphabet', 'QQ==QUJD': 'padding must only appear at the end',
    'Q===': 'padding must only appear at the end', '====': 'padding must only appear at the end',
    'QR==': 'not canonical', 'QUJ=': 'not canonical', 'QUJDQ': 'multiple of 4'
  };
  for (const [input, msg] of Object.entries(cases)) {
    const r = A.decodeBase64Strict(input);
    assert.strictEqual(r.ok, false, JSON.stringify(input));
    assert.strictEqual(r.code, 'base64');
    assert.ok(r.error.includes(msg), JSON.stringify(input) + ' -> ' + r.error);
  }
  for (const bad of [null, 5, {}, []]) assert.strictEqual(A.decodeBase64Strict(bad).ok, false);
  assert.strictEqual(A.decodedLengthOfBase64('QUJ').ok, false);
  assert.strictEqual(A.decodedLengthOfBase64(7).ok, false);
});

// ---------- verifyAssets ----------
test('verifyAssets: the fixture table passes, every payload hashes to its key', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  for (const engine of [undefined, 'node']) {
    const r = await A.verifyAssets(table, engine ? { engine } : undefined);
    assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
    assert.deepStrictEqual(Object.keys(r.verified).sort(), ids.slice().sort());
    for (const id of ids) {
      assert.strictEqual(r.verified[id].byteLength, FIXTURE.assets[id].bytes);
      assert.strictEqual(sha(r.verified[id].bytes), id, 'independent hash of decoded bytes');
      assert.strictEqual(r.verified[id].kind, FIXTURE.assets[id].kind);
    }
    assert.deepStrictEqual(r.totals, { count: 3, projectedBytes: 76 + 76 + 630, encodedChars: 104 + 104 + 840 });
  }
  assert.deepStrictEqual(clone(table), FIXTURE.assets, 'input unchanged');
});

function withAsset(id, mutate) { const t = clone(FIXTURE.assets); mutate(t[id], t, id); return t; }
async function expectReject(table, code, pathPart) {
  const r = await A.verifyAssets(table);
  assert.strictEqual(r.ok, false, 'expected rejection');
  assert.strictEqual(r.verified, null, 'no partial payloads');
  assert.ok(r.errors.some(e => e.code === code && (!pathPart || e.path.includes(pathPart))),
    'wanted ' + code + ' at ' + pathPart + ', got ' + JSON.stringify(r.errors));
  return r;
}

test('verifyAssets: wrong hash, wrong length and corrupt base64 are each rejected', async () => {
  const wav = wavIds[0], other = wavIds[1];
  // Key is well-formed but names other bytes.
  const swapped = clone(FIXTURE.assets); swapped[wav.slice(0, -1) + (wav.endsWith('0') ? '1' : '0')] = swapped[wav]; delete swapped[wav];
  await expectReject(swapped, 'hash');
  // Declared length disagrees with the encoding (caught in preflight, before decoding).
  await expectReject(withAsset(wav, a => { a.bytes += 1; }), 'length', '.bytes');
  await expectReject(withAsset(wav, a => { a.bytes = -1; }), 'metadata', '.bytes');
  await expectReject(withAsset(wav, a => { a.bytes = 76.5; }), 'metadata', '.bytes');
  // Payload text damaged in different ways.
  await expectReject(withAsset(wav, a => { a.storage.data = a.storage.data.slice(0, 10) + '!' + a.storage.data.slice(11); }), 'base64', '.storage.data');
  await expectReject(withAsset(wav, a => { a.storage.data = a.storage.data.slice(0, -1); }), 'base64');
  await expectReject(withAsset(wav, a => { a.storage.data = a.storage.data.slice(0, -8) + 'QQ==' + a.storage.data.slice(-4); }), 'base64'); // padding mid-string, same length
  await expectReject(withAsset(wav, a => { a.storage.data = a.storage.data.slice(0, -3) + 'B=='; }), 'base64'); // non-canonical trailing bits
  // Same bytes, different content: re-encode the other wav under this key.
  await expectReject(withAsset(wav, (a, t) => { a.storage.data = t[other].storage.data; }), 'hash');
  // Two broken assets produce two errors; a valid third is still not returned.
  const two = clone(FIXTURE.assets); two[wavIds[0]].bytes = 1; two[wavIds[1]].storage.data = 'QUJ';   // both caught in preflight
  const r = await expectReject(two, 'length');
  assert.ok(codes(r).includes('base64'));
  assert.ok(r.errors.length >= 2);
});

test('verifyAssets: malformed containers and metadata are reported, never thrown', async () => {
  for (const bad of [null, undefined, [], 'assets', 42]) {
    const r = await A.verifyAssets(bad);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.verified, null); assert.strictEqual(r.errors[0].code, 'container');
  }
  const wav = wavIds[0];
  await expectReject(withAsset(wav, (a, t) => { t[wav] = null; }), 'container');
  await expectReject(withAsset(wav, (a, t) => { t[wav] = 'x'; }), 'container');
  await expectReject(withAsset(wav, a => { a.storage = null; }), 'container', '.storage');
  await expectReject(withAsset(wav, a => { a.storage = 'x'; }), 'container', '.storage');
  await expectReject(withAsset(wav, a => { a.storage.kind = 'file'; }), 'storage', '.storage.kind');
  await expectReject(withAsset(wav, a => { a.storage.data = 7; }), 'storage', '.storage.data');
  await expectReject(withAsset(wav, a => { a.storage.data = null; }), 'storage', '.storage.data');
  await expectReject(withAsset(wav, a => { a.kind = 'video'; }), 'metadata', '.kind');
  await expectReject(withAsset(wav, (a, t) => { t[wav.toUpperCase()] = t[wav]; delete t[wav]; }), 'key');
  await expectReject(withAsset(wav, (a, t) => { t['md5:abc'] = t[wav]; delete t[wav]; }), 'key');
  const empty = await A.verifyAssets({});
  assert.strictEqual(empty.ok, true); assert.deepStrictEqual(empty.verified, {}); assert.strictEqual(empty.totals.count, 0);
});

test('verifyAssets: empty payloads are refused (S2 policy)', async () => {
  const EMPTY = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const t = clone(FIXTURE.assets);
  t[EMPTY] = { kind: 'audio', name: 'empty.wav', mime: 'audio/wav', bytes: 0, origin: 'original-file', storage: { kind: 'inline-base64', data: '' } };
  await expectReject(t, 'empty', EMPTY);
  const r = await A.addAssetBytes(clone(FIXTURE.assets), new Uint8Array(0), { kind: 'audio', name: 'e.wav', mime: 'audio/wav', origin: 'original-file' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'empty');
});
// ---------- accounting and limits ----------
test('measureAssets: counts unique stored bytes and base64 text without decoding', () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const before = digestCalls;
  const m = A.measureAssets(table);
  assert.deepStrictEqual(m, { ok: true, errors: [], count: 3, declaredBytes: 782, encodedChars: 1048, projectedBytes: 782 });
  assert.strictEqual(digestCalls, before, 'no hashing');
  const bad = A.measureAssets(withAsset(wavIds[0], a => { a.bytes = 80; }));
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.errors[0].code, 'length');
  assert.strictEqual(bad.declaredBytes, 786); assert.strictEqual(bad.projectedBytes, 782, 'both figures still reported');
  assert.strictEqual(A.measureAssets(null).ok, false);
});

test('limits: invalid limit objects are rejected before anything else', async () => {
  for (const limits of ['big', 5, [], { maxBytes: 1 }, { maxTotalBytes: -1 }, { maxTotalBytes: 1.5 }, { maxTotalBytes: '10' }, { maxAssetBytes: NaN }, { maxAssetCount: Infinity }]) {
    const c = A.checkLimits(limits);
    assert.strictEqual(c.ok, false, JSON.stringify(limits)); assert.strictEqual(c.code, 'limit');
    const r = await A.verifyAssets(clone(FIXTURE.assets), { limits });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.verified, null); assert.strictEqual(r.errors[0].code, 'limit');
    const a = await A.addAssetBytes(clone(FIXTURE.assets), bytesOf('new'), { kind: 'audio', name: 'n.wav', mime: 'audio/wav', origin: 'original-file' }, { limits });
    assert.strictEqual(a.ok, false); assert.strictEqual(a.code, 'limit');
  }
  assert.deepStrictEqual(A.checkLimits(undefined), { ok: true, limits: {} });
  assert.deepStrictEqual(A.checkLimits({ maxTotalBytes: 0, maxAssetBytes: undefined }), { ok: true, limits: { maxTotalBytes: 0 } });
});

test('limits: exact boundaries pass and one unit over fails, per limit', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const bounds = { maxTotalBytes: 782, maxAssetBytes: 630, maxEncodedChars: 1048, maxAssetCount: 3 };
  for (const [k, v] of Object.entries(bounds)) {
    const ok = await A.verifyAssets(table, { limits: { [k]: v } });
    assert.strictEqual(ok.ok, true, k + '=' + v + ' ' + JSON.stringify(ok.errors));
    const over = await A.verifyAssets(table, { limits: { [k]: v - 1 } });
    assert.strictEqual(over.ok, false, k + '=' + (v - 1));
    assert.strictEqual(over.verified, null);
    assert.ok(over.errors.every(e => e.code === 'limit'), JSON.stringify(over.errors));
    assert.ok(over.errors.some(e => e.message.includes(k)));
  }
  const all = await A.verifyAssets(table, { limits: bounds });
  assert.strictEqual(all.ok, true);
});

test('limits: an over-budget table is refused before any payload is decoded or hashed', async () => {
  // A 4 MB payload whose base64 is syntactically shaped (length % 4 === 0, consistent
  // declared size) but contains an illegal character. If decoding ran, the error would be
  // 'base64'; with a limit it must be 'limit' only, and crypto.subtle.digest must not run.
  const chars = 4 * 1024 * 1024;
  const data = 'A'.repeat(chars - 8) + '!' + 'A'.repeat(7);
  const bytes = (chars / 4) * 3;
  const key = 'sha256:' + '0'.repeat(64);
  const t = { [key]: { kind: 'audio', name: 'huge.wav', mime: 'audio/wav', bytes, origin: 'original-file', storage: { kind: 'inline-base64', data } }, ...clone(FIXTURE.assets) };
  deepFreeze(t);
  const before = digestCalls;
  const t0 = process.hrtime.bigint();
  const r = await A.verifyAssets(t, { limits: { maxAssetBytes: 1024 * 1024 } });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(r.ok, false); assert.strictEqual(r.verified, null);
  assert.deepStrictEqual(codes(r), ['limit'], JSON.stringify(r.errors));
  assert.strictEqual(digestCalls, before, 'digest was called ' + (digestCalls - before) + ' times');
  assert.strictEqual(r.totals.projectedBytes, bytes + 782);
  const r2 = await A.verifyAssets(t, { limits: { maxTotalBytes: bytes + 781 } });
  assert.deepStrictEqual(codes(r2), ['limit']); assert.strictEqual(digestCalls, before);
  const r3 = await A.verifyAssets(t, { limits: { maxEncodedChars: chars } });
  assert.deepStrictEqual(codes(r3), ['limit']); assert.strictEqual(digestCalls, before);
  // Control: with no limit the same table reaches decoding and reports the bad character,
  // and the fixture's three valid assets are still withheld (no partial results).
  const ctl = await A.verifyAssets(t);
  assert.strictEqual(ctl.ok, false); assert.strictEqual(ctl.verified, null);
  assert.ok(codes(ctl).includes('base64'), JSON.stringify(ctl.errors));
  assert.ok(!codes(ctl).includes('limit'));
  console.log('    (preflight rejection of a 4 MB payload took ' + ms.toFixed(1) + ' ms; digest calls: 0)');
});

test('addAssetBytes: limits are checked from the byte length before hashing or encoding', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const meta = deepFreeze({ kind: 'audio', name: 'big.wav', mime: 'audio/wav', origin: 'original-file' });
  const big = new Uint8Array(2 * 1024 * 1024).fill(7);
  const before = digestCalls;
  let r = await A.addAssetBytes(table, big, meta, { limits: { maxAssetBytes: big.length - 1 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'limit'); assert.strictEqual(digestCalls, before);
  r = await A.addAssetBytes(table, big, meta, { limits: { maxTotalBytes: 782 + big.length - 1 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'limit'); assert.strictEqual(digestCalls, before);
  r = await A.addAssetBytes(table, big, meta, { limits: { maxEncodedChars: 1048 + A.base64LengthForBytes(big.length) - 1 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'limit'); assert.strictEqual(digestCalls, before);
  r = await A.addAssetBytes(table, big, meta, { limits: { maxAssetCount: 3 } });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'limit'); assert.strictEqual(digestCalls, before);
  // Exactly at every boundary it is accepted.
  r = await A.addAssetBytes(table, big, meta, { limits: { maxAssetBytes: big.length, maxTotalBytes: 782 + big.length, maxEncodedChars: 1048 + A.base64LengthForBytes(big.length), maxAssetCount: 4 } });
  assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(r.asset.bytes, big.length);
  assert.ok(digestCalls > before);
  assert.deepStrictEqual(clone(table), FIXTURE.assets, 'input table unchanged');
});
// ---------- addAssetBytes and deduplication ----------
test('addAssetBytes: new bytes produce a verifiable entry and leave the input untouched', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const meta = deepFreeze({ kind: 'audio', name: 'tone.wav', mime: 'audio/wav', origin: 'rendered-buffer' });
  const backing = bytesOf('..tone bytes..');
  const view = new Uint8Array(backing.buffer, 2, 10);               // "tone bytes"
  const snapshot = Array.from(backing);
  const r = await A.addAssetBytes(table, view, meta);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.deduplicated, false);
  assert.strictEqual(r.id, sha(Buffer.from('tone bytes')));
  assert.notStrictEqual(r.assets, table);
  assert.strictEqual(Object.keys(r.assets).length, 4);
  assert.deepStrictEqual(r.assets[r.id], { kind: 'audio', name: 'tone.wav', mime: 'audio/wav', bytes: 10, origin: 'rendered-buffer', storage: { kind: 'inline-base64', data: Buffer.from('tone bytes').toString('base64') } });
  assert.deepStrictEqual(clone(table), FIXTURE.assets);
  assert.deepStrictEqual(Array.from(backing), snapshot, 'bytes unchanged');
  const v = await A.verifyAssets(r.assets);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.strictEqual(Buffer.from(v.verified[r.id].bytes).toString(), 'tone bytes');
  for (const id of ids) assert.deepStrictEqual(r.assets[id], FIXTURE.assets[id], 'existing entries copied as-is');
});

test('addAssetBytes: identical bytes deduplicate to the existing entry whatever the name', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const wav = wavIds[0];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const r = await A.addAssetBytes(table, original, { kind: 'audio', name: 'renamed-copy.wav', mime: 'audio/x-wav', origin: 'rendered-buffer' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.deduplicated, true);
  assert.strictEqual(r.id, wav);
  assert.notStrictEqual(r.assets, table, 'fresh table (no live references)');
  assert.deepStrictEqual(r.assets, FIXTURE.assets, 'deeply equal to the input on dedupe');
  assert.deepStrictEqual(r.asset, FIXTURE.assets[wav], 'existing metadata (name, mime, origin) kept');
  assert.strictEqual(Object.keys(r.assets).length, 3);
  // Bundle with the same identity but a different display name also dedupes.
  const zip = A.decodeBase64Strict(FIXTURE.assets[bundleId].storage.data).bytes;
  const b = await A.addAssetBytes(table, zip, { kind: 'node-bundle', name: 'Pulse (renamed)', mime: 'application/zip', origin: 'unpacked-json', manifestId: 'com.aether.test.fixture-pulse', version: '0.0.1' });
  assert.strictEqual(b.ok, true); assert.strictEqual(b.deduplicated, true); assert.strictEqual(b.id, bundleId);
  assert.strictEqual(b.asset.name, 'Fixture Pulse');
});

test('addAssetBytes: same name with different bytes stays two assets', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const wav = wavIds[0];
  const altered = Uint8Array.from(A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes);
  altered[altered.length - 1] ^= 1;
  const r = await A.addAssetBytes(table, altered, { kind: 'audio', name: FIXTURE.assets[wav].name, mime: 'audio/wav', origin: 'original-file' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.deduplicated, false);
  assert.notStrictEqual(r.id, wav);
  assert.strictEqual(Object.keys(r.assets).length, 4);
  assert.strictEqual(r.assets[wav].name, r.assets[r.id].name, 'both keep the same display name');
  assert.strictEqual((await A.verifyAssets(r.assets)).ok, true);
});

test('addAssetBytes: incompatible kind or bundle identity for identical bytes is rejected', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const wavBytes = A.decodeBase64Strict(FIXTURE.assets[wavIds[0]].storage.data).bytes;
  const zip = A.decodeBase64Strict(FIXTURE.assets[bundleId].storage.data).bytes;
  let r = await A.addAssetBytes(table, wavBytes, { kind: 'node-bundle', name: 'x', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'a', version: '1' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'metadata'); assert.ok(r.error.includes('kind'));
  r = await A.addAssetBytes(table, zip, { kind: 'audio', name: 'x.wav', mime: 'audio/wav', origin: 'original-file' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'metadata');
  r = await A.addAssetBytes(table, zip, { kind: 'node-bundle', name: 'Fixture Pulse', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'com.aether.test.other', version: '0.0.1' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'metadata'); assert.ok(r.error.includes('com.aether.test.other'));
  r = await A.addAssetBytes(table, zip, { kind: 'node-bundle', name: 'Fixture Pulse', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'com.aether.test.fixture-pulse', version: '0.0.2' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'metadata');
  assert.deepStrictEqual(clone(table), FIXTURE.assets);
});

test('addAssetBytes: metadata and container validation', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const b = bytesOf('bytes');
  const bad = [
    null, 'meta', { kind: 'audio', name: 'a', mime: 'audio/wav' },                        // missing origin
    { kind: 'audio', name: 'a', mime: 'audio/wav', origin: 'aethernode-zip' },           // origin of the wrong kind
    { kind: 'audio', name: '', mime: 'audio/wav', origin: 'original-file' },
    { kind: 'audio', name: 'a', mime: '', origin: 'original-file' },
    { kind: 'audio', name: 'a', mime: 'audio/wav', origin: 'original-file', manifestId: 'x' }, // bundle field on audio
    { kind: 'audio', name: 'a', mime: 'audio/wav', origin: 'original-file', bytes: 5 },       // caller may not set bytes
    { kind: 'node-bundle', name: 'a', mime: 'application/zip', origin: 'aethernode-zip', version: '1' }, // no manifestId
    { kind: 'node-bundle', name: 'a', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'm' }, // no version
    { kind: 'video', name: 'a', mime: 'video/mp4', origin: 'original-file' }
  ];
  for (const meta of bad) {
    const r = await A.addAssetBytes(table, b, meta);
    assert.strictEqual(r.ok, false, JSON.stringify(meta)); assert.strictEqual(r.code, 'metadata');
  }
  for (const t of [null, [], 'x']) assert.strictEqual((await A.addAssetBytes(t, b, { kind: 'audio', name: 'a', mime: 'audio/wav', origin: 'original-file' })).code, 'container');
  assert.strictEqual((await A.addAssetBytes(table, 'not bytes', { kind: 'audio', name: 'a', mime: 'audio/wav', origin: 'original-file' })).code, 'bytes');
  assert.deepStrictEqual(clone(table), FIXTURE.assets);
});

// ---------- derived overrides and the S1 boundary ----------
test('derived override: a rendered buffer with different bytes is kept as its own asset, never merged', async () => {
  const doc = clone(FIXTURE);
  const openWater = doc.scenes[doc.order[0]];
  const playlistThread = Object.keys(openWater.threadStates).find(t => openWater.threadStates[t].source.kind === 'playlist');
  const src = openWater.threadStates[playlistThread].source;
  const originalId = src.playlist.items[src.playlist.index || 0];
  // "Rendered" bytes: the original with one sample changed. Same name, origin rendered-buffer.
  const rendered = Uint8Array.from(A.decodeBase64Strict(doc.assets[originalId].storage.data).bytes);
  rendered[rendered.length - 2] ^= 0x10;
  const added = await A.addAssetBytes(doc.assets, rendered, { kind: 'audio', name: doc.assets[originalId].name, mime: 'audio/wav', origin: 'rendered-buffer' });
  assert.strictEqual(added.ok, true); assert.strictEqual(added.deduplicated, false);
  assert.notStrictEqual(added.id, originalId, 'different bytes → different asset');
  doc.assets = added.assets;
  src.override = { assetId: added.id, reason: 'derived-buffer' };
  deepFreeze(doc);
  // S1 still accepts the document, and S2 verifies both the original and the override bytes.
  const v1 = M.validateDocument(doc);
  assert.strictEqual(v1.ok, true, JSON.stringify(v1.errors));
  const v2 = await A.verifyAssets(doc.assets);
  assert.strictEqual(v2.ok, true, JSON.stringify(v2.errors));
  assert.strictEqual(v2.verified[originalId].byteLength, 76);
  assert.strictEqual(v2.verified[added.id].byteLength, 76);
  assert.notDeepStrictEqual(Array.from(v2.verified[originalId].bytes), Array.from(v2.verified[added.id].bytes));
  // Adding the rendered bytes again dedupes to the override asset, not to the original.
  const again = await A.addAssetBytes(doc.assets, rendered, { kind: 'audio', name: 'other-name.wav', mime: 'audio/wav', origin: 'original-file' });
  assert.strictEqual(again.deduplicated, true); assert.strictEqual(again.id, added.id);
  assert.strictEqual(again.asset.origin, 'rendered-buffer', 'existing origin kept; origin never upgraded by a later claim');
  assert.strictEqual(doc.scenes[doc.order[0]].threadStates[playlistThread].source.override.assetId, added.id, 'reference untouched');
});

test('S1 boundary: S1 accepts a structurally valid table with wrong bytes; S2 is what catches it', async () => {
  const doc = clone(FIXTURE);
  const wav = wavIds[0];
  doc.assets[wav].storage.data = doc.assets[wavIds[1]].storage.data;        // wrong bytes under a valid key
  assert.strictEqual(M.validateDocument(doc).ok, true, 'S1 is structural only');
  const r = await A.verifyAssets(doc.assets);
  assert.strictEqual(r.ok, false); assert.ok(codes(r).includes('hash'));
});

// ---------- Codex S2 review regressions (4 October 2026) ----------
test('review 1: re-adding identical bytes at each exact limit succeeds and charges nothing', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const wav = wavIds[0];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const meta = { kind: 'audio', name: 'dup.wav', mime: 'audio/wav', origin: 'original-file' };
  const atLimit = [{ maxTotalBytes: 782 }, { maxEncodedChars: 1048 }, { maxAssetCount: 3 }, { maxAssetBytes: 630 },
    { maxTotalBytes: 782, maxEncodedChars: 1048, maxAssetCount: 3, maxAssetBytes: 630 }];
  for (const limits of atLimit) {
    const r = await A.addAssetBytes(table, original, meta, { limits });
    assert.strictEqual(r.ok, true, JSON.stringify(limits) + ' -> ' + JSON.stringify(r));
    assert.strictEqual(r.deduplicated, true); assert.strictEqual(r.id, wav); assert.deepStrictEqual(r.assets, FIXTURE.assets);
  }
  // The bundle too (largest asset): duplicate at maxAssetBytes === its own size.
  const zip = A.decodeBase64Strict(FIXTURE.assets[bundleId].storage.data).bytes;
  const b = await A.addAssetBytes(table, zip, { kind: 'node-bundle', name: 'x', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'com.aether.test.fixture-pulse', version: '0.0.1' }, { limits: { maxAssetBytes: 630, maxTotalBytes: 782 } });
  assert.strictEqual(b.ok, true, JSON.stringify(b)); assert.strictEqual(b.deduplicated, true);
  // Provably oversize is still rejected before hashing, duplicate or not.
  const before = digestCalls;
  const over = await A.addAssetBytes(table, zip, { kind: 'node-bundle', name: 'x', mime: 'application/zip', origin: 'aethernode-zip', manifestId: 'com.aether.test.fixture-pulse', version: '0.0.1' }, { limits: { maxAssetBytes: 629 } });
  assert.strictEqual(over.ok, false); assert.strictEqual(over.code, 'limit'); assert.strictEqual(digestCalls, before);
  // New bytes of the same length as an existing asset, with no room left: rejected (after a bounded hash).
  const altered = Uint8Array.from(original); altered[0] ^= 1;
  const full = await A.addAssetBytes(table, altered, meta, { limits: { maxTotalBytes: 782 } });
  assert.strictEqual(full.ok, false); assert.strictEqual(full.code, 'limit');
  assert.deepStrictEqual(clone(table), FIXTURE.assets);
});

test('review 2: a matching key is not trusted — the stored payload must equal the new bytes', async () => {
  const wav = wavIds[0], other = wavIds[1];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const meta = { kind: 'audio', name: FIXTURE.assets[wav].name, mime: 'audio/wav', origin: 'original-file' };
  // Same length (76 bytes), different content, stored under the original's key.
  const corrupt = clone(FIXTURE.assets); corrupt[wav].storage.data = FIXTURE.assets[other].storage.data; deepFreeze(corrupt);
  const snapshot = clone(corrupt);
  let r = await A.addAssetBytes(corrupt, original, meta);
  assert.strictEqual(r.ok, false, 'corrupted duplicate must not be accepted');
  assert.strictEqual(r.code, 'hash'); assert.ok(r.path.includes(wav));
  assert.deepStrictEqual(clone(corrupt), snapshot, 'input unchanged');
  // Truncated and non-canonical stored payloads are rejected too, not deduplicated.
  const short = clone(FIXTURE.assets); short[wav].storage.data = short[wav].storage.data.slice(0, -4); deepFreeze(short);
  r = await A.addAssetBytes(short, original, meta);
  assert.strictEqual(r.ok, false); assert.ok(['length', 'base64'].includes(r.code), r.code);
  const nonCanon = clone(FIXTURE.assets); nonCanon[wav].storage.data = nonCanon[wav].storage.data.slice(0, -3) + 'B=='; deepFreeze(nonCanon);
  r = await A.addAssetBytes(nonCanon, original, meta);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'base64');
  const badLen = clone(FIXTURE.assets); badLen[wav].bytes = 75; deepFreeze(badLen);
  r = await A.addAssetBytes(badLen, original, meta);
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'length');
  // The intact table still deduplicates.
  r = await A.addAssetBytes(deepFreeze(clone(FIXTURE.assets)), original, meta);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.deduplicated, true);
});

test('review 3: input bytes and metadata changed while the promise is pending do not reach the stored asset', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));
  const backing = bytesOf('..race bytes..');
  const view = new Uint8Array(backing.buffer, 2, 10);               // "race bytes"
  const intendedId = sha(Buffer.from('race bytes'));
  const meta = { kind: 'audio', name: 'intended.wav', mime: 'audio/wav', origin: 'rendered-buffer' };
  const p = A.addAssetBytes(table, view, meta);
  // Synchronously, before the promise can settle: scribble over the caller's view and metadata.
  view.fill(0); meta.name = 'changed.wav'; meta.origin = 'original-file'; meta.kind = 'node-bundle';
  const r = await p;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.id, intendedId, 'hash is of the bytes at call time');
  assert.deepStrictEqual(r.asset, { kind: 'audio', name: 'intended.wav', mime: 'audio/wav', bytes: 10, origin: 'rendered-buffer', storage: { kind: 'inline-base64', data: Buffer.from('race bytes').toString('base64') } });
  const v = await A.verifyAssets(r.assets);
  assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
  assert.strictEqual(Buffer.from(v.verified[intendedId].bytes).toString(), 'race bytes');
  // Same for the duplicate path: scribbling must not make an intact table look corrupt or vice versa.
  const wav = wavIds[0];
  const dupBytes = Uint8Array.from(A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes);
  const p2 = A.addAssetBytes(table, dupBytes, { kind: 'audio', name: 'd.wav', mime: 'audio/wav', origin: 'original-file' });
  dupBytes.fill(0xff);
  const r2 = await p2;
  assert.strictEqual(r2.ok, true, JSON.stringify(r2)); assert.strictEqual(r2.deduplicated, true); assert.strictEqual(r2.id, wav);
  // verifyAssets: a table whose asset objects are swapped mid-flight is judged on what preflight saw.
  const live = clone(FIXTURE.assets);
  const p3 = A.verifyAssets(live);
  live[wav].bytes = 1; live[wav].storage.data = 'QUJD';
  const r3 = await p3;
  assert.strictEqual(r3.ok, true, 'payload strings captured at preflight are what get verified: ' + JSON.stringify(r3.errors));
});

// ---------- Codex S2 second review: aggregate-limit gap (5 October 2026) ----------
test('review 4: an already-over-budget table is refused even for a duplicate, before any hashing', async () => {
  const table = deepFreeze(clone(FIXTURE.assets));           // 3 assets, 782 bytes, 1048 chars
  const wav = wavIds[0];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const meta = { kind: 'audio', name: 'dup.wav', mime: 'audio/wav', origin: 'original-file' };
  for (const limits of [{ maxTotalBytes: 781 }, { maxEncodedChars: 1047 }, { maxAssetCount: 2 }]) {
    const before = digestCalls;
    const r = await A.addAssetBytes(table, original, meta, { limits });
    assert.strictEqual(r.ok, false, JSON.stringify(limits) + ' -> ' + JSON.stringify(r));
    assert.strictEqual(r.code, 'limit');
    assert.ok(r.error.includes(Object.keys(limits)[0]), r.error);
    assert.strictEqual(digestCalls, before, 'digest must not run for ' + JSON.stringify(limits));
  }
  // Exactly at the limits the duplicate still succeeds (kept from review 1).
  const ok = await A.addAssetBytes(table, original, meta, { limits: { maxTotalBytes: 782, maxEncodedChars: 1048, maxAssetCount: 3 } });
  assert.strictEqual(ok.ok, true); assert.strictEqual(ok.deduplicated, true);
  assert.deepStrictEqual(clone(table), FIXTURE.assets);
});

test('review 5: entries added to the live table while the promise is pending cannot bypass the limits', async () => {
  const live = clone(FIXTURE.assets);                          // deliberately not frozen
  const fresh = bytesOf('ten bytes!');                           // 10 new bytes
  const meta = { kind: 'audio', name: 'fresh.wav', mime: 'audio/wav', origin: 'original-file' };
  const limits = { maxTotalBytes: 792, maxEncodedChars: 1064, maxAssetCount: 4 };
  const p = A.addAssetBytes(live, fresh, meta, { limits });
  // Synchronously, before hashing settles: someone else grows the table past the budget.
  const intruderBytes = new Uint8Array(100).fill(9);
  const intruderId = sha(intruderBytes);
  live[intruderId] = { kind: 'audio', name: 'intruder.wav', mime: 'audio/wav', bytes: 100, origin: 'original-file', storage: { kind: 'inline-base64', data: A.encodeBase64(intruderBytes) } };
  const r = await p;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.deduplicated, false);
  const m = A.measureAssets(r.assets);
  assert.strictEqual(m.ok, true);
  assert.ok(m.projectedBytes <= limits.maxTotalBytes, 'total ' + m.projectedBytes + ' > ' + limits.maxTotalBytes);
  assert.ok(m.encodedChars <= limits.maxEncodedChars, 'chars ' + m.encodedChars);
  assert.ok(m.count <= limits.maxAssetCount, 'count ' + m.count);
  assert.strictEqual(Object.keys(r.assets).length, 4);
  assert.ok(!(intruderId in r.assets), 'result is derived from the table as it was when called');
  assert.strictEqual((await A.verifyAssets(r.assets)).ok, true);
  // Duplicate path: a stored payload swapped mid-flight does not change the verdict reached on the snapshot.
  const live2 = clone(FIXTURE.assets);
  const wav = wavIds[0];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const p2 = A.addAssetBytes(live2, original, { kind: 'audio', name: 'd.wav', mime: 'audio/wav', origin: 'original-file' });
  live2[wav].storage.data = FIXTURE.assets[wavIds[1]].storage.data;
  const r2 = await p2;
  assert.strictEqual(r2.ok, true, JSON.stringify(r2)); assert.strictEqual(r2.deduplicated, true);
  assert.strictEqual(r2.asset.storage.data, FIXTURE.assets[wav].storage.data, 'returned asset is the snapshot entry');
  assert.deepStrictEqual(r2.assets, FIXTURE.assets, 'returned table is the snapshot too, not the live table with the corrupt payload');
  assert.strictEqual((await A.verifyAssets(r2.assets)).ok, true);
});

// ---------- Codex S2 third review: no live references in results (5 October 2026) ----------
// Every successful addAssetBytes result must stand on its own: the whole returned table verifies,
// the convenience asset agrees with the table, and the table satisfies every supplied limit.
async function checkResult(r, limits, label) {
  assert.strictEqual(r.ok, true, label + ': ' + JSON.stringify(r).slice(0, 300));
  const v = await A.verifyAssets(r.assets);
  assert.strictEqual(v.ok, true, label + ': result table must verify: ' + JSON.stringify(v.errors));
  assert.deepStrictEqual(r.asset, r.assets[r.id], label + ': result.asset must agree with result.assets[result.id]');
  if (limits) {
    const m = A.measureAssets(r.assets);
    if ('maxTotalBytes' in limits) assert.ok(m.projectedBytes <= limits.maxTotalBytes, label + ': total ' + m.projectedBytes);
    if ('maxEncodedChars' in limits) assert.ok(m.encodedChars <= limits.maxEncodedChars, label + ': chars ' + m.encodedChars);
    if ('maxAssetCount' in limits) assert.ok(m.count <= limits.maxAssetCount, label + ': count ' + m.count);
    if ('maxAssetBytes' in limits) for (const a of Object.values(r.assets)) assert.ok(a.bytes <= limits.maxAssetBytes, label + ': asset ' + a.bytes);
  }
  return v;
}
const LIM = { maxTotalBytes: 2000, maxEncodedChars: 2800, maxAssetCount: 5, maxAssetBytes: 700 };

test('review 6 (duplicate path): live-table changes while hashing do not reach the returned table', async () => {
  const wav = wavIds[0], other = wavIds[1];
  const original = A.decodeBase64Strict(FIXTURE.assets[wav].storage.data).bytes;
  const meta = { kind: 'audio', name: 'd.wav', mime: 'audio/wav', origin: 'original-file' };
  // (a) payload and declared size of an existing entry rewritten mid-flight
  let live = clone(FIXTURE.assets);
  let p = A.addAssetBytes(live, original, meta, { limits: LIM });
  live[wav].storage.data = FIXTURE.assets[other].storage.data;      // corrupt the entry being deduplicated
  live[other].bytes = 1; live[other].storage.data = 'QUJD';          // and break a bystander
  let r = await p;
  await checkResult(r, LIM, 'dup/payload-swap');
  assert.strictEqual(r.deduplicated, true); assert.strictEqual(r.id, wav);
  assert.deepStrictEqual(r.assets, FIXTURE.assets, 'returned table is the table as it was when called');
  // (b) keys added and deleted mid-flight
  live = clone(FIXTURE.assets);
  p = A.addAssetBytes(live, original, meta, { limits: LIM });
  const intruder = new Uint8Array(100).fill(9); const intruderId = sha(intruder);
  live[intruderId] = { kind: 'audio', name: 'intruder.wav', mime: 'audio/wav', bytes: 100, origin: 'original-file', storage: { kind: 'inline-base64', data: A.encodeBase64(intruder) } };
  delete live[bundleId];
  r = await p;
  await checkResult(r, LIM, 'dup/keys');
  assert.strictEqual(r.deduplicated, true);
  assert.deepStrictEqual(r.assets, FIXTURE.assets);
  assert.ok(!(intruderId in r.assets) && (bundleId in r.assets));
  // (c) nested storage object replaced wholesale
  live = clone(FIXTURE.assets);
  p = A.addAssetBytes(live, original, meta);
  live[wav].storage = { kind: 'file', data: 7 };
  r = await p;
  await checkResult(r, null, 'dup/storage-replaced');
  assert.deepStrictEqual(r.assets, FIXTURE.assets);
});

test('review 7 (new-entry path): live-table changes while hashing do not reach the returned table', async () => {
  const wav = wavIds[0], other = wavIds[1];
  const fresh = bytesOf('ten bytes!');
  const freshId = sha(Buffer.from('ten bytes!'));
  const meta = { kind: 'audio', name: 'fresh.wav', mime: 'audio/wav', origin: 'original-file' };
  const expected = clone(FIXTURE.assets);
  expected[freshId] = { kind: 'audio', name: 'fresh.wav', mime: 'audio/wav', bytes: 10, origin: 'original-file', storage: { kind: 'inline-base64', data: Buffer.from('ten bytes!').toString('base64') } };
  // (a) existing entry payload and declared size rewritten mid-flight
  let live = clone(FIXTURE.assets);
  let p = A.addAssetBytes(live, fresh, meta, { limits: LIM });
  live[wav].storage.data = FIXTURE.assets[other].storage.data;
  live[other].bytes = 1; live[other].storage.data = 'QUJD';
  live[bundleId].storage = { kind: 'file', data: 7 };
  let r = await p;
  await checkResult(r, LIM, 'new/payload-swap');
  assert.strictEqual(r.deduplicated, false); assert.strictEqual(r.id, freshId);
  assert.deepStrictEqual(r.assets, expected, 'retained entries are as they were when called');
  // (b) keys added and deleted mid-flight
  live = clone(FIXTURE.assets);
  p = A.addAssetBytes(live, fresh, meta, { limits: LIM });
  const intruder = new Uint8Array(100).fill(9); const intruderId = sha(intruder);
  live[intruderId] = { kind: 'audio', name: 'intruder.wav', mime: 'audio/wav', bytes: 100, origin: 'original-file', storage: { kind: 'inline-base64', data: A.encodeBase64(intruder) } };
  delete live[bundleId];
  r = await p;
  await checkResult(r, LIM, 'new/keys');
  assert.deepStrictEqual(r.assets, expected);
  // (c) the result does not alias the caller's entry objects: later caller edits stay out of it
  live = clone(FIXTURE.assets);
  r = await A.addAssetBytes(live, fresh, meta);
  live[wav].name = 'renamed later'; live[wav].storage.data = 'QUJD';
  assert.deepStrictEqual(r.assets, expected, 'no live entry references in the result');
  await checkResult(r, null, 'new/after-edit');
  // Input immutability still holds when the caller does nothing.
  const frozen = deepFreeze(clone(FIXTURE.assets));
  r = await A.addAssetBytes(frozen, fresh, meta, { limits: LIM });
  await checkResult(r, LIM, 'new/frozen');
  assert.deepStrictEqual(clone(frozen), FIXTURE.assets);
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); passed++; console.log('✔ ' + t.name); }
    catch (e) { failed++; console.log('✘ ' + t.name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
