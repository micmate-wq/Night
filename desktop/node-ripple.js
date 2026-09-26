/* Shared by the instrument canvas and animation playground. */
(function (root) {
  const defaults = Object.freeze({ layers: 4, spread: 22, softness: 8, irregularity: 3, speed: 1, width: 2 });
  function normalize(settings = {}) {
    const ranges = { layers: [1, 8], spread: [4, 40], softness: [0, 20], irregularity: [0, 10], speed: [0, 3], width: [0.5, 4] };
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const n = Number(settings[key] ?? fallback);
      const value = Number.isFinite(n) ? Math.max(ranges[key][0], Math.min(ranges[key][1], n)) : fallback;
      return [key, key === 'layers' ? Math.round(value) : value];
    }));
  }
  function draw(ctx, { x, y, radius, color, time, settings }) {
    const p = normalize(settings);
    const now = time * p.speed;
    ctx.save();
    for (let j = 0; j < p.layers; j++) {
      const phase = now * 0.0025 + j * 1.57;
      const expansion = (now * 0.018 + j * 6.5) % p.spread;
      const jitter = Math.sin(phase) * p.irregularity;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, radius + expansion + jitter), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = Math.max(0, (1 - expansion / p.spread) * 0.5);
      ctx.lineWidth = p.width;
      ctx.shadowColor = color;
      ctx.shadowBlur = p.softness;
      ctx.stroke();
    }
    ctx.restore();
  }
  root.AetherRipple = { defaults, normalize, draw };
})(globalThis);
