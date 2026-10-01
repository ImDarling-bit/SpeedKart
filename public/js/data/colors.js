// Teintes proposées pour personnaliser son véhicule. 'aucune' garde les couleurs du modèle.
export const KART_COLORS = [
  { id: 'aucune', name: 'Origine', hex: null },
  { id: 'rouge', name: 'Rouge', hex: '#ff3b3b' },
  { id: 'orange', name: 'Orange', hex: '#ff8a1f' },
  { id: 'jaune', name: 'Jaune', hex: '#ffd23f' },
  { id: 'vert', name: 'Vert', hex: '#38d96b' },
  { id: 'cyan', name: 'Cyan', hex: '#2fd6ff' },
  { id: 'bleu', name: 'Bleu', hex: '#3b6bff' },
  { id: 'violet', name: 'Violet', hex: '#9b4dff' },
  { id: 'rose', name: 'Rose', hex: '#ff5fc8' },
  { id: 'noir', name: 'Noir', hex: '#2a2a33' },
  { id: 'blanc', name: 'Blanc', hex: '#f4f4f8' },
  { id: 'or', name: 'Or', hex: '#e8b93a' },
];

export const colorHex = (id) => KART_COLORS.find((c) => c.id === id)?.hex || null;

// Couleurs des équipes du mode foot.
export const TEAM_COLORS = { blue: '#2f7bff', orange: '#ff8a1f' };
