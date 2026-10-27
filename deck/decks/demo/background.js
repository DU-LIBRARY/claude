import * as THREE from 'three';
import gsap from 'gsap';

// A drifting particle field that reshapes itself per slide.
// Each scene index maps to a formation the particles morph into.
const COUNT = 6000;

const formations = [
  // 0 wide galaxy swirl
  (i, n) => { const a = i * 0.0125, r = 2 + (i / n) * 14; return [Math.cos(a) * r, (Math.random() - 0.5) * 1.5, Math.sin(a) * r]; },
  // 1 flat wave plane
  (i, n) => { const x = ((i % 100) / 100 - 0.5) * 34, z = (Math.floor(i / 100) / (n / 100) - 0.5) * 20; return [x, Math.sin(x * 0.4) * 1.5 - 4, z]; },
  // 2 sphere
  (i, n) => { const phi = Math.acos(1 - (2 * (i + 0.5)) / n), th = Math.PI * (1 + 5 ** 0.5) * i, r = 9; return [r * Math.cos(th) * Math.sin(phi), r * Math.sin(th) * Math.sin(phi), r * Math.cos(phi)]; },
  // 3 tunnel
  (i, n) => { const a = i * 0.37, z = -(i / n) * 60 + 4; return [Math.cos(a) * 9, Math.sin(a) * 6, z]; },
  // 4 rising columns
  (i) => { const c = i % 5; return [(c - 2) * 6 + (Math.random() - 0.5), Math.random() * 14 - 7, (Math.random() - 0.5) * 3]; },
  // 5 helix
  (i, n) => { const t = (i / n) * Math.PI * 16, s = i % 2 ? 1 : -1; return [Math.cos(t) * 5 * s, (i / n - 0.5) * 30, Math.sin(t) * 5 * s]; },
  // 6 torus
  (i, n) => { const u = (i / n) * Math.PI * 2 * 40, v = i * 0.61; const R = 9, r = 2.6; return [(R + r * Math.cos(v)) * Math.cos(u / 40), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u / 40)]; },
];

export function startBackground(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 2, 26);

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const target = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const c1 = new THREE.Color('#7c5cff'), c2 = new THREE.Color('#00e0c6'), c3 = new THREE.Color('#ff5c8a');
  for (let i = 0; i < COUNT; i++) {
    const c = Math.random() < 0.08 ? c3 : c1.clone().lerp(c2, Math.random());
    colors.set([c.r, c.g, c.b], i * 3);
    pos.set([(Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const sprite = (() => {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(s);
  })();
  const mat = new THREE.PointsMaterial({ size: 0.22, map: sprite, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  const state = { morph: 1 };
  const from = new Float32Array(COUNT * 3);

  function setScene(idx) {
    const f = formations[idx % formations.length];
    from.set(pos);
    for (let i = 0; i < COUNT; i++) target.set(f(i, COUNT), i * 3);
    state.morph = 0;
    gsap.to(state, { morph: 1, duration: 2.4, ease: 'expo.inOut', overwrite: true });
  }

  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  gsap.ticker.add((t) => {
    const m = state.morph;
    for (let i = 0; i < COUNT * 3; i++) {
      // stagger each particle slightly so the morph ripples instead of snapping
      const k = Math.min(1, Math.max(0, m * 1.4 - (i / (COUNT * 3)) * 0.4));
      pos[i] = from[i] + (target[i] - from[i]) * k + Math.sin(t * 0.8 + i) * 0.02;
    }
    geo.attributes.position.needsUpdate = true;
    points.rotation.y = t * 0.04;
    camera.position.x += (mouse.x * 6 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 4 + 2 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });

  return { setScene };
}
