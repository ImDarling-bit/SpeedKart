// Icônes du jeu : petites images SVG dessinées ici (formes pleines, couleurs vives, contour sombre),
// à la place des emojis dont le rendu change d'un système à l'autre. Utilisables en HTML (ico) et
// dans les textures 3D ou la mini-carte (iconImage).

const O = '#1b1e27'; // contour
const W = 3.5; // épaisseur du contour

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g stroke="${O}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
// Trait épais coloré avec son contour.
const line2 = (d, color, w = 6) => `<path d="${d}" fill="none" stroke="${O}" stroke-width="${w + W * 2}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
const starPts = (cx, cy, n, r1, r2, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => {
  const a = rot + (i * Math.PI) / n;
  const r = i % 2 ? r2 : r1;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});
const ngon = (cx, cy, n, r, rot = -Math.PI / 2) => Array.from({ length: n }, (_, i) => [cx + Math.cos(rot + (i * 2 * Math.PI) / n) * r, cy + Math.sin(rot + (i * 2 * Math.PI) / n) * r]);
const arrowHead = (x, y, ang, color, s = 9) => poly([[x + Math.cos(ang) * s, y + Math.sin(ang) * s], [x + Math.cos(ang + 2.4) * s, y + Math.sin(ang + 2.4) * s], [x + Math.cos(ang - 2.4) * s, y + Math.sin(ang - 2.4) * s]], color);
const face = (fill) => `<circle cx="32" cy="33" r="26" fill="${fill}"/>`;

function checkerFlag() {
  let sq = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) sq += `<rect x="${17 + c * 9}" y="${10 + r * 8.6}" width="9" height="8.6" fill="${O}" stroke="none"/>`;
  return `<path d="M17 10 h36 v26 h-36z" fill="#fff"/>${sq}<path d="M17 10 h36 v26 h-36z" fill="none"/>${line2('M14 58 V8', '#c9ced8', 3)}`;
}

function gear() {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const r = (i % 4 < 2) ? 27 : 20;
    pts.push([32 + Math.cos(a) * r, 32 + Math.sin(a) * r]);
  }
  return poly(pts, '#c9ced8') + '<circle cx="32" cy="32" r="8" fill="#3a3f4d"/>';
}

function spiral() {
  let d = '';
  for (let i = 0; i <= 80; i++) {
    const a = i * 0.16;
    const r = 2 + i * 0.3;
    d += `${i ? 'L' : 'M'}${(32 + Math.cos(a) * r).toFixed(1)} ${(32 + Math.sin(a) * r).toFixed(1)} `;
  }
  return line2(d, '#9b4dff', 5);
}

const BANANA = '<path d="M12 13 C4 38 22 58 50 55 C57 54 58 46 51 45 C33 44 25 32 26 13 Z" fill="#ffd23f"/><path d="M12 13 l2 -8 9 2 -2 6z" fill="#7a5a2a"/><path d="M18 22 C17 38 28 48 46 50" fill="none" stroke="#e0a800" stroke-width="2.5"/>';
const MONEYBAG = '<path d="M22 22 Q10 32 11 44 Q12 57 32 57 Q52 57 53 44 Q54 32 42 22Z" fill="#d9a441"/><path d="M22 22 L17 9 L27 13 L32 7 L37 13 L47 9 L42 22Z" fill="#e8b95a"/><path d="M21 22 h22" stroke-width="5"/><text x="32" y="49" font-size="22" font-weight="900" text-anchor="middle" fill="#6b4300" stroke="none" font-family="Arial Black,Arial,sans-serif">$</text>';
const FIRE = '<path d="M32 5 C40 17 53 24 51 40 C49 52 41 59 32 59 C23 59 13 52 13 40 C13 30 21 26 23 15 C28 21 30 23 32 5Z" fill="#ff6a1f"/><path d="M32 28 C36 34 42 38 40 46 C39 52 36 55 32 55 C28 55 24 52 24 46 C24 40 30 36 32 28Z" fill="#ffd23f" stroke="none"/>';
const SHIELD = '<path d="M32 5 L54 13 V30 C54 44 44 54 32 59 C20 54 10 44 10 30 V13Z" fill="#2fd0ff"/><path d="M32 12 L47 18 V30 C47 40 40 48 32 52Z" fill="#8fe8ff" stroke="none"/>';
const THIEF = '<circle cx="32" cy="35" r="23" fill="#f2c9a0"/><path d="M9 32 a23 23 0 0 1 46 0z" fill="#2b2d3a"/><path d="M7 34 h50 v11 h-50z" fill="#2b2d3a"/><ellipse cx="22" cy="39.5" rx="5" ry="3.5" fill="#fff" stroke="none"/><ellipse cx="42" cy="39.5" rx="5" ry="3.5" fill="#fff" stroke="none"/><path d="M25 51 q7 4 14 0" fill="none" stroke-width="3"/>';

const DEFS = {
  // ------------------------------------------------------------ modes et lieux
  flag: checkerFlag(),
  policecar: '<rect x="23" y="7" width="9" height="7" rx="2" fill="#ff3b3b"/><rect x="32" y="7" width="9" height="7" rx="2" fill="#2f9bff"/><path d="M15 27 L21 14 H43 L49 27Z" fill="#bfe3ff"/><rect x="8" y="26" width="48" height="22" rx="6" fill="#2f6bff"/><rect x="8" y="33" width="48" height="6" fill="#fff" stroke="none"/><circle cx="16" cy="43" r="3.5" fill="#ffe680"/><circle cx="48" cy="43" r="3.5" fill="#ffe680"/><rect x="11" y="47" width="10" height="9" rx="2" fill="#2b2d3a"/><rect x="43" y="47" width="10" height="9" rx="2" fill="#2b2d3a"/>',
  thief: THIEF,
  steal: THIEF + line2('M44 16 L58 4', '#ffd23f', 4) + arrowHead(58, 4, -0.7, '#ffd23f', 7),
  ball: (() => {
    const outer = ngon(32, 32, 5, 9);
    let s = '<circle cx="32" cy="32" r="26" fill="#fff"/><clipPath id="c"><circle cx="32" cy="32" r="26"/></clipPath><g clip-path="url(#c)">';
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5 + Math.PI / 5;
      s += poly(ngon(32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25, 5, 8, a + Math.PI), O, 'stroke="none"');
    }
    s += `</g>${poly(outer, O)}<circle cx="32" cy="32" r="26" fill="none"/>`;
    return s;
  })(),
  burst: poly(starPts(32, 32, 12, 29, 17), '#ff8a1f') + poly(starPts(32, 32, 12, 18, 10), '#ffd23f', 'stroke="none"'),
  balloon: '<path d="M32 47 C24 54 38 56 30 61" fill="none" stroke-width="2.5"/><path d="M29 49 h6 l-3 -4z" fill="#d93a55"/><ellipse cx="32" cy="25" rx="18" ry="21" fill="#ff4d6d"/><ellipse cx="25" cy="17" rx="4" ry="7" fill="#fff" opacity="0.55" stroke="none" transform="rotate(25 25 17)"/>',
  city: '<rect x="6" y="26" width="16" height="30" fill="#8fb8ff"/><rect x="20" y="10" width="18" height="46" fill="#4a7fd6"/><rect x="36" y="20" width="22" height="36" fill="#6fa8ff"/>' + [[25, 16], [31, 16], [25, 24], [31, 24], [25, 32], [31, 32], [41, 27], [49, 27], [41, 35], [49, 35], [10, 33], [10, 41]].map(([x, y]) => `<rect x="${x}" y="${y}" width="4" height="5" fill="#ffe680" stroke="none"/>`).join(''),
  factory: '<circle cx="47" cy="10" r="5" fill="#c9ced8"/><circle cx="54" cy="6" r="4" fill="#c9ced8"/><rect x="42" y="14" width="8" height="20" fill="#9aa2b2"/><path d="M6 56 V30 l12 8 V30 l12 8 V30 l12 8 V30 h16 V56z" fill="#b0b6c3"/><rect x="12" y="44" width="8" height="6" fill="#ffe680" stroke="none"/><rect x="28" y="44" width="8" height="6" fill="#ffe680" stroke="none"/><rect x="44" y="44" width="8" height="6" fill="#ffe680" stroke="none"/>',
  anchor: line2('M32 18 V54', '#2f6bff', 5) + line2('M21 25 H43', '#2f6bff', 5) + line2('M11 38 Q13 56 32 56 Q51 56 53 38', '#2f6bff', 5) + '<circle cx="32" cy="11" r="6" fill="#ffd23f"/>',
  crown: '<path d="M10 46 L13 18 L24 31 L32 12 L40 31 L51 18 L54 46Z" fill="#ffd23f"/><rect x="10" y="44" width="44" height="10" rx="2" fill="#f5b82e"/><circle cx="32" cy="49" r="3" fill="#ff4d6d" stroke="none"/><circle cx="20" cy="49" r="2.5" fill="#2fd0ff" stroke="none"/><circle cx="44" cy="49" r="2.5" fill="#2fd0ff" stroke="none"/>',
  star: poly(starPts(32, 34, 5, 28, 12), '#ffd23f'),
  starEmpty: poly(starPts(32, 34, 5, 28, 12), '#3a3f4d'),
  skull: '<path d="M12 30 a20 20 0 0 1 40 0 c0 8 -4 11 -8 13 v9 h-24 v-9 c-4 -2 -8 -5 -8 -13z" fill="#f1f1f4"/><circle cx="24" cy="31" r="5.5" fill="' + O + '" stroke="none"/><circle cx="40" cy="31" r="5.5" fill="' + O + '" stroke="none"/><path d="M32 37 l-3 5 h6z" fill="' + O + '"/><path d="M27 46 v6 M32 46 v6 M37 46 v6" stroke-width="2.5"/>',
  loop: line2('M32 54 C10 54 10 14 32 14 C54 14 54 46 36 46', '#2fd0ff', 5),

  // ------------------------------------------------------------ police et voleurs
  moneybag: MONEYBAG,
  target: '<circle cx="32" cy="32" r="27" fill="#ff3b3b"/><circle cx="32" cy="32" r="19" fill="#fff"/><circle cx="32" cy="32" r="11" fill="#ff3b3b"/><circle cx="32" cy="32" r="4" fill="#fff"/>',
  virus: (() => {
    let s = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      s += line2(`M${32 + Math.cos(a) * 16} ${32 + Math.sin(a) * 16} L${32 + Math.cos(a) * 25} ${32 + Math.sin(a) * 25}`, '#4dd36b', 3);
      s += `<circle cx="${32 + Math.cos(a) * 26}" cy="${32 + Math.sin(a) * 26}" r="4" fill="#4dd36b"/>`;
    }
    return s + '<circle cx="32" cy="32" r="17" fill="#4dd36b"/><circle cx="26" cy="29" r="3" fill="' + O + '" stroke="none"/><circle cx="38" cy="29" r="3" fill="' + O + '" stroke="none"/><path d="M26 39 q6 -4 12 0" fill="none" stroke-width="3"/>';
  })(),
  door: '<rect x="10" y="7" width="28" height="50" rx="2" fill="#8b5a2b"/><rect x="15" y="12" width="18" height="18" fill="#a8743e" stroke="none"/><circle cx="32" cy="35" r="2.5" fill="#ffd23f"/>' + line2('M30 32 H52', '#38d96b', 5) + arrowHead(55, 32, 0, '#38d96b', 10),
  lock: line2('M22 30 V21 a10 10 0 0 1 20 0 V30', '#c9ced8', 5) + '<rect x="13" y="29" width="38" height="28" rx="5" fill="#ffd23f"/><circle cx="32" cy="40" r="4" fill="' + O + '" stroke="none"/><rect x="30.5" y="41" width="3" height="9" fill="' + O + '" stroke="none"/>',
  unlock: line2('M22 30 V21 a10 10 0 0 1 19 -5', '#c9ced8', 5) + '<rect x="13" y="29" width="38" height="28" rx="5" fill="#38d96b"/><circle cx="32" cy="40" r="4" fill="' + O + '" stroke="none"/><rect x="30.5" y="41" width="3" height="9" fill="' + O + '" stroke="none"/>',
  siren: '<path d="M14 44 V30 a18 18 0 0 1 36 0 V44Z" fill="#ff3b3b"/><path d="M22 30 a10 10 0 0 1 10 -10" fill="none" stroke="#fff" stroke-width="4"/><rect x="8" y="44" width="48" height="11" rx="3" fill="#3a3f4d"/>' + line2('M6 16 L12 21 M58 16 L52 21 M32 4 V9', '#ffd23f', 3),
  spikes: poly([[6, 42], [11, 22], [16, 42], [21, 22], [26, 42], [31, 22], [36, 42], [41, 22], [46, 42], [51, 22], [56, 42]], '#d8dde8') + '<rect x="4" y="41" width="56" height="11" rx="3" fill="#8a93a6"/>',
  cone: '<rect x="8" y="50" width="48" height="7" rx="2" fill="#ff8a1f"/><path d="M25 8 h14 l11 42 h-36z" fill="#ff8a1f"/><path d="M21.6 22 h20.8 l2.1 8 h-25z" fill="#fff" stroke="none"/><path d="M17.5 38 h29 l2 7 h-33z" fill="#fff" stroke="none"/><path d="M25 8 h14 l11 42 h-36z" fill="none"/>',
  fire: FIRE,
  smoke: '<path d="M16 52 a11 11 0 0 1 -1 -22 a15 15 0 0 1 28 -6 a12 12 0 0 1 6 28z" fill="#c9ced8"/><path d="M26 26 a8 8 0 0 1 10 -4" fill="none" stroke="#fff" stroke-width="3"/>',
  oil: '<path d="M32 5 C40 19 51 29 51 40 a19 19 0 0 1 -38 0 C13 29 24 19 32 5Z" fill="#2b2d3a"/><path d="M22 38 a10 10 0 0 0 6 10" fill="none" stroke="#7d86a0" stroke-width="3.5"/>',

  // ------------------------------------------------------------ objets
  mushroom: '<rect x="21" y="32" width="22" height="23" rx="7" fill="#fff1dc"/><ellipse cx="28" cy="42" rx="2.2" ry="4" fill="' + O + '" stroke="none"/><ellipse cx="36" cy="42" rx="2.2" ry="4" fill="' + O + '" stroke="none"/><path d="M6 34 a26 25 0 0 1 52 0 q-26 6 -52 0z" fill="#ff3b3b"/><circle cx="32" cy="16" r="6" fill="#fff" stroke="none"/><circle cx="16" cy="26" r="5" fill="#fff" stroke="none"/><circle cx="48" cy="26" r="5" fill="#fff" stroke="none"/>',
  banana: BANANA,
  shellGreen: '<circle cx="32" cy="32" r="26" fill="#fff"/><circle cx="32" cy="32" r="20" fill="#38c95a"/>' + poly(ngon(32, 32, 6, 8, 0), '#7de88f') + [0, 1, 2, 3, 4, 5].map((i) => { const a = (i * Math.PI) / 3; return `<path d="M${32 + Math.cos(a) * 8} ${32 + Math.sin(a) * 8} L${32 + Math.cos(a) * 20} ${32 + Math.sin(a) * 20}" stroke-width="2.5"/>`; }).join(''),
  shellRed: '<circle cx="32" cy="32" r="26" fill="#fff"/><circle cx="32" cy="32" r="20" fill="#ff3b3b"/>' + poly(ngon(32, 32, 6, 8, 0), '#ff8a8a') + [0, 1, 2, 3, 4, 5].map((i) => { const a = (i * Math.PI) / 3; return `<path d="M${32 + Math.cos(a) * 8} ${32 + Math.sin(a) * 8} L${32 + Math.cos(a) * 20} ${32 + Math.sin(a) * 20}" stroke-width="2.5"/>`; }).join(''),
  bomb: line2('M40 18 C44 10 50 10 52 6', '#c8a26a', 3) + poly(starPts(53, 6, 5, 6, 2.5), '#ffd23f', 'stroke-width="2"') + '<rect x="35" y="15" width="10" height="8" rx="2" fill="#5a5f6e" transform="rotate(35 40 19)"/><circle cx="29" cy="38" r="21" fill="#2b2d3a"/><ellipse cx="22" cy="30" rx="5" ry="7" fill="#fff" opacity="0.4" stroke="none" transform="rotate(35 22 30)"/>',
  shield: SHIELD,
  lightning: '<path d="M37 4 L13 36 H29 L23 60 L51 24 H34 L43 4Z" fill="#ffd23f"/>',
  gift: '<rect x="11" y="28" width="42" height="28" rx="3" fill="#ff4d6d"/><rect x="8" y="20" width="48" height="10" rx="3" fill="#ff6b85"/><rect x="28" y="20" width="8" height="36" fill="#ffd23f"/><path d="M32 20 C22 6 12 14 22 20Z M32 20 C42 6 52 14 42 20Z" fill="#ffd23f"/>',
  dice: '<rect x="9" y="9" width="46" height="46" rx="10" fill="#fff"/>' + [[21, 21], [43, 21], [32, 32], [21, 43], [43, 43]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="${O}" stroke="none"/>`).join(''),

  // ------------------------------------------------------------ pouvoirs
  grow: line2('M14 50 L50 14', '#ff8a1f', 5) + arrowHead(52, 12, -Math.PI / 4, '#ff8a1f', 11) + arrowHead(12, 52, (3 * Math.PI) / 4, '#ff8a1f', 11),
  shrink: line2('M8 8 L24 24 M56 56 L40 40 M56 8 L40 24 M8 56 L24 40', '#2fd0ff', 4) + arrowHead(26, 26, Math.PI / 4, '#2fd0ff', 8) + arrowHead(38, 38, -3 * Math.PI / 4, '#2fd0ff', 8) + arrowHead(38, 26, 3 * Math.PI / 4, '#2fd0ff', 8) + arrowHead(26, 38, -Math.PI / 4, '#2fd0ff', 8),
  rocket: '<path d="M22 42 L10 46 L18 34Z" fill="#ff3b3b"/><path d="M22 42 L18 54 L30 46Z" fill="#ff3b3b"/><path d="M20 44 L8 56" stroke="#ff8a1f" stroke-width="7"/><path d="M56 8 C56 8 40 8 28 20 L20 36 L28 44 L44 36 C56 24 56 8 56 8Z" fill="#e9edf5"/><circle cx="41" cy="23" r="6" fill="#2fd0ff"/>',
  sparkles: poly(starPts(26, 34, 4, 20, 6), '#ffd23f') + poly(starPts(48, 16, 4, 11, 3.5), '#fff') + poly(starPts(50, 48, 4, 8, 3), '#ffe680'),
  ghost: '<path d="M13 57 V29 a19 19 0 0 1 38 0 V57 l-6.3 -6 -6.3 6 -6.4 -6 -6.3 6 -6.4 -6z" fill="#f4f4fb"/><ellipse cx="25" cy="30" rx="4" ry="6" fill="' + O + '" stroke="none"/><ellipse cx="39" cy="30" rx="4" ry="6" fill="' + O + '" stroke="none"/><ellipse cx="32" cy="42" rx="4" ry="3" fill="' + O + '" stroke="none"/>',
  wings: '<path d="M29 32 C20 14 8 12 3 17 C9 21 8 25 4 29 C11 31 10 35 6 40 C15 42 23 40 29 36Z" fill="#fff"/><path d="M35 32 C44 14 56 12 61 17 C55 21 56 25 60 29 C53 31 54 35 58 40 C49 42 41 40 35 36Z" fill="#fff"/><circle cx="32" cy="34" r="6" fill="#ffd23f"/>',
  spring: line2('M18 52 L46 46 L18 40 L46 34 L18 28 L46 22', '#c9ced8', 4) + '<rect x="12" y="12" width="40" height="8" rx="3" fill="#ff3b3b"/><rect x="12" y="52" width="40" height="7" rx="3" fill="#3a3f4d"/>',
  shieldPlus: SHIELD + line2('M32 24 V42 M23 33 H41', '#fff', 5),
  magnet: line2('M18 10 V32 a14 14 0 0 0 28 0 V10', '#ff3b3b', 12) + '<rect x="9" y="6" width="18" height="10" fill="#e3e7ef"/><rect x="37" y="6" width="18" height="10" fill="#e3e7ef"/>',
  tire: (() => {
    let s = '<circle cx="32" cy="32" r="27" fill="#2b2d3a"/>';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; s += `<rect x="30" y="4" width="4" height="6" fill="#5a5f6e" stroke="none" transform="rotate(${(a * 180) / Math.PI} 32 32)"/>`; }
    return s + '<circle cx="32" cy="32" r="14" fill="#c9ced8"/><circle cx="32" cy="32" r="5" fill="#5a5f6e"/>';
  })(),
  swap: line2('M12 22 H46', '#2fd0ff', 5) + arrowHead(50, 22, 0, '#2fd0ff', 11) + line2('M52 42 H18', '#ff8a1f', 5) + arrowHead(14, 42, Math.PI, '#ff8a1f', 11),
  spiral: spiral(),
  ice: '<path d="M32 6 L56 18 L32 30 L8 18Z" fill="#dff7ff"/><path d="M8 18 L32 30 V58 L8 46Z" fill="#8fe0ff"/><path d="M56 18 L32 30 V58 L56 46Z" fill="#4ac0f0"/><path d="M16 26 L20 36" stroke="#fff" stroke-width="3"/>',
  shuffle: line2('M8 18 H20 L40 46 H50', '#c44dff', 5) + arrowHead(54, 46, 0, '#c44dff', 10) + line2('M8 46 H20 L40 18 H50', '#2fd0ff', 5) + arrowHead(54, 18, 0, '#2fd0ff', 10),
  ink: '<path d="M32 10 C42 10 50 18 50 28 C56 30 58 38 52 42 C50 52 40 56 32 54 C22 58 12 52 13 42 C6 38 8 28 15 27 C15 16 22 10 32 10Z" fill="#5a2a8a"/><circle cx="56" cy="16" r="4" fill="#5a2a8a"/><circle cx="9" cy="54" r="3.5" fill="#5a2a8a"/><circle cx="25" cy="25" r="4" fill="#9b6bd0" stroke="none"/>',
  flip: line2('M14 30 a18 18 0 0 1 32 -10', '#38d96b', 5) + arrowHead(48, 17, -0.6, '#38d96b', 10) + line2('M50 34 a18 18 0 0 1 -32 10', '#38d96b', 5) + arrowHead(16, 47, 2.5, '#38d96b', 10),
  hourglass: '<rect x="12" y="6" width="40" height="7" rx="2" fill="#a8743e"/><rect x="12" y="51" width="40" height="7" rx="2" fill="#a8743e"/><path d="M17 13 H47 C47 26 36 28 36 32 C36 36 47 38 47 51 H17 C17 38 28 36 28 32 C28 28 17 26 17 13Z" fill="#dff3ff"/><path d="M22 17 H42 C40 24 34 26 32 30 C30 26 24 24 22 17Z" fill="#ffd23f" stroke="none"/><path d="M21 49 C24 42 30 40 32 38 C34 40 40 42 43 49Z" fill="#ffd23f" stroke="none"/>',
  tornado: line2('M8 12 H56', '#9aa8c0', 5) + line2('M14 23 H50', '#9aa8c0', 5) + line2('M20 34 H44', '#9aa8c0', 5) + line2('M26 45 H40', '#9aa8c0', 5) + line2('M30 55 H36', '#9aa8c0', 5),
  shockwave: line2('M10 32 a22 22 0 0 1 44 0', '#ff8a1f', 4) + line2('M18 32 a14 14 0 0 1 28 0', '#ffd23f', 4) + poly(starPts(32, 40, 8, 13, 6), '#fff'),
  comet: line2('M8 8 L30 30', '#ffd23f', 4) + line2('M4 24 L26 40', '#ff8a1f', 3) + line2('M24 4 L40 26', '#ff8a1f', 3) + '<circle cx="40" cy="40" r="15" fill="#ff8a1f"/><circle cx="36" cy="37" r="4" fill="#d96a10" stroke="none"/><circle cx="45" cy="45" r="3" fill="#d96a10" stroke="none"/>',
  bananaRain: `<g transform="translate(0 6) scale(0.55)">${BANANA}</g><g transform="translate(28 0) scale(0.55)">${BANANA}</g><g transform="translate(16 28) scale(0.55)">${BANANA}</g>`,
  crate: '<rect x="8" y="8" width="48" height="48" rx="3" fill="#c8873e"/><rect x="14" y="14" width="36" height="36" fill="#dba25c"/><path d="M14 14 L50 50 M50 14 L14 50" stroke="#a86a2e" stroke-width="5"/><rect x="14" y="14" width="36" height="36" fill="none"/>',
  moon: '<path d="M40 6 A26 26 0 1 0 58 42 A20 20 0 1 1 40 6Z" fill="#ffe9a8"/><circle cx="24" cy="40" r="4" fill="#f0d27a" stroke="none"/><circle cx="18" cy="26" r="2.5" fill="#f0d27a" stroke="none"/>',

  // ------------------------------------------------------------ emotes
  rire: face('#ffd23f') + '<path d="M17 27 q5 -6 10 0 M37 27 q5 -6 10 0" fill="none" stroke-width="3.5"/><path d="M16 36 h32 a16 16 0 0 1 -32 0z" fill="#7a2030"/><path d="M24 48 a8 5 0 0 1 16 0" fill="#ff7a8a" stroke="none"/><path d="M9 30 q-5 9 0 12 q5 -3 0 -12z" fill="#5fc8ff" stroke-width="2"/><path d="M55 30 q-5 9 0 12 q5 -3 0 -12z" fill="#5fc8ff" stroke-width="2"/>',
  colere: face('#ff5a3c') + '<path d="M16 22 L28 28 M48 22 L36 28" stroke-width="4"/><circle cx="24" cy="33" r="3.5" fill="' + O + '" stroke="none"/><circle cx="40" cy="33" r="3.5" fill="' + O + '" stroke="none"/><path d="M22 49 q10 -9 20 0" fill="none" stroke-width="4"/>',
  pouce: '<path d="M22 30 L27 9 C29 4 37 6 36 12 L34 28 H50 C55 28 56 34 52 36 C56 38 55 44 51 45 C54 47 53 52 49 53 C51 56 48 59 44 59 H22Z" fill="#ffd23f"/><rect x="8" y="28" width="14" height="31" rx="3" fill="#2f6bff"/>',
  gg: '<rect x="4" y="14" width="56" height="36" rx="10" fill="#9b4dff"/><text x="32" y="43" font-size="27" font-weight="900" text-anchor="middle" fill="#fff" stroke="none" font-family="Arial Black,Arial,sans-serif">GG</text>',
  peur: face('#e9f7a0') + '<circle cx="23" cy="27" r="7" fill="#fff"/><circle cx="41" cy="27" r="7" fill="#fff"/><circle cx="23" cy="28" r="2.5" fill="' + O + '" stroke="none"/><circle cx="41" cy="28" r="2.5" fill="' + O + '" stroke="none"/><ellipse cx="32" cy="46" rx="7" ry="10" fill="#7a2030"/><path d="M7 38 q3 -10 9 -6 v14 q-6 2 -9 -8z M57 38 q-3 -10 -9 -6 v14 q6 2 9 -8z" fill="#ffd23f"/>',
  feu: FIRE,

  // ------------------------------------------------------------ interface
  gear: gear(),
  pause: '<rect x="15" y="10" width="12" height="44" rx="3" fill="#fff"/><rect x="37" y="10" width="12" height="44" rx="3" fill="#fff"/>',
  close: line2('M16 16 L48 48 M48 16 L16 48', '#fff', 6),
  left: line2('M40 12 L20 32 L40 52', '#fff', 7),
  right: line2('M24 12 L44 32 L24 52', '#fff', 7),
  down: line2('M12 24 L32 44 L52 24', '#fff', 7),
  up: line2('M12 40 L32 20 L52 40', '#fff', 7),
  check: line2('M12 34 L26 48 L52 18', '#38d96b', 7),
};

const urls = new Map();
export function iconUrl(name) {
  if (!urls.has(name)) {
    const body = DEFS[name];
    urls.set(name, body ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(body))}` : '');
  }
  return urls.get(name);
}

export const hasIcon = (name) => !!DEFS[name];

// <img> d'une icône, pour les gabarits HTML.
export function ico(name, cls = '') {
  if (!DEFS[name]) return '';
  return `<img class="ico${cls ? ` ${cls}` : ''}" src="${iconUrl(name)}" alt="" draggable="false">`;
}

// Image chargée (pour dessiner dans un canvas). onReady est appelé si elle n'était pas encore prête.
const images = new Map();
export function iconImage(name, onReady) {
  let img = images.get(name);
  if (!img) {
    img = new Image();
    img.src = iconUrl(name);
    images.set(name, img);
  }
  if (!img.complete && onReady) img.addEventListener('load', onReady, { once: true });
  return img;
}

export function preloadIcons() {
  return Promise.all(Object.keys(DEFS).map((n) => new Promise((res) => {
    const img = iconImage(n);
    if (img.complete) res(); else { img.onload = res; img.onerror = res; }
  })));
}

// Remplit les éléments statiques <… data-icon="nom"> d'une page.
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ico(el.dataset.icon, el.dataset.iconClass || ''); });
}

export const ICON_NAMES = Object.keys(DEFS);
