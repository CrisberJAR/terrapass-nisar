/**
 * TerraPass 30-second film — rendered live, recordable to video (MediaRecorder).
 * Scenes: deep space → NISAR chase → Venezuela → REAL coseismic interferogram on 3D terrain → passport → end card.
 */
import * as THREE from 'three';
import { createGlobe, ll2v } from './globe.js';
import { createTerrain } from './terrain.js';
import { getGranules, buildStack } from './nisar.js';
import { simMaps } from './engine.js';

const $ = s => document.querySelector(s);
const out = $('#out'), g = out.getContext('2d');
const W = 1920, H = 1080, DUR = 30;
const VEN = { lat: 10.45, lon: -68.45, zoom: 9, tiles: 3 };
const QUAKE = '2026-06-24T22:04:31Z';
const QS = new URLSearchParams(location.search);
const LANG = QS.get('lang') === 'es' ? 'es' : 'en';
const RENDER = QS.has('render');   // offline frame-by-frame export (no live audio)
document.documentElement.lang = LANG;

const globe = createGlobe($('#globeSrc'), { preserve: true, manualCamera: true, autoRotate: false, noZoom: true, sunLat: 8, sunLon: -35, raan: THREE.MathUtils.degToRad(-68), orbitPhase: -1.42 });
const terrain = createTerrain($('#terrSrc'), { preserve: true });
terrain.setActive(false);

/* ---------------------------------------------------------- preload ---- */
let gunwCanvas = null, ready = false;
(async () => {
  try {
    const ext = (await terrain.load(VEN)).extent;
    $('#status').textContent = 'Querying NASA CMR for the coseismic NISAR pair…';
    const gr = await getGranules({ lat: VEN.lat, lon: VEN.lon, product: 'GUNW', limit: 150 });
    const ts = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
    const pairs = gr.filter(x => x.reference && ts(x.reference) <= QUAKE && QUAKE <= ts(x.secondary));
    const stack = await buildStack(pairs.slice(0, 1), ext, { sample: false });
    gunwCanvas = stack.crops[0] || null;
    if (pairs[0]) { const f = x => new Date(ts(x)).toLocaleDateString(TXT.locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }); CAPS[3].k = TXT.pairK(f(pairs[0].reference), f(pairs[0].secondary), pairs[0].track); }
    if (gunwCanvas) terrain.setImage(gunwCanvas, 0.88);
    $('#status').textContent = gunwCanvas ? `Ready · real pair ${pairs[0].reference.slice(0, 8)} → ${pairs[0].secondary.slice(0, 8)} (track ${pairs[0].track})` : 'Ready (interferogram unavailable, using model layer)';
  } catch (e) {
    $('#status').textContent = 'Ready (offline mode)';
  }
  ready = true; $('#play').disabled = false; $('#rec').disabled = !('MediaRecorder' in window);
})();

/* ------------------------------------------------------------- audio --- */
let actx = null, audioDest = null, narrationBuf = null;
const narrationBytes = fetch(`/assets/audio/narration-${LANG}.mp3`).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
function startAudio() {
  actx = new (window.AudioContext || window.webkitAudioContext)();
  audioDest = actx.createMediaStreamDestination();
  const master = actx.createGain(); master.gain.value = 0.0001; master.connect(actx.destination); master.connect(audioDest);
  const now = actx.currentTime;
  if (narrationBuf) { // voice-over on its own bus, music ducked underneath
    const src = actx.createBufferSource(), vg = actx.createGain(); vg.gain.value = 1.0; src.buffer = narrationBuf;
    src.connect(vg); vg.connect(actx.destination); vg.connect(audioDest); src.start(now + 0.05);
  }
  master.gain.exponentialRampToValueAtTime(narrationBuf ? 0.22 : 0.5, now + 3); master.gain.setValueAtTime(narrationBuf ? 0.22 : 0.5, now + 27); master.gain.exponentialRampToValueAtTime(0.0001, now + 30);
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 6; lp.connect(master);
  lp.frequency.setValueAtTime(380, now); lp.frequency.linearRampToValueAtTime(1400, now + 12); lp.frequency.linearRampToValueAtTime(700, now + 24); lp.frequency.linearRampToValueAtTime(1800, now + 28);
  [55, 82.4, 110.3, 164.8].forEach((f, i) => { // A-minor-ish drone pad
    for (const det of [-6, 6]) { const o = actx.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.detune.value = det; const gg = actx.createGain(); gg.gain.value = 0.07; o.connect(gg).connect(lp); o.start(now); o.stop(now + DUR + 0.5); }
  });
  const boom = at => { const o = actx.createOscillator(), gg = actx.createGain(); o.frequency.setValueAtTime(70, now + at); o.frequency.exponentialRampToValueAtTime(28, now + at + 1.6); gg.gain.setValueAtTime(0.0001, now + at); gg.gain.exponentialRampToValueAtTime(0.9, now + at + 0.03); gg.gain.exponentialRampToValueAtTime(0.0001, now + at + 2.2); o.connect(gg).connect(master); o.start(now + at); o.stop(now + at + 2.4); };
  const ping = at => { const o = actx.createOscillator(), gg = actx.createGain(); o.type = 'sine'; o.frequency.value = 1320; gg.gain.setValueAtTime(0.0001, now + at); gg.gain.exponentialRampToValueAtTime(0.25, now + at + 0.01); gg.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.4); o.connect(gg).connect(master); o.start(now + at); o.stop(now + at + 1.5); };
  boom(9.6); ping(4.8); ping(12.4); ping(20.4); boom(25.3);
}

/* ---------------------------------------------------------- timeline --- */
const TXT = {
  en: {
    caps: [
      { a: 0.6, b: 4.2, k: 'NASA-ISRO · NISAR · launched 2025', t: 'Every 12 days, a radar maps all of Earth’s land.' },
      { a: 4.7, b: 9.2, k: 'L-band SAR · 24 cm wavelength · 12 m antenna', t: 'It sees through clouds, darkness and forest canopy.' },
      { a: 9.6, b: 12.0, k: '24 June 2026 · USGS M7.2 + M7.5', t: 'Venezuela shakes.' },
      { a: 12.6, b: 19.7, k: 'REAL NISAR interferogram', t: 'The ground moved — and NISAR measured it.' },
      { a: 20.3, b: 24.9, k: 'TerraPass', t: 'Every cell gets an auditable change passport.', s: 'Radar physics + IoT ground truth + NASA EONET, POWER & USGS' }
    ],
    pairK: (a, b, tr) => `REAL NISAR interferogram · ${a} → ${b} 2026 · track ${tr}`,
    tag: 'Every patch of Earth deserves a passport.',
    line1: 'REAL NASA DATA · IoT GROUND TRUTH · BUILT ON MICROSOFT AZURE',
    credT: 'Data: NASA/JPL-Caltech/ISRO NISAR via ASF DAAC · USGS ComCat · SRTM · Esri imagery',
    credG: 'Imagery: NASA Blue Marble & Black Marble · NISAR orbit 747 km, i = 98.4°',
    locale: 'en-GB'
  },
  es: {
    caps: [
      { a: 0.6, b: 4.2, k: 'NASA-ISRO · NISAR · lanzado en 2025', t: 'Cada 12 días, un radar mapea toda la tierra del planeta.' },
      { a: 4.7, b: 9.2, k: 'Radar SAR banda L · onda de 24 cm · antena de 12 m', t: 'Ve a través de las nubes, la noche y el bosque.' },
      { a: 9.6, b: 12.0, k: '24 de junio de 2026 · USGS M7.2 + M7.5', t: 'Venezuela tiembla.' },
      { a: 12.6, b: 19.7, k: 'Interferograma REAL de NISAR', t: 'El suelo se movió, y NISAR lo midió.' },
      { a: 20.3, b: 24.9, k: 'TerraPass', t: 'Cada celda recibe un pasaporte de cambio verificable.', s: 'Física de radar + verdad de campo IoT + NASA EONET, POWER y USGS' }
    ],
    pairK: (a, b, tr) => `Interferograma REAL de NISAR · ${a} → ${b} 2026 · órbita ${tr}`,
    tag: 'Cada rincón de la Tierra merece un pasaporte.',
    line1: 'DATOS REALES DE LA NASA · VERDAD DE CAMPO IoT · DESPLEGADO EN MICROSOFT AZURE',
    credT: 'Datos: NASA/JPL-Caltech/ISRO NISAR vía ASF DAAC · USGS ComCat · SRTM · imágenes Esri',
    credG: 'Imágenes: NASA Blue Marble y Black Marble · órbita de NISAR 747 km, i = 98,4°',
    locale: 'es-PE'
  }
}[LANG];
const CAPS = TXT.caps;
const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const sm = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

let t0 = 0, playing = false, recorder = null, scanned = {};
function cameraGlobe(t) {
  const cam = globe.camera, sat = globe.sat;
  globe.setOrbit(-1.42 + 0.13 * t);
  if (t < 4.5) {
    const k = ease(t / 4.5), from = new THREE.Vector3(2, 3, 14), to = ll2v(14, -55, 3.3);
    cam.position.lerpVectors(from, to, k); cam.lookAt(0, 0, 0);
  } else if (t < 9.5) {
    const p = sat.position.clone(), up = p.clone().normalize();
    const vel = new THREE.Vector3(0, 0, 0).subVectors(p, ll2v(0, 0, 0)).cross(new THREE.Vector3(0, 1, 0)).normalize();
    const k = sm(4.5, 9.5, t);
    const chase = p.clone().add(up.clone().multiplyScalar(0.05 + 0.35 * k)).add(vel.multiplyScalar(0.09 - 0.05 * k)).add(new THREE.Vector3(0, 0.04, 0));
    const blendIn = sm(4.5, 5.6, t);
    const prev = ll2v(14, -55, 3.3);
    cam.position.lerpVectors(prev, chase, blendIn);
    const look = p.clone().lerp(new THREE.Vector3(0, 0, 0), 0.25 + 0.5 * k);
    cam.lookAt(look.lerp(new THREE.Vector3(0, 0, 0), 1 - blendIn));
  } else if (t < 12.2) {
    const k = ease(sm(9.5, 12.2, t)), p = globe.sat.position.clone().normalize().multiplyScalar(1.6);
    const target = ll2v(VEN.lat - 4, VEN.lon, 1.38);
    cam.position.lerpVectors(p, target, k); cam.lookAt(ll2v(VEN.lat, VEN.lon, 1).multiplyScalar(1 - 0.0 * k));
    // quake shake
    if (t > 9.6 && t < 11) { const a = 0.006 * (1 - (t - 9.6) / 1.4); cam.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0)); }
  } else {
    const k = sm(25, 30, t), ang = -1.05 + (t - 25) * 0.05;
    cam.position.set(Math.sin(ang) * (5.4 - 0.8 * k), 0.8, Math.cos(ang) * (5.4 - 0.8 * k)); cam.lookAt(0, -0.2, 0);
  }
}
function cameraTerrain(t) {
  const cam = terrain.camera, k = (t - 12);
  const ang = 0.55 + k * 0.07, r = 14.5 - Math.min(k, 8) * 0.35, h = 9 - Math.min(k, 8) * 0.35;
  cam.position.set(Math.sin(ang) * r, h, Math.cos(ang) * r); cam.lookAt(0, 0, 0);
}

function drawCover(src) {
  const sw = src.width, sh = src.height, s = Math.max(W / sw, H / sh), dw = sw * s, dh = sh * s;
  g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function caption(c, t) {
  const a = sm(c.a, c.a + 0.5, t) * (1 - sm(c.b - 0.5, c.b, t)); if (a <= 0) return;
  g.save(); g.globalAlpha = a; const y = H - 190 + (1 - a) * 18, x = 120;
  const grd = g.createLinearGradient(0, H - 330, 0, H); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.65)');
  g.fillStyle = grd; g.fillRect(0, H - 330, W, 330);
  g.fillStyle = '#5ff6ff'; g.fillRect(x - 28, y - 46, 6, c.s ? 130 : 96);
  g.font = '500 26px "JetBrains Mono", monospace'; g.fillStyle = '#ffd166'; g.fillText(c.k.toUpperCase(), x, y - 18);
  let fs = 62; g.font = `800 ${fs}px Inter, sans-serif`; while (g.measureText(c.t).width > W - 2 * x && fs > 40) { fs -= 2; g.font = `800 ${fs}px Inter, sans-serif`; }
  g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 24; g.fillText(c.t, x, y + 44);
  if (c.s) { g.shadowBlur = 0; g.font = '500 30px Inter, sans-serif'; g.fillStyle = '#c3cee0'; g.fillText(c.s, x, y + 92); }
  g.restore();
}
function endCard(t) {
  const a = sm(25.4, 26.4, t); if (a <= 0) return;
  g.save(); g.globalAlpha = a;
  g.fillStyle = 'rgba(2,4,10,.55)'; g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.strokeStyle = '#ffd166'; g.lineWidth = 6; g.beginPath(); g.ellipse(W / 2, 390, 120, 40, -0.4, 0, Math.PI * 2); g.stroke();
  const rg = g.createRadialGradient(W / 2 - 12, 380, 6, W / 2, 390, 48); rg.addColorStop(0, '#c9ffff'); rg.addColorStop(1, '#1f7ae0'); g.fillStyle = rg; g.beginPath(); g.arc(W / 2, 390, 46, 0, 7); g.fill();
  g.font = '800 120px Inter, sans-serif'; g.fillStyle = '#fff'; g.fillText('Terra', W / 2 - 120, 580); g.fillStyle = '#5ff6ff'; g.fillText('Pass', W / 2 + 160, 580);
  g.font = '600 44px Inter, sans-serif'; g.fillStyle = '#e8eef8'; g.fillText(TXT.tag, W / 2, 660);
  g.font = '500 28px "JetBrains Mono", monospace'; g.fillStyle = '#9aa7bd'; g.fillText(TXT.line1, W / 2, 740);
  g.fillStyle = '#ffd166'; g.fillText('NASA SPACE APPS CHALLENGE 2026', W / 2, 790);
  g.restore();
}
function credits(t) {
  g.save(); g.font = '500 20px "JetBrains Mono", monospace'; g.fillStyle = 'rgba(255,255,255,.55)';
  const txt = t >= 12 && t < 25 ? TXT.credT : TXT.credG;
  g.fillText(txt, 40, H - 30); g.restore();
}

function frame() {
  if (!playing) return;
  const t = (performance.now() - t0) / 1000; window.__filmT = t;
  const terr = t >= 12 && t < 25;
  globe.setActive(!terr); terrain.setActive(terr);
  if (terr) {
    cameraTerrain(t);
    if (!scanned.a) { scanned.a = 1; terrain.scanPass(2600); }
    if (t > 20 && !scanned.b) { scanned.b = 1; if (gunwCanvas) terrain.setImage(gunwCanvas, 0.35); terrain.setChange(simMaps('ven').chg[1]); terrain.setDance(true); terrain.scanPass(2400); }
    drawCover(terrain.canvas);
  } else {
    cameraGlobe(t); drawCover(globe.canvas);
  }
  // cinematic vignette + fade in/out
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  const flash = (t > 11.85 && t < 12.35) ? 1 - Math.abs(t - 12.1) / 0.25 : 0; if (flash > 0) { g.fillStyle = `rgba(200,250,255,${flash * 0.8})`; g.fillRect(0, 0, W, H); }
  CAPS.forEach(c => caption(c, t)); endCard(t); credits(t);
  const fade = Math.max(1 - sm(0, 0.8, t), sm(29.2, 30, t)); if (fade > 0) { g.fillStyle = `rgba(0,0,0,${fade})`; g.fillRect(0, 0, W, H); }
  g.fillStyle = 'rgba(95,246,255,.8)'; g.fillRect(0, H - 4, W * Math.min(1, t / DUR), 4);
  if (t >= DUR) return finish();
  requestAnimationFrame(frame);
}

async function start(record) {
  if (!ready) return;
  $('#ui').style.display = 'none'; scanned = {};
  terrain.setDance(false); terrain.setChange(null); if (gunwCanvas) terrain.setImage(gunwCanvas, 0.88);
  if (!RENDER) {
    if (!narrationBuf) {
      const bytes = await narrationBytes;
      if (bytes) { const tmp = new (window.AudioContext || window.webkitAudioContext)(); try { narrationBuf = await tmp.decodeAudioData(bytes.slice(0)); } catch { /* no voice */ } tmp.close(); }
    }
    startAudio();
  }
  if (record) {
    const stream = out.captureStream(30);
    audioDest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find(m => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14e6 });
    const chunks = []; recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `TerraPass-30s-film-${LANG.toUpperCase()}.${recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
    };
    recorder.start(250);
  }
  t0 = performance.now(); playing = true; requestAnimationFrame(frame);
}
function finish() {
  playing = false; window.__filmDone = true; recorder?.state === 'recording' && recorder.stop(); recorder = null;
  setTimeout(() => { actx?.close(); }, 600);
  $('#ui').style.display = ''; $('#status').textContent = LANG === 'es' ? 'Terminado · pulsa Reproducir para verla otra vez' : 'Finished · press Play to watch again';
}

if (LANG === 'es') {
  $('#ui h1').textContent = 'TerraPass · película de 30 segundos';
  $('#ui p').innerHTML = 'Renderizada en vivo con Three.js a partir de datos reales de NISAR (NASA-ISRO), con narración en español. Pulsa <b>Reproducir</b> para verla o <b>Grabar video</b> para exportar un video 1080p.';
  $('#play').textContent = '▶ Reproducir'; $('#rec').textContent = '● Grabar video (30 s)';
}
$('#langLink').href = LANG === 'es' ? '?lang=en' : '?lang=es'; $('#langLink').textContent = LANG === 'es' ? 'English version' : 'Versión en español';
$('#play').onclick = () => { document.documentElement.requestFullscreen?.().catch(() => {}); start(false); };
$('#rec').onclick = () => start(true);
addEventListener('keydown', e => { if (e.key === 'Escape' && playing) finish(); });
// idle preview behind the menu
(function idle() { if (!playing) { const t = (performance.now() / 1000) % 4.5; cameraGlobe(t * 0.3 + 3); drawCover(globe.canvas); } requestAnimationFrame(idle); })();
