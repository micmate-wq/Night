/**
 * Weave v0.1 Phase 1 S1 — pure Scene model tests.
 * Run: node tests/test-weave-model.js
 * Mocked/pure only: no DOM, audio, Tauri or native app. Payload hashing and byte
 * verification are S2 and are deliberately NOT checked here (see "S2 boundary").
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const M = require(path.join(__dirname, '..', 'desktop', 'weave-model.js'));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weave-v1-two-scenes.json'), 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('✔ ' + name); }
  catch (e) { failed++; console.log('✘ ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

// Deterministic UUID v4 generator and clock for tests.
let uuidN = 0;
const uuid = () => { const h = (++uuidN).toString(16).padStart(12, '0'); return `00000000-0000-4000-8000-${h}`; };
const now = () => '2026-10-05T20:00:00.000Z';
const OPTS = { uuid, now };

const S = FIXTURE.order.slice();                    // [sc Open water, sc Afterglow]
const T = FIXTURE.threads.map(t => t.id);
const A = Object.keys(FIXTURE.assets);              // [a440 wav, a660 wav, fixture bundle]
const bundleId = A.find(k => FIXTURE.assets[k].kind === 'node-bundle');
const wavIds = A.filter(k => FIXTURE.assets[k].kind === 'audio');

function rejects(mutate, pathPart, msgPart) {
  const d = clone(FIXTURE);
  mutate(d);
  const r = M.validateDocument(d);
  assert.strictEqual(r.ok, false, 'expected rejection');
  if (pathPart || msgPart) {
    assert(r.errors.some(e => (!pathPart || e.path.includes(pathPart)) && (!msgPart || e.message.includes(msgPart))),
      `no error matching path "${pathPart}" / message "${msgPart}". Got: ${JSON.stringify(r.errors.slice(0, 5))}`);
  }
  return r;
}

// ---------------------------------------------------------------- fixture
test('fixture is structurally valid and fits compact v0.1', () => {
  const r = M.validateDocument(FIXTURE);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(M.checkCompactCapacity(FIXTURE), { ok: true, problems: [] });
});

test('fixture IDs follow the grammar', () => {
  assert(M.ID_PATTERNS.weave.test(FIXTURE.id));
  T.forEach(id => assert(M.ID_PATTERNS.thread.test(id)));
  S.forEach(id => assert(M.ID_PATTERNS.scene.test(id)));
  FIXTURE.edges.forEach(e => assert(M.ID_PATTERNS.edge.test(e.id)));
  A.forEach(id => assert(M.ID_PATTERNS.asset.test(id)));
});

// ---------------------------------------------------------------- never throws
test('validator reports (never throws) on malformed, null and wrong-container input', () => {
  const bad = [undefined, null, 0, 42, NaN, '', 'aether_weave', true, [], [FIXTURE], () => {}, {},
    { type: 'aether_weave' }, { type: 'aether_weave', schemaVersion: '1' }, { type: 'aether_project', schemaVersion: 1 }];
  const containers = [
    d => { d.scenes = []; }, d => { d.scenes = null; }, d => { d.threads = {}; }, d => { d.threads = null; },
    d => { d.assets = []; }, d => { d.assets = null; }, d => { d.order = {}; }, d => { d.order = null; },
    d => { d.edges = null; }, d => { d.edges = {}; }, d => { d.edges = [null, 5]; }, d => { d.threads = [null, 'x']; },
    d => { d.tempo = null; }, d => { d.master = []; }, d => { d.writer = 'x'; },
    d => { d.scenes[S[0]] = null; }, d => { d.scenes[S[0]].threadStates = []; }, d => { d.scenes[S[0]].threadStates = null; },
    d => { d.scenes[S[0]].threadStates[T[0]] = null; }, d => { d.scenes[S[0]].threadStates[T[0]].source = null; },
    d => { d.scenes[S[0]].threadStates[T[0]].source.playlist = null; }, d => { d.scenes[S[0]].threadStates[T[0]].source.playlist.items = 'x'; },
    d => { d.scenes[S[0]].threadStates[T[0]].motion.points = null; }, d => { d.scenes[S[0]].threadStates[T[0]].motion.points = [null, 1]; },
    d => { d.scenes[S[0]].threadStates[T[0]].channel.eq = null; }, d => { d.scenes[S[0]].threadStates[T[0]].spatial = 'x'; },
    d => { d.scenes[S[0]].duration = null; }, d => { d.scenes[S[0]].provenance = []; }, d => { d.scenes[S[0]].completeness = null; },
    d => { d.scenes[S[0]].threadStates[T[1]].source.node = null; }, d => { d.scenes[S[0]].threadStates[T[1]].source.node.params = []; },
    d => { d.assets[A[0]] = null; }, d => { d.assets[A[0]].storage = null; }
  ];
  for (const v of bad) {
    const r = M.validateDocument(v);
    assert.strictEqual(r.ok, false); assert(Array.isArray(r.errors) && r.errors.length > 0);
  }
  containers.forEach((mut, i) => {
    const d = clone(FIXTURE); mut(d);
    let r;
    assert.doesNotThrow(() => { r = M.validateDocument(d); }, 'mutation ' + i);
    assert.strictEqual(r.ok, false, 'mutation ' + i + ' should be rejected');
  });
  // Hostile getter: still reported, not thrown.
  const hostile = clone(FIXTURE);
  Object.defineProperty(hostile, 'name', { enumerable: true, get() { throw new Error('boom'); } });
  const r = M.validateDocument(hostile);
  assert.strictEqual(r.ok, false);
});

// ---------------------------------------------------------------- structural rejections
test('rejects: wrong type, newer schema, malformed weave ID, unknown field, ending', () => {
  rejects(d => { d.type = 'aether_project'; }, 'type');
  rejects(d => { d.schemaVersion = 2; }, 'schemaVersion', 'newer');
  rejects(d => { d.id = 'wv_123'; }, 'id');
  rejects(d => { d.id = d.id.toUpperCase(); }, 'id');
  rejects(d => { d.extra = 1; }, 'extra', 'not a known field');
  rejects(d => { d.ending = { policy: 'wrap' }; }, 'ending');
  rejects(d => { d.createdAt = '5 Oct 2026'; }, 'createdAt');
});

test('rejects: asset key syntax, missing and wrong-kind references, unreferenced assets', () => {
  rejects(d => { const a = d.assets[A[0]]; delete d.assets[A[0]]; d.assets['sha256:ABC'] = a; }, 'assets["sha256:ABC"]', 'key');
  rejects(d => { delete d.assets[bundleId]; }, 'bundleAssetId', 'missing asset');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].source.playlist.items[0] = bundleId; }, 'items[0]', 'audio asset');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.node.bundleAssetId = wavIds[0]; }, 'bundleAssetId', 'node-bundle asset');
  rejects(d => { d.assets['sha256:' + 'e'.repeat(64)] = clone(d.assets[wavIds[0]]); }, 'sha256:eeee', 'not referenced');
  rejects(d => { d.assets[wavIds[0]].kind = 'image'; }, 'kind');
  rejects(d => { d.assets[bundleId].origin = 'original-file'; }, 'origin');
  rejects(d => { delete d.assets[bundleId].manifestId; }, 'manifestId', 'required');
  rejects(d => { d.assets[wavIds[0]].storage.kind = 'zip-entry'; }, 'storage.kind');
});

test('rejects: node manifestId/version not matching its bundle; bad param values', () => {
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.node.manifestId = 'com.aether.node.tick-tok'; }, '.node', 'do not match');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.node.version = '9.9.9'; }, '.node', 'do not match');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.node.params.level = 'loud'; }, 'params.level');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.node.params.level = Infinity; }, 'params.level');
});

test('rejects: order and Scene identity problems', () => {
  rejects(d => { d.order.push('sc_00000000-0000-4000-8000-000000000000'); }, 'order[2]', 'missing Scene');
  rejects(d => { d.order.push(d.order[0]); }, 'order[2]', 'twice');
  rejects(d => { d.order.pop(); d.edges = []; }, 'scenes["' + S[1] + '"]', 'not listed');
  rejects(d => { d.scenes[S[0]].id = S[1]; }, '.id', 'equal its key');
  rejects(d => { d.scenes[S[0]].name = ''; }, '.name');
  rejects(d => { d.scenes[S[0]].name = 'x'.repeat(81); }, '.name');
  rejects(d => { d.scenes[S[0]].provenance.fileName = '/Users/matt/a.aether'; }, 'fileName', 'without a path');
});

test('rejects: edges that are missing, duplicated or not adjacent', () => {
  rejects(d => { d.edges = []; }, 'edges', 'missing the edge');
  rejects(d => { d.edges.push(Object.assign(clone(d.edges[0]), { id: 'ed_00000000-0000-4000-8000-0000000000ff' })); }, 'edges[1]', 'duplicates');
  rejects(d => { d.edges[0].to = d.edges[0].from; }, 'edges[0]', 'adjacent');
  rejects(d => { d.edges[0].from = S[1]; d.edges[0].to = S[0]; }, 'edges[0]', 'adjacent');
  rejects(d => { d.edges[0].curve = 'cubic'; }, 'curve');
  rejects(d => { d.edges[0].overlapBeats = -1; }, 'overlapBeats');
});

test('rejects: threads (duplicate ID, colour token) and unknown thread keys', () => {
  rejects(d => { d.threads[1].id = d.threads[0].id; }, 'threads[1].id', 'duplicate');
  rejects(d => { d.threads[0].color = '#FC4037'; }, 'threads[0].color');
  rejects(d => { d.scenes[S[0]].threadStates['th_00000000-0000-4000-8000-000000000000'] = clone(d.scenes[S[0]].threadStates[T[0]]); }, 'th_00000000', 'unknown thread');
});

test('rejects: duplicate slot, slot range, source-kind mixing, override misuse', () => {
  rejects(d => { d.scenes[S[1]].threadStates[T[3]].slot = 0; }, '.slot', 'already used');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].slot = 4; }, '.slot');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.playlist = { items: [wavIds[0]], index: 0, shuffle: false, repeat: true }; }, 'source.playlist', 'not a known field');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].source.kind = 'sample'; }, 'source');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].source.override = { assetId: wavIds[0], reason: 'derived-buffer' }; }, 'override', 'only allowed on playlist');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].source.override = { assetId: wavIds[0], reason: 'nicer' }; }, 'override.reason');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].source.kind = 'tape'; }, 'source.kind');
});

test('rejects: numeric ranges and non-finite values', () => {
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].spatial.x = NaN; }, 'spatial.x');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].spatial.y = 1.5; }, 'spatial.y');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].spatial.z = 51; }, 'spatial.z');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].channel.gainDb = 7; }, 'gainDb');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].channel.eq.mid = -16; }, 'eq.mid');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.speed = 0; }, 'motion.speed');
  rejects(d => { d.tempo.bpm = 500; }, 'tempo.bpm');
  rejects(d => { d.tempo.beatsPerBar = 3.5; }, 'tempo.beatsPerBar');
  rejects(d => { d.master.volume = 1.1; }, 'master.volume');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].source.playlist.index = 2; }, 'playlist.index');
});

test('rejects: duration (positive, beats only; reserved modes named as reserved)', () => {
  rejects(d => { d.scenes[S[0]].duration.beats = 0; }, 'duration.beats');
  rejects(d => { d.scenes[S[0]].duration = { mode: 'source', threadId: T[0] }; }, 'duration.mode', 'reserved');
  rejects(d => { d.scenes[S[0]].duration = { mode: 'open' }; }, 'duration.mode', 'reserved');
  rejects(d => { d.scenes[S[0]].duration = { mode: 'seconds', seconds: 10 }; }, 'duration.mode', 'must be "beats"');
});

test('rejects: motion points that go backwards or carry unknown fields; unknown unsupported codes', () => {
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.points[1].t = -0.5; }, 'points[1].t');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.points[2].t = 0.25; }, 'points[2].t', 'backwards');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.points[0].w = 1; }, 'points[0].w');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.points = d.scenes[S[0]].threadStates[T[0]].motion.points.slice(0, 1); }, 'motion.points');
  rejects(d => { d.scenes[S[0]].threadStates[T[0]].motion.timeBase = 'beats'; }, 'timeBase');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].unsupported.push('everything'); }, 'unsupported[1]');
  rejects(d => { d.scenes[S[0]].threadStates[T[1]].unsupported.push('node-private-state'); }, 'unsupported[1]', 'twice');
});

// ---------------------------------------------------------------- S2 boundary
test('S2 boundary: S1 does not verify payload bytes or hashes', () => {
  const d = clone(FIXTURE);
  d.assets[wavIds[0]].storage.data = 'not base64 and wrong hash';
  d.assets[wavIds[0]].bytes = 3;
  assert.strictEqual(M.validateDocument(d).ok, true, 'payload/hash checks belong to S2');
});

// ---------------------------------------------------------------- legacy optional fields
test('optional legacy z / generatedReturn / captureBpm are accepted and kept exactly', () => {
  const t4 = FIXTURE.scenes[S[1]].threadStates[T[3]];
  assert.strictEqual('z' in t4.spatial, false, 'fixture T4 has no z');
  const pts = FIXTURE.scenes[S[0]].threadStates[T[0]].motion.points;
  assert.strictEqual(pts[2].generatedReturn, true);
  assert.strictEqual('z' in pts[0], true);
  const d = clone(FIXTURE);
  delete d.scenes[S[0]].threadStates[T[0]].motion.captureBpm;
  delete d.scenes[S[0]].threadStates[T[0]].motion.points[1].z;
  assert.strictEqual(M.validateDocument(d).ok, true);
  // A command elsewhere in the document leaves these exactly as they were.
  const r = M.renameScene(d, S[1], 'Renamed', OPTS);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.doc.scenes[S[0]].threadStates[T[0]].motion, d.scenes[S[0]].threadStates[T[0]].motion);
  assert.strictEqual('captureBpm' in r.doc.scenes[S[0]].threadStates[T[0]].motion, false);
  assert.strictEqual('z' in r.doc.scenes[S[0]].threadStates[T[0]].motion.points[1], false);
  assert.strictEqual('z' in r.doc.scenes[S[1]].threadStates[T[3]].spatial, false);
});

// ---------------------------------------------------------------- compact capacity
test('compact capacity is separate from validity', () => {
  // Five threads, five active in one Scene: valid document, not compact-playable.
  const d = clone(FIXTURE);
  const extra = 'th_00000000-0000-4000-8000-0000000000aa';
  d.threads.push({ id: extra, label: 'T5', color: 'track-1' });
  const st = d.scenes[S[0]].threadStates;
  st[T[2]] = Object.assign(clone(st[T[0]]), { slot: 2 });
  st[T[3]] = Object.assign(clone(st[T[1]]), { slot: 3 });
  st[extra] = clone(st[T[1]]); delete st[extra].slot;
  assert.strictEqual(M.validateDocument(d).ok, true);
  const cap = M.checkCompactCapacity(d);
  assert.strictEqual(cap.ok, false);
  const codes = cap.problems.map(p => p.code);
  assert(codes.includes('too-many-threads'));
  assert(codes.includes('slot-missing'));

  const d2 = clone(FIXTURE);
  d2.scenes[S[0]].threadStates[T[1]].slot = 2;                  // track-2 colour in slot 2
  assert.strictEqual(M.validateDocument(d2).ok, true);
  assert(M.checkCompactCapacity(d2).problems.some(p => p.code === 'colour-slot-mismatch'));

  const d3 = clone(FIXTURE); d3.tempo.bpm = 96;
  assert.strictEqual(M.validateDocument(d3).ok, true);
  assert(M.checkCompactCapacity(d3).problems.some(p => p.code === 'tempo-not-playable'));

  assert.strictEqual(M.checkCompactCapacity(null).ok, false);
});

// ---------------------------------------------------------------- IDs and creation
test('newId: grammar, injected generator, bad prefix/generator refused', () => {
  const id = M.newId('sc');
  assert(M.ID_PATTERNS.scene.test(id), id);
  assert.notStrictEqual(M.newId('sc'), id);
  assert.strictEqual(M.newId('th', { uuid: () => '00000000-0000-4000-8000-000000000001' }), 'th_00000000-0000-4000-8000-000000000001');
  assert.throws(() => M.newId('xx'));
  assert.throws(() => M.newId('sc', { uuid: () => 'not-a-uuid' }));
});

test('createWeave: valid, empty, four colour-token threads, no ending', () => {
  const w = M.createWeave(Object.assign({ name: 'New' }, OPTS));
  assert.strictEqual(M.validateDocument(w).ok, true);
  assert.strictEqual(w.threads.length, 4);
  assert.deepStrictEqual(w.threads.map(t => t.color), ['track-1', 'track-2', 'track-3', 'track-4']);
  assert.deepStrictEqual([w.order, w.edges, w.scenes, w.assets], [[], [], {}, {}]);
  assert.strictEqual(w.ending, null);
  assert.deepStrictEqual(w.tempo, { bpm: 120, beatsPerBar: 4, source: 'host-fixed' });
});

// ---------------------------------------------------------------- commands
function threeSceneDoc() {
  let d = clone(FIXTURE);
  const r = M.addScene(d, { name: 'Third', threadStates: { [T[0]]: clone(FIXTURE.scenes[S[1]].threadStates[T[0]]) } }, OPTS);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors || r.error));
  return { doc: r.doc, C: r.id };
}

test('commands never mutate their input (deep-frozen input works)', () => {
  const frozen = deepFreeze(clone(FIXTURE));
  const before = JSON.stringify(frozen);
  const results = [
    M.renameScene(frozen, S[0], 'X', OPTS), M.setDuration(frozen, S[0], { mode: 'beats', beats: 16 }, OPTS),
    M.duplicateScene(frozen, S[0], OPTS), M.moveScene(frozen, S[1], 0, OPTS), M.deleteScene(frozen, S[1], OPTS),
    M.addScene(frozen, { name: 'N', threadStates: {} }, OPTS)
  ];
  results.forEach(r => assert.strictEqual(r.ok, true, JSON.stringify(r.error || r.errors)));
  assert.strictEqual(JSON.stringify(frozen), before);
  results.forEach(r => assert.strictEqual(M.validateDocument(r.doc).ok, true));
});

test('commands refuse invalid input documents and bad arguments without throwing', () => {
  for (const bad of [null, {}, [], 'x']) {
    assert.strictEqual(M.renameScene(bad, S[0], 'x').ok, false);
    assert.strictEqual(M.addScene(bad, { name: 'x', threadStates: {} }).ok, false);
  }
  assert.strictEqual(M.renameScene(FIXTURE, 'sc_nope', 'x').ok, false);
  assert.strictEqual(M.renameScene(FIXTURE, S[0], '').ok, false);
  assert.strictEqual(M.addScene(FIXTURE, null, OPTS).ok, false);
  assert.strictEqual(M.addScene(FIXTURE, { name: 'x' }, OPTS).ok, false);
  assert.strictEqual(M.addScene(FIXTURE, { name: 'x', threadStates: {} }, Object.assign({ index: 9 }, OPTS)).ok, false);
  const bad = M.addScene(FIXTURE, { name: 'x', threadStates: { [T[0]]: { slot: 0 } } }, OPTS);
  assert.strictEqual(bad.ok, false); assert(bad.errors.length > 0);
  assert.strictEqual(M.moveScene(FIXTURE, S[0], 5, OPTS).ok, false);
});

test('addScene: new ID, inserted in order, default edge for the new pair, old edge kept', () => {
  const { doc, C } = threeSceneDoc();
  assert(M.ID_PATTERNS.scene.test(C));
  assert.deepStrictEqual(doc.order, [S[0], S[1], C]);
  assert.strictEqual(doc.edges.length, 2);
  assert.strictEqual(doc.edges[0].id, FIXTURE.edges[0].id, 'existing pair keeps its edge');
  assert.deepStrictEqual({ ...doc.edges[1], id: undefined }, { id: undefined, from: S[1], to: C, ...M.DEFAULT_EDGE });
  // Inserting at the front.
  const r = M.addScene(FIXTURE, { name: 'Front', threadStates: {} }, Object.assign({ index: 0 }, OPTS));
  assert.deepStrictEqual(r.doc.order.slice(1), S);
  assert.strictEqual(r.doc.edges.find(e => e.from === S[0]).id, FIXTURE.edges[0].id);
});

test('addScene merges caller-supplied assets; conflicting content for one ID is refused', () => {
  const id = 'sha256:' + '1'.repeat(64);
  const asset = { kind: 'audio', name: 'x.wav', mime: 'audio/wav', bytes: 1, origin: 'original-file', storage: { kind: 'inline-base64', data: 'AA==' } };
  const st = { slot: 2, source: { kind: 'sample', sample: { assetId: id } }, channel: clone(FIXTURE.scenes[S[0]].threadStates[T[0]].channel), spatial: { x: 0.5, y: 0.5 }, motion: null, unsupported: [] };
  const r = M.addScene(FIXTURE, { name: 'With asset', threadStates: { [T[2]]: st } }, Object.assign({ assets: { [id]: asset } }, OPTS));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert(r.doc.assets[id]);
  const conflict = M.addScene(r.doc, { name: 'Again', threadStates: { [T[2]]: st } }, Object.assign({ assets: { [id]: Object.assign({}, asset, { name: 'other.wav' }) } }, OPTS));
  assert.strictEqual(conflict.ok, false);
  // Without the asset, the reference is refused (missing asset).
  assert.strictEqual(M.addScene(FIXTURE, { name: 'No asset', threadStates: { [T[2]]: st } }, OPTS).ok, false);
});

test('duplicateScene: new ID after the original, references unchanged, edges by pair', () => {
  const r = M.duplicateScene(FIXTURE, S[0], OPTS);
  assert.strictEqual(r.ok, true);
  const D = r.id;
  assert(M.ID_PATTERNS.scene.test(D) && !S.includes(D));
  assert.deepStrictEqual(r.doc.order, [S[0], D, S[1]]);
  assert.deepStrictEqual(r.doc.scenes[D].threadStates, FIXTURE.scenes[S[0]].threadStates);
  assert.strictEqual(r.doc.scenes[D].name, 'Open water copy');
  assert.deepStrictEqual(Object.keys(r.doc.assets).sort(), A.slice().sort(), 'no assets copied or added');
  T.forEach((t, i) => assert.strictEqual(r.doc.threads[i].id, t));
  assert.deepStrictEqual(r.doc.edges.map(e => [e.from, e.to]), [[S[0], D], [D, S[1]]]);
  assert(!r.doc.edges.some(e => e.id === FIXTURE.edges[0].id), 'old S0>S1 pair no longer adjacent');
  assert.deepStrictEqual(r.doc.scenes[S[0]], FIXTURE.scenes[S[0]], 'original untouched');
});

test('moveScene: all IDs kept, edges re-derived by pair (adjacent pairs keep their edge ID)', () => {
  const { doc, C } = threeSceneDoc();                    // A,B,C with edges AB, BC
  const ab = doc.edges[0].id, bc = doc.edges[1].id;
  const r = M.moveScene(doc, C, 0, OPTS);                // C,A,B
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.doc.order, [C, S[0], S[1]]);
  assert.deepStrictEqual(Object.keys(r.doc.scenes).sort(), Object.keys(doc.scenes).sort());
  assert.strictEqual(r.doc.edges.find(e => e.from === S[0] && e.to === S[1]).id, ab, 'AB kept');
  assert(!r.doc.edges.some(e => e.id === bc), 'BC dropped');
  assert.strictEqual(r.doc.edges.length, 2);
  // Moving back restores order; AB edge still the same ID, a new BC edge is created.
  const back = M.moveScene(r.doc, C, 2, OPTS);
  assert.deepStrictEqual(back.doc.order, [S[0], S[1], C]);
  assert.strictEqual(back.doc.edges[0].id, ab);
});

test('deleteScene: guards, survivor IDs, edges, pruning of assets only that Scene used', () => {
  const only = M.addScene(M.createWeave(OPTS), { name: 'Solo', threadStates: {} }, OPTS);
  assert.strictEqual(M.deleteScene(only.doc, only.id, OPTS).ok, false, 'only Scene');
  assert.strictEqual(M.deleteScene(FIXTURE, S[0], Object.assign({ protectedId: S[0] }, OPTS)).ok, false, 'protected');
  assert.strictEqual(M.deleteScene(FIXTURE, 'sc_00000000-0000-4000-8000-000000000000', OPTS).ok, false, 'unknown');

  const { doc, C } = threeSceneDoc();
  const r = M.deleteScene(doc, S[1], OPTS);                   // A, C
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.doc.order, [S[0], C]);
  assert.deepStrictEqual(r.doc.scenes[S[0]], doc.scenes[S[0]]);
  assert.deepStrictEqual(r.doc.scenes[C], doc.scenes[C]);
  assert.deepStrictEqual(r.doc.edges.map(e => [e.from, e.to]), [[S[0], C]]);
  // Bundle still used by Scene A; both WAVs still used by A's playlist: nothing pruned.
  assert.deepStrictEqual(r.removedAssets, []);
  // Remove the only remaining user of the bundle: it is pruned.
  const r2 = M.deleteScene(r.doc, S[0], OPTS);
  assert.deepStrictEqual(r2.removedAssets, [bundleId]);
  assert.strictEqual(M.validateDocument(r2.doc).ok, true);
});

test('renameScene / setDuration: bounds, reserved modes refused with a clear reason', () => {
  const r = M.renameScene(FIXTURE, S[0], 'Deep water', OPTS);
  assert.strictEqual(r.doc.scenes[S[0]].name, 'Deep water');
  assert.strictEqual(r.doc.scenes[S[0]].modifiedAt, now());
  assert.strictEqual(M.renameScene(FIXTURE, S[0], 'x'.repeat(81), OPTS).ok, false);
  const d = M.setDuration(FIXTURE, S[0], { mode: 'beats', beats: 16 }, OPTS);
  assert.deepStrictEqual(d.doc.scenes[S[0]].duration, { mode: 'beats', beats: 16 });
  const res = M.setDuration(FIXTURE, S[0], { mode: 'open' }, OPTS);
  assert.strictEqual(res.ok, false); assert(/reserved/.test(res.error));
  assert.strictEqual(M.setDuration(FIXTURE, S[0], { mode: 'beats', beats: 0 }, OPTS).ok, false);
});

// ---------------------------------------------------------------- migration
function legacySession() {
  return {
    version: '3.1', type: 'aether_project', name: 'Untitled Project', timestamp: '2026-10-04T18:52:05.559Z',
    masterVolume: 0.8, loudnessDb: 0,
    tracks: [
      { index: 0, name: 'T1', sampleName: 'p0-tone-220.wav', filePath: '', sampleData: 'UklGRg==',
        playlist: [{ name: 'p0-tone-220.wav', type: 'audio/wav', data: 'UklGRg==' }], playlistIndex: 0, isShuffle: false, isRepeat: true,
        isCustomNode: false, customNodeBundle: null, customNodeParams: null, customNodeZipBase64: null, isLiveIn: false,
        x: 0.2138, y: 0.8696, z: 0, isMuted: false, isSoloed: false, motionSpeed: 1,
        motionPath: [{ t: 0, x: 0.2138, y: 0.8696, z: 0 }, { t: 0.058, x: 0.2588, y: 0.7716 },
          { generatedReturn: true, t: 30.207, x: 0.2138, y: 0.8696, z: 0 }],
        eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0, isStream: false },
      { index: 1, name: 'T2', isCustomNode: true, customNodeZipBase64: 'UEs=', sampleData: null, playlist: [],
        customNodeBundle: { file_path: '/Users/matt/x/tick-tok.aethernode', manifest: { id: 'com.aether.node.tick-tok', version: '2.0.0' } },
        customNodeParams: { bpm: 120, pattern: 0.22, talk: 0.62 }, x: 0.25, y: 0.5, z: 0, isMuted: false, isSoloed: false,
        motionSpeed: 1, motionPath: [], eq: { low: 0, mid: 2, high: -1 }, stripGainDb: -3 },
      { index: 2, name: 'T3', isCustomNode: true, customNodeZipBase64: 'UEs=', playlist: [],
        customNodeBundle: { manifest: { id: 'com.aether.node.tick-tok', version: '2.0.0' } },
        customNodeParams: { bpm: 120, pattern: 0.22, talk: 0.98 }, x: 0.75, y: 0.5, isMuted: false, isSoloed: true,
        motionSpeed: 1, motionPath: [], eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0 },
      { index: 3, name: 'T4', playlist: [], x: 0.75, y: 0.5, z: 0, isMuted: true, isSoloed: false, motionSpeed: 1, motionPath: [],
        eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0 }
    ]
  };
}

test('sceneFromAetherState: caller-supplied IDs, verbatim motion, kept derived buffer, unsupported codes', () => {
  const w = M.createWeave(OPTS);
  const wav = 'sha256:' + 'a'.repeat(64), buf = 'sha256:' + 'b'.repeat(64), tick = 'sha256:' + 'c'.repeat(64);
  const session = legacySession();
  const before = JSON.stringify(session);
  const m = M.sceneFromAetherState(session, {
    threadIds: w.threads.map(t => t.id), fileName: 'p0-roundtrip.aether', now,
    assetIds: { 0: { playlist: [wav], override: buf }, 1: { bundle: tick }, 2: { bundle: tick } }
  });
  assert.strictEqual(m.ok, true, m.error);
  assert.strictEqual(JSON.stringify(session), before, 'session not mutated');
  const ts = m.scene.threadStates;
  const [t1, t2, t3, t4] = w.threads.map(t => ts[t.id]);
  assert.deepStrictEqual(t1.source, { kind: 'playlist', playlist: { items: [wav], index: 0, shuffle: false, repeat: true }, override: { assetId: buf, reason: 'derived-buffer' } });
  assert.deepStrictEqual(t1.motion.points, session.tracks[0].motionPath, 'motion points verbatim (incl. missing z, generatedReturn)');
  assert.strictEqual('z' in t1.motion.points[1], false);
  assert.strictEqual('captureBpm' in t1.motion, false, 'no invented captureBpm');
  assert.deepStrictEqual(t1.unsupported, ['motion-free-time']);
  assert.deepStrictEqual(t2.source.node, { bundleAssetId: tick, manifestId: 'com.aether.node.tick-tok', version: '2.0.0', params: { bpm: 120, pattern: 0.22, talk: 0.62 } });
  assert.deepStrictEqual(t2.channel, { gainDb: -3, eq: { low: 0, mid: 2, high: -1 }, mute: false, solo: false });
  assert.deepStrictEqual(t2.unsupported, ['node-private-state']);
  assert.strictEqual('z' in t3.spatial, false, 'absent legacy z stays absent');
  assert.strictEqual(t3.channel.solo, true);
  assert.deepStrictEqual(t4.source, { kind: 'empty' });
  assert.deepStrictEqual([t1.slot, t2.slot, t3.slot, t4.slot], [0, 1, 2, 3]);
  assert.strictEqual(JSON.stringify(m.scene).includes('/Users/'), false, 'no local path carried over');
  assert.deepStrictEqual(m.scene.provenance, { kind: 'import-aether', capturedAt: now(), fileName: 'p0-roundtrip.aether' });

  // Insert with caller-supplied assets: one bundle asset referenced by two threads.
  const mk = (kind, extra) => Object.assign({ kind, name: 'n', mime: 'application/octet-stream', bytes: 1, storage: { kind: 'inline-base64', data: 'AA==' } }, extra);
  const r = M.addScene(w, m.scene, Object.assign({ assets: {
    [wav]: mk('audio', { origin: 'original-file' }), [buf]: mk('audio', { origin: 'rendered-buffer' }),
    [tick]: mk('node-bundle', { origin: 'aethernode-zip', manifestId: 'com.aether.node.tick-tok', version: '2.0.0' })
  } }, OPTS));
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(Object.values(r.doc.assets).filter(a => a.kind === 'node-bundle').length, 1);
  assert.strictEqual(M.checkCompactCapacity(r.doc).ok, true);
});

test('sceneFromAetherState: missing caller IDs and malformed sessions are errors, not throws', () => {
  const ids = M.createWeave(OPTS).threads.map(t => t.id);
  const s = legacySession();
  const noOverride = M.sceneFromAetherState(s, { threadIds: ids, assetIds: { 0: { playlist: ['sha256:' + 'a'.repeat(64)] }, 1: { bundle: 'x' }, 2: { bundle: 'x' } } });
  assert.strictEqual(noOverride.ok, false); assert(/override/.test(noOverride.error));
  const proved = M.sceneFromAetherState(s, { threadIds: ids, assetIds: { 0: { playlist: ['p'], sampleEqualsSelectedItem: true }, 1: { bundle: 'x' }, 2: { bundle: 'x' } } });
  assert.strictEqual(proved.ok, true);
  assert.strictEqual('override' in proved.scene.threadStates[ids[0]].source, false);
  assert.strictEqual(M.sceneFromAetherState(s, { threadIds: ids, assetIds: {} }).ok, false);
  for (const bad of [null, 5, [], {}, { tracks: null }, { tracks: [] }, { tracks: [1, 2, 3, 4, 5] }, { type: 'aether_weave', tracks: [{}] },
    { tracks: [{ index: 0 }, { index: 0 }] }, { tracks: [{ index: 7 }] }, { tracks: [null] }]) {
    let r; assert.doesNotThrow(() => { r = M.sceneFromAetherState(bad, { threadIds: ids }); });
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
  }
  assert.strictEqual(M.sceneFromAetherState(s, null).ok, false);
});

// ---------------------------------------------------------------- view derivation
test('deriveView matches WeaveEngine.onNodeDragEnd formulas; absent slots are empty', () => {
  // Formula as written in weave.js onNodeDragEnd (levels = y; positions = (v - 0.5) * 2).
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'weave.js'), 'utf8');
  assert(src.includes('scene.levels = [tracks[0].y, tracks[1].y, tracks[2].y, tracks[3].y];'));
  assert(src.includes('(tracks[k].x - 0.5) * 2.0'));
  const v1 = M.deriveView(FIXTURE.scenes[S[0]], FIXTURE.threads);
  assert.deepStrictEqual(v1.levels, [0.87, 0.5, 0, 0]);
  assert.deepStrictEqual(v1.positions[0], [(0.21 - 0.5) * 2.0, (0.87 - 0.5) * 2.0]);
  assert.deepStrictEqual(v1.positions[1], [(0.25 - 0.5) * 2.0, (0.5 - 0.5) * 2.0]);
  assert.deepStrictEqual(v1.positions.slice(2), [null, null]);
  const v2 = M.deriveView(FIXTURE.scenes[S[1]], FIXTURE.threads);
  assert.deepStrictEqual(v2.levels, [0.3, 0, 0, 0.4]);
  // Slotless thread state falls back to its colour token's slot.
  const sc = clone(FIXTURE.scenes[S[1]]); delete sc.threadStates[T[3]].slot;
  assert.deepStrictEqual(M.deriveView(sc, FIXTURE.threads).levels, [0.3, 0, 0, 0.4]);
  assert.deepStrictEqual(M.deriveView(null, null), { levels: [0, 0, 0, 0], positions: [null, null, null, null] });
});

// ---------------------------------------------------------------- migration guards (Codex S1 review corrections)
function oneTrackSession(track) {
  return { version: '3.1', type: 'aether_project', name: 'One', tracks: [Object.assign({ index: 0, x: 0.5, y: 0.5, z: 0, motionPath: [], eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0 }, track)] };
}
function emptyTracksSession(n) {
  const tracks = [];
  for (let i = 0; i < n; i++) tracks.push({ index: i, playlist: [], x: 0.2 + i * 0.1, y: 0.5, motionPath: [], eq: { low: 0, mid: 0, high: 0 }, stripGainDb: 0 });
  return { version: '3.1', type: 'aether_project', name: 'Empties', tracks };
}
// Runs every case and reports all mismatches together, so a failure lists each broken case.
function expectCases(cases) {
  const wrong = [];
  for (const c of cases) {
    const session = deepFreeze(c.session);
    const ctx = deepFreeze(c.ctx);
    const before = JSON.stringify([session, ctx]);
    let r;
    try { r = M.sceneFromAetherState(session, ctx); } catch (e) { wrong.push(c.name + ': threw ' + e.message); continue; }
    if (JSON.stringify([session, ctx]) !== before) wrong.push(c.name + ': input changed');
    if (!r || r.ok !== c.ok) { wrong.push(c.name + ': expected ok=' + c.ok + ', got ' + JSON.stringify(r && (r.ok ? { ok: true, states: Object.keys(r.scene.threadStates).length } : r))); continue; }
    if (c.check) { try { c.check(r); } catch (e) { wrong.push(c.name + ': ' + e.message); } }
  }
  if (wrong.length) console.log(wrong.map(w => '    - ' + w).join('\n'));
  assert.deepStrictEqual(wrong, []);
}
const TH = (n) => 'th_00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('migration: thread IDs must be valid and distinct (two empty tracks cannot collapse into one)', () => {
  const four = [TH(1), TH(2), TH(3), TH(4)];
  expectCases([
    { name: 'distinct valid IDs', session: emptyTracksSession(2), ctx: { threadIds: four }, ok: true,
      check: (r) => { assert.deepStrictEqual(Object.keys(r.scene.threadStates).sort(), [TH(1), TH(2)]); } },
    { name: 'duplicate ID for tracks 1 and 2', session: emptyTracksSession(2), ctx: { threadIds: [TH(7), TH(7), TH(3), TH(4)] }, ok: false },
    { name: 'duplicate ID for tracks 1 and 4', session: emptyTracksSession(4), ctx: { threadIds: [TH(1), TH(2), TH(3), TH(1)] }, ok: false },
    { name: 'duplicate only in unused slot is fine', session: emptyTracksSession(2), ctx: { threadIds: [TH(1), TH(2), TH(9), TH(9)] }, ok: true },
    { name: 'malformed: th_123', session: emptyTracksSession(1), ctx: { threadIds: ['th_123'] }, ok: false },
    { name: 'malformed: uppercase', session: emptyTracksSession(1), ctx: { threadIds: [TH(1).toUpperCase()] }, ok: false },
    { name: 'malformed: scene prefix', session: emptyTracksSession(1), ctx: { threadIds: [TH(1).replace('th_', 'sc_')] }, ok: false },
    { name: 'malformed: empty string', session: emptyTracksSession(1), ctx: { threadIds: [''] }, ok: false },
    { name: 'malformed: number', session: emptyTracksSession(1), ctx: { threadIds: [42] }, ok: false },
    { name: 'malformed: null', session: emptyTracksSession(1), ctx: { threadIds: [null] }, ok: false },
    { name: 'missing for track 2', session: emptyTracksSession(2), ctx: { threadIds: [TH(1)] }, ok: false }
  ]);
});

test('migration: saved playlist buffer needs a valid override ID or explicit equality proof', () => {
  const WAV = 'sha256:' + 'a'.repeat(64), BUF = 'sha256:' + 'b'.repeat(64);
  const withBuffer = () => oneTrackSession({ sampleData: 'UklGRg==', playlist: [{ name: 'a.wav', type: 'audio/wav', data: 'UklGRg==' }], playlistIndex: 0 });
  const noBuffer = () => oneTrackSession({ playlist: [{ name: 'a.wav', type: 'audio/wav', data: 'UklGRg==' }], playlistIndex: 0 });
  const ctx = (ids) => ({ threadIds: [TH(1)], assetIds: { 0: Object.assign({ playlist: [WAV] }, ids) } });
  const bad = (name, ids, session) => ({ name, session: session || withBuffer(), ctx: ctx(ids), ok: false });
  expectCases([
    bad('override absent', {}),
    bad('override undefined', { override: undefined }),
    bad('override null', { override: null }),
    bad('override false', { override: false }),
    bad('override 0', { override: 0 }),
    bad('override number', { override: 42 }),
    bad('override empty string', { override: '' }),
    bad('override short hash', { override: 'sha256:abc' }),
    bad('override uppercase hash', { override: 'sha256:' + 'A'.repeat(64) }),
    bad('override object', { override: { assetId: BUF } }),
    bad('equality proof as string "true"', { sampleEqualsSelectedItem: 'true' }),
    bad('equality proof as 1', { sampleEqualsSelectedItem: 1 }),
    bad('override null + equality true (malformed override still rejected)', { override: null, sampleEqualsSelectedItem: true }),
    bad('valid override + equality true (contradictory)', { override: BUF, sampleEqualsSelectedItem: true }),
    bad('override supplied but track has no saved buffer', { override: BUF }, noBuffer()),
    { name: 'valid override is kept', session: withBuffer(), ctx: ctx({ override: BUF }), ok: true,
      check: (r) => assert.deepStrictEqual(r.scene.threadStates[TH(1)].source,
        { kind: 'playlist', playlist: { items: [WAV], index: 0, shuffle: false, repeat: true }, override: { assetId: BUF, reason: 'derived-buffer' } }) },
    { name: 'explicit equality proof, no override', session: withBuffer(), ctx: ctx({ sampleEqualsSelectedItem: true }), ok: true,
      check: (r) => assert.strictEqual('override' in r.scene.threadStates[TH(1)].source, false) },
    { name: 'no saved buffer, nothing supplied', session: noBuffer(), ctx: ctx({}), ok: true,
      check: (r) => assert.strictEqual('override' in r.scene.threadStates[TH(1)].source, false) }
  ]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
