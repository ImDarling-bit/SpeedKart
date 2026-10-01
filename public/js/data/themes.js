// Ambiances visuelles des circuits. Les décors viennent des packs Kenney (public/assets/<kit>/<modèle>.glb).
// props : décors semés le long du tracé. h = hauteur voulue en mètres, w = fréquence relative,
//         tint = couleur vive aléatoire, face = tourné vers la piste.
// lamps : décor répété à intervalle régulier au bord de la piste.

const P = (m, h, w = 1, extra = {}) => ({ m, h, w, ...extra });

export const THEMES = {
  stadium: {
    sky: ['#4aa8ff', '#cfeaff'], fog: ['#cfeaff', 180, 650],
    sun: 1.6, hemi: ['#ffffff', '#5a7d3a', 1.1],
    ground: '#6fbf4a', off: '#5aa83a',
    road: { base: '#50535c', line: '#ffffff' }, curb: ['#e8413c', '#ffffff'],
    wall: { color: '#f4f4f4', stripe: '#e8413c' },
    density: 0.55, spread: 60,
    props: [
      P('racing/treeLarge', 14, 5), P('racing/treeSmall', 9, 4),
      P('racing/grandStandCovered', 12, 1.5, { face: true, near: true }), P('racing/grandStand', 10, 1.5, { face: true, near: true }),
      P('racing/tentLong', 6, 1, { face: true }), P('racing/tent', 6, 1, { face: true }),
      P('racing/billboard', 8, 1, { face: true, near: true }), P('racing/bannerTowerRed', 12, 0.6),
      P('racing/bannerTowerGreen', 12, 0.6), P('racing/radarEquipment', 8, 0.4),
      P('racing/pitsGarage', 8, 0.6, { face: true }),
    ],
    lamps: { m: 'racing/lightPostLarge', h: 12, every: 70 },
  },

  city: {
    sky: ['#6fb6ff', '#e6f2ff'], fog: ['#dde9f5', 160, 600],
    sun: 1.5, hemi: ['#ffffff', '#808890', 1.1],
    ground: '#9aa0a8', off: '#b9bec6',
    road: { base: '#3f4249', line: '#f5d33c' }, curb: ['#dddddd', '#9a9a9a'],
    wall: { color: '#d8d8d8', stripe: '#3a78d8' },
    density: 0.9, spread: 30, rows: 2,
    props: [
      P('commercial/building-a', 24, 1, { face: true }), P('commercial/building-b', 26, 1, { face: true }),
      P('commercial/building-c', 22, 1, { face: true }), P('commercial/building-d', 28, 1, { face: true }),
      P('commercial/building-e', 22, 1, { face: true }), P('commercial/building-f', 26, 1, { face: true }),
      P('commercial/building-g', 24, 1, { face: true }), P('commercial/building-h', 28, 1, { face: true }),
      P('commercial/building-i', 22, 1, { face: true }), P('commercial/building-j', 24, 1, { face: true }),
      P('commercial/building-k', 26, 1, { face: true }), P('commercial/building-l', 22, 1, { face: true }),
      P('commercial/building-skyscraper-a', 60, 0.5, { face: true }), P('commercial/building-skyscraper-b', 70, 0.5, { face: true }),
      P('commercial/building-skyscraper-c', 55, 0.5, { face: true }), P('commercial/building-skyscraper-d', 65, 0.5, { face: true }),
    ],
    lamps: { m: 'roads/light-curved', h: 9, every: 40, face: true },
  },

  industrial: {
    sky: ['#8fb4d6', '#e9e4d8'], fog: ['#dcd6c8', 150, 560],
    sun: 1.4, hemi: ['#fff6e8', '#6d6a60', 1.1],
    ground: '#8c8a7e', off: '#a39f8e',
    road: { base: '#44464c', line: '#ffffff' }, curb: ['#f2b705', '#2b2b2b'],
    wall: { color: '#c9c9c9', stripe: '#f2b705' },
    density: 0.7, spread: 50,
    props: [
      P('industrial/building-a', 22, 1, { face: true }), P('industrial/building-b', 20, 1, { face: true }),
      P('industrial/building-c', 24, 1, { face: true }), P('industrial/building-d', 22, 1, { face: true }),
      P('industrial/building-e', 20, 1, { face: true }), P('industrial/building-f', 26, 1, { face: true }),
      P('industrial/building-g', 22, 1, { face: true }), P('industrial/building-h', 24, 1, { face: true }),
      P('industrial/chimney-large', 40, 0.6), P('industrial/chimney-medium', 30, 0.6),
      P('industrial/detail-tank-large', 14, 0.8), P('industrial/detail-tank', 10, 0.8),
      P('industrial/shipping-container-a', 5, 1, { near: true }), P('industrial/shipping-container-b', 5, 1, { near: true }),
      P('industrial/shipping-container-c', 5, 1, { near: true }), P('industrial/water-tower', 22, 0.5),
      P('industrial/windmill', 30, 0.3),
    ],
    lamps: { m: 'roads/light-square', h: 9, every: 50, face: true },
    pillar: 'roads/bridge-pillar-wide',
  },

  marble: {
    sky: ['#ff9ec7', '#ffe3b3'], fog: ['#ffd9c9', 220, 900],
    sun: 1.5, hemi: ['#ffffff', '#c68fb0', 1.2],
    ground: null, off: '#f3efe6', edgeColor: '#d9cbb8',
    road: { base: '#ece6da', line: '#c9a26b', tile: true }, curb: ['#7a5fd0', '#f2f2f2'],
    density: 0.35, spread: 60, float: true,
    props: [
      P('marble/tree-large', 14, 2), P('marble/tree-tall-large', 18, 2), P('marble/tree', 10, 1),
      P('marble/banner-double-high', 12, 1, { near: true, face: true }), P('marble/banner-high', 10, 1, { near: true, face: true }),
      P('marble/fan-standing-four', 10, 0.8, { near: true }), P('marble/marble-center-butterfly-high', 12, 0.6),
    ],
    pillar: 'marble/support-color-four-middle',
  },

  islands: {
    sky: ['#3fb7ff', '#d9f4ff'], fog: ['#c9ecff', 220, 800],
    sun: 1.6, hemi: ['#ffffff', '#3a90c0', 1.1],
    ground: null, water: { color: '#2d9bd6', y: -2 }, off: '#e8d59a', edgeColor: '#b89a5a',
    road: { base: '#7a6a58', line: '#fff3c4' }, curb: ['#ffcc33', '#ffffff'],
    density: 0.6, spread: 18, onPlatform: true,
    props: [
      P('platformer/tree', 10, 4), P('platformer/tree-pine', 12, 2), P('platformer/flowers-tall', 3, 2, { near: true }),
      P('platformer/flowers', 2, 2, { near: true }), P('platformer/rocks', 4, 2, { near: true }), P('platformer/mushrooms', 3, 1, { near: true }),
      P('platformer/crate', 3, 1, { near: true }), P('platformer/barrel', 3, 1, { near: true }), P('platformer/flag', 8, 0.6, { near: true }),
      P('platformer/coin-gold', 4, 0.6, { floatUp: 5 }), P('platformer/chest', 3, 0.5, { near: true }),
    ],
    islands: true,
  },

  snow: {
    sky: ['#9fc4e8', '#f4f8ff'], fog: ['#eef3fa', 120, 520],
    sun: 1.3, hemi: ['#ffffff', '#b8c8dd', 1.3],
    ground: '#f4f7fb', off: '#e4ecf5',
    road: { base: '#5d6570', line: '#ffffff', ice: true }, curb: ['#3a7bd5', '#ffffff'],
    wall: { color: '#ffffff', stripe: '#3a7bd5' },
    density: 0.8, spread: 60,
    props: [
      P('platformer/tree-pine-snow', 16, 5), P('platformer/tree-pine-snow-small', 10, 4), P('platformer/tree-snow', 12, 3),
      P('platformer/block-snow-large-tall', 14, 0.8), P('platformer/rocks', 5, 1, { near: true }),
      P('platformer/block-snow-large-slope', 10, 0.6),
    ],
    snowfall: true,
  },

  desert: {
    sky: ['#58a8e8', '#fde7bd'], fog: ['#f6ddb0', 160, 640],
    sun: 1.8, hemi: ['#fff4dd', '#c79a55', 1.1],
    ground: '#e8c27a', off: '#d9ab5f',
    road: { base: '#6b5d52', line: '#fff0c9' }, curb: ['#d4622a', '#fff0c9'],
    wall: { color: '#e9c98f', stripe: '#b8612f' },
    density: 0.45, spread: 70,
    props: [
      P('platformer/rocks', 9, 4), P('platformer/stones', 6, 3), P('platformer/plant', 4, 2, { near: true }),
      P('racing/tentLong', 6, 1, { face: true }), P('racing/tent', 6, 1, { face: true }),
      P('platformer/barrel', 3, 1, { near: true }), P('platformer/crate', 3, 1, { near: true }),
      P('platformer/block-grass-large-tall', 18, 0.4, { tint: '#e0b56a' }),
    ],
  },

  night: {
    sky: ['#05051a', '#2a1a55'], fog: ['#1a1238', 150, 700],
    sun: 0.35, hemi: ['#6a6aff', '#1a1030', 0.6], night: true,
    ground: '#1c1c28', off: '#26263a',
    road: { base: '#26272e', line: '#39e6ff', glow: true }, curb: ['#ff2fa8', '#39e6ff'],
    wall: { color: '#20203a', stripe: '#ff2fa8', glow: true },
    density: 0.9, spread: 35, rows: 2,
    props: [
      P('commercial/building-skyscraper-a', 70, 1, { face: true, lit: true }), P('commercial/building-skyscraper-b', 80, 1, { face: true, lit: true }),
      P('commercial/building-skyscraper-c', 65, 1, { face: true, lit: true }), P('commercial/building-skyscraper-d', 75, 1, { face: true, lit: true }),
      P('commercial/building-skyscraper-e', 90, 1, { face: true, lit: true }), P('commercial/building-h', 30, 1, { face: true, lit: true }),
      P('commercial/building-f', 30, 1, { face: true, lit: true }), P('roads/sign-highway-wide', 10, 0.4, { near: true, face: true }),
    ],
    lamps: { m: 'roads/light-square-double', h: 10, every: 45, face: true, light: '#ffcf7a' },
    stars: true,
  },

  construction: {
    sky: ['#79b5e8', '#f0e8d8'], fog: ['#e6dccb', 150, 560],
    sun: 1.5, hemi: ['#ffffff', '#8a7a5a', 1.1],
    ground: '#a58a62', off: '#b89c6c',
    road: { base: '#474a50', line: '#ffb300' }, curb: ['#ffb300', '#222222'],
    wall: { color: '#ff8c1a', stripe: '#ffffff' },
    density: 0.8, spread: 45,
    props: [
      P('roads/construction-barrier', 2.2, 3, { near: true, face: true }), P('roads/construction-cone', 1.4, 3, { near: true }),
      P('roads/construction-light', 3, 1, { near: true }), P('roads/construction-fence', 2.5, 2, { near: true, face: true }),
      P('industrial/shipping-container-a', 5, 1.5), P('industrial/shipping-container-b', 5, 1.5), P('industrial/shipping-container-c', 5, 1.5),
      P('roads/dumpster', 3, 1, { near: true }), P('industrial/detail-tank', 10, 0.6), P('industrial/building-k', 20, 0.8, { face: true }),
      P('industrial/building-m', 20, 0.8, { face: true }), P('roads/electricity-pole', 14, 0.8), P('cars/tractor-shovel', 5, 0.6),
      P('cars/truck-flat', 4, 0.6), P('cars/box', 2, 1, { near: true }),
    ],
    lamps: { m: 'roads/electricity-pole', h: 13, every: 60 },
  },

  brick: {
    sky: ['#56c1ff', '#fff7d6'], fog: ['#fff1cc', 180, 640],
    sun: 1.6, hemi: ['#ffffff', '#6a9a3a', 1.2],
    ground: '#58b846', off: '#4ca53c', groundStuds: true,
    road: { base: '#6b6f78', line: '#ffffff' }, curb: ['#ffd400', '#e23a3a'],
    wall: { color: '#e23a3a', stripe: '#ffd400' },
    density: 0.7, spread: 60,
    props: [
      P('brick/bevel-lq-brick-2x4', 8, 3, { tint: true }), P('brick/bevel-lq-brick-2x2', 8, 3, { tint: true }),
      P('brick/bevel-lq-brick-1x1-round', 10, 2, { tint: true }), P('brick/round-lq-brick-2x2', 12, 2, { tint: true }),
      P('brick/bevel-lq-brick-slope-2x3', 10, 2, { tint: true }), P('brick/bevel-lq-brick-corner', 8, 2, { tint: true }),
      P('brick/square-lq-brick-2x8', 6, 1, { tint: true }), P('brick/bevel-lq-plate-4x4', 2, 1, { tint: true, near: true }),
      P('brick/round-lq-brick-1x1', 14, 1, { tint: true }),
    ],
  },

  fair: {
    sky: ['#ff8a5c', '#ffe2b8'], fog: ['#ffd7b0', 200, 760],
    sun: 1.4, hemi: ['#fff1dd', '#8a6a9a', 1.15],
    ground: '#7cc35a', off: '#6bb04c',
    road: { base: '#4b4560', line: '#ffe066' }, curb: ['#ff4fa3', '#ffffff'],
    wall: { color: '#ffffff', stripe: '#ff4fa3' },
    density: 0.6, spread: 55,
    props: [
      P('marble/banner-double-high', 12, 1.5, { near: true, face: true }), P('marble/banner-hanging-double-high', 12, 1, { face: true }),
      P('marble/fan-standing-four', 12, 1), P('marble/tree-large', 14, 2), P('marble/tree-tall-large', 16, 2),
      P('racing/tentLong', 6, 1.5, { face: true }), P('racing/tent', 6, 1.5, { face: true }), P('racing/grandStandCovered', 12, 1, { face: true, near: true }),
      P('platformer/flag', 8, 1, { near: true }), P('platformer/coin-gold', 5, 1, { floatUp: 6 }), P('platformer/star', 6, 0.5, { floatUp: 8 }),
      P('marble/marble-center-butterfly-high', 14, 0.6),
    ],
    lamps: { m: 'racing/lightPostLarge', h: 12, every: 70 },
  },

  rainbow: {
    sky: ['#02010a', '#1a0a3a'], fog: ['#0a0520', 250, 1000],
    sun: 0.6, hemi: ['#b0a0ff', '#201040', 0.9], night: true,
    ground: null, off: '#ffffff', edgeColor: '#ffffff',
    road: { base: '#ffffff', rainbow: true, glow: true }, curb: ['#ffffff', '#ffe066'],
    density: 0.25, spread: 80, float: true,
    props: [
      P('platformer/star', 10, 3, { floatUp: 8, glow: '#ffe066' }), P('platformer/jewel', 8, 2, { floatUp: 6, glow: '#66e0ff' }),
      P('platformer/heart', 8, 1, { floatUp: 6, glow: '#ff6699' }), P('platformer/coin-gold', 8, 2, { floatUp: 6 }),
    ],
    stars: true,
  },
};

export const themeFor = (def) => THEMES[def.theme] || THEMES.stadium;
