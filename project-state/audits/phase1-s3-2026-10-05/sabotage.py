#!/usr/bin/env python3
"""S3 sabotage checks: each case breaks a guard in a SCRATCH COPY of weave-import.js and the suite
must fail. The real files are never touched. Usage: python3 sabotage.py <repo-root> <scratch-dir>"""
import os, shutil, subprocess, sys

repo, scratch = sys.argv[1], sys.argv[2]
CASES = [
    ("skip dedupe accounting (count duplicates as added)",
     "if (r.deduplicated) { tr.deduplicated.push", "if (false) { tr.deduplicated.push"),
    ("equality from a name match instead of S2's byte comparison",
     "if (r.deduplicated && sel !== undefined && r.id === sel) ids.sampleEqualsSelectedItem = true;",
     "if (sel !== undefined && plan.payloads.some(q => q.role === 'playlist' && q.meta.name === pl.meta.name)) ids.sampleEqualsSelectedItem = true;"),
    ("drop all-or-nothing on failure (partial table returned)",
     "if (!r.ok) { r.assets = null; r.perTrack = null; }", "if (!r.ok) { r.assets = r.assets || {}; r.perTrack = r.perTrack || {}; }"),
    ("lose unsupported codes",
     "if (ts && Array.isArray(ts.unsupported)) tr.unsupported = ts.unsupported.slice();", "tr.unsupported = [];"),
    ("keep file_path in the JSON fallback",
     "const BUNDLE_KEYS = ['file_name',", "const BUNDLE_KEYS = ['file_path', 'file_name',"),
    ("store an omitted payload",
     "for (const it of t.playlist) omit('playlist', it.name, it.data);\n    } else if (kind === 'live-input'",
     "for (const it of t.playlist) { const r = add('playlist', 'extra', it.data, { kind: 'audio', name: clip(it.name, 200), mime: 'audio/wav', origin: 'original-file' }, p, 'x'); if (!r.ok) return r; }\n    } else if (kind === 'live-input'"),
    ("apply the legacy master to the document",
     "const r = M.addScene(docSnap, scene, addOpts);", "docSnap.master.volume = prep.snap.masterVolume; const r = M.addScene(docSnap, scene, addOpts);"),
    ("read the live session after the await",
     "const m = M.sceneFromAetherState(sessionForModel(prep.snap), modelCtx);", "const m = M.sceneFromAetherState(session, modelCtx);"),
    ("snapshot the asset table by reference, not by copy",
     "try { table[k] = deepCopy(assets[k]); }", "try { table[k] = assets[k]; }"),
    ("use the caller's document instead of the clone",
     "const r = M.addScene(docSnap, scene, addOpts);", "const r = M.addScene(doc, scene, addOpts);"),
    ("drop the certain-growth preflight",
     "if (!existingLengths.has(pl.projected) && counts.get(pl.projected) === 1)", "if (false)"),
    ("let a path-only source become an empty track",
     "} else if (t.hasFilePath) {\n      return fail('Track ' + (idx + 1) + ': source refers to a file by path only", "} else if (false) {\n      return fail('Track ' + (idx + 1) + ': source refers to a file by path only"),
    ("accept a zip without manifest metadata by inventing it",
     "if (!isStr(t.bundleManifestId, 1, 200) || !isStr(t.bundleManifestVersion, 1, 50)) {",
     "if (!isStr(t.bundleManifestId, 1, 200) || !isStr(t.bundleManifestVersion, 1, 50)) { t.bundleManifestId = t.bundleManifestId || 'unknown'; t.bundleManifestVersion = t.bundleManifestVersion || '0'; } if (false) {"),
    ("report existing assets as verified without verifying",
     "report.existingVerified = true;\n    }", "report.existingVerified = true;\n    }\n    report.existingVerified = true;"),
    ("stage every limit failure as preflight",
     "if (r.code === 'limit') out.stage = stage;", "if (r.code === 'limit') out.stage = 'preflight';"),
    ("treat live-input leftover filePath as path-only",
     "} else if (kind === 'live-input' || kind === 'stream') {", "} else if (kind === 'live-input' || kind === 'stream') {\n      if (t.hasFilePath) return fail('x', 'path-only', p, { track: idx });"),
    # --- review corrections, 5 October (later) ---
    ("default a malformed motionPath to absent instead of refusing",
     "if (!absent(tr.motionPath) && !Array.isArray(tr.motionPath)) return bad('motionPath', 'an array');", "if (!absent(tr.motionPath) && !Array.isArray(tr.motionPath)) tr = Object.assign({}, tr, { motionPath: undefined });"),
    ("treat an empty sampleData string as absent",
     "if (tr[k] === '') return fail(", "if (false) return fail("),
    ("accept a non-object eq by defaulting it",
     "if (!absent(tr.eq) && !isObj(tr.eq)) return bad('eq', 'an object');", "if (!absent(tr.eq) && !isObj(tr.eq)) tr = Object.assign({}, tr, { eq: undefined });"),
    ("let a cyclic session field reject the promise",
     "    try { return snapshotSessionUnsafe(session); }\n    catch (e) {", "    try { return snapshotSessionUnsafe(session); }\n    catch (e) { throw e;"),
    ("let a cyclic table entry reject the promise",
     "catch (e) { if (e instanceof CopyError) return fail('existing asset entry could not be copied: ' + e.message, 'container', 'assets[\"' + k + '\"]'); throw e; }", "catch (e) { throw e; }"),
    ("remove the last-resort guard on importAetherState",
     "    try { return await importAetherStateUnsafe(doc, session, ctx, opts); }\n    catch (e) { return unexpected(); }", "    return await importAetherStateUnsafe(doc, session, ctx, opts);"),
    ("echo an input value in the cyclic-field failure",
     "return fail('session could not be copied: ' + e.message + (e.path ? ' at ' + e.path : ''), 'session'", "return fail('session could not be copied: ' + e.message + ' ' + JSON.stringify(Object.keys(session.tracks[0].eq || {})) + String((session.tracks[0].eq || {}).nested && (session.tracks[0].eq || {}).nested.secretValue), 'session'"),
    ("encode sparse arrays by skipping holes",
     "if (!(i in v)) throw problem('sparse array (hole) cannot be encoded', path + '[' + i + ']');", "if (!(i in v)) continue;"),
    ("encode sparse arrays as empty slots (invalid JSON)",
     "if (!(i in v)) throw problem('sparse array (hole) cannot be encoded', path + '[' + i + ']');", "if (!(i in v)) { parts.push(''); continue; }"),
    ("read the thrown value's name in the last-resort guard",
     "  function unexpected() {\n    return { ok: false, error: 'unexpected internal failure during import', code: 'engine', path: '' };",
     "  function unexpected(e) {\n    return { ok: false, error: 'unexpected internal failure during import (' + (e && e.name) + ')', code: 'engine', path: '' };"),
    ("stringify the thrown value in the last-resort guard",
     "    } catch (e) { r = unexpected(); }", "    } catch (e) { r = unexpected(); r.detail = String(e && e.message); }"),
]

src = os.path.join(repo, 'desktop', 'weave-import.js')
original = open(src, encoding='utf-8').read()
results = []
for name, old, new in CASES:
    if os.path.isdir(scratch): shutil.rmtree(scratch)
    os.makedirs(os.path.join(scratch, 'desktop')); os.makedirs(os.path.join(scratch, 'tests', 'fixtures'))
    for f in ['weave-model.js', 'weave-assets.js']: shutil.copy(os.path.join(repo, 'desktop', f), os.path.join(scratch, 'desktop', f))
    shutil.copy(os.path.join(repo, 'tests', 'test-weave-import.js'), os.path.join(scratch, 'tests'))
    for f in ['weave-v1-two-scenes.json', 'aether-v31-tiny.json']: shutil.copy(os.path.join(repo, 'tests', 'fixtures', f), os.path.join(scratch, 'tests', 'fixtures', f))
    assert original.count(old) == 1, (name, original.count(old))
    open(os.path.join(scratch, 'desktop', 'weave-import.js'), 'w', encoding='utf-8').write(original.replace(old, new))
    p = subprocess.run(['node', os.path.join(scratch, 'tests', 'test-weave-import.js')], capture_output=True, text=True)
    tail = [l for l in p.stdout.splitlines() if 'passed,' in l]
    failing = [l[2:].split(':')[0].strip() for l in p.stdout.splitlines() if l.startswith('✘')]
    caught = p.returncode != 0
    results.append((name, caught, tail[0] if tail else p.stderr.strip().splitlines()[-1:] or 'crash', failing))
    print(('CAUGHT  ' if caught else 'MISSED  ') + name + ' — ' + (tail[0] if tail else 'suite crashed') + (' — failing: ' + ', '.join(failing) if failing else ''))
assert open(src, encoding='utf-8').read() == original, 'real file untouched'
missed = [r for r in results if not r[1]]
print('\n%d sabotage cases, %d caught, %d missed' % (len(results), len(results) - len(missed), len(missed)))
sys.exit(1 if missed else 0)
