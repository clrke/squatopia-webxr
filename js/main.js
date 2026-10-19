import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { buildWorld, height } from './world.js';
import { FireFx } from './fx.js';
import { Sound, Music } from './audio.js';
import { Panel, Button, Selector, Popup, text } from './ui.js';

// Squatopia: Fireball Range. Stand on an alpine ledge and punch fireballs at target rings for 60 seconds.
// A Reach (a forward jab, the game's CrawlDetector rule) throws a fireball along the hand's own velocity, as fast as the
// hand moved; the head never aims. Menus use look and pinch. No locomotion.

const VERSION = window.GAME_VERSION ?? 'dev';
const ROUND = 60;
const HURRY = 10;
const SHOT_SCALE = 7;          // fireball speed = hand speed x this
const SHOT_MIN = 9, SHOT_MAX = 30;
const SHOT_LIFE = 3;
const REACH_ARM = 0.2, REACH_FIRE = 0.3, REACH_SPEED = 0.7;   // CrawlDetector: from < 20 cm to > 30 cm ahead at >= 0.7 m/s
const RELEASE_SLOWDOWN = 0.6;  // let go once the fist's forward speed drops under 60% of the stroke's peak
const RELEASE_EXTENSION = 0.55, RELEASE_AFTER = 0.18;   // or 55 cm ahead of the eyes, or 0.18 s into the stroke
const STROKE_WINDOW = 0.3;     // the stroke's start is the rearmost fist position in this many seconds
const VELOCITY_WINDOW = 0.05;

// ------------------------------------------------------------------ renderer and scene

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2500);
camera.position.set(0, 1.6, 0);
scene.add(camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const listener = new THREE.AudioListener();
camera.add(listener);
const sound = new Sound(listener.context, listener.getInput());
const music = new Music(listener.context, listener.getInput());

const texLoader = new THREE.TextureLoader();
const tex = name => texLoader.load(`assets/tex/${name}.png`);
const fx = new FireFx(scene, { fire: tex('fire'), hotglow: tex('hotglow'), bullet: tex('bullet') });

let world = null;
const selector = new Selector(scene, sound);
const popups = [];

// ------------------------------------------------------------------ hands

const handFactory = new XRHandModelFactory();
const controllerFactory = new XRControllerModelFactory();
const hands = [0, 1].map(i => {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  grip.add(controllerFactory.createControllerModel(grip));
  hand.add(handFactory.createHandModel(hand, 'mesh'));
  scene.add(controller, grip, hand);
  const state = { controller, grip, hand, source: null, history: [], armed: false, fist: new THREE.Vector3(), tracked: false };
  controller.addEventListener('connected', e => { state.source = e.data; state.history.length = 0; });
  controller.addEventListener('disconnected', () => { state.source = null; state.tracked = false; });
  return state;
});

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

/** The fist's world position this frame (knuckles of a tracked hand, or the controller grip). */
function fistOf(state) {
  if (!state.source) return false;
  if (state.source.hand) {
    const knuckle = state.hand.joints['middle-finger-phalanx-proximal'];
    const wrist = state.hand.joints['wrist'];
    if (!knuckle || !wrist || !knuckle.visible) return false;
    state.fist.copy(knuckle.position).lerp(wrist.position, 0.3);
    return true;
  }
  if (!state.grip.visible) return false;
  state.fist.copy(state.grip.position);
  return true;
}

function headPose(position, forward) {
  camera.getWorldPosition(position);
  camera.getWorldDirection(forward);
}

const head = new THREE.Vector3(), headFwd = new THREE.Vector3();

function updateHands(dt, now) {
  headPose(head, headFwd);
  const flat = tmp2.set(headFwd.x, 0, headFwd.z);
  if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
  flat.normalize();
  for (const s of hands) {
    s.tracked = fistOf(s);
    if (!s.tracked) { s.history.length = 0; s.stroke = null; continue; }
    const ahead = s.fist.clone().sub(head).dot(flat);
    // Hand tracking repeats a pose for a frame or two between camera updates: keep only new samples.
    const prev = s.history[s.history.length - 1];
    if (!prev || prev.p.distanceToSquared(s.fist) > 1e-8) s.history.push({ t: now, p: s.fist.clone(), ahead });
    while (s.history.length > 2 && now - s.history[0].t > STROKE_WINDOW) s.history.shift();
    fx.handFlame(s.fist, dt);
    const velocity = velocityOf(s, now);
    if (!velocity) continue;
    const forward = velocity.dot(flat);
    // The Reach: the fist goes from under 20 cm to over 30 cm ahead of the eyes, moving forward at 0.7 m/s or more...
    if (ahead < REACH_ARM) { s.armed = true; s.stroke = null; }
    if (s.armed && !s.stroke && ahead > REACH_FIRE && forward >= REACH_SPEED)
      s.stroke = { t: now, peak: forward, speed: velocity.length() };
    if (!s.stroke) continue;
    s.stroke.peak = Math.max(s.stroke.peak, forward);
    s.stroke.speed = Math.max(s.stroke.speed, velocity.length());
    // ...and lets go at full extension: once the fist slows, the arm is out, or the stroke has run long enough.
    if (forward < s.stroke.peak * RELEASE_SLOWDOWN || ahead > RELEASE_EXTENSION || now - s.stroke.t > RELEASE_AFTER) {
      reach(s, velocity);
      s.armed = false;
      s.stroke = null;
    }
  }
}

/** The fist's velocity over the last VELOCITY_WINDOW seconds of samples, or null without two samples. */
function velocityOf(s, now) {
  const h = s.history;
  if (h.length < 2) return null;
  const last = h[h.length - 1];
  let first = h[0];
  for (let i = h.length - 2; i >= 0; i--) { first = h[i]; if (last.t - h[i].t >= VELOCITY_WINDOW) break; }
  const span = last.t - first.t;
  if (span < 0.01) return null;
  return tmp.copy(last.p).sub(first.p).divideScalar(span);
}

/**
 * A Reach: the fireball leaves the fist along the punch's own path, from where the stroke began (the fist's rearmost point
 * in the last STROKE_WINDOW) to where it let go, which averages out the arm's arc and tracking noise; its speed is scaled
 * from the punch's top speed. The head never aims.
 */
function reach(s, velocity) {
  music.reach();
  let start = s.history[0];
  for (const h of s.history) if (h.ahead < start.ahead) start = h;
  const path = s.fist.clone().sub(start.p);
  const direction = path.length() > 0.08 ? path.normalize() : velocity.clone().normalize();
  const speed = THREE.MathUtils.clamp(s.stroke.speed * SHOT_SCALE, SHOT_MIN, SHOT_MAX);
  logReach(s, start, direction, velocity, speed);
  shoot(s.fist, direction.multiplyScalar(speed));
}

/** Records each Reach (window.reachLog, console) with its error against the target it came closest to, for tuning. */
function logReach(s, start, direction, velocity, speed) {
  let best = null;
  for (const t of targets) {
    if (t.dying) continue;
    const to = t.group.position.clone().sub(s.fist);
    const error = THREE.MathUtils.radToDeg(direction.angleTo(to));
    if (!best || error < best.error) {
      const right = new THREE.Vector3().crossVectors(to, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, to).normalize();
      best = { error, side: THREE.MathUtils.radToDeg(Math.asin(direction.dot(right))), up: THREE.MathUtils.radToDeg(Math.asin(direction.dot(up))), allowed: THREE.MathUtils.radToDeg(Math.atan(t.radius / to.length())) };
    }
  }
  const round = v => Math.round(v * 100) / 100;
  const entry = {
    hand: s.source?.handedness, input: s.source?.hand ? 'hand' : 'controller', speed: round(speed), samples: s.history.length,
    path: round(s.fist.distanceTo(start.p)), velocityVsPath: round(THREE.MathUtils.radToDeg(velocity.angleTo(direction))),
    target: best && { error: round(best.error), right: round(best.side), up: round(best.up), allowed: round(best.allowed) },
    raw: {
      t: s.history.map(h => Math.round(h.t * 1000)),
      p: s.history.map(h => [h.p.x, h.p.y, h.p.z].map(v => Math.round(v * 1000))),
      head: [head.x, head.y, head.z].map(v => Math.round(v * 1000)),
      fwd: [headFwd.x, headFwd.y, headFwd.z].map(v => Math.round(v * 1000) / 1000),
      targets: targets.filter(t => !t.dying).map(t => [t.group.position.x, t.group.position.y, t.group.position.z, t.radius].map(v => Math.round(v * 1000) / 1000)),
    },
  };
  (window.reachLog ??= []).push(entry);
  console.info('[reach]', JSON.stringify({ ...entry, raw: undefined }));
}

// ------------------------------------------------------------------ projectiles

const shots = [];

function shoot(from, velocity) {
  shots.push({ pos: from.clone(), vel: velocity.clone(), age: 0, hit: false });
  if (game.state === 'play') game.shots++;
  sound.play('shoot', { position: from, volume: 0.75 });
}

function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    if (i >= shots.length) continue;   // a hit's side effects may have removed shots
    const s = shots[i];
    const before = s.pos.clone();
    s.pos.addScaledVector(s.vel, dt);
    s.age += dt;
    fx.core(s.pos);
    fx.trail(s.pos, s.vel.length() * dt);
    const target = hitTarget(before, s.pos);
    if (!target && selector.strike(before, s.pos)) {
      // A fireball into a menu button presses it.
      fx.burst(s.pos, 0.8);
      sound.play('boom2', { position: s.pos, volume: 0.6 });
      shots.splice(i, 1);
      continue;
    }
    if (target) {
      shots.splice(i, 1);
      continue;
    }
    if (s.pos.y < height(s.pos.x, s.pos.z) || s.age > SHOT_LIFE) {
      if (s.age <= SHOT_LIFE) {
        fx.burst(s.pos, 0.7);
        sound.play('boom', { position: s.pos, volume: 0.5 });
      }
      miss();
      shots.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ targets

function bullseyeTexture(gold) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const ring = (r, color) => { ctx.beginPath(); ctx.arc(256, 256, r * 254, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); };
  if (gold) {
    ring(1, '#FFC93C'); ring(0.75, '#FFE38A'); ring(0.5, '#FF8F1F'); ring(0.2, '#FFFFFF'); ring(0.1, '#FF5A1F');
  } else {
    ring(1, '#F6EFE0'); ring(0.75, '#2196F2'); ring(0.7, '#F6EFE0'); ring(0.5, '#E8452C'); ring(0.2, '#FFC93C'); ring(0.07, '#FFFFFF');
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  for (const r of [0.5, 0.2]) { ctx.beginPath(); ctx.arc(256, 256, r * 254, 0, Math.PI * 2); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TARGET_FACE = [bullseyeTexture(false), bullseyeTexture(true)];
const RIM = new THREE.MeshLambertMaterial({ color: 0x5D4037 });
const targets = [];

function spawnTarget(elapsed) {
  const late = elapsed / ROUND;
  const gold = Math.random() < 0.12;
  const distance = THREE.MathUtils.lerp(6, 11, Math.random()) + late * 6 * Math.random();
  const yaw = THREE.MathUtils.degToRad((Math.random() * 2 - 1) * 62);
  const centre = new THREE.Vector3(Math.sin(yaw) * distance, 1.2 + Math.random() * 3.2, -Math.cos(yaw) * distance);
  // Keep clear of the other targets.
  for (const t of targets) if (t.home.distanceTo(centre) < 2.4) return false;
  const radius = (gold ? 0.42 : 0.62) + distance * 0.03;
  const group = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshBasicMaterial({ map: TARGET_FACE[gold ? 1 : 0], fog: false }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 8, 48), RIM);
  const back = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), RIM);
  back.rotation.y = Math.PI;
  back.position.z = -0.03;
  group.add(face, rim, back);
  group.position.copy(centre);
  group.scale.setScalar(0.01);
  scene.add(group);
  const motion = Math.random() < 0.25 + late * 0.6 ? (Math.random() < 0.6 ? 'sway' : 'bob') : 'still';
  targets.push({
    group, radius, gold, home: centre.clone(), age: 0, life: THREE.MathUtils.lerp(5.5, 3.8, late), motion,
    phase: Math.random() * Math.PI * 2, amp: 1 + Math.random() * 1.8, normal: new THREE.Vector3(), dying: 0,
  });
  return true;
}

function updateTargets(dt) {
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    t.age += dt;
    const g = t.group;
    if (t.dying > 0) {
      t.dying += dt;
      g.scale.setScalar(Math.max(0.001, 1 - t.dying / 0.25));
      if (t.dying > 0.25) { removeTarget(i); }
      continue;
    }
    const w = t.age * 1.6 + t.phase;
    g.position.copy(t.home);
    if (t.motion === 'sway') g.position.x += Math.sin(w) * t.amp;
    if (t.motion === 'bob') g.position.y += Math.sin(w) * t.amp * 0.5;
    g.lookAt(head);
    t.normal.set(0, 0, 1).applyQuaternion(g.quaternion);
    const pop = Math.min(1, t.age / 0.25);
    g.scale.setScalar(pop < 1 ? 1.15 * Math.sin(pop * Math.PI * 0.62) / Math.sin(Math.PI * 0.62) : 1);
    if (t.age > t.life) t.dying = 0.0001;
  }
}

function removeTarget(i) {
  const t = targets[i];
  scene.remove(t.group);
  t.group.traverse(o => o.geometry?.dispose());
  targets.splice(i, 1);
}

/** Segment a-b against every live target's disc; scores and bursts the first one struck. */
function hitTarget(a, b) {
  const seg = tmp.copy(b).sub(a);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.dying > 0 || t.age < 0.1) continue;
    const c = t.group.position;
    const denom = seg.dot(t.normal);
    if (Math.abs(denom) < 1e-6) continue;
    const k = tmp2.copy(c).sub(a).dot(t.normal) / denom;
    if (k < 0 || k > 1) continue;
    const point = a.clone().addScaledVector(seg, k);
    const r = point.distanceTo(c) / t.radius;
    if (r > 1.04) continue;
    struck(t, point, r);
    t.dying = 0.0001;
    return t;
  }
  return null;
}

// ------------------------------------------------------------------ the round

const game = { state: 'loading', score: 0, streak: 0, bestStreak: 0, hits: 0, shots: 0, elapsed: 0, countdown: 0, spawnIn: 0, lastBeep: 0, best: 0 };
try { game.best = Number(localStorage.getItem('fireballRange.best')) || 0; } catch { /* no storage */ }

const multiplier = () => (game.streak >= 10 ? 4 : game.streak >= 6 ? 3 : game.streak >= 3 ? 2 : 1);

function struck(t, point, r) {
  const ring = r < 0.2 ? 0 : r < 0.5 ? 1 : 2;
  const base = [100, 50, 25][ring] * (t.gold ? 2 : 1);
  game.streak++;
  game.bestStreak = Math.max(game.bestStreak, game.streak);
  game.hits++;
  const points = base * multiplier();
  game.score += points;
  fx.burst(point, 1.6);
  sound.play('boom2', { position: point, volume: 0.8 });
  sound.play('hit' + Math.min(5, (2 - ring) + Math.floor(game.streak / 4)), { position: point, volume: 0.9 });
  if (ring === 0) sound.play('bull', { position: point, volume: 0.7 });
  popups.push(new Popup(scene, `+${points}`, ring === 0 ? '#FFD54F' : ring === 1 ? '#FF8A50' : '#FFFFFF', point.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.35 + (ring === 0 ? 0.15 : 0)));
  hud.refresh();
}

function miss() {
  if (game.state !== 'play') return;
  if (game.streak) { game.streak = 0; hud.refresh(); }
}

function startCountdown() {
  for (let i = targets.length - 1; i >= 0; i--) removeTarget(i);
  Object.assign(game, { state: 'countdown', score: 0, streak: 0, bestStreak: 0, hits: 0, shots: 0, elapsed: 0, countdown: 3, spawnIn: 0.4, lastBeep: 4 });
  menu.visible = false;
  results.visible = false;
  hud.visible = true;
  hud.refresh();
}

function endRound() {
  game.state = 'results';
  music.endRound();
  sound.play('fanfare', { volume: 0.7 });
  const newBest = game.score > game.best;
  if (newBest) {
    game.best = game.score;
    try { localStorage.setItem('fireballRange.best', String(game.best)); } catch { /* no storage */ }
  }
  game.newBest = newBest;
  for (const t of targets) t.dying = t.dying || 0.0001;
  hud.visible = false;
  results.refresh();
  results.visible = true;
}

function updateGame(dt) {
  if (game.state === 'countdown') {
    game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    if (n < game.lastBeep && n > 0) { game.lastBeep = n; sound.play('count', { volume: 0.7 }); hud.refresh(); }
    if (game.countdown <= 0) {
      game.state = 'play';
      game.lastBeep = HURRY + 1;
      sound.play('go', { volume: 0.8 });
      music.beginRound();
      hud.refresh();
    }
    return;
  }
  if (game.state !== 'play') return;
  game.elapsed += dt;
  const left = ROUND - game.elapsed;
  const shown = Math.ceil(left);
  if (shown !== game.shownTime) { game.shownTime = shown; hud.refresh(); }
  // The last 10 seconds: a beep on every second, higher for the last three, and the music speeds up.
  if (left <= HURRY && shown < game.lastBeep && shown > 0) {
    game.lastBeep = shown;
    if (shown === HURRY) music.hurry(true);
    sound.play('count', { volume: 0.75, pitch: shown <= 3 ? 1.5 : 1.2 });
  }
  if (left <= 0) { endRound(); return; }
  game.spawnIn -= dt;
  const late = game.elapsed / ROUND;
  if (game.spawnIn <= 0 && targets.filter(t => !t.dying).length < 3 + Math.round(late * 2)) {
    if (spawnTarget(game.elapsed)) game.spawnIn = THREE.MathUtils.lerp(1.1, 0.6, late);
  }
}

// ------------------------------------------------------------------ panels

function placePanel(panel, y, z) {
  panel.group.position.set(0, y, z);
  panel.group.lookAt(0, y, 0);
  scene.add(panel.group);
}

const menu = new Panel(1.6, 1.1, (ctx, w) => {
  text(ctx, 'SQUATOPIA', w / 2, 70, 44, { color: '#8FD3FF' });
  text(ctx, 'Fireball Range', w / 2, 140, 82);
  text(ctx, 'Punch to throw fire. Hit the bullseye.', w / 2, 225, 34, { font: 'Nunito', weight: 700, color: '#d9e6f2' });
  text(ctx, game.best ? `Best: ${game.best}` : '60 seconds', w / 2, 278, 30, { font: 'Nunito', weight: 700, color: '#9fb3c8' });
  text(ctx, `v${VERSION}`, w - 40, 410, 24, { font: 'Nunito', weight: 700, color: '#6f849a', align: 'right' });
});
menu.addButton(new Button('Start', 0.62, 0.2, startCountdown), 0, -0.3);
placePanel(menu, 1.45, -2.2);
selector.panels.push(menu);

const results = new Panel(1.6, 1.15, (ctx, w) => {
  text(ctx, game.newBest ? 'New best!' : 'Time!', w / 2, 70, 56, { color: game.newBest ? '#FFD54F' : '#ffffff' });
  text(ctx, String(game.score), w / 2, 160, 110);
  const accuracy = game.shots ? Math.round(100 * game.hits / game.shots) : 0;
  text(ctx, `${game.hits} hits  ·  ${accuracy}% accuracy  ·  best streak ${game.bestStreak}`, w / 2, 245, 30, { font: 'Nunito', weight: 700, color: '#d9e6f2' });
  text(ctx, `Best: ${game.best}`, w / 2, 295, 30, { font: 'Nunito', weight: 700, color: '#9fb3c8' });
});
results.addButton(new Button('Play again', 0.7, 0.2, startCountdown), 0, -0.34);
placePanel(results, 1.45, -2.2);
results.visible = false;
selector.panels.push(results);

const hud = new Panel(3.4, 0.6, (ctx, w, h) => {
  if (game.state === 'countdown') {
    text(ctx, String(Math.max(1, Math.ceil(game.countdown))), w / 2, h / 2, 120);
    return;
  }
  const left = Math.max(0, Math.ceil(ROUND - game.elapsed));
  text(ctx, String(game.score), 40, h / 2, 96, { align: 'left' });
  text(ctx, `0:${String(left).padStart(2, '0')}`, w / 2, h / 2, 96, { color: left <= HURRY ? '#FF7043' : '#ffffff' });
  const m = multiplier();
  if (m > 1) text(ctx, `x${m}`, w - 40, h / 2, 96, { align: 'right', color: '#FFD54F' });
}, { background: false });
hud.mesh.material.depthTest = false;
placePanel(hud, 3.3, -5.5);
hud.group.rotation.x = 0.25;
hud.visible = false;

// ------------------------------------------------------------------ flat-screen play (mouse aims and throws; drag looks)

const mouse = new THREE.Vector2();
const mouseRay = new THREE.Raycaster();
let drag = null, yaw = 0, pitch = 0.08;
const canvas = renderer.domElement;
canvas.addEventListener('pointermove', e => {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      yaw = drag.yaw - dx * 0.004;
      pitch = THREE.MathUtils.clamp(drag.pitch - dy * 0.004, -0.6, 0.8);
    }
  }
});
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false }; });
canvas.addEventListener('pointerup', () => {
  const moved = drag?.moved;
  drag = null;
  if (moved || renderer.xr.isPresenting) return;
  mouseRay.setFromCamera(mouse, camera);
  if (selector.select(mouseRay.ray.origin, mouseRay.ray.direction)) return;
  const from = camera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.25, -0.35, 0).applyQuaternion(camera.quaternion));
  const aim = mouseRay.ray.at(12, new THREE.Vector3());
  music.reach();
  shoot(from, aim.sub(from).normalize().multiplyScalar(18));
});

// ------------------------------------------------------------------ menu selection

const rays = [0, 1].map(() => ({ origin: new THREE.Vector3(), direction: new THREE.Vector3(), laser: true }));
const headRay = { origin: head, direction: headFwd, laser: false };
const mouseHover = { origin: new THREE.Vector3(), direction: new THREE.Vector3(), laser: false };

/** The rays that hover buttons this frame: each hand's pointing ray in VR (the head's when no hand points), the mouse on a screen. */
function hoverRays() {
  if (!renderer.xr.isPresenting) {
    mouseRay.setFromCamera(mouse, camera);
    mouseHover.origin.copy(mouseRay.ray.origin);
    mouseHover.direction.copy(mouseRay.ray.direction);
    return [mouseHover];
  }
  const list = [];
  hands.forEach((s, i) => {
    if (s.source?.targetRayMode !== 'tracked-pointer' || !s.controller.visible) return;
    s.controller.getWorldPosition(rays[i].origin);
    rays[i].direction.set(0, 0, -1).transformDirection(s.controller.matrixWorld);
    list.push(rays[i]);
  });
  return list.length ? list : [headRay];
}

/** A pinch (or trigger) in VR: its own ray at that instant picks the button, the eye gaze when the Browser gives one. */
function onXRSelect(e) {
  const pose = e.frame?.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  const { position: p, orientation: q } = pose.transform;
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  selector.select(origin, direction);
}

// ------------------------------------------------------------------ loop

const clock = new THREE.Clock();
let loopErrors = 0;
let time = 0;

renderer.setAnimationLoop(() => {
  // One bad frame must never freeze the headset: log it and keep rendering.
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    if (!renderer.xr.isPresenting) {
      camera.position.set(0, 1.6, 0);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
    updateHands(dt, time);
    updateGame(dt);
    updateTargets(dt);
    updateShots(dt);
    world?.update(dt, time);
    for (let i = popups.length - 1; i >= 0; i--) if (!popups[i].update(dt, head)) popups.splice(i, 1);
    selector.update(dt, hoverRays());
    fx.update(dt);
  } catch (e) {
    if (!loopErrors++) console.error(e);
  }
  renderer.render(scene, camera);
});

// ------------------------------------------------------------------ boot

const overlay = document.getElementById('overlay');
const status = document.getElementById('status');
const vrButton = document.getElementById('enter-vr');
const flatButton = document.getElementById('play-flat');

async function boot() {
  await Promise.all([document.fonts.load('600 64px Fredoka'), document.fonts.load('700 32px Nunito')]).catch(() => {});
  menu.refresh();
  for (const b of [...menu.buttons, ...results.buttons]) b.draw();
  world = await buildWorld(scene, p => { status.textContent = `Loading the Alpine… ${Math.round(p * 100)}%`; });
  game.state = 'menu';
  status.textContent = '';
  const vr = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  vrButton.hidden = !vr;
  flatButton.hidden = false;
  if (!vr) status.textContent = 'No VR headset found: play with the mouse (click to throw, drag to look).';
}

function wake() {
  listener.context.resume();
  music.start();
}

vrButton.addEventListener('click', async () => {
  wake();
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
  await renderer.xr.setSession(session);
  session.addEventListener('select', onXRSelect);
  overlay.hidden = true;
  session.addEventListener('end', () => { overlay.hidden = false; });
});

flatButton.addEventListener('click', () => {
  wake();
  overlay.hidden = true;
});

// For capture tooling (store shots, the link preview): where each live target is on screen.
window.fireballRange = {
  get state() { return game.state; },
  targetsOnScreen: () => targets.filter(t => !t.dying && t.age > 0.3).map(t => {
    const p = t.group.position.clone().project(camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, distance: t.group.position.distanceTo(head), gold: t.gold };
  }),
};

boot().catch(e => { status.textContent = 'Failed to load: ' + e.message; console.error(e); });
