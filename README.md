# Cardinal Despuig's map — outreach website

Static site (Astro) presenting the town vignettes and the dense interior toponymy of
the *Mapa de la Isla de Mallorca* by Cardinal Antoni Despuig (engraved **1785**). The
interface is in Catalan; the cartouche texts are kept in their original period Spanish.

> **Status.** The project has been re-based from the IGN scan of the reduced 1814/1829
> re-edition onto the **high-resolution original 1785 map** (see *Master image* below).
> The zoomable map (`/mapa`) runs on the new master, and the toponym layer has been
> rebuilt with a **mapKurator** text-spotting pipeline
> ([`scripts/toponims/README.md`](scripts/toponims/README.md);
> rationale in [`docs/mapkurator-text-spotting.md`](docs/mapkurator-text-spotting.md)).
> Still pending on the new master: the vignette hotspots and the toponym overlay on `/mapa`.

## What it includes

- **Interactive frame** (home): the map with clickable zones over the town vignettes
  (being re-measured on the new master).
- **Per-town page** (`/pobles/<slug>`): cropped engraving, original text, Catalan summary,
  census data, Arabic/old name, year of township, harvests, fairs, transcription doubts,
  dependent hamlets and a location mini-map (Leaflet).
- **Zoomable map** (`/mapa`): OpenSeadragon viewer over DZI tiles of the 1785 master.
- **Toponyms** (`/toponims`): table of every transcribed interior toponym, its candidate in
  the *Nomenclàtor Geogràfic de les Illes Balears* (NGIB) and the match state.
- **Data** (`/dades`): population, harvests and foundations + a Leaflet map of every town.
- **About the map** (`/sobre`): history, method and sources.

## Master image (not in git)

The high-resolution master is **gitignored** (too large) and must be placed at:

```
data/jpg/despuig-1785-original.jpg     # 19306 × 14902 (287 Mpx), ~60 MB
```

Source: **Biblioteca Virtual de Defensa**, original 1785 Despuig map, signature
**Ar.G bis-T.3-C.1-023bis**, license **CC BY 4.0**. The path is defined once in
`src/lib/frame.mjs` (`MASTER_REL`); all scripts read it from there.

## Getting started

```bash
npm install
npm run vinetas   # crop the town vignettes from the master → public/vinetas/
npm run dzi       # build the DZI tiles + mapa-web.jpg → public/map/
npm run dev       # development server
npm run build     # static output to dist/
npm run preview   # serve dist/
```

Assets under `public/vinetas/` and `public/map/` are **regenerable** from the master with
the scripts above (hence gitignored). Run `npm run vinetas && npm run dzi` before the first
`build`.

## Toponyms (map interior)

Besides the town vignettes, the interior carries thousands of engraved place names. They
are extracted with a **mapKurator** GPU text-spotting pipeline (detect word polygons →
link into multi-word names → AI recognition → georeference → NGIB match), fully documented
in [`scripts/toponims/README.md`](scripts/toponims/README.md); the rationale and design
are in [`docs/mapkurator-text-spotting.md`](docs/mapkurator-text-spotting.md). This
replaced an earlier blind-grid tiler that mutilated names at cell boundaries.

Versioned outputs: `data/toponims/toponims.json` (viewer layer) and
`data/toponims/ngib/matches.json` (the `/toponims` table). Current state: ~2,500 toponyms;
the georeference is built from **exact hand-marked control points** (≈1 km accuracy), and
NGIB cross-checking (*rapidfuzz* + metaphone) confirms readings and normalises spellings —
distance only disambiguates homonyms, never discards a unique name. Re-run the chain with
the `toponims:*` npm scripts (`link → recog → build → clean → table → georef →
georef-bootstrap → ngib-match`).

## Structure

- `data/` — sources and derived data: the master image (gitignored) and the toponym
  extraction under `data/toponims/` (the table `toponims.json` + the NGIB `matches.json`;
  the heavy mapKurator intermediates under `data/toponims/mapkurator/` are gitignored).
- `src/data/pobles.json` — enriched data for the towns (central, hand-curated artefact).
- `src/lib/frame.mjs` — frame geometry (`IMG`, `MAP` interior, sheet gutters); feeds the
  crops and the hotspots.
- `scripts/` — `crop-vinetas.mjs`, `build-dzi.mjs`, and `scripts/toponims/` for the
  toponym extraction/validation pipeline.
- `docs/` — design/plan documents.

## Deploying under a subdirectory

To serve from a subdirectory, uncomment and adjust `base` in `astro.config.mjs`. Every
link goes through `src/lib/url.mjs`, which respects the `base`.

## Credits

Map image: **Biblioteca Virtual de Defensa** (Archivo Cartográfico del Centro Geográfico
del Ejército), original 1785 edition, signature *Ar.G bis-T.3-C.1-023bis*, **CC BY 4.0**.
Historical context from Picornell, Seguí and Ginard, *Treballs de Geografia* 40 (UIB, 1988)
and Ginard Bujosa et al. on Despuig's map and the *Societat* (Dialnet, 2009).
</content>
