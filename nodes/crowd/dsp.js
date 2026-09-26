/**
 * Crowd — voice-field generator for Aether.
 * Loads David's samples-for-matt pack from atlas.anarchive.earth (CORS *).
 * Gathering builds a shuffled atlas voice catalog (palette + careful extras),
 * preloads into a capped pool, then while sounding drips 1–2 unused samples
 * every 8–15s without reloading the whole lot. Beds = murmur/beacons loops.
 * Focus continuous; distant voices get gentle LPF + HPF + tiny sparse reverb.
 * Chatter = entry fade (0≈2s soft → 1≈snappy) + interval/win; Wander = pitch/pan drift (×1.2). Optional granular.
 * Spawn picks random from pool. Native Web Audio only. Class DSP like Halo.
 */
class CrowdDSP {
  constructor() {
    this.ctx = null;
    this.outputNode = null;
    this.isRunning = false;
    this._graph = [];
    this._timerId = null;
    this._gatherTimer = null;
    this._grainTimer = null;
    this._dripTimer = null;
    this._active = [];
    this._voiceBuffers = []; // density pool buffers
    this._voiceUrls = []; // parallel URLs for pool entries (unique)
    this._loopBuffers = { murmur: null, beacons: null };
    this._loopSources = [];
    this._catalogUrls = []; // shuffled full voice URL list (pending + loaded)
    this._pendingUrls = []; // not yet in memory
    this._loadedUrlSet = Object.create(null);
    this._POOL_CAP = 36; // WKWebView-safe; drip drops oldest when full
    this._DRIP_MIN_MS = 8000;
    this._DRIP_MAX_MS = 15000;
    this._INIT_BATCH = 16; // gather preload count before/while unlock
    this._readyCount = 0;
    this._gathering = false;
    this._unlocked = false;
    this._fetchFailed = false;
    this._nextVoiceAt = 0;
    this._voiceIndex = 0; // role counter only (spawn is random)
    this._status = 'idle';
    this._loadGen = 0;
    this._dripBusy = false;
    this.params = {
      density: 8,
      focus: 0.35,
      distance: 0.55,
      granular: 0.15,
      chatter: 0.4,
      wander: 0.3
    };

    this._BASE = 'https://atlas.anarchive.earth/assets/samples-for-matt';
    this._ATLAS_JSON = 'https://atlas.anarchive.earth/samples-for-matt.json';
    this._LOOPS = [
      { key: 'murmur', path: '/loops/street-murmur-30s' },
      { key: 'beacons', path: '/loops/two-beacons-30s' }
    ];
    // Fallback palette if atlas JSON unreachable
    this._PALETTE = [
      'adam-albania-1998-rev-2016',
      'alice-australia-1901-rev-1985',
      'bella-algeria-1989-reinst-1996',
      'daniel-k-andorra-1993',
      'emma-central-african-republic',
      'fable-china-peoples-republic-o',
      'fenrir-afghanistan-1964',
      'george-benin-1990',
      'heart-bolivia-plurinational-st',
      'isabella-azerbaijan-1995-rev-2016',
      'lewis-armenia-1995-rev-2020',
      'lily-antigua-and-barbuda-1981',
      'michael-algeria-2020',
      'nicole-cape-verde-1980-rev-1992',
      'onyx-angola-2010',
      'sarah-afghanistan-2004'
    ];
    // Careful extras (~palette-like voice material; not beds). Prefer shorter.
    this._EXTRA_FALLBACK = [
      '/multilingual/spain-1978-rev-2011-en-es-layered',
      '/multilingual/bolivia-plurinational-state-of-2009-en-es-layered',
      '/multilingual/argentina-1853-reinst-1983-rev-1994-en-es-layered',
      '/multilingual/guatemala-1985-rev-1993-en-es-layered',
      '/multilingual/spain-1978-rev-2011-en-es-battle',
      '/multilingual/bolivia-plurinational-state-of-2009-en-es-battle',
      '/multilingual/argentina-1853-reinst-1983-rev-1994-en-es-battle',
      '/multilingual/guatemala-1985-rev-1993-en-es-battle',
      '/demos/distance-sweep-bolivia'
    ];
  }

  _add(node) {
    this._graph.push(node);
    return node;
  }

  init(audioContext, config = {}) {
    this.ctx = audioContext;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.mixBus = this._add(ctx.createGain());
    this.mixBus.gain.setValueAtTime(1, now);

    this.bedBus = this._add(ctx.createGain());
    this.bedBus.gain.setValueAtTime(0.38, now);

    this.reverbSend = this._add(ctx.createGain());
    this.reverbSend.gain.setValueAtTime(0.12, now);

    this.reverbSum = this._add(ctx.createGain());
    this.reverbSum.gain.setValueAtTime(0.55, now);

    const taps = [0.018, 0.031, 0.047, 0.068];
    const tapGains = [0.28, 0.18, 0.12, 0.07];
    for (let i = 0; i < taps.length; i++) {
      const d = this._add(ctx.createDelay(0.2));
      d.delayTime.setValueAtTime(taps[i], now);
      const g = this._add(ctx.createGain());
      g.gain.setValueAtTime(tapGains[i], now);
      const lp = this._add(ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4200, now);
      lp.Q.setValueAtTime(0.5, now);
      this.reverbSend.connect(d);
      d.connect(lp);
      lp.connect(g);
      g.connect(this.reverbSum);
    }

    this.grainDelay = this._add(ctx.createDelay(0.35));
    this.grainDelay.delayTime.setValueAtTime(0.09, now);
    this.grainDelayGain = this._add(ctx.createGain());
    this.grainDelayGain.gain.setValueAtTime(0, now);
    this.grainDelay.connect(this.grainDelayGain);
    this.grainDelayGain.connect(this.mixBus);

    this.outComp = this._add(ctx.createDynamicsCompressor());
    this.outComp.threshold.setValueAtTime(-18, now);
    this.outComp.knee.setValueAtTime(8, now);
    this.outComp.ratio.setValueAtTime(3, now);
    this.outComp.attack.setValueAtTime(0.01, now);
    this.outComp.release.setValueAtTime(0.12, now);

    this.outputNode = this._add(ctx.createGain());
    this.outputNode.gain.setValueAtTime(0, now);

    this.bedBus.connect(this.mixBus);
    this.mixBus.connect(this.outComp);
    this.reverbSum.connect(this.outComp);
    this.outComp.connect(this.outputNode);

    if (config.sampleBuffer) {
      this._ingestHostBuffer(config.sampleBuffer);
    }

    this._status = 'ready-idle';
    this._beginFetch(false);
    return this.outputNode;
  }

  static packUrls() {
    const base = 'https://atlas.anarchive.earth/assets/samples-for-matt';
    const loops = [
      base + '/loops/street-murmur-30s.mp3',
      base + '/loops/two-beacons-30s.mp3'
    ];
    const palette = [
      'adam-albania-1998-rev-2016',
      'alice-australia-1901-rev-1985',
      'bella-algeria-1989-reinst-1996',
      'daniel-k-andorra-1993',
      'emma-central-african-republic',
      'fable-china-peoples-republic-o',
      'fenrir-afghanistan-1964',
      'george-benin-1990',
      'heart-bolivia-plurinational-st',
      'isabella-azerbaijan-1995-rev-2016',
      'lewis-armenia-1995-rev-2020',
      'lily-antigua-and-barbuda-1981',
      'michael-algeria-2020',
      'nicole-cape-verde-1980-rev-1992',
      'onyx-angola-2010',
      'sarah-afghanistan-2004'
    ].map((n) => base + '/palette/' + n + '.mp3');
    const extras = [
      base + '/multilingual/spain-1978-rev-2011-en-es-layered.mp3',
      base + '/multilingual/bolivia-plurinational-state-of-2009-en-es-layered.mp3',
      base + '/demos/distance-sweep-bolivia.mp3'
    ];
    return {
      loops,
      palette,
      extras,
      atlasJson: 'https://atlas.anarchive.earth/samples-for-matt.json',
      zip: base + '/samples-for-matt.zip',
      poolCap: 36,
      dripMs: [8000, 15000],
      dripCount: [1, 2]
    };
  }

  _shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  _stemToMp3(stemOrUrl) {
    if (!stemOrUrl) return null;
    if (/^https?:\/\//i.test(stemOrUrl)) {
      return stemOrUrl.replace(/\.(m4a|wav)$/i, '.mp3');
    }
    const s = stemOrUrl.charAt(0) === '/' ? stemOrUrl : '/' + stemOrUrl;
    return this._BASE + s.replace(/\.(m4a|wav|mp3)$/i, '') + '.mp3';
  }

  _fallbackCatalog() {
    const urls = [];
    const seen = Object.create(null);
    const push = (u) => {
      if (!u || seen[u]) return;
      seen[u] = 1;
      urls.push(u);
    };
    for (let i = 0; i < this._PALETTE.length; i++) {
      push(this._BASE + '/palette/' + this._PALETTE[i] + '.mp3');
    }
    for (let i = 0; i < this._EXTRA_FALLBACK.length; i++) {
      push(this._stemToMp3(this._EXTRA_FALLBACK[i]));
    }
    return urls;
  }

  _catalogFromAtlasJson(text) {
    const re = /https:\/\/atlas\.anarchive\.earth\/assets\/samples-for-matt\/[^\s"'<>)]+\.mp3/gi;
    const found = text.match(re) || [];
    const palette = [];
    const extras = [];
    const seen = Object.create(null);
    for (let i = 0; i < found.length; i++) {
      let u = found[i].replace(/&amp;/g, '&');
      u = u.split('#')[0];
      if (seen[u]) continue;
      seen[u] = 1;
      if (/\/loops\//i.test(u)) continue;
      if (/spanish-quarter/i.test(u)) continue;
      if (/street-journey-mix/i.test(u)) continue;
      if (/synthetic-then-human/i.test(u)) continue;
      if (/\/palette\//i.test(u)) palette.push(u);
      else if (/\/multilingual\//i.test(u) || /\/demos\//i.test(u)) extras.push(u);
    }
    return palette.concat(extras);
  }

  async _buildShuffledCatalog() {
    let urls = null;
    try {
      const res = await fetch(this._ATLAS_JSON, { mode: 'cors', credentials: 'omit' });
      if (res.ok) {
        const text = await res.text();
        const parsed = this._catalogFromAtlasJson(text);
        if (parsed && parsed.length >= 8) urls = parsed;
      }
    } catch (e) {
      console.warn('[Crowd] atlas JSON fetch failed, using fallback catalog', e);
    }
    if (!urls || !urls.length) urls = this._fallbackCatalog();
    const fb = this._fallbackCatalog();
    const seen = Object.create(null);
    const merged = [];
    for (let i = 0; i < urls.length; i++) {
      if (!seen[urls[i]]) { seen[urls[i]] = 1; merged.push(urls[i]); }
    }
    for (let i = 0; i < fb.length; i++) {
      if (!seen[fb[i]]) { seen[fb[i]] = 1; merged.push(fb[i]); }
    }
    return this._shuffleInPlace(merged);
  }

  async _fetchDecode(url) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    const ab = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(ab.slice(0));
  }

  async _fetchPrefer(stemOrUrl) {
    if (/^https?:\/\//i.test(stemOrUrl) && /\.mp3$/i.test(stemOrUrl)) {
      try {
        return await this._fetchDecode(stemOrUrl);
      } catch (e1) {
        const wav = stemOrUrl.replace(/\.mp3$/i, '.wav');
        return await this._fetchDecode(wav);
      }
    }
    const stem = String(stemOrUrl).replace(/\.(mp3|wav|m4a)$/i, '');
    try {
      return await this._fetchDecode(stem + '.mp3');
    } catch (e1) {
      return await this._fetchDecode(stem + '.wav');
    }
  }

  _pushPool(url, buf) {
    if (!buf) return false;
    const key = url || ('host:' + this._voiceBuffers.length);
    if (url && this._loadedUrlSet[url]) return false;
    while (this._voiceBuffers.length >= this._POOL_CAP) {
      const oldUrl = this._voiceUrls.shift();
      this._voiceBuffers.shift();
      if (oldUrl && this._loadedUrlSet[oldUrl]) delete this._loadedUrlSet[oldUrl];
    }
    this._voiceBuffers.push(buf);
    this._voiceUrls.push(url || key);
    if (url) this._loadedUrlSet[url] = 1;
    this._readyCount = this._voiceBuffers.length;
    return true;
  }

  _beginFetch(force) {
    if (!this.ctx) return;
    if (this._fetchPromise && !force) return this._fetchPromise;
    const gen = ++this._loadGen;
    this._fetchFailed = false;
    this._fetchPromise = this._fetchPack(gen);
    return this._fetchPromise;
  }

  async _fetchPack(gen) {
    for (let i = 0; i < this._LOOPS.length; i++) {
      if (gen !== this._loadGen) return;
      const L = this._LOOPS[i];
      try {
        const buf = await this._fetchPrefer(this._BASE + L.path);
        if (gen !== this._loadGen) return;
        this._loopBuffers[L.key] = buf;
        this._status = 'gathering';
        this._emitStatus();
      } catch (e) {
        console.warn('[Crowd] loop fetch failed', L.path, e);
        this._fetchFailed = true;
      }
    }

    if (gen !== this._loadGen) return;
    let catalog;
    try {
      catalog = await this._buildShuffledCatalog();
    } catch (e) {
      catalog = this._shuffleInPlace(this._fallbackCatalog());
    }
    if (gen !== this._loadGen) return;
    this._catalogUrls = catalog.slice();
    this._pendingUrls = catalog.slice();
    this._voiceBuffers = [];
    this._voiceUrls = [];
    this._loadedUrlSet = Object.create(null);
    this._readyCount = 0;

    const need = Math.min(this._soundingCount(), this._INIT_BATCH);
    const initialTarget = Math.min(this._INIT_BATCH, this._pendingUrls.length);

    for (let i = 0; i < initialTarget; i++) {
      if (gen !== this._loadGen) return;
      const url = this._pendingUrls.shift();
      if (!url) break;
      try {
        const buf = await this._fetchPrefer(url);
        if (gen !== this._loadGen) return;
        this._pushPool(url, buf);
        this._status = 'gathering';
        this._emitStatus();
        if (this.isRunning && this._gathering && this._readyCount >= need) {
          this._tryUnlock();
        }
      } catch (e) {
        console.warn('[Crowd] voice fetch failed', url, e);
        this._fetchFailed = true;
      }
    }

    if (this._voiceBuffers.length === 0 && this._fetchFailed) {
      this._status = 'fetch-failed';
      this._emitStatus();
    } else if (this.isRunning && this._gathering) {
      this._tryUnlock();
    }
  }

  _tryUnlock() {
    const need = Math.min(this._soundingCount(), this._INIT_BATCH);
    if (!this.isRunning || this._unlocked) return;
    if (this._voiceBuffers.length < Math.min(need, 4) && !this._loopBuffers.murmur) {
      return;
    }
    if (this._voiceBuffers.length >= need || this._readyCount >= this._INIT_BATCH) {
      this._unlockAndPlay();
    } else if (this._voiceBuffers.length >= Math.min(need, 5) && this._loopBuffers.murmur) {
      this._unlockAndPlay();
    }
  }

  _ingestHostBuffer(audioBuffer) {
    if (!audioBuffer) return;
    this._pushPool(null, audioBuffer);
  }

  injectAudioBuffer(audioBuffer) {
    if (!this.ctx || !audioBuffer) return;
    this._ingestHostBuffer(audioBuffer);
    if (this.isRunning && this._unlocked) this._scheduleLoop();
  }

  injectPlaylist(buffers) {
    if (!this.ctx || !Array.isArray(buffers)) return;
    for (let i = 0; i < buffers.length && this._voiceBuffers.length < this._POOL_CAP; i++) {
      if (buffers[i]) this._ingestHostBuffer(buffers[i]);
    }
  }

  setParameter(paramId, value) {
    if (this.params[paramId] === undefined) return;
    this.params[paramId] = value;
    if (paramId === 'granular') this._updateGranular();
  }

  _updateGranular() {
    if (!this.grainDelayGain || !this.ctx) return;
    const g = Math.max(0, Math.min(1, this.params.granular));
    this.grainDelayGain.gain.setTargetAtTime(g * 0.336, this.ctx.currentTime, 0.05);
  }

  _soundingCount() {
    return Math.round(Math.max(5, Math.min(30, this.params.density)));
  }

  _focusCount() {
    const f = Math.max(0, Math.min(1, this.params.focus));
    return f * 5.5;
  }

  connect(dest) {
    if (this.outputNode && dest) this.outputNode.connect(dest);
  }

  disconnect() {
    if (this.outputNode) this.outputNode.disconnect();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    if (!this.ctx || !this.outputNode) return;

    this._gathering = true;
    this._unlocked = false;
    this._status = 'gathering';
    this._emitStatus();

    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(0, t);
    this._updateGranular();

    const p = this._beginFetch(false);
    const need = Math.min(this._soundingCount(), this._INIT_BATCH);
    if (this._voiceBuffers.length >= need) {
      if (this._gatherTimer) clearTimeout(this._gatherTimer);
      this._gatherTimer = setTimeout(() => this._tryUnlock(), 350);
    } else {
      if (this._gatherTimer) clearTimeout(this._gatherTimer);
      this._gatherTimer = setTimeout(() => {
        if (this.isRunning && this._gathering) {
          if (this._voiceBuffers.length > 0 || this._loopBuffers.murmur) {
            this._unlockAndPlay();
          } else {
            this._status = 'fetch-failed';
            this._emitStatus();
          }
        }
      }, 12000);
    }
    if (p && typeof p.then === 'function') {
      p.then(() => {
        if (this.isRunning && this._gathering) this._tryUnlock();
      }).catch(() => {});
    }
  }

  _unlockAndPlay() {
    if (!this.isRunning || !this.ctx || this._unlocked) return;
    this._gathering = false;
    this._unlocked = true;
    this._status = 'ready';
    this._emitStatus();
    if (this._gatherTimer) { clearTimeout(this._gatherTimer); this._gatherTimer = null; }

    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0.85, t + 0.08);

    this._startBeds(t);
    this._nextVoiceAt = t + 0.05;
    this._scheduleLoop();
    this._scheduleGrains();
    this._scheduleDrip();
  }

  _startBeds(when) {
    this._stopBeds();
    const beds = [
      { buf: this._loopBuffers.murmur, gain: 0.42 },
      { buf: this._loopBuffers.beacons, gain: 0.22 }
    ];
    for (let i = 0; i < beds.length; i++) {
      if (!beds[i].buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = beds[i].buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(beds[i].gain, when);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(i === 0 ? 2800 : 5500, when);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.bedBus);
      try { src.start(when); } catch (e) {}
      this._loopSources.push({ src, g });
    }
  }

  _stopBeds() {
    for (let i = 0; i < this._loopSources.length; i++) {
      try { this._loopSources[i].src.stop(); } catch (e) {}
      try { this._loopSources[i].src.disconnect(); } catch (e) {}
    }
    this._loopSources = [];
  }

  _nextDripDelay() {
    return this._DRIP_MIN_MS + Math.random() * (this._DRIP_MAX_MS - this._DRIP_MIN_MS);
  }

  _scheduleDrip() {
    if (this._dripTimer) { clearTimeout(this._dripTimer); this._dripTimer = null; }
    if (!this.isRunning || !this._unlocked) return;
    this._dripTimer = setTimeout(() => this._dripCycle(), this._nextDripDelay());
  }

  async _dripCycle() {
    this._dripTimer = null;
    if (!this.isRunning || !this._unlocked || !this.ctx) return;
    if (this._dripBusy) {
      this._scheduleDrip();
      return;
    }
    if (!this._pendingUrls.length && this._catalogUrls.length) {
      const reload = [];
      for (let i = 0; i < this._catalogUrls.length; i++) {
        const u = this._catalogUrls[i];
        if (!this._loadedUrlSet[u]) reload.push(u);
      }
      if (!reload.length) {
        const inPool = Object.create(null);
        for (let i = 0; i < this._voiceUrls.length; i++) inPool[this._voiceUrls[i]] = 1;
        for (let i = 0; i < this._catalogUrls.length; i++) {
          const u = this._catalogUrls[i];
          if (!inPool[u]) reload.push(u);
        }
        if (!reload.length) {
          reload.push.apply(reload, this._shuffleInPlace(this._catalogUrls.slice()));
        }
      }
      this._pendingUrls = this._shuffleInPlace(reload);
    }

    const n = 1 + ((Math.random() * 2) | 0); // 1 or 2
    this._dripBusy = true;
    const gen = this._loadGen;
    try {
      let added = 0;
      while (added < n && this._pendingUrls.length) {
        if (gen !== this._loadGen || !this.isRunning) break;
        const url = this._pendingUrls.shift();
        if (!url) break;
        if (this._loadedUrlSet[url] && this._voiceBuffers.length < this._POOL_CAP) {
          continue;
        }
        try {
          const buf = await this._fetchPrefer(url);
          if (gen !== this._loadGen || !this.isRunning) break;
          if (this._loadedUrlSet[url]) {
            const idx = this._voiceUrls.indexOf(url);
            if (idx >= 0) {
              this._voiceUrls.splice(idx, 1);
              this._voiceBuffers.splice(idx, 1);
              delete this._loadedUrlSet[url];
            }
          }
          if (this._pushPool(url, buf)) {
            added++;
            this._emitStatus();
          }
        } catch (e) {
          console.warn('[Crowd] drip fetch failed', url, e);
        }
      }
    } finally {
      this._dripBusy = false;
    }
    if (this.isRunning && this._unlocked) this._scheduleDrip();
  }

  _emitStatus() {
    try {
      if (typeof window !== 'undefined') {
        const detail = {
          status: this._status,
          ready: this._readyCount,
          pool: this._voiceBuffers.length,
          pending: this._pendingUrls.length,
          catalog: this._catalogUrls.length,
          cap: this._POOL_CAP,
          sounding: this._unlocked ? this._soundingCount() : 0,
          gathering: this._gathering,
          fetchFailed: this._fetchFailed
        };
        window.dispatchEvent(new CustomEvent('aether:crowd-status', { detail: detail }));
        try {
          window.parent && window.parent.postMessage(Object.assign({ type: 'aether:crowd-status' }, detail), '*');
        } catch (e2) {}
      }
    } catch (e) {}
  }

  stop() {
    this.isRunning = false;
    this._unlocked = false;
    this._gathering = false;
    this._status = 'idle';
    if (this._timerId) { clearTimeout(this._timerId); this._timerId = null; }
    if (this._gatherTimer) { clearTimeout(this._gatherTimer); this._gatherTimer = null; }
    if (this._grainTimer) { clearTimeout(this._grainTimer); this._grainTimer = null; }
    if (this._dripTimer) { clearTimeout(this._dripTimer); this._dripTimer = null; }
    this._stopActive();
    this._stopBeds();
    if (!this.ctx || !this.outputNode) return;
    const t = this.ctx.currentTime;
    this.outputNode.gain.cancelScheduledValues(t);
    this.outputNode.gain.setValueAtTime(this.outputNode.gain.value, t);
    this.outputNode.gain.linearRampToValueAtTime(0, t + 0.05);
    this._emitStatus();
  }

  _stopActive() {
    for (let i = 0; i < this._active.length; i++) {
      const v = this._active[i];
      try { if (v.src) v.src.stop(); } catch (e) {}
      try { if (v.src) v.src.disconnect(); } catch (e) {}
    }
    this._active = [];
  }

  _scheduleLoop() {
    if (!this.isRunning || !this._unlocked || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this._nextVoiceAt < now - 0.05) this._nextVoiceAt = now;

    const look = 0.18;
    const sounding = this._soundingCount();
    const pool = this._voiceBuffers;
    if (!pool.length) {
      this._timerId = setTimeout(() => this._scheduleLoop(), 80);
      return;
    }
    const chatter = Math.max(0, Math.min(1, this.params.chatter));
    const baseInterval = Math.max(0.22, (7.2 / sounding) * (1.15 - chatter * 0.55));

    while (this._nextVoiceAt < now + look) {
      this._spawnVoice(this._nextVoiceAt);
      const jitter = (Math.random() * 0.4 + 0.8) * baseInterval;
      this._nextVoiceAt += jitter;
    }
    this._timerId = setTimeout(() => this._scheduleLoop(), 30);
  }

  _spawnVoice(when) {
    const pool = this._voiceBuffers;
    if (!pool.length) return;
    // Random from pool (variety) — not round-robin
    const buf = pool[(Math.random() * pool.length) | 0];
    this._voiceIndex++;

    const focusN = this._focusCount();
    const sounding = this._soundingCount();
    const role = (this._voiceIndex % Math.max(4, sounding));
    const isFocus = role < focusN;
    const dist = Math.max(0, Math.min(1, this.params.distance));
    const chatter = Math.max(0, Math.min(1, this.params.chatter));
    const wander = Math.max(0, Math.min(1, this.params.wander));

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = 0.97 + Math.random() * 0.06;
    src.playbackRate.setValueAtTime(rate, when);

    const win = (2.2 + Math.random() * 2.8) * (1.05 - chatter * 0.45);
    const maxOff = Math.max(0, buf.duration - win);
    const offset = maxOff > 0 ? Math.random() * maxOff : 0;
    // Chatter remap: 0 ≈ soft 2s fade-in, 1 ≈ snappy (~30ms click-guard); keep interval/win.
    const fadeIn = 0.03 + (1 - chatter) * 1.97;

    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const pan0 = (Math.random() * 2 - 1) * (isFocus ? 0.3 : 0.8);
    if (pan) pan.pan.setValueAtTime(pan0, when);

    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';

    const dur = Math.min(win, buf.duration - offset) / rate;
    const attack = Math.min(fadeIn, Math.max(0.03, dur * 0.55));
    const release = Math.min(isFocus ? 0.15 : 0.2, Math.max(0.05, dur * 0.25));
    const sustainAt = Math.max(attack + 0.02, dur - release);

    // Wander ×1.2: pitch/pan drift over the voice window
    if (wander > 0.04) {
      const rateEnd = rate * (1 + (Math.random() * 2 - 1) * wander * 0.108);
      try { src.playbackRate.linearRampToValueAtTime(rateEnd, when + dur); } catch (e) {}
      if (pan) {
        const panEnd = Math.max(-1, Math.min(1, pan0 + (Math.random() * 2 - 1) * wander * 0.66));
        try { pan.pan.linearRampToValueAtTime(panEnd, when + dur); } catch (e) {}
      }
    }

    if (isFocus) {
      hp.frequency.setValueAtTime(60, when);
      lp.frequency.setValueAtTime(10000, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(0.48, when + attack);
      gain.gain.setValueAtTime(0.48, when + sustainAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    } else {
      const hpHz = 160 + dist * 240;
      const lpHz = 5400 - dist * 1600;
      hp.frequency.setValueAtTime(hpHz, when);
      lp.frequency.setValueAtTime(Math.max(2000, lpHz), when);
      hp.Q.setValueAtTime(0.5, when);
      lp.Q.setValueAtTime(0.55, when);
      const duck = 0.1 + (1 - dist) * 0.12;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(duck, when + attack);
      gain.gain.setValueAtTime(duck, when + sustainAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    }

    src.connect(hp);
    hp.connect(lp);
    if (pan) {
      lp.connect(pan);
      pan.connect(gain);
    } else {
      lp.connect(gain);
    }
    gain.connect(this.mixBus);

    if (!isFocus && dist > 0.15) {
      const send = this.ctx.createGain();
      send.gain.setValueAtTime(0.08 + dist * 0.16, when);
      gain.connect(send);
      send.connect(this.reverbSend);
    }

    if (this.params.granular > 0.05) {
      const gs = this.ctx.createGain();
      gs.gain.setValueAtTime(this.params.granular * 0.216, when);
      gain.connect(gs);
      gs.connect(this.grainDelay);
    }

    try { src.start(when, offset, win); } catch (e) {
      try { src.start(when); } catch (e2) {}
    }

    this._active.push({ src, gain });
    if (this._active.length > 72) this._active = this._active.slice(-40);
  }

  _scheduleGrains() {
    if (!this.isRunning || !this._unlocked || !this.ctx) return;
    const g = Math.max(0, Math.min(1, this.params.granular));
    const pool = this._voiceBuffers;
    if (g < 0.04 || !pool.length) {
      this._grainTimer = setTimeout(() => this._scheduleGrains(), 200);
      return;
    }

    const buf = pool[(Math.random() * pool.length) | 0];
    const when = this.ctx.currentTime + 0.02;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const snip = (0.07 + Math.random() * 0.12) * (1 - g * 0.17);
    const offset = Math.random() * Math.max(0, buf.duration - snip);
    src.playbackRate.value = 0.9 + Math.random() * 0.3;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700 + Math.random() * 1600, when);
    bp.Q.setValueAtTime(1.1, when);

    const gain = this.ctx.createGain();
    const peak = 0.1 * g * (1 + g * 0.2);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + snip);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.mixBus);
    gain.connect(this.grainDelay);

    try { src.start(when, offset, snip); } catch (e) {}

    const next = (140 + (1 - g) * 300 + Math.random() * 120) / (1 + g * 0.2);
    this._grainTimer = setTimeout(() => this._scheduleGrains(), next);
  }

  dispose() {
    this.stop();
    this._loadGen++;
    this._graph.forEach((n) => {
      try { n.disconnect(); } catch (e) {}
    });
    this._graph = [];
    this._voiceBuffers = [];
    this._voiceUrls = [];
    this._pendingUrls = [];
    this._catalogUrls = [];
    this._loadedUrlSet = Object.create(null);
    this._loopBuffers = { murmur: null, beacons: null };
    this.ctx = null;
    this.outputNode = null;
  }
}

if (typeof window !== 'undefined') {
  window.CustomNodeDSP = CrowdDSP;
  window.CrowdDSP = CrowdDSP;
}
