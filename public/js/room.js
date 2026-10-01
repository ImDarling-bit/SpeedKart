// Moteur de la partie, exécuté chez l'hôte : salon, profils, réglages, chargement, résultats, points.
// Le déroulement de chaque mode (course, tamponneuse, foot, bataille) est délégué à un module de
// mode (modes/*.js). Chaque joueur pilote son propre véhicule et envoie sa position ; l'hôte
// arbitre le reste et renvoie à tous un instantané 20 fois par seconde.

import { TRACKS } from './data/tracks.js';
import { VEHICLES, CC_CLASSES } from './data/vehicles.js';
import { createRaceGame } from './modes/racegame.js';
import { createArenaGame, ARENA_MODES } from './modes/arenagame.js';
import { KART_COLORS } from './data/colors.js';
import { EMOTES, HORN_KINDS } from './data/social.js';

export const MAX_KARTS = 8;
export const MODES = ['race', ...ARENA_MODES];
const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const BOT_NAMES = ['Turbo Tom', 'Mémé Drift', 'Pilote Pixel', 'Capitaine Pneu', 'Lulu Nitro', 'Bob Bolide', 'Zaza Zoom', 'Gigi Gomme'];
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOAD_TIMEOUT = 20000;
const COUNTDOWN = 3000;
const SNAP_EVERY = 50; // ms

export function makeCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return c;
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pilote';
const cleanColor = (c) => (KART_COLORS.some((k) => k.id === c) ? c : 'aucune');

export function createRoom(opts) {
  const { code, send } = opts;
  const now = opts.now || (() => performance.now());
  const rand = opts.rand || Math.random;

  const players = new Map(); // id -> { id, name, vehicle, color, horn, team, score, isHost, connected }
  let hostId = null;
  const settings = {
    mode: 'race', track: TRACKS[0].id, laps: 3, cc: 100, bots: true, items: true, difficulty: 2,
    powers: false, chaos: false, teamSize: 2, matchTime: 3, balloons: 3,
  };
  let phase = 'lobby'; // lobby | game | results
  let game = null;
  let gameSeq = 0;
  const bots = BOT_NAMES.map((name, i) => ({
    id: `bot${i}`, name, vehicle: VEHICLES[(i * 5 + 3) % VEHICLES.length].id,
    color: KART_COLORS[(i * 3 + 1) % KART_COLORS.length].id, horn: HORN_KINDS[i % HORN_KINDS.length], score: 0,
  }));
  let loop = null;
  let lastTick = 0;
  let lastSnap = 0;
  let destroyed = false;
  const lastSocial = new Map(); // anti-spam klaxon / emotes

  // ------------------------------------------------------------ état envoyé aux joueurs

  function publicPlayers() {
    return [...players.values()].map((p) => ({
      id: p.id, name: p.name, vehicle: p.vehicle, color: p.color, horn: p.horn, team: p.team,
      score: p.score, isHost: p.isHost, connected: p.connected,
    }));
  }

  function stateFor(pid) {
    return {
      code,
      phase,
      you: pid,
      hostId,
      settings: { ...settings },
      players: publicPlayers(),
      bots: bots.map((b) => ({ id: b.id, name: b.name, vehicle: b.vehicle, color: b.color, score: b.score })),
      game: game ? { ...game.info(), startIn: game.startAt == null ? null : game.startAt - now(), results: game.results || null } : null,
    };
  }

  function broadcast() {
    for (const p of players.values()) if (p.connected) send(p.id, 'state', stateFor(p.id));
  }

  function event(ev) {
    for (const p of players.values()) if (p.connected) send(p.id, 'ev', ev);
  }

  function sendSnap(snap) {
    for (const p of players.values()) if (p.connected) send(p.id, 'snap', snap);
  }

  // ------------------------------------------------------------ partie

  const ctx = {
    now, rand, settings, players, bots, event, sendSnap, broadcast,
    get skill() { return [0.45, 0.65, 0.85][settings.difficulty - 1] ?? 0.65; },
    humans: () => [...players.values()].filter((p) => p.connected),
    // Fin de partie : rows triées du premier au dernier [{ id, name, vehicle, isBot, ... }].
    // points : barème optionnel par ligne (sinon 15, 12, 10...).
    finish(rows) {
      if (!game || game.results) return;
      game.results = rows.map((r, i) => {
        const pts = r.points ?? POINTS[i] ?? 0;
        let total = 0;
        if (r.isBot) {
          const b = bots.find((x) => x.id === r.id);
          if (b) total = b.score += pts;
        } else {
          const p = players.get(r.id);
          if (p) total = p.score += pts;
        }
        return { ...r, rank: r.rank ?? i + 1, points: pts, total };
      });
      phase = 'results';
      stopLoop();
      broadcast();
    },
  };

  function startGame() {
    const id = ++gameSeq;
    game = settings.mode === 'race' ? createRaceGame(ctx, id) : createArenaGame(ctx, id, settings.mode);
    game.createdAt = now();
    game.startAt = null;
    phase = 'game';
    startLoop();
    broadcast();
  }

  function tick() {
    if (!game || destroyed) return;
    const t = now();
    let dt = (t - lastTick) / 1000;
    lastTick = t;
    if (dt > 0.25) dt = 0.25;

    // Chargement : tous prêts (ou délai dépassé) -> compte à rebours.
    if (game.startAt == null) {
      const need = game.humanIds().filter((id) => players.get(id)?.connected);
      if (need.every((id) => game.loaded.has(id)) || t - game.createdAt > LOAD_TIMEOUT) {
        game.startAt = t + COUNTDOWN;
        broadcast();
      }
      return;
    }
    game.tick(t, dt);
    if (game && !game.results && t - lastSnap >= SNAP_EVERY) {
      lastSnap = t;
      sendSnap(game.snapshot(t));
    }
  }

  // opts.ticker(fn, ms) -> stop() : horloge fournie par l'appelant (worker dans le navigateur).
  const ticker = opts.ticker || ((fn, ms) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  });

  function startLoop() {
    stopLoop();
    lastTick = now();
    loop = ticker(tick, 1000 / 60);
  }

  function stopLoop() {
    if (loop) loop();
    loop = null;
  }

  // ------------------------------------------------------------ requêtes

  const handlers = {
    join(pid, p) {
      if (players.has(pid)) {
        players.get(pid).connected = true;
        broadcast();
        return { ok: true, id: pid };
      }
      const connected = [...players.values()].filter((x) => x.connected).length;
      if (connected >= MAX_KARTS) return { error: 'La partie est pleine (8 pilotes).' };
      const isHost = hostId == null;
      if (isHost) hostId = pid;
      const vehicle = VEHICLES.some((v) => v.id === p?.vehicle) ? p.vehicle : VEHICLES[players.size % 5].id;
      players.set(pid, {
        id: pid, name: cleanName(p?.name), vehicle, color: cleanColor(p?.color),
        horn: HORN_KINDS.includes(p?.horn) ? p.horn : 'classique', team: 'auto',
        score: 0, isHost, connected: true,
      });
      broadcast();
      return { ok: true, id: pid };
    },

    vehicle(pid, p) {
      const pl = players.get(pid);
      if (!pl || !VEHICLES.some((v) => v.id === p?.id)) return { error: 'Véhicule inconnu.' };
      pl.vehicle = p.id;
      broadcast();
      return { ok: true };
    },

    // Couleur, klaxon, équipe.
    profile(pid, p) {
      const pl = players.get(pid);
      if (!pl) return { ok: false };
      if (p.color) pl.color = cleanColor(p.color);
      if (HORN_KINDS.includes(p.horn)) pl.horn = p.horn;
      if (['auto', 'blue', 'orange'].includes(p.team)) pl.team = p.team;
      broadcast();
      return { ok: true };
    },

    settings(pid, p) {
      if (pid !== hostId) return { error: "Seul l'hôte règle la partie." };
      if (phase === 'game') return { error: 'Partie en cours.' };
      if (MODES.includes(p.mode)) settings.mode = p.mode;
      if (p.track && (p.track === 'random' || TRACKS.some((t) => t.id === p.track))) settings.track = p.track;
      if (p.laps) settings.laps = Math.max(1, Math.min(7, p.laps | 0));
      if (p.cc && CC_CLASSES[p.cc]) settings.cc = +p.cc;
      for (const k of ['bots', 'items', 'powers', 'chaos']) if (typeof p[k] === 'boolean') settings[k] = p[k];
      if (p.difficulty) settings.difficulty = Math.max(1, Math.min(3, p.difficulty | 0));
      if (p.teamSize) settings.teamSize = Math.max(1, Math.min(4, p.teamSize | 0));
      if (p.matchTime) settings.matchTime = Math.max(1, Math.min(10, p.matchTime | 0));
      if (p.balloons) settings.balloons = Math.max(1, Math.min(5, p.balloons | 0));
      broadcast();
      return { ok: true };
    },

    start(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte lance la partie." };
      if (phase === 'game') return { error: 'Partie déjà lancée.' };
      startGame();
      return { ok: true };
    },

    lobby(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte peut faire ça." };
      if (game && !game.results) game.forceEnd?.();
      phase = 'lobby';
      game = null;
      stopLoop();
      broadcast();
      return { ok: true };
    },

    resetScores(pid) {
      if (pid !== hostId) return { error: "Seul l'hôte peut faire ça." };
      for (const p of players.values()) p.score = 0;
      for (const b of bots) b.score = 0;
      broadcast();
      return { ok: true };
    },

    loaded(pid, p) {
      if (!game || p?.game !== game.id) return { ok: false };
      game.loaded.add(pid);
      return { ok: true, startIn: game.startAt == null ? null : game.startAt - now() };
    },

    horn(pid) {
      const t = now();
      if (t - (lastSocial.get(`h${pid}`) || 0) < 900) return { ok: false };
      lastSocial.set(`h${pid}`, t);
      event({ type: 'horn', id: pid, kind: players.get(pid)?.horn || 'classique' });
      return { ok: true };
    },

    emote(pid, p) {
      const t = now();
      if (!EMOTES.includes(p?.e) || t - (lastSocial.get(`e${pid}`) || 0) < 700) return { ok: false };
      lastSocial.set(`e${pid}`, t);
      event({ type: 'emote', id: pid, e: p.e });
      return { ok: true };
    },

    leave(pid) {
      disconnect(pid, true);
      return { ok: true };
    },
  };

  function handle(pid, ev, payload) {
    if (destroyed) return { error: 'Partie terminée.' };
    if (ev !== 'join' && !players.has(pid)) return { error: 'Rejoins la partie d’abord.' };
    try {
      if (handlers[ev]) return handlers[ev](pid, payload || {});
      // Actions propres au mode en cours (boîtes, objets, ballon, pouvoirs...).
      const fn = game && !game.results && game.handlers[ev];
      if (fn) return fn(pid, payload || {});
      return { error: 'Action inconnue.' };
    } catch (err) {
      console.error('[room]', ev, err);
      return { error: 'Erreur interne.' };
    }
  }

  // Position envoyée en continu par un pilote humain.
  function kart(pid, st) {
    if (!game || !st || game.results) return;
    game.kart(pid, st);
  }

  function disconnect(pid, left) {
    const p = players.get(pid);
    if (!p) return;
    if (game) game.disconnect(pid);
    if (left || phase === 'lobby') players.delete(pid);
    else p.connected = false;
    broadcast();
  }

  function destroy() {
    destroyed = true;
    stopLoop();
  }

  return {
    code,
    config: { maxPlayers: MAX_KARTS },
    handle,
    kart,
    disconnect,
    destroy,
    // Pour les tests.
    get game() { return game; },
    get phase() { return phase; },
  };
}
