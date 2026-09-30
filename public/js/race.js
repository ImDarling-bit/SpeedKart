// Une course, côté joueur : on pilote son kart en local, on affiche les autres à partir
// des instantanés de l'hôte (avec un léger retard pour lisser), et on signale à l'hôte
// les boîtes ramassées, les objets utilisés, les coups reçus et l'arrivée.

import * as THREE from './three.js';
import { TrackPath } from './track.js';
import { trackById } from './data/tracks.js';
import { themeFor } from './data/themes.js';
import { vehicleById, vehicleParams, CC_CLASSES } from './data/vehicles.js';
import { Kart, F, KART_RADIUS } from './kart.js';
import { BotBrain } from './ai.js';
import { ITEMS, HIT_RADIUS } from './items.js';
import { buildWorld } from './world.js';
import { KartView } from './kartview.js';
import { Particles, entityMesh } from './fx.js';
import { Input } from './input.js';
import { sfx, engineStart, engineUpdate, engineStop } from './audio.js';
import { formatTime, makeRng, lerpAngle, clamp } from './util.js';

const STEP = 1 / 60;
const INTERP = 110; // ms de retard d'affichage des autres karts
const SEND_EVERY = 50; // ms entre deux envois de position
const ROULETTE = 1500;
const ORDINAL = (n) => (n === 1 ? 'er' : 'e');
const KART_COLORS = ['#ff4d4d', '#4da6ff', '#4dff88', '#ffd24d', '#c44dff', '#ff9a4d', '#4dfff0', '#ff4dc4'];

const $ = (id) => document.getElementById(id);

export class Race {
  constructor({ renderer, socket, state, onQuit }) {
    this.renderer = renderer;
    this.socket = socket;
    this.me = state.you;
    this.info = state.race;
    this.onQuit = onQuit;
    this.startAt = null;
    this.disposed = false;
    this.remote = new Map(); // id -> { view, buf, cur, rank, prog, finished, weight }
    this.entities = new Map(); // id -> { mesh, buf, type, owner, age }
    this.hitSet = new Set();
    this.boxHiddenAt = new Map();
    this.boxMask = '';
    this.item = null;
    this.itemCount = 0;
    this.rolling = 0;
    this.finished = false;
    this.lap = 1;
    this.rank = 1;
    this.lastSend = 0;
    this.acc = 0;
    this.rocketPress = null;
    this.bumpAt = new Map();
    this.messages = [];
    this.count = null;
    this.handlers = [];
  }

  // ------------------------------------------------------------ chargement

  async load(onProgress) {
    const info = this.info;
    const def = trackById(info.track);
    this.def = def;
    this.theme = themeFor(def);
    const T = new TrackPath(def);
    this.T = T;

    const scene = new THREE.Scene();
    this.scene = scene;
    const world = await buildWorld(T, def, this.theme, (p) => onProgress(p * 0.7));
    this.world = world;
    scene.add(world.group);
    scene.fog = world.fog;
    scene.background = world.background;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2600);
    this.fx = new Particles(scene);

    // Karts de la grille.
    const ccMul = CC_CLASSES[info.cc] || 1;
    let done = 0;
    await Promise.all(info.grid.map(async (g) => {
      const vehicle = vehicleById(g.vehicle);
      const view = new KartView(vehicle, { name: g.name, showName: g.id !== this.me, fx: this.fx });
      await view.load();
      scene.add(view.root);
      const slot = T.gridSlot(g.slot);
      const cur = { x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw, pitch: 0, spd: 0, f: 0 };
      this.remote.set(g.id, {
        id: g.id, name: g.name, isBot: g.isBot, view, buf: [], cur, rank: g.slot + 1, prog: slot.s,
        finished: false, weight: vehicle.stats.weight, color: KART_COLORS[g.slot % KART_COLORS.length],
      });
      if (g.id === this.me) {
        if (this.theme.night) {
          // La nuit, une lumière suit notre kart pour qu'on le voie bien.
          const lamp = new THREE.PointLight('#fff2dd', 60, 22, 1.6);
          lamp.position.set(0, 4, -2);
          view.root.add(lamp);
        }
        this.kart = new Kart(T, vehicleParams(vehicle.stats, ccMul));
        this.kart.place(slot);
        this.kart.onEvent = (type, data) => this.onKartEvent(type, data);
        this.camYaw = slot.yaw;
      }
      onProgress(0.7 + (0.3 * ++done) / info.grid.length);
    }));

    // Spectateur (arrivé en cours de course) : on suit le premier.
    this.spectator = !this.kart;
    const first = this.remote.values().next().value;
    this.camYaw = this.camYaw ?? first.cur.yaw;

    this.input = new Input();
    if (matchMedia('(pointer: coarse)').matches) {
      $('touchPad').classList.remove('hidden');
      this.input.bindTouch($('touchPad'));
    }
    this.prepareMinimap();
    this.resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this.resize);
    this.resize();

    $('hudLaps').textContent = info.laps;
    $('hudPosOf').textContent = `/${info.grid.length}`;
    $('hudTrack').textContent = def.name;
    this.renderHudItem();
  }

  begin() {
    this.last = performance.now();
    this.socket.emit('loaded', { race: this.info.id }, (res) => {
      if (res && res.startIn != null) this.setStart(res.startIn);
    });
    engineStart();
    const frame = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(frame);
      this.frame();
    };
    this.raf = requestAnimationFrame(frame);
  }

  setStart(startIn) {
    if (this.startAt == null) this.startAt = performance.now() + startIn;
  }

  // ------------------------------------------------------------ réseau

  onState(state) {
    const r = state.race;
    if (!r || r.id !== this.info.id) return;
    if (r.startIn != null) this.setStart(r.startIn);
  }

  onSnap(snap) {
    const now = performance.now();
    const seen = new Set();
    for (const [id, x, y, z, yaw, spd, f, prog, rank, fin, pitch] of snap.k) {
      seen.add(id);
      const r = this.remote.get(id);
      if (!r) continue;
      r.rank = rank;
      r.prog = prog;
      r.finished = !!fin;
      if (id === this.me) { this.rank = rank; continue; }
      r.buf.push({ t: now, x, y, z, yaw, spd, f, pitch });
      if (r.buf.length > 30) r.buf.shift();
    }
    // Karts partis.
    for (const [id, r] of this.remote) {
      if (!seen.has(id) && id !== this.me && !r.gone) { r.gone = true; r.view.root.visible = false; }
    }

    // Boîtes.
    const mask = snap.b.split('');
    for (const [i, t] of this.boxHiddenAt) {
      if (now - t < 1200) mask[i] = '0';
      else this.boxHiddenAt.delete(i);
    }
    this.boxMask = mask.join('');
    this.world.setBoxes(this.boxMask);

    // Objets sur la piste.
    const alive = new Set();
    for (const [id, type, x, y, z, owner, age] of snap.e) {
      alive.add(id);
      let e = this.entities.get(id);
      if (!e) {
        if (this.hitSet.has(id)) continue;
        e = { id, type, owner, mesh: entityMesh(type), buf: [] };
        e.mesh.position.set(x, y, z);
        this.scene.add(e.mesh);
        this.entities.set(id, e);
      }
      e.age = age;
      e.buf.push({ t: now, x, y, z });
      if (e.buf.length > 20) e.buf.shift();
    }
    for (const [id, e] of this.entities) {
      if (!alive.has(id)) this.removeEntity(id);
    }
    this.snapRanks = snap.k.map((k) => ({ id: k[0], rank: k[8] })).sort((a, b) => a.rank - b.rank);
    this.renderRanks();
  }

  removeEntity(id) {
    const e = this.entities.get(id);
    if (!e) return;
    this.scene.remove(e.mesh);
    this.entities.delete(id);
  }

  onEv(ev) {
    const k = this.kart;
    const myPos = k ? k : this.focusState();
    switch (ev.type) {
      case 'hit': {
        if (ev.e) {
          const e = this.entities.get(ev.e);
          if (e) this.fx.burst(e.mesh.position.x, e.mesh.position.y + 0.5, e.mesh.position.z, 14, { color: e.type === 'banana' ? '#ffd92e' : '#ffffff', size: 0.5, speed: 7, gravity: 12, life: 0.6 });
          this.removeEntity(ev.e);
        }
        if (ev.target === this.me && k) {
          if (ev.e && this.hitSet.has(ev.e)) break; // déjà appliqué en local
          if (ev.e) this.hitSet.add(ev.e);
          k.hit(ev.kind);
        } else {
          const r = this.remote.get(ev.target);
          if (r) this.fx.burst(r.cur.x, r.cur.y + 1.2, r.cur.z, 12, { color: '#fff1a8', size: 0.6, speed: 5, life: 0.7 });
        }
        break;
      }
      case 'boom': {
        this.fx.burst(ev.x, ev.y + 1, ev.z, 60, { color: '#ff8a1f', size: 2.2, size1: 0.4, speed: 14, drag: 3, life: 0.8 });
        this.fx.burst(ev.x, ev.y + 1, ev.z, 25, { color: '#555', size: 2.5, size1: 5, speed: 6, drag: 2, life: 1.4, normal: true, alpha: 0.6 });
        const d = Math.hypot(ev.x - myPos.x, ev.z - myPos.z);
        sfx.boom(d);
        if (d < 30) this.shake = Math.max(this.shake || 0, 0.6 * (1 - d / 30));
        break;
      }
      case 'zap':
        sfx.zap();
        this.flash('#ffffff');
        break;
      case 'finish': {
        const r = this.remote.get(ev.id);
        if (r && ev.id !== this.me) this.message(`${r.name} termine ${ev.rank}${ORDINAL(ev.rank)} !`, 2000, 'small');
        break;
      }
      case 'use':
        if (ev.item === 'star' && ev.id !== this.me) sfx.star();
        break;
      default:
    }
  }

  // ------------------------------------------------------------ boucle

  raceTime() {
    return this.startAt == null ? -Infinity : performance.now() - this.startAt;
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const rt = this.raceTime();
    const inp = this.input.read(dt);
    const k = this.kart;

    this.updateCountdown(rt, inp);

    if (k) {
      // Après l'arrivée, l'ordinateur prend le volant.
      let control = inp;
      if (this.finished) {
        if (!this.autopilot) this.autopilot = new BotBrain(k, makeRng(7), 0.6);
        control = this.autopilot.think(dt, {});
      }
      this.acc += dt;
      const others = this.otherKarts();
      while (this.acc >= STEP) {
        this.acc -= STEP;
        k.step(STEP, control);
        k.collide(others);
      }
      this.checkLocal(now, rt, inp);
      if (now - this.lastSend >= SEND_EVERY) {
        this.lastSend = now;
        this.socket.sendKart({
          x: +k.x.toFixed(2), y: +k.y.toFixed(2), z: +k.z.toFixed(2), yaw: +k.visYaw.toFixed(3),
          pitch: +(this.pitch || 0).toFixed(3), spd: +k.speed.toFixed(2), f: k.flags, prog: +k.prog.toFixed(2),
        });
      }
      engineUpdate(k.speed / k.p.maxSpeed, k.boostTime > 0, !k.falling);
    }

    // Affichage.
    this.renderKarts(dt, now);
    this.renderEntities(dt, now);
    this.fx.update(dt);
    this.updateCamera(dt, inp);
    const focus = this.focusState();
    this.world.update(dt, now / 1000, this.camera.position, new THREE.Vector3(focus.x, focus.y, focus.z));
    this.renderHud(rt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCountdown(rt, inp) {
    const k = this.kart;
    if (this.startAt == null) {
      $('hudCenter').textContent = '';
      return;
    }
    if (rt < 0) {
      const n = Math.ceil(-rt / 1000);
      if (n !== this.count && n <= 3) {
        this.count = n;
        sfx.count();
        this.bigText(String(n), 'count');
      }
      // Départ turbo : accélérer au bon moment (juste après le « 2 »).
      if (k && inp.throttle) { if (this.rocketPress == null) this.rocketPress = rt; } else this.rocketPress = null;
      return;
    }
    if (this.count !== 0) {
      this.count = 0;
      sfx.go();
      this.bigText('GO !', 'go');
      if (k) {
        k.locked = false;
        if (this.rocketPress != null && this.rocketPress > -1300 && this.rocketPress < -250) {
          k.boost(1.3);
          this.message('Départ turbo !', 1200, 'small');
        }
      }
    }
  }

  otherKarts() {
    const out = [];
    for (const r of this.remote.values()) {
      if (r.id === this.me || r.gone) continue;
      out.push({ id: r.id, x: r.cur.x, y: r.cur.y, z: r.cur.z, weight: r.weight, star: !!(r.cur.f & F.STAR) });
    }
    return out;
  }

  // Boîtes, objets au sol, étoile, tours et arrivée : vérifiés en local.
  checkLocal(now, rt, inp) {
    const k = this.kart;
    const T = this.T;
    const pitch = k.grounded ? Math.atan(k.q.slope || 0) : (this.pitch || 0) * 0.98;
    this.pitch = pitch;

    if (rt < 0 || k.falling) return;

    // Boîtes à objets.
    if (this.info.items) {
      for (let i = 0; i < T.boxes.length; i++) {
        if (this.boxMask && this.boxMask[i] === '0') continue;
        const b = T.boxes[i];
        if (Math.abs(b.x - k.x) < 2.4 && Math.abs(b.z - k.z) < 2.4 && Math.abs(b.y - k.y - 1) < 2.6) {
          this.boxHiddenAt.set(i, now);
          this.boxMask = this.boxMask.slice(0, i) + '0' + this.boxMask.slice(i + 1);
          this.world.hideBox(i);
          sfx.box();
          this.fx.burst(b.x, b.y, b.z, 18, { color: '#ffe45c', size: 0.5, speed: 8, life: 0.5 });
          if (!this.item && !this.rolling && !this.finished) {
            this.rolling = now;
            this.socket.emit('box', { i }, (res) => {
              if (!res || !res.item) { this.rolling = 0; return; }
              this.pendingItem = res.item;
            });
          }
        }
      }
    }
    // Fin de la roulette.
    if (this.rolling) {
      if (Math.random() < 0.3) sfx.roll();
      if (this.pendingItem && now - this.rolling > ROULETTE) {
        this.item = this.pendingItem;
        this.itemCount = ITEMS[this.item].count || 1;
        this.pendingItem = null;
        this.rolling = 0;
        sfx.got();
        this.renderHudItem();
      } else if (!this.pendingItem && now - this.rolling > 4000) {
        this.rolling = 0; // l'hôte n'a rien répondu
      }
    }

    // Utiliser l'objet.
    if (inp.itemPressed && this.item && !this.rolling && !this.finished) this.useItem(inp);

    // Objets sur la piste.
    for (const e of this.entities.values()) {
      if (e.type === 'bomb' || this.hitSet.has(e.id)) continue;
      if (e.owner === this.me && (e.age || 0) < 0.6) continue;
      const p = e.mesh.position;
      const r = (HIT_RADIUS[e.type] || 1.2) + KART_RADIUS * 0.8;
      if (Math.hypot(p.x - k.x, p.z - k.z) < r && Math.abs(p.y - k.y - 0.4) < 2.2) {
        this.hitSet.add(e.id);
        k.hit('spin');
        this.fx.burst(p.x, p.y + 0.5, p.z, 14, { color: '#fff', size: 0.5, speed: 7, gravity: 12, life: 0.6 });
        this.removeEntity(e.id);
        this.socket.emit('hit', { e: e.id });
      }
    }

    // Étoile : on renverse ceux qu'on touche.
    if (k.starTime > 0) {
      for (const o of this.otherKarts()) {
        if (Math.hypot(o.x - k.x, o.z - k.z) < KART_RADIUS * 2.2 && now - (this.bumpAt.get(o.id) || 0) > 1000) {
          this.bumpAt.set(o.id, now);
          this.socket.emit('bump', { target: o.id });
        }
      }
    }

    // Tours.
    const L = T.length;
    const lap = Math.max(1, Math.floor(k.prog / L) + 1);
    if (lap > this.lap && !this.finished) {
      this.lap = lap;
      if (lap <= this.info.laps) {
        if (lap === this.info.laps) { sfx.final(); this.bigText('TOUR FINAL', 'final'); } else { sfx.lap(); this.message(`Tour ${lap}/${this.info.laps}`, 1500); }
      }
    }
    if (!this.finished && k.prog >= this.info.laps * L) {
      this.finished = true;
      this.finishTime = rt;
      sfx.finish();
      this.socket.emit('finish', { time: rt }, (res) => {
        const rank = res && res.rank ? res.rank : this.rank;
        this.bigText(`${rank}${ORDINAL(rank)} !`, 'finish');
        this.message(`Arrivée en ${formatTime(rt)}`, 6000, 'small');
      });
      this.bigText('ARRIVÉE !', 'finish');
      this.item = null;
      this.renderHudItem();
    }
  }

  useItem(inp) {
    const k = this.kart;
    const item = this.item;
    const back = !!(inp.back || (inp.brake && !inp.throttle));
    switch (item) {
      case 'mushroom':
      case 'triple':
        k.boost(1.4);
        break;
      case 'star':
        k.starTime = 7;
        k.boost(0.5);
        sfx.star();
        break;
      case 'shield':
        k.shield = true;
        k.shieldTime = 15;
        sfx.shield();
        break;
      default:
        sfx.throw();
    }
    this.socket.emit('use', {
      item,
      back: item === 'banana' ? true : back,
      from: { x: k.x, y: k.y, z: k.z, yaw: k.yaw, speed: k.speed },
    });
    if (--this.itemCount <= 0) { this.item = null; this.itemCount = 0; }
    this.renderHudItem();
  }

  onKartEvent(type, data) {
    const k = this.kart;
    switch (type) {
      case 'boost': sfx.boost(); break;
      case 'hop': sfx.hop(); break;
      case 'land': if (data > 6) sfx.land(); break;
      case 'jump': sfx.jump(); break;
      case 'trick': sfx.trick(); break;
      case 'wall': sfx.wall(data); this.shake = Math.max(this.shake || 0, Math.min(0.4, data * 0.03)); break;
      case 'bump': sfx.bump(); break;
      case 'hit': sfx.hit(); this.shake = 0.35; if (data === 'zap') this.flash('#ffffff'); break;
      case 'shieldBreak': sfx.shield(); break;
      case 'fall': sfx.fall(); this.message('Oups !', 1200); break;
      case 'respawn': break;
      default:
    }
    if (type === 'boost' && k.miniTurbo) sfx.mini(k.miniTurbo);
  }

  // ------------------------------------------------------------ rendu

  interp(buf, now, out) {
    const t = now - INTERP;
    if (!buf.length) return false;
    let a = buf[0];
    let b = buf[buf.length - 1];
    if (t <= a.t) b = a;
    else {
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= t) { a = buf[i - 1]; b = buf[i]; break; }
      }
    }
    const u = b === a || b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
    out.x = a.x + (b.x - a.x) * u;
    out.y = a.y + (b.y - a.y) * u;
    out.z = a.z + (b.z - a.z) * u;
    if (a.yaw !== undefined) {
      out.yaw = lerpAngle(a.yaw, b.yaw, u);
      out.pitch = (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * u;
      out.spd = a.spd + (b.spd - a.spd) * u;
      out.f = u < 0.5 ? a.f : b.f;
    }
    return true;
  }

  renderKarts(dt, now) {
    const q = {};
    for (const r of this.remote.values()) {
      if (r.gone) continue;
      if (r.id === this.me && this.kart) {
        const k = this.kart;
        Object.assign(r.cur, { x: k.x, y: k.y, z: k.z, yaw: k.visYaw, pitch: this.pitch || 0, spd: k.speed, f: k.flags });
        r.cur.steer = this.input ? this.input.steerSmooth : 0;
        r.cur.off = k.surface === 'off';
      } else {
        this.interp(r.buf, now, r.cur);
        if (r.cur.spd > 8) {
          this.T.query(r.cur.x, r.cur.y, r.cur.z, r.idx ?? -1, q);
          r.idx = q.i;
          r.cur.off = Math.abs(q.d) > q.hw;
        }
      }
      r.cur.dust = this.theme.off;
      r.view.update(dt, r.cur);
    }
  }

  renderEntities(dt, now) {
    for (const e of this.entities.values()) {
      this.interp(e.buf, now, e.mesh.position);
      if (e.mesh.userData.spin) e.mesh.rotation.y += dt * 12;
      if (e.mesh.userData.spark) e.mesh.userData.spark.scale.setScalar(0.6 + Math.random() * 0.6);
    }
  }

  focusState() {
    if (this.kart) return this.kart;
    // Spectateur : le premier du classement.
    const lead = this.snapRanks && this.remote.get(this.snapRanks[0].id);
    return (lead || this.remote.values().next().value).cur;
  }

  updateCamera(dt, inp) {
    const k = this.kart;
    const f = this.focusState();
    const cam = this.camera;
    let yawTarget;
    let speedRatio = 0;
    let boost = false;
    if (k) {
      yawTarget = lerpAngle(k.yaw, k.moveYaw, 0.6);
      speedRatio = clamp(k.speed / k.p.maxSpeed, 0, 1.5);
      boost = k.boostTime > 0;
    } else {
      yawTarget = f.yaw;
      speedRatio = clamp((f.spd || 0) / 30, 0, 1.5);
    }
    if (k && k.spinTime > 0) yawTarget = this.camYaw; // la caméra ne tourne pas avec la toupie
    this.camYaw = lerpAngle(this.camYaw, yawTarget, 1 - Math.exp(-5 * dt));
    const look = inp.back && k && !this.finished ? Math.PI : 0;
    const yaw = this.camYaw + look;
    const dist = 6.6 + speedRatio * 0.8;
    const height = 2.7 + speedRatio * 0.3;
    const tx = f.x - Math.sin(yaw) * dist;
    const tz = f.z - Math.cos(yaw) * dist;
    const ty = f.y + height;
    if (!k || !k.falling) {
      const a = 1 - Math.exp(-(look ? 30 : 16) * dt);
      if (!this.camInit) { cam.position.set(tx, ty, tz); this.camInit = true; }
      cam.position.x += (tx - cam.position.x) * a;
      cam.position.z += (tz - cam.position.z) * a;
      cam.position.y += (ty - cam.position.y) * (1 - Math.exp(-5 * dt));
    }
    const shake = (this.shake || 0);
    this.shake = Math.max(0, shake - dt);
    cam.lookAt(
      f.x + Math.sin(yaw) * 4 + (Math.random() - 0.5) * shake,
      f.y + 1.2 + (Math.random() - 0.5) * shake,
      f.z + Math.cos(yaw) * 4,
    );
    const fov = 70 + speedRatio * 6 + (boost ? 9 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ HUD

  renderHud(rt) {
    const k = this.kart;
    $('hudTime').textContent = formatTime(this.finished ? this.finishTime : Math.max(0, rt));
    $('hudLap').textContent = Math.min(this.lap, this.info.laps);
    $('hudPos').textContent = this.rank;
    $('hudPosSuf').textContent = ORDINAL(this.rank);
    $('hudPos').parentElement.dataset.rank = this.rank;
    if (k) {
      $('hudSpeed').textContent = Math.round(Math.abs(k.speed) * 3.6);
      const lv = k.level;
      $('hudDrift').className = `hud-drift lv${lv}${k.drifting ? ' on' : ''}`;
      const wrong = k.wrongWay > 1.2;
      $('hudWrong').classList.toggle('hidden', !wrong);
    } else {
      $('hudSpeed').textContent = '–';
    }
    // Roulette.
    if (this.rolling) {
      const keys = Object.keys(ITEMS);
      const i = Math.floor(performance.now() / 70) % keys.length;
      $('hudItem').textContent = ITEMS[keys[i]].icon;
      $('hudItem').classList.add('rolling');
    }
    this.drawMinimap();
    // Messages.
    const now = performance.now();
    this.messages = this.messages.filter((m) => {
      if (now > m.until) { m.el.remove(); return false; }
      return true;
    });
  }

  renderHudItem() {
    const el = $('hudItem');
    el.classList.remove('rolling');
    el.textContent = this.item ? ITEMS[this.item].icon : '';
    $('hudItemCount').textContent = this.itemCount > 1 ? `×${this.itemCount}` : '';
    $('hudItemName').textContent = this.item ? ITEMS[this.item].name : '';
  }

  renderRanks() {
    const ol = $('hudRanks');
    if (!this.snapRanks) return;
    const html = this.snapRanks.map(({ id, rank }) => {
      const r = this.remote.get(id);
      if (!r) return '';
      const me = id === this.me ? ' class="me"' : '';
      return `<li${me}><b>${rank}</b><i style="background:${r.color}"></i>${escapeHtml(r.name)}${r.finished ? ' 🏁' : ''}</li>`;
    }).join('');
    if (html !== this.ranksHtml) {
      ol.innerHTML = html;
      this.ranksHtml = html;
    }
  }

  bigText(text, cls) {
    const el = $('hudCenter');
    el.textContent = text;
    el.className = `hud-center show ${cls}`;
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => { el.className = 'hud-center'; }, cls === 'finish' ? 3500 : 900);
  }

  message(text, ms = 1500, cls = '') {
    const box = $('hudMsg');
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = text;
    box.appendChild(el);
    this.messages.push({ el, until: performance.now() + ms });
  }

  flash(color) {
    const el = $('hudFlash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  prepareMinimap() {
    const T = this.T;
    const c = $('hudMap');
    const size = c.width;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < T.n; i++) {
      minX = Math.min(minX, T.px[i]); maxX = Math.max(maxX, T.px[i]);
      minZ = Math.min(minZ, T.pz[i]); maxZ = Math.max(maxZ, T.pz[i]);
    }
    const pad = 14;
    const k = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * k) / 2;
    const oz = (size - (maxZ - minZ) * k) / 2;
    // Carte vue du dessus, le nord en haut : x vers la gauche car on regarde +Z vers le bas.
    this.mapXY = (x, z) => [size - (ox + (x - minX) * k), oz + (z - minZ) * k];
    const bg = document.createElement('canvas');
    bg.width = bg.height = size;
    const g = bg.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= T.n; i++) {
        const [x, y] = this.mapXY(T.px[i % T.n], T.pz[i % T.n]);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    };
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 11;
    g.stroke();
    path();
    g.strokeStyle = '#f4f4f4';
    g.lineWidth = 6;
    g.stroke();
    const [sx, sy] = this.mapXY(T.px[0], T.pz[0]);
    g.fillStyle = '#111';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.mapBg = bg;
  }

  drawMinimap() {
    const c = $('hudMap');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.mapBg, 0, 0);
    const list = [...this.remote.values()].filter((r) => !r.gone).sort((a, b) => (a.id === this.me) - (b.id === this.me));
    for (const r of list) {
      const [x, y] = this.mapXY(r.cur.x, r.cur.z);
      const me = r.id === this.me;
      g.beginPath();
      g.arc(x, y, me ? 7 : 5, 0, Math.PI * 2);
      g.fillStyle = r.color;
      g.fill();
      g.lineWidth = me ? 3 : 1.5;
      g.strokeStyle = me ? '#fff' : 'rgba(0,0,0,0.7)';
      g.stroke();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.bigTimer);
    window.removeEventListener('resize', this.resize);
    if (this.input) this.input.dispose();
    engineStop();
    for (const m of this.messages) m.el.remove();
    $('hudCenter').className = 'hud-center';
    $('hudWrong').classList.add('hidden');
    $('touchPad').classList.add('hidden');
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    }
    this.renderer.renderLists.dispose();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
