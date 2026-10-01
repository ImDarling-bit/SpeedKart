# SpeedKart

Jeu de voitures 3D entre potes, dans l'esprit de Mario Kart et Rocket League : 14 circuits (dont 9 avec loopings), 29 véhicules, objets, pouvoirs aléatoires, dérapages et mini-turbos, trois modes en arène (auto-tamponneuses, foot turbo, bataille de ballons) et un mode police contre voleurs dans trois villes, avec quatre règles. Des bots complètent les parties.

**Pas à pas pour installer et jouer : [le tuto](https://imdarling-bit.github.io/SpeedKart/tuto.html)** (aussi dans `public/tuto.html`).

La partie tourne en **pair-à-pair**, sur le même modèle que BlindYourFriends : l'hôte fait tourner le moteur sur sa machine, chaque ami s'y connecte directement (WebRTC via PeerJS). Aucun serveur de jeu à héberger.

Modèles 3D : packs Kenney (`PACK_3d/`, licence CC0).

## Jouer

- **Page du jeu** : https://imdarling-bit.github.io/SpeedKart/
- **Lanceur Windows** : https://github.com/ImDarling-bit/SpeedKart/releases/latest (fichier `SpeedKart-Setup-x.y.z.exe`). Il se met à jour tout seul. Au premier lancement, Windows SmartScreen peut afficher un avertissement : « Informations complémentaires », puis « Exécuter quand même ».

L'hôte peut aussi jouer depuis la page, mais le lanceur est plus confortable (plein écran avec F11).

- **Solo** : « Jouer en solo », contre 7 bots, sans connexion internet.
- **Entre amis** : « Créer une partie », puis envoyer le lien ou le code à 4 lettres. Les amis ouvrent la page (navigateur, rien à installer) et tapent le code.

## Commandes

Toutes les touches se changent dans **Paramètres → Commandes**. Le tableau donne les touches par défaut.

| Action | Course | Arènes et police | Manette |
|---|---|---|---|
| Avancer, freiner | ↑ ↓ / Z S / W S | ↑ ↓ / Z S | course : A, B · arènes : RT, LT |
| Tourner | ← → / Q D / A D | idem | stick gauche, croix |
| Déraper | Espace / Maj | – | RB / RT |
| Sauter (2× : figure) | – | Espace | A |
| Turbo | – | Maj | B |
| Glisser, vrille en l'air | – | X / Alt | X |
| Caméra ballon (foot) | – | C | Y |
| Objet / gadget 1 | E / Ctrl | E / Entrée | LB |
| Pouvoir spécial / gadget 2 | R | R | croix ↑ |
| Gadget 3 (police) | – | F | Y |
| Klaxon | H | H | clic stick gauche |
| Emotes | 1 à 6 | 1 à 6 | croix ↓ |
| Pause | Échap | Échap | Start |

Sur téléphone et tablette, des commandes tactiles apparaissent : joystick ou boutons, au choix dans les paramètres (en course, l'accélération est automatique).

**Paramètres** (écran titre ou menu pause) : qualité graphique, taille du HUD, champ de vision, distance de la caméra, secousses, volume général et volume du moteur, disposition tactile, touches.

## Modes

- **Course** : 14 circuits. Options **pouvoirs aléatoires** (24 pouvoirs, un nouveau tiré à chaque usage, sans répétition rapprochée : géant, échange de place, téléportation, gel, encre, comète sur le premier...) et **physique tamponneuse** (chocs qui envoient en tonneau, gravité qui ondule).
- **Auto-tamponneuses** : plateforme flottante ; +1 point par adversaire retourné, +2 par éjection. La gravité change toutes les 14 s (lunaire, écrasante, penchée, folle).
- **Foot turbo** : façon Rocket League. Bleus contre Orange (1c1 à 4c4), ballon géant, saut, double saut et figures, turbo et pastilles, conduite sur les murs et le plafond, prolongation en but en or.
- **Bataille de ballons** : 1 à 5 ballons chacun, objets dans l'arène, dernier debout gagne. Pouvoirs en option.
- **Police contre voleurs** : dans une ville (Centre-ville, Zone industrielle, Port), environ un tiers des joueurs sont policiers, en voiture de police imposée. Les rôles tournent à chaque manche (2 à 4 manches). Les voleurs ont 5 s d'avance, et la police ne voit sur sa carte que les voleurs proches. Quatre règles au choix :
  - **Braquage** : les voleurs ramassent des sacs d'argent et les déposent dans les planques. Un voleur arrêté va en prison, et un complice peut le libérer en roulant sur le bouton.
  - **Chasse** : il faut survivre jusqu'à la fin du temps. Un voleur arrêté est éliminé.
  - **Contamination** : un ou deux policiers au départ, et chaque voleur arrêté devient policier.
  - **Évasion** : les sorties de la ville ouvrent au bout de 20 s, et il faut en franchir une. Un voleur arrêté repart du départ.
  - Gadgets de la police : sirène (révèle les voleurs), herse, barrage de cônes. Gadgets des voleurs : nitro, fumigène (aveugle), flaque d'huile.

Les arènes de foot et d'auto-tamponneuses s'agrandissent avec le nombre de joueurs, jusqu'à environ 2 fois leur taille.

## Contenu

**Circuits** (`public/js/data/tracks.js`) : Prairie Kenney, Grand Prix, Centre-Ville, Zone Industrielle (huit avec pont), Toboggan de Marbre, Îles Flottantes, Pic Enneigé, Dunes Dorées, Autoroute Néon, Chantier Infernal, Briques Folies, Route Arc-en-ciel, Grand Huit, Hyperloop. Trois circuits n'ont pas de barrières : on peut tomber. Les loopings demandent de l'élan : un tapis de vitesse est placé juste avant.

**Véhicules** (`public/js/data/vehicles.js`) : 5 karts, 6 bolides de course, 2 sportives, 6 voitures de ville, 5 utilitaires, 5 poids lourds. Chacun a sa vitesse, son accélération, sa maniabilité, son poids et son bruit de moteur (kart, sportive, voiture, poids lourd). Chaque joueur choisit sa couleur et son klaxon.

**Objets** : turbo, triple turbo, banane, carapace verte, carapace rouge (à tête chercheuse), bombe, étoile, bouclier, éclair. Le tirage dépend de la place.

**Réglages de l'hôte** : mode, circuit (ou aléatoire), tours, cylindrée, durée, taille des équipes, nombre de ballons, bots et leur niveau, objets, pouvoirs, physique tamponneuse. Les points s'additionnent d'une partie à l'autre (championnat).

## Ajouter un circuit

Ajouter une entrée dans `TRACKS` : une boucle de points `[x, z, hauteur]` (agrandie de 25 %), un thème (`public/js/data/themes.js`), et les positions des tremplins, tapis, boîtes et loopings (`loops: [[position, rayon]]`, sur une ligne droite d'environ 200 m). Puis vérifier :

```bash
npm run simulate           # tous les circuits
npm run simulate -- monid  # un seul
```

La simulation vérifie que le tracé ne se chevauche pas, que les loopings sont bien placés (élan avant, rien dedans) et que 8 bots bouclent 3 tours sans rester bloqués. Elle joue aussi jusqu'au bout une course avec pouvoirs et chaos, les trois modes en arène et la police contre voleurs avec ses quatre règles. Pour ne lancer qu'une partie : `npm run simulate -- race`, `-- arena` ou `-- cops`.

## Comment ça marche

- `public/js/room.js` : le cœur de l'hôte (salon, profils, réglages, chargement, résultats, points). Chaque mode a son module : `modes/racegame.js` (course, objets, pouvoirs), `modes/arenagame.js` (tamponneuse, foot, bataille) et `modes/copsgame.js` (police contre voleurs : manches, rôles, arrestations, gadgets). Rien ne dépend du navigateur : tout tourne aussi sous Node.
- `public/js/city.js` : les villes, générées à partir d'une grille de pâtés de maisons (immeubles, parcs, entrepôts, prison, eau). On en tire la géométrie de collision, le graphe des carrefours (A* pour les bots de `copsbot.js`), les planques et les sorties. Le rendu est dans `cityview.js` et la partie côté joueur dans `copsplay.js`.
- `public/js/app.js` : l'interface. Elle comprend l'écran titre animé (`title.js`), le salon en 4 étapes (mode, véhicule, carte, salle), le menu pause, les paramètres (`settings.js`) et le podium 3D (`podium.js`).
- `public/js/net.js` : le transport PeerJS. L'id de l'hôte est `speedkart-<CODE>`. Chaque pilote envoie sa position 20 fois par seconde. L'hôte renvoie à tous un instantané (véhicules, ballon, objets, boîtes) 20 fois par seconde, plus les événements (coups, buts, pouvoirs, klaxons, emotes).
- `public/js/kart.js` : la physique arcade des karts (course), loopings et effets des pouvoirs compris.
- `public/js/car3d.js` : la physique 3D des arènes (corps rigide, roues qui collent aux murs, saut, figures, ballon). Les arènes sont décrites par des fonctions de distance (`arena.js`).
- `public/js/track.js` : la géométrie du circuit (Catmull-Rom rééchantillonnée, loopings insérés), utilisée pour la physique, l'IA et le rendu.
- `public/js/race.js` et `arenaplay.js` : la partie côté joueur. On pilote en local (pas de latence dans les commandes). Les autres sont affichés avec ~100 ms de retard et interpolés. Au foot, le ballon est aussi simulé en local pour que nos frappes soient immédiates.
- `public/js/world.js`, `arenaview.js`, `kartview.js`, `fx.js` : le rendu three.js. `audio.js` : tous les sons, synthétisés (moteur avec régime et boîte de vitesses).
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
