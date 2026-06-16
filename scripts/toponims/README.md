# Toponym pipeline

Tools for extracting and validating the place names engraved on the Despuig map.

## Extraction (vision AI)

1. `npm run toponims:subtiles` — slice the map interior into 182 cells (×3 renders)
   under `data/toponims/sub/`.
2. The cells are transcribed by vision AI into `data/toponims/cells/<id>.json`
   (schema: `nom`, `graf`, `tipus`, `dubte`, `fx`, `fy`).
3. `npm run toponims:merge` — assemble the cells into `data/toponims/toponims.json`
   (computes master-image `x,y` from `fx,fy`, de-duplicates overlaps).
4. `npm run toponims:review` — local web tool to correct readings / drag points.

## Validation against the NGIB gazetteer

The vision readings are noisy (many illegible engravings → flagged `dubte`). We
cross-check them against the **Nomenclàtor Geogràfic de les Illes Balears (NGIB)**,
the authoritative UIB-normalised gazetteer (field `GRAFIA`), to confirm readings,
normalise spellings and clear doubt flags.

1. `npm run toponims:ngib-fetch` — download the Mallorca subset (`ILLA=1`,
   ~36.9k named places) from the NGIB REST service into
   `data/toponims/ngib/llocs.json`. (Node, no extra deps.)
2. `npm run toponims:ngib-match` — match every toponym against the gazetteer and
   write `data/toponims/ngib/matches.json`. (Python — see below.)

### `ngib_match.py`

Python because the matching needs a proper fuzzy/geospatial stack:

- **rapidfuzz** — `token_sort_ratio` (penalises extra/missing tokens, so a name
  is not a false perfect match to a longer NGIB entry that merely contains it).
- **jellyfish** — metaphone, to catch historic spelling variants; applied only to
  refine an already-plausible literal match, never to rescue distant strings.
- **scipy** — a smoothing thin-plate spline (`RBFInterpolator`) builds the
  pixel→lon/lat georeference from the curated towns in `src/data/pobles.json`
  (~1.3 km leave-one-out error), and `cKDTree` does the nearest-neighbour search.

Each toponym is classified: `confirmat` (high-confidence, safe to auto-apply),
`suggerit` (review candidate), `posicional` (illegible but one close candidate),
`sense` (no match — likely a vanished estate or unrecoverable reading).

### Environment (Nix)

The Python deps are declared in `shell.nix` (no Homebrew, no global pip). Run via:

```sh
nix-shell scripts/toponims/shell.nix --run "python3 scripts/toponims/ngib_match.py"
```

`npm run toponims:ngib-match` wraps exactly this.
