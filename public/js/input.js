// Commandes : clavier (touches personnalisables, par position physique : ZQSD = WASD),
// manette, écran tactile (joystick virtuel + boutons). Deux schémas : 'race' (karts) et
// 'car' (arènes et police : saut, turbo, figures, gadgets).

import { keysFor, getSettings } from './settings.js';

export const EMOTE_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
const RACE_ACTIONS = ['up', 'down', 'left', 'right', 'drift', 'item', 'back'];
const CAR_ACTIONS = ['up', 'down', 'left', 'right', 'jump', 'boost', 'slide', 'item', 'g3', 'cam'];

export class Input {
  constructor(scheme = 'race') {
    this.scheme = scheme;
    this.down = new Set();
    this.touch = { left: false, right: false, brake: false, drift: false, item: false, jump: false, boost: false, power: false, g3: false };
    this.stick = { x: 0, y: 0, active: false };
    this.touchMode = false;
    this.paused = false;
    this.prev = {};
    this.steerSmooth = 0;
    this.refreshKeys();
    this.onKeyDown = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (this.allKeys.has(e.code)) e.preventDefault();
      this.down.add(e.code);
    };
    this.onKeyUp = (e) => this.down.delete(e.code);
    this.onBlur = () => this.down.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  // Relit les touches (après un changement dans les paramètres).
  refreshKeys() {
    const actions = this.scheme === 'car' ? CAR_ACTIONS : RACE_ACTIONS;
    this.keys = {};
    for (const a of actions) this.keys[a] = keysFor(this.scheme, a);
    this.keys.power = keysFor('common', 'power');
    this.keys.horn = keysFor('common', 'horn');
    this.allKeys = new Set([...Object.values(this.keys).flat(), ...EMOTE_KEYS]);
  }

  any(list) { return !!list && list.some((k) => this.down.has(k)); }

  // Commandes tactiles : boutons [data-touch] et joystick [data-stick].
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
    const pad = root.querySelector('[data-stick]');
    if (pad) {
      const knob = pad.querySelector('i');
      let id = null;
      const move = (e) => {
        const r = pad.getBoundingClientRect();
        const R = r.width / 2;
        let dx = (e.clientX - (r.left + R)) / R;
        let dy = (e.clientY - (r.top + R)) / R;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.stick.x = dx;
        this.stick.y = dy;
        if (knob) knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
      };
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; pad.setPointerCapture(id); this.stick.active = true; move(e); });
      pad.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this.stick = { x: 0, y: 0, active: false };
        if (knob) knob.style.transform = '';
      };
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
    }
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

  // Bouton Start / Menu de la manette (pour le menu pause).
  pausePressed() {
    let p = false;
    for (const gp of this.pads()) if (gp.buttons[9] && gp.buttons[9].pressed) p = true;
    return this.edge('pause', p);
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
    let g3 = car && this.any(K.g3);
    let power = this.any(K.power);
    let horn = this.any(K.horn);
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
        // A saute, B turbo, X glisse / vrille, Y caméra ballon (ou gadget 3), RT/LT avance/recule, LB objet.
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
      if (this.stick.active) {
        padSteer = Math.abs(this.stick.x) > 0.12 ? this.stick.x : 0;
        if (this.stick.y > 0.55) throttleAxis = -1;
        else throttleAxis = Math.max(throttleAxis, 1);
        if (car) pitch = -this.stick.y;
      } else {
        if (t.left || t.right) padSteer = (t.right ? 1 : 0) - (t.left ? 1 : 0);
        if (!t.brake) throttleAxis = Math.max(throttleAxis, 1); // accélération automatique au tactile
      }
      if (t.brake) throttleAxis = -1;
      drift = drift || t.drift;
      item = item || t.item;
      jump = jump || t.jump;
      boost = boost || t.boost;
      power = power || t.power;
      g3 = g3 || t.g3;
    }

    // Le clavier tourne progressivement, la manette est analogique.
    if (keySteer) this.steerSmooth += (keySteer - this.steerSmooth) * Math.min(1, dt * 10);
    else this.steerSmooth += (0 - this.steerSmooth) * Math.min(1, dt * 14);
    let steer = padSteer || this.steerSmooth;
    if (Math.abs(steer) < 0.02) steer = 0;
    const emotePressed = emote >= 0 && emote !== this.lastEmote ? emote : -1;
    this.lastEmote = emote;

    const out = {
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
      g3Pressed: this.edge('g3', g3),
      emote: emotePressed,
    };
    // Menu pause ouvert : la partie continue mais on ne pilote plus.
    if (this.paused) {
      return { steer: 0, throttle: car ? 0 : false, brake: false, pitch: 0, drift: false, jump: false, boost: false, slide: false, back: false, itemPressed: false, powerPressed: false, hornPressed: false, camPressed: false, g3Pressed: false, emote: -1 };
    }
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

export const touchLayout = () => getSettings().touch;
