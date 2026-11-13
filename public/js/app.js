/**
 * TerraPass v3 · main orchestrator
 */
import { createGlobe } from './globe.js';
import { createTerrain } from './terrain.js';
import { N, T, simSeries, simMaps, simDate, fmtDate, classifySeries, KIND, median, toppTheta, clamp } from './engine.js';
import { getGranules, pickStack, buildStack, cellSeries } from './nisar.js';
import { lineChart, polarChart, toppChart } from './charts.js';
import * as calval from './calval.js';

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const jget = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------ settings -- */
const AOIS = {
  ven: { key: 'ven', short: 'Venezuela', tag: 'M7.2 quake · InSAR', name: 'Venezuela · Yaracuy–Carabobo fault zone', lat: 10.45, lon: -68.45, zoom: 9, tiles: 3, focus: ['2026-05-01', '2026-09-20'], layer: 'gunw' },
  per: { key: 'per', short: 'Peru', tag: 'rice & flooded forest', name: 'Peru · Huallaga–Mayo rice valley (San Martín)', lat: -6.45, lon: -76.4, zoom: 10, tiles: 3, focus: null, layer: 'gcov' },
  ctl: { key: 'ctl', short: 'Atacama', tag: 'stable control', name: 'Chile · Atacama hyper-arid control', lat: -24.1, lon: -69.9, zoom: 10, tiles: 3, focus: null, layer: 'rchg' }
};
const LAYERS = {
  gunw: { label: 'Interferogram', sub: 'NISAR GUNW', kind: 'real' },
  gcov: { label: 'Backscatter', sub: 'NISAR GCOV HH/HV', kind: 'real' },
  rchg: { label: 'Change z-score', sub: 'GCOV stack', kind: 'real' },
  schg: { label: 'Change', sub: 'physics scenario', kind: 'sim' },
  scoh: { label: 'Coherence loss', sub: 'scenario', kind: 'sim' }
};
const isReal = l => LAYERS[l].kind === 'real';

const state = { aoi: 'ven', layer: 'gunw', t: 0, sel: [24, 20], data: {}, playing: null, cfg: null, eonet: [], loadingToken: 0 };

/* ------------------------------------------------------- boot + globe -- */
let globe, terrain;
async function boot() {
  try { state.cfg = await jget('/api/config'); } catch { state.cfg = {}; }
  globe = createGlobe($('#globe'), { startLat: -2, startLon: -72, startDist: 3.2, shiftX: 0.2 });
  setTimeout(() => $('#boot').classList.add('gone'), 900);
  const now = new Date();
  $('#sunInfo').textContent = `Real-time day/night terminator · ${now.toUTCString().slice(5, 22)} UTC`;
  globe.setAois(Object.values(AOIS), a => { selectAoi(a.key); $('#explorer').scrollIntoView({ behavior: 'smooth' }); });

  jget('/api/nisar/stats').then(s => { $('#stGranules').textContent = s.total.toLocaleString('en-US'); setChip('#chipCmr', true, `NASA CMR · ${s.total.toLocaleString('en-US')} granules`); })
    .catch(() => setChip('#chipCmr', false, 'NASA CMR offline'));
  jget('/api/nisar/recent').then(r => globe.setFootprints(r.granules)).catch(() => {});
  jget('/api/eonet?days=60').then(r => { state.eonet = r.events; globe.setEvents(r.events); $('#stEvents').textContent = r.events.length; renderEonet(); }).catch(() => { $('#eonetList').innerHTML = '<li>EONET unavailable</li>'; });

  terrain = createTerrain($('#stage'));
  window.__tp = { globe, terrain, state };
  terrain.onPick((r, c) => { state.sel = [r, c]; renderPassport(); });
  buildTabs();
  selectAoi('ven');

  // Cal/Val
  calval.onReading((row, live) => { renderCalval(row, live); });
  const ok = await calval.initSupabase(state.cfg);
  setChip('#chipSb', ok, ok ? 'Supabase Realtime' : 'Cal/Val local mode');
  renderCalval();
  wireUi();
  reveal();
}

function setChip(sel, on, text) { const c = $(sel); c.classList.toggle('on', on); c.classList.toggle('off', !on); c.innerHTML = `<i class="dot"></i>${esc(text)}`; }

/* --------------------------------------------------------------- tabs -- */
function buildTabs() {
  const at = $('#aoiTabs'); at.innerHTML = '';
  Object.values(AOIS).forEach(a => { const b = el('button', '', `${a.short}<small>${a.tag}</small>`); b.dataset.k = a.key; b.onclick = () => selectAoi(a.key); at.appendChild(b); });
  const lt = $('#layerTabs'); lt.innerHTML = '';
  Object.entries(LAYERS).forEach(([k, l]) => { const b = el('button', l.kind, `${l.label}<small>${l.sub}</small>`); b.dataset.k = k; b.onclick = () => setLayer(k); lt.appendChild(b); });
}
function syncTabs() {
  document.querySelectorAll('#aoiTabs button').forEach(b => b.classList.toggle('active', b.dataset.k === state.aoi));
  document.querySelectorAll('#layerTabs button').forEach(b => b.classList.toggle('active', b.dataset.k === state.layer));
}

/* ------------------------------------------------------------- loading -- */
const loading = (on, text = '', p = null) => {
  $('#stageLoading').classList.toggle('hide', !on);
  if (text) $('#loadText').textContent = text;
  if (p != null) $('#loadBar').style.width = `${Math.round(p * 100)}%`;
};

const inFocus = (a, g) => !a.focus || (g.start >= a.focus[0] && g.start <= a.focus[1] + 'T23:59:59Z');

async function selectAoi(key, opts = {}) {
  const a = AOIS[key]; state.aoi = key; stopPlay();
  const token = ++state.loadingToken;
  state.layer = opts.layer || a.layer; syncTabs();
  $('#hudAoi').textContent = a.name; $('#hudMeta').textContent = `${a.lat.toFixed(2)}°, ${a.lon.toFixed(2)}° · loading…`;
  $('#quakeAoi').textContent = a.short;
  loading(true, 'Building 3D digital twin…', 0.05);
  let D = state.data[key];
  if (!D) {
    D = state.data[key] = {};
    const info = await terrain.load(a, s => s && loading(true, s, 0.15));
    D.info = info; D.extent = info.extent;
    if (token !== state.loadingToken) return;
    loading(true, 'Querying NASA CMR for NISAR granules…', 0.3);
    const [gcovAll, gunwAll, quakes, power] = await Promise.all([
      getGranules({ aoi: null, lat: a.lat, lon: a.lon, product: 'GCOV', limit: 150 }).catch(() => []),
      getGranules({ aoi: null, lat: a.lat, lon: a.lon, product: 'GUNW', limit: 150 }).catch(() => []),
      jget(`/api/quakes?lat=${a.lat}&lon=${a.lon}&km=300`).then(r => r.quakes).catch(() => []),
      calval.getPower(a.lat, a.lon).catch(() => null)
    ]);
    Object.assign(D, { gcovAll, gunwAll, quakes, power });
    const gcovSel = pickStack(gcovAll.filter(g => inFocus(a, g)), 10);
    const gunwSel = pickStack(gunwAll.filter(g => inFocus(a, g)), 10);
    const total = gcovSel.length + gunwSel.length || 1; let done = 0;
    const prog = () => loading(true, `Georeferencing NISAR quicklooks (${done}/${total})…`, 0.35 + 0.6 * (done / total));
    const step = n => () => { done++; prog(); };
    [D.gunw, D.gcov] = await Promise.all([
      gunwSel.length ? buildStack(gunwSel, D.extent, { sample: false, onProgress: step() }) : null,
      gcovSel.length ? buildStack(gcovSel, D.extent, { onProgress: step() }) : null
    ]);
    // coseismic pair: GUNW reference < M>=6 quake < secondary
    D.bigQuakes = quakes.filter(q => q.mag >= 6);
    D.coseismic = -1;
    if (D.gunw) D.gunw.granules.forEach((g, i) => { if (D.bigQuakes.some(q => spans(g, q.time))) { if (D.coseismic < 0) D.coseismic = i; } });
  } else {
    await terrain.load(a);
  }
  if (token !== state.loadingToken) return;
  const w = D.info.widthKm;
  $('#hudMeta').textContent = `${a.lat.toFixed(2)}°, ${a.lon.toFixed(2)}° · ${w.toFixed(0)} × ${w.toFixed(0)} km · cell ${(w / N).toFixed(1)} km · relief ×${D.info.exag.toFixed(1)}`;
  // fall back if a real layer is empty
  if (state.layer === 'gunw' && !D.gunw?.crops.length) state.layer = D.gcov?.crops.length ? 'gcov' : 'schg';
  if ((state.layer === 'gcov' || state.layer === 'rchg') && !D.gcov?.crops.length) state.layer = 'schg';
  state.t = opts.t ?? defaultT(state.layer);
  if (opts.cell) state.sel = opts.cell; else if (!opts.keepSel) state.sel = defaultCell(key);
  terrain.setSelected(...state.sel);
  loading(false);
  syncTabs(); renderLayer(); renderPassport(); renderNisarSection(); renderPower(); renderQuakes();
  terrain.scanPass();
}

const parseNisarTime = s => s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : null;
const spans = (g, iso) => g.reference && g.secondary && parseNisarTime(g.reference) <= iso && iso <= parseNisarTime(g.secondary);
const defaultCell = k => k === 'ven' ? [24, 20] : k === 'per' ? [30, 10] : [24, 24];

function stepsFor(layer) {
  const D = state.data[state.aoi] || {};
  if (layer === 'gunw') return D.gunw?.crops.length || 0;
  if (layer === 'gcov' || layer === 'rchg') return D.gcov?.crops.length || 0;
  return T;
}
function defaultT(layer) {
  const D = state.data[state.aoi] || {}, n = stepsFor(layer);
  if (layer === 'gunw' && D.coseismic >= 0) return D.coseismic;
  if (layer === 'schg' || layer === 'scoh') return state.aoi === 'per' ? 6 : 1;
  return Math.max(0, n - 1);
}

function setLayer(k) {
  const D = state.data[state.aoi]; if (!D) return;
  if (k === 'gunw' && !D.gunw?.crops.length) return toast('No NISAR interferograms indexed for this area yet');
  if ((k === 'gcov' || k === 'rchg') && !D.gcov?.crops.length) return toast('No NISAR GCOV stack for this area yet');
  const wasReal = isReal(state.layer);
  state.layer = k; if (isReal(k) !== wasReal || state.t >= stepsFor(k)) state.t = defaultT(k);
  syncTabs(); renderLayer(); renderPassport(); markFilmstrip();
}

function setT(t) { state.t = Math.max(0, Math.min(stepsFor(state.layer) - 1, t)); renderLayer(); renderPassport(); markFilmstrip(); }

/* ------------------------------------------------------- layer render -- */
function renderLayer() {
  const D = state.data[state.aoi]; if (!D) return;
  const L = state.layer, t = state.t, n = stepsFor(L);
  const sl = $('#tSlider'); sl.max = Math.max(0, n - 1); sl.value = t;
  let date = '—', info = '';
  if (L === 'gunw') {
    const g = D.gunw.granules[t]; terrain.setImage(D.gunw.crops[t], 0.86); terrain.setChange(null);
    date = `${fmtDate(parseNisarTime(g.reference))} → ${fmtDate(parseNisarTime(g.secondary))}`;
    const q = D.bigQuakes?.find(q => spans(g, q.time));
    info = `Track ${g.track} ${g.direction} · frame ${g.frame}${q ? ` · spans USGS M${q.mag.toFixed(1)}` : ''}`;
  } else if (L === 'gcov' || L === 'rchg') {
    const g = D.gcov.granules[t];
    if (L === 'gcov') { terrain.setImage(D.gcov.crops[t], 0.92); terrain.setChange(null); }
    else { terrain.setImage(D.gcov.crops[t], 0.28); terrain.setChange(t >= 3 ? D.gcov.chg[t] : new Float32Array(N * N)); }
    date = fmtDate(g.start); info = `Track ${g.track} ${g.direction} · ${g.polarization} · pass ${t + 1}/${n}${L === 'rchg' && t < 3 ? ' · building baseline' : ''}`;
  } else {
    const M = simMaps(state.aoi); terrain.setImage(null);
    terrain.setChange(L === 'schg' ? M.chg[t] : M.coh[t]);
    date = simDate(t) + ' 2026'; info = `Physics scenario · pass ${t + 1}/${T} · 12-day cadence`;
  }
  $('#tDate').textContent = date; $('#tInfo').textContent = info;
  $('#hudLegend').innerHTML = legendHtml(L);
}

function legendHtml(L) {
  const src = isReal(L) ? '<span class="badge real">REAL · NASA/ASF</span>' : '<span class="badge sim">MODEL · calibrated scenario</span>';
  if (L === 'gunw') return `${src}<div class="ramp" style="background:linear-gradient(90deg,#3b0f4f,#5b6bd6,#f2f2f2,#d9772b,#5a1a0a,#3b0f4f)"></div><div class="ends"><span>0</span><span>2π</span></div><small>1 colour cycle = 1 fringe of ground motion</small>`;
  if (L === 'gcov') return `${src}<div class="ramp" style="background:linear-gradient(90deg,#000,#c050c0,#e0e0e0,#7ad07a)"></div><div class="ends"><span>dark (water)</span><span>HH</span><span>HV (veg.)</span></div>`;
  return `${src}<div class="ramp" style="background:linear-gradient(90deg,#ffdc33,#ff5a26,#d91a8c)"></div><div class="ends"><span>${L === 'scoh' ? 'coherence loss' : 'change'} low</span><span>high</span></div>`;
}

/* ------------------------------------------------------------ passport -- */
const hav = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
function cellLatLon(r, c) { const e = state.data[state.aoi].extent; return { lat: e.north - (r + 0.5) / N * (e.north - e.south), lon: e.west + (c + 0.5) / N * (e.east - e.west) }; }

let lastPassport = null;
function computePassport() {
  const D = state.data[state.aoi]; if (!D) return null;
  const [r, c] = state.sel, ll = cellLatLon(r, c), real = isReal(state.layer) && D.gcov?.hh.length;
  let S, labels, ev = [], source;
  if (real) {
    S = cellSeries(D.gcov, r, c); labels = D.gcov.granules.map(g => fmtDate(g.start)); S.dates = D.gcov.granules.map(g => g.start.slice(0, 10));
    ev = classifySeries(S, { minBase: 3, zThr: 2.5 }).ev; source = 'real';
  } else {
    S = simSeries(state.aoi, r, c); labels = Array.from({ length: T }, (_, i) => simDate(i)); S.dates = labels;
    ev = classifySeries(S).ev; source = 'sim';
  }
  // evidence fusion
  const evidence = [];
  const near = D.quakes.map(q => ({ ...q, km: hav(ll.lat, ll.lon, q.lat, q.lon) })).sort((a, b) => a.km - b.km);
  const big = near.filter(q => q.mag >= 6 && q.km < 120);
  if (big.length) {
    const q = big[0], pairs = (D.gunwAll || []).filter(g => spans(g, q.time));
    evidence.push({ cls: 'hit', text: `USGS M${q.mag.toFixed(1)} · ${q.place} · ${q.km.toFixed(0)} km from this cell (${q.time.slice(0, 10)})` });
    if (pairs.length) {
      evidence.push({ cls: 'hit', text: `${pairs.length} real NISAR interferogram(s) span this event — e.g. ${fmtDate(parseNisarTime(pairs[0].reference))} → ${fmtDate(parseNisarTime(pairs[0].secondary))}, track ${pairs[0].track}` });
      if (real && !ev.some(e => e.kind === 'deformation')) {
        const prox = clamp(1 - q.km / 120);
        const parts = [['Magnitude', 0.35 * clamp((q.mag - 5) / 2.5), 0.35], ['Persistence', 0.2 * clamp(pairs.length / 2), 0.2], ['Coherence', 0.2 * 0.6, 0.2], ['Rules agreeing', 0.15 * prox, 0.15], ['Baseline depth', 0.1 * clamp((D.gcov?.hh.length || 0) / 8), 0.1]];
        ev.unshift({ kind: 'deformation', t0: 0, t1: 0, parts, conf: parts.reduce((s, p) => s + p[1], 0), signal: `Coseismic GUNW pair + USGS M${q.mag.toFixed(1)} at ${q.km.toFixed(0)} km` });
      }
    }
  } else if (near[0]) evidence.push({ cls: 'ok', text: `Nearest USGS M${near[0].mag.toFixed(1)} event ${near[0].km.toFixed(0)} km away — no major shaking at this cell` });
  else evidence.push({ cls: 'ok', text: 'No USGS M≥3 earthquakes within 300 km in the last 12 months' });
  const eo = state.eonet.map(e => ({ ...e, km: hav(ll.lat, ll.lon, e.lat, e.lon) })).filter(e => e.km < 150).sort((a, b) => a.km - b.km);
  evidence.push(eo.length ? { cls: 'warn', text: `NASA EONET: ${eo[0].category} “${eo[0].title}” ${eo[0].km.toFixed(0)} km away (${(eo[0].date || '').slice(0, 10)})` } : { cls: 'ok', text: 'NASA EONET: no natural events within 150 km in the last 60 days' });
  const iot = calval.latestByAoi[state.aoi];
  if (iot) evidence.push({ cls: iot.local_regime?.includes('STABLE') ? 'ok' : 'warn', text: `IoT ${iot.node_id}: θ ${(+iot.soil_moisture_pct).toFixed(1)}% · εr ${iot.dielectric_eps} · ${(+iot.vibration_g).toFixed(3)} g · ${iot.local_regime}` });
  else evidence.push({ cls: '', text: 'IoT Cal/Val: no reading yet for this area — emit one in section 03' });
  if (D.power?.days?.length) {
    const last30 = D.power.days.slice(-30), rain = last30.reduce((s, d) => s + (d.precip || 0), 0), wet = median(last30.map(d => d.gwettop));
    evidence.push({ cls: wet > 0.6 ? 'warn' : 'ok', text: `NASA POWER (30 d): rain ${rain.toFixed(0)} mm · surface soil wetness ${(wet * 100).toFixed(0)}%` });
  }
  ev.forEach(e => { e.name = KIND[e.kind].name; e.plain = KIND[e.kind].plain; });
  return { r, c, ll, S, labels, ev, evidence, source };
}

function renderPassport() {
  const P = computePassport(); if (!P) return; lastPassport = P;
  const { r, c, ll, S, labels, ev, evidence, source } = P;
  $('#ppTitle').textContent = `Cell [${r}, ${c}]`;
  $('#ppCoords').textContent = `${ll.lat.toFixed(4)}°, ${ll.lon.toFixed(4)}° · ${AOIS[state.aoi].short}`;
  const b = $('#ppSource'); b.className = `badge ${source}`; b.textContent = source === 'real' ? `REAL · ${S.hh.length} NISAR passes` : 'MODEL · scenario';
  const series = [
    { values: S.hh, color: '#ff8fd8', label: source === 'real' ? 'HH (rel. dB)' : 'HH (dB)' },
    { values: S.hv, color: '#7ee787', label: source === 'real' ? 'HV (rel. dB)' : 'HV (dB)' }
  ];
  if (S.coh?.length) series.push({ values: S.coh, color: '#5ff6ff', label: 'Coherence γ', axis: 'right', dashed: true, dots: false });
  const sameAxis = isReal(state.layer) === (source === 'real');
  lineChart($('#ppChart'), series, { labels, cursor: sameAxis && state.t < S.hh.length ? state.t : undefined, spans: ev.filter(e => e.t1 > 0).map(e => ({ i0: e.t0, i1: e.t1, color: KIND[e.kind].color + '22' })) });
  const box = $('#ppEvents'); box.innerHTML = '';
  if (!ev.length) box.appendChild(el('div', 'ev', `<div class="ev-top"><b style="color:var(--green)">No significant change</b><span>stable</span></div><small>${source === 'real' ? 'Robust z-score below threshold on every pass of the real NISAR stack.' : 'All passes within the natural variability of the baseline.'}</small>`)).style.setProperty('--c', 'var(--green)');
  ev.slice(0, 3).forEach(e => {
    const d = el('div', 'ev'); d.style.setProperty('--c', KIND[e.kind].color);
    const when = e.t1 > 0 ? ` · passes ${e.t0 + 1}–${e.t1 + 1} (${labels[e.t0]} → ${labels[e.t1]})` : '';
    d.innerHTML = `<div class="ev-top"><b>${e.name}</b><span>${Math.round(e.conf * 100)}% ${e.conf >= 0.7 ? 'high' : e.conf >= 0.45 ? 'medium' : 'low'}</span></div><small>${esc(e.signal)}${when}</small>
      <div class="parts">${e.parts.map(p => `<span>${p[0]}</span><div class="pb"><i style="width:${(p[1] / p[2] * 100).toFixed(0)}%"></i></div><span>${(p[1] * 100).toFixed(0)}</span>`).join('')}</div>`;
    box.appendChild(d);
  });
  $('#ppPlain').textContent = ev[0] ? `In plain words: ${ev[0].plain}` : 'In plain words: this place looks the same as before. A passport that can say "nothing happened" is as valuable as one that raises an alarm.';
  $('#ppEvidence').innerHTML = evidence.map(e => `<li class="${e.cls}">${esc(e.text)}</li>`).join('');
  $('#ppNote').textContent = source === 'real' ? 'Real series sampled from ASF browse quicklooks (relative dB vs. scene median).' : 'Scenario series from the calibrated physics simulator (used for the guided demo).';
  // polarimetric point
  const t = Math.min(state.t, S.hh.length - 1), bh = median(S.hh.slice(0, Math.max(1, t))), bv = median(S.hv.slice(0, Math.max(1, t)));
  polarPoint = Number.isFinite(S.hh[t]) ? [S.hh[t] - bh, S.hv[t] - bv] : null;
  polarLabel = polarPoint ? `Cell [${r},${c}] · ΔHH ${polarPoint[0].toFixed(1)} dB · ΔHV ${polarPoint[1].toFixed(1)} dB` : 'No valid radar sample at this cell';
}
let polarPoint = null, polarLabel = '';

/* ----------------------------------------------------- NISAR section -- */
function thumb(canvas) { const c = document.createElement('canvas'); c.width = 256; c.height = 216; c.getContext('2d').drawImage(canvas, 0, 0, 256, 216); return c.toDataURL('image/png'); }
function renderNisarSection() {
  const D = state.data[state.aoi];
  const fill = (box, stack, layer, infoSel) => {
    box.innerHTML = '';
    if (!stack?.crops.length) { box.innerHTML = '<p class="note">No granules indexed for this area yet.</p>'; $(infoSel).textContent = ''; return; }
    $(infoSel).textContent = `· ${stack.crops.length} passes · track ${stack.granules[0].track} ${stack.granules[0].direction}`;
    stack.crops.forEach((cv, i) => {
      const g = stack.granules[i], q = layer === 'gunw' && D.bigQuakes?.some(q => spans(g, q.time));
      const f = el('div', `frame${q ? ' quake' : ''}`, `<img alt="NISAR ${layer} ${g.start.slice(0, 10)}" src="${thumb(cv)}"><span>${layer === 'gunw' ? `${fmtDate(parseNisarTime(g.reference))}→${fmtDate(parseNisarTime(g.secondary)).slice(0, 6)}` : fmtDate(g.start)}${q ? ' ⚡' : ''}</span>`);
      f.dataset.layer = layer; f.dataset.t = i;
      f.onclick = () => { if (state.layer !== layer) { state.layer = layer; syncTabs(); } setT(i); terrain.scanPass(); $('#explorer').scrollIntoView({ behavior: 'smooth' }); };
      box.appendChild(f);
    });
  };
  fill($('#fsGunw'), D.gunw, 'gunw', '#fsGunwInfo');
  fill($('#fsGcov'), D.gcov, 'gcov', '#fsGcovInfo');
  markFilmstrip();
  const rows = [...(D.gunwAll || []), ...(D.gcovAll || [])].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 80);
  $('#granTable tbody').innerHTML = rows.map(g => `<tr><td><b>${g.start.slice(0, 16).replace('T', ' ')}</b></td><td>${g.product}${g.product === 'GUNW' ? ` <small>${fmtDate(parseNisarTime(g.reference))}→${fmtDate(parseNisarTime(g.secondary))}</small>` : ''}</td><td>${g.track} / ${g.frame}</td><td>${g.direction}</td><td>${g.polarization || '—'}</td><td>${g.sizeMB ? (g.sizeMB / 1024).toFixed(2) + ' GB' : '—'}</td><td>${g.browse ? `<a href="${esc(g.browse)}" target="_blank" rel="noopener">browse</a>` : ''} ${g.data ? `· <a href="${esc(g.data)}" target="_blank" rel="noopener">HDF5</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No granules</td></tr>';
}
function markFilmstrip() { document.querySelectorAll('.frame').forEach(f => f.classList.toggle('active', f.dataset.layer === state.layer && +f.dataset.t === state.t)); }

/* ------------------------------------------------------------ calval --- */
function renderCalval(row, live) {
  const r = row || calval.logs[0];
  const m = $('#metrics');
  if (r) {
    $('#nodeId').textContent = r.node_id; $('#nodeRegime').textContent = r.local_regime;
    const items = [['Soil moisture θ', (+r.soil_moisture_pct).toFixed(1), '%'], ['Water level', (+r.water_level_cm).toFixed(1), 'cm'], ['Dielectric εr', (+r.dielectric_eps).toFixed(1), ''], ['Air temp.', (+r.ambient_temp_c).toFixed(1), '°C'],
      ['Air humidity', (+r.air_humidity_pct).toFixed(0), '%'], ['IMU vibration', (+r.vibration_g).toFixed(3), 'g'], ['Tilt', (+r.tilt_deg).toFixed(2), '°'], ['AOI', r.aoi_id?.toUpperCase(), '']];
    m.innerHTML = items.map(i => `<div class="metric${live || row ? ' pulse' : ''}"><small>${i[0]}</small><b>${i[1]}<em>${i[2]}</em></b></div>`).join('');
    $('#iotSync').textContent = `${calval.isOnline() ? 'Supabase Realtime' : 'Local buffer'} · last reading ${new Date(r.timestamp || Date.now()).toLocaleTimeString()}`;
  } else {
    m.innerHTML = '<p class="note">No readings yet. Emit one to start the Cal/Val stream.</p>';
  }
  $('#logTable tbody').innerHTML = calval.logs.slice(0, 25).map((x, i) => `<tr class="${i === 0 && row ? 'flash' : ''}"><td>${new Date(x.timestamp || Date.now()).toLocaleTimeString()}</td><td><b>${esc(x.node_id)}</b></td><td>${esc(x.aoi_id)}</td><td>${(+x.soil_moisture_pct).toFixed(1)}%</td><td>${(+x.water_level_cm).toFixed(1)} cm</td><td>${x.dielectric_eps}</td><td>${(+x.vibration_g).toFixed(3)} g</td><td>${esc(x.local_regime)}</td></tr>`).join('');
  toppChart($('#toppChart'), calval.logs.slice(0, 30).reverse(), toppTheta);
  if (row && state.data[state.aoi]) renderPassport();
}

function renderPower() {
  const D = state.data[state.aoi]; const P = D?.power;
  if (!P?.days?.length) { $('#powerInfo').textContent = '· unavailable'; return; }
  const days = P.days.slice(-120);
  $('#powerInfo').textContent = `· ${AOIS[state.aoi].short} (${P.lat.toFixed(2)}, ${P.lon.toFixed(2)}) · last ${days.length} days`;
  lineChart($('#powerChart'), [
    { values: days.map(d => d.precip), color: '#2f9bff', label: 'Rain (mm/day)', bars: true, axis: 'right' },
    { values: days.map(d => d.gwettop), color: '#5ff6ff', label: 'Surface soil wetness (0–1)', fill: true, dots: false }
  ], { labels: days.map(d => d.date.slice(5)), yRange: [0, 1] });
}

/* ------------------------------------------------------------ events --- */
const CATC = { wildfires: '#ff6b35', floods: '#3aa0ff', severeStorms: '#d8b4fe', volcanoes: '#ff3355', seaLakeIce: '#bfe9ff', earthquakes: '#ffd166', landslides: '#c59b6d', drought: '#e0b44a' };
function renderEonet() {
  const ev = state.eonet; const counts = {};
  ev.forEach(e => counts[e.categoryId] = (counts[e.categoryId] || 0) + 1);
  $('#eonetInfo').textContent = `· ${ev.length} events`;
  $('#eonetCats').innerHTML = Object.entries(counts).map(([k, v]) => `<i title="${k}: ${v}" style="flex:${v};background:${CATC[k] || '#888'}"></i>`).join('');
  const sorted = [...ev].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 60);
  $('#eonetList').innerHTML = sorted.map(e => `<li><span class="tag" style="--c:${CATC[e.categoryId] || '#aaa'}">${esc(e.category)}</span><b>${esc(e.title)}</b><small>${(e.date || '').slice(0, 10)}</small></li>`).join('');
}
function renderQuakes() {
  const q = state.data[state.aoi]?.quakes || [];
  $('#quakeList').innerHTML = q.length ? q.map(x => `<li><span class="mag" style="--c:${x.mag >= 6 ? '#ff5d73' : x.mag >= 5 ? '#ffd166' : '#9aa7bd'}">M${x.mag.toFixed(1)}</span><b>${esc(x.place)}</b><small>${x.time.slice(0, 10)} · ${x.depthKm.toFixed(0)} km deep</small></li>`).join('') : '<li>No M≥3 earthquakes within 300 km in the last 12 months — consistent with a stable control.</li>';
}

/* ------------------------------------------------------------- play ---- */
function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; $('#btnPlay').textContent = '▶'; } }
function togglePlay() {
  if (state.playing) return stopPlay();
  $('#btnPlay').textContent = '❚❚';
  state.playing = setInterval(() => { const n = stepsFor(state.layer); setT((state.t + 1) % n); terrain.scanPass(1400); }, 1700);
}

/* ------------------------------------------------------------- demo ---- */
const DEMO = [
  { aoi: 'ven', layer: 'gunw', title: 'A real earthquake, seen from orbit', text: 'This is real NASA-ISRO NISAR data: an interferogram whose two passes bracket the 24 June 2026 M7.2 + M7.5 Venezuela doublet (USGS). Every colour cycle is a contour of ground motion.' },
  { aoi: 'ven', layer: 'schg', t: 1, cell: [24, 20], title: 'From fringes to a passport', text: 'The physics engine turns phase into line-of-sight displacement (d = −λΔφ/4π) and flags cells moving more than 8 mm with coherence above 0.25. Click any cell to audit its evidence.' },
  { aoi: 'per', layer: 'gcov', title: 'L-band sees through the canopy', text: 'Real NISAR HH/HV backscatter over the Huallaga–Mayo rice valley in Peru. Magenta = strong HH (surfaces, double bounce); green = HV (vegetation volume).' },
  { aoi: 'per', layer: 'schg', t: 6, cell: [33, 14], title: 'Rice paddy cycles', text: 'HH and HV drop 3–4 dB for one or two passes, then recover: rule 5, agricultural activity. A farmer’s calendar becomes visible from orbit.' },
  { aoi: 'per', layer: 'schg', t: 8, cell: [9, 37], title: 'Floods hidden under the forest', text: 'HH jumps +4.6 dB while HV stays flat — trunk-water double bounce. Optical satellites miss it under clouds and leaves; NISAR does not.' },
  { aoi: 'ctl', layer: 'rchg', title: 'Negative control: Atacama', text: 'In the driest desert on Earth the real change map stays quiet. A trustworthy passport must also be able to say: nothing happened here.' }
];
let demoIdx = -1;
async function demoGo(i) {
  demoIdx = i; const s = DEMO[i]; const card = $('#demoCard'); card.hidden = false;
  $('#demoStep').textContent = `${i + 1} / ${DEMO.length}`; $('#demoTitle').textContent = s.title; $('#demoText').textContent = s.text;
  $('#demoNext').textContent = i === DEMO.length - 1 ? 'Finish ✓' : 'Next →';
  if (state.aoi !== s.aoi) await selectAoi(s.aoi, { layer: s.layer, t: s.t, cell: s.cell });
  else { setLayer(s.layer); if (s.t != null) setT(s.t); if (s.cell) { state.sel = s.cell; terrain.setSelected(...s.cell); renderPassport(); } }
  terrain.scanPass();
}

/* -------------------------------------------------------------- misc --- */
function toast(msg) {
  const t = el('div', '', esc(msg)); Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '30px', transform: 'translateX(-50%)', background: 'rgba(8,14,28,.95)', border: '1px solid rgba(95,246,255,.4)', padding: '10px 16px', borderRadius: '12px', zIndex: 90, fontSize: '13.5px' });
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

function wireUi() {
  $('#tSlider').oninput = e => { stopPlay(); setT(+e.target.value); };
  $('#btnPlay').onclick = togglePlay;
  $('#tglDance').onchange = e => terrain.setDance(e.target.checked);
  $('#tglGrid').onchange = e => terrain.setGrid(e.target.checked);
  $('#ctaQuake').onclick = () => { $('#explorer').scrollIntoView({ behavior: 'smooth' }); globe.flyTo(10.45, -68.45, 2.2); selectAoi('ven', { layer: 'gunw' }); };
  $('#ctaDemo').onclick = () => { $('#explorer').scrollIntoView({ behavior: 'smooth' }); demoGo(0); };
  $('#demoNext').onclick = () => demoIdx < DEMO.length - 1 ? demoGo(demoIdx + 1) : ($('#demoCard').hidden = true);
  $('#demoClose').onclick = () => { $('#demoCard').hidden = true; };
  $('#simScenario').value = state.aoi;
  $('#btnSend').onclick = async () => { const b = $('#btnSend'); b.textContent = 'Transmitting…'; const r = await calval.sendReading($('#simScenario').value); b.textContent = r.remote ? 'Stored in Supabase ✓' : 'Stored locally ✓'; setTimeout(() => b.textContent = 'Emit IoT reading', 1300); };
  let auto = null;
  $('#btnAuto').onclick = () => {
    const b = $('#btnAuto');
    if (auto) { clearInterval(auto); auto = null; b.textContent = 'Auto (Wokwi): OFF'; b.classList.remove('active'); return; }
    calval.sendReading($('#simScenario').value); auto = setInterval(() => calval.sendReading($('#simScenario').value), 4500);
    b.textContent = 'Auto (Wokwi): ON · 4.5 s'; b.classList.add('active');
  };
  $('#btnSavePp').onclick = async () => {
    const P = lastPassport; if (!P) return;
    const r = await calval.savePassport(state.aoi, P.r, P.c, P.S, P.ev);
    toast(r.ok ? 'Passport stored in Supabase (grid_cells · radar_series · passport_events)' : `Could not store in Supabase (${r.reason || 'RLS / schema'}). Use JSON download.`);
  };
  $('#btnDlPp').onclick = () => {
    const P = lastPassport; if (!P) return;
    const D = state.data[state.aoi];
    const doc = {
      schema: 'terrapass.passport/v3', generated: new Date().toISOString(), aoi: AOIS[state.aoi].name, cell: { row: P.r, col: P.c, lat: +P.ll.lat.toFixed(5), lon: +P.ll.lon.toFixed(5), sizeKm: +(D.info.widthKm / N).toFixed(2) },
      source: P.source === 'real' ? { type: 'NISAR L2 GCOV browse stack (ASF DAAC via NASA CMR)', granules: D.gcov.granules.map(g => g.id) } : { type: 'TerraPass calibrated physics scenario' },
      series: { dates: P.S.dates, hh: P.S.hh.map(v => Number.isFinite(v) ? +v.toFixed(2) : null), hv: P.S.hv.map(v => Number.isFinite(v) ? +v.toFixed(2) : null), coherence: P.S.coh?.length ? P.S.coh.map(v => +v.toFixed(3)) : undefined },
      events: P.ev.map(e => ({ type: e.kind, name: e.name, confidence: +e.conf.toFixed(3), breakdown: Object.fromEntries(e.parts.map(p => [p[0], +p[1].toFixed(3)])), signal: e.signal, explanation: e.plain })),
      evidence: P.evidence.map(e => e.text)
    };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    a.download = `terrapass-passport-${state.aoi}-${P.r}-${P.c}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // animated polar chart while visible
  let polarVisible = false;
  new IntersectionObserver(([e]) => { polarVisible = e.isIntersecting; }).observe($('#polarChart'));
  const loopPolar = () => { if (polarVisible) polarChart($('#polarChart'), polarPoint, polarLabel); requestAnimationFrame(loopPolar); };
  loopPolar();
  addEventListener('resize', () => { renderPassport(); renderPower(); renderCalval(); });
}

function reveal() {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.sec-head, .card, .new, .rule, .node-a, .filmstrips > div, .table-wrap').forEach((n, i) => { n.classList.add('reveal'); n.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(n); });
}

boot();
