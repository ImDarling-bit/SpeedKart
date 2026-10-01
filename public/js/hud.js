// Interface de jeu (HUD) commune à tous les modes : textes géants, messages, flash, encre,
// pouvoir, gadgets, bandeau police/voleurs, classement, mini-carte, commandes tactiles.

import { getSettings } from './settings.js';

export { EMOTES } from './data/social.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class Hud {
  // kind : 'race' | 'rocket' | 'bumper' | 'battle' | 'cops'
  constructor(kind) {
    this.kind = kind;
    this.messages = [];
    this.ranksHtml = '';
    this.gadgetsHtml = '';
    this.inkUntil = 0;
    document.body.dataset.hud = kind;
    $('hudCenter').className = 'hud-center';
    $('hudInk').classList.remove('on');
    $('hudPower').classList.add('hidden');
  }

  setTitle(text) { $('hudTrack').textContent = text; }

  showTouch(scheme) {
    const pad = $('touchPad');
    pad.classList.remove('hidden');
    pad.dataset.scheme = scheme;
    pad.dataset.layout = getSettings().touch;
    pad.dataset.mode = this.kind;
    return pad;
  }

  bigText(text, cls, ms) {
    const el = $('hudCenter');
    el.textContent = text;
    el.className = `hud-center show ${cls}`;
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => { el.className = 'hud-center'; }, ms || (cls === 'finish' ? 3500 : 900));
  }

  message(text, ms = 1500, cls = '') {
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.textContent = text;
    $('hudMsg').appendChild(el);
    this.messages.push({ el, until: performance.now() + ms });
    while (this.messages.length > 4) this.messages.shift().el.remove();
  }

  flash(color) {
    const el = $('hudFlash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  // Taches d'encre : couvrent l'écran puis s'estompent.
  ink(seconds) {
    const el = $('hudInk');
    el.innerHTML = Array.from({ length: 7 }, () => {
      const s = 140 + Math.random() * 220;
      return `<i style="left:${Math.random() * 85}%;top:${Math.random() * 75}%;width:${s}px;height:${s}px"></i>`;
    }).join('');
    el.classList.add('on');
    this.inkUntil = performance.now() + seconds * 1000;
  }

  setPowerVisible(on) { $('hudPower').classList.toggle('hidden', !on); }

  setPower(P, cd) {
    const el = $('hudPower');
    const icon = P ? P.icon : '';
    if (el.dataset.icon !== icon) {
      el.dataset.icon = icon;
      $('hudPowerIcon').textContent = icon;
      $('hudPowerName').textContent = P ? P.name : '';
      el.title = P ? P.desc : '';
    }
    el.classList.toggle('ready', !!P && cd <= 0);
    $('hudPowerCd').textContent = cd > 0 ? Math.ceil(cd) : '';
  }

  // Police contre voleurs : rôle, manche, objectif, argent, attente du départ.
  setRole(role, objective) {
    const el = $('hudRole');
    el.textContent = role === 'cop' ? '🚓 POLICE' : '🦹 VOLEUR';
    el.dataset.role = role;
    $('hudObjective').textContent = objective || '';
  }

  setCops({ round, rounds, rule, money, target, bags, wait }) {
    $('hudRound').textContent = `Manche ${round}/${rounds}`;
    const heist = rule === 'heist';
    $('hudMoney').classList.toggle('hidden', !heist);
    if (heist) {
      $('hudMoneyBar').style.width = `${Math.min(100, (money / Math.max(1, target)) * 100)}%`;
      $('hudMoneyText').textContent = `💰 ${money} / ${target}${bags ? ` · tu portes ${bags}` : ''}`;
    }
    $('hudWait').textContent = wait ? `Départ dans ${wait} s : les voleurs prennent de l’avance` : '';
  }

  // Gadgets : [{ icon, name, key, cd }]
  setGadgets(list) {
    const html = list.map((g) => `<div class="gadget${g.cd > 0 ? '' : ' ready'}" title="${escapeHtml(g.desc || '')}">
      <span class="g-icon">${g.icon}</span>${g.cd > 0 ? `<b>${Math.ceil(g.cd)}</b>` : ''}<kbd>${g.key}</kbd><small>${escapeHtml(g.name)}</small></div>`).join('');
    if (html !== this.gadgetsHtml) {
      $('hudGadgets').innerHTML = html;
      this.gadgetsHtml = html;
    }
  }

  // list : [{ rank, name, color, me, done, extra }]
  ranks(list) {
    const html = list.map((r) => `<li${r.me ? ' class="me"' : ''}><b>${r.rank}</b><i style="background:${r.color}"></i><span>${escapeHtml(r.name)}${r.done ? ' 🏁' : ''}</span>${r.extra ? `<em>${escapeHtml(r.extra)}</em>` : ''}</li>`).join('');
    if (html !== this.ranksHtml) {
      $('hudRanks').innerHTML = html;
      this.ranksHtml = html;
    }
  }

  mapTransform(minX, maxX, minZ, maxZ) {
    const c = $('hudMap');
    const size = c.width;
    const pad = 12;
    const k = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = (size - (maxX - minX) * k) / 2;
    const oz = (size - (maxZ - minZ) * k) / 2;
    this.mapK = k;
    this.mapXY = (x, z) => [size - (ox + (x - minX) * k), oz + (z - minZ) * k];
    const bg = document.createElement('canvas');
    bg.width = bg.height = size;
    return bg;
  }

  // Mini-carte d'un circuit ou d'une arène : tracé (liste de [x, z]) vu du dessus.
  prepareMap(pts, start, closed = true) {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const bg = this.mapTransform(minX, maxX, minZ, maxZ);
    const g = bg.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, py] = this.mapXY(x, z);
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      if (closed) g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 10;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 5;
    g.stroke();
    if (start) {
      const [sx, sy] = this.mapXY(start[0], start[1]);
      g.fillStyle = '#fff';
      g.fillRect(sx - 4, sy - 4, 8, 8);
    }
    this.mapBg = bg;
  }

  // Mini-carte d'une ville : pâtés d'immeubles et repères (planques, prison, sorties).
  prepareCityMap(W, D, blocks, marks) {
    const bg = this.mapTransform(-W / 2, W / 2, -D / 2, D / 2);
    const g = bg.getContext('2d');
    const [x0, y0] = this.mapXY(W / 2, -D / 2);
    const [x1, y1] = this.mapXY(-W / 2, D / 2);
    g.fillStyle = 'rgba(70,74,84,0.85)';
    g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    g.fillStyle = 'rgba(20,22,28,0.95)';
    for (const [cx, cz, h] of blocks) {
      const [px, py] = this.mapXY(cx, cz);
      const s = h * this.mapK;
      g.fillRect(px - s, py - s, s * 2, s * 2);
    }
    g.font = 'bold 13px Inter, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const m of marks) {
      const [px, py] = this.mapXY(m.x, m.z);
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(px, py, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.fillText(m.icon, px, py + 1);
    }
    this.mapBg = bg;
  }

  // dots : [{ x, z, color, me, ball, small }]
  drawMap(dots) {
    const c = $('hudMap');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (this.mapBg) g.drawImage(this.mapBg, 0, 0);
    if (!this.mapXY) return;
    const list = [...dots].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));
    for (const d of list) {
      const [x, y] = this.mapXY(d.x, d.z);
      g.beginPath();
      g.arc(x, y, d.small ? 3 : d.ball ? 6 : d.me ? 7 : 5, 0, Math.PI * 2);
      g.fillStyle = d.ball ? '#ffffff' : d.color;
      g.fill();
      if (d.small) continue;
      g.lineWidth = d.me ? 3 : 1.5;
      g.strokeStyle = d.me ? '#fff' : 'rgba(0,0,0,0.7)';
      g.stroke();
    }
  }

  update() {
    const now = performance.now();
    this.messages = this.messages.filter((m) => {
      if (now > m.until) { m.el.remove(); return false; }
      return true;
    });
    if (this.inkUntil && now > this.inkUntil) {
      $('hudInk').classList.remove('on');
      this.inkUntil = 0;
    }
  }

  dispose() {
    clearTimeout(this.bigTimer);
    for (const m of this.messages) m.el.remove();
    this.messages = [];
    $('hudCenter').className = 'hud-center';
    $('hudWrong').classList.add('hidden');
    $('touchPad').classList.add('hidden');
    $('hudInk').classList.remove('on');
    $('hudRanks').innerHTML = '';
    $('hudGadgets').innerHTML = '';
  }
}
