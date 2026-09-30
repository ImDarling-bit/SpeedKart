# SpeedKart

Course de karts 3D entre potes, dans l'esprit de Mario Kart : 12 circuits, 29 véhicules, objets, dérapages et mini-turbos, tremplins, tapis de vitesse, bots.

La partie tourne en **pair-à-pair**, sur le même modèle que BlindYourFriends : l'hôte fait tourner le moteur sur sa machine, chaque ami s'y connecte directement (WebRTC via PeerJS). Aucun serveur de jeu à héberger.

Modèles 3D : packs Kenney (`PACK_3d/`, licence CC0).

## Jouer

- **Page du jeu** : https://imdarling-bit.github.io/SpeedKart/
- **Lanceur Windows** : https://github.com/ImDarling-bit/SpeedKart/releases/latest (fichier `SpeedKart-Setup-x.y.z.exe`). Il se met à jour tout seul. Au premier lancement, Windows SmartScreen peut afficher un avertissement : « Informations complémentaires », puis « Exécuter quand même ».

L'hôte peut aussi jouer depuis la page, mais le lanceur est plus confortable (plein écran avec F11).

- **Solo** : « Jouer en solo », contre 7 bots, sans connexion internet.
- **Entre amis** : « Créer une partie », puis envoyer le lien ou le code à 4 lettres. Les amis ouvrent la page (navigateur, rien à installer) et tapent le code.

## Commandes

| Action | Clavier | Manette |
|---|---|---|
| Accélérer | ↑ / Z / W | A |
| Freiner, reculer | ↓ / S | B |
| Tourner | ← → / Q D / A D | stick gauche, croix |
| Déraper, sauter | Espace / Maj | RB / RT |
| Objet | E / F / Ctrl | LB / LT |
| Regarder, lancer derrière | C (maintenir) | Y |

Sur téléphone, des boutons tactiles apparaissent (l'accélération est automatique).

## Contenu

**Circuits** (`public/js/data/tracks.js`) : Prairie Kenney, Grand Prix, Centre-Ville, Zone Industrielle (huit avec pont), Toboggan de Marbre, Îles Flottantes, Pic Enneigé, Dunes Dorées, Autoroute Néon, Chantier Infernal, Briques Folies, Route Arc-en-ciel. Trois circuits n'ont pas de barrières : on peut tomber.

**Véhicules** (`public/js/data/vehicles.js`) : 5 karts, 6 bolides de course, 2 sportives, 6 voitures de ville, 5 utilitaires, 5 poids lourds. Chacun a sa vitesse, son accélération, sa maniabilité et son poids.

**Objets** : turbo, triple turbo, banane, carapace verte, carapace rouge (à tête chercheuse), bombe, étoile, bouclier, éclair. Le tirage dépend de la place.

**Réglages de l'hôte** : circuit (ou aléatoire), 1 à 5 tours, 50cc à 200cc, bots (aucun ou compléter à 8) et leur niveau, objets oui/non. Les points s'additionnent d'une course à l'autre (championnat).

## Ajouter un circuit

Ajouter une entrée dans `TRACKS` : une boucle de points `[x, z, hauteur]` (agrandie de 25 %), un thème (`public/js/data/themes.js`), et les positions des tremplins, tapis et boîtes. Puis vérifier :

```bash
npm run simulate           # tous les circuits
npm run simulate -- monid  # un seul
```

La simulation vérifie que le tracé ne se chevauche pas et que 8 bots bouclent 3 tours sans rester bloqués.

## Comment ça marche

- `public/js/room.js` : le moteur de l'hôte (salon, départ, bots, boîtes, objets lancés, classement, points). Il n'a aucune dépendance au navigateur et tourne aussi sous Node.
- `public/js/net.js` : le transport PeerJS. L'id de l'hôte est `speedkart-<CODE>`. Chaque pilote envoie sa position 20 fois par seconde. L'hôte renvoie à tous un instantané (karts, objets, boîtes) 20 fois par seconde, plus les événements (coups, explosions, arrivées).
- `public/js/kart.js` : la physique du kart, la même pour les joueurs et les bots.
- `public/js/track.js` : la géométrie du circuit (Catmull-Rom rééchantillonnée), utilisée pour la physique, l'IA et le rendu.
- `public/js/race.js` : la course côté joueur. On pilote en local (pas de latence dans les commandes). Les autres karts sont affichés avec 110 ms de retard et interpolés.
- `public/js/world.js`, `kartview.js`, `fx.js` : le rendu three.js.
- `public/js/ticker.js` : l'horloge de l'hôte, dans un Web Worker, pour que les bots et les objets continuent de tourner si l'hôte change d'onglet.

Chaque joueur calcule lui-même ses tours et ses collisions, et l'hôte lui fait confiance. C'est fait pour jouer entre amis, pas contre des tricheurs.

## Développement

```bash
npm install
npm start          # la page seule : http://localhost:3000
npm run desktop    # le lanceur Electron
npm run simulate   # circuits et partie simulés, sans navigateur
npm run dist       # construit l'installeur en local dans dist/
```

`public/vendor` (three.js, PeerJS) et `public/assets` (modèles Kenney extraits) sont versionnés : la page marche telle quelle. Pour les régénérer, déposer les zips Kenney dans `PACK_3d/` (non versionné) et lancer `npm run setup`.

## Publication automatique

- **Page du jeu** : chaque modification de `public/` poussée sur `main` est publiée sur GitHub Pages (`.github/workflows/pages.yml`).
- **Nouvelle version du lanceur** :

  ```bash
  npm version patch        # 1.0.0 -> 1.0.1, crée le commit et le tag v1.0.1
  git push --follow-tags
  ```

  GitHub lance la simulation, construit l'installeur et le publie dans les releases (`.github/workflows/release.yml`). Les lanceurs installés le téléchargent en arrière-plan et l'installent à leur prochaine fermeture.

### Connexions difficiles

Comme pour BlindYourFriends, environ 10 à 20 % des connexions directes échouent derrière certains réseaux mobiles ou pare-feux. Ajouter un relais TURN dans `iceServers` (`public/config.js`).
