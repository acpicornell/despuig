# El mapa del Cardenal Despuig — web divulgativa

Web estàtica (Astro) per divulgar les **34 viñetas de pobles** del *Mapa de la Isla de
Mallorca* del Cardenal Antoni Despuig (gravat el 1785; aquesta reedició reduïda porta dades
censals de 1829). Interfície en català; els textos de les cartelas es conserven en el seu
castellà d'època original.

## Què inclou

- **Marc interactiu** (portada): el mapa amb 34 zones clicables sobre les viñetas.
- **Fitxa per poble** (`/pobles/<slug>`): gravat retallat, text original, resum en català,
  dades (veïns/ànimes 1829, nom àrab/antic, any de vila, collites, fires), dubtes de
  transcripció, llogarets dependents i mini-mapa de situació (Leaflet).
- **Mapa amb zoom** (`/mapa`): visor OpenSeadragon sobre tessel·les DZI, amb les viñetas
  clicables.
- **Dades** (`/dades`): població, collites i fundacions + mapa Leaflet de tots els pobles.
- **Sobre el mapa** (`/sobre`): història, mètode i fonts.

## Posada en marxa

```bash
npm install
npm run vinetas   # retalla les 34 viñetas de data/jpg/T0023524.jpg → public/vinetas/
npm run dzi       # genera les tessel·les DZI + mapa-web.jpg → public/map/
npm run dev       # servidor de desenvolupament
npm run build     # sortida estàtica a dist/
npm run preview   # serveix dist/
```

Els assets de `public/vinetas/` i `public/map/` són **regenerables** des de la imatge mestra
`data/jpg/T0023524.jpg` amb els scripts de dalt (per això estan al `.gitignore`). Executa
`npm run vinetas && npm run dzi` abans del primer `build`.

## Estructura

- `data/` — fonts originals (imatge mestra, JSON de transcripció, article PDF).
- `src/data/pobles.json` — dades enriquides dels 34 pobles (artefacte central, curat a mà).
- `src/lib/frame.mjs` — geometria del marc; alimenta alhora els retalls i els hotspots.
- `scripts/` — `crop-vinetas.mjs` (retalls + `--contact` per a full de contacte) i
  `build-dzi.mjs` (tessel·les + imatge web).

## Desplegament en subdirectori

Per servir des d'un subdirectori (p. ex. GitHub Pages), descomenta i ajusta `base` a
`astro.config.mjs`. Tots els enllaços passen per `src/lib/url.mjs`, que respecta el `base`.

## Crèdits

Imatge: Instituto Geográfico Nacional (fitxa 32-H-18), domini públic / CC-BY 4.0. Context
històric a partir de Picornell, Seguí i Ginard, *Treballs de Geografia* 40 (UIB, 1988).
