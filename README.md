# Cardinal Despuig's map — outreach website

Static site (Astro) presenting the **34 town vignettes** of the *Mapa de la Isla de
Mallorca* by Cardinal Antoni Despuig (engraved in 1785; this reduced re-edition carries
1829 census data). The interface is in Catalan; the cartouche texts are kept in their
original period Spanish.

## What it includes

- **Interactive frame** (home): the map with 34 clickable zones over the vignettes.
- **Per-town page** (`/pobles/<slug>`): cropped engraving, original text, Catalan summary,
  data (1829 households/souls, Arabic/old name, year of township, harvests, fairs),
  transcription doubts, dependent hamlets and a location mini-map (Leaflet).
- **Zoomable map** (`/mapa`): OpenSeadragon viewer over DZI tiles, with the clickable
  vignettes and an optional layer of the ~2,100 toponyms read from the map interior.
- **Toponyms** (`/toponims`): review table of every transcribed toponym, its candidate in
  the *Nomenclàtor Geogràfic de les Illes Balears* (NGIB) and the match confidence.
- **Data** (`/dades`): population, harvests and foundations + a Leaflet map of every town.
- **About the map** (`/sobre`): history, method and sources.

## Getting started

```bash
npm install
npm run vinetas   # crop the 34 vignettes from data/jpg/T0023524.jpg → public/vinetas/
npm run dzi       # build the DZI tiles + mapa-web.jpg → public/map/
npm run dev       # development server
npm run build     # static output to dist/
npm run preview   # serve dist/
```

The assets under `public/vinetas/` and `public/map/` are **regenerable** from the master
image `data/jpg/T0023524.jpg` with the scripts above (which is why they are in
`.gitignore`). Run `npm run vinetas && npm run dzi` before the first `build`.

## Toponyms (map interior)

Besides the 34 vignettes, the map interior carries about 2,100 engraved place names. Their
extraction and validation have their own pipeline, documented in
[`scripts/toponims/README.md`](scripts/toponims/README.md): split into cells → vision-AI
transcription → merge → web review, plus a cross-check against the NGIB (*rapidfuzz* +
*spline* georeference with *scipy*) to confirm readings and normalise spellings. The
versioned outputs are `data/toponims/toponims.json` (viewer layer) and
`data/toponims/ngib/matches.json` (the `/toponims` table).

## Structure

- `data/` — original sources (master image, transcription JSON, article PDF) and the
  toponym extraction (`data/toponims/`).
- `src/data/pobles.json` — enriched data for the 34 towns (central, hand-curated artefact).
- `src/lib/frame.mjs` — frame geometry; feeds both the crops and the hotspots.
- `scripts/` — `crop-vinetas.mjs` (crops + `--contact` for a contact sheet) and
  `build-dzi.mjs` (tiles + web image); `scripts/toponims/` for the toponym extraction.

## Deploying under a subdirectory

To serve from a subdirectory (e.g. GitHub Pages), uncomment and adjust `base` in
`astro.config.mjs`. Every link goes through `src/lib/url.mjs`, which respects the `base`.

## Credits

Image: Instituto Geográfico Nacional (sheet 32-H-18), public domain / CC-BY 4.0. Historical
context from Picornell, Seguí and Ginard, *Treballs de Geografia* 40 (UIB, 1988).
</content>
