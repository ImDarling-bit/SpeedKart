// Transport pair-à-pair (WebRTC via PeerJS), sur le modèle de BlindYourFriends.
// L'hôte fait tourner le moteur (room.js) ; chaque ami ouvre un canal direct vers lui.
// Les deux côtés exposent la même interface :
//   emit(event, payload, ack)  requête avec réponse (salon, objets, arrivée...)
//   sendKart(state)            position du kart, envoyée en continu sans réponse
//   on('state' | 'snap' | 'ev' | 'closed' | 'disconnect' | 'reconnect', fn)

import { createRoom, makeCode } from './room.js';

const cfg = window.SK_CONFIG || {};
const PREFIX = 'speedkart-'; // id PeerJS de l'hôte = préfixe + code de la partie
const LOCAL_ID = 'host';
const PING_EVERY = 3000;
const DEAD_AFTER = 12000;
const ACK_TIMEOUT = 12000;
const RECONNECT_FOR = 30000;
const EVENTS = new Set([
  'join', 'vehicle', 'profile', 'settings', 'start', 'lobby', 'resetScores', 'loaded', 'leave', 'horn', 'emote',
  'box', 'use', 'hit', 'bump', 'finish', 'power', 'touch', 'pad', 'down',
  'arrest', 'bag', 'deposit', 'free', 'escape', 'gadget',
]);

class Emitter {
  constructor() { this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); return this; }
  off(ev, fn) { this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn); }
  fire(ev, ...args) { (this.handlers[ev] || []).forEach((fn) => fn(...args)); }
}

function peerOptions() {
  const o = { debug: 1, config: { iceServers: cfg.iceServers || [] } };
  return Object.assign(o, cfg.peerServer || {});
}

// Ouvre un Peer (id imposé ou aléatoire) et attend son enregistrement auprès du serveur.
function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
    const onOpen = () => { cleanup(); resolve(peer); };
    const onError = (err) => { cleanup(); peer.destroy(); reject(err); };
    function cleanup() { peer.off('open', onOpen); peer.off('error', onError); }
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

// Garde l'hôte joignable par les nouveaux arrivants si le serveur de mise en relation décroche.
function keepRegistered(peer) {
  peer.on('disconnected', () => {
    setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
  });
  peer.on('error', (err) => console.warn('[peer]', err.type, err.message));
}

function randomId() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

// ---------------------------------------------------------------- hôte

// Minuteur qui continue à battre quand l'onglet de l'hôte passe en arrière-plan (voir ticker.js).
function workerTicker(fn, ms) {
  let worker = null;
  try {
    worker = new Worker(new URL('./ticker.js', import.meta.url));
  } catch (_) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
  worker.onmessage = fn;
  worker.postMessage(ms);
  return () => worker.terminate();
}

// Le joueur hôte parle directement au moteur, sans réseau.
class LocalSocket extends Emitter {
  constructor() { super(); this.room = null; }
  emit(event, payload, ack) {
    // Asynchrone comme sur le réseau, pour garder le même ordre d'exécution partout.
    queueMicrotask(() => {
      const res = this.room.handle(LOCAL_ID, event, payload);
      if (ack) ack(res);
    });
  }
  sendKart(state) { this.room.kart(LOCAL_ID, state); }
}

// online : false pour une partie solo contre les bots, sans connexion internet.
export async function hostGame({ online = true } = {}) {
  let peer = null;
  let code = makeCode();
  if (online) {
    for (let i = 0; i < 6 && !peer; i++) {
      code = makeCode();
      try {
        peer = await openPeer(PREFIX + code);
      } catch (err) {
        if (err.type !== 'unavailable-id') throw err; // code déjà pris ailleurs : on en tire un autre
      }
    }
    if (!peer) throw new Error('Aucun code libre, réessaie.');
    keepRegistered(peer);
  }

  const local = new LocalSocket();
  const conns = new Map(); // playerId -> { conn, lastSeen }
  const room = createRoom({
    code,
    ticker: workerTicker,
    send(pid, type, payload) {
      if (pid === LOCAL_ID) return local.fire(type, payload);
      const c = conns.get(pid);
      if (c && c.conn.open) c.conn.send({ t: type, p: payload });
    },
  });
  local.room = room;

  function drop(pid) {
    const c = conns.get(pid);
    if (!c) return;
    conns.delete(pid);
    try { c.conn.close(); } catch (_) { /* déjà fermée */ }
    room.disconnect(pid);
  }

  if (peer) {
    peer.on('connection', (conn) => {
      if (conns.size >= room.config.maxPlayers) {
        conn.on('open', () => { conn.send({ t: 'closed', p: 'La partie est pleine.' }); setTimeout(() => conn.close(), 200); });
        return;
      }
      const pid = `p${randomId()}`;
      const entry = { conn, lastSeen: Date.now() };
      conn.on('open', () => { conns.set(pid, entry); });
      conn.on('data', (msg) => {
        entry.lastSeen = Date.now();
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'k') return room.kart(pid, msg.p);
        if (msg.t === 'ping') return conn.send({ t: 'pong' });
        if (msg.t !== 'req' || !EVENTS.has(msg.ev)) return;
        const res = room.handle(pid, msg.ev, msg.p);
        if (conn.open) conn.send({ t: 'ack', id: msg.id, p: res });
        if (msg.ev === 'leave') drop(pid);
      });
      conn.on('close', () => drop(pid));
      conn.on('error', () => drop(pid));
    });
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [pid, c] of conns) {
      if (now - c.lastSeen > DEAD_AFTER) drop(pid);
      else if (c.conn.open) c.conn.send({ t: 'ping' });
    }
  }, PING_EVERY);

  let closed = false;
  function close(reason) {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const c of conns.values()) {
      try { c.conn.send({ t: 'closed', p: reason || "L'hôte a fermé la partie." }); } catch (_) { /* ignore */ }
    }
    room.destroy();
    // Laisse partir les derniers messages avant de tout couper.
    if (peer) setTimeout(() => peer.destroy(), 300);
  }
  window.addEventListener('pagehide', () => close());

  return { code, socket: local, isHost: true, online, close };
}

// ---------------------------------------------------------------- invité

class RemoteSocket extends Emitter {
  constructor(code) {
    super();
    this.code = code;
    this.peer = null;
    this.conn = null;
    this.seq = 0;
    this.pending = new Map(); // id -> { ack, timer }
    this.lastSeen = 0;
    this.closed = false;
    this.reconnecting = false;
    this.watchdog = setInterval(() => this.checkAlive(), PING_EVERY);
  }

  async connect() {
    if (this.peer) this.peer.destroy();
    this.peer = await openPeer();
    if (this.closed) return this.peer.destroy();
    keepRegistered(this.peer);
    const peer = this.peer;

    const conn = await new Promise((resolve, reject) => {
      const c = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => fail(Object.assign(new Error('timeout'), { type: 'timeout' })), 12000);
      const onPeerError = (err) => { if (err.type === 'peer-unavailable') fail(err); };
      function fail(err) {
        clearTimeout(timer);
        peer.off('error', onPeerError);
        try { c.close(); } catch (_) { /* ignore */ }
        reject(err);
      }
      peer.on('error', onPeerError);
      c.on('open', () => {
        clearTimeout(timer);
        peer.off('error', onPeerError);
        resolve(c);
      });
    });

    this.conn = conn;
    this.lastSeen = Date.now();
    conn.on('data', (msg) => this.onData(msg));
    conn.on('close', () => { if (this.conn === conn) this.lost(); });
  }

  onData(msg) {
    this.lastSeen = Date.now();
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'snap': return this.fire('snap', msg.p);
      case 'ev': return this.fire('ev', msg.p);
      case 'state': return this.fire('state', msg.p);
      case 'ping': return this.conn && this.conn.send({ t: 'pong' });
      case 'ack': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        return p.ack && p.ack(msg.p);
      }
      case 'closed':
        this.close();
        return this.fire('closed', msg.p);
      default:
    }
  }

  emit(event, payload, ack) {
    if (!this.conn || !this.conn.open) return ack && ack({ error: 'Connexion en cours, réessaie.' });
    const id = ++this.seq;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      if (ack) ack({ error: "L'hôte ne répond pas." });
    }, ACK_TIMEOUT);
    this.pending.set(id, { ack, timer });
    this.conn.send({ t: 'req', id, ev: event, p: payload });
  }

  sendKart(state) {
    if (this.conn && this.conn.open) this.conn.send({ t: 'k', p: state });
  }

  checkAlive() {
    if (this.closed || this.reconnecting || !this.conn) return;
    if (Date.now() - this.lastSeen > DEAD_AFTER) this.lost();
    else if (this.conn.open) this.conn.send({ t: 'ping' });
  }

  failPending(message) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      if (p.ack) p.ack({ error: message });
    }
    this.pending.clear();
  }

  async lost() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const old = this.conn;
    this.conn = null;
    try { old && old.close(); } catch (_) { /* ignore */ }
    this.failPending('Connexion perdue.');
    this.fire('disconnect');

    const deadline = Date.now() + RECONNECT_FOR;
    while (!this.closed && Date.now() < deadline) {
      try {
        await this.connect();
        if (this.closed) return;
        this.reconnecting = false;
        return this.fire('reconnect');
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (this.closed) return;
    this.close();
    this.fire('closed', "Connexion perdue avec l'hôte.");
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.failPending('Partie quittée.');
    try { this.conn && this.conn.close(); } catch (_) { /* ignore */ }
    if (this.peer) this.peer.destroy();
  }
}

export async function joinGame(code) {
  const socket = new RemoteSocket(code);
  try {
    await socket.connect();
  } catch (err) {
    socket.close();
    if (err.type === 'peer-unavailable') throw new Error('Partie introuvable. Vérifie le code.');
    if (err.type === 'timeout') throw new Error("L'hôte ne répond pas. Réessaie.");
    throw new Error('Connexion impossible. Vérifie ta connexion internet.');
  }
  window.addEventListener('pagehide', () => {
    socket.emit('leave');
    socket.close();
  });
  return { code, socket, isHost: false, online: true, close: () => socket.close() };
}
