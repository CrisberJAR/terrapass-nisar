/**
 * Cal/Val ground truth
 *  - ESP32 node (Wokwi simulation) -> Supabase table public.ground_truth (insert + Realtime)
 *  - automatic local fallback if Supabase is unreachable / RLS denies writes
 *  - NASA POWER daily soil wetness + precipitation for the same AOI (independent reference)
 */
import { toppEps } from './engine.js';

let sb = null, online = false;
const listeners = [];
export const logs = [];
export const latestByAoi = {};

export async function initSupabase(cfg) {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
    const { data, error } = await sb.from('ground_truth').select('*').order('timestamp', { ascending: false }).limit(20);
    if (error) throw error;
    online = true;
    (data || []).reverse().forEach(push);
    sb.channel('terrapass-v3-stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ground_truth' }, p => push(p.new, true))
      .subscribe();
  } catch (e) {
    console.warn('[TerraPass] Supabase unavailable, using local Cal/Val buffer:', e?.message || e);
    online = false;
  }
  return online;
}
export const isOnline = () => online;
export const onReading = f => listeners.push(f);

function push(row, live = false) {
  if (row.id && logs.some(r => r.id === row.id)) return;
  logs.unshift(row); if (logs.length > 60) logs.pop();
  if (row.aoi_id) latestByAoi[row.aoi_id] = row;
  listeners.forEach(f => f(row, live));
}

const rnd = (a, b, d = 2) => +(a + Math.random() * (b - a)).toFixed(d);
export function simulateReading(aoi) {
  let moist, r;
  if (aoi === 'ven') {
    moist = rnd(24, 34);
    r = { node_id: 'NODE-VEN-01', aoi_id: 'ven', cell_id: 1, water_level_cm: rnd(4, 14, 1), ambient_temp_c: rnd(26, 30), air_humidity_pct: rnd(66, 82), vibration_g: rnd(0.12, 0.48, 3), tilt_deg: rnd(1.2, 2.9), local_regime: 'SEISMIC_DEFORMATION' };
  } else if (aoi === 'per') {
    moist = rnd(46, 55);
    r = { node_id: 'NODE-PER-01', aoi_id: 'per', cell_id: 2, water_level_cm: rnd(6, 14, 1), ambient_temp_c: rnd(25, 31), air_humidity_pct: rnd(78, 94), vibration_g: rnd(0.004, 0.02, 3), tilt_deg: rnd(0.04, 0.16), local_regime: 'PADDY_WATER_SHEET' };
  } else {
    moist = rnd(1.5, 4.5);
    r = { node_id: 'NODE-CTL-01', aoi_id: 'ctl', cell_id: 4, water_level_cm: 0, ambient_temp_c: rnd(14, 24), air_humidity_pct: rnd(8, 18), vibration_g: rnd(0.001, 0.004, 3), tilt_deg: 0.01, local_regime: 'STABLE_NOMINAL' };
  }
  return { ...r, soil_moisture_pct: moist, dielectric_eps: +toppEps(moist).toFixed(1) };
}

export async function sendReading(aoi) {
  const reading = simulateReading(aoi);
  if (online && sb) {
    const { data, error } = await sb.from('ground_truth').insert([reading]).select();
    if (!error) { push(data?.[0] || { ...reading, timestamp: new Date().toISOString() }); return { ok: true, remote: true }; }
    console.warn('[TerraPass] insert failed, storing locally', error.message);
  }
  push({ ...reading, id: `local-${Date.now()}`, timestamp: new Date().toISOString() });
  return { ok: true, remote: false };
}

export async function savePassport(aoi, r, c, S, events) {
  if (!online || !sb) return { ok: false, reason: 'offline' };
  try {
    const { data: cell } = await sb.from('grid_cells').upsert([{ aoi_id: aoi, row_idx: r, col_idx: c }], { onConflict: 'aoi_id,row_idx,col_idx' }).select();
    const cid = cell?.[0]?.id; if (!cid) return { ok: false };
    const rows = S.hh.map((v, i) => ({ cell_id: cid, pass_index: i, observation_date: S.dates?.[i] || null, hh_db: Number.isFinite(v) ? +v.toFixed(2) : null, hv_db: Number.isFinite(S.hv[i]) ? +S.hv[i].toFixed(2) : null, coherence: S.coh?.[i] != null ? +S.coh[i].toFixed(3) : null, displacement_mm: S.disp?.[i] != null ? +S.disp[i].toFixed(1) : null }));
    await sb.from('radar_series').upsert(rows, { onConflict: 'cell_id,pass_index' });
    if (events?.length) {
      const e = events[0];
      await sb.from('passport_events').insert([{ cell_id: cid, event_type: e.kind, start_pass: e.t0, end_pass: e.t1, confidence_score: +e.conf.toFixed(3), confidence_level: e.conf >= 0.7 ? 'high' : e.conf >= 0.45 ? 'medium' : 'low', human_explanation: e.plain, technical_signal: e.signal, calval_verified: !!latestByAoi[aoi] }]);
    }
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
}

export async function getPower(lat, lon) {
  const r = await fetch(`/api/power?lat=${lat}&lon=${lon}`); if (!r.ok) throw new Error('POWER'); return r.json();
}
