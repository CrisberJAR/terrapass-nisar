/**
 * TerraPass physics engine
 *  - Scenario simulator (calibrated to NISAR L-band thresholds) used for guided demos
 *  - Robust z-score change detector (median / MAD)
 *  - 5 physical classification rules + 5-component confidence breakdown
 * Works on any HH/HV/coherence/displacement series: simulated OR real (NISAR GCOV stack).
 */
export const N = 48;          // grid cells per side
export const T = 12;          // passes in simulator (12-day cadence => 132 days)
export const D0 = Date.UTC(2026, 5, 13); // first simulated pass (13 Jun 2026)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const simDate = i => { const d = new Date(D0 + i * 12 * 864e5); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
export const fmtDate = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };

const hs = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const gn = (a, b, c) => hs(a, b, c) + hs(a, b, c + 97) + hs(a, b, c + 193) - 1.5;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y), m = s.length >> 1; if (!s.length) return NaN; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Robust z-score of a[t] against the baseline a[0..t-1] */
export function robustZ(a, t, minBase = 4) {
  const b = a.slice(0, t).filter(Number.isFinite);
  if (b.length < minBase || !Number.isFinite(a[t])) return 0;
  const m = median(b), d = Math.max(median(b.map(v => Math.abs(v - m))) * 1.4826, 0.6);
  return (a[t] - m) / d;
}

/* ---------------------------------------------------- scenario effects -- */
function effect(k, r, c, t) {
  const x = c / N, y = r / N; let a = 0, b = 0, q = 0, s = 0;
  if (k === 'ven') {
    // M7.2 / M7.5 doublet, 24 Jun 2026 -> pair 13 Jun - 25 Jun crosses the event (t>=1)
    const d = Math.hypot(x - 0.42, y - 0.5); if (d < 0.26 && t >= 1) { const m = 1 - d / 0.26; s = -38 * m; q = -0.3 * m * (t < 4 ? 1 : 0.6); a = -0.5 * m; }
    if (Math.abs(y - (0.74 + 0.08 * Math.sin(x * 9))) < 0.05 && x > 0.45 && (t === 6 || t === 7)) { a = -6; b = -5.2; q = -0.25; }
    if (Math.hypot(x - 0.75, y - 0.28) < 0.1 && t >= 8) { b = -5.5; a = -1.5; q = -0.2; }
  }
  if (k === 'per') {
    if (y > 0.3 && x < 0.8) { const f = (r / 6 | 0) * 9 + (c / 6 | 0), w = t - (5 + (hs(f, 3, 5) * 4 | 0)); if (w === 0 || w === 1) { a = -3.6; b = -3.3; q = -0.12; } }
    if (Math.hypot(x - 0.78, y - 0.18) < 0.13 && t >= 7 && t <= 9) { a = 4.6; b = 0.4; q = -0.25; }
  }
  return [a, b, q, s];
}

export function simSeries(k, r, c) {
  const S = { hh: [], hv: [], coh: [], disp: [] }, i = r * N + c, ct = k === 'ctl';
  for (let t = 0; t < T; t++) {
    const e = effect(k, r, c, t);
    S.hh.push((ct ? -12 : -8.5) + e[0] + gn(i, t, 1) * 0.9);
    S.hv.push((ct ? -21 : -15.5) + e[1] + gn(i, t, 2) * 0.9);
    S.coh.push(clamp((ct ? 0.7 : 0.62) + e[2] + gn(i, t, 3) * 0.1, 0.05, 0.95));
    S.disp.push(e[3] + gn(i, t, 4) * 2);
  }
  return S;
}

/* ------------------------------------------------------------ labels ---- */
export const KIND = {
  deformation: { name: 'Ground deformation', color: '#ff5d73', tech: 'Coherent phase compatible with line-of-sight displacement (d = −λΔφ / 4π).', plain: 'The ground moved. The surface shifted centimetres relative to the satellite — typical of an earthquake.' },
  flood_open: { name: 'Open-water flooding', color: '#3aa0ff', tech: 'HH and HV drop together and strongly: specular reflection on calm water.', plain: 'Water is probably covering the ground. Smooth water bounces the radar away, so the area "goes dark".' },
  flood_veg: { name: 'Flooding under canopy', color: '#22d3ee', tech: 'HH rises through trunk–water double bounce while HV barely changes.', plain: 'Water is probably hidden under the trees. An optical photo would miss it — L-band radar sees it.' },
  veg_loss: { name: 'Vegetation loss', color: '#f59e0b', tech: 'HV drops and stays low: the canopy scatters less volume energy.', plain: 'Part of the vegetation probably disappeared (logging, fire or clearing).' },
  ag_activity: { name: 'Agricultural activity', color: '#a3e635', tech: 'Abrupt parcel-scale change that later recovers.', plain: 'Probably farming activity, like flooding a rice paddy or ploughing. Sharp change, then recovery.' },
  unknown: { name: 'Unclassified change', color: '#c084fc', tech: 'Persistent change, but no physical rule fits.', plain: 'Something changed persistently but we cannot say what. Cross-check with another source.' }
};

function makeEvent(kind, t0, t1, magnitude, persistence, coh, agree, nBase, signal) {
  const parts = [
    ['Magnitude', 0.35 * clamp(magnitude / 6), 0.35],
    ['Persistence', 0.20 * clamp(persistence / 3), 0.20],
    ['Coherence', 0.20 * clamp((coh - 0.2) / 0.6), 0.20],
    ['Rules agreeing', 0.15 * clamp(agree / 2), 0.15],
    ['Baseline depth', 0.10 * clamp(nBase / 8), 0.10]
  ];
  return { kind, t0, t1, parts, conf: parts.reduce((s, p) => s + p[1], 0), signal };
}

/**
 * Classify a series S = {hh[], hv[], coh[], disp[]} (dB / unitless / mm).
 * opts.dates: labels per pass. opts.zThr: change threshold.
 */
export function classifySeries(S, opts = {}) {
  const n = S.hh.length, ev = [], zThr = opts.zThr ?? 3, minBase = opts.minBase ?? 4;
  const zh = S.hh.map((_, t) => robustZ(S.hh, t, minBase)), zv = S.hv.map((_, t) => robustZ(S.hv, t, minBase));
  if (S.disp?.length) {
    const td = S.disp.findIndex((d, t) => t > 0 && Math.abs(d) > 8 && (S.coh?.[t] ?? 1) > 0.25);
    if (td > 0) ev.push(makeEvent('deformation', 0, td, Math.abs(S.disp[td]) / 2, S.disp.slice(td).filter(d => Math.abs(d) > 8).length, S.coh?.[td] ?? 0.6, 2, td,
      `LOS displacement ≈ ${Math.abs(S.disp[td]).toFixed(0)} mm · interferometric pair crossing 24 Jun 2026`));
  }
  const on = t => Math.abs(zh[t]) > zThr || Math.abs(zv[t]) > zThr;
  const coh = S.coh?.length ? S.coh : S.hh.map(() => 0.6);
  for (let t = minBase; t < n;) {
    if (!on(t)) { t++; continue; }
    let e = t; while (e + 1 < n && on(e + 1)) e++;
    if (e > t || opts.allowSingle) {
      const w = (a, i, j) => median(a.slice(i, j));
      const dh = w(S.hh, t, e + 1) - w(S.hh, 0, t), dv = w(S.hv, t, e + 1) - w(S.hv, 0, t), dc = w(coh, t, e + 1) - w(coh, 0, t), len = e - t + 1;
      let kind = 'unknown', ag = 0;
      if (dh < -4.5 && dv < -4) { kind = 'flood_open'; ag = [dh < -4.5, dv < -4, dc < -0.1].filter(Boolean).length; }
      else if (dh < -3 && dv < -3) { kind = 'ag_activity'; ag = [dh < -3, dv < -3, len <= 3].filter(Boolean).length; }
      else if (dh > 2.5 && Math.abs(dv) < 2) { kind = 'flood_veg'; ag = [dh > 2.5, Math.abs(dv) < 2, dc < -0.1].filter(Boolean).length; }
      else if (dv < -3 && dh > -3) { kind = 'veg_loss'; ag = [dv < -3, dv - dh < -2, len >= 3].filter(Boolean).length; }
      ev.push(makeEvent(kind, t, e, Math.max(Math.abs(zh[t]), Math.abs(zv[t])), len, w(coh, t, e + 1), ag, t,
        `ΔHH ${dh.toFixed(1)} dB · ΔHV ${dv.toFixed(1)} dB${S.coh?.length ? ` · Δγ ${dc.toFixed(2)}` : ''}`));
    }
    t = e + 1;
  }
  return { ev, zh, zv };
}

/* ------------------------------------------- precomputed simulator maps -- */
const SC = {};
export function simMaps(k) {
  if (SC[k]) return SC[k];
  const chg = [], coh = [];
  for (let t = 0; t < T; t++) { chg.push(new Float32Array(N * N)); coh.push(new Float32Array(N * N)); }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const S = simSeries(k, r, c), i = r * N + c;
    for (let t = 0; t < T; t++) {
      chg[t][i] = clamp(Math.max(Math.abs(robustZ(S.hh, t)), Math.abs(robustZ(S.hv, t)), Math.abs(S.disp[t]) / 5) / 6);
      coh[t][i] = clamp((0.72 - S.coh[t]) / 0.5);
    }
  }
  return (SC[k] = { chg, coh });
}

/** Topp et al. (1980) dielectric model: εr from volumetric soil moisture */
export function toppEps(moistPct) {
  const th = moistPct / 100;
  // inverse of θ = -5.3e-2 + 2.92e-2 ε - 5.5e-4 ε² + 4.3e-6 ε³ solved by Newton
  let e = 10;
  for (let i = 0; i < 30; i++) {
    const f = -0.053 + 0.0292 * e - 0.00055 * e * e + 0.0000043 * e * e * e - th;
    const df = 0.0292 - 0.0011 * e + 0.0000129 * e * e;
    e -= f / df;
  }
  return clamp(e, 2, 80);
}
export const toppTheta = e => (-0.053 + 0.0292 * e - 0.00055 * e * e + 0.0000043 * e ** 3) * 100;
