# El mapa del Cardenal Despuig (1785)

[![Deploy](https://github.com/acpicornell/despuig/actions/workflows/deploy.yml/badge.svg)](https://github.com/acpicornell/despuig/actions/workflows/deploy.yml)

Outreach edition of the *Mapa de la Isla de Mallorca* by Cardinal Antoni Despuig,
engraved **1785** (high-resolution original from the Biblioteca Virtual de Defensa,
CC BY 4.0): its place names are read off the engraving, curated by hand,
georeferenced and matched against the NGIB gazetteer, alongside its towns.

**Live site:** <https://despuig.corpusbalear.org> — part of
[Corpus Balear](https://corpusbalear.org).

## What's in it

- Town pages: 1785 census, cartela text, clean vignette and locator map.
- A filterable/sortable table of the ~2,515 curated toponyms.
- **Mapa** — an interactive geographic layer.
- **El gravat** — a deep-zoom viewer of the engraving.
- Statistics ("the 1785 map" vs "our reading process"). Catalan UI; cartela
  texts kept in their original period spelling.

## How it was made

The map is worked quadrant by quadrant (NW/NE/SE/SW): a mapKurator text spotter
finds the word boxes, vision reading groups them into names, and each sheet is
georeferenced from hand-marked control points and matched against the NGIB. Every
toponym is hand-curated in an internal tool before being baked into the site's data.

## Run locally

```bash
cd web
npm install
npm run dev         # http://localhost:4330  (npm run build → web/dist)
```

The pipeline runs inside nix shells. Every npm script, the deploy and the
curation round are in the documentation below.

## Documentation

- [`docs/WEBSITE.md`](docs/WEBSITE.md) — the Astro site: npm scripts, generated
  data, deploy to Cloudflare Workers, self-hosted vendor assets and CSP.
- [`docs/PIPELINE.md`](docs/PIPELINE.md) — the per-sheet toponym pipeline, its
  environment, and the internal curation tool.
- [`docs/mapkurator-text-spotting.md`](docs/mapkurator-text-spotting.md) — notes on
  the text-spotting detection step (the original plan, now implemented).
- [`docs/vignettes-contact-sheet.png`](docs/vignettes-contact-sheet.png) — contact
  sheet of the 34 town vignettes, labelled by their position on the border.

## License

- **Code** (the pipeline, the `web/` site, all scripts) — **© Antonio Picornell,
  [AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.html)** (see [`LICENSE`](LICENSE)).
  Strong copyleft with a network clause: anyone who uses, modifies, or runs this
  code as a network service must release their complete source under the AGPL too,
  keeping attribution.
- **Toponym data** (`data/toponims/<q>/*.json` and the derived `web/src/data/`) —
  **© Antonio Picornell, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)**:
  free to reuse for non-commercial purposes **with attribution**. See
  [`data/toponims/LICENSE.md`](data/toponims/LICENSE.md).
- The engraving itself is a historical work; the high-resolution master comes from the
  **Biblioteca Virtual de Defensa** (CC BY 4.0). Canonical name forms come from the
  **NGIB** and keep their own terms; the vendored web libraries/fonts keep theirs
  (see [`web/public/vendor/README.md`](web/public/vendor/README.md)).
