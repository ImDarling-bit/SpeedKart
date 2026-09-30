// Commandes : clavier (AZERTY et QWERTY), manette, écran tactile.

const KEYS = {
  up: ['ArrowUp', 'KeyW', 'KeyZ'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA', 'KeyQ'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyF', 'ControlLeft', 'ControlRight', 'Enter'],
  back: ['KeyC', 'KeyX'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { left: false, right: false, brake: false, drift: false, item: false };
    this.touchMode = false;
    this.prevItem = false;
    this.steerSmooth = 0;
    this.onKeyDown = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (Object.values(KEYS).some((l) => l.includes(e.code))) e.preventDefault();
      this.down.add(e.code);
    };
    this.onKeyUp = (e) => this.down.delete(e.code);
    this.onBlur = () => this.down.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  any(list) { return list.some((k) => this.down.has(k)); }

  // Boutons tactiles : éléments portant data-touch="left|right|brake|drift|item".
  bindTouch(root) {
    this.touchMode = true;
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const key = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    });
  }

  read(dt) {
    let steer = 0;
    let throttle = this.any(KEYS.up);
    let brake = this.any(KEYS.down);
    let drift = this.any(KEYS.drift);
    let item = this.any(KEYS.item);
    let back = this.any(KEYS.back);
    const keySteer = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);

    // Manette (disposition standard) : A accélère, B freine, RB/RT dérape, LB/LT objet, Y regarde derrière.
    let padSteer = 0;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4);
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.18) padSteer = (ax - Math.sign(ax) * 0.18) / 0.82;
      if (b(14)) padSteer = -1;
      if (b(15)) padSteer = 1;
      throttle = throttle || b(0);
      brake = brake || b(1) || b(2);
      drift = drift || b(5) || b(7);
      item = item || b(4) || b(6);
      back = back || b(3);
    }

    if (this.touchMode) {
      const t = this.touch;
      if (t.left || t.right) steer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
      throttle = throttle || !t.brake; // accélération automatique au tactile
      brake = brake || t.brake;
      drift = drift || t.drift;
      item = item || t.item;
    }

    // Le clavier tourne progressivement, la manette est analogique.
    if (keySteer) this.steerSmooth += (keySteer - this.steerSmooth) * Math.min(1, dt * 10);
    else this.steerSmooth += (0 - this.steerSmooth) * Math.min(1, dt * 14);
    steer = steer || padSteer || this.steerSmooth;
    if (Math.abs(steer) < 0.02) steer = 0;

    const itemPressed = item && !this.prevItem;
    this.prevItem = item;
    return { steer, throttle, brake, drift, itemPressed, back };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
