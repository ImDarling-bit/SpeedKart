// Les véhicules jouables. Stats de 1 à 5 :
// speed = vitesse de pointe, accel = accélération, handling = maniabilité, weight = poids
// (un kart lourd pousse les autres et subit moins le hors-piste). len = longueur affichée en mètres.

const V = (id, name, model, cat, len, speed, accel, handling, weight) => ({
  id, name, model, cat, len, stats: { speed, accel, handling, weight },
});

export const VEHICLES = [
  // Karts
  V('kart-oobi', 'Oobi', 'cars/kart-oobi', 'Kart', 2.4, 3, 4, 4, 2),
  V('kart-oodi', 'Oodi', 'cars/kart-oodi', 'Kart', 2.4, 4, 3, 3, 3),
  V('kart-ooli', 'Ooli', 'cars/kart-ooli', 'Kart', 2.4, 2, 5, 5, 1),
  V('kart-oopi', 'Oopi', 'cars/kart-oopi', 'Kart', 2.4, 3, 3, 5, 2),
  V('kart-oozi', 'Oozi', 'cars/kart-oozi', 'Kart', 2.4, 5, 2, 3, 3),

  // Course
  V('race', 'Bolide', 'cars/race', 'Course', 3.2, 5, 3, 3, 2),
  V('race-future', 'Prototype', 'cars/race-future', 'Course', 3.2, 5, 2, 4, 2),
  V('race-red', 'Formule Rouge', 'racing/raceCarRed', 'Course', 3.0, 4, 4, 4, 1),
  V('race-green', 'Formule Verte', 'racing/raceCarGreen', 'Course', 3.0, 4, 3, 5, 1),
  V('race-orange', 'Formule Orange', 'racing/raceCarOrange', 'Course', 3.0, 5, 3, 3, 2),
  V('race-white', 'Formule Blanche', 'racing/raceCarWhite', 'Course', 3.0, 3, 5, 4, 1),

  // Sport
  V('sedan-sports', 'Coupé Sport', 'cars/sedan-sports', 'Sport', 3.3, 4, 4, 3, 2),
  V('hatchback-sports', 'Citadine GTI', 'cars/hatchback-sports', 'Sport', 3.2, 3, 5, 4, 2),

  // Ville
  V('sedan', 'Berline', 'cars/sedan', 'Ville', 3.4, 3, 3, 3, 3),
  V('taxi', 'Taxi', 'cars/taxi', 'Ville', 3.4, 3, 4, 3, 3),
  V('police', 'Police', 'cars/police', 'Ville', 3.5, 4, 3, 3, 3),
  V('suv', 'SUV', 'cars/suv', 'Ville', 3.5, 3, 3, 2, 4),
  V('suv-luxury', 'SUV de luxe', 'cars/suv-luxury', 'Ville', 3.6, 4, 2, 2, 4),
  V('van', 'Van', 'cars/van', 'Ville', 3.6, 2, 3, 3, 4),

  // Utilitaires
  V('delivery', 'Livraison', 'cars/delivery', 'Utilitaire', 3.7, 3, 2, 2, 4),
  V('delivery-flat', 'Plateau', 'cars/delivery-flat', 'Utilitaire', 3.7, 3, 3, 2, 4),
  V('truck', 'Pick-up', 'cars/truck', 'Utilitaire', 3.6, 3, 3, 2, 4),
  V('truck-flat', 'Pick-up plat', 'cars/truck-flat', 'Utilitaire', 3.5, 3, 3, 3, 3),
  V('ambulance', 'Ambulance', 'cars/ambulance', 'Utilitaire', 3.8, 4, 2, 2, 4),

  // Poids lourds
  V('firetruck', 'Pompiers', 'cars/firetruck', 'Lourd', 4.0, 4, 1, 2, 5),
  V('garbage-truck', 'Benne', 'cars/garbage-truck', 'Lourd', 4.0, 3, 2, 1, 5),
  V('tractor', 'Tracteur', 'cars/tractor', 'Lourd', 3.0, 2, 4, 3, 5),
  V('tractor-police', 'Tracteur Police', 'cars/tractor-police', 'Lourd', 3.0, 3, 3, 3, 5),
  V('tractor-shovel', 'Pelleteuse', 'cars/tractor-shovel', 'Lourd', 3.3, 2, 3, 2, 5),
];

export const vehicleById = (id) => VEHICLES.find((v) => v.id === id) || VEHICLES[0];

// Paramètres physiques dérivés des stats. ccMul : 50cc = plus lent, 150cc = plus rapide.
export function vehicleParams(stats, ccMul = 1) {
  return {
    maxSpeed: (25 + stats.speed * 1.7) * ccMul, // m/s : de ~27 à ~34 en 100cc
    accel: (10 + stats.accel * 2.6) * Math.sqrt(ccMul),
    turn: 1.5 + stats.handling * 0.2, // rad/s
    weight: stats.weight,
    offroad: 0.46 + stats.weight * 0.03, // part de la vitesse gardée hors-piste
  };
}

export const CC_CLASSES = { 50: 0.82, 100: 1, 150: 1.17, 200: 1.35 };
