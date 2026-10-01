// Interface : écran titre, salon en 4 étapes (mode, véhicule, carte, salle), partie, résultats
// sur podium, menu pause, paramètres.

import * as THREE from './three.js';
import { hostGame, joinGame } from './net.js';
import { Race } from './race.js';
import { ArenaPlay } from './arenaplay.js';
import { CopsPlay } from './copsplay.js';
import { TRACKS, trackById } from './data/tracks.js';
import { THEMES } from './data/themes.js';
import { VEHICLES, vehicleById } from './data/vehicles.js';
import { KART_COLORS, colorHex, TEAM_COLORS } from './data/colors.js';
import { HORN_KINDS } from './data/social.js';
import { CITIES, cityById } from './city.js';
import { COPS_RULES } from './modes/copsgame.js';
import { TrackPath } from './track.js';
import { instance } from './assets.js';
import { createTitleScene } from './title.js';
import { showPodium } from './podium.js';
import { getSettings, setSetting, onSettings, ACTIONS, keysFor, bindKey, resetKeys, keyLabel, applyRenderer } from './settings.js';
import { unlock, sfx, horn, HORN_NAMES, setVolume, getVolume, setEngineVolume, getEngineVolume } from './audio.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);
const cfg = window.SK_CONFIG || {};
const STAT_LABELS = { speed: 'Vitesse', accel: 'Accélération', handling: 'Maniabilité', weight: 'Poids' };
const CATS = [...new Set(VEHICLES.map((v) => v.cat))];
const STEPS = ['mode', 'vehicle', 'map', 'room'];
const MODES = {
  race: { name: 'Course', icon: '🏁', bg: 'linear-gradient(135deg,#2fd0ff,#0a3a5c)', desc: '14 circuits avec loopings, objets, dérapages. Pouvoirs et physique tamponneuse en option.', tag: '1 à 8 pilotes', start: 'Lancer la course' },
  cops: { name: 'Police / Voleurs', icon: '🚓', bg: 'linear-gradient(135deg,#3b82ff,#ff3b3b)', desc: 'Quatre règles dans trois villes. Les rôles tournent à chaque manche.', tag: '2 à 8 joueurs', start: 'Lancer la poursuite' },
  rocket: { name: 'Foot turbo', icon: '⚽', bg: 'linear-gradient(135deg,#3b82ff,#ff8a1f)', desc: 'Façon Rocket League : saut, double saut, turbo, murs. Bleus contre Orange.', tag: '1c1 à 4c4', start: 'Coup d’envoi' },
  bumper: { name: 'Tamponneuses', icon: '💥', bg: 'linear-gradient(135deg,#ff4fa3,#5a2a8a)', desc: 'Éjecte ou retourne les autres. La gravité change toutes les 14 s.', tag: 'Chacun pour soi', start: 'Lancer les tamponneuses' },
  battle: { name: 'Bataille de ballons', icon: '🎈', bg: 'linear-gradient(135deg,#ff4d6d,#ffd23f)', desc: 'Crève les ballons des autres avec tes objets. Dernier debout gagne.', tag: 'Chacun pour soi', start: 'Lancer la bataille' },
};
const ARENA_INFO = {
  rocket: { icon: '⚽', name: 'Stade Turbo', text: 'Le terrain grandit avec le nombre de joueurs. Roule sur les murs, saute deux fois pour une figure, et vise les pastilles orange pour remplir ton turbo.' },
  bumper: { icon: '💥', name: 'Plateau Tamponneur', text: 'Une plateforme flottante sans barrières, qui grandit avec le nombre de joueurs. +1 par adversaire retourné, +2 par éjection.' },
  battle: { icon: '🎈', name: 'Arène des Ballons', text: 'Enceinte avec plateau central, rampes et piliers. Ramasse les boîtes pour avoir des objets.' },
};
const TIPS = [
  'Maintiens le dérapage dans les virages : bleu, orange puis violet, relâche pour un mini-turbo.',
  'Prends le tapis orange avant un looping, sinon tu n’auras pas l’élan pour passer en haut.',
  'Au foot, saute deux fois en tenant une direction pour une figure qui frappe fort.',
  'En voleur, la police ne te voit sur sa carte que de près… sauf quand elle allume la sirène.',
  'Échap (ou Start sur la manette) ouvre le menu pause. La partie continue pour les autres.',
  'Les touches se changent dans Paramètres → Commandes.',
  'Les karts lourds poussent les légers ; les légers tournent et accélèrent mieux.',
  'Klaxon : H. Emotes : 1 à 6.',
];

let game = null; // { code, socket, isHost, online, close }
let state = null;
let play = null;
let renderer = null;
let podium = null;
let step = 'mode';
let myVehicle = localStorage.getItem('sk-vehicle') || VEHICLES[0].id;
let myColor = localStorage.getItem('sk-color') || 'aucune';
let myHorn = localStorage.getItem('sk-horn') || 'classique';
let vehicleCat = vehicleById(myVehicle).cat;
let title = null;

function store(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* navigation privée */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  document.body.dataset.screen = id;
  if (id === 'screen-title') { title.start(); title.show(myVehicle, colorHex(myColor)); } else title.stop();
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

const isHost = () => state && state.hostId === state.you;

// ------------------------------------------------------------ écran titre

function initTitle() {
  title = createTitleScene($('titleCanvas'));
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
    document.querySelectorAll('#screen-title button').forEach((b) => { b.disabled = true; });
    try {
      game = await fn();
      bindSocket();
      const res = await request('join', { name: pseudo, vehicle: myVehicle, color: myColor, horn: myHorn });
      if (res && res.error) throw new Error(res.error);
      if (game.code && game.online) history.replaceState(null, '', `?code=${game.code}`);
      step = game.isHost ? 'mode' : 'vehicle';
    } catch (err) {
      if (game) game.close();
      game = null;
      $('homeError').textContent = err.message || 'Connexion impossible.';
    } finally {
      $('homeStatus').textContent = '';
      document.querySelectorAll('#screen-title button').forEach((b) => { b.disabled = false; });
    }
  };

  $('soloBtn').onclick = () => start(() => hostGame({ online: false }), 'Préparation...');
  $('createBtn').onclick = () => start(() => hostGame({ online: true }), 'Création de la partie...');
  const join = () => {
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeError').textContent = 'Le code fait 4 lettres.'; $('codeInput').focus(); return; }
    start(() => joinGame(code), 'Connexion à l’hôte...');
  };
  $('joinBtn').onclick = join;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('createBtn').click(); });
}

function bindSocket() {
  const s = game.socket;
  s.on('state', onState);
  s.on('snap', (snap) => play && play.onSnap(snap));
  s.on('ev', (ev) => play && play.onEv(ev));
  s.on('disconnect', () => toast('Connexion perdue, reconnexion...'));
  s.on('reconnect', () => {
    toast('Reconnecté !');
    game.socket.emit('join', { name: localStorage.getItem('sk-name'), vehicle: myVehicle, color: myColor, horn: myHorn });
  });
  s.on('closed', (reason) => leave(reason || 'La partie est terminée.'));
}

function leave(reason) {
  closePause();
  if (play) { play.dispose(); play = null; }
  if (podium) { podium.dispose(); podium = null; }
  if (game) {
    try { game.socket.emit('leave'); } catch (_) { /* ignore */ }
    game.close();
  }
  game = null;
  state = null;
  history.replaceState(null, '', location.pathname);
  show('screen-title');
  if (reason) $('homeError').textContent = reason;
}

// ------------------------------------------------------------ routage selon l'état

function onState(s) {
  state = s;
  if (s.phase === 'game' && s.game) {
    if (podium) { podium.dispose(); podium = null; }
    if (!play || play.info.id !== s.game.id) startPlay(s);
    else play.onState(s);
    return;
  }
  if (play) { play.dispose(); play = null; closePause(); }
  if (s.phase === 'results') renderResults();
  else {
    if (podium) { podium.dispose(); podium = null; }
    renderLobby();
  }
}

function ensureRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: getSettings().quality !== 'low', powerPreference: 'high-performance' });
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  applyRenderer(renderer);
  return renderer;
}

async function startPlay(s) {
  if (play) play.dispose();
  show('screen-race');
  $('hudLoading').classList.remove('hidden');
  $('hudLoadBar').style.width = '0%';
  $('hudLoadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const m = s.game.mode;
  $('hudLoadText').textContent = m === 'race' ? trackById(s.game.track).name : m === 'cops' ? `${COPS_RULES[s.game.rule].name} · ${cityById(s.game.city).name}` : MODES[m].name;
  ensureRenderer();
  const P = m === 'race' ? Race : m === 'cops' ? CopsPlay : ArenaPlay;
  const p = new P({ renderer, socket: game.socket, state: s });
  play = p;
  window.SK_DEBUG = { renderer, play: p }; // inspection depuis la console
  try {
    await p.load((v) => { $('hudLoadBar').style.width = `${Math.round(v * 100)}%`; });
  } catch (err) {
    console.error(err);
    toast('Erreur de chargement.');
  }
  if (play !== p) return; // partie remplacée pendant le chargement
  $('hudLoading').classList.add('hidden');
  p.begin();
  if (state && state.game && state.game.startIn != null) p.setStart(state.game.startIn);
}

// ------------------------------------------------------------ salon

function renderLobby() {
  show('screen-lobby');
  const s = state;
  const host = isHost();
  document.body.classList.toggle('is-host', host);
  document.body.dataset.mode = s.settings.mode;
  $('lobbyCode').textContent = game.online ? s.code : 'SOLO';
  $('shareBtn').classList.toggle('hidden', !game.online);
  $('inviteRow').classList.toggle('hidden', !game.online);
  if (game.online) $('inviteLink').value = inviteUrl(s.code);

  renderModes(host);
  renderVehicles();
  renderProfile(s.players.find((p) => p.id === s.you));
  renderMap(host);
  renderRoom(host);
  setStep(step);
}

function setStep(id) {
  step = id;
  const host = isHost();
  document.querySelectorAll('.step').forEach((el) => el.classList.toggle('on', el.dataset.step === id));
  const i = STEPS.indexOf(id);
  document.querySelectorAll('#stepper button').forEach((b, k) => {
    b.classList.toggle('on', b.dataset.step === id);
    b.classList.toggle('done', k < i);
  });
  $('prevBtn').disabled = i === 0;
  const last = i === STEPS.length - 1;
  $('nextBtn').classList.toggle('hidden', last);
  $('startBtn').classList.toggle('hidden', !last || !host);
  if (state) $('startBtn').textContent = MODES[state.settings.mode].start;
  const hints = {
    mode: host ? 'Choisis le mode de jeu.' : 'L’hôte choisit le mode de jeu.',
    vehicle: 'Choisis ton véhicule et ta couleur.',
    map: host ? 'Choisis la carte et les réglages.' : 'L’hôte choisit la carte et les réglages.',
    room: host ? 'Tout le monde est prêt ? Lance la partie.' : 'En attente du lancement par l’hôte…',
  };
  $('lobbyHint').textContent = hints[id];
  if (id === 'vehicle') preview.start(); else preview.stop();
}

function inviteUrl(code) {
  const base = cfg.publicUrl || lanUrl || `${location.origin}${location.pathname}`;
  return `${base}${base.includes('?') ? '&' : '?'}code=${code}`;
}

let lanUrl = null;
fetch('api/lan').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.url && /localhost|127\.0\.0\.1/.test(location.hostname)) lanUrl = j.url; }).catch(() => {});

function renderModes(host) {
  const mode = state.settings.mode;
  $('modeHint').textContent = host ? '' : 'Choisi par l’hôte.';
  $('modeGrid').innerHTML = Object.entries(MODES).map(([id, M]) => `
    <button class="mode ${mode === id ? 'on' : ''}" data-mode="${id}" style="--mode-bg:${M.bg}" ${host ? '' : 'disabled'}>
      <span class="mode-icon">${M.icon}</span><span class="mode-name">${M.name}</span><span class="mode-desc">${M.desc}</span><span class="mode-tag">${M.tag}</span>
    </button>`).join('');
  const cops = mode === 'cops';
  $('copsRules').classList.toggle('hidden', !cops);
  if (cops) {
    $('copsRules').innerHTML = `<h3>Règle</h3>${Object.entries(COPS_RULES).map(([id, R]) => `
      <button class="sub ${state.settings.copsRule === id ? 'on' : ''}" data-rule="${id}" ${host ? '' : 'disabled'}><b>${R.icon} ${R.name}</b><span>${R.desc}</span></button>`).join('')}`;
  }
}

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
  preview.show(v, colorHex(myColor));
}

function renderProfile(me) {
  $('colorRow').innerHTML = KART_COLORS.map((c) => `<button class="swatch-btn ${c.id === myColor ? 'on' : ''}" data-color="${c.id}" title="${c.name}" style="${c.hex ? `background:${c.hex}` : ''}">${c.hex ? '' : '✕'}</button>`).join('');
  $('hornSelect').innerHTML = HORN_KINDS.map((h) => `<option value="${h}" ${h === myHorn ? 'selected' : ''}>${HORN_NAMES[h]}</option>`).join('');
  const team = me ? me.team : 'auto';
  document.querySelectorAll('[data-team]').forEach((b) => b.classList.toggle('on', b.dataset.team === team));
}

function renderMap(host) {
  const st = state.settings;
  const mode = st.mode;
  $('mapTitle').textContent = mode === 'race' ? 'Circuit' : mode === 'cops' ? 'Ville' : 'Arène';
  $('durationLabel').textContent = mode === 'cops' ? 'Durée d’une manche' : 'Durée';
  if (mode === 'race') {
    const cards = [...TRACKS.map((t) => t.id), 'random'];
    $('trackGrid').innerHTML = cards.map((id) => {
      if (id === 'random') {
        return `<button class="track ${st.track === 'random' ? 'on' : ''}" data-track="random" ${host ? '' : 'disabled'}>
          <div class="track-map random">?</div><div class="track-name">Aléatoire</div><div class="track-diff">Surprise</div></button>`;
      }
      const t = trackById(id);
      const loops = t.loops ? ` · ${t.loops.length} looping${t.loops.length > 1 ? 's' : ''}` : '';
      return `<button class="track ${st.track === id ? 'on' : ''}" data-track="${id}" ${host ? '' : 'disabled'} title="${escapeHtml(t.desc)}">
        <div class="track-map"><img src="${trackThumb(t)}" alt=""></div>
        <div class="track-name">${escapeHtml(t.name)}</div>
        <div class="track-diff">${'★'.repeat(t.difficulty)}${'☆'.repeat(5 - t.difficulty)}${loops}</div></button>`;
    }).join('');
    const sel = st.track === 'random' ? null : trackById(st.track);
    $('trackDesc').textContent = sel ? sel.desc : `Un circuit tiré au sort parmi les ${TRACKS.length}.`;
  } else if (mode === 'cops') {
    const icons = { centre: '🏙️', usine: '🏭', port: '⚓' };
    $('cityGrid').innerHTML = [...CITIES.map((c) => `
      <button class="city ${st.city === c.id ? 'on' : ''}" data-city="${c.id}" ${host ? '' : 'disabled'}>
        <div class="track-map">${icons[c.id]}</div><div class="track-name">${c.name}</div><div class="track-diff">${c.desc}</div></button>`),
    `<button class="city ${st.city === 'random' ? 'on' : ''}" data-city="random" ${host ? '' : 'disabled'}><div class="track-map random">?</div><div class="track-name">Aléatoire</div><div class="track-diff">Surprise</div></button>`].join('');
    const R = COPS_RULES[st.copsRule];
    $('trackDesc').textContent = `${R.icon} ${R.name} : ${R.desc}`;
  } else {
    const A = ARENA_INFO[mode];
    $('arenaCard').innerHTML = `<span class="big-icon">${A.icon}</span><div><h3>${A.name}</h3><p>${A.text}</p></div>`;
    $('trackDesc').textContent = '';
  }
  const opt = (group, value) => document.querySelectorAll(`[data-set="${group}"]`).forEach((b) => {
    b.classList.toggle('on', String(b.dataset.value) === String(value));
    b.disabled = !host;
  });
  for (const k of ['laps', 'cc', 'difficulty', 'bots', 'items', 'powers', 'chaos', 'teamSize', 'matchTime', 'balloons']) opt(k, st[k]);
}

function renderRoom(host) {
  const s = state;
  const mode = s.settings.mode;
  $('lobbyCount').textContent = `${s.players.length}/8`;
  const cards = s.players.map((p) => {
    const v = vehicleById(p.vehicle);
    const col = colorHex(p.color);
    const team = mode === 'rocket' && p.team !== 'auto' ? `<span class="team-dot" style="background:${TEAM_COLORS[p.team]}"></span>` : '';
    return `<li class="${p.id === s.you ? 'me' : ''}">
      <img src="assets/previews/${v.id}.png" alt="" onerror="this.remove()">
      <div class="pl"><b>${p.isHost ? '👑 ' : ''}${team}${escapeHtml(p.name)}</b><small>${col ? `<i class="swatch" style="background:${col}"></i>` : ''}${escapeHtml(v.name)}</small></div>
      <span class="pts">${p.score}</span></li>`;
  });
  const free = Math.max(0, 8 - s.players.length);
  const botsTxt = s.settings.bots ? 'bot' : 'place libre';
  for (let i = 0; i < Math.min(free, 8); i++) cards.push(`<li class="empty">${botsTxt}</li>`);
  $('lobbyPlayers').innerHTML = cards.join('');

  const st = s.settings;
  const M = MODES[mode];
  const rows = [['Mode', `${M.icon} ${M.name}`]];
  if (mode === 'race') {
    rows.push(['Circuit', st.track === 'random' ? 'Aléatoire' : trackById(st.track).name], ['Tours', st.laps], ['Cylindrée', `${st.cc}cc`],
      ['Objets', st.items ? 'Oui' : 'Non'], ['Pouvoirs', st.powers ? 'Oui' : 'Non'], ['Physique tamponneuse', st.chaos ? 'Oui' : 'Non']);
  } else if (mode === 'cops') {
    rows.push(['Règle', `${COPS_RULES[st.copsRule].icon} ${COPS_RULES[st.copsRule].name}`], ['Ville', st.city === 'random' ? 'Aléatoire' : cityById(st.city).name], ['Manche', `${st.matchTime} min`]);
  } else {
    rows.push(['Durée', `${st.matchTime} min`]);
    if (mode === 'rocket') rows.push(['Équipes', `${st.teamSize} contre ${st.teamSize}`]);
    if (mode === 'battle') rows.push(['Ballons', st.balloons], ['Pouvoirs', st.powers ? 'Oui' : 'Non']);
  }
  rows.push(['Bots', st.bots ? ['Facile', 'Normal', 'Difficile'][st.difficulty - 1] : 'Aucun']);
  $('summary').innerHTML = `<h3>Partie</h3><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>`;

  const standings = [...s.players.map((p) => ({ ...p, bot: false })), ...s.bots.map((b) => ({ ...b, bot: true }))]
    .filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  $('standingsCard').classList.toggle('hidden', standings.length === 0);
  $('standings').innerHTML = standings.map((p, i) => `<li class="${p.id === s.you ? 'me' : ''}"><b>${i + 1}</b><span>${escapeHtml(p.name)}${p.bot ? ' <small>bot</small>' : ''}</span><em>${p.score} pts</em></li>`).join('');
}

// Mini-carte d'un circuit (vue du dessus) pour les vignettes.
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
  g.fillStyle = 'rgba(10,12,17,0.35)';
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
      if (T.lp[i % T.n] >= 0) continue;
      const [x, y] = xy(i % T.n);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
  };
  g.lineJoin = 'round';
  path(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 8; g.stroke();
  path(); g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.stroke();
  const [sx, sy] = xy(0);
  g.fillStyle = '#2fd0ff';
  g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill();
  const url = c.toDataURL();
  thumbs.set(def.id, url);
  return url;
}

function initLobby() {
  document.querySelectorAll('#stepper button').forEach((b) => { b.onclick = () => { sfx.click(); setStep(b.dataset.step); }; });
  $('prevBtn').onclick = () => { sfx.click(); setStep(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]); };
  $('nextBtn').onclick = () => { sfx.click(); setStep(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)]); };
  $('modeGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.disabled) return;
    sfx.click();
    request('settings', { mode: b.dataset.mode });
  });
  $('copsRules').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rule]');
    if (!b || b.disabled) return;
    sfx.click();
    request('settings', { copsRule: b.dataset.rule });
  });
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
  $('colorRow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    myColor = b.dataset.color;
    store('sk-color', myColor);
    sfx.click();
    renderProfile(state.players.find((p) => p.id === state.you));
    preview.show(vehicleById(myVehicle), colorHex(myColor));
    request('profile', { color: myColor });
  });
  $('hornSelect').onchange = (e) => {
    myHorn = e.target.value;
    store('sk-horn', myHorn);
    unlock();
    horn(myHorn);
    request('profile', { horn: myHorn });
  };
  $('hornTest').onclick = () => { unlock(); horn(myHorn); };
  document.querySelectorAll('[data-team]').forEach((b) => { b.onclick = () => { sfx.click(); request('profile', { team: b.dataset.team }); }; });
  $('trackGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-track]');
    if (!b || b.disabled) return;
    sfx.click();
    request('settings', { track: b.dataset.track });
  });
  $('cityGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-city]');
    if (!b || b.disabled) return;
    sfx.click();
    request('settings', { city: b.dataset.city });
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
  const share = async () => {
    const url = inviteUrl(state.code);
    try {
      if (navigator.share) await navigator.share({ title: 'SpeedKart', text: `Viens jouer ! Code ${state.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('Lien copié !'); }
    } catch (_) { /* partage annulé */ }
  };
  $('shareBtn').onclick = share;
  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('inviteLink').value); toast('Lien copié !'); } catch (_) { $('inviteLink').select(); }
  };
  document.querySelectorAll('[data-action="leave"]').forEach((b) => { b.onclick = () => leave(); });
  $('resetScoresBtn').onclick = () => request('resetScores');
}

// ------------------------------------------------------------ résultats

async function renderResults() {
  show('screen-results');
  const s = state;
  const g = s.game;
  const res = g?.results || [];
  const host = isHost();
  const mode = g.mode;
  $('resTrack').textContent = mode === 'race' ? trackById(g.track).name : mode === 'cops' ? `${COPS_RULES[g.rule].name} · ${cityById(g.city).name}` : MODES[mode].name;
  const detail = (r) => {
    if (mode === 'race') return r.time != null ? formatTime(r.time) : 'non classé';
    if (mode === 'rocket') return `${r.goals ? `⚽ ${r.goals} · ` : ''}${r.score} pts`;
    if (mode === 'battle') return `${'🎈'.repeat(r.balloons || 0) || '💀'} · ${r.pops} crevé${r.pops > 1 ? 's' : ''}`;
    if (mode === 'cops') return `${r.score} pts · ${r.arrests} arrest.${r.deposited ? ` · 💰${r.deposited}` : ''}`;
    return `${r.score} pts`;
  };
  $('resList').innerHTML = res.map((r) => `
    <li class="${r.id === s.you ? 'me' : ''} p${r.rank}" ${r.team ? `style="box-shadow: inset 3px 0 0 ${TEAM_COLORS[r.team]}"` : ''}>
      <b class="rk">${r.rank}</b>
      <span class="nm">${escapeHtml(r.name)}${r.isBot ? ' <small>bot</small>' : ''}<small>${escapeHtml(vehicleById(r.vehicle).name)} · ${r.total} pts au total</small></span>
      <span class="tm">${detail(r)}</span>
      <span class="pt">+${r.points}</span>
    </li>`).join('');
  const mine = res.find((r) => r.id === s.you);
  let t = 'Résultats';
  if (mine) {
    if (mode === 'rocket') t = mine.win ? 'Victoire !' : res.some((r) => r.win) ? 'Défaite' : 'Match nul';
    else t = mine.rank === 1 ? 'Victoire !' : `${mine.rank}e place`;
  }
  $('resTitle').textContent = t;
  $('againBtn').textContent = mode === 'race' ? 'Circuit suivant' : 'Revanche';
  $('retryBtn').classList.toggle('hidden', mode !== 'race');
  $('resActions').classList.toggle('hidden', !host);
  $('resHint').textContent = host ? '' : 'En attente de l’hôte…';
  if (mine && mine.rank <= 3) sfx.finish();
  if (!podium) {
    const colors = {};
    for (const p of s.players) colors[p.id] = p.color;
    for (const b of s.bots) colors[b.id] = b.color;
    ensureRenderer();
    podium = await showPodium(renderer, res, colors);
  }
}

function initResults() {
  $('againBtn').onclick = async () => {
    sfx.click();
    // Grand prix : on enchaîne sur le circuit suivant (sauf en aléatoire).
    if (state.settings.mode === 'race' && state.settings.track !== 'random') {
      const i = TRACKS.findIndex((t) => t.id === state.game.track);
      await request('settings', { track: TRACKS[(i + 1) % TRACKS.length].id });
    }
    request('start');
  };
  $('retryBtn').onclick = () => { sfx.click(); request('settings', { track: state.game.track }).then(() => request('start')); };
  $('toLobbyBtn').onclick = () => { sfx.click(); step = 'room'; request('lobby'); };
}

// ------------------------------------------------------------ aperçu 3D du véhicule (étape 2)

const preview = (() => {
  let r = null;
  let scene;
  let cam;
  let holder;
  let current = null;
  let token = 0;
  let running = false;
  function init() {
    const canvas = $('vehPreview');
    r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight('#9fb8ff', '#10121a', 1.1));
    const d = new THREE.SpotLight('#ffffff', 90, 30, 0.6, 0.5, 1.4);
    d.position.set(3, 8, 5);
    d.castShadow = true;
    scene.add(d);
    const rim = new THREE.PointLight('#2fd0ff', 30, 14, 1.5);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 0.12, 64), new THREE.MeshStandardMaterial({ color: '#141922', metalness: 0.6, roughness: 0.35 }));
    disc.position.y = -0.06;
    disc.receiveShadow = true;
    scene.add(disc);
    holder = new THREE.Group();
    scene.add(holder);
  }
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const canvas = r.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.floor(w * r.getPixelRatio()) || canvas.height !== Math.floor(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    cam.position.set(0, 2.4, 9);
    cam.lookAt(0, 0.6, 0);
    holder.rotation.y += 0.01;
    r.render(scene, cam);
  }
  return {
    start() { if (!r) init(); if (!running) { running = true; loop(); } },
    stop() { running = false; },
    async show(v, color) {
      if (!r) init();
      const key = `${v.id}|${color}`;
      if (current === key) return;
      current = key;
      const my = ++token;
      const obj = await instance(v.model, { length: Math.min(4.6, v.len * 1.3), cloneMaterials: true });
      if (my !== token) return;
      const tint = color ? new THREE.Color(1, 1, 1).lerp(new THREE.Color(color), 0.65) : null;
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        if (!tint) return;
        for (let p = o; p; p = p.parent) if (/wheel|character/i.test(p.name)) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.color.multiply(tint));
      });
      holder.clear();
      holder.add(obj);
    },
  };
})();

// ------------------------------------------------------------ menu pause

function openPause() {
  if (!play) return;
  $('pauseMenu').classList.remove('hidden');
  if (play.input) play.input.paused = true;
}

function closePause() {
  $('pauseMenu').classList.add('hidden');
  if (play && play.input) play.input.paused = false;
}

function initPause() {
  $('pauseBtn').onclick = () => openPause();
  $('resumeBtn').onclick = () => closePause();
  $('quitBtn').onclick = () => leave();
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    const open = document.querySelector('.overlay:not(.hidden):not(#pauseMenu)');
    if (open) { open.classList.add('hidden'); return; }
    if (document.body.dataset.screen !== 'screen-race') return;
    if ($('pauseMenu').classList.contains('hidden')) openPause(); else closePause();
  });
  // Bouton Start de la manette.
  let prev = false;
  const poll = () => {
    requestAnimationFrame(poll);
    let p = false;
    for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp && gp.buttons[9] && gp.buttons[9].pressed) p = true;
    if (p && !prev && document.body.dataset.screen === 'screen-race') {
      if ($('pauseMenu').classList.contains('hidden')) openPause(); else closePause();
    }
    prev = p;
  };
  poll();
}

// ------------------------------------------------------------ paramètres et aide

function renderKeymap() {
  const groups = [['Course', 'race'], ['Arènes et police', 'car'], ['Partout', 'common']];
  $('keymap').innerHTML = groups.map(([name, scheme]) => `<h4>${name}</h4>${ACTIONS[scheme].map(([id, label]) => `
    <div class="k"><span>${label}</span><button data-bind="${scheme}.${id}">${keysFor(scheme, id).map(keyLabel).join(' / ')}</button></div>`).join('')}`).join('');
}

function renderHelp() {
  const rows = (scheme) => ACTIONS[scheme].map(([id, label]) => `<tr><th>${label}</th><td>${keysFor(scheme, id).map((k) => `<kbd>${keyLabel(k)}</kbd>`).join(' ')}</td></tr>`).join('');
  $('helpBody').innerHTML = `<table class="keys">
    <tr><td colspan="2" class="sec">Course</td></tr>${rows('race')}
    <tr><td colspan="2" class="sec">Arènes et police</td></tr>${rows('car')}
    <tr><td colspan="2" class="sec">Partout</td></tr>${rows('common')}
    <tr><th>Emotes</th><td><kbd>1</kbd>😂 <kbd>2</kbd>😡 <kbd>3</kbd>👍 <kbd>4</kbd>GG <kbd>5</kbd>😱 <kbd>6</kbd>🔥</td></tr>
    <tr><th>Pause</th><td><kbd>Échap</kbd> · manette <kbd>Start</kbd></td></tr>
    <tr><td colspan="2" class="sec">Manette</td></tr>
    <tr><th>Course</th><td>A accélère, B freine, RB dérape, LB objet, Y regarde derrière</td></tr>
    <tr><th>Arènes</th><td>RT/LT avance/recule, A saute, B turbo, X glisse, Y caméra ballon (gadget 3 en police), LB objet</td></tr>
  </table>`;
}

function initSettings() {
  const S = getSettings();
  const segs = () => document.querySelectorAll('[data-pref]').forEach((seg) => {
    const v = String(getSettings()[seg.dataset.pref]);
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v));
  });
  document.querySelectorAll('[data-pref] button').forEach((b) => {
    b.onclick = () => {
      const key = b.parentElement.dataset.pref;
      let v = b.dataset.value;
      if (v === 'true' || v === 'false') v = v === 'true';
      setSetting(key, v);
      segs();
      if (key === 'quality' && renderer) applyRenderer(renderer);
    };
  });
  segs();
  const range = (id, valId, get, set, fmt) => {
    const el = $(id);
    el.value = get();
    $(valId).textContent = fmt(get());
    el.oninput = () => { set(Number(el.value)); $(valId).textContent = fmt(Number(el.value)); };
  };
  range('volumeRange', 'volVal', () => Math.round(getVolume() * 100), (v) => setVolume(v / 100), (v) => `${v} %`);
  range('engineRange', 'engVal', () => Math.round(getEngineVolume() * 100), (v) => setEngineVolume(v / 100), (v) => `${v} %`);
  range('fovRange', 'fovVal', () => getSettings().fov, (v) => setSetting('fov', v), (v) => (v > 0 ? `+${v}°` : `${v}°`));
  range('distRange', 'distVal', () => getSettings().camDist, (v) => setSetting('camDist', v), (v) => `×${v.toFixed(2)}`);
  range('hudScaleRange', 'hudScaleVal', () => S.hudScale, (v) => setSetting('hudScale', v), (v) => `×${v.toFixed(2)}`);

  $('settingsTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('#settingsTabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('#settingsModal .tab').forEach((t) => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab));
  });

  // Réaffectation des touches.
  let waiting = null;
  $('keymap').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bind]');
    if (!b) return;
    if (waiting) waiting.classList.remove('wait');
    waiting = b;
    b.classList.add('wait');
    b.textContent = 'Appuie…';
  });
  window.addEventListener('keydown', (e) => {
    if (!waiting) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      const [scheme, action] = waiting.dataset.bind.split('.');
      bindKey(scheme, action, e.code);
    }
    waiting = null;
    renderKeymap();
  }, true);
  $('resetKeysBtn').onclick = () => { resetKeys(); renderKeymap(); };
  onSettings((_, key) => {
    if (key === 'keys' && play && play.input) play.input.refreshKeys();
  });
  renderKeymap();

  // Ouverture / fermeture des fenêtres.
  document.querySelectorAll('[data-open]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.open;
      if (id === 'helpModal') renderHelp();
      if (id === 'settingsModal') renderKeymap();
      $(id).classList.remove('hidden');
    });
  });
  document.querySelectorAll('.overlay').forEach((o) => {
    o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'pauseMenu') o.classList.add('hidden'); });
    o.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => o.classList.add('hidden'); });
  });
}

initTitle();
initLobby();
initResults();
initPause();
initSettings();
show('screen-title');
