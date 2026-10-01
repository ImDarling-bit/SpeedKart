// Pouvoirs spéciaux (option « pouvoirs aléatoires »). Chaque pilote reçoit un pouvoir tiré au
// hasard, utilisable quand il est rechargé ; un nouveau est tiré à chaque utilisation.
// Tirage « sac mélangé » : on voit tous les pouvoirs avant de retomber sur le même.
//
// self : effet sur soi, appliqué par le pilote lui-même.
// others / near / ahead / random / leader : l'hôte choisit les cibles et diffuse l'effet.

export const POWER_COOLDOWN = 16; // secondes

export const POWERS = [
  { id: 'geant', name: 'Géant', icon: 'grow', desc: 'Tu deviens énorme 6 s : tu écrases les autres et les bananes.', target: 'self', dur: 6, modes: ['race', 'battle'] },
  { id: 'fusee', name: 'Fusée', icon: 'rocket', desc: 'Turbo surpuissant pendant 3 s.', target: 'self', dur: 3, modes: ['race', 'battle'] },
  { id: 'teleport', name: 'Téléportation', icon: 'sparkles', desc: 'Bond de 70 m vers l’avant sur la piste.', target: 'self', modes: ['race'] },
  { id: 'fantome', name: 'Fantôme', icon: 'ghost', desc: 'Intouchable 5 s : objets et karts passent à travers toi.', target: 'self', dur: 5, modes: ['race', 'battle'] },
  { id: 'ailes', name: 'Ailes', icon: 'wings', desc: '7 s sans chute dans le vide ni ralentissement hors-piste.', target: 'self', dur: 7, modes: ['race'] },
  { id: 'saut', name: 'Super saut', icon: 'spring', desc: 'Un bond gigantesque (attention où tu retombes).', target: 'self', modes: ['race', 'battle'] },
  { id: 'megabouclier', name: 'Méga bouclier', icon: 'shieldPlus', desc: 'Encaisse 2 coups pendant 15 s.', target: 'self', dur: 15, modes: ['race', 'battle'] },
  { id: 'aimant', name: 'Aimant', icon: 'magnet', desc: 'Aspiré vers l’avant : +30 % de vitesse pendant 4 s.', target: 'self', dur: 4, modes: ['race'] },
  { id: 'pneus', name: 'Pneus magiques', icon: 'tire', desc: '8 s : le hors-piste ne ralentit plus, dérapages chargés 2x plus vite.', target: 'self', dur: 8, modes: ['race'] },
  { id: 'echange', name: 'Échange', icon: 'swap', desc: 'Échange ta place avec un pilote au hasard.', target: 'random', modes: ['race'] },
  { id: 'bond', name: 'Bond quantique', icon: 'spiral', desc: 'Apparais juste derrière le pilote devant toi.', target: 'ahead', modes: ['race'] },
  { id: 'gel', name: 'Gel', icon: 'ice', desc: 'Gèle les pilotes à moins de 35 m pendant 2 s.', target: 'near', range: 35, dur: 2, modes: ['race', 'battle'] },
  { id: 'inversion', name: 'Inversion', icon: 'shuffle', desc: 'Inverse la direction de tous les autres 4 s.', target: 'others', dur: 4, modes: ['race', 'battle'] },
  { id: 'encre', name: 'Encre', icon: 'ink', desc: 'Éclabousse d’encre l’écran de ceux qui sont devant.', target: 'aheadAll', dur: 4, modes: ['race', 'battle'] },
  { id: 'envers', name: 'Tête en bas', icon: 'flip', desc: 'Retourne la caméra de tous les autres pendant 3 s.', target: 'others', dur: 3, modes: ['race', 'battle'] },
  { id: 'chrono', name: 'Chrono', icon: 'hourglass', desc: 'Ralentit tous les autres pendant 3 s.', target: 'others', dur: 3, modes: ['race', 'battle'] },
  { id: 'tornade', name: 'Tornade', icon: 'tornado', desc: 'Fait tourbillonner les pilotes à moins de 25 m.', target: 'near', range: 25, modes: ['race', 'battle'] },
  { id: 'onde', name: 'Onde de choc', icon: 'shockwave', desc: 'Repousse violemment les pilotes à moins de 22 m.', target: 'near', range: 22, modes: ['race', 'battle'] },
  { id: 'voleur', name: 'Voleur', icon: 'steal', desc: 'Vole l’objet du pilote devant toi.', target: 'ahead', modes: ['race', 'battle'] },
  { id: 'comete', name: 'Comète', icon: 'comet', desc: 'Une comète s’abat sur le premier.', target: 'leader', modes: ['race'] },
  { id: 'pluie', name: 'Pluie de bananes', icon: 'bananaRain', desc: 'Sème 5 bananes derrière toi.', target: 'self', modes: ['race', 'battle'] },
  { id: 'caisses', name: 'Mur de caisses', icon: 'crate', desc: 'Pose une rangée de caisses derrière toi.', target: 'self', modes: ['race', 'battle'] },
  { id: 'lune', name: 'Gravité lunaire', icon: 'moon', desc: 'Les autres rebondissent comme sur la Lune pendant 5 s.', target: 'others', dur: 5, modes: ['race', 'battle'] },
  { id: 'fourmi', name: 'Rapetissement', icon: 'shrink', desc: 'Rétrécit tous les autres pendant 5 s.', target: 'others', dur: 5, modes: ['race', 'battle'] },
];

export const powerById = (id) => POWERS.find((p) => p.id === id);

// Sac mélangé par pilote : renvoie le prochain pouvoir, sans répétition avant épuisement du sac.
export function drawPower(holder, mode, rand) {
  if (!holder.powerBag || holder.powerBag.length === 0) {
    const bag = POWERS.filter((p) => p.modes.includes(mode)).map((p) => p.id);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    // Pas deux fois le même d'affilée entre deux sacs.
    if (bag.length > 1 && bag[bag.length - 1] === holder.power) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    holder.powerBag = bag;
  }
  return holder.powerBag.pop();
}

// Effet d'un pouvoir sur une voiture d'arène (Car3D, bataille de ballons). Même contrat que pour
// les karts : renvoie un effet d'écran ('ink', 'upside', 'invert', 'push') ou null.
export function applyPowerToCar(car, id, role) {
  const P = powerById(id);
  if (!P) return null;
  const up = (v) => { car.v = [car.v[0], car.v[1] + v, car.v[2]]; };
  if (role === 'self') {
    switch (id) {
      case 'geant': car.effect('giant', P.dur); break;
      case 'fusee': car.effect('turbo', P.dur); break;
      case 'fantome': car.effect('ghost', P.dur); break;
      case 'saut': up(16); break;
      case 'megabouclier': car.shield = 2; break;
      default:
    }
    return null;
  }
  if (car.fx.ghost > 0 || car.fx.star > 0) return null;
  switch (id) {
    case 'gel': car.effect('freeze', P.dur); return null;
    case 'inversion': car.effect('invert', P.dur); return 'invert';
    case 'encre': return 'ink';
    case 'envers': return 'upside';
    case 'chrono': car.effect('slow', P.dur); return null;
    case 'tornade': car.effect('spin', 1.1); return null;
    case 'onde': return 'push';
    case 'lune': car.effect('lowGrav', P.dur); return null;
    case 'fourmi': car.effect('small', P.dur); return null;
    default: return null;
  }
}

// Effet d'un pouvoir sur un kart (physique de course). Utilisé par le pilote ciblé lui-même,
// et par l'hôte pour ses bots. Renvoie un nom d'effet visuel côté écran (encre, caméra) ou null.
export function applyPowerToKart(kart, id, role) {
  const P = powerById(id);
  if (!P) return null;
  if (role === 'self') {
    switch (id) {
      case 'geant': kart.effect('giant', P.dur); break;
      case 'fusee': kart.effect('rocket', P.dur); break;
      case 'fantome': kart.effect('ghost', P.dur); break;
      case 'ailes': kart.effect('wings', P.dur); break;
      case 'saut': if (!kart.loop) { kart.vy = 19; kart.grounded = false; kart.fromRamp = true; kart.airTime = 0; } break;
      case 'megabouclier': kart.shield = true; kart.shieldHits = 2; kart.shieldTime = P.dur; break;
      case 'aimant': kart.effect('magnet', P.dur); kart.boost(0.6); break;
      case 'pneus': kart.effect('tires', P.dur); break;
      default:
    }
    return null;
  }
  // Effets subis.
  if (kart.fx.ghost > 0 || kart.starTime > 0) return null;
  switch (id) {
    case 'gel': kart.effect('freeze', P.dur); return null;
    case 'inversion': kart.effect('invert', P.dur); return 'invert';
    case 'encre': return 'ink';
    case 'envers': return 'upside';
    case 'chrono': kart.effect('slow', P.dur); return null;
    case 'tornade': kart.hit('spin'); return null;
    case 'onde': return 'push';
    case 'lune': kart.effect('lowGrav', P.dur); return null;
    case 'fourmi': kart.smallTime = Math.max(kart.smallTime, P.dur); return null;
    case 'comete': kart.hit('tumble'); return null;
    default: return null;
  }
}
