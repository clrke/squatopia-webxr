import * as THREE from 'three';

// World-space panels in the game's UiKit style (black 0.9 panels, blue round buttons, Fredoka titles, Nunito body),
// selected with look and pinch: the pinch's own ray picks the button (see Selector).

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
    this.mesh.userData.button = this;
    this.mesh.position.z = 0.01;
    this.draw();
  }

  /** Hover only lightens the button (Meta's gaze guidance: subtle colour, no outline, the target never moves). */
  draw() {
    const { ctx, canvas } = this, w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
    ctx.fillStyle = this.hover ? BLUE_HOVER : BLUE;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(h * 0.46)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, w / 2, h / 2 + 2);
    this.texture.needsUpdate = true;
  }

  setHover(hover) {
    if (hover === this.hover) return;
    this.hover = hover;
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
 * Look and pinch. A selection uses the ray of the pinch itself: on a headset with eye tracking the Browser reports the pinch
 * as a transient-pointer whose ray is the eye gaze at that moment (eye position is never streamed to the page); without it
 * the ray is the hand's (or controller's) pointing ray, as Meta's guidance falls back to. Hover follows the hand rays
 * (with a short laser and a dot) and the mouse; the system draws its own hover for eye gaze.
 */
export class Selector {
  constructor(scene, sound) {
    this.sound = sound;
    this.ray = new THREE.Raycaster();
    this.panels = [];
    this.hovered = null;
    this.cooldown = 0;
    this.pointers = [0, 1].map(() => {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, fog: false }));
      dot.renderOrder = 30;
      const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, fog: false }));
      laser.renderOrder = 29;
      scene.add(dot, laser);
      return { dot, laser };
    });
  }

  get open() { return this.panels.some(p => p.visible); }

  buttons() {
    const list = [];
    for (const p of this.panels) if (p.visible) for (const b of p.buttons) list.push(b.mesh);
    return list;
  }

  cast(origin, direction) {
    const meshes = this.buttons();
    if (!meshes.length) return null;
    this.ray.set(origin, direction);
    return this.ray.intersectObjects(meshes, false)[0] ?? null;
  }

  /** rays: [{origin, direction, laser}] to hover with this frame (hand rays in VR, the mouse on a flat screen). */
  update(dt, rays) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let button = null;
    this.pointers.forEach((p, i) => {
      const r = this.open ? rays[i] : null;
      p.dot.visible = p.laser.visible = !!r?.laser;
      if (!r) return;
      const hit = this.cast(r.origin, r.direction);
      if (hit && !button) button = hit.object.userData.button;
      if (!r.laser) return;
      const distance = hit ? hit.distance : 1.2;
      p.laser.position.copy(r.origin);
      p.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), r.direction);
      p.laser.scale.setScalar(Math.min(distance, 1.2) * (hit ? 0.98 : 1));
      p.dot.visible = !!hit;
      if (hit) {
        p.dot.position.copy(hit.point).addScaledVector(r.direction, -0.005);
        p.dot.quaternion.copy(hit.object.getWorldQuaternion(new THREE.Quaternion()));
      }
    });
    if (button !== this.hovered) {
      this.hovered?.setHover(false);
      this.hovered = button;
      if (button) { button.setHover(true); this.sound.play('tick', { volume: 0.4 }); }
    }
  }

  /** A fireball flying from a to b this frame: presses the first button it passes through. True when it did. */
  strike(a, b) {
    if (this.cooldown > 0 || !this.open) return false;
    const segment = b.clone().sub(a);
    const length = segment.length();
    if (length < 1e-6) return false;
    this.ray.set(a, segment.divideScalar(length));
    this.ray.far = length;
    const hit = this.ray.intersectObjects(this.buttons(), false)[0];
    this.ray.far = Infinity;
    if (!hit) return false;
    this.press(hit.object.userData.button);
    return true;
  }

  press(button) {
    this.hovered?.setHover(false);
    this.hovered = null;
    this.cooldown = 0.4;
    this.sound.play('select', { volume: 0.8 });
    button.onClick();
  }

  /** A pinch, trigger or click along this ray: selects the button it lands on. True when it did. */
  select(origin, direction) {
    if (this.cooldown > 0) return false;
    const hit = this.cast(origin, direction);
    if (!hit) return false;
    this.press(hit.object.userData.button);
    return true;
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
