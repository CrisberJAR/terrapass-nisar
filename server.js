/**
 * TerraPass v3 · Earth Change Passport
 * NASA Space Apps Challenge 2026 · "Dancing with the SARs"
 *
 * Lightweight Node/Express gateway that:
 *  - serves the web app (public/)
 *  - proxies + caches real NASA data sources so the browser never hits CORS / rate limits:
 *      · NASA CMR (Earthdata)  -> real NISAR L2 GCOV / GUNW granules (ASF DAAC)
 *      · NISAR browse quicklooks (public PNGs on ASF Earthdata Cloud)
 *      · NASA EONET v3          -> open natural events (floods, fires, volcanoes, storms)
 *      · NASA POWER             -> daily precipitation + surface soil wetness (GWETTOP)
 *      · USGS ComCat            -> earthquakes (independent validation for InSAR deformation)
 *  - exposes runtime config (Supabase URL / publishable key) from environment variables
 *
 * Designed for Azure App Service (Linux, Node 20) or Azure Container Apps (Dockerfile).
 */
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

app.disable('x-powered-by');
app.use(compression());

/* ---------------------------------------------------------------- cache -- */
const cache = new Map();
const MAX_ENTRIES = 400;
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await producer();
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'TerraPass/3.0 (NASA Space Apps)' } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} <- ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ----------------------------------------------------------- study AOIs -- */
export const AOIS = {
  ven: { id: 'ven', name: 'Venezuela · Crustal deformation & river basin', lat: 10.2, lon: -69.5 },
  per: { id: 'per', name: 'Peru · Rice paddies & flooded Amazon forest', lat: -6.4, lon: -76.4 },
  ctl: { id: 'ctl', name: 'Atacama · Hyper-arid stable control', lat: -24.1, lon: -69.9 }
};

const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const clampLat = v => Math.max(-90, Math.min(90, v));
const clampLon = v => Math.max(-180, Math.min(180, v));

/* ------------------------------------------------------------- config ---- */
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://ntbrfedcrblamjfujryf.supabase.co',
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AM2Rw2pH3qJjRyW9oZw1Nw_BD9xsYF_',
    host: process.env.WEBSITE_SITE_NAME ? 'Azure App Service' : (process.env.CONTAINER_APP_NAME ? 'Azure Container Apps' : 'local'),
    version: '3.0.0',
    aois: AOIS
  });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString(), cacheEntries: cache.size }));

/* -------------------------------------------- NASA CMR · NISAR granules -- */
const PRODUCTS = {
  GCOV: ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1'],
  GUNW: ['NISAR_L2_GUNW_V1', 'NISAR_L2_GUNW_PROVISIONAL_V1'],
  GSLC: ['NISAR_L2_GSLC_V1', 'NISAR_L2_GSLC_PROVISIONAL_V1'],
  SME2: ['NISAR_L3_SME2_V1', 'NISAR_L3_SME2_PROVISIONAL_V1']
};

function parseNisarTitle(title) {
  // NISAR_L2_PR_GCOV_034_090_A_007_4005_DHDH_A_20261030T101512_20261030T101546_P05036_N_F_J_001
  // NISAR_L2_PR_GUNW_032_090_A_007_033_4000_SH_<ref start>_<ref end>_<sec start>_<sec end>_...
  const p = title.split('_');
  const out = { product: p[3], cycle: p[4], track: p[5], direction: p[6] === 'A' ? 'Ascending' : 'Descending', frame: p[7] };
  if (p[3] === 'GCOV' || p[3] === 'GSLC') out.polarization = p[9];
  if (p[3] === 'GUNW') { out.polarization = p[10]; out.reference = p[11]; out.secondary = p[13]; }
  return out;
}

function parsePolygon(e) {
  const raw = e.polygons?.[0]?.[0];
  if (!raw) return null;
  const v = raw.trim().split(/\s+/).map(Number);
  const ring = [];
  for (let i = 0; i + 1 < v.length; i += 2) ring.push([v[i + 1], v[i]]); // [lon, lat]
  return ring;
}

async function searchNisar({ product = 'GCOV', lat, lon, bbox, limit = 60, temporal }) {
  const names = PRODUCTS[product] || PRODUCTS.GCOV;
  const qs = new URLSearchParams();
  names.forEach(n => qs.append('short_name', n));
  if (bbox) qs.set('bounding_box', bbox);
  else if (lat != null && lon != null) qs.set('point', `${lon},${lat}`);
  if (temporal) qs.set('temporal', temporal);
  qs.set('page_size', String(Math.min(200, limit)));
  qs.set('sort_key', '-start_date');
  const url = `https://cmr.earthdata.nasa.gov/search/granules.json?${qs}`;
  const json = await fetchJson(url);
  const entries = json?.feed?.entry || [];
  return entries.map(e => {
    const links = (e.links || []).map(l => l.href);
    const browse = links.find(h => h.startsWith('https') && /_LATLON\.png$/.test(h)) || links.find(h => h.startsWith('https') && h.endsWith('.png'));
    const thumb = links.find(h => h.startsWith('https') && /_thumbnail\.png$/.test(h));
    const data = links.find(h => h.startsWith('https') && h.endsWith('.h5'));
    return {
      id: e.title,
      collection: e.dataset_id,
      shortName: e.collection_concept_id,
      start: e.time_start,
      end: e.time_end,
      sizeMB: e.granule_size ? +(+e.granule_size).toFixed(1) : null,
      polygon: parsePolygon(e),
      browse, thumb, data,
      ...parseNisarTitle(e.title)
    };
  });
}

app.get('/api/nisar/granules', async (req, res) => {
  try {
    const product = String(req.query.product || 'GCOV').toUpperCase();
    let { lat, lon } = req.query;
    if (req.query.aoi && AOIS[req.query.aoi]) ({ lat, lon } = AOIS[req.query.aoi]);
    const bbox = req.query.bbox && /^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(req.query.bbox) ? req.query.bbox : null;
    const limit = Math.max(1, Math.min(200, num(req.query.limit, 60)));
    const key = `cmr:${product}:${lat}:${lon}:${bbox}:${limit}`;
    const granules = await cached(key, 30 * 60e3, () =>
      searchNisar({ product, lat: lat != null ? clampLat(+lat) : null, lon: lon != null ? clampLon(+lon) : null, bbox, limit }));
    res.set('Cache-Control', 'public, max-age=600').json({ source: 'NASA CMR · ASF DAAC', product, count: granules.length, granules });
  } catch (err) {
    res.status(502).json({ error: 'CMR request failed', detail: String(err.message || err) });
  }
});

/* Archive size (CMR-Hits) for headline stats */
app.get('/api/nisar/stats', async (_req, res) => {
  try {
    const stats = await cached('cmr:stats', 60 * 60e3, async () => {
      const out = {};
      for (const p of ['GCOV', 'GUNW', 'GSLC', 'SME2']) {
        const qs = new URLSearchParams(); PRODUCTS[p].forEach(n => qs.append('short_name', n)); qs.set('page_size', '0');
        const r = await fetch(`https://cmr.earthdata.nasa.gov/search/granules.json?${qs}`);
        out[p] = +(r.headers.get('cmr-hits') || 0);
      }
      out.total = Object.values(out).reduce((a, b) => a + b, 0);
      return out;
    });
    res.set('Cache-Control', 'public, max-age=1800').json({ source: 'NASA CMR', ...stats });
  } catch (err) {
    res.status(502).json({ error: 'CMR stats failed', detail: String(err.message || err) });
  }
});

/* Global recent footprints for the hero globe (latest acquisitions worldwide) */
app.get('/api/nisar/recent', async (_req, res) => {
  try {
    const granules = await cached('cmr:recent', 30 * 60e3, () => searchNisar({ product: 'GCOV', limit: 120 }));
    res.set('Cache-Control', 'public, max-age=600').json({ count: granules.length, granules: granules.map(g => ({ id: g.id, start: g.start, polygon: g.polygon, track: g.track, direction: g.direction })) });
  } catch (err) {
    res.status(502).json({ error: 'CMR request failed', detail: String(err.message || err) });
  }
});

/* NISAR browse image proxy (same-origin so WebGL/canvas can read pixels) */
const BROWSE_RX = /^https:\/\/nisar\.asf\.earthdatacloud\.nasa\.gov\/BROWSE\/[A-Za-z0-9_./-]+\.png$/;
app.get('/api/nisar/browse', async (req, res) => {
  const u = String(req.query.u || '');
  if (!BROWSE_RX.test(u)) return res.status(400).json({ error: 'Only NISAR browse PNGs from ASF are allowed' });
  try {
    const buf = await cached(`img:${u}`, 6 * 3600e3, async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow' });
        if (!r.ok) throw new Error(`${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      } finally { clearTimeout(t); }
    });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).send(buf);
  } catch (err) {
    res.status(502).json({ error: 'Browse fetch failed', detail: String(err.message || err) });
  }
});

/* ---------------------------------------------------------- NASA EONET -- */
app.get('/api/eonet', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, num(req.query.days, 60)));
    const data = await cached(`eonet:${days}`, 15 * 60e3, async () => {
      const j = await fetchJson(`https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=${days}&limit=400`);
      return (j.events || []).map(ev => {
        const g = ev.geometry?.[ev.geometry.length - 1];
        let lon = null, lat = null;
        if (g?.type === 'Point') [lon, lat] = g.coordinates;
        else if (g?.type === 'Polygon') [lon, lat] = g.coordinates[0][0];
        return { id: ev.id, title: ev.title, category: ev.categories?.[0]?.title, categoryId: ev.categories?.[0]?.id, date: g?.date, lat, lon, closed: ev.closed, link: ev.sources?.[0]?.url };
      }).filter(e => e.lat != null);
    });
    res.set('Cache-Control', 'public, max-age=600').json({ source: 'NASA EONET v3', count: data.length, events: data });
  } catch (err) {
    res.status(502).json({ error: 'EONET request failed', detail: String(err.message || err) });
  }
});

/* ---------------------------------------------------------- NASA POWER -- */
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
app.get('/api/power', async (req, res) => {
  try {
    const lat = clampLat(num(req.query.lat, AOIS.per.lat));
    const lon = clampLon(num(req.query.lon, AOIS.per.lon));
    const end = new Date(Date.now() - 4 * 864e5);           // POWER has a few days of latency
    const start = new Date(end.getTime() - 180 * 864e5);
    const key = `power:${lat.toFixed(2)}:${lon.toFixed(2)}:${ymd(end)}`;
    const out = await cached(key, 6 * 3600e3, async () => {
      const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,GWETTOP,T2M,RH2M&community=AG&longitude=${lon}&latitude=${lat}&start=${ymd(start)}&end=${ymd(end)}&format=JSON`;
      const j = await fetchJson(url, 30000);
      const P = j.properties.parameter;
      const fill = j.header?.fill_value ?? -999;
      const days = Object.keys(P.GWETTOP).map(d => ({
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        precip: P.PRECTOTCORR[d] === fill ? null : P.PRECTOTCORR[d],
        gwettop: P.GWETTOP[d] === fill ? null : P.GWETTOP[d],
        t2m: P.T2M[d] === fill ? null : P.T2M[d],
        rh2m: P.RH2M[d] === fill ? null : P.RH2M[d]
      }));
      return { lat, lon, days };
    });
    res.set('Cache-Control', 'public, max-age=3600').json({ source: 'NASA POWER (LaRC) · MERRA-2 / GPM IMERG', ...out });
  } catch (err) {
    res.status(502).json({ error: 'POWER request failed', detail: String(err.message || err) });
  }
});

/* ---------------------------------------------------------- USGS quakes -- */
app.get('/api/quakes', async (req, res) => {
  try {
    const lat = clampLat(num(req.query.lat, AOIS.ven.lat));
    const lon = clampLon(num(req.query.lon, AOIS.ven.lon));
    const r = Math.max(10, Math.min(1000, num(req.query.km, 300)));
    const start = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const key = `usgs:${lat.toFixed(1)}:${lon.toFixed(1)}:${r}:${start}`;
    const out = await cached(key, 30 * 60e3, async () => {
      const j = await fetchJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${r}&starttime=${start}&minmagnitude=3&orderby=magnitude&limit=25`);
      return (j.features || []).map(f => ({ id: f.id, mag: f.properties.mag, place: f.properties.place, time: new Date(f.properties.time).toISOString(), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depthKm: f.geometry.coordinates[2], url: f.properties.url }));
    });
    res.set('Cache-Control', 'public, max-age=600').json({ source: 'USGS ComCat', count: out.length, quakes: out });
  } catch (err) {
    res.status(502).json({ error: 'USGS request failed', detail: String(err.message || err) });
  }
});

/* --------------------------------------------------------------- static -- */
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders(res, file) {
    if (/\.(js|css|png|jpg|svg|woff2)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`TerraPass v3 listening on http://localhost:${PORT}`));
