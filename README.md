# Forever Crafter

Site pour WoW Forever : on entre le nom de son perso et on obtient
1. **un plan de montée** de chaque métier de fabrication, du skill actuel jusqu'à 300, au plus bas coût net (composants − revente) ;
2. **les recettes qui font du gold** au skill actuel (profit, ROI, ventes/jour).

Un seul Cloudflare Worker (plan gratuit) sert le site et une petite API. La clé Battle.net reste côté serveur : tes amis n'ont besoin de rien.

## Sources de données

| Donnée | Source | Rafraîchissement |
|---|---|---|
| Perso, niveau, métiers, skill (et recettes connues si Blizzard les donne) | API Battle.net, namespace `profile-forever-{region}` | cache 10 min |
| Prix, coûts, profits, ventes/jour | [Forever AH](https://forever-ah.com/api/) (lit l'API HV de Blizzard) | cache 1 h |
| Seuils orange/jaune/vert/gris, source des recettes | [MetaBot.gg](https://metabot.gg/en/wow-forever/professions) (client WoW Forever) | à la main (`scripts/extract-metabot.js`) |

Forever Economy n'a pas d'API publique, d'où Forever AH (même source Blizzard, horaire).

## Installation (≈ 15 min)

1. **Données des recettes** : copie `forever-recipes-skill.json` (déjà dans tes Téléchargements) vers `public/data/recipes.json`.
   Pour le refaire plus tard : voir `scripts/extract-metabot.js`.
2. **Clé Battle.net** : sur <https://develop.battle.net/access/clients>, crée un client (nom libre, pas de redirect URL nécessaire). Note le Client ID et le Secret.
3. **Déploiement** (Node 20+) :
   ```bash
   npm install
   npx wrangler login
   npx wrangler kv namespace create CACHE   # colle l'id dans wrangler.toml (bloc kv_namespaces)
   npx wrangler secret put BNET_CLIENT_ID
   npx wrangler secret put BNET_CLIENT_SECRET
   npm run deploy
   ```
   Wrangler affiche l'URL `https://forever-crafter.<ton-compte>.workers.dev` : c'est le lien à partager.
   Domaine perso (ex. `wow.samuelurbain.com`) : Cloudflare → Workers → forever-crafter → Settings → Domains.
4. **Test local** : `npm run dev` (crée un fichier `.dev.vars` avec `BNET_CLIENT_ID=...` et `BNET_CLIENT_SECRET=...`, ne le committe pas).
   Tests du calcul : `npm test`.

Lien direct partageable : `https://…/?name=Ada%20Brightwood&region=us`

## Comment le plan est calculé

- Chance de gagner un point : orange 100 %, sinon `(gris − skill) / (gris − jaune)`.
- À chaque point, la recette retenue est celle au plus faible **coût net espéré par point** :
  `(coût des composants − revente + 25c de « temps ») / chance`.
- Revente = valeur HV − 5 % de commission, seulement si l'objet se vend au moins une fois par jour ; sinon prix marchand.
- Recettes « maître » et « auto » toujours disponibles ; les recettes à acheter / drop sont incluses si la case est cochée (cochée par défaut) et marquées **à obtenir**.
- Le plan signale les paliers de maître (75, 150, 225).
- Onglet gold : « potentiel/jour » = profit × min(ventes/jour, 10).

## Limites connues

- Un seuil d'apprentissage marqué `*` est estimé par MetaBot (le client ne le donne pas).
- Une recette sans prix pour un composant est ignorée dans le plan.
- Les ventes/jour de Forever AH sont des estimations (annonces disparues entre deux scans).
- WoW Forever a 5 HV par faction et par région dans l'API ; « Tous les HV de la région » est le choix par défaut.

Site de fans, non affilié à Blizzard Entertainment. Crédite Forever AH, l'API Battle.net et MetaBot.gg si tu le rends public.
