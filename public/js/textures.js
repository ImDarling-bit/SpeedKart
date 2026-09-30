// Textures générées à la volée (canvas) : pas de fichiers image à fournir.

import * as THREE from './three.js';
import { makeRng } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function noise(g, w, h, amount, seed = 1) {
  const rand = makeRng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// Asphalte : u = travers de la route (0 gauche, 1 droite), v = le long (une tuile = 16 m).
export function roadTexture(road) {
  const [c, g] = canvas(256, 512);
  if (road.rainbow) {
    const grad = g.createLinearGradient(0, 0, 256, 0);
    ['#ff3b3b', '#ff9b2f', '#ffe53b', '#4cff5a', '#3bc8ff', '#6b5bff', '#e84bff'].forEach((col, i, a) => grad.addColorStop(i / (a.length - 1), col));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 512);
    g.globalAlpha = 0.25;
    for (let y = 0; y < 512; y += 64) { g.fillStyle = '#ffffff'; g.fillRect(0, y, 256, 6); }
    g.globalAlpha = 1;
    return tex(c);
  }
  g.fillStyle = road.base;
  g.fillRect(0, 0, 256, 512);
  if (road.tile) {
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 3;
    for (let y = 0; y < 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  } else {
    noise(g, 256, 512, road.ice ? 14 : 22, 7);
  }
  g.fillStyle = road.line;
  g.fillRect(8, 0, 6, 512);
  g.fillRect(242, 0, 6, 512);
  for (let y = 0; y < 512; y += 128) g.fillRect(125, y + 20, 6, 70);
  return tex(c);
}

export function emissiveLines(road) {
  const [c, g] = canvas(256, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = road.line || '#fff';
  g.fillRect(6, 0, 10, 512);
  g.fillRect(240, 0, 10, 512);
  for (let y = 0; y < 512; y += 128) g.fillRect(123, y + 20, 10, 70);
  return tex(c);
}

export function curbTexture([a, b]) {
  const [c, g] = canvas(64, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.fillRect(0, 64, 64, 64);
  return tex(c);
}

export function groundTexture(color, seed = 3, studs = false) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 26, seed);
  if (studs) {
    for (let y = 16; y < 256; y += 32) {
      for (let x = 16; x < 256; x += 32) {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.beginPath(); g.arc(x - 1, y - 1, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.beginPath(); g.arc(x + 2, y + 2, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = color;
        g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
      }
    }
  } else {
    const rand = makeRng(seed + 11);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + rand() * 0.06})`;
      g.fillRect(rand() * 256, rand() * 256, 2 + rand() * 6, 2 + rand() * 6);
    }
  }
  return tex(c);
}

export function wallTexture(color, stripe) {
  const [c, g] = canvas(128, 64);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = stripe;
  for (let x = -64; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 64); g.lineTo(x + 16, 64); g.lineTo(x + 48, 0); g.lineTo(x + 32, 0);
    g.closePath(); g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 58, 128, 6);
  return tex(c);
}

export function checkerTexture(n = 8) {
  const [c, g] = canvas(256, 64);
  const w = 256 / n;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * w, y * 32, w, 32);
    }
  }
  return tex(c);
}

export function boostTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ff7a00');
  grad.addColorStop(1, '#ffd000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff6c0';
  g.lineWidth = 10;
  g.lineJoin = 'round';
  for (let y = 0; y < 128; y += 64) {
    g.beginPath(); g.moveTo(20, y + 50); g.lineTo(64, y + 18); g.lineTo(108, y + 50); g.stroke();
  }
  return tex(c);
}

export function rampTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffcc00';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1b1b';
  for (let x = -128; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 128); g.lineTo(x + 16, 128); g.lineTo(x + 144, 0); g.lineTo(x + 128, 0);
    g.closePath(); g.fill();
  }
  return tex(c);
}

export function itemBoxTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, '#ff5fd2');
  grad.addColorStop(0.5, '#ffe45c');
  grad.addColorStop(1, '#4fd8ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  g.fillStyle = '#ffffff';
  g.font = 'bold 92px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.4)';
  g.shadowBlur = 8;
  g.fillText('?', 64, 70);
  return tex(c, { repeat: false });
}

export function bannerTexture(text) {
  const [c, g] = canvas(1024, 128);
  const n = 16;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 64, y * 64, 64, 64);
    }
  }
  g.fillStyle = '#e8413c';
  g.fillRect(192, 10, 640, 108);
  g.fillStyle = '#fff';
  g.font = 'italic 900 80px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  return tex(c, { repeat: false });
}

// Petite tache ronde et douce (lueurs, particules, ombres).
export function softDot(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c, { repeat: false });
}

export function nameTexture(text, color = '#ffffff') {
  const [c, g] = canvas(256, 64);
  g.font = 'bold 34px Outfit, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(10,10,30,0.6)';
  const x = 128 - w / 2;
  g.beginPath();
  g.roundRect(x, 10, w, 44, 22);
  g.fill();
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  return tex(c, { repeat: false });
}
