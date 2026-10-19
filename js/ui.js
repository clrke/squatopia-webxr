import * as THREE from 'three';

// World-space panels in the game's UiKit style (black 0.9 panels, blue round buttons, Fredoka titles, Nunito body),
// selected by head gaze: look at a button and hold for DWELL seconds (a pinch or trigger while looking selects at once).

export const DWELL = 1.0;
const PX = 400;   // canvas pixels per metre
const BLUE = '#2196F2', BLUE_HOVER = '#4FB0FF', OUTLINE = '#0099FF';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

class CanvasPlane {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * PX);
    this.canvas.height = Math.round(height * PX);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.mesh.renderOrder = 20;
  }
}

export class Button extends CanvasPlane {
  constructor(label, width, height, onClick) {
    super(width, height);
    this.label = label;
    this.onClick = onClick;
    this.hover = false;
    this.progress = 0;
    this.mesh.userData.button = this;
    this.mesh.position.z = 0.01;
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this, w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
    ctx.fillStyle = this.hover ? BLUE_HOVER : BLUE;
    ctx.fill();
    if (this.progress > 0) {
      // The dwell: a white fill growing across the button.
      ctx.save();
      roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(4, 4, (w - 8) * this.progress, h - 8);
      ctx.restore();
    }
    if (this.hover) {
      roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(h * 0.46)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, w / 2, h / 2 + 2);
    this.texture.needsUpdate = true;
  }

  set(hover, progress) {
    if (hover === this.hover && Math.abs(progress - this.progress) < 0.02 && (progress === 0) === (this.progress === 0)) return;
    this.hover = hover;
    this.progress = progress;
    this.draw();
  }
}

/** A panel whose content is drawn by `paint(ctx, w, h)`; `refresh()` redraws it. */
export class Panel extends CanvasPlane {
  constructor(width, height, paint, { background = true } = {}) {
    super(width, height);
    this.paint = paint;
    this.background = background;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.buttons = [];
    this.refresh();
  }

  addButton(button, x, y) {
    button.mesh.position.set(x, y, 0.01);
    this.group.add(button.mesh);
    this.buttons.push(button);
    return button;
  }

  refresh() {
    const { ctx, canvas } = this, w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this.background) {
      roundRect(ctx, 6, 6, w - 12, h - 12, 48);
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
    }
    this.paint(ctx, w, h);
    this.texture.needsUpdate = true;
  }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }
}

export function text(ctx, s, x, y, size, { weight = 600, font = 'Fredoka', color = '#ffffff', align = 'center' } = {}) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/**
 * Head gaze: a ray from the eyes along the head's forward; the button it rests on fills over DWELL seconds and fires.
 * A reticle dot sits where the gaze lands while any panel is open.
 */
export class Gaze {
  constructor(scene, sound) {
    this.sound = sound;
    this.ray = new THREE.Raycaster();
    this.panels = [];
    this.current = null;
    this.time = 0;
    this.cooldown = 0;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.008, 0.013, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false }));
    ring.renderOrder = 30;
    this.reticle = ring;
    scene.add(ring);
  }

  buttons() {
    const list = [];
    for (const p of this.panels) if (p.visible) for (const b of p.buttons) list.push(b.mesh);
    return list;
  }

  /** origin/direction: the head's (or, on a flat screen, the mouse's) ray. */
  update(dt, origin, direction) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const meshes = this.buttons();
    this.reticle.visible = meshes.length > 0;
    if (!meshes.length) { this.leave(); return; }
    this.ray.set(origin, direction);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    const distance = hit ? hit.distance : 2;
    this.reticle.position.copy(origin).addScaledVector(direction, distance - 0.02);
    this.reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().negate());
    this.reticle.scale.setScalar(distance / 1.5);
    const button = hit?.object.userData.button ?? null;
    if (button !== this.current) {
      this.leave();
      this.current = button;
      this.time = 0;
      if (button) this.sound.play('tick', { volume: 0.5 });
    }
    if (!button) return;
    if (this.cooldown > 0) { button.set(true, 0); return; }
    this.time += dt;
    button.set(true, Math.min(1, this.time / DWELL));
    if (this.time >= DWELL) this.select();
  }

  /** A pinch or trigger: selects the gazed button at once. True when it did. */
  select() {
    const button = this.current;
    if (!button || this.cooldown > 0) return false;
    this.leave();
    this.cooldown = 0.6;
    this.sound.play('select', { volume: 0.8 });
    button.onClick();
    return true;
  }

  leave() {
    if (this.current) this.current.set(false, 0);
    this.current = null;
    this.time = 0;
  }
}

/** A floating "+100" that rises and fades, facing the player. */
export class Popup {
  constructor(scene, label, color, at, size = 0.5) {
    this.plane = new CanvasPlane(size * 2.4, size);
    const { ctx, canvas } = this.plane;
    ctx.lineWidth = canvas.height * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.font = `700 ${Math.round(canvas.height * 0.72)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(label, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    this.plane.texture.needsUpdate = true;
    this.plane.mesh.material.depthTest = false;
    this.plane.mesh.position.copy(at);
    this.age = 0;
    this.scene = scene;
    scene.add(this.plane.mesh);
  }

  update(dt, head) {
    this.age += dt;
    const m = this.plane.mesh;
    m.position.y += dt * 0.9;
    m.lookAt(head);
    m.material.opacity = Math.min(1, (1.1 - this.age) / 0.4);
    if (this.age > 1.1) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      this.plane.texture.dispose();
      return false;
    }
    return true;
  }
}
