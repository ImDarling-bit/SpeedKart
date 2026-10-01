// Paramètres du joueur (graphismes, caméra, interface, touches), gardés dans le navigateur.

// Actions remappables, avec leurs touches par défaut (codes physiques : ZQSD = WASD).
export const ACTIONS = {
  race: [
    ['up', 'Accélérer', ['ArrowUp', 'KeyW']],
    ['down', 'Freiner / reculer', ['ArrowDown', 'KeyS']],
    ['left', 'Gauche', ['ArrowLeft', 'KeyA']],
    ['right', 'Droite', ['ArrowRight', 'KeyD']],
    ['drift', 'Déraper / sauter', ['Space', 'ShiftLeft']],
    ['item', 'Objet', ['KeyE', 'ControlLeft']],
    ['back', 'Regarder derrière', ['KeyC']],
  ],
  car: [
    ['up', 'Avancer', ['ArrowUp', 'KeyW']],
    ['down', 'Reculer', ['ArrowDown', 'KeyS']],
    ['left', 'Gauche', ['ArrowLeft', 'KeyA']],
    ['right', 'Droite', ['ArrowRight', 'KeyD']],
    ['jump', 'Sauter', ['Space']],
    ['boost', 'Turbo', ['ShiftLeft']],
    ['slide', 'Glisser / vrille', ['KeyX', 'AltLeft']],
    ['item', 'Objet / gadget 1', ['KeyE', 'Enter']],
    ['g3', 'Gadget 3', ['KeyF']],
    ['cam', 'Caméra ballon', ['KeyC']],
  ],
  common: [
    ['power', 'Pouvoir / gadget 2', ['KeyR']],
    ['horn', 'Klaxon', ['KeyH']],
  ],
};

const DEFAULTS = {
  quality: 'high', // low | medium | high
  hudScale: 1,
  fov: 0, // décalage du champ de vision (degrés)
  camDist: 1, // multiplicateur de distance de la caméra
  shake: true,
  touch: 'joystick', // joystick | buttons
  keys: {}, // { 'race.up': ['KeyW', ...] } : seulement ce qui diffère des défauts
};

let current = load();
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem('sk-settings') || '{}');
    return { ...DEFAULTS, ...raw, keys: { ...(raw.keys || {}) } };
  } catch (_) {
    return { ...DEFAULTS, keys: {} };
  }
}

export function getSettings() { return current; }

export function setSetting(key, value) {
  current = { ...current, [key]: value };
  try { localStorage.setItem('sk-settings', JSON.stringify(current)); } catch (_) { /* navigation privée */ }
  for (const fn of listeners) fn(current, key);
  applyCss();
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Touches d'une action (personnalisées ou par défaut).
export function keysFor(scheme, action) {
  const custom = current.keys[`${scheme}.${action}`];
  if (custom && custom.length) return custom;
  const def = (ACTIONS[scheme] || []).find((a) => a[0] === action);
  return def ? def[2] : [];
}

export function bindKey(scheme, action, code) {
  setSetting('keys', { ...current.keys, [`${scheme}.${action}`]: [code] });
}

export function resetKeys() { setSetting('keys', {}); }

// Nom lisible d'une touche (KeyW -> W, ArrowUp -> ↑...).
export function keyLabel(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Espace', ShiftLeft: 'Maj', ShiftRight: 'Maj D', ControlLeft: 'Ctrl', ControlRight: 'Ctrl D', AltLeft: 'Alt', Enter: 'Entrée', Escape: 'Échap', Tab: 'Tab', Backspace: '⌫' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
}

// Réglages graphiques appliqués au moteur de rendu.
export function applyRenderer(renderer) {
  if (!renderer) return;
  const q = current.quality;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 0.85) : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75));
  renderer.shadowMap.enabled = q !== 'low';
}

export const particleBudget = () => ({ low: 150, medium: 320, high: 500 }[current.quality] || 500);

function applyCss() {
  document.documentElement.style.setProperty('--hud-scale', String(current.hudScale));
}
applyCss();
