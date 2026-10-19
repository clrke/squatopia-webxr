import * as THREE from 'three';

// The game's fire projectile looks (ProjectileLooks.Flight / Hit for ProjectileElement.Fire), rebuilt as GPU billboard pools.
// Tints may exceed 1 like the game's non-HDR materials: channels clip, so a texture's dense core goes white-yellow and its thin edges stay orange.

const FIRE = new THREE.Vector3(1, 0.32, 0.12);
const FIRE_HOT = new THREE.Vector3(2.6, 0.95, 0.25);
const FIRE_BODY = new THREE.Vector3(1, 0.55, 0.12);

const vertex = /* glsl */`
attribute vec3 iPos;
attribute float iSize;
attribute float iRot;
attribute vec4 iColor;
attribute float iFrame;
uniform vec2 tiles;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iRot), s = sin(iRot);
  vec2 p = position.xy;
  mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y) * iSize;
  gl_Position = projectionMatrix * mv;
  float f = floor(iFrame);
  float col = mod(f, tiles.x);
  float row = floor(f / tiles.x);
  vUv = (vec2(col, tiles.y - 1.0 - row) + uv) / tiles;
  vColor = iColor;
}`;

const fragment = /* glsl */`
uniform sampler2D map;
uniform vec3 tint;
uniform float additive;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv);
  vec3 rgb = min(t.rgb * tint * vColor.rgb, vec3(1.0));
  float a = t.a * vColor.a;
  if (additive > 0.5) gl_FragColor = vec4(rgb * a, 1.0);
  else gl_FragColor = vec4(rgb, a);
}`;

const rand = (a, b) => a + Math.random() * (b - a);

function randomInSphere(r, out) {
  do out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); while (out.lengthSq() > 1);
  return out.multiplyScalar(r);
}

/** Evaluates piecewise-linear [t0, v0, t1, v1, ...] keys at u in 0..1. */
function curve(keys, u) {
  if (!keys) return 1;
  if (u <= keys[0]) return keys[1];
  for (let i = 2; i < keys.length; i += 2)
    if (u <= keys[i]) return keys[i - 1] + (keys[i + 1] - keys[i - 1]) * (u - keys[i - 2]) / (keys[i] - keys[i - 2]);
  return keys[keys.length - 1];
}

class Pool {
  constructor(scene, texture, { tint, additive, tiles = [1, 1], max = 600, order = 0 }) {
    this.max = max;
    this.tiles = tiles[0] * tiles[1];
    this.items = [];
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.frame = new Float32Array(max);
    const attr = (name, array, n) => {
      const a = new THREE.InstancedBufferAttribute(array, n);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.attrs = [attr('iPos', this.pos, 3), attr('iSize', this.size, 1), attr('iRot', this.rot, 1), attr('iColor', this.color, 4), attr('iFrame', this.frame, 1)];
    g.instanceCount = 0;
    this.geometry = g;
    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        map: { value: texture },
        tint: { value: tint },
        additive: { value: additive ? 1 : 0 },
        tiles: { value: new THREE.Vector2(tiles[0], tiles[1]) },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    if (!additive) {
      material.blending = THREE.CustomBlending;
      material.blendSrc = THREE.SrcAlphaFactor;
      material.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10 + order;
    scene.add(this.mesh);
  }

  /**
   * Spawns one particle. Options mirror the game's Fx builder: life, size, speed (random direction unless `dir`), spin (deg/s),
   * grow (size keys), colors (random between two), fade (share of life spent fading out), gravity (x 9.81, negative rises), drag.
   */
  emit(at, o) {
    if (this.items.length >= this.max) return;
    const p = {
      pos: at.clone(),
      vel: new THREE.Vector3(),
      age: 0,
      life: rand(o.life[0], o.life[1]),
      size: rand(o.size[0], o.size[1]),
      rot: Math.random() * Math.PI * 2,
      spin: o.spin ? THREE.MathUtils.degToRad(rand(o.spin[0], o.spin[1])) : 0,
      grow: o.grow,
      fade: o.fade ?? 0.3,
      gravity: (o.gravity ?? 0) * 9.81,
      drag: o.drag ?? 0,
      color: new THREE.Color(),
      alpha: 1,
      flipbook: this.tiles > 1,
    };
    if (o.sphere) p.pos.add(randomInSphere(o.sphere, new THREE.Vector3()));
    if (o.speed) {
      const v = randomInSphere(1, new THREE.Vector3());
      if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
      p.vel.copy(v.normalize()).multiplyScalar(rand(o.speed[0], o.speed[1]));
    }
    if (o.vel) p.vel.add(o.vel);
    const [a, b] = o.colors ?? [[1, 1, 1, 1], [1, 1, 1, 1]];
    const k = Math.random();
    p.color.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    p.alpha = (a[3] ?? 1) + ((b[3] ?? 1) - (a[3] ?? 1)) * k;
    this.items.push(p);
  }

  update(dt) {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      const u = p.age / p.life;
      const fade = p.fade > 0 ? Math.min(1, (1 - u) / p.fade) : 1;
      this.pos[n * 3] = p.pos.x;
      this.pos[n * 3 + 1] = p.pos.y;
      this.pos[n * 3 + 2] = p.pos.z;
      this.size[n] = p.size * curve(p.grow, u);
      this.rot[n] = p.rot;
      this.color[n * 4] = p.color.r;
      this.color[n * 4 + 1] = p.color.g;
      this.color[n * 4 + 2] = p.color.b;
      this.color[n * 4 + 3] = p.alpha * fade;
      this.frame[n] = p.flipbook ? Math.min(this.tiles - 1, u * this.tiles) : 0;
      items[n++] = p;
    }
    items.length = n;
    this.geometry.instanceCount = n;
    for (const a of this.attrs) a.needsUpdate = true;
  }
}

export class FireFx {
  constructor(scene, textures) {
    // Order: flames (alpha-blended) under the additive glows and embers.
    this.flames = new Pool(scene, textures.fire, { tint: FIRE_BODY, additive: false, tiles: [4, 4], max: 700, order: 0 });
    this.glow = new Pool(scene, textures.hotglow, { tint: FIRE_HOT, additive: true, max: 120, order: 1 });
    this.embers = new Pool(scene, textures.bullet, { tint: FIRE_HOT, additive: true, max: 900, order: 2 });
    this.pools = [this.flames, this.glow, this.embers];
  }

  /** A held glow: one frame's core at the shot (the game's "Core", a white-hot fireball 0.66 wide). */
  core(at, size = 0.66, alpha = 1) {
    this.glow.emit(at, { life: [0.001, 0.001], size: [size, size], fade: 0, colors: [[1, 1, 1, alpha], [1, 1, 1, alpha]] });
  }

  /** What a fireball leaves per metre flown: licking flames (7 / m) and rising embers (3 / m). */
  trail(at, metres) {
    this.emitPerMetre(this.flames, at, 7 * metres, {
      sphere: 0.06, life: [0.22, 0.32], size: [0.3, 0.44], speed: [0.2, 0.6], spin: [-90, 90], grow: [0, 1, 1, 0.35],
      colors: [[1, 0.85, 0.5, 0.95], [1, 0.55, 0.3, 0.85]], fade: 0.4,
    });
    this.emitPerMetre(this.embers, at, 3 * metres, {
      sphere: 0.12, life: [0.3, 0.55], size: [0.035, 0.06], speed: [0.4, 1.4], gravity: -0.25,
      colors: [[1, 1, 1], [1, 0.6, 0.3]], fade: 0.5,
    });
  }

  emitPerMetre(pool, at, count, o) {
    let n = Math.floor(count);
    if (Math.random() < count - n) n++;
    for (let i = 0; i < n; i++) pool.emit(at, o);
  }

  /** The hit: a billowing orange fireball under a hot flash, and a fan of embers (k = 1.6 is the game's Explode). */
  burst(at, k = 1) {
    const n = c => Math.round(c * THREE.MathUtils.lerp(1, k, 0.6));
    this.glow.emit(at, { life: [0.2, 0.2], size: [2.2 * k, 2.2 * k], grow: [0, 0.6, 0.3, 1, 1, 0.8], fade: 0.2 });
    for (let i = 0; i < n(8); i++)
      this.flames.emit(at, {
        sphere: 0.18 * k, life: [0.45, 0.65], size: [0.8 * k, 1.2 * k], speed: [0.8 * k, 2.6 * k], drag: 4, spin: [-60, 60],
        grow: [0, 0.6, 0.4, 1, 1, 1.1], colors: [[1, 0.85, 0.5, 0.95], [1, 0.5, 0.25, 0.9]], fade: 0.5,
      });
    for (let i = 0; i < n(20); i++)
      this.embers.emit(at, {
        sphere: 0.12, life: [0.35, 0.75], size: [0.05, 0.08], speed: [4 * k, 9 * k], drag: 2, gravity: 0.7,
        colors: [[1, 1, 1], [1, 0.55, 0.25]], fade: 0.5,
      });
  }

  /** The fire in a hand: a small held glow and a few flames rising off it. */
  handFlame(at, dt) {
    this.core(at, 0.16, 0.9);
    this.emitPerMetre(this.flames, at, 22 * dt, {
      sphere: 0.03, life: [0.25, 0.4], size: [0.07, 0.12], vel: new THREE.Vector3(0, 0.35, 0), spin: [-90, 90], grow: [0, 1, 1, 0.3],
      colors: [[1, 0.85, 0.5, 0.9], [1, 0.55, 0.3, 0.8]], fade: 0.5,
    });
    this.emitPerMetre(this.embers, at, 6 * dt, {
      sphere: 0.04, life: [0.4, 0.7], size: [0.012, 0.02], speed: [0.05, 0.2], gravity: -0.05, colors: [[1, 1, 1], [1, 0.6, 0.3]], fade: 0.5,
    });
  }

  update(dt) { for (const p of this.pools) p.update(dt); }
}

export { FIRE };
