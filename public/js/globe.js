/**
 * Cinematic photoreal Earth for TerraPass
 *  - NASA Blue Marble (day) + Black Marble (night lights) blended on the real solar terminator
 *  - ocean sun-glint (specular mask), relief bump, procedural animated clouds, Rayleigh-like atmosphere
 *  - NISAR in a 747 km sun-synchronous orbit (98.4°) painting its 242 km radar swath
 *  - real NISAR footprints (NASA CMR), NASA EONET live events, clickable study areas
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createNisar, glowTexture } from './satellite.js';

const TEX = '/assets/textures/';
export const R_EARTH_KM = 6371;

export function ll2v(lat, lon, r = 1) {
  const la = THREE.MathUtils.degToRad(lat), ph = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(-Math.cos(ph) * Math.cos(la) * r, Math.sin(la) * r, Math.sin(ph) * Math.cos(la) * r);
}

/** sub-solar point for a date (good to ~1°) */
export function subSolar(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0), doy = (date - start) / 864e5;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10));
  const g = (2 * Math.PI / 365) * (doy - 1);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const lon = -((utcMin + eot) / 4 - 180);
  return { lat: decl, lon: ((lon + 540) % 360) - 180 };
}

const earthVert = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w; }`;
const earthFrag = /* glsl */`
  uniform sampler2D dayMap, nightMap, specMap, bumpMap; uniform vec3 sunDir; uniform float time;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW;
  void main(){
    vec3 N = normalize(vN);
    // relief from topology bump map (sphere tangent frame)
    vec2 px = vec2(1.0/2048.0, 1.0/1024.0);
    float h = texture2D(bumpMap, vUv).r, hx = texture2D(bumpMap, vUv + vec2(px.x,0.)).r, hy = texture2D(bumpMap, vUv + vec2(0.,px.y)).r;
    vec3 T = normalize(cross(vec3(0.,1.,0.), N) + 1e-5); vec3 B = cross(N, T);
    N = normalize(N + (T * (h - hx) + B * (hy - h)) * 6.0);
    vec3 V = normalize(cameraPosition - vW);
    float ndl = dot(N, sunDir), ndlS = dot(normalize(vN), sunDir);
    vec3 day = texture2D(dayMap, vUv).rgb;
    day = pow(day, vec3(0.92)) * 1.08;
    vec3 night = texture2D(nightMap, vUv).rgb; night = pow(night, vec3(1.6)) * vec3(1.25, 0.95, 0.65) * 2.2;
    float dayMix = smoothstep(-0.18, 0.22, ndlS);
    float water = texture2D(specMap, vUv).r;
    vec3 Rf = reflect(-sunDir, normalize(vN));
    float spec = pow(max(dot(Rf, V), 0.0), 60.0) * water * 0.55 + pow(max(dot(Rf, V), 0.0), 8.0) * water * 0.08;
    vec3 sunCol = vec3(1.0, 0.96, 0.88);
    // twilight reddening near the terminator
    float tw = smoothstep(-0.12, 0.05, ndlS) * (1.0 - smoothstep(0.05, 0.35, ndlS));
    vec3 lit = day * (max(ndl, 0.0) * 1.15 + 0.035) * sunCol + vec3(1.0, 0.45, 0.2) * tw * 0.18 * day;
    vec3 col = mix(night, lit, dayMix) + spec * sunCol * smoothstep(0.0, 0.2, ndlS);
    // atmospheric scattering at the limb
    float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
    col += vec3(0.30, 0.58, 1.0) * fres * (0.15 + 0.85 * smoothstep(-0.25, 0.4, ndlS)) * 0.6;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const cloudFrag = /* glsl */`
  uniform vec3 sunDir; uniform float time; varying vec3 vN; varying vec3 vP; varying vec3 vW;
  vec3 hash3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(vec3(p.x*p.y*p.z, p.x+p.y*p.z, p.x*p.y+p.z)); }
  float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash3(i).x, hash3(i+vec3(1,0,0)).x, f.x), mix(hash3(i+vec3(0,1,0)).x, hash3(i+vec3(1,1,0)).x, f.x), f.y),
               mix(mix(hash3(i+vec3(0,0,1)).x, hash3(i+vec3(1,0,1)).x, f.x), mix(hash3(i+vec3(0,1,1)).x, hash3(i+vec3(1,1,1)).x, f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<6;i++){ s += a*noise(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
  void main(){
    vec3 p = normalize(vP);
    float lat = p.y;
    // zonal wind shear: bands drift at different speeds (trade winds / westerlies)
    float ang = time * (0.006 + 0.01 * sin(lat * 3.0));
    mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec3 q = vec3(rot * p.xz, p.y).xzy;
    float warp = fbm(q * 2.0 + time * 0.01);
    float c = fbm(q * 3.4 + warp * 1.6);
    float itcz = exp(-pow(lat * 6.0, 2.0)) * 0.12;   // equatorial convergence zone
    float storm = smoothstep(0.35, 0.75, abs(lat)) * 0.08; // mid-latitude storm tracks
    c = smoothstep(0.56 - itcz - storm, 0.86, c);
    float ndl = dot(normalize(vN), sunDir);
    float light = smoothstep(-0.15, 0.35, ndl);
    vec3 V = normalize(cameraPosition - vW);
    float edge = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.0);
    vec3 col = mix(vec3(0.02, 0.03, 0.05), vec3(1.0), light) * (0.92 + 0.08 * edge);
    gl_FragColor = vec4(col * 0.92, c * 0.62 * (1.0 - edge * 0.5));
  }`;
const cloudVert = /* glsl */`varying vec3 vN; varying vec3 vP; varying vec3 vW;
  void main(){ vP = position; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;

const atmoFrag = /* glsl */`uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
  void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(0.78 - dot(normalize(vN), V), 4.0);
    float day = smoothstep(-0.45, 0.5, dot(normalize(vN), sunDir));
    vec3 col = mix(vec3(0.35, 0.18, 0.45), vec3(0.32, 0.62, 1.0), day);
    gl_FragColor = vec4(col, 1.0) * f * (0.25 + 1.4 * day); }`;
const atmoVert = /* glsl */`varying vec3 vN; varying vec3 vW;
  void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;

export function createGlobe(container, opts = {}) {
  const W = () => container.clientWidth, H = () => container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer(); labels.setSize(W(), H());
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000004);
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 0.01, 2000);
  if (opts.shiftX && W() > 900) camera.setViewOffset(W(), H(), -W() * opts.shiftX, 0, W(), H());
  camera.position.set(0, 1.2, 9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.06; controls.enablePan = false;
  controls.minDistance = 1.35; controls.maxDistance = 14; controls.rotateSpeed = 0.5; controls.zoomSpeed = 0.6;
  controls.autoRotate = opts.autoRotate !== false; controls.autoRotateSpeed = 0.35;
  if (opts.noZoom) controls.enableZoom = false;

  const loader = new THREE.TextureLoader();
  const tex = (f, srgb = true) => { const t = loader.load(TEX + f); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };

  // starfield: Milky Way panorama + crisp twinkling points
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), new THREE.MeshBasicMaterial({ map: tex('night-sky.png'), side: THREE.BackSide, color: 0x6a7088, depthWrite: false }));
  scene.add(sky);
  const NS = 5000, sp = new Float32Array(NS * 3), ss = new Float32Array(NS), sc = new Float32Array(NS * 3);
  for (let i = 0; i < NS; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 200); sp.set([v.x, v.y, v.z], i * 3);
    ss[i] = Math.pow(Math.random(), 6) * 3.2 + 0.4;
    const t = Math.random(); const col = t < 0.15 ? [1, 0.82, 0.7] : t < 0.3 ? [0.75, 0.85, 1] : [1, 1, 1]; sc.set(col, i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('size', new THREE.BufferAttribute(ss, 1)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pr: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `attribute float size; varying vec3 vC; varying float vT; uniform float time; uniform float pr;
      void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); vT = 0.65+0.35*sin(time*1.7+position.x*0.13+position.y*0.07);
      gl_PointSize = size * pr * vT; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vT; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vC*a*vT, a); }`
  });
  scene.add(new THREE.Points(sg, starMat));

  // Earth
  const sun = subSolar(opts.date || new Date());
  const sunDir = ll2v(opts.sunLat ?? sun.lat, opts.sunLon ?? sun.lon, 1).normalize();
  const earth = new THREE.Group(); scene.add(earth);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { dayMap: { value: tex('earth-blue-marble.jpg') }, nightMap: { value: tex('earth-night.jpg') }, specMap: { value: tex('earth-water.png', false) }, bumpMap: { value: tex('earth-topology.png', false) }, sunDir: { value: sunDir }, time: { value: 0 } },
    vertexShader: earthVert, fragmentShader: earthFrag
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), earthMat); earth.add(globe);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 128, 64), new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sunDir }, time: { value: 0 } }, vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false }));
  earth.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 48), new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sunDir } }, vertexShader: atmoVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(atmo);

  // Sun glow (far away, along sunDir)
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,244,214,1)', 'rgba(255,200,120,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(70); sunSprite.position.copy(sunDir).multiplyScalar(500); scene.add(sunSprite);
  const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.4); sunLight.position.copy(sunDir).multiplyScalar(50); scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x334466, 0.35));

  /* ---------------- NISAR orbit: 747 km, i = 98.4°, side-looking SAR swath 242 km ---------------- */
  const ORB_R = 1 + 747 / R_EARTH_KM, INC = THREE.MathUtils.degToRad(98.4);
  const orbitPlane = new THREE.Group(); orbitPlane.rotation.order = 'YXZ'; orbitPlane.rotation.x = INC; orbitPlane.rotation.y = opts.raan ?? THREE.MathUtils.degToRad(-20);
  scene.add(orbitPlane);
  const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.EllipseCurve(0, 0, ORB_R, ORB_R).getPoints(256).map(p => new THREE.Vector3(p.x, 0, p.y))),
    new THREE.LineDashedMaterial({ color: 0x7fdcff, transparent: true, opacity: 0.35, dashSize: 0.02, gapSize: 0.015 }));
  orbitLine.computeLineDistances(); orbitPlane.add(orbitLine);
  const sat = createNisar(); sat.scale.setScalar(0.0042); scene.add(sat);
  // radar beam (side-looking, ~37° off nadir)
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float time; varying vec2 vUv; void main(){ float pulse = 0.5+0.5*sin(vUv.y*60.0 - time*18.0);
      float a = (0.10 + 0.22*pulse) * smoothstep(0.0,0.15,vUv.y) * (1.0 - abs(vUv.x-0.5)*1.6);
      gl_FragColor = vec4(vec3(0.25,0.95,1.0)*a, a); }`
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 48, 1, true), beamMat); scene.add(beam);
  // swath trail on the ground (ring buffer ribbon)
  const TRAIL = 420, trailPos = new Float32Array(TRAIL * 2 * 3), trailAge = new Float32Array(TRAIL * 2);
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute('age', new THREE.BufferAttribute(trailAge, 1));
  const idx = []; for (let i = 0; i < TRAIL - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } trailGeo.setIndex(idx);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float age; varying float vA; void main(){ vA = age; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying float vA; void main(){ float a = pow(1.0 - vA, 2.2) * 0.35; gl_FragColor = vec4(vec3(0.2,0.9,1.0)*a, a); }`
  });
  const trail = new THREE.Mesh(trailGeo, trailMat); trail.frustumCulled = false; earth.add(trail);
  let trailCount = 0, lastTrail = 0;
  const swathHalf = (242 / 2) / R_EARTH_KM, swathOff = 0.045; // ground offset from nadir (side-looking)

  /* ---------------- data layers ---------------- */
  const fpGroup = new THREE.Group(); earth.add(fpGroup);
  const evGroup = new THREE.Group(); earth.add(evGroup);
  const aoiGroup = new THREE.Group(); earth.add(aoiGroup);

  function setFootprints(granules) {
    fpGroup.clear();
    const mat = new THREE.LineBasicMaterial({ color: 0x45e3ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });
    const fill = new THREE.MeshBasicMaterial({ color: 0x1fb6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const g of granules) {
      if (!g.polygon) continue;
      const pts = g.polygon.map(([lon, lat]) => ll2v(lat, lon, 1.0025));
      fpGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }

  const CAT = { wildfires: 0xff6b35, floods: 0x3aa0ff, severeStorms: 0xd8b4fe, volcanoes: 0xff3355, seaLakeIce: 0xbfe9ff, earthquakes: 0xffd166, landslides: 0xc59b6d, drought: 0xe0b44a };
  const evMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pr: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `uniform float time; uniform float pr; attribute float seed; varying vec3 vC; varying float vP;
      void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); vP = fract(time*0.45 + seed);
      gl_PointSize = (7.0 + 16.0*vP) * pr * (3.2 / -mv.z); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vP; void main(){ float d = length(gl_PointCoord-0.5);
      float core = smoothstep(0.18,0.0,d); float ring = smoothstep(0.04,0.0,abs(d-0.42*vP-0.06))*(1.0-vP);
      float a = core + ring; if(a<0.01) discard; gl_FragColor = vec4(vC*a, a); }`
  });
  function setEvents(events) {
    evGroup.clear();
    const pos = [], col = [], seed = [];
    for (const e of events) { const v = ll2v(e.lat, e.lon, 1.004); pos.push(v.x, v.y, v.z); const c = new THREE.Color(CAT[e.categoryId] ?? 0xffffff); col.push(c.r, c.g, c.b); seed.push(Math.random()); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    evGroup.add(new THREE.Points(g, evMat));
  }

  function setAois(aois, onClick) {
    aoiGroup.clear();
    for (const a of aois) {
      const base = ll2v(a.lat, a.lon, 1.0), tip = ll2v(a.lat, a.lon, 1.09);
      const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, base.distanceTo(tip), 6), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
      spike.position.copy(base.clone().add(tip).multiplyScalar(0.5)); spike.lookAt(tip); spike.rotateX(Math.PI / 2); aoiGroup.add(spike);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,209,102,1)', 'rgba(255,160,40,0)', 128), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.scale.setScalar(0.06); halo.position.copy(ll2v(a.lat, a.lon, 1.003)); halo.userData.pulse = true; aoiGroup.add(halo);
      const el = document.createElement('button');
      el.className = 'globe-label'; el.innerHTML = `<span class="dot"></span><b>${a.short}</b><small>${a.tag}</small>`;
      el.style.pointerEvents = 'auto'; el.onclick = () => onClick?.(a);
      const lbl = new CSS2DObject(el); lbl.position.copy(tip); aoiGroup.add(lbl);
    }
  }

  /* ---------------- camera fly-to ---------------- */
  let fly = null;
  function flyTo(lat, lon, dist = 2.4, dur = 2200) {
    const from = camera.position.clone(), to = ll2v(lat, lon, dist);
    fly = { from, to, t0: performance.now(), dur };
    controls.autoRotate = false;
  }

  /* ---------------- post-processing ---------------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.5, 0.82); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = W(), h = H(); if (!w || !h) return;
    camera.aspect = w / h;
    if (opts.shiftX && w > 900) camera.setViewOffset(w, h, -w * opts.shiftX, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h); labels.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);

  // intro: dolly in from deep space
  const intro = { t0: performance.now(), dur: opts.introMs ?? 3600, from: new THREE.Vector3(0, 1.6, 12), to: ll2v(opts.startLat ?? -8, opts.startLon ?? -70, opts.startDist ?? 3.3) };
  camera.position.copy(intro.from);

  let running = true, visible = true, orbitT = opts.orbitPhase ?? 0, orbitOverride = null;
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3(), up = new THREE.Vector3();
  const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const onFrame = [];

  function tick() {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
    earthMat.uniforms.time.value = t; clouds.material.uniforms.time.value = t; starMat.uniforms.time.value = t; beamMat.uniforms.time.value = t; evMat.uniforms.time.value = t;
    clouds.rotation.y += dt * 0.004;

    if (intro && !opts.manualCamera) {
      const k = Math.min(1, (now - intro.t0) / intro.dur);
      if (k < 1) { camera.position.lerpVectors(intro.from, intro.to, ease(k)); camera.position.setLength(THREE.MathUtils.lerp(intro.from.length(), intro.to.length(), ease(k))); }
      else if (!intro.done) { intro.done = true; }
    }
    if (fly) {
      const k = Math.min(1, (now - fly.t0) / fly.dur), e = ease(k);
      const a = fly.from.clone().normalize(), b = fly.to.clone().normalize();
      const dir = a.lerp(b, e).normalize(); const r = THREE.MathUtils.lerp(fly.from.length(), fly.to.length(), e) + Math.sin(Math.PI * e) * 0.6;
      camera.position.copy(dir.multiplyScalar(r)); if (k >= 1) fly = null;
    }

    // satellite along orbit (speed exaggerated: ~1 orbit / 48 s)
    if (orbitOverride == null) orbitT += dt * (opts.orbitSpeed ?? 0.13); else orbitT = orbitOverride;
    const p = new THREE.Vector3(Math.cos(orbitT) * ORB_R, 0, Math.sin(orbitT) * ORB_R); orbitPlane.localToWorld(p);
    const v = new THREE.Vector3(Math.cos(orbitT + 0.01) * ORB_R, 0, Math.sin(orbitT + 0.01) * ORB_R); orbitPlane.localToWorld(v);
    const vel = v.clone().sub(p).normalize(), nadir = p.clone().negate().normalize(), side = new THREE.Vector3().crossVectors(vel, nadir).normalize();
    sat.position.copy(p);
    up.copy(p).normalize(); const m = new THREE.Matrix4().makeBasis(vel, up, side); sat.quaternion.setFromRotationMatrix(m); sat.rotateX(-0.35);
    // beam to the ground swath centre (right-looking)
    const ground = p.clone().normalize().add(side.clone().multiplyScalar(swathOff)).normalize().multiplyScalar(1.001);
    const len = p.distanceTo(ground);
    beam.position.copy(p.clone().add(ground).multiplyScalar(0.5)); beam.scale.set(swathHalf * 1.15, len, swathHalf * 0.5);
    tmp.copy(ground).sub(p).normalize(); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmp);
    // swath trail (in Earth frame)
    if (t - lastTrail > 0.05) {
      lastTrail = t;
      trailPos.copyWithin(6, 0, (TRAIL - 1) * 6);
      const inv = earth.matrixWorld.clone().invert();
      const L = ground.clone().normalize().add(side.clone().multiplyScalar(-swathHalf)).normalize().multiplyScalar(1.003).applyMatrix4(inv);
      const Rr = ground.clone().normalize().add(side.clone().multiplyScalar(swathHalf)).normalize().multiplyScalar(1.003).applyMatrix4(inv);
      trailPos.set([L.x, L.y, L.z, Rr.x, Rr.y, Rr.z], 0);
      trailCount = Math.min(TRAIL, trailCount + 1);
      for (let i = 0; i < TRAIL; i++) { const a = i < trailCount ? i / TRAIL : 1; trailAge[i * 2] = a; trailAge[i * 2 + 1] = a; }
      trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.age.needsUpdate = true;
    }
    const camDir = camera.position.clone().normalize();
    aoiGroup.children.forEach(c => {
      if (c.userData.pulse) c.scale.setScalar(0.05 + 0.025 * (0.5 + 0.5 * Math.sin(t * 3)));
      if (c.isCSS2DObject) { const facing = c.position.clone().normalize().dot(camDir) > 0.15; c.element.style.opacity = facing ? '1' : '0'; c.element.style.pointerEvents = facing ? 'auto' : 'none'; }
    });
    onFrame.forEach(f => f(t, dt));
    if (!opts.manualCamera) controls.update();
    composer.render();
    labels.render(scene, camera);
  }
  tick();

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) clock.getDelta(); }, { threshold: 0.01 });
  io.observe(container);

  return {
    scene, camera, renderer, controls, earth, sat, sunDir, setFootprints, setEvents, setAois, flyTo, onFrame,
    setSun(lat, lon) { sunDir.copy(ll2v(lat, lon, 1).normalize()); sunSprite.position.copy(sunDir).multiplyScalar(500); sunLight.position.copy(sunDir).multiplyScalar(50); },
    setBloom(s) { bloom.strength = s; },
    setOrbit(v) { orbitOverride = v; },
    setActive(v) { visible = v; },
    get canvas() { return renderer.domElement; },
    dispose() { running = false; io.disconnect(); renderer.dispose(); }
  };
}
