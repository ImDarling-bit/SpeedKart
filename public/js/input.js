// Commandes : clavier (AZERTY et QWERTY, par position physique), manette, écran tactile.
// Deux schémas : 'race' (karts) et 'car' (arènes : saut, turbo, figures).

const RACE_KEYS = {
  up: ['ArrowUp', 'KeyW', 'KeyZ'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA', 'KeyQ'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyF', 'ControlLeft', 'ControlRight', 'Enter'],
  back: ['KeyC', 'KeyX'],
};
const CAR_KEYS = {
  up: ['ArrowUp', 'KeyW', 'KeyZ'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA', 'KeyQ'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  slide: ['KeyX', 'AltLeft', 'ControlLeft'],
  item: ['KeyE', 'KeyF', 'Enter'],
  cam: ['KeyC'],
};
const COMMON = {
  power: ['KeyR', 'KeyV'],
  horn: ['KeyH', 'KeyK'],
};
export const EMOTE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];

export class Input {
  constructor(scheme = 'race') {
    this.scheme = scheme;
    this.keys = scheme === 'car' ? CAR_KEYS : RACE_KEYS;
    this.down = new Set();
    this.touch = { left: false, right: false, brake: false, drift: false, item: false, jump: false, boost: false, power: false };
    this.touchMode = false;
    this.prev = {};
    this.steerSmooth = 0;
    const all = [...Object.values(this.keys), ...Object.values(COMMON), EMOTE_KEYS].flat();
    this.onKeyDown = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (all.includes(e.code)) e.preventDefault();
      this.down.add(e.code);
    };
    this.onKeyUp = (e) => this.down.delete(e.code);
    this.onBlur = () => this.down.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  any(list) { return list.some((k) => this.down.has(k)); }

  // Boutons tactiles : éléments portant data-touch="left|right|brake|drift|item|jump|boost|power".
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

  // Front montant d'une commande (appui, pas maintien).
  edge(name, value) {
    const was = this.prev[name];
    this.prev[name] = value;
    return value && !was;
  }

  pads() {
    const out = [];
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp) out.push(gp);
    return out;
  }

  read(dt) {
    const K = this.keys;
    const car = this.scheme === 'car';
    let throttleAxis = (this.any(K.up) ? 1 : 0) - (this.any(K.down) ? 1 : 0);
    let pitch = throttleAxis;
    const keySteer = (this.any(K.right) ? 1 : 0) - (this.any(K.left) ? 1 : 0);
    let drift = !car && this.any(K.drift);
    let item = this.any(K.item);
    let back = !car && this.any(K.back);
    let jump = car && this.any(K.jump);
    let boost = car && this.any(K.boost);
    let slide = car && this.any(K.slide);
    let cam = car && this.any(K.cam);
    let power = this.any(COMMON.power);
    let horn = this.any(COMMON.horn);
    let emote = EMOTE_KEYS.findIndex((k) => this.down.has(k));

    // Manette (disposition standard).
    let padSteer = 0;
    for (const gp of this.pads()) {
      const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4);
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      if (Math.abs(ax) > 0.18) padSteer = (ax - Math.sign(ax) * 0.18) / 0.82;
      if (b(14)) padSteer = -1;
      if (b(15)) padSteer = 1;
      if (car) {
        // A saute, B turbo, X glisse / vrille, Y caméra ballon, RT/LT avance/recule, LB objet.
        const t = val(7) - val(6);
        if (Math.abs(t) > 0.1) throttleAxis = t;
        if (Math.abs(ay) > 0.2) pitch = -ay;
        jump = jump || b(0);
        boost = boost || b(1) || b(5);
        slide = slide || b(2);
        cam = cam || b(3);
        item = item || b(4);
      } else {
        // A accélère, B freine, RB/RT dérape, LB/LT objet, Y regarde derrière.
        if (b(0)) throttleAxis = Math.max(throttleAxis, 1);
        if (b(1) || b(2)) throttleAxis = Math.min(throttleAxis, -1);
        drift = drift || b(5) || b(7);
        item = item || b(4) || b(6);
        back = back || b(3);
      }
      power = power || b(12);
      horn = horn || b(10);
      if (b(13) && emote < 0) emote = 2;
    }

    if (this.touchMode) {
      const t = this.touch;
      if (t.left || t.right) padSteer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
      if (!t.brake) throttleAxis = Math.max(throttleAxis, 1); // accélération automatique au tactile
      else throttleAxis = -1;
      drift = drift || t.drift;
      item = item || t.item;
      jump = jump || t.jump;
      boost = boost || t.boost;
      power = power || t.power;
    }

    // Le clavier tourne progressivement, la manette est analogique.
    if (keySteer) this.steerSmooth += (keySteer - this.steerSmooth) * Math.min(1, dt * 10);
    else this.steerSmooth += (0 - this.steerSmooth) * Math.min(1, dt * 14);
    let steer = padSteer || this.steerSmooth;
    if (Math.abs(steer) < 0.02) steer = 0;
    const emotePressed = emote >= 0 && emote !== this.lastEmote ? emote : -1;
    this.lastEmote = emote;

    return {
      steer,
      throttle: car ? throttleAxis : throttleAxis > 0,
      brake: throttleAxis < 0,
      pitch,
      drift,
      jump,
      boost,
      slide,
      back,
      itemPressed: this.edge('item', item),
      powerPressed: this.edge('power', power),
      hornPressed: this.edge('horn', horn),
      camPressed: this.edge('cam', cam),
      emote: emotePressed,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
