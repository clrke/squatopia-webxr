import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The Alpine biome: the game's alpine palette (IslandBiomes.Palette(Alpine)), its snow line and mood (fog CCDEED, sun FFF2DC),
// its vertex-coloured pines, rocks and alpine props. The player stands on a ledge over a meadow valley ringed by snowy peaks.

const PAL = {
  deep: 0x3C6A2E, mid: 0x5A8A3E, light: 0x80A452, patch: 0x8A9A5A, forest: 0x2F5E24,
  dirt: 0xA9845A, rock: 0xB4A48E, snow: 0xF2F5FA,
};
export const FOG = 0xCCDEED;
const SUN = 0xFFF2DC;

// --- noise (value noise, seeded) ---
function hash(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, oct = 4) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * amp; f *= 2; amp *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
function ridged(x, z) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { s += (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)) ** 2 * amp; f *= 2.1; amp *= 0.5; }
  return s;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height at (x, z); the player's ledge is flat at 0 round the origin. */
export function height(x, z) {
  const d = Math.hypot(x, z);
  const valley = -9 * smooth(4, 40, d);
  const behind = Math.max(0, z) * 0.35 * smooth(6, 40, z);
  const hills = (fbm(x * 0.012 + 3, z * 0.012 + 7) - 0.5) * 14 * smooth(10, 60, d);
  const ring = smooth(120, 300, d);
  const peaks = ring * (60 + ridged(x * 0.006 + 11, z * 0.006 + 5) * 150);
  const ledge = (fbm(x * 0.3, z * 0.3, 2) - 0.5) * 0.6 * smooth(3.5, 6, d);
  return valley + behind + hills + peaks + ledge;
}

function terrain() {
  const size = 1100, seg = 240;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), t = new THREE.Color();
  const pal = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, new THREE.Color(v)]));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, height(x, z));
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    // Meadow greens with olive patches and forest floor, like IslandPalette.
    const n1 = fbm(x * 0.03, z * 0.03, 3), n2 = fbm(x * 0.08 + 9, z * 0.08 + 4, 2);
    c.copy(pal.deep).lerp(pal.mid, smooth(0.35, 0.6, n1)).lerp(pal.light, smooth(0.6, 0.8, n1) * 0.7);
    c.lerp(pal.patch, smooth(0.62, 0.75, n2) * 0.6);
    c.lerp(pal.forest, smooth(0.55, 0.3, n2) * 0.4);
    // Rock on steep slopes and the high flanks, darker in hollows.
    c.lerp(pal.rock, Math.max(smooth(0.25, 0.45, slope), smooth(30, 70, h) * 0.85));
    // Snow cap on the gentler slopes above the snow line, plus a dusting in the valley.
    const line = 55 + fbm(x * 0.01, z * 0.01, 2) * 25;
    const snow = smooth(line, line + 12, h) * (1 - smooth(0.45, 0.65, slope));
    const dust = smooth(0.66, 0.74, fbm(x * 0.05 + 2, z * 0.05 + 2, 3)) * (1 - smooth(0.2, 0.35, slope)) * 0.85;
    c.lerp(pal.snow, Math.max(snow, dust));
    // Ledge: packed snow round the player.
    c.lerp(pal.snow, 1 - smooth(3, 5.5, Math.hypot(x, z)));
    const shade = 0.9 + fbm(x * 0.2, z * 0.2, 2) * 0.2;
    t.copy(c).multiplyScalar(shade);
    colors[i * 3] = t.r; colors[i * 3 + 1] = t.g; colors[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

function sky() {
  const g = new THREE.SphereGeometry(2000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6FA4DC) }, horizon: { value: new THREE.Color(FOG) }, sunDir: { value: new THREE.Vector3(0.4, 0.5, -0.75).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.6));
      float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0, 0.93, 0.8) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10;
  return mesh;
}

function snowfall() {
  const count = 1400, box = [60, 26, 60];
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = Math.random() * box[1] - 6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * box[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  points.userData.update = (dt, time) => {
    for (let i = 0; i < count; i++) {
      let y = pos[i * 3 + 1] - (0.6 + (i % 7) * 0.08) * dt;
      if (y < -6) y += box[1];
      pos[i * 3 + 1] = y;
      pos[i * 3] += Math.sin(time * 0.7 + i) * 0.15 * dt;
    }
    g.getAttribute('position').needsUpdate = true;
  };
  return points;
}

/** Loads a model and returns its meshes' geometries baked into the model's space, with one shared two-sided vertex-colour material. */
async function loadParts(loader, name) {
  const gltf = await loader.loadAsync(`assets/models/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    parts.push(geometry);
  });
  return parts;
}

const PROP_MATERIAL = () => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

function instanced(parts, matrices, material) {
  const group = new THREE.Group();
  for (const geometry of parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

function place(x, z, yaw, scale, sink = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, height(x, z) - sink, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale));
}

export async function buildWorld(scene, onProgress = () => {}) {
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, 90, 780);
  scene.add(sky());

  const hemi = new THREE.HemisphereLight(0xD8E8F6, 0x5A6A48, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SUN, 2.4);
  sun.position.set(40, 60, -70);
  scene.add(sun);

  scene.add(terrain());
  const snow = snowfall();
  scene.add(snow);

  const loader = new GLTFLoader();
  const names = ['Pine_A', 'Pine_B', 'Rock_A', 'Rock_B', 'Rock_C', 'Alpine_Chalet', 'Alpine_Cairn_A', 'Alpine_FlagLine',
    'Alpine_Logs', 'Alpine_IceCrystal', 'Alpine_BrokenPine', 'Alpine_LanternPole'];
  const parts = {};
  let done = 0;
  await Promise.all(names.map(async n => { parts[n] = await loadParts(loader, n); onProgress(++done / names.length); }));
  const material = PROP_MATERIAL();

  // Pines on the valley floor and lower slopes, under the tree line, in loose clumps.
  const pines = [[], []];
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600 && pines[0].length + pines[1].length < 340; i++) {
    const a = rnd() * Math.PI * 2, d = 16 + Math.pow(rnd(), 0.7) * 260;
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    const h = height(x, z);
    if (h > 48 || fbm(x * 0.02 + 5, z * 0.02 + 1, 3) < 0.48) continue;
    // Keep the near range in front open: targets fly there.
    if (z < 0 && Math.abs(Math.atan2(x, -z)) < 1.1 && d < 34) continue;
    pines[rnd() < 0.5 ? 0 : 1].push(place(x, z, rnd() * 6.28, 0.75 + rnd() * 0.6, 0.2));
  }
  scene.add(instanced(parts.Pine_A, pines[0], material));
  scene.add(instanced(parts.Pine_B, pines[1], material));

  const rocks = [[], [], []];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, d = 7 + rnd() * 200;
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    rocks[i % 3].push(place(x, z, rnd() * 6.28, 0.6 + rnd() * 1.6, 0.3));
  }
  // The ledge's rim: boulders either side and behind the player.
  [[-4.2, -1.2, 1.1], [4.6, -0.6, 1.3], [-3.5, 3.8, 1.5], [3.2, 4.5, 1.2], [0.5, 6, 1.6]].forEach(([x, z, s], i) =>
    rocks[i % 3].push(place(x, z, i * 1.7, s, 0.35)));
  rocks.forEach((list, i) => scene.add(instanced(parts[`Rock_${'ABC'[i]}`], list, material)));

  const one = (name, x, z, yaw, scale = 1, sink = 0) => scene.add(instanced(parts[name], [place(x, z, yaw, scale, sink)], material));
  one('Alpine_Chalet', -34, -38, 0.75, 1.2, 0.3);
  one('Alpine_Logs', -27, -31, 1.6, 1);
  one('Alpine_IceCrystal', 46, -82, 0.4, 1.4, 1);
  one('Alpine_FlagLine', -6.5, 3.5, 1.2, 1);
  one('Alpine_Cairn_A', -3.4, -2.6, 0.3, 1);
  one('Alpine_Cairn_A', 3.8, -2.2, 2.1, 0.8);
  one('Alpine_LanternPole', -2.6, 1.6, 0.4, 0.9);
  one('Alpine_LanternPole', 2.6, 1.6, -0.4, 0.9);
  one('Alpine_BrokenPine', 20, -22, 0.9, 1.3);
  one('Alpine_BrokenPine', -18, -48, 2.4, 1.2);

  return { update: (dt, time) => snow.userData.update(dt, time) };
}
