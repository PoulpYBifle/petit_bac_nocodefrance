## Convex Notes

Le CLI `convex` n'a pas pu etre initialise localement sur cette machine car `npx convex --help`
plante avec `TypeError: styleText is not a function` sous `Node.js v20.11.0`.

Pour ne pas bloquer le MVP, l'application actuelle tourne en mode local synchronise via
`localStorage` + `BroadcastChannel`, avec une structure de donnees alignee sur le plan
backend pour faciliter le branchement suivant :

- `rooms`
- `players`
- `rounds`
- `submissions`
- `votes`
- `categoryCatalog`

Le schema est deja pose dans [schema.ts](/Users/sachap/DEV/petit_bac_nocode/convex/schema.ts).
L'etape suivante consiste a :

1. lancer le projet avec une version de Node compatible avec le CLI Convex
2. executer `npx convex dev`
3. generer `_generated/`
4. remplacer le store local par des `query` / `mutation` / `action` Convex
