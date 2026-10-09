#!/usr/bin/env python3
"""S4 sabotage checks: each case breaks one guard in a SCRATCH COPY of desktop/weave.js or
desktop/index.html and the relevant suite must fail. Real files are never touched.
Usage: python3 sabotage-s4.py <repo-root> <scratch-dir>"""
import os, shutil, subprocess, sys

repo, scratch = sys.argv[1], sys.argv[2]
W, H = 'desktop/weave.js', 'desktop/index.html'
CASES = [
    # (name, file, old, new, suites that must fail)
    ("compose onto the document captured at press instead of the latest one", W,
     "        const doc = this.session.doc;\n        const threadIds = [0, 1, 2, 3].map(k => this._threadIdForSlot(k));",
     "        const doc = doc0;\n        const threadIds = [0, 1, 2, 3].map(k => this._threadIdForSlot(k));", ['test-weave-session']),
    ("skip the pre-commit recheck", W,
     "        const why = this._recheckAgainstPress(press);\n        if (why) return fail('changed', why);", "        const why = null;\n        if (why) return fail('changed', why);", ['test-weave-session']),
    ("recheck ignores the buffer reference", W,
     "          && (t.audioBuffer || null) === p.bufferRef\n", "", ['test-weave-session']),
    ("recheck ignores the session epoch", W,
     "      if (press.epoch !== this.session.epoch) return 'the Weave was replaced during capture';", "", ['test-weave-session']),
    ("bind slots even when the recheck failed", W,
     "        if (why) return fail('changed', why);", "        if (why) { window.studio.tracks.forEach(t => { t._weaveBinding = { stale: true }; }); return fail('changed', why); }", ['test-weave-session']),
    ("origin proof from the live origin instead of the press copy", W,
     "        const o = p.origin;", "        const o = window.studio.tracks[k]._bufferOrigin;", ['test-weave-session']),
    ("drag-end does not require binding.sceneId to equal the edited Scene", W,
     "      return b.sceneId === sceneId;", "      return true;", ['test-weave-session']),
    ("glide gate evaluated only at glide start (not per frame)", W,
     "        if (!this.glideSlotWritable(k, g.sceneId)) { skipped.push(k); return; }", "        if (!this.nodeIsFree(t, k)) { skipped.push(k); return; }", ['test-weave-session']),
    ("delayed Preview ignores its token", W,
     "        if (token !== this._previewToken) return;", "", ['test-weave-session']),
    ("releasing one suspension token releases all", W,
     "      this._suspensions.delete(token);", "      this._suspensions.clear();", ['test-weave-session']),
    ("demo Scenes become adjustable", W,
     "      if (scene.demo) {\n        // D8: the demo set is read-only.", "      if (false) {\n        // D8: the demo set is read-only.", ['test-weave-session']),
    ("a failed capture blocks later captures", W,
     "      this._captureChain = turn.catch(() => {});", "      this._captureChain = turn.then(r => { if (!r.ok) throw new Error('blocked'); });", ['test-weave-session']),
    ("capture provenance labelled as an import", W,
     "        scene.provenance = { kind: 'capture', capturedAt: now() };", "        scene.provenance = { kind: 'import-aether', capturedAt: now() };", ['test-weave-session']),
    ("detach even when nothing was replaced", W,
     "      if (info.replaced && this.session.doc && this.session.doc.order.length > 0) {", "      if (this.session.doc && this.session.doc.order.length > 0) {", ['test-weave-session']),
    # ---- Codex review 2 ----
    ("deletion clamps the playing index instead of re-resolving it by Scene ID", W,
     "      this.playingIndex = playingAfter >= 0 ? playingAfter : Math.max(0, Math.min(this.scenes.length - 1, this.playingIndex));",
     "      this.playingIndex = this.playingIndex > idx ? this.playingIndex - 1 : this.playingIndex;", ['test-weave-session']),
    ("deletion drops the editing identity whenever an earlier Scene is deleted", W,
     "      this.editingIndex = editingAfter >= 0 ? editingAfter : null;   // deleting the edited Scene ends ADJUST",
     "      this.editingIndex = editingAfter === this.editingIndex ? editingAfter : null;", ['test-weave-session']),
    ("delayed Preview recomputes its target from selectedIndex", W,
     "        const targetIdx = this.sceneIndexById(targetId);",
     "        const targetIdx = (this.selectedIndex + 1) % this.scenes.length;", ['test-weave-session']),
    ("_applySession core never marks the destructive boundary", H,
     "        if (typeof onReplacing === 'function') onReplacing();\n        // Clear existing sound sources\n", "        // Clear existing sound sources\n", ['test-weave-host']),
    ("_applySession wrapper reports replaced only when the core returns (old behaviour)", H,
     "      const r = await this._applySessionCore(session, () => { replaced = true; });\n      failures =",
     "      const r = await this._applySessionCore(session, () => {});\n      replaced = true;\n      failures =", ['test-weave-host']),
    # ---- host ----
    ("bump the revision inside cleanupSources", H,
     "  cleanupSources() {\n    this._projectExternal = null;", "  cleanupSources() {\n    this._sourceRevision++;\n    this._projectExternal = null;", ['test-weave-host']),
    ("connectLiveInput no longer marks the replacement", H,
     "    this.cleanupSources();\n    this._noteSourceReplaced();   // Weave S4: live input replaces the source", "    this.cleanupSources();", ['test-weave-host']),
    ("loadStreamUrl no longer marks the replacement", H,
     "    this._pcmCopy = null;\n    this._noteSourceReplaced();   // Weave S4: a stream replaces the source", "    this._pcmCopy = null;", ['test-weave-host']),
    ("decoded-item origin records the wrong file", H,
     "this._bufferOrigin = { kind: 'decoded-item', revision, bufferRef: decodedBuffer, fileRef: file };", "this._bufferOrigin = { kind: 'decoded-item', revision, bufferRef: decodedBuffer, fileRef: this.playlist[0] || file };", ['test-weave-host']),
    ("_applySession wrapper reports replaced:true even when the core threw in preflight", H,
     "    let replaced = false, failures = [];\n    try {\n      const r = await this._applySessionCore(session, () => { replaced = true; });",
     "    let replaced = true, failures = [];\n    try {\n      const r = await this._applySessionCore(session, () => { replaced = true; });", ['test-weave-host']),
    ("rebuildAudioGraph wrapper does not release on error", H,
     "    } finally {\n      if (token && typeof we.onSourcesReplaced === 'function') we.onSourcesReplaced(token, { kind: 'rebuild', replaced });\n    }",
     "    }\n    if (token && typeof we.onSourcesReplaced === 'function') we.onSourcesReplaced(token, { kind: 'rebuild', replaced });", ['test-weave-host']),
    ("rebuilt buffers keep a decoded-item origin", H,
     "            t._bufferOrigin = { kind: 'rebuilt' };   // Weave S4: new buffer object, provenance not proven", "", ['test-weave-host']),
    ("restored session buffers claim no origin", H,
     "            t._bufferOrigin = { kind: 'session' };   // Weave S4: restored from a saved buffer", "", ['test-weave-host']),
    ("synthetic demo stems not marked replaced", H,
     "      this.tracks[trackIdx]._noteSourceReplaced();   // Weave S4: synthetic buffer replaces the source\n", "", ['test-weave-host']),
]

results = []
for name, f, old, new, suites in CASES:
    if os.path.isdir(scratch): shutil.rmtree(scratch)
    shutil.copytree(os.path.join(repo, 'desktop'), os.path.join(scratch, 'desktop'), ignore=shutil.ignore_patterns('src-tauri', 'dist', 'dsp-wasm', 'fonts', '*.orig'))
    shutil.copytree(os.path.join(repo, 'tests'), os.path.join(scratch, 'tests'))
    src = open(os.path.join(repo, f), encoding='utf-8').read()
    assert src.count(old) == 1, (name, src.count(old))
    open(os.path.join(scratch, f), 'w', encoding='utf-8').write(src.replace(old, new))
    if not suites:
        print('NOTE    ' + name + ' — equivalent change after a passed recheck / same-file case; not a detectable sabotage (documented)')
        continue
    caught = False; detail = []
    for suite in suites:
        p = subprocess.run(['node', os.path.join(scratch, 'tests', suite + '.js')], capture_output=True, text=True, timeout=120)
        tail = [l for l in p.stdout.splitlines() if 'passed,' in l or 'PASSED' in l]
        failing = [l[2:].split(':')[0].strip() for l in p.stdout.splitlines() if l.startswith('✘')]
        if p.returncode != 0: caught = True
        detail.append(suite + ': ' + (tail[-1] if tail else 'crash') + (' — failing: ' + ', '.join(failing) if failing else ''))
    results.append((name, caught))
    print(('CAUGHT  ' if caught else 'MISSED  ') + name + ' — ' + ' | '.join(detail))
missed = [r for r in results if not r[1]]
print('\n%d sabotage cases run, %d caught, %d missed' % (len(results), len(results) - len(missed), len(missed)))
sys.exit(1 if missed else 0)
