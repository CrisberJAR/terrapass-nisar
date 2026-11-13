/**
 * Procedural NASA-ISRO NISAR spacecraft model (no external assets):
 *  - ISRO I3K bus wrapped in gold multi-layer insulation
 *  - L-band / S-band radar instrument structure
 *  - 9 m deployable truss boom
 *  - 12 m wire-mesh drum reflector (the largest ever launched by NASA)
 *  - solar array wing
 */
import * as THREE from 'three';

function foilTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 256, 256);
  grd.addColorStop(0, '#f6d77a'); grd.addColorStop(0.5, '#b8862b'); grd.addColorStop(1, '#f1c75b');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) { // crinkles
    g.strokeStyle = `rgba(${Math.random() > 0.5 ? '255,240,190' : '90,60,10'},${0.08 + Math.random() * 0.18})`;
    g.lineWidth = 0.5 + Math.random() * 2;
    g.beginPath(); const x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y);
    g.bezierCurveTo(x + Math.random() * 40 - 20, y + Math.random() * 40 - 20, x + Math.random() * 60 - 30, y + Math.random() * 60 - 30, x + Math.random() * 80 - 40, y + Math.random() * 80 - 40);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function solarTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1a3c'; g.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 512; x += 16) for (let y = 0; y < 128; y += 16) {
    const l = 18 + Math.random() * 14;
    g.fillStyle = `hsl(222,70%,${l}%)`; g.fillRect(x + 1, y + 1, 14, 14);
  }
  g.strokeStyle = 'rgba(200,210,230,.55)'; g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 102.4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createNisar() {
  const sat = new THREE.Group();
  sat.name = 'NISAR';
  const foil = new THREE.MeshStandardMaterial({ map: foilTexture(), metalness: 0.95, roughness: 0.32, emissive: 0x2a1a00, emissiveIntensity: 0.25 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9edf3, metalness: 0.2, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.6, roughness: 0.4 });

  // spacecraft bus
  const bus = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 1.2), foil); sat.add(bus);
  // radar instrument structure (octagonal) on top of bus
  const inst = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 1.2, 8), white); inst.position.y = 1.35; sat.add(inst);
  const feed = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.25), dark); feed.position.set(0, 1.4, 0.72); sat.add(feed);
  // antennas / details
  const hga = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.05, 0.12, 20), white); hga.position.set(0.45, -0.85, 0.3); sat.add(hga);

  // solar array wing
  const wing = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ map: solarTexture(), metalness: 0.4, roughness: 0.25, emissive: 0x07142e, emissiveIntensity: 0.6 });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.04, 1.3), panelMat); panel.position.x = -3.4; wing.add(panel);
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), dark); yoke.rotation.z = Math.PI / 2; yoke.position.x = -0.85; wing.add(yoke);
  wing.position.set(0, 0.2, 0); sat.add(wing);

  // deployable boom (truss) towards reflector
  const boomPts = [new THREE.Vector3(0.0, 1.9, 0.6), new THREE.Vector3(2.0, 3.6, 3.2), new THREE.Vector3(3.2, 4.4, 6.6)];
  const boomCurve = new THREE.CatmullRomCurve3(boomPts);
  const boom = new THREE.Mesh(new THREE.TubeGeometry(boomCurve, 40, 0.07, 6, false), new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.7, roughness: 0.3 }));
  sat.add(boom);

  // 12 m wire-mesh reflector: shallow paraboloid (scaled; bus ~ 1.5 m)
  const R = 4.2, depth = 1.1, pts = [];
  for (let i = 0; i <= 24; i++) { const r = (i / 24) * R; pts.push(new THREE.Vector2(r, (r * r) / (R * R) * depth)); }
  const refGeo = new THREE.LatheGeometry(pts, 72);
  const meshMat = new THREE.MeshStandardMaterial({ color: 0xe6cf8d, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide, transparent: true, opacity: 0.82, emissive: 0x2a2208, emissiveIntensity: 0.3 });
  const reflector = new THREE.Group();
  reflector.add(new THREE.Mesh(refGeo, meshMat));
  reflector.add(new THREE.Mesh(refGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c4, wireframe: true, transparent: true, opacity: 0.22 })));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 8, 96), new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.8, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = depth; reflector.add(rim);
  for (let i = 0; i < 12; i++) { // drum ribs
    const a = (i / 12) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, R, 4), white);
    rib.position.set(Math.cos(a) * R / 2, depth * 0.35, Math.sin(a) * R / 2); rib.rotation.z = Math.PI / 2; rib.rotation.y = -a; reflector.add(rib);
  }
  reflector.position.copy(boomPts[2]);
  reflector.rotation.x = Math.PI * 0.82; // faces back towards the feed / Earth
  sat.add(reflector);
  sat.userData.reflector = reflector;
  return sat;
}

/** radial glow sprite texture (sun, markers) */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner); grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)')); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
