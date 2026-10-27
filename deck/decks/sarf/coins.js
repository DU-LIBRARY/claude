import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';

// Real-lit gold dinars and silver dirhams that drift between formations.
// Each coin eases toward its formation's target, so switching formation
// on a slide change flows instead of cutting.
const N = 22;

function faceTexture(gold) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(190, 170, 40, 256, 256, 256);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#b8b8b8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#6a6a6a';
  g.lineWidth = 10;
  g.beginPath(); g.arc(256, 256, 226, 0, 7); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.arc(256, 256, 196, 0, 7); g.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath(); g.arc(256 + Math.cos(a) * 211, 256 + Math.sin(a) * 211, 4, 0, 7); g.fillStyle = '#7a7a7a'; g.fill();
  }
  g.fillStyle = '#5a5a5a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 150px Amiri, "Times New Roman", serif';
  g.fillText(gold ? 'دينار' : 'درهم', 256, 236);
  g.font = '600 38px Amiri, serif';
  g.fillText('لا إله إلا الله', 256, 360);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Formations: (index, time) → [x, y, z]
const formations = {
  // tilted double orbit around a point right of the title
  orbit: (i, t) => {
    const inner = i < 8, k = inner ? i / 8 : (i - 8) / (N - 8);
    const a = k * Math.PI * 2 + t * (inner ? 0.28 : -0.17);
    const r = inner ? 3.6 : 5.6;
    return [9 + Math.cos(a) * r, (inner ? 0.3 : -0.6) + Math.sin(a) * r * 0.32, Math.sin(a) * r * 0.9 - 2];
  },
  // spread to the far right, slow vertical drift
  side: (i, t) => {
    const col = i % 3, row = Math.floor(i / 3);
    return [7.5 + col * 2.3, ((row * 1.9 + t * 0.35) % 15) - 7.5, -4 - col * 2.5];
  },
  // pushed deep into the background, barely there
  deep: (i, t) => {
    const a = (i / N) * Math.PI * 2 + t * 0.05;
    return [Math.cos(a) * 17, Math.sin(a * 2) * 7, -16 + Math.sin(a) * 4];
  },
  // a halo ring behind centred text
  halo: (i, t) => {
    const a = (i / N) * Math.PI * 2 + t * 0.12;
    return [Math.cos(a) * 15, Math.sin(a) * 8.2, -8];
  },
  // falling like a market crash
  fall: (i, t) => {
    const x = ((i * 7.31) % 26) - 4, sp = 0.6 + ((i * 3.7) % 1) * 0.8;
    return [x, 9 - (((t * sp + i * 1.3) % 20)), -6 - (i % 4) * 2];
  },
};

export function startCoins(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // distant coins sink into the backdrop instead of cluttering the content
  scene.fog = new THREE.Fog('#0e1626', 26, 40);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  camera.position.set(0, 0, 22);

  const key = new THREE.DirectionalLight('#ffe7b0', 2.2);
  key.position.set(-6, 8, 10);
  scene.add(key, new THREE.AmbientLight('#334466', 0.6));

  const geo = new THREE.CylinderGeometry(1, 1, 0.14, 72, 1);
  geo.rotateX(Math.PI / 2);
  const mats = {};
  for (const gold of [true, false]) {
    const face = faceTexture(gold);
    const base = { color: gold ? '#e6bf5c' : '#d4dbe6', metalness: 1, roughness: gold ? 0.28 : 0.22 };
    const faceMat = new THREE.MeshStandardMaterial({ ...base, map: face, bumpMap: face, bumpScale: -2.2 });
    const edge = new THREE.MeshStandardMaterial({ ...base, roughness: 0.4 });
    mats[gold] = [edge, faceMat, faceMat];
  }

  const coins = [];
  for (let i = 0; i < N; i++) {
    const gold = i % 3 !== 1;
    const m = new THREE.Mesh(geo, mats[gold]);
    const s = 0.75 + ((i * 0.37) % 1) * 0.5;
    m.scale.setScalar(s);
    m.position.set((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 40, -40);
    m.userData = { spin: new THREE.Vector3(0.2 + Math.random() * 0.6, 0.3 + Math.random() * 0.8, Math.random() * 0.3), phase: Math.random() * 6 };
    scene.add(m);
    coins.push(m);
  }

  // gold dust
  const DUST = 900;
  const dpos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dpos.set([(Math.random() - 0.5) * 50, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30 - 5], i * 3);
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const sprite = (() => {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,230,170,1)'); grd.addColorStop(1, 'rgba(255,230,170,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(s);
  })();
  const dmat = new THREE.PointsMaterial({ size: 0.16, map: sprite, color: '#d9b45a', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(dgeo, dmat));

  let mode = 'orbit';
  const look = { x: 0, y: 0 }, mouse = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    // keep the 16:9 composition when the window is taller than wide
    camera.fov = camera.aspect < 16 / 9 ? 2 * Math.atan(Math.tan((40 * Math.PI) / 360) * (16 / 9) / camera.aspect) * (180 / Math.PI) : 40;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  const tmp = new THREE.Vector3();
  gsap.ticker.add((t, dt) => {
    const f = formations[mode];
    const k = 1 - Math.pow(0.0015, dt / 1000); // frame-rate independent ease
    coins.forEach((c, i) => {
      tmp.set(...f(i, t));
      // fall wraps around: snap instead of flying back up through the scene
      if (mode === 'fall' && tmp.y - c.position.y > 10) c.position.y = tmp.y;
      c.position.lerp(tmp, k);
      const u = c.userData;
      c.rotation.x = Math.sin(t * u.spin.x + u.phase) * 0.9;
      c.rotation.y = t * u.spin.y + u.phase;
      c.rotation.z = Math.sin(t * u.spin.z) * 0.3;
    });
    for (let i = 1; i < DUST * 3; i += 3) { dpos[i] += 0.004; if (dpos[i] > 15) dpos[i] = -15; }
    dgeo.attributes.position.needsUpdate = true;
    look.x += (mouse.x - look.x) * 0.04;
    look.y += (mouse.y - look.y) * 0.04;
    camera.position.x = look.x * 3;
    camera.position.y = -look.y * 2;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });

  return { setMode: (m) => { if (formations[m]) mode = m; } };
}
