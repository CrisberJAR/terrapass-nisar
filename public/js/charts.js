/** Minimal crisp canvas charts (HiDPI, theme-aware) */
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function prep(canvas) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = '500 11px Inter, system-ui, sans-serif';
  return { g, w, h };
}

/**
 * Multi-series line chart
 * series: [{ values:[], color, label, dashed?, axis:'left'|'right', fill? }]
 * opts: { labels:[], marks:[{i, color, label}], spans:[{i0,i1,color}], cursor:i, yLabel, yLabelR, bars? }
 */
export function lineChart(canvas, series, opts = {}) {
  const { g, w, h } = prep(canvas);
  const ink = css('--ink-2') || '#9aa4b2', grid = css('--grid') || 'rgba(255,255,255,.07)';
  const L = 40, Rm = series.some(s => s.axis === 'right') ? 40 : 12, T = 14, B = 26, pw = w - L - Rm, ph = h - T - B;
  const n = Math.max(...series.map(s => s.values.length), 1);
  const range = axis => {
    const vs = series.filter(s => (s.axis || 'left') === axis).flatMap(s => s.values).filter(Number.isFinite);
    if (!vs.length) return [0, 1];
    let a = Math.min(...vs), b = Math.max(...vs); if (a === b) { a -= 1; b += 1; } const p = (b - a) * 0.12; return [a - p, b + p];
  };
  const rl = opts.yRange || range('left'), rr = range('right');
  const X = i => L + (n === 1 ? pw / 2 : i / (n - 1) * pw);
  const Y = (v, r) => T + (1 - (v - r[0]) / (r[1] - r[0])) * ph;
  // spans
  (opts.spans || []).forEach(s => { g.fillStyle = s.color; g.fillRect(X(s.i0) - 4, T, X(s.i1) - X(s.i0) + 8, ph); });
  // grid
  g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = ink; g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const v = rl[0] + (rl[1] - rl[0]) * k / 4, y = Y(v, rl);
    g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.fillText(v.toFixed(Math.abs(rl[1] - rl[0]) < 5 ? 1 : 0), L - 6, y + 3);
  }
  if (Rm > 12) { g.textAlign = 'left'; for (let k = 0; k <= 4; k++) { const v = rr[0] + (rr[1] - rr[0]) * k / 4; g.fillText(v.toFixed(Math.abs(rr[1] - rr[0]) < 5 ? 2 : 0), L + pw + 6, Y(v, rr) + 3); } }
  // x labels
  if (opts.labels) {
    g.textAlign = 'center'; const step = Math.ceil(n / Math.max(2, Math.floor(pw / 58)));
    opts.labels.forEach((l, i) => { if (i % step === 0 || (i === n - 1 && (n - 1) % step >= step * 0.75)) g.fillText(l, X(i), h - 8); });
  }
  if (opts.yLabel) { g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(opts.yLabel, 0, 0); g.restore(); }
  // bars (e.g. precipitation)
  series.filter(s => s.bars).forEach(s => {
    const r = s.axis === 'right' ? rr : rl; g.fillStyle = s.color;
    s.values.forEach((v, i) => { if (!Number.isFinite(v) || v <= 0) return; const y = Y(v, r), y0 = Y(Math.max(r[0], 0), r); g.fillRect(X(i) - Math.max(1, pw / n * 0.35), y, Math.max(2, pw / n * 0.7), y0 - y); });
  });
  // lines
  series.filter(s => !s.bars).forEach(s => {
    const r = s.axis === 'right' ? rr : rl;
    if (s.fill) {
      g.beginPath(); let started = false;
      s.values.forEach((v, i) => { if (!Number.isFinite(v)) return; if (!started) { g.moveTo(X(i), Y(r[0], r)); started = true; } g.lineTo(X(i), Y(v, r)); });
      g.lineTo(X(s.values.length - 1), Y(r[0], r)); g.closePath();
      const grd = g.createLinearGradient(0, T, 0, T + ph); grd.addColorStop(0, s.color + '55'); grd.addColorStop(1, s.color + '00'); g.fillStyle = grd; g.fill();
    }
    g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dashed ? [5, 4] : []); g.lineJoin = 'round';
    g.beginPath(); let pen = false;
    s.values.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } pen ? g.lineTo(X(i), Y(v, r)) : g.moveTo(X(i), Y(v, r)); pen = true; });
    g.stroke(); g.setLineDash([]);
    if (s.dots !== false && s.values.length <= 40) s.values.forEach((v, i) => { if (!Number.isFinite(v)) return; g.fillStyle = s.color; g.beginPath(); g.arc(X(i), Y(v, r), 2.6, 0, 7); g.fill(); });
  });
  if (Number.isFinite(opts.cursor)) { g.strokeStyle = css('--accent') || '#5ff6ff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(opts.cursor), T); g.lineTo(X(opts.cursor), T + ph); g.stroke(); }
  (opts.marks || []).forEach(m => { g.fillStyle = m.color; g.beginPath(); g.arc(X(m.i), T + 6, 4, 0, 7); g.fill(); if (m.label) { g.textAlign = 'left'; g.fillText(m.label, X(m.i) + 7, T + 9); } });
  // legend
  let lx = L + 4; g.textAlign = 'left';
  series.forEach(s => { if (!s.label) return; g.fillStyle = s.color; g.fillRect(lx, 2, 10, 3); g.fillStyle = ink; g.fillText(s.label, lx + 14, 7); lx += g.measureText(s.label).width + 30; });
}

/** Polarimetric decision space ΔHH vs ΔHV with rule regions */
export function polarChart(canvas, point, label) {
  const { g, w, h } = prep(canvas);
  const ink = css('--ink-2') || '#9aa4b2', grid = css('--grid') || 'rgba(255,255,255,.07)';
  const L = 44, Rm = 14, T = 14, B = 34, pw = w - L - Rm, ph = h - T - B, lo = -8, hi = 6;
  const X = v => L + (v - lo) / (hi - lo) * pw, Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;
  const zone = (x0, x1, y0, y1, col, name) => { g.fillStyle = col; g.fillRect(X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)); g.fillStyle = ink; g.font = '600 10.5px Inter, system-ui'; g.textAlign = 'left'; g.fillText(name, X(x0) + 5, Y(y1) + 13); };
  zone(lo, -4.5, lo, -4, 'rgba(58,160,255,.20)', 'Open-water flood');
  zone(-4.5, -3, lo, -3, 'rgba(163,230,53,.16)', 'Agriculture');
  zone(2.5, hi, -2, 2, 'rgba(34,211,238,.18)', 'Flood under canopy');
  zone(-3, hi, lo, -3, 'rgba(245,158,11,.16)', 'Vegetation loss');
  g.strokeStyle = grid; g.lineWidth = 1; g.font = '500 11px Inter, system-ui'; g.fillStyle = ink;
  for (let v = lo; v <= hi; v += 2) {
    g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), T + ph); g.stroke(); g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(L + pw, Y(v)); g.stroke();
    g.textAlign = 'center'; g.fillText(v, X(v), T + ph + 14); g.textAlign = 'right'; g.fillText(v, L - 6, Y(v) + 3);
  }
  g.textAlign = 'center'; g.fillText('ΔHH (dB)', L + pw / 2, h - 4);
  g.save(); g.translate(12, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText('ΔHV (dB)', 0, 0); g.restore();
  if (point) {
    const x = X(Math.max(lo, Math.min(hi, point[0]))), y = Y(Math.max(lo, Math.min(hi, point[1])));
    const t = performance.now() / 600;
    g.fillStyle = 'rgba(255,93,115,.22)'; g.beginPath(); g.arc(x, y, 12 + 3 * Math.sin(t), 0, 7); g.fill();
    g.fillStyle = '#ff5d73'; g.beginPath(); g.arc(x, y, 5.5, 0, 7); g.fill();
    if (label) { g.fillStyle = css('--ink') || '#fff'; g.font = '600 11.5px Inter, system-ui'; g.textAlign = 'left'; g.fillText(label, L + 8, T + ph - 8); }
  }
}

/** Topp curve εr vs volumetric moisture, with readings */
export function toppChart(canvas, readings, toppTheta) {
  const { g, w, h } = prep(canvas);
  const ink = css('--ink-2') || '#9aa4b2', grid = css('--grid') || 'rgba(255,255,255,.07)';
  const L = 40, Rm = 12, T = 12, B = 30, pw = w - L - Rm, ph = h - T - B;
  const X = th => L + th / 60 * pw, Y = e => T + (1 - e / 40) * ph;
  g.strokeStyle = grid; g.fillStyle = ink; g.textAlign = 'right';
  for (let e = 0; e <= 40; e += 10) { g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(L + pw, Y(e)); g.stroke(); g.fillText(e, L - 6, Y(e) + 3); }
  g.textAlign = 'center'; for (let th = 0; th <= 60; th += 15) g.fillText(th + '%', X(th), T + ph + 14);
  g.fillText('Volumetric soil moisture θ', L + pw / 2, h - 3);
  g.save(); g.translate(11, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText('Dielectric εr', 0, 0); g.restore();
  g.strokeStyle = '#7dd3fc'; g.lineWidth = 2.2; g.beginPath();
  for (let e = 2; e <= 40; e += 0.5) { const th = toppTheta(e); if (th < 0 || th > 60) continue; const x = X(th), y = Y(e); e === 2 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  readings.forEach((r, i) => {
    const last = i === readings.length - 1; const x = X(Math.min(60, r.soil_moisture_pct)), y = Y(Math.min(40, r.dielectric_eps));
    g.fillStyle = last ? '#5ff6ff' : 'rgba(125,211,252,.35)'; g.beginPath(); g.arc(x, y, last ? 6 : 3, 0, 7); g.fill();
    if (last) { g.strokeStyle = 'rgba(95,246,255,.5)'; g.beginPath(); g.arc(x, y, 11, 0, 7); g.stroke(); }
  });
}
