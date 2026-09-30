// Interface : accueil, salon (véhicule, circuit, réglages), course, résultats.

import * as THREE from './three.js';
import { hostGame, joinGame } from './net.js';
import { Race } from './race.js';
import { TRACKS, trackById } from './data/tracks.js';
import { THEMES } from './data/themes.js';
import { VEHICLES, vehicleById } from './data/vehicles.js';
import { TrackPath } from './track.js';
import { instance } from './assets.js';
import { unlock, sfx, setVolume, getVolume } from './audio.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);
const cfg = window.SK_CONFIG || {};
const STAT_LABELS = { speed: 'Vitesse', accel: 'Accélération', handling: 'Maniabilité', weight: 'Poids' };
const CATS = [...new Set(VEHICLES.map((v) => v.cat))];

let game = null; // { code, socket, isHost, online, close }
let state = null;
let race = null;
let renderer = null;
let myVehicle = localStorage.getItem('sk-vehicle') || VEHICLES[0].id;
let vehicleCat = vehicleById(myVehicle).cat;

function store(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* navigation privée */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  document.body.dataset.screen = id;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function request(ev, payload) {
  return new Promise((resolve) => {
    game.socket.emit(ev, payload, (res) => {
      if (res && res.error) toast(res.error);
      resolve(res);
    });
  });
}

// ------------------------------------------------------------ accueil

function initHome() {
  const name = $('nameInput');
  name.value = localStorage.getItem('sk-name') || '';
  const params = new URLSearchParams(location.search);
  if (params.get('code')) $('codeInput').value = params.get('code').toUpperCase().slice(0, 4);

  const start = async (fn, label) => {
    unlock();
    sfx.click();
    const pseudo = name.value.trim();
    if (!pseudo) { $('homeError').textContent = 'Choisis un pseudo.'; name.focus(); return; }
    store('sk-name', pseudo);
    $('homeError').textContent = '';
    $('homeStatus').textContent = label;
    document.querySelectorAll('#screen-home button').forEach((b) => { b.disabled = true; });
    try {
      game = await fn();
      bindSocket();
      const res = await request('join', { name: pseudo, vehicle: myVehicle });
      if (res && res.error) throw new Error(res.error);
      if (game.code && game.online) history.replaceState(null, '', `?code=${game.code}`);
    } catch (err) {
      if (game) game.close();
      game = null;
      $('homeError').textContent = err.message || 'Connexion impossible.';
    } finally {
      $('homeStatus').textContent = '';
      document.querySelectorAll('#screen-home button').forEach((b) => { b.disabled = false; });
    }
  };

  $('soloBtn').onclick = () => start(() => hostGame({ online: false }), 'Préparation...');
  $('createBtn').onclick = () => start(() => hostGame({ online: true }), 'Création de la partie...');
  const join = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeError').textContent = 'Le code fait 4 lettres.'; return; }
    start(() => joinGame(code), 'Connexion à l’hôte...');
  };
  $('joinBtn').onclick = join;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
}

function bindSocket() {
  const s = game.socket;
  s.on('state', onState);
  s.on('snap', (snap) => race && race.onSnap(snap));
  s.on('ev', (ev) => race && race.onEv(ev));
  s.on('disconnect', () => toast('Connexion perdue, reconnexion...'));
  s.on('reconnect', () => {
    toast('Reconnecté !');
    game.socket.emit('join', { name: localStorage.getItem('sk-name'), vehicle: myVehicle });
  });
  s.on('closed', (reason) => leave(reason || 'La partie est terminée.'));
}

function leave(reason) {
  if (race) { race.dispose(); race = null; }
  if (game) {
    try { game.socket.emit('leave'); } catch (_) { /* ignore */ }
    game.close();
  }
  game = null;
  state = null;
  history.replaceState(null, '', location.pathname);
  show('screen-home');
  if (reason) $('homeError').textContent = reason;
}

// ------------------------------------------------------------ routage selon l'état

function onState(s) {
  state = s;
  if (s.phase === 'race' && s.race) {
    if (!race || race.info.id !== s.race.id) startRace(s);
    else race.onState(s);
    return;
  }
  if (race) { race.dispose(); race = null; }
  if (s.phase === 'results') renderResults();
  else renderLobby();
}

async function startRace(s) {
  if (race) race.dispose();
  show('screen-race');
  $('hudLoading').classList.remove('hidden');
  $('hudLoadBar').style.width = '0%';
  $('hudLoadText').textContent = `${trackById(s.race.track).name}`;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const r = new Race({ renderer, socket: game.socket, state: s, onQuit: () => leave() });
  race = r;
  window.SK_DEBUG = { renderer, race: r }; // inspection depuis la console
  try {
    await r.load((p) => { $('hudLoadBar').style.width = `${Math.round(p * 100)}%`; });
  } catch (err) {
    console.error(err);
    toast('Erreur de chargement du circuit.');
  }
  if (race !== r) return; // course remplacée pendant le chargement
  $('hudLoading').classList.add('hidden');
  r.begin();
  if (state && state.race && state.race.startIn != null) r.setStart(state.race.startIn);
}

// ------------------------------------------------------------ salon

function renderLobby() {
  show('screen-lobby');
  const s = state;
  const me = s.players.find((p) => p.id === s.you);
  const isHost = s.hostId === s.you;
  document.body.classList.toggle('is-host', isHost);

  $('lobbyCode').textContent = game.online ? s.code : 'SOLO';
  $('inviteRow').classList.toggle('hidden', !game.online);
  if (game.online) $('inviteLink').value = inviteUrl(s.code);

  // Joueurs.
  $('lobbyPlayers').innerHTML = s.players.map((p) => {
    const v = vehicleById(p.vehicle);
    return `<li class="${p.id === s.you ? 'me' : ''}">
      <span class="pl-name">${p.isHost ? '<span class="crown" title="Hôte">👑</span>' : ''}${escapeHtml(p.name)}</span>
      <span class="pl-veh">${escapeHtml(v.name)}</span>
      <span class="pl-score">${p.score} pts</span></li>`;
  }).join('');
  $('lobbyCount').textContent = `${s.players.length}/8`;

  // Championnat (si des points ont été marqués).
  const standings = [...s.players.map((p) => ({ ...p, bot: false })), ...s.bots.map((b) => ({ ...b, bot: true }))]
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  $('standingsCard').classList.toggle('hidden', standings.length === 0);
  $('standings').innerHTML = standings.map((p, i) => `<li class="${p.id === s.you ? 'me' : ''}"><b>${i + 1}</b><span>${escapeHtml(p.name)}${p.bot ? ' <small>bot</small>' : ''}</span><em>${p.score} pts</em></li>`).join('');

  if (me && me.vehicle !== myVehicle) { myVehicle = me.vehicle; }
  renderVehicles();
  renderSettings(isHost);
  $('startBtn').classList.toggle('hidden', !isHost);
  $('lobbyHint').textContent = isHost ? '' : "L'hôte choisit le circuit et lance la course.";
}

function inviteUrl(code) {
  const base = cfg.publicUrl || lanUrl || `${location.origin}${location.pathname}`;
  return `${base}${base.includes('?') ? '&' : '?'}code=${code}`;
}

let lanUrl = null;
fetch('api/lan').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.url && /localhost|127\.0\.0\.1/.test(location.hostname)) lanUrl = j.url; }).catch(() => {});

function renderVehicles() {
  $('vehCats').innerHTML = CATS.map((c) => `<button class="chip ${c === vehicleCat ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('');
  $('vehGrid').innerHTML = VEHICLES.filter((v) => v.cat === vehicleCat).map((v) => `
    <button class="veh ${v.id === myVehicle ? 'on' : ''}" data-veh="${v.id}">
      <img src="assets/previews/${v.id}.png" alt="" onerror="this.remove()">
      <span>${escapeHtml(v.name)}</span>
    </button>`).join('');
  const v = vehicleById(myVehicle);
  $('vehName').textContent = v.name;
  $('vehCat').textContent = v.cat;
  $('vehStats').innerHTML = Object.entries(v.stats).map(([k, n]) => `
    <div class="stat"><span>${STAT_LABELS[k]}</span><div class="bar">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
  preview.show(v);
}

function renderSettings(isHost) {
  const st = state.settings;
  const cards = [...TRACKS.map((t) => t.id), 'random'];
  $('trackGrid').innerHTML = cards.map((id) => {
    if (id === 'random') {
      return `<button class="track ${st.track === 'random' ? 'on' : ''}" data-track="random" ${isHost ? '' : 'disabled'}>
        <div class="track-map random">?</div><div class="track-name">Aléatoire</div><div class="track-diff">Surprise !</div></button>`;
    }
    const t = trackById(id);
    return `<button class="track ${st.track === id ? 'on' : ''}" data-track="${id}" ${isHost ? '' : 'disabled'} title="${escapeHtml(t.desc)}">
      <div class="track-map"><img src="${trackThumb(t)}" alt=""></div>
      <div class="track-name">${escapeHtml(t.name)}</div>
      <div class="track-diff">${'★'.repeat(t.difficulty)}${'☆'.repeat(5 - t.difficulty)}</div></button>`;
  }).join('');
  const sel = st.track === 'random' ? null : trackById(st.track);
  $('trackDesc').textContent = sel ? sel.desc : 'Un circuit tiré au sort parmi les 12.';

  const opt = (group, value) => document.querySelectorAll(`[data-set="${group}"]`).forEach((b) => {
    b.classList.toggle('on', String(b.dataset.value) === String(value));
    b.disabled = !isHost;
  });
  opt('laps', st.laps);
  opt('cc', st.cc);
  opt('difficulty', st.difficulty);
  opt('bots', st.bots);
  opt('items', st.items);
}

// Mini-carte d'un circuit (vue du dessus) pour les vignettes du salon.
const thumbs = new Map();
function trackThumb(def) {
  if (thumbs.has(def.id)) return thumbs.get(def.id);
  const T = new TrackPath(def);
  const theme = THEMES[def.theme];
  const c = document.createElement('canvas');
  c.width = 220;
  c.height = 140;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 140);
  grad.addColorStop(0, theme.sky[0]);
  grad.addColorStop(1, theme.ground || theme.sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 220, 140);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < T.n; i++) {
    minX = Math.min(minX, T.px[i]); maxX = Math.max(maxX, T.px[i]);
    minZ = Math.min(minZ, T.pz[i]); maxZ = Math.max(maxZ, T.pz[i]);
  }
  const k = Math.min(190 / (maxX - minX), 110 / (maxZ - minZ));
  const ox = (220 - (maxX - minX) * k) / 2;
  const oz = (140 - (maxZ - minZ) * k) / 2;
  const xy = (i) => [220 - (ox + (T.px[i] - minX) * k), oz + (T.pz[i] - minZ) * k];
  const path = () => {
    g.beginPath();
    for (let i = 0; i <= T.n; i++) {
      const [x, y] = xy(i % T.n);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
  };
  g.lineJoin = 'round';
  path(); g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 9; g.stroke();
  path(); g.strokeStyle = theme.road.rainbow ? '#ffffff' : '#f7f7f7'; g.lineWidth = 5; g.stroke();
  if (theme.road.rainbow) { path(); g.strokeStyle = '#ff5fd2'; g.lineWidth = 2; g.stroke(); }
  const [sx, sy] = xy(0);
  g.fillStyle = '#e8413c';
  g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill();
  const url = c.toDataURL();
  thumbs.set(def.id, url);
  return url;
}

function initLobby() {
  $('vehCats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    vehicleCat = b.dataset.cat;
    sfx.click();
    renderVehicles();
  });
  $('vehGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-veh]');
    if (!b) return;
    myVehicle = b.dataset.veh;
    store('sk-vehicle', myVehicle);
    sfx.click();
    renderVehicles();
    request('vehicle', { id: myVehicle });
  });
  $('trackGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-track]');
    if (!b || b.disabled) return;
    sfx.click();
    request('settings', { track: b.dataset.track });
  });
  document.querySelectorAll('[data-set]').forEach((b) => {
    b.addEventListener('click', () => {
      sfx.click();
      let v = b.dataset.value;
      if (v === 'true' || v === 'false') v = v === 'true';
      else v = Number(v);
      request('settings', { [b.dataset.set]: v });
    });
  });
  $('startBtn').onclick = () => { unlock(); sfx.click(); request('start'); };
  $('shareBtn').onclick = async () => {
    const url = $('inviteLink').value;
    try {
      if (navigator.share) await navigator.share({ title: 'SpeedKart', text: `Viens faire la course ! Code ${state.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
    } catch (_) { /* partage annulé */ }
  };
  document.querySelectorAll('[data-action="leave"]').forEach((b) => { b.onclick = () => leave(); });
  $('resetScoresBtn').onclick = () => request('resetScores');
}

// ------------------------------------------------------------ résultats

function renderResults() {
  show('screen-results');
  const s = state;
  const res = s.race?.results || [];
  const isHost = s.hostId === s.you;
  const t = trackById(s.race.track);
  $('resTrack').textContent = t.name;
  $('resList').innerHTML = res.map((r) => `
    <li class="${r.id === s.you ? 'me' : ''} p${r.rank}">
      <b class="rk">${r.rank}</b>
      <span class="nm">${escapeHtml(r.name)}${r.isBot ? ' <small>bot</small>' : ''}<small class="vh">${escapeHtml(vehicleById(r.vehicle).name)}</small></span>
      <span class="tm">${r.time != null ? formatTime(r.time) : 'non classé'}</span>
      <span class="pt">+${r.points}</span>
      <span class="tt">${r.total} pts</span>
    </li>`).join('');
  const mine = res.find((r) => r.id === s.you);
  $('resTitle').textContent = mine ? (mine.rank === 1 ? 'Victoire !' : `${mine.rank}${mine.rank === 1 ? 'er' : 'e'} place`) : 'Résultats';
  $('resActions').classList.toggle('hidden', !isHost);
  $('resHint').textContent = isHost ? '' : "En attente de l'hôte...";
}

function initResults() {
  $('nextBtn').onclick = async () => {
    sfx.click();
    // Grand prix : on enchaîne sur le circuit suivant (sauf en aléatoire).
    if (state.settings.track !== 'random') {
      const i = TRACKS.findIndex((t) => t.id === state.race.track);
      await request('settings', { track: TRACKS[(i + 1) % TRACKS.length].id });
    }
    request('start');
  };
  $('retryBtn').onclick = () => { sfx.click(); request('settings', { track: state.race.track }).then(() => request('start')); };
  $('toLobbyBtn').onclick = () => { sfx.click(); request('lobby'); };
}

// ------------------------------------------------------------ aperçu 3D du véhicule

const preview = (() => {
  let r = null;
  let scene;
  let cam;
  let holder;
  let current = null;
  let token = 0;
  function init() {
    const canvas = $('vehPreview');
    r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    cam.position.set(0, 2.6, 8.5);
    cam.lookAt(0, 0.8, 0);
    scene.add(new THREE.HemisphereLight('#ffffff', '#443366', 1.6));
    const d = new THREE.DirectionalLight('#ffffff', 2);
    d.position.set(3, 6, 4);
    scene.add(d);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.15, 48), new THREE.MeshStandardMaterial({ color: '#2b2250', roughness: 0.4 }));
    disc.position.y = -0.08;
    scene.add(disc);
    holder = new THREE.Group();
    scene.add(holder);
    const loop = () => {
      requestAnimationFrame(loop);
      if (document.body.dataset.screen !== 'screen-lobby') return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.floor(w * r.getPixelRatio()) || canvas.height !== Math.floor(h * r.getPixelRatio())) {
        r.setSize(w, h, false);
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
      }
      holder.rotation.y += 0.012;
      r.render(scene, cam);
    };
    loop();
  }
  return {
    async show(v) {
      if (!r) init();
      if (current === v.id) return;
      current = v.id;
      const my = ++token;
      const obj = await instance(v.model, { length: Math.min(4.2, v.len * 1.25) });
      if (my !== token) return;
      holder.clear();
      holder.add(obj);
    },
  };
})();

// ------------------------------------------------------------ divers

function initMisc() {
  const range = $('volumeRange');
  range.value = Math.round(getVolume() * 100);
  range.oninput = () => setVolume(range.value / 100);
  $('helpBtn').onclick = () => $('helpModal').classList.remove('hidden');
  $('helpClose').onclick = () => $('helpModal').classList.add('hidden');
  $('helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal') $('helpModal').classList.add('hidden'); });
  $('quitRaceBtn').onclick = () => {
    if (confirmQuit()) leave();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('helpModal').classList.contains('hidden')) $('helpModal').classList.add('hidden');
  });
}

// Pas de boîte de dialogue bloquante : un second clic dans les 3 s confirme.
let quitArmed = 0;
function confirmQuit() {
  if (Date.now() - quitArmed < 3000) return true;
  quitArmed = Date.now();
  toast(game && game.isHost ? 'Clique encore pour quitter (la partie s’arrêtera pour tous).' : 'Clique encore pour quitter la course.');
  return false;
}

initHome();
initLobby();
initResults();
initMisc();
show('screen-home');
