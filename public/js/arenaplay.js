// Une partie en arène, côté joueur (tamponneuse, foot, bataille). On simule sa propre voiture,
// on affiche les autres d'après les instantanés de l'hôte. Au foot, le ballon est aussi simulé en
// local pour que nos frappes soient immédiates ; l'hôte reprend la main entre deux touches.

import * as THREE from './three.js';
import { applyEnvironment } from './envmap.js';
import { makeWorld, bumperGravity } from './arena.js';
import { Car3D, Ball, collideCars, hitBall, CF, CAR_MODES } from './car3d.js';
import { spawnPoints, boostPads, battleBoxes } from './modes/arenagame.js';
import { buildArena } from './arenaview.js';
import { KartView, visFromCar } from './kartview.js';
import { Particles, entityMesh } from './fx.js';
import { Input } from './input.js';
import { Hud, EMOTES } from './hud.js';
import { ico } from './icons.js';
import { ITEMS } from './items.js';
import { ARENA_HIT, PERSISTENT } from './arenaitems.js';
import { powerById, applyPowerToCar } from './powers.js';
import { vehicleById } from './data/vehicles.js';
import { colorHex, TEAM_COLORS } from './data/colors.js';
import { sfx, horn, engineStart, engineUpdate, engineStop, engineProfileFor } from './audio.js';
import { add, sub, len, norm, scale, qSlerp, qYaw } from './vec.js';
import { clamp } from './util.js';
import { getSettings, particleBudget } from './settings.js';

const SUB = 1 / 120;
const INTERP = 100;
const SEND_EVERY = 50;
const ROULETTE = 1300;
const KART_COLORS = ['#ff4d4d', '#4da6ff', '#4dff88', '#ffd24d', '#c44dff', '#ff9a4d', '#4dfff0', '#ff4dc4'];
const $ = (id) => document.getElementById(id);
const TITLES = { rocket: 'Foot turbo', bumper: 'Auto-tamponneuses', battle: 'Bataille de ballons' };

export class ArenaPlay {
  constructor({ renderer, socket, state }) {
    this.renderer = renderer;
    this.socket = socket;
    this.me = state.you;
    this.info = state.game;
    this.mode = this.info.mode;
    this.startAt = null;
    this.disposed = false;
    this.cars = new Map(); // id -> { view, buf, cur, team, color, score, extra }
    this.entities = new Map();
    this.hitSet = new Set();
    this.lockedUntil = 0;
    this.ballCam = this.mode === 'rocket';
    this.lastTouch = 0;
    this.item = null;
    this.itemCount = 0;
    this.rolling = 0;
    this.power = null;
    this.powerCd = 0;
    this.padHidden = new Map();
    this.boxHidden = new Map();
    this.padMask = '';
    this.boxMask = '';
    this.score = [0, 0];
    this.timeLeft = (this.info.matchTime || 3) * 60000;
    this.upsideUntil = 0;
    this.lastHitBy = null;
    this.lastHitAt = 0;
    this.respawnAt = 0;
    this.out = false;
    this.camDir = new THREE.Vector3(0, 0, 1);
    this.camUp = new THREE.Vector3(0, 1, 0);
  }

  async load(onProgress) {
    const mode = this.mode;
    this.world = makeWorld(mode, this.info.scale || 1);
    const arena = await buildArena(this.world.def);
    this.arena = arena;
    onProgress(0.6);
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(arena.group);
    scene.fog = arena.fog;
    scene.background = arena.background;
    applyEnvironment(this.renderer, scene, arena.env);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2600);
    this.fx = new Particles(scene, particleBudget());

    let done = 0;
    await Promise.all(this.info.grid.map(async (g, i) => {
      const vehicle = vehicleById(g.vehicle);
      const teamColor = g.team ? TEAM_COLORS[g.team] : null;
      const color = teamColor || colorHex(g.color);
      const view = new KartView(vehicle, { name: g.name, showName: g.id !== this.me, fx: this.fx, color, tagColor: teamColor || '#ffffff', arena: true });
      await view.load();
      scene.add(view.root);
      const sp = g.spawn || { p: [0, 2, 0], yaw: 0 };
      const cur = { x: sp.p[0], y: sp.p[1], z: sp.p[2], q: qYaw(sp.yaw), v: [0, 0, 0], f: 0, spd: 0 };
      const entry = { id: g.id, name: g.name, isBot: g.isBot, team: g.team, view, buf: [], cur, horn: g.horn, color: color || KART_COLORS[i % 8], score: 0, extra: 0, weight: vehicle.stats.weight };
      this.cars.set(g.id, entry);
      if (mode === 'battle') view.setBalloons(this.info.balloons || 3, entry.color);
      if (g.id === this.me) {
        this.vehicle = vehicle;
        this.team = g.team;
        this.car = new Car3D(this.world, mode, vehicle.stats.weight);
        this.car.place(sp.p[0], sp.p[1], sp.p[2], sp.yaw);
        this.car.onEvent = (type, data) => this.onCarEvent(type, data);
        this.camDir.set(Math.sin(sp.yaw), 0, Math.cos(sp.yaw));
      }
      onProgress(0.6 + (0.4 * ++done) / this.info.grid.length);
    }));

    if (mode === 'rocket') {
      this.ball = new Ball(this.world, this.world.def.ballR);
      this.ballShown = new THREE.Vector3(0, this.ball.p[1], 0);
      this.ballHits = 0;
    }

    this.input = new Input('car');
    this.hud = new Hud(mode);
    if (matchMedia('(pointer: coarse)').matches) this.input.bindTouch(this.hud.showTouch('car'));
    this.hud.setPowerVisible(!!this.info.powers);
    $('hudTrack').textContent = `${TITLES[mode]} · ${this.info.arena}`;
    this.prepareMap();
    this.resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this.resize);
    this.resize();
    this.renderHudItem();
  }

  begin() {
    this.last = performance.now();
    this.socket.emit('loaded', { game: this.info.id }, (res) => {
      if (res && res.startIn != null) this.setStart(res.startIn);
    });
    engineStart(engineProfileFor(this.vehicle));
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

  gameTime() {
    return this.startAt == null ? -1 : (performance.now() - this.startAt) / 1000;
  }

  // ------------------------------------------------------------ réseau

  onState(state) {
    const g = state.game;
    if (!g || g.id !== this.info.id) return;
    if (g.startIn != null) this.setStart(g.startIn);
  }

  onSnap(snap) {
    const now = performance.now();
    this.timeLeft = snap.tl;
    this.score = snap.sc;
    this.overtime = !!snap.ot;
    for (const row of snap.k) {
      const [id, x, y, z, qx, qy, qz, qw, vx, vy, vz, f, extra, score, power, cd] = row;
      const c = this.cars.get(id);
      if (!c) continue;
      c.score = score;
      c.extra = extra;
      c.outFlag = !!(f & CF.OUT);
      if (id === this.me) {
        if (power !== this.power) this.power = power || null;
        if (this.powerCd > 0 && cd === 0) sfx.powerReady();
        this.powerCd = cd;
        if (this.mode === 'battle') this.balloons = extra;
        if (c.outFlag && !this.out) this.eliminated();
        if (f & CF.BLINK) this.car.fx.invuln = Math.max(this.car.fx.invuln, 0.1);
        continue;
      }
      c.buf.push({ t: now, x, y, z, q: [qx, qy, qz, qw], v: [vx, vy, vz], f });
      if (c.buf.length > 30) c.buf.shift();
    }

    // Ballon : l'hôte fait foi, sauf juste après une de nos frappes.
    if (this.ball && snap.b) {
      const [x, y, z, vx, vy, vz, hits] = snap.b;
      if (hits !== this.ballHits && this.ballHits != null && now - this.lastTouch > 250) sfx.ball(len([vx, vy, vz]) * 0.4);
      this.ballHits = hits;
      if (now - this.lastTouch > 300) {
        this.ball.p = [x, y, z];
        this.ball.v = [vx, vy, vz];
        // Rattrape le temps de trajet du message (~40 ms).
        for (let i = 0; i < 5; i++) this.ball.step(1 / 120, Math.max(0, this.gameTime()));
      }
    }

    // Pastilles et boîtes.
    if (snap.pads) this.padMask = this.maskWithLocal(snap.pads, this.padHidden, now);
    if (this.arena.setPads) this.arena.setPads(this.padMask);
    if (snap.bx) this.boxMask = this.maskWithLocal(snap.bx, this.boxHidden, now);
    if (this.arena.setBoxes) this.arena.setBoxes(this.boxMask);

    // Objets (bataille).
    const alive = new Set();
    for (const [id, type, x, y, z, owner, age, yaw] of snap.e || []) {
      alive.add(id);
      let e = this.entities.get(id);
      if (!e) {
        if (this.hitSet.has(id) && !PERSISTENT[type]) continue;
        e = { id, type, owner, mesh: entityMesh(type), buf: [] };
        e.mesh.position.set(x, y, z);
        e.mesh.rotation.y = yaw || 0;
        this.scene.add(e.mesh);
        this.entities.set(id, e);
      }
      e.age = age;
      e.buf.push({ t: now, x, y, z });
      if (e.buf.length > 20) e.buf.shift();
    }
    for (const [id, e] of this.entities) if (!alive.has(id)) { this.scene.remove(e.mesh); this.entities.delete(id); }
    this.renderRanks();
  }

  maskWithLocal(mask, hidden, now) {
    const arr = mask.split('');
    for (const [i, t] of hidden) {
      if (now - t < 1200) arr[i] = '0';
      else hidden.delete(i);
    }
    return arr.join('');
  }

  onEv(ev) {
    const car = this.car;
    const me = this.me;
    const myP = car ? car.p : [0, 0, 0];
    const distTo = (x, z) => Math.hypot(x - myP[0], z - myP[2]);
    switch (ev.type) {
      case 'goal': {
        const mine = ev.team === this.team;
        const scorer = this.cars.get(ev.scorer);
        this.hud.bigText(mine ? 'BUT !' : 'BUT…', mine ? 'go' : 'final', 2600);
        this.hud.message(scorer ? `${scorer.name} marque pour les ${ev.team === 'blue' ? 'Bleus' : 'Orange'} !` : `But pour les ${ev.team === 'blue' ? 'Bleus' : 'Orange'} !`, 2500, 'small');
        this.fx.burst(ev.x, ev.y, ev.z, 120, { color: TEAM_COLORS[ev.team], size: 2.4, size1: 0.3, speed: 28, drag: 2.5, life: 1.2 });
        this.fx.burst(ev.x, ev.y, ev.z, 60, { color: '#ffffff', size: 1.4, speed: 18, drag: 2, life: 1 });
        sfx.goal();
        this.shake = 0.8;
        this.score = ev.score;
        this.lockedUntil = performance.now() + 99999; // jusqu'à l'engagement
        break;
      }
      case 'kickoff': {
        const pose = ev.poses[me];
        if (pose && car) {
          car.place(pose.p[0], pose.p[1], pose.p[2], pose.yaw);
          car.boost = 33;
          this.camDir.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
          this.camInit = false;
        }
        if (this.ball) this.ball.reset();
        this.lockedUntil = performance.now() + ev.startIn;
        this.countFrom = performance.now() + ev.startIn;
        break;
      }
      case 'overtime': this.hud.bigText('PROLONGATION', 'final', 2500); this.hud.message('Le prochain but gagne !', 2500, 'small'); sfx.whistle(); break;
      case 'final': {
        const win = ev.winner;
        const txt = !win ? 'Match nul !' : win === this.team ? 'Victoire !' : 'Défaite…';
        this.hud.bigText(txt, 'finish', 4000);
        sfx.whistle();
        break;
      }
      case 'gravity':
        this.hud.bigText(ev.name, 'final', 2200);
        sfx.zap();
        break;
      case 'down': {
        const c = this.cars.get(ev.id);
        const by = this.cars.get(ev.by);
        const verb = ev.kind === 'fall' ? 'éjecté' : 'retourné';
        if (c) this.hud.message(by ? `${by.name} a ${verb} ${c.name} !` : `${c.name} est ${verb} !`, 1800, 'small');
        if (ev.by === me) { sfx.got(); this.hud.bigText(ev.kind === 'fall' ? '+2' : '+1', 'go', 800); }
        break;
      }
      case 'pop': {
        const c = this.cars.get(ev.target);
        if (c) {
          const p = c.view.root.position;
          this.fx.burst(p.x, p.y + 3.4, p.z, 20, { color: c.color, size: 0.6, speed: 9, life: 0.6 });
          c.view.setBalloons(Math.max(0, ev.left), c.color);
        }
        sfx.pop();
        if (ev.target === me && car) {
          car.effect('spin', 1.1);
          car.effect('invuln', 2);
          car.v = scale(car.v, 0.3);
          this.shake = 0.4;
        }
        if (ev.by === me && ev.target !== me) this.hud.message('Ballon crevé ! +1', 1200, 'small');
        break;
      }
      case 'out': {
        const c = this.cars.get(ev.id);
        if (c) this.hud.message(`${c.name} est éliminé !`, 2000, 'small');
        break;
      }
      case 'shieldHit':
        if (ev.target === me && car) { car.shield = Math.max(0, car.shield - 1); sfx.shield(); }
        break;
      case 'hit':
        if (ev.e) { const e = this.entities.get(ev.e); if (e) { this.scene.remove(e.mesh); this.entities.delete(ev.e); } }
        break;
      case 'boom': {
        this.fx.burst(ev.x, ev.y + 1, ev.z, 60, { color: '#ff8a1f', size: 2.2, size1: 0.4, speed: 14, drag: 3, life: 0.8 });
        const d = distTo(ev.x, ev.z);
        sfx.boom(d);
        if (d < 30) this.shake = Math.max(this.shake || 0, 0.6 * (1 - d / 30));
        break;
      }
      case 'use': if (ev.item === 'star' && ev.id !== me) sfx.star(); break;
      case 'stolen':
        if (ev.target === me) { this.item = null; this.itemCount = 0; this.renderHudItem(); this.hud.message('On t’a volé ton objet !', 1500, 'small'); }
        break;
      case 'power': this.onPowerEvent(ev); break;
      case 'horn': {
        const c = this.cars.get(ev.id);
        if (c) horn(ev.kind, ev.id === me ? 0 : distTo(c.cur.x, c.cur.z));
        break;
      }
      case 'emote': {
        const c = this.cars.get(ev.id);
        if (c) { c.view.showEmote(ev.e); sfx.emote(); }
        break;
      }
      default:
    }
  }

  onPowerEvent(ev) {
    const P = powerById(ev.power);
    if (!P) return;
    const mine = ev.id === this.me;
    const who = this.cars.get(ev.id);
    if (!mine) this.hud.message(`${who ? who.name : '?'} : ${P.name}`, 1600, 'small', P.icon);
    if (P.target === 'near' || ev.power === 'onde') this.fx.burst(ev.x, ev.y + 1, ev.z, 40, { color: ev.power === 'gel' ? '#a8f0ff' : '#ffffff', size: 1.2, size1: 0.2, speed: 22, drag: 4, life: 0.6 });
    if (ev.power === 'gel') sfx.freeze(); else if (!mine) sfx.power();
    const car = this.car;
    if (!car || mine || !ev.targets.includes(this.me)) return;
    const r = applyPowerToCar(car, ev.power, 'target');
    if (r === 'ink') this.hud.ink(P.dur);
    if (r === 'upside') this.upsideUntil = performance.now() + P.dur * 1000;
    if (r === 'invert') this.hud.message('Direction inversée !', 1500);
    if (r === 'push') {
      const d = norm(sub(car.p, [ev.x, ev.y, ev.z]));
      car.v = add(car.v, add(scale(d, 26), [0, 9, 0]));
      this.shake = 0.5;
    }
  }

  // ------------------------------------------------------------ boucle

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const gt = this.gameTime();
    const inp = this.input.read(dt);
    const car = this.car;
    if (this.powerCd > 0) this.powerCd = Math.max(0, this.powerCd - dt);
    this.updateCountdown(gt, now);
    if (inp.camPressed && this.mode === 'rocket') { this.ballCam = !this.ballCam; this.hud.message(this.ballCam ? 'Caméra ballon' : 'Caméra libre', 900, 'small'); }

    if (car && !this.out) {
      const locked = gt < 0 || now < this.lockedUntil || now < this.respawnAt;
      car.locked = locked;
      const others = this.otherCars(now);
      const wt = Math.max(0, gt);
      this.acc = (this.acc || 0) + dt;
      while (this.acc >= SUB) {
        this.acc -= SUB;
        if (now < this.respawnAt) break;
        car.step(SUB, { throttle: inp.throttle, steer: inp.steer, pitch: inp.pitch, jump: inp.jump, boost: inp.boost, slide: inp.slide }, wt);
        for (const o of others) {
          const f = collideCars(car, o, this.mode);
          if (f > 4) {
            this.lastHitBy = o.id;
            this.lastHitAt = now;
            if (f > 8 && now - (this.crashAt || 0) > 250) { sfx.crash(f); this.crashAt = now; this.shake = Math.max(this.shake || 0, Math.min(0.5, f * 0.02)); }
          }
        }
        if (this.ball && !locked) {
          const hf = hitBall(car, this.ball);
          if (hf > 0 && now - this.lastTouch > 80) {
            this.lastTouch = now;
            sfx.ball(hf);
            this.socket.emit('touch', { p: this.ball.p.map((v) => +v.toFixed(2)), v: this.ball.v.map((v) => +v.toFixed(2)) });
          }
        }
      }
      if (this.ball && now - this.lastTouch < 300) for (let t = 0; t < Math.round(dt / SUB); t++) this.ball.step(SUB, wt);
      this.checkLocal(now, inp);
      if (now - (this.lastSend || 0) >= SEND_EVERY) {
        this.lastSend = now;
        const r = (v) => Math.round(v * 1000) / 1000;
        this.socket.sendKart({ p: car.p.map(r), q: car.q.map((v) => Math.round(v * 10000) / 10000), v: car.v.map(r), f: car.flags });
      }
      const P = CAR_MODES[this.mode];
      engineUpdate(car.speed / P.maxSpeed, car.boosting || car.fx.turbo > 0, true, inp.throttle > 0, !car.grounded);
    } else if (this.ball) {
      for (let t = 0; t < Math.round(dt / SUB); t++) this.ball.step(SUB, Math.max(0, gt));
    }

    if (inp.hornPressed) this.socket.emit('horn', {});
    if (inp.emote >= 0) this.socket.emit('emote', { e: EMOTES[inp.emote] });

    this.renderCars(dt, now);
    this.renderBall(dt);
    this.renderEntities(dt, now);
    this.fx.update(dt);
    if (this.arena.setTime) this.arena.setTime(Math.max(0, gt));
    this.updateCamera(dt);
    this.arena.update(dt, now / 1000, this.camera.position);
    this.renderHud(gt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCountdown(gt, now) {
    // Compte à rebours du départ ou de l'engagement.
    let left = null;
    if (gt < 0) left = -gt * 1000;
    else if (this.countFrom && now < this.countFrom) left = this.countFrom - now;
    if (left == null) {
      if (this.count && this.count !== 0) { this.count = 0; sfx.go(); this.hud.bigText('GO !', 'go'); }
      return;
    }
    const n = Math.ceil(left / 1000);
    if (n !== this.count && n <= 3) {
      this.count = n;
      sfx.count();
      this.hud.bigText(String(n), 'count');
    }
  }

  otherCars(now) {
    const out = [];
    const lat = 0.06;
    for (const c of this.cars.values()) {
      if (c.id === this.me || c.outFlag) continue;
      const f = c.cur.f | 0;
      out.push({
        id: c.id, p: add([c.cur.x, c.cur.y, c.cur.z], scale(c.cur.v || [0, 0, 0], lat)), q: c.cur.q, v: c.cur.v || [0, 0, 0],
        mass: 0.75 + c.weight * 0.1, ghost: !!(f & CF.GHOST), giant: !!(f & CF.GIANT), star: !!(f & CF.STAR), small: !!(f & CF.SMALL),
      });
    }
    return out;
  }

  checkLocal(now, inp) {
    const car = this.car;
    const mode = this.mode;
    // Pastilles de turbo (foot).
    if (mode === 'rocket') {
      boostPads(this.world.def).forEach((pad, i) => {
        if (this.padMask[i] === '0' || this.padHidden.has(i)) return;
        if (Math.hypot(pad.p[0] - car.p[0], pad.p[2] - car.p[2]) < (pad.big ? 3 : 2.2) && car.p[1] < 3) {
          this.padHidden.set(i, now);
          sfx.pad();
          this.socket.emit('pad', { i }, (res) => { if (res && res.amount) car.boost = Math.min(100, car.boost + res.amount); });
        }
      });
    }
    // Tamponneuse : chute ou retournement.
    if (mode === 'bumper' && now >= this.respawnAt) {
      const fell = car.p[1] < -14;
      const flipped = car.downTime > 1.6;
      if (fell || flipped) {
        const by = this.lastHitBy && now - this.lastHitAt < 4500 ? this.lastHitBy : null;
        this.socket.emit('down', { kind: fell ? 'fall' : 'flip', by });
        this.hud.bigText(fell ? 'Éjecté !' : 'Retourné !', 'final', 1200);
        sfx.fall();
        this.respawnAt = now + 1500;
        this.lastHitBy = null;
        const spots = spawnPoints(this.world.def, 8);
        const s = spots[Math.floor(Math.random() * spots.length)];
        setTimeout(() => {
          if (this.disposed) return;
          if (fell) car.place(s.p[0], s.p[1] + 2, s.p[2], s.yaw);
          else car.place(car.p[0] * 0.85, 2.5, car.p[2] * 0.85, Math.atan2(-car.p[0], -car.p[2]));
          car.effect('invuln', 1.5);
          this.camInit = false;
        }, 1500);
      }
    }
    if (mode !== 'battle') return;

    // Bataille : boîtes, objets, ballons, pouvoirs.
    battleBoxes().forEach((b, i) => {
      if (this.boxMask[i] === '0' || this.boxHidden.has(i)) return;
      if (len(sub(b.p, car.p)) < 2.8) {
        this.boxHidden.set(i, now);
        sfx.box();
        this.fx.burst(b.p[0], b.p[1] + 1, b.p[2], 18, { color: '#ffe45c', size: 0.5, speed: 8, life: 0.5 });
        if (!this.item && !this.rolling) {
          this.rolling = now;
          this.socket.emit('box', { i }, (res) => {
            if (!res || !res.item) { this.rolling = 0; return; }
            this.pendingItem = res.item;
          });
        }
      }
    });
    if (this.rolling) {
      if (Math.random() < 0.3) sfx.roll();
      if (this.pendingItem && now - this.rolling > ROULETTE) {
        this.item = this.pendingItem;
        this.itemCount = ITEMS[this.item].count || 1;
        this.pendingItem = null;
        this.rolling = 0;
        sfx.got();
        this.renderHudItem();
      } else if (!this.pendingItem && now - this.rolling > 4000) this.rolling = 0;
    }
    if (inp.itemPressed && this.item && !this.rolling) this.useItem(inp);
    if (inp.powerPressed) this.usePower();

    for (const e of this.entities.values()) {
      if (e.type === 'bomb' || this.hitSet.has(e.id)) continue;
      if (e.owner === this.me && (e.age || 0) < 0.6) continue;
      const p = e.mesh.position;
      if (Math.hypot(p.x - car.p[0], p.y - car.p[1], p.z - car.p[2]) < (ARENA_HIT[e.type] || 1.2) + 1.1) {
        if (car.fx.ghost > 0 || car.fx.star > 0) continue;
        this.hitSet.add(e.id);
        this.scene.remove(e.mesh);
        this.entities.delete(e.id);
        this.socket.emit('hit', { e: e.id });
      }
    }
    if (car.fx.star > 0 || car.fx.giant > 0) {
      for (const o of this.otherCars(now)) {
        if (len(sub(o.p, car.p)) < (car.fx.giant > 0 ? 5 : 3.2) && now - (this[`bump${o.id}`] || 0) > 1000) {
          this[`bump${o.id}`] = now;
          this.socket.emit('bump', { target: o.id });
        }
      }
    }
  }

  useItem(inp) {
    const car = this.car;
    const item = this.item;
    const back = !!(inp.throttle < 0);
    if (item === 'mushroom' || item === 'triple') { car.effect('turbo', 1.3); sfx.boost(); }
    else if (item === 'star') { car.effect('star', 7); sfx.star(); }
    else if (item === 'shield') { car.shield = 1; sfx.shield(); }
    else sfx.throw();
    const f = car.fwd;
    this.socket.emit('use', { item, back: item === 'banana' ? true : back, from: { p: car.p, fwd: norm([f[0], 0, f[2]]), speed: car.speed } });
    if (--this.itemCount <= 0) { this.item = null; this.itemCount = 0; }
    this.renderHudItem();
  }

  usePower() {
    const car = this.car;
    if (!this.power || this.powerCd > 0 || this.powerPending || this.out) return;
    this.powerPending = true;
    this.socket.emit('power', { p: car.p }, (res) => {
      this.powerPending = false;
      if (!res || !res.ok) return;
      sfx.power();
      this.power = res.next;
      this.powerCd = res.readyIn / 1000;
      applyPowerToCar(car, res.power, 'self');
      if (res.item) { this.item = res.item; this.itemCount = res.count || 1; this.renderHudItem(); }
      const P = powerById(res.power);
      this.hud.message(`${P.name} !`, 1200, '', P.icon);
    });
  }

  eliminated() {
    this.out = true;
    this.hud.bigText('Éliminé !', 'final', 2500);
    this.hud.message('Tu regardes la fin de la partie.', 3000, 'small');
  }

  onCarEvent(type, data) {
    switch (type) {
      case 'jump': sfx.jump(); break;
      case 'dodge': sfx.trick(); break;
      case 'flip': sfx.flip(); break;
      case 'land': if (data > 6) sfx.land(); break;
      case 'bumper': sfx.bump(); this.shake = 0.3; break;
      case 'crash': if (data > 10) sfx.wall(data); break;
      case 'shieldBreak': sfx.shield(); break;
      default:
    }
  }

  // ------------------------------------------------------------ rendu

  renderCars(dt, now) {
    for (const c of this.cars.values()) {
      if (c.id === this.me && this.car) {
        const car = this.car;
        Object.assign(c.cur, { x: car.p[0], y: car.p[1], z: car.p[2], q: car.q, v: car.v, f: car.flags | (this.out ? CF.OUT : 0), spd: car.speed });
        c.cur.steer = this.input.steerSmooth;
      } else {
        const buf = c.buf;
        if (buf.length) {
          const t = now - INTERP;
          let a = buf[0];
          let b = buf[buf.length - 1];
          if (t <= a.t) b = a;
          else for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].t <= t) { a = buf[i - 1]; b = buf[i]; break; }
          const u = b === a || b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
          c.cur.x = a.x + (b.x - a.x) * u;
          c.cur.y = a.y + (b.y - a.y) * u;
          c.cur.z = a.z + (b.z - a.z) * u;
          c.cur.q = qSlerp(a.q, b.q, u);
          c.cur.v = b.v;
          c.cur.f = b.f;
          c.cur.spd = len(b.v);
        }
      }
      c.cur.vis = visFromCar(c.cur.f | 0);
      if (this.mode === 'battle' && c.id !== this.me) c.view.setBalloons(Math.max(0, c.extra), c.color);
      if (this.mode === 'battle' && c.id === this.me && this.balloons != null) c.view.setBalloons(Math.max(0, this.balloons), c.color);
      c.view.update(dt, c.cur);
    }
  }

  renderBall(dt) {
    if (!this.ball) return;
    const b = this.ball;
    this.ballShown.lerp(new THREE.Vector3(...b.p), 1 - Math.exp(-25 * dt));
    this.arena.ball.position.copy(this.ballShown);
    const sp = len(b.v);
    if (sp > 0.1) {
      const axis = new THREE.Vector3(b.v[2], 0, -b.v[0]).normalize();
      this.arena.ball.rotateOnWorldAxis(axis, (sp * dt) / b.r);
    }
    this.arena.marker.position.set(this.ballShown.x, 0.03, this.ballShown.z);
    this.arena.marker.material.opacity = clamp(0.6 - this.ballShown.y / 30, 0.1, 0.6);
    if (sp > 30 && Math.random() < 0.5) this.fx.emit(this.ballShown.x, this.ballShown.y, this.ballShown.z, { color: '#ffffff', size: 2.2, size1: 0.2, life: 0.3, alpha: 0.4 });
  }

  renderEntities(dt, now) {
    for (const e of this.entities.values()) {
      const buf = e.buf;
      const t = now - INTERP;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) if (buf[i - 1].t <= t) { a = buf[i - 1]; b = buf[i]; break; }
      const u = b === a || b.t === a.t ? 1 : clamp((t - a.t) / (b.t - a.t), 0, 1);
      e.mesh.position.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
      if (e.mesh.userData.spin) e.mesh.rotation.y += dt * 12;
    }
  }

  focus() {
    if (this.car && !this.out) return { p: this.car.p, fwd: this.car.fwd, up: this.car.up };
    // Spectateur : le meilleur score encore en jeu.
    let best = null;
    for (const c of this.cars.values()) if (c.id !== this.me && !c.outFlag && (!best || c.score > best.score)) best = c;
    const c = best || this.cars.values().next().value;
    const q = c.cur.q || [0, 0, 0, 1];
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...q));
    return { p: [c.cur.x, c.cur.y, c.cur.z], fwd: [f.x, f.y, f.z], up: [0, 1, 0] };
  }

  updateCamera(dt) {
    const cam = this.camera;
    const F = this.focus();
    const p = new THREE.Vector3(...F.p);
    let dir;
    if (this.ballCam && this.ball) {
      const b = new THREE.Vector3(...this.ball.p);
      dir = b.sub(p).setY(0);
      if (dir.lengthSq() < 1) dir = new THREE.Vector3(F.fwd[0], 0, F.fwd[2]);
    } else {
      dir = new THREE.Vector3(F.fwd[0], 0, F.fwd[2]);
      // Sur un mur, on garde la direction de déplacement.
      if (this.car && Math.abs(this.car.up[1]) < 0.6) dir = new THREE.Vector3(this.car.v[0], 0, this.car.v[2]);
    }
    if (dir.lengthSq() < 0.01) dir.copy(this.camDir);
    dir.normalize();
    this.camDir.lerp(dir, 1 - Math.exp(-(this.ballCam ? 8 : 5) * dt)).normalize();
    const S = getSettings();
    const dist = (this.mode === 'rocket' ? 9.5 : 8) * S.camDist;
    const target = p.clone().addScaledVector(this.camDir, -dist).add(new THREE.Vector3(0, 3.6 * (0.6 + 0.4 * S.camDist), 0));
    // Garde la caméra dans l'arène.
    for (let i = 0; i < 8 && this.world.dist(target.x, target.y, target.z, Math.max(0, this.gameTime())) < 1; i++) target.lerp(p, 0.25);
    if (!this.camInit) { cam.position.copy(target); this.camInit = true; }
    cam.position.lerp(target, 1 - Math.exp(-12 * dt));
    const upside = performance.now() < this.upsideUntil;
    this.camUp.lerp(new THREE.Vector3(0, upside ? -1 : 1, 0), 1 - Math.exp(-6 * dt)).normalize();
    cam.up.copy(this.camUp);
    const shake = S.shake ? this.shake || 0 : 0;
    this.shake = Math.max(0, (this.shake || 0) - dt);
    let look = p.clone().addScaledVector(this.camDir, 4).add(new THREE.Vector3(0, 1.2, 0));
    if (this.ballCam && this.ball) look = look.lerp(new THREE.Vector3(...this.ball.p), 0.35);
    look.x += (Math.random() - 0.5) * shake;
    look.y += (Math.random() - 0.5) * shake;
    cam.lookAt(look);
    const boosting = this.car && (this.car.boosting || this.car.fx.turbo > 0);
    const fov = 75 + S.fov + (boosting ? 8 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------ HUD

  renderHud(gt) {
    const car = this.car;
    const tl = Math.max(0, this.timeLeft);
    const m = Math.floor(tl / 60000);
    const s = Math.floor((tl % 60000) / 1000);
    $('hudClock').textContent = this.overtime ? '+ PROLONG.' : `${m}:${String(s).padStart(2, '0')}`;
    if (this.mode === 'rocket') {
      $('hudScoreBlue').textContent = this.score[0];
      $('hudScoreOrange').textContent = this.score[1];
    }
    if (car && (this.mode === 'rocket' || this.mode === 'bumper')) {
      const b = Math.round(car.boost);
      $('hudBoostVal').textContent = b;
      $('hudBoost').style.setProperty('--b', b);
    }
    if (this.mode === 'bumper' && gt >= 0) {
      // Flèche inclinée selon la gravité ; intensité par rapport à la normale.
      const g = bumperGravity(gt).g;
      $('hudGrav').style.setProperty('--a', `${(Math.atan2(g[0] + g[2], -g[1]) * 180) / Math.PI}deg`);
      $('hudGravVal').textContent = `×${(len(g) / 18).toFixed(1)}`;
    }
    $('hudSpeed').textContent = car ? Math.round(car.speed * 3.6) : '–';
    if (this.rolling) {
      const keys = ['banana', 'green', 'red', 'bomb', 'mushroom', 'star', 'shield'];
      $('hudItem').innerHTML = ico(ITEMS[keys[Math.floor(performance.now() / 70) % keys.length]].icon);
      $('hudItem').classList.add('rolling');
    }
    if (this.info.powers) this.hud.setPower(this.power ? powerById(this.power) : null, this.powerCd);
    const dots = [...this.cars.values()].filter((c) => !c.outFlag).map((c) => ({ x: c.cur.x, z: c.cur.z, color: c.color, me: c.id === this.me }));
    if (this.ball) dots.push({ x: this.ball.p[0], z: this.ball.p[2], ball: true });
    this.hud.drawMap(dots);
    this.hud.update();
  }

  renderHudItem() {
    const el = $('hudItem');
    el.classList.remove('rolling');
    el.innerHTML = this.item ? ico(ITEMS[this.item].icon) : '';
    $('hudItemCount').textContent = this.itemCount > 1 ? `×${this.itemCount}` : '';
    $('hudItemName').textContent = this.item ? ITEMS[this.item].name : '';
  }

  renderRanks() {
    const list = [...this.cars.values()];
    if (this.mode === 'battle') list.sort((a, b) => (a.outFlag - b.outFlag) || b.extra - a.extra || b.score - a.score);
    else list.sort((a, b) => b.score - a.score);
    this.hud.ranks(list.map((c, i) => ({
      rank: i + 1, name: c.name, color: c.color, me: c.id === this.me,
      extra: this.mode === 'battle' ? '' : this.mode === 'rocket' ? `${c.score}` : `${c.score} pts`,
      badges: this.mode === 'battle' ? (c.outFlag ? ['skull'] : Array(Math.max(0, c.extra)).fill('balloon')) : null,
    })));
  }

  prepareMap() {
    const A = this.world.def;
    if (this.mode === 'rocket') {
      this.hud.prepareMap([[-A.X, -A.Z], [A.X, -A.Z], [A.X, A.Z], [-A.X, A.Z]], null);
    } else if (this.mode === 'bumper') {
      const R = A.radius;
      this.hud.prepareMap(Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2) * R, Math.sin((i / 48) * Math.PI * 2) * R]), null);
    } else {
      const H = A.half;
      this.hud.prepareMap([[-H, -H], [H, -H], [H, H], [-H, H]], null);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    if (this.input) this.input.dispose();
    if (this.hud) this.hud.dispose();
    engineStop();
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    }
    this.renderer.renderLists.dispose();
  }
}
