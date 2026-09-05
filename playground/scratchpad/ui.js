/**
 * Aether Starter Sine Generator Canvas UI
 * Implements 2D Canvas rendering for .aethernode
 */

let phase = 0;
let rings = [];

export function render(ctx, state) {
  const { width, height, time, params, pointer, isAudioRunning } = state;
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);

  const freq = params?.frequency || 440;
  const vol = params?.volume ?? 0.25;
  const isActive = params?.active !== false && isAudioRunning;

  // Clear canvas background
  ctx.clearRect(0, 0, width, height);

  // Background subtle grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  const gridSize = 32;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Calculate dynamic speed and radius based on frequency & volume
  const speed = (freq / 440) * 0.05;
  phase += speed;

  const baseRadius = minDim * 0.18 * (0.8 + vol * 0.6);
  const pulse = Math.sin(phase) * (minDim * 0.02 * (isActive ? 1 : 0.2));
  const currentRadius = Math.max(10, baseRadius + pulse);

  // Outer glow aura
  if (isActive) {
    const auraGrad = ctx.createRadialGradient(cx, cy, currentRadius * 0.5, cx, cy, currentRadius * 2.2);
    auraGrad.addColorStop(0, `rgba(6, 182, 212, ${vol * 0.4})`);
    auraGrad.addColorStop(0.6, `rgba(59, 130, 246, ${vol * 0.15})`);
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, currentRadius * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw expanding ripple rings
  if (isActive && Math.random() < 0.05 + vol * 0.1) {
    rings.push({ r: currentRadius, alpha: 0.6, life: 1 });
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i];
    ring.r += 1.2 + (freq / 200);
    ring.alpha *= 0.96;
    ring.life -= 0.02;

    if (ring.life <= 0 || ring.alpha <= 0.01) {
      rings.splice(i, 1);
      continue;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(6, 182, 212, ${ring.alpha * vol})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Waveform ring around central orb
  const numPoints = 64;
  ctx.beginPath();
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const waveOffset = isActive ? Math.sin(angle * 8 + phase * 2) * (vol * 12) : 0;
    const r = currentRadius + waveOffset;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;

    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = isActive ? '#06b6d4' : '#4b5563';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Central Orb
  const orbGrad = ctx.createRadialGradient(cx - currentRadius * 0.3, cy - currentRadius * 0.3, 2, cx, cy, currentRadius);
  if (isActive) {
    orbGrad.addColorStop(0, '#e0f2fe');
    orbGrad.addColorStop(0.4, '#06b6d4');
    orbGrad.addColorStop(1, '#1e293b');
  } else {
    orbGrad.addColorStop(0, '#64748b');
    orbGrad.addColorStop(1, '#1e293b');
  }
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, currentRadius * 0.85, 0, Math.PI * 2);
  ctx.fill();

  // Center frequency & label readout
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.max(12, Math.floor(minDim * 0.04))}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(freq)} Hz`, cx, cy - 2);

  ctx.font = `400 ${Math.max(10, Math.floor(minDim * 0.024))}px -apple-system, sans-serif`;
  ctx.fillStyle = isActive ? '#67e8f9' : '#94a3b8';
  ctx.fillText(isActive ? 'SINE OSC' : 'MUTED', cx, cy + 16);

  // Pointer indicator if hovering / dragging
  if (pointer && pointer.inside) {
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.8)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Crosshair line to center
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(cx, cy);
    ctx.lineTo(pointer.x, pointer.y);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function onPointerDown(e, state) {
  // Optional pointer hook
}

export function onPointerMove(e, state) {
  // Optional pointer hook
}

export function onPointerUp(e, state) {
  // Optional pointer hook
}

export function destroy() {
  rings = [];
  phase = 0;
}
