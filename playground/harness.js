/**
 * Aether Node Development Harness
 * Standalone runner for testing and developing .aethernode modules
 */

// DOM Elements
const btnAudioToggle = document.getElementById('btn-audio-toggle');
const btnReloadNode = document.getElementById('btn-reload-node');
const nodeNameEl = document.getElementById('node-name');
const nodeCategoryEl = document.getElementById('node-category');
const nodeIdDisplayEl = document.getElementById('node-id-display');
const fpsCounterEl = document.getElementById('fps-counter');
const pointerCoordsEl = document.getElementById('pointer-coords');
const masterGainSlider = document.getElementById('master-gain');
const masterGainValEl = document.getElementById('master-gain-val');
const audioStateBadge = document.getElementById('audio-state-badge');
const paramsContainer = document.getElementById('params-container');
const paramsCountEl = document.getElementById('params-count');
const harnessLog = document.getElementById('harness-log');
const canvas = document.getElementById('node-stage');
const canvasWrapper = document.getElementById('canvas-wrapper');
const canvasOverlay = document.getElementById('canvas-overlay');
const ctx = canvas.getContext('2d');

// State
let audioCtx = null;
let masterGainNode = null;
let activeDspModule = null;
let activeUiModule = null;
let activeNodeEndpoints = null;
let activeManifest = null;
let currentParams = {};
let isAudioRunning = false;

// Performance & Animation
let animationFrameId = null;
let lastFrameTime = performance.now();
let frameCount = 0;
let fpsLastCalculated = performance.now();

// Pointer State
const pointerState = {
  x: 0,
  y: 0,
  normalizedX: 0,
  normalizedY: 0,
  isDown: false,
  inside: false
};

// Logging helper
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  entry.textContent = `[${time}] ${msg}`;
  harnessLog.appendChild(entry);
  harnessLog.scrollTop = harnessLog.scrollHeight;
}

// Audio Engine Setup
async function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

    masterGainNode = audioCtx.createGain();
    masterGainNode.gain.setValueAtTime(parseFloat(masterGainSlider.value), audioCtx.currentTime);
    masterGainNode.connect(audioCtx.destination);

    audioCtx.onstatechange = () => {
      updateAudioUiState();
    };
  }

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  updateAudioUiState();
}

function updateAudioUiState() {
  const state = audioCtx ? audioCtx.state : 'suspended';
  isAudioRunning = state === 'running';

  if (isAudioRunning) {
    audioStateBadge.textContent = 'RUNNING';
    audioStateBadge.className = 'state-badge running';
    btnAudioToggle.classList.add('running');
    btnAudioToggle.querySelector('.btn-text').textContent = 'Suspend Audio';
    btnAudioToggle.querySelector('.icon').textContent = '⏸';
    canvasOverlay.classList.add('hidden');
  } else {
    audioStateBadge.textContent = 'SUSPENDED';
    audioStateBadge.className = 'state-badge suspended';
    btnAudioToggle.classList.remove('running');
    btnAudioToggle.querySelector('.btn-text').textContent = 'Start Audio';
    btnAudioToggle.querySelector('.icon').textContent = '▶';
    canvasOverlay.classList.remove('hidden');
  }
}

// Load and Parse Manifest
async function loadManifest() {
  try {
    const cacheBuster = Date.now();
    const res = await fetch(`./scratchpad/manifest.json?t=${cacheBuster}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching manifest.json`);
    const manifest = await res.json();

    activeManifest = manifest;
    nodeNameEl.textContent = manifest.name || 'Unnamed Node';
    nodeCategoryEl.textContent = manifest.category || 'generic';
    nodeIdDisplayEl.textContent = `ID: ${manifest.id || 'unknown'}`;

    renderParamControls(manifest.params || {});
    log(`Loaded manifest: ${manifest.name} (${manifest.id})`, 'success');
    return manifest;
  } catch (err) {
    log(`Manifest load failed: ${err.message}`, 'error');
    console.error(err);
    return null;
  }
}

// Build UI Controls for Parameters
function renderParamControls(params) {
  paramsContainer.innerHTML = '';
  const paramKeys = Object.keys(params);
  paramsCountEl.textContent = `${paramKeys.length} params`;

  if (paramKeys.length === 0) {
    paramsContainer.innerHTML = '<div class="empty-params">No exposed parameters in manifest.</div>';
    return;
  }

  paramKeys.forEach((key) => {
    const p = params[key];
    const initialVal = currentParams[key] !== undefined ? currentParams[key] : (p.default ?? 0);
    currentParams[key] = initialVal;

    const card = document.createElement('div');
    card.className = 'param-card';

    if (p.type === 'boolean') {
      card.innerHTML = `
        <label class="toggle-wrapper">
          <input type="checkbox" id="param-${key}" ${initialVal ? 'checked' : ''}>
          <span class="param-label">${p.label || key}</span>
        </label>
      `;

      const checkbox = card.querySelector(`#param-${key}`);
      checkbox.addEventListener('change', (e) => {
        const val = e.target.checked;
        currentParams[key] = val;
        activeDspModule?.updateParams?.(key, val);
        log(`Param [${key}] = ${val}`);
      });
    } else {
      // Default to numeric slider
      const min = p.min ?? 0;
      const max = p.max ?? 1;
      const step = p.step ?? (max > 10 ? 1 : 0.01);
      const unit = p.unit ? ` ${p.unit}` : '';

      card.innerHTML = `
        <div class="param-header">
          <span class="param-label">${p.label || key}</span>
          <span class="param-value" id="val-${key}">${initialVal}${unit}</span>
        </div>
        <div class="param-slider-wrapper">
          <input type="range" id="param-${key}" min="${min}" max="${max}" step="${step}" value="${initialVal}">
        </div>
      `;

      const slider = card.querySelector(`#param-${key}`);
      const valDisplay = card.querySelector(`#val-${key}`);

      slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        currentParams[key] = val;
        valDisplay.textContent = `${val}${unit}`;
        activeDspModule?.updateParams?.(key, val);
      });
    }

    paramsContainer.appendChild(card);
  });
}

// Load and Mount Node Modules
async function mountNode() {
  const cacheBuster = Date.now();
  
  // Teardown previous instances if any
  unmountNode();

  // Load manifest
  const manifest = await loadManifest();
  if (!manifest) return;

  try {
    // Dynamic import of DSP and UI with cache busting
    const dspModule = await import(`./scratchpad/dsp.js?t=${cacheBuster}`);
    const uiModule = await import(`./scratchpad/ui.js?t=${cacheBuster}`);

    activeDspModule = dspModule;
    activeUiModule = uiModule;

    // Initialize DSP if audio context exists
    if (audioCtx && dspModule.init) {
      activeNodeEndpoints = dspModule.init(audioCtx, { params: { ...currentParams } });

      if (activeNodeEndpoints && activeNodeEndpoints.output && masterGainNode) {
        try {
          activeNodeEndpoints.output.connect(masterGainNode);
          log('Connected DSP output to master bus', 'success');
        } catch (err) {
          log(`Failed to connect DSP output: ${err.message}`, 'error');
        }
      }
    }

    log('Mounted node modules successfully', 'success');
  } catch (err) {
    log(`Failed to mount node: ${err.message}`, 'error');
    console.error(err);
  }
}

// Unmount and Teardown Active Node
function unmountNode() {
  if (activeDspModule) {
    try {
      if (activeNodeEndpoints && activeNodeEndpoints.output) {
        activeNodeEndpoints.output.disconnect();
      }
      activeDspModule.destroy?.();
    } catch (err) {
      console.warn('Error during DSP destroy:', err);
    }
    activeDspModule = null;
    activeNodeEndpoints = null;
  }

  if (activeUiModule) {
    try {
      activeUiModule.destroy?.();
    } catch (err) {
      console.warn('Error during UI destroy:', err);
    }
    activeUiModule = null;
  }

  // Clear canvas
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Canvas & Resize Handling
function resizeCanvas() {
  const rect = canvasWrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  if (width === 0 || height === 0) return;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.resetTransform?.();
    ctx.scale(dpr, dpr);
  }
}

// Animation Loop
function renderLoop(now) {
  animationFrameId = requestAnimationFrame(renderLoop);

  // Calculate FPS
  frameCount++;
  if (now - fpsLastCalculated >= 500) {
    const fps = Math.round((frameCount * 1000) / (now - fpsLastCalculated));
    fpsCounterEl.textContent = `${fps} FPS`;
    frameCount = 0;
    fpsLastCalculated = now;
  }

  resizeCanvas();

  const rect = canvasWrapper.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (activeUiModule?.render && width > 0 && height > 0) {
    const state = {
      width,
      height,
      time: now * 0.001,
      params: { ...currentParams },
      pointer: { ...pointerState },
      isAudioRunning
    };

    try {
      activeUiModule.render(ctx, state);
    } catch (err) {
      console.error('UI Render Error:', err);
    }
  }
}

// Pointer Event Listeners
function setupPointerEvents() {
  function updateCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    pointerState.x = Math.max(0, Math.min(rect.width, x));
    pointerState.y = Math.max(0, Math.min(rect.height, y));
    pointerState.normalizedX = rect.width > 0 ? pointerState.x / rect.width : 0;
    pointerState.normalizedY = rect.height > 0 ? pointerState.y / rect.height : 0;

    pointerCoordsEl.textContent = `X: ${Math.round(pointerState.x)} | Y: ${Math.round(pointerState.y)}`;
  }

  canvas.addEventListener('pointerenter', (e) => {
    pointerState.inside = true;
    updateCoords(e);
  });

  canvas.addEventListener('pointerleave', () => {
    pointerState.inside = false;
    pointerState.isDown = false;
  });

  canvas.addEventListener('pointerdown', (e) => {
    pointerState.isDown = true;
    pointerState.inside = true;
    canvas.setPointerCapture?.(e.pointerId);
    updateCoords(e);

    activeUiModule?.onPointerDown?.(e, {
      ...pointerState,
      params: currentParams
    });
  });

  canvas.addEventListener('pointermove', (e) => {
    updateCoords(e);
    activeUiModule?.onPointerMove?.(e, {
      ...pointerState,
      params: currentParams
    });
  });

  canvas.addEventListener('pointerup', (e) => {
    pointerState.isDown = false;
    canvas.releasePointerCapture?.(e.pointerId);
    updateCoords(e);

    activeUiModule?.onPointerUp?.(e, {
      ...pointerState,
      params: currentParams
    });
  });
}

// UI Event Handlers
btnAudioToggle.addEventListener('click', async () => {
  await ensureAudioContext();

  if (audioCtx.state === 'running') {
    // If it was just resumed and DSP hasn't been initialized yet, initialize it
    if (activeDspModule && !activeNodeEndpoints && activeDspModule.init) {
      activeNodeEndpoints = activeDspModule.init(audioCtx, { params: { ...currentParams } });
      if (activeNodeEndpoints?.output) {
        activeNodeEndpoints.output.connect(masterGainNode);
      }
    }
  } else {
    await audioCtx.suspend();
  }
  updateAudioUiState();
});

btnReloadNode.addEventListener('click', async () => {
  log('Reloading scratchpad node...', 'info');
  await mountNode();
});

masterGainSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  masterGainValEl.textContent = `${Math.round(val * 100)}%`;
  if (masterGainNode && audioCtx) {
    masterGainNode.gain.setTargetAtTime(val, audioCtx.currentTime, 0.02);
  }
});

window.addEventListener('resize', resizeCanvas);

// Initialization
async function init() {
  setupPointerEvents();
  resizeCanvas();
  animationFrameId = requestAnimationFrame(renderLoop);
  await mountNode();
}

init();
