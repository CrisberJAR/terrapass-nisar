/**
 * Real NISAR data layer
 *  - queries NASA CMR (via /api/nisar/granules) for L2 GCOV (backscatter) and GUNW (interferograms)
 *  - builds a consistent repeat-pass stack (same track / frame / direction / polarisation)
 *  - loads ASF browse quicklooks (same-origin proxy), georeferences them with the granule footprint
 *    and crops / samples them over the study area -> drapes on the 3D terrain + real change map
 */
import { N, median, robustZ, clamp } from './engine.js';

const jget = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

export async function getGranules({ aoi, lat, lon, product = 'GCOV', limit = 120 }) {
  const q = new URLSearchParams({ product, limit: String(limit) });
  if (aoi) q.set('aoi', aoi); else { q.set('lat', lat); q.set('lon', lon); }
  return (await jget(`/api/nisar/granules?${q}`)).granules;
}

const dayOf = iso => iso.slice(0, 10);
/** choose the longest repeat-pass stack (same geometry) and keep 1 granule per date */
export function pickStack(granules, maxN = 10) {
  const groups = new Map();
  for (const g of granules) {
    if (!g.browse || !g.polygon) continue;
    const key = [g.product, g.track, g.direction, g.frame, g.polarization].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  let best = [];
  for (const arr of groups.values()) if (arr.length > best.length) best = arr;
  const byDate = new Map();
  for (const g of best) {
    const d = g.product === 'GUNW' ? `${g.reference}_${g.secondary}` : dayOf(g.start);
    const prev = byDate.get(d);
    if (!prev || g.id > prev.id) byDate.set(d, g); // keep latest processing version (…_002 > …_001)
  }
  return [...byDate.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-maxN);
}

/* ------------------------------------------------------- browse images -- */
const imgCache = new Map();
export function loadBrowse(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // find the valid-data bounding box (not transparent, not white background)
      const s = 4, w = Math.ceil(img.width / s), h = Math.ceil(img.height / s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1; const rs = [], gs = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!valid(d[i], d[i + 1], d[i + 2], d[i + 3])) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if ((x + y) % 3 === 0) { rs.push(d[i]); gs.push(d[i + 1]); }
      }
      resolve({ img, bbox: { x0: x0 * s, y0: y0 * s, x1: Math.min(img.width, (x1 + 1) * s), y1: Math.min(img.height, (y1 + 1) * s) }, medR: median(rs), medG: median(gs) });
    };
    img.onerror = () => reject(new Error('browse load failed'));
    img.src = `/api/nisar/browse?u=${encodeURIComponent(url)}`;
  });
  imgCache.set(url, p);
  p.catch(() => imgCache.delete(url));
  return p;
}
const valid = (r, g, b, a) => a > 8 && !(r > 248 && g > 248 && b > 248);

function polyBBox(poly) {
  let w = 180, e = -180, s = 90, n = -90;
  for (const [lon, lat] of poly) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat); }
  return { w, e, s, n };
}

/** Crop a browse image to a lon/lat extent -> canvas (nodata transparent) */
export function cropToExtent(b, polygon, ext, outW = 768, outH = 768) {
  const pb = polyBBox(polygon), bb = b.bbox;
  const fx = lon => bb.x0 + (lon - pb.w) / (pb.e - pb.w) * (bb.x1 - bb.x0);
  const fy = lat => bb.y0 + (pb.n - lat) / (pb.n - pb.s) * (bb.y1 - bb.y0);
  const sx = fx(ext.west), sy = fy(ext.north), sw = fx(ext.east) - sx, sh = fy(ext.south) - sy;
  const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  // manual clipping of the source rectangle for consistent cross-browser behaviour
  const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(b.img.width, sx + sw), cy1 = Math.min(b.img.height, sy + sh);
  if (cx1 > cx0 && cy1 > cy0) {
    const dx = (cx0 - sx) / sw * outW, dy = (cy0 - sy) / sh * outH, dw = (cx1 - cx0) / sw * outW, dh = (cy1 - cy0) / sh * outH;
    cx.drawImage(b.img, cx0, cy0, cx1 - cx0, cy1 - cy0, dx, dy, dw, dh);
  }
  const im = cx.getImageData(0, 0, outW, outH), d = im.data;
  let validCount = 0;
  for (let i = 0; i < d.length; i += 4) { if (!valid(d[i], d[i + 1], d[i + 2], d[i + 3])) d[i + 3] = 0; else validCount++; }
  cx.putImageData(im, 0, 0);
  return { canvas: cv, coverage: validCount / (outW * outH) };
}

/** average R (≈HH) and G (≈HV) per grid cell -> pseudo-dB normalised by scene median */
function sampleGrid(crop, b) {
  const W = crop.width, H = crop.height, d = crop.getContext('2d').getImageData(0, 0, W, H).data;
  const hh = new Float32Array(N * N).fill(NaN), hv = new Float32Array(N * N).fill(NaN);
  const toDb = (v, m) => 20 * Math.log10((v + 4) / (m + 4)); // relative dB vs scene median
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    let sr = 0, sg = 0, n = 0;
    const y0 = Math.floor(r * H / N), y1 = Math.floor((r + 1) * H / N), x0 = Math.floor(c * W / N), x1 = Math.floor((c + 1) * W / N);
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * W + x) * 4; if (d[i + 3] === 0) continue; sr += d[i]; sg += d[i + 1]; n++;
    }
    if (n > 3) { hh[r * N + c] = toDb(sr / n, b.medR); hv[r * N + c] = toDb(sg / n, b.medG); }
  }
  return { hh, hv };
}

/**
 * Build a real repeat-pass stack over an extent.
 * returns { granules, dates[], crops[], hh[t][i], hv[t][i], chg[t][i] }
 */
export async function buildStack(granules, ext, { onProgress, sample = true } = {}) {
  const out = { granules: [], crops: [], hh: [], hv: [], chg: [], coverage: [] };
  let done = 0;
  const loaded = await Promise.all(granules.map(async g => {
    try { const b = await loadBrowse(g.browse); onProgress?.(++done / granules.length); return { g, b }; }
    catch { onProgress?.(++done / granules.length); return null; }
  }));
  for (const item of loaded) {
    if (!item) continue;
    const { canvas, coverage } = cropToExtent(item.b, item.g.polygon, ext);
    if (coverage < 0.05) continue;
    out.granules.push(item.g); out.crops.push(canvas); out.coverage.push(coverage);
    if (sample) { const s = sampleGrid(canvas, item.b); out.hh.push(s.hh); out.hv.push(s.hv); }
  }
  if (sample && out.hh.length) {
    const nT = out.hh.length;
    for (let t = 0; t < nT; t++) {
      const m = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) {
        const a = out.hh.map(x => x[i]), v = out.hv.map(x => x[i]);
        m[i] = clamp(Math.max(Math.abs(robustZ(a, t, 3)), Math.abs(robustZ(v, t, 3))) / 6);
      }
      out.chg.push(m);
    }
  }
  return out;
}

/** series of one cell from a real stack -> classifier input */
export function cellSeries(stack, r, c) {
  const i = r * N + c;
  return { hh: stack.hh.map(x => x[i]), hv: stack.hv.map(x => x[i]), coh: [], disp: [] };
}
