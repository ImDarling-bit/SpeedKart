// Partie de police contre voleurs, côté joueur. Reprend la base des arènes (physique 3D,
// caméra, interpolation) et y ajoute les rôles, la ville, les sacs, la prison et les gadgets.

import * as THREE from './three.js';
import { ArenaPlay } from './arenaplay.js';
import { cityById, buildCity, makeCityWorld, nearestNode } from './city.js';
import { buildCityView } from './cityview.js';
import { Car3D, CF } from './car3d.js';
import { KartView } from './kartview.js';
import { Particles } from './fx.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { COPS_RULES, GADGETS } from './modes/copsgame.js';
import { ARENA_HIT, PERSISTENT, SMOKE_RADIUS } from './arenaitems.js';
import { vehicleById } from './data/vehicles.js';
import { colorHex } from './data/colors.js';
import { sfx, horn } from './audio.js';
import { sub, len, norm } from './vec.js';

const COP_COLOR = '#4da3ff';
const THIEF_COLOR = '#ff5a5a';
const SEE_RANGE = 70; // la police voit les voleurs sur la carte à moins de 70 m
const OBJECTIVES = {
  heist: { cop: 'Arrête les voleurs avant qu’ils ne remplissent leur planque.', thief: 'Ramasse les sacs 💰 et rapporte-les à la planque. Libère tes complices.' },
  hunt: { cop: 'Arrête tous les voleurs avant la fin du temps.', thief: 'Ne te fais pas attraper jusqu’à la fin du temps.' },
  infect: { cop: 'Attrape les voleurs : ils rejoignent la police.', thief: 'Sois le dernier voleur en liberté.' },
  escape: { cop: 'Empêche les voleurs d’atteindre les sorties.', thief: 'Rejoins une SORTIE (ouverte au bout de 20 s).' },
};

export class CopsPlay extends ArenaPlay {
  constructor(opts) {
    super(opts);
    this.rule = this.info.rule;
    this.roles = {};
    this.bags = 0;
    this.money = 0;
    this.target = 0;
    this.round = 0;
    this.gadgetReady = [0, 0, 0];
    this.revealUntil = 0;
    this.exitsOpen = false;
    this.bagHidden = new Map();
    this.bagMask = '';
    this.sent = {};
  }

  async load(onProgress) {
    const info = this.info;
    this.city = buildCity(cityById(info.city));
    this.world = makeCityWorld(this.city);
    const view = await buildCityView(this.city);
    this.cityView = view;
    // ArenaPlay appelle arena.update(dt, t, camPos) : on y ajoute le point suivi (ombres).
    this.arena = { update: (dt, t, cam) => view.update(dt, t, cam, this.focusVec()) };
    onProgress(0.6);
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.add(view.group);
    scene.fog = view.fog;
    scene.background = view.background;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2600);
    this.fx = new Particles(scene);

    const ri = info.roundInfo;
    this.roles = { ...ri.roles };
    this.target = ri.target;
    let done = 0;
    await Promise.all(info.grid.map(async (g) => {
      const role = this.roles[g.id];
      const pose = ri.poses[g.id] || { p: [0, 2, 0], yaw: 0 };
      const entry = {
        id: g.id, name: g.name, isBot: g.isBot, horn: g.horn, buf: [], score: 0, extra: 0, role, baseVehicle: g.vehicle, baseColor: colorHex(g.color),
        cur: { x: pose.p[0], y: pose.p[1], z: pose.p[2], q: [0, Math.sin(pose.yaw / 2), 0, Math.cos(pose.yaw / 2)], v: [0, 0, 0], f: 0, spd: 0 },
      };
      await this.makeView(entry);
      this.cars.set(g.id, entry);
      if (g.id === this.me) {
        this.vehicle = vehicleById(role === 'cop' ? 'police' : g.vehicle);
        this.car = new Car3D(this.world, 'cops', this.vehicle.stats.weight);
        this.car.place(pose.p[0], pose.p[1], pose.p[2], pose.yaw);
        this.car.onEvent = (type, data) => this.onCarEvent(type, data);
        this.camDir.set(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
      }
      onProgress(0.6 + (0.4 * ++done) / info.grid.length);
    }));

    this.input = new Input('car');
    this.hud = new Hud('cops');
    this.applyMyRole(true);
    if (matchMedia('(pointer: coarse)').matches) this.input.bindTouch(this.hud.showTouch('car'));
    this.hud.setTitle(`${COPS_RULES[this.rule].icon} ${COPS_RULES[this.rule].name} · ${this.city.def.name}`);
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
  }

  // Véhicule affiché selon le rôle : voitures de police imposées.
  async makeView(entry) {
    if (entry.view) entry.view.dispose();
    const cop = entry.role === 'cop';
    const vehicle = vehicleById(cop ? 'police' : entry.baseVehicle);
    const view = new KartView(vehicle, {
      name: `${cop ? '🚓' : '🦹'} ${entry.name}`, showName: entry.id !== this.me, fx: this.fx,
      color: cop ? null : entry.baseColor, tagColor: cop ? COP_COLOR : THIEF_COLOR, arena: true,
    });
    await view.load();
    if (cop) {
      // Gyrophare.
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: '#3b6bff', emissive: '#3b6bff', emissiveIntensity: 2 }));
      light.position.y = 1.45;
      view.body.add(light);
      view.siren = light;
    }
    this.scene.add(view.root);
    entry.view = view;
    entry.color = cop ? COP_COLOR : entry.baseColor || THIEF_COLOR;
  }

  applyMyRole(silent) {
    const role = this.roles[this.me];
    this.role = role;
    if (this.car) this.car.speedMul = role === 'cop' ? 1.04 : 1;
    this.gadgets = role ? GADGETS[role] : [];
    this.hud.setRole(role, OBJECTIVES[this.rule][role]);
    if (!silent) this.hud.bigText(role === 'cop' ? '🚓 POLICE' : '🦹 VOLEUR', role === 'cop' ? 'go' : 'final', 2500);
  }

  focusVec() {
    const F = this.focus();
    return new THREE.Vector3(F.p[0], F.p[1], F.p[2]);
  }

  // ------------------------------------------------------------ réseau

  onSnap(snap) {
    super.onSnap(snap);
    this.timeLeft = snap.tl;
    this.money = snap.money;
    this.target = snap.target;
    this.copsFreeIn = snap.cf;
    // La police attend pendant l'avance des voleurs.
    if (this.role === 'cop' && snap.cf > 0) this.lockedUntil = Math.max(this.lockedUntil, performance.now() + snap.cf);
    if (!!snap.ex !== this.exitsOpen) {
      this.exitsOpen = !!snap.ex;
      this.cityView.setExits(this.exitsOpen);
      if (this.exitsOpen && this.rule === 'escape') { this.hud.message('Les sorties sont ouvertes !', 2000, 'small'); sfx.whistle(); }
    }
    const now = performance.now();
    const arr = snap.bags.split('');
    for (const [i, t] of this.bagHidden) { if (now - t < 1200) arr[i] = '0'; else this.bagHidden.delete(i); }
    this.bagMask = arr.join('');
    this.cityView.setBags(this.bagMask);
    for (const row of snap.k) {
      const c = this.cars.get(row[0]);
      if (!c) continue;
      const extra = row[12];
      const role = extra & 1 ? 'cop' : 'thief';
      c.jailed = !!(extra & 2);
      c.gone = !!(extra & 4) || !!(extra & 8);
      c.bags = extra >> 4;
      if (row[0] === this.me) this.bags = c.bags;
      if (role !== c.role) {
        c.role = role;
        this.roles[c.id] = role;
        this.makeView(c);
        if (c.id === this.me) this.applyMyRole(false);
      }
    }
  }

  onEv(ev) {
    const me = this.me;
    const car = this.car;
    switch (ev.type) {
      case 'round': this.startRound(ev); break;
      case 'roundEnd': {
        const mine = this.role === ev.winner;
        this.hud.bigText(ev.winner === 'cop' ? '🚓 LA POLICE GAGNE' : '🦹 LES VOLEURS GAGNENT', mine ? 'go' : 'final', 4000);
        this.hud.message(`Manche ${ev.round + 1}/${ev.rounds} terminée`, 3500, 'small');
        sfx.whistle();
        this.lockedUntil = performance.now() + 99999;
        break;
      }
      case 'arrest': {
        const cop = this.cars.get(ev.cop);
        const th = this.cars.get(ev.thief);
        const verb = { jail: 'envoie en prison', out: 'arrête', convert: 'recrute', back: 'renvoie au départ' }[ev.kind];
        if (cop && th) this.hud.message(`${cop.name} ${verb} ${th.name} !`, 2000, 'small');
        sfx.crash(12);
        if (ev.cop === me) { sfx.got(); this.hud.bigText('ARRESTATION +10', 'go', 1000); }
        if (ev.thief === me && car) {
          this.shake = 0.6;
          if (ev.pose) { car.place(ev.pose.p[0], ev.pose.p[1], ev.pose.p[2], ev.pose.yaw || 0); this.camInit = false; }
          if (ev.kind === 'jail') this.hud.bigText('EN PRISON !', 'final', 2500);
          if (ev.kind === 'back') { this.hud.bigText('RETOUR AU DÉPART', 'final', 2000); this.lockedUntil = performance.now() + 4000; }
          if (ev.kind === 'out') { this.out = true; this.hud.bigText('ARRÊTÉ !', 'final', 2500); }
          if (ev.kind === 'convert') this.lockedUntil = performance.now() + 2000;
        }
        break;
      }
      case 'freed': {
        const by = this.cars.get(ev.by);
        this.hud.message(`${by ? by.name : 'Un voleur'} libère les prisonniers !`, 2000, 'small');
        sfx.star();
        const pose = ev.poses[me];
        if (pose && car) { car.place(pose.p[0], pose.p[1], pose.p[2], pose.yaw || 0); car.effect('invuln', 3); this.camInit = false; this.hud.bigText('LIBÉRÉ !', 'go', 1500); }
        break;
      }
      case 'bag': if (ev.id === me) { sfx.got(); this.hud.message(`Sac ramassé (${ev.n}/3)`, 1000, 'small'); } break;
      case 'deposit': {
        const c = this.cars.get(ev.id);
        this.hud.message(`${c ? c.name : '?'} dépose ${ev.n} sac${ev.n > 1 ? 's' : ''} (${ev.money}/${ev.target})`, 1800, 'small');
        if (ev.id === me) { sfx.finish(); this.hud.bigText(`+${ev.n * 5}`, 'go', 900); }
        break;
      }
      case 'escaped': {
        const c = this.cars.get(ev.id);
        this.hud.message(`${c ? c.name : '?'} s’est évadé !`, 2000, 'small');
        if (ev.id === me) { this.out = true; sfx.finish(); this.hud.bigText('ÉVADÉ ! +15', 'go', 2500); }
        break;
      }
      case 'siren': {
        const c = this.cars.get(ev.id);
        if (c) horn('sirene', ev.id === me ? 0 : Math.hypot(c.cur.x - (car ? car.p[0] : 0), c.cur.z - (car ? car.p[2] : 0)));
        if (this.role === 'cop') this.revealUntil = performance.now() + ev.until;
        break;
      }
      case 'blind': if (ev.target === me) { this.hud.ink(3); sfx.swoosh(); } break;
      case 'gadget': {
        if (ev.gadget === 'fumee') this.fx.burst(ev.x, ev.y + 2, ev.z, 30, { color: '#c8c8d0', size: 3, size1: 6, speed: 4, drag: 2, life: 1.6, normal: true, alpha: 0.6 });
        if (ev.gadget === 'cones' || ev.gadget === 'herse' || ev.gadget === 'huile') sfx.throw();
        break;
      }
      default: super.onEv(ev);
    }
  }

  // Nouvelle manche : rôles, positions, véhicules.
  async startRound(ev) {
    this.round = ev.n;
    this.target = ev.target;
    this.out = false;
    this.bags = 0;
    this.gadgetReady = [0, 0, 0];
    this.revealUntil = 0;
    const changed = [];
    for (const [id, role] of Object.entries(ev.roles)) {
      const c = this.cars.get(id);
      if (!c) continue;
      if (c.role !== role) { c.role = role; changed.push(c); }
      this.roles[id] = role;
      const pose = ev.poses[id];
      if (pose && id !== this.me) { c.buf.length = 0; c.cur.x = pose.p[0]; c.cur.y = pose.p[1]; c.cur.z = pose.p[2]; }
    }
    const pose = ev.poses[this.me];
    if (pose && this.car) {
      this.vehicle = vehicleById(this.roles[this.me] === 'cop' ? 'police' : this.cars.get(this.me).baseVehicle);
      this.car = new Car3D(this.world, 'cops', this.vehicle.stats.weight);
      this.car.place(pose.p[0], pose.p[1], pose.p[2], pose.yaw || 0);
      this.car.onEvent = (type, data) => this.onCarEvent(type, data);
      this.camDir.set(Math.sin(pose.yaw || 0), 0, Math.cos(pose.yaw || 0));
      this.camInit = false;
    }
    await Promise.all(changed.map((c) => this.makeView(c)));
    const intro = ev.introMs || 0;
    this.lockedUntil = performance.now() + intro + (this.roles[this.me] === 'cop' ? ev.headStart : 0);
    this.countFrom = performance.now() + intro;
    this.applyMyRole(false);
    this.hud.message(`Manche ${ev.n + 1}/${ev.rounds}`, 2500);
  }

  // ------------------------------------------------------------ actions locales

  checkLocal(now, inp) {
    const car = this.car;
    const me = this.cars.get(this.me);
    if (!car || !me) return;
    const once = (key, ms) => {
      if (now - (this.sent[key] || 0) < ms) return false;
      this.sent[key] = now;
      return true;
    };
    // Tombé à l'eau (port) : retour au carrefour le plus proche.
    if (car.p[1] < -6) {
      const nd = nearestNode(this.city, car.p);
      car.place(nd.x, 1.5, nd.z, 0);
      car.effect('invuln', 1.5);
      sfx.fall();
      this.hud.message('Plouf !', 1000);
      this.camInit = false;
    }
    if (this.out || me.jailed) return;

    // Gadgets : E / R / F (manette LB, croix haut, Y).
    const presses = [inp.itemPressed, inp.powerPressed, inp.g3Pressed || inp.camPressed];
    presses.forEach((p, slot) => { if (p) this.useGadget(slot); });

    if (this.role === 'cop') {
      if (now < this.lockedUntil) return;
      for (const c of this.cars.values()) {
        if (c.role !== 'thief' || c.jailed || c.gone || c.id === this.me) continue;
        if (Math.hypot(c.cur.x - car.p[0], c.cur.y - car.p[1], c.cur.z - car.p[2]) < 3.8 && !(c.cur.f & CF.BLINK) && once(`a${c.id}`, 800)) {
          this.socket.emit('arrest', { target: c.id });
        }
      }
    } else {
      const flat = (p) => Math.hypot(p[0] - car.p[0], p[2] - car.p[2]);
      if (this.rule === 'heist') {
        this.city.bagSpots.forEach((p, i) => {
          if (this.bagMask[i] !== '1' || this.bags >= 3 || flat(p) > 3.8 || this.bagHidden.has(i)) return;
          this.bagHidden.set(i, now);
          this.socket.emit('bag', { i });
        });
        if (this.bags > 0 && this.city.hideouts.some((h) => flat(h.p) < h.r) && once('dep', 1000)) this.socket.emit('deposit', {});
        const jailed = [...this.cars.values()].some((c) => c.jailed);
        if (jailed && flat(this.city.prison.button) < 4.5 && once('free', 1500)) this.socket.emit('free', {});
      }
      if (this.rule === 'escape' && this.exitsOpen && this.city.exits.some((e) => flat(e.p) < e.r) && once('esc', 1000)) this.socket.emit('escape', {});
    }

    // Herses, huile, cônes.
    for (const e of this.entities.values()) {
      if (e.type === 'smoke' || this.hitSet.has(e.id)) continue;
      if (e.type === 'spike' && this.role !== 'thief') continue;
      if (e.owner === this.me && (e.age || 0) < 2) continue;
      const p = e.mesh.position;
      if (Math.hypot(p.x - car.p[0], p.z - car.p[2]) < (ARENA_HIT[e.type] || 1.2) + 1 && Math.abs(p.y - car.p[1]) < 3) {
        this.hitSet.add(e.id);
        if (car.spinOut()) sfx.hit();
        if (!PERSISTENT[e.type]) { this.scene.remove(e.mesh); this.entities.delete(e.id); }
        this.socket.emit('hit', { e: e.id });
      }
    }
  }

  useGadget(slot) {
    const g = this.gadgets[slot];
    const now = performance.now();
    if (!g || now < this.gadgetReady[slot] || now < this.lockedUntil || this.pendingGadget) return;
    const car = this.car;
    const f = car.fwd;
    this.pendingGadget = true;
    this.socket.emit('gadget', { slot, p: car.p.map((v) => +v.toFixed(2)), fwd: norm([f[0], 0, f[2]]) }, (res) => {
      this.pendingGadget = false;
      if (!res || !res.ok) return;
      this.gadgetReady[slot] = performance.now() + res.readyIn;
      if (g.id === 'nitro') { car.effect('turbo', 1.6); sfx.boost(); }
      if (g.id === 'sirene') { car.effect('turbo', 2.5); this.revealUntil = performance.now() + 5000; }
      this.hud.message(`${g.icon} ${g.name}`, 900, 'small');
    });
  }

  eliminated() {
    if (this.rule === 'escape') return;
    this.out = true;
  }

  // ------------------------------------------------------------ rendu

  renderCars(dt, now) {
    super.renderCars(dt, now);
    // Gyrophares qui clignotent.
    const blink = Math.floor(now / 180) % 2;
    for (const c of this.cars.values()) {
      if (c.view.siren) c.view.siren.material.emissive.set(blink ? '#3b6bff' : '#ff2b2b');
      if (c.jailed && c.view.root.visible) c.view.root.visible = true;
    }
  }

  renderEntities(dt, now) {
    super.renderEntities(dt, now);
    for (const e of this.entities.values()) if (e.mesh.userData.smoke) e.mesh.rotation.y += dt * 0.4;
  }

  renderHud(gt) {
    const car = this.car;
    const tl = Math.max(0, this.timeLeft);
    $('hudClock').textContent = `${Math.floor(tl / 60000)}:${String(Math.floor((tl % 60000) / 1000)).padStart(2, '0')}`;
    $('hudSpeed').textContent = car ? Math.round(car.speed * 3.6) : '–';
    if (car) {
      $('hudBoostVal').textContent = Math.round(car.boost);
      $('hudBoost').style.setProperty('--b', Math.round(car.boost));
    }
    const now = performance.now();
    this.hud.setCops({
      round: this.round + 1, rounds: this.info.rounds, rule: this.rule, role: this.role,
      money: this.money, target: this.target, bags: this.bags,
      wait: this.role === 'cop' && now < this.lockedUntil ? Math.ceil((this.lockedUntil - now) / 1000) : 0,
    });
    this.hud.setGadgets(this.gadgets.map((g, i) => ({ ...g, key: ['E', 'R', 'F'][i], cd: Math.max(0, (this.gadgetReady[i] - now) / 1000) })));

    // Carte : la police ne voit les voleurs que de près, ou pendant la sirène.
    const reveal = now < this.revealUntil;
    const dots = [];
    for (const c of this.cars.values()) {
      if (c.gone) continue;
      if (this.role === 'cop' && c.role === 'thief' && !reveal && car && Math.hypot(c.cur.x - car.p[0], c.cur.z - car.p[2]) > SEE_RANGE) continue;
      dots.push({ x: c.cur.x, z: c.cur.z, color: c.role === 'cop' ? COP_COLOR : THIEF_COLOR, me: c.id === this.me });
    }
    if (this.role === 'thief' && this.rule === 'heist') {
      this.city.bagSpots.forEach((p, i) => { if (this.bagMask[i] === '1') dots.push({ x: p[0], z: p[2], color: '#ffd23f', small: true }); });
    }
    this.hud.drawMap(dots);
    this.hud.update();
  }

  renderRanks() {
    if (!this.hud) return;
    const list = [...this.cars.values()].sort((a, b) => b.score - a.score);
    this.hud.ranks(list.map((c, i) => ({
      rank: i + 1, name: `${c.role === 'cop' ? '🚓' : '🦹'} ${c.name}`, color: c.role === 'cop' ? COP_COLOR : THIEF_COLOR, me: c.id === this.me,
      extra: c.jailed ? '🔒' : c.gone ? '—' : c.bags ? '💰'.repeat(c.bags) : `${c.score}`,
    })));
  }

  prepareMap() {
    const C = this.city;
    const blocks = C.blocks.filter((b) => b.type === 'B').map((b) => [b.cx, b.cz, C.B / 2 - C.sidewalk]);
    const marks = [
      ...C.hideouts.map((h) => ({ x: h.p[0], z: h.p[2], icon: '$', color: '#ffd23f' })),
      ...(this.rule === 'escape' ? C.exits.map((e) => ({ x: e.p[0], z: e.p[2], icon: '⇥', color: '#38d96b' })) : []),
      ...(C.prison ? [{ x: C.prison.c[0], z: C.prison.c[2], icon: '#', color: '#ff5a5a' }] : []),
    ];
    this.hud.prepareCityMap(C.W, C.D, blocks, this.rule === 'heist' ? marks : marks.filter((m) => m.icon !== '$'));
  }
}

const $ = (id) => document.getElementById(id);
