/**
 * TerraPass 3D digital twin of a study area
 *  - real elevation: AWS Terrain Tiles (Terrarium; SRTM / GMTED / ETOPO1 composite, public dataset)
 *  - real imagery: Esri World Imagery (fallback NASA GIBS Blue Marble)
 *  - physically based sky + sun shadows, sea-level water, diorama skirt
 *  - draped layers: real NISAR GUNW / GCOV quicklooks, change heat-map, coherence, scan-line of the satellite pass
 *  - "Dance" mode: terrain pulses proportionally to detected change (the SAR "dance")
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createNisar } from './satellite.js';
import { N } from './engine.js';

const SIZE = 10, SEG = 255;
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

async function mosaic(urlFn, x0, y0, k, tile = 256) {
  const cv = document.createElement('canvas'); cv.width = cv.height = k * tile;
  const g = cv.getContext('2d', { willReadFrequently: true });
  let ok = 0;
  await Promise.all(Array.from({ length: k * k }, async (_, i) => {
    const dx = i % k, dy = (i / k) | 0;
    try { const im = await loadImg(urlFn(x0 + dx, y0 + dy)); g.drawImage(im, dx * tile, dy * tile, tile, tile); ok++; } catch { /* tile missing */ }
  }));
  return { canvas: cv, ok };
}

const overlayVert = /* glsl */`varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const overlayFrag = /* glsl */`
  uniform sampler2D imgMap, chgMap; uniform float imgOn, imgOpacity, chgOn, scanPos, scanOn, time, gridOn; uniform vec2 sel; uniform float selOn, cells;
  varying vec2 vUv;
  vec3 ramp(float q){ return q < 0.5 ? mix(vec3(1.0,0.86,0.2), vec3(1.0,0.35,0.15), q*2.0) : mix(vec3(1.0,0.35,0.15), vec3(0.85,0.1,0.55), (q-0.5)*2.0); }
  void main(){
    vec4 c = vec4(0.0);
    if (imgOn > 0.5) { vec4 im = texture2D(imgMap, vUv); c = vec4(im.rgb, im.a * imgOpacity); }
    if (chgOn > 0.5) {
      float v = texture2D(chgMap, vUv).r;
      if (v > 0.3) { float q = (v - 0.3) / 0.7; vec4 h = vec4(ramp(q), 0.32 + 0.43*q); c = vec4(mix(c.rgb, h.rgb, h.a), max(c.a, h.a)); }
    }
    vec2 cell = vUv * cells;
    if (gridOn > 0.5) { vec2 f = abs(fract(cell) - 0.5); float g = smoothstep(0.47, 0.5, max(f.x, f.y)); c = vec4(mix(c.rgb, vec3(1.0), g*0.25), max(c.a, g*0.12)); }
    if (selOn > 0.5) {
      vec2 d = abs(floor(cell) - sel);
      if (d.x < 0.5 && d.y < 0.5) { vec2 f = abs(fract(cell) - 0.5); float e = smoothstep(0.36, 0.5, max(f.x, f.y)); float p = 0.6 + 0.4*sin(time*6.0);
        c = vec4(mix(c.rgb, vec3(1.0), e*p), max(c.a, e*p)); }
    }
    if (scanOn > 0.5) {
      float d = vUv.x - scanPos; float line = exp(-pow(d*90.0, 2.0)); float wake = d < 0.0 ? exp(d*14.0) * 0.18 : 0.0;
      vec3 sc = vec3(0.3, 1.0, 0.95);
      c = vec4(c.rgb + sc * (line + wake), max(c.a, line*0.9 + wake));
    }
    gl_FragColor = c;
  }`;

export function createTerrain(container, opts = {}) {
  const W = () => container.clientWidth, H = () => container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.05, 4000);
  camera.position.set(0, 8.5, 11.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.07; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 4; controls.maxDistance = 30;
  controls.target.set(0, 0, 0); controls.autoRotate = !!opts.autoRotate; controls.autoRotateSpeed = 0.4;

  // cinematic backdrop: deep-space gradient with horizon glow + stars
  const bg = document.createElement('canvas'); bg.width = 16; bg.height = 512;
  const bgc = bg.getContext('2d'), grd = bgc.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#02040a'); grd.addColorStop(0.55, '#0a1630'); grd.addColorStop(0.8, '#1b3558'); grd.addColorStop(1, '#0a1220');
  bgc.fillStyle = grd; bgc.fillRect(0, 0, 16, 512);
  const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
  const stp = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.9 + 0.1; v.normalize().multiplyScalar(300); stp.set([v.x, v.y, v.z], i * 3); }
  const stg = new THREE.BufferGeometry(); stg.setAttribute('position', new THREE.BufferAttribute(stp, 3));
  scene.add(new THREE.Points(stg, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false })));
  const sunPos = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(215));
  scene.fog = new THREE.Fog(0x0b1626, 30, 95);

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.position.copy(sunPos).multiplyScalar(20);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 60 });
  scene.add(sun); scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a2318, 1.1));
  const rim = new THREE.DirectionalLight(0x5ff6ff, 0.6); rim.position.set(-10, 6, -12); scene.add(rim);

  // terrain
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position, NV = P.count, base = new Float32Array(NV), vcell = new Int32Array(NV);
  for (let i = 0; i < NV; i++) {
    const u = (P.getX(i) + SIZE / 2) / SIZE, v = 1 - (P.getZ(i) + SIZE / 2) / SIZE; // v=1 north
    const r = Math.min(N - 1, Math.floor((1 - v) * N)), c = Math.min(N - 1, Math.floor(u * N)); vcell[i] = r * N + c;
  }
  const terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0.0 });
  const terrain = new THREE.Mesh(geo, terrainMat); terrain.castShadow = terrain.receiveShadow = true; scene.add(terrain);

  // change map texture N x N
  const chgData = new Uint8Array(N * N * 4); const chgTex = new THREE.DataTexture(chgData, N, N); chgTex.needsUpdate = true;
  chgTex.magFilter = THREE.NearestFilter; chgTex.minFilter = THREE.NearestFilter;
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
  const ovMat = new THREE.ShaderMaterial({
    uniforms: { imgMap: { value: blank }, chgMap: { value: chgTex }, imgOn: { value: 0 }, imgOpacity: { value: 0.85 }, chgOn: { value: 0 }, scanPos: { value: -1 }, scanOn: { value: 0 }, time: { value: 0 }, gridOn: { value: 0 }, sel: { value: new THREE.Vector2(-9, -9) }, selOn: { value: 0 }, cells: { value: N } },
    vertexShader: overlayVert, fragmentShader: overlayFrag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });
  const overlay = new THREE.Mesh(geo, ovMat); overlay.renderOrder = 2; scene.add(overlay);

  // diorama skirt + base
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x3b2f25, roughness: 1 });
  const skirt = new THREE.Mesh(new THREE.BufferGeometry(), skirtMat); skirt.castShadow = true; scene.add(skirt);
  const baseSlab = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.08, SIZE), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 })); baseSlab.position.y = -1.04; scene.add(baseSlab);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: 0x0c1526, roughness: 1, metalness: 0.2 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1.1; ground.receiveShadow = true; scene.add(ground);

  // sea
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshPhysicalMaterial({ color: 0x0d3550, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86, clearcoat: 1, clearcoatRoughness: 0.08 }));
  water.rotation.x = -Math.PI / 2; water.visible = false; water.receiveShadow = true; scene.add(water);

  // NISAR flyover + beam
  const sat = createNisar(); sat.scale.setScalar(0.16); sat.visible = false; scene.add(sat);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.visible = false; scene.add(beam);

  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.35, 0.4, 0.92); composer.addPass(bloom); composer.addPass(new OutputPass());

  let extent = null, m2w = 1, exag = 1, seaLevelY = 0;
  let dance = false, chgValues = new Float32Array(N * N), scan = null, sel = null;
  const pickCbs = [];

  function buildSkirt() {
    const pos = [], idx = []; const side = (getIdx) => {
      const start = pos.length / 3;
      for (let k = 0; k <= SEG; k++) { const i = getIdx(k); pos.push(P.getX(i), P.getY(i), P.getZ(i), P.getX(i), -1.0, P.getZ(i)); }
      for (let k = 0; k < SEG; k++) { const a = start + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    };
    const S1 = SEG + 1;
    side(k => k); side(k => SEG * S1 + (SEG - k)); side(k => (SEG - k) * S1); side(k => k * S1 + SEG);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    skirt.geometry.dispose(); skirt.geometry = g; skirtMat.side = THREE.DoubleSide;
  }

  async function load(aoi, onStatus) {
    const z = aoi.zoom ?? 11, k = aoi.tiles ?? 3;
    const cx = Math.floor(lon2x(aoi.lon, z)), cy = Math.floor(lat2y(aoi.lat, z));
    const x0 = cx - (k >> 1), y0 = cy - (k >> 1);
    extent = { west: x2lon(x0, z), east: x2lon(x0 + k, z), north: y2lat(y0, z), south: y2lat(y0 + k, z) };
    onStatus?.('Loading elevation (AWS Terrain Tiles)…');
    const dem = await mosaic((x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, x0, y0, k);
    onStatus?.('Loading satellite imagery…');
    const z2 = z + 1;
    let img = await mosaic((x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z2}/${y}/${x}`, x0 * 2, y0 * 2, k * 2);
    if (img.ok < k * k) img = await mosaic((x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${Math.min(8, z2)}/${y}/${x}.jpeg`, x0 * 2, y0 * 2, k * 2);

    // heights
    const dw = dem.canvas.width, d = dem.canvas.getContext('2d').getImageData(0, 0, dw, dw).data;
    const elevAt = (u, v) => { const x = Math.min(dw - 1, Math.max(0, Math.round(u * (dw - 1)))), y = Math.min(dw - 1, Math.max(0, Math.round((1 - v) * (dw - 1)))), i = (y * dw + x) * 4; return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768; };
    const widthKm = (extent.east - extent.west) * 111.32 * Math.cos(aoi.lat * Math.PI / 180);
    m2w = SIZE / (widthKm * 1000);
    let mn = Infinity, mx = -Infinity; const raw = new Float32Array(NV);
    for (let i = 0; i < NV; i++) { const u = (P.getX(i) + SIZE / 2) / SIZE, v = 1 - (P.getZ(i) + SIZE / 2) / SIZE; let e = elevAt(u, v); raw[i] = e; mn = Math.min(mn, e); mx = Math.max(mx, Math.max(e, 0)); }
    const landMin = Math.max(mn, 0);
    exag = Math.min(6, Math.max(1.5, 1.0 / ((mx - landMin) * m2w || 1)));
    const hasSea = mn < -5;
    for (let i = 0; i < NV; i++) {
      let e = raw[i]; if (e < 0) e = e * 0.08;
      base[i] = (e - landMin) * m2w * exag - 0.6; P.setY(i, base[i]);
    }
    seaLevelY = (0 - landMin) * m2w * exag - 0.6;
    water.visible = hasSea; water.position.y = seaLevelY + 0.004;
    P.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); buildSkirt();

    const t = new THREE.CanvasTexture(img.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    terrainMat.map?.dispose(); terrainMat.map = t; terrainMat.needsUpdate = true;
    onStatus?.('');
    return { extent, widthKm, exag, minElev: mn, maxElev: mx };
  }

  function setImage(canvas, opacity = 0.85) {
    if (!canvas) { ovMat.uniforms.imgOn.value = 0; return; }
    const prev = ovMat.uniforms.imgMap.value; const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    ovMat.uniforms.imgMap.value = t; ovMat.uniforms.imgOn.value = 1; ovMat.uniforms.imgOpacity.value = opacity;
    if (prev !== blank) prev.dispose();
  }
  function setChange(values) {
    if (!values) { ovMat.uniforms.chgOn.value = 0; chgValues.fill(0); return; }
    chgValues = values;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = values[r * N + c], j = ((N - 1 - r) * N + c) * 4; chgData[j] = Number.isFinite(v) ? Math.round(v * 255) : 0; chgData[j + 3] = 255;
    }
    chgTex.needsUpdate = true; ovMat.uniforms.chgOn.value = 1;
  }
  function setSelected(r, c) { sel = [r, c]; ovMat.uniforms.sel.value.set(c, N - 1 - r); ovMat.uniforms.selOn.value = 1; }
  function scanPass(dur = 2600) { scan = { t0: performance.now(), dur }; sat.visible = beam.visible = true; }

  // picking
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rc = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(mouse, camera); const hit = ray.intersectObject(terrain)[0];
    if (!hit) return;
    const u = hit.uv.x, v = hit.uv.y; const r = Math.min(N - 1, Math.floor((1 - v) * N)), c = Math.min(N - 1, Math.floor(u * N));
    setSelected(r, c);
    pickCbs.forEach(f => f(r, c, extent ? { lat: extent.north - (r + 0.5) / N * (extent.north - extent.south), lon: extent.west + (c + 0.5) / N * (extent.east - extent.west) } : null));
  });

  function resize() { const w = W(), h = H(); if (!w || !h) return; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); }
  new ResizeObserver(resize).observe(container);

  let visible = true, running = true; const clock = new THREE.Clock();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 }); io.observe(container);
  const onFrame = [];
  function tick() {
    if (!running) return; requestAnimationFrame(tick); if (!visible) return;
    const t = clock.getElapsedTime(); ovMat.uniforms.time.value = t;
    if (dance) {
      const amp = 0.55 * (0.7 + 0.3 * Math.sin(t * 4.2));
      for (let i = 0; i < NV; i++) P.setY(i, base[i] + (chgValues[vcell[i]] || 0) * amp);
      P.needsUpdate = true;
    }
    if (scan) {
      const k = Math.min(1, (performance.now() - scan.t0) / scan.dur), x = -7 + 14 * k;
      sat.position.set(x, 5.2, -1.2); sat.rotation.set(0, Math.PI / 2, 0.15);
      beam.position.set(x, 2.4, -0.4); beam.scale.set(0.22, 5.6, 3.6); beam.rotation.set(-0.15, 0, 0);
      ovMat.uniforms.scanOn.value = 1; ovMat.uniforms.scanPos.value = (x + SIZE / 2) / SIZE;
      if (k >= 1) { scan = null; sat.visible = beam.visible = false; ovMat.uniforms.scanOn.value = 0; }
    }
    onFrame.forEach(f => f(t));
    controls.update(); composer.render();
  }
  tick();

  return {
    load, setImage, setChange, setSelected, scanPass, camera, controls, renderer, scene,
    onPick: f => pickCbs.push(f), onFrame,
    setDance(v) { dance = v; if (!v) { for (let i = 0; i < NV; i++) P.setY(i, base[i]); P.needsUpdate = true; } },
    setGrid(v) { ovMat.uniforms.gridOn.value = v ? 1 : 0; },
    setActive(v) { visible = v; },
    get extent() { return extent; },
    get canvas() { return renderer.domElement; },
    dispose() { running = false; io.disconnect(); renderer.dispose(); }
  };
}
