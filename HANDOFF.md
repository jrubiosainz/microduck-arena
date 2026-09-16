# Reprise : la page de publication de Microduck Arena

Tu reprends une fonctionnalité déjà construite et testée en local, avec cinq retours
du propriétaire à traiter. Lis ce fichier en entier avant d'agir.

## Où travailler

- Worktree : `/Users/nicolasrabault/Projects/HuggingFace/microduck-arena/.claude/worktrees/publication`,
  branche `publication-page`, déjà rebasée sur `origin/main`. Lance toutes les commandes
  depuis ce dossier, jamais depuis le checkout parent.
- **Ne jamais `git push`** : un push sur `main` déploie le Space de production.
- Python : `uv run --frozen ...` toujours (sans `--frozen` le miroir uv local réécrit `uv.lock`).
  Lint : `uv run --frozen ruff check arena tests` (longueur de ligne 100).
- JS : `cd app && npx vitest run`. `app/src/brightness.test.js` a 4 échecs préexistants
  sous ce Node, ils ne sont pas de toi. `npm run build` doit passer.
- Un serveur de test tourne peut-être encore sur le port 8001 :
  `uv run --frozen arena serve --store ~/arena-board-pub --user nicolas --port 8001`.
  Le store `~/arena-board-pub` contient 5 runs sur `sprint-2m` ; celui de `nicolas` est
  `01M2KH535KFRC7XS373WF3`. Pour rejouer la révélation : `rm -rf ~/arena-board-pub/seen`.
  Après un `npm run build`, recharge en forçant le cache (Cmd+Maj+R) : `race.css` et
  `club.css` sont servis sans empreinte dans leur nom.

## Ce qui existe déjà

Une page `#/r/<run_id>` (« publication ») montre un run publié : le replay 3D contre les
trois ducks classés juste en dessous, le temps, la place sur le board, les points gagnés.
La première fois que **l'auteur** l'ouvre, une révélation se joue une seule fois, puis un
fichier `seen/<run_id>.json` est écrit côté store ; tout autre visiteur et toute visite
ultérieure voient la page complète sans théâtre. On y arrive par un clic sur une ligne du
board, par la liste `Publications` du profil, et automatiquement après un Publish.

Séquence actuelle de la révélation (`app/src/reveal.js`) : la course joue une fois →
victoire + confettis → les temps de seed apparaissent un par un → le tampon
`FINISHED n/m` claque → le temps roule en split-flap → la ligne de l'auteur monte dans le
pegboard → pour chaque reçu de points, une pluie d'étoiles `✦` (une par point) vole vers
le chip en haut à droite, dont le compteur roule ensuite.

Fichiers principaux :

| Fichier | Rôle |
| --- | --- |
| `app/src/run.js` | la page : construit tout le DOM, décide mode plain ou reveal, pilote le viewer |
| `app/src/reveal.js` | le séquenceur des beats ; `revealFor` et `climbPlan` sont purs et testés |
| `app/src/points.js` | la pluie d'étoiles (`shower`) et le compteur du chip (`credit`) ; `plan` est pur et testé |
| `app/src/animation.js` | primitives portées de Duck Jam : `ended`, `slam`, `confetti`, `rollCounter`, `climb`, `flipTiles` |
| `app/src/sound.js` | un seul module son pour le vote et le théâtre ; `play(cue)` ne lève jamais |
| `app/public/race.css` | placement de la page et toutes les animations (`seed-in`, `star-in`, `star-fly`, `fly`…) |
| `arena/web/routes_read.py` | `GET /api/runs/{id}` (rang, fenêtre du board, reçus, `seen`) et `publications` du profil |
| `arena/web/routes_submit.py` | `POST /api/runs/{id}/seen`, réservé à l'auteur, idempotent |
| `arena/store.py` | `mark_seen` / `seen()` sur LocalStore et HubStore |
| `arena/index.py` | `standing()` : où se place un run face au meilleur de chaque autre joueur |

Spec et plan d'origine : `docs/superpowers/specs/2026-09-15-publication-page-design.md`
et `docs/superpowers/plans/2026-09-15-publication-page.md`. Ils décrivent l'état visé
avant les cinq retours ci-dessous ; en cas de contradiction, ce sont les retours qui
gagnent, et il faudra mettre la spec à jour.

## Les cinq retours à traiter

1. **La légende des couleurs ne correspond pas à la scène.** `run.js` construit la légende
   avec `LANE_CSS[i]` (orange, ciel, lime, lavande), mais passe `tier: i === 0 ? "leader"
   : "ghost"` à `viewer.setLanes`, donc les anneaux au sol prennent `TIER_MARKER` :
   orange pour le premier, blanc pâle à 40 % d'opacité pour les trois autres. La page de
   vote (`app/src/vote.js`) résout déjà ce problème en passant `colour:
   LANE_COLORS[i % LANE_COLORS.length]` à chaque entrée ; `buildMarker` accepte cette
   surcharge. Fais pareil ici. Vérifie aussi les bandes au sol tracées par `buildCourse`.

2. **Le placement des éléments a régressé.** L'ajout de la section des seeds entre la scène
   et le scoreboard a déplacé le reste et le propriétaire trouve ça moins bien qu'avant.
   À reprendre avec le point 4.

3. **Pas d'animation sur les seeds, et la liste doit être repliée.** Supprime le beat
   `seeds` du séquenceur, la classe `seed-in` et ses keyframes, et rends la liste des
   seeds repliée par défaut (un `<details>` dans l'idiome du projet). Elle redevient un
   détail consultable, pas une étape du spectacle.

4. **L'animation des points n'a pas été vue, sans doute parce qu'elle demande de faire
   défiler la page.** Le propriétaire propose de tenir toute la page en un seul écran,
   sans défilement. C'est un vrai changement de mise en page, pas un correctif : **passe
   par la skill `superpowers:brainstorming` et fais-lui valider une maquette avant de
   coder.** Points durs à lui soumettre : la scène 3D fait `44vh` aujourd'hui ; le
   scoreboard, le pegboard (jusqu'à 8 lignes) et les stickers de points doivent tenir avec
   elle ; le chip en haut à droite doit rester visible pendant le vol des étoiles (d'où
   `.signage--pinned` aujourd'hui) ; et il faut que ça tienne aussi sur un écran de
   portable. Les appels à `scrollIntoView` dans `reveal.js` disparaîtront si la page tient
   en un écran.

5. **Le contexte de la session précédente était plein**, d'où cette reprise. Rien à faire,
   sinon savoir que les décisions listées ici viennent du propriétaire lui-même.

## Décisions déjà prises, à ne pas rouvrir

- Une seule trace 3D par run, celle de la seed médiane finissante ; on ne la change pas.
- Le drapeau « vu » est un fichier par run côté serveur, jamais du `localStorage`.
- Les sons vont **par grappe** (au plus un par cue toutes les 40 ms), jamais un par étoile.
- Le pegboard reste entre le temps et les points.
- La caméra suit le duck en tête, comportement inchangé.
- Le kit son vit dans `app/public/sound/` avec son `PROVENANCE.md` (CC0, vendu depuis
  duckJam). Toute nouvelle vendorisation met ce fichier à jour.
- Les tests restent au strict minimum : le propriétaire ne veut pas de tests superflus.
  Le théâtre se vérifie dans le navigateur, pas dans jsdom.

## Dette connue, non bloquante

- `/api/me` replie tout le journal des runs à chaque page ; accepté, à mémoïser plus tard.
- Au premier déploiement, tous les runs historiques seront « non vus » : soit on écrit
  `seen/` pour tout ce qui précède la release, soit on l'assume. Décision du propriétaire.
- `race.css` et `club.css` sont servis sans empreinte : le cache navigateur a déjà masqué
  une correction. Une empreinte ou un `Cache-Control` sur `/public` réglerait ça.
- La branche n'est pas fusionnée. Quand ce sera prêt, proposer merge local, PR, ou rien.

## Comment vérifier ton travail

Le propriétaire teste dans un navigateur ; tu n'en as probablement pas. Construis le
bundle, relance le serveur sur 8001, efface `~/arena-board-pub/seen`, vérifie ce que tu
peux via `curl` sur l'API, puis demande-lui de regarder et dis-lui précisément quoi
observer. Ne prétends jamais avoir vu l'animation.
