# Toponym pipeline (per sheet)

Extracts the place names engraved on the Despuig 1785 map, georeferences them, and
matches them against the **NGIB** gazetteer — quadrant by quadrant (NW/NE/SE/SW),
because the 4-sheet gutter distorts a single whole-map fit.

> **Detection by the mapKurator spotter (GPU); reading + grouping by Claude vision.**
> The spotter finds every word box but is weak at recognition and at grouping words
> into names, so we keep only its boxes and let Claude vision read the engraving and
> group the boxes into toponyms, window by window ("Approach B"). Spotter setup:
> [`mapkurator/README.md`](mapkurator/README.md).

## The recipe

The full, reproducible step-by-step (GCPs → spotter → window tracks → vision
extraction workflow → assemble → georeference → dense refinement → NGIB match → review)
lives in **[`mapkurator/PER-SHEET.md`](mapkurator/PER-SHEET.md)**. Per-sheet outputs are
written to `data/toponims/<q>/` (versioned); intermediates under
`data/toponims/mapkurator/<q>/` are regenerable (gitignored). Every script takes the
per-sheet paths via env vars so a run never touches another sheet.

## Two-axis quality model (`ngib_match.py`)

Each toponym carries two **orthogonal** fields (don't conflate "how sure" with "who
says so" — the TEI `@cert` / `@resp` model):

- **`decision` = confidence** (algorithmic, always recomputed): `confirmat` (name
  near-certain) · `probable` (position certain, name a looser variant) · `suggerit`
  (plausible, needs a look) · `posicional` (position only) · `sense` (no match).
  Distance only disambiguates homonyms, never discards a unique name. Name scoring
  (`similarity()`) = rapidfuzz token-sort on article-stripped cores, raised by an
  orthographic fold (18th-c Mallorquí → modern grafia) and a metaphone pass.
- **`review` = human validation** (persistent): `revisat` (confirmed) · `corregit`
  (match changed by hand) · `descartat` (brossa, dropped) · `null` (unreviewed). Fed
  by the review tool's files; re-running the match refreshes confidence without
  destroying the human layer.

## Environment (Nix — no global pip/Homebrew)

`scripts/toponims/shell.nix` (scipy/rapidfuzz/jellyfish) and
`scripts/toponims/mapkurator/shell.nix` (+ Pillow). `node` via `nix-shell -p nodejs`.
The vision steps are Claude **workflows** ([`mapkurator/workflows/`](mapkurator/workflows/)),
launched via the agent. `ngib-fetch.mjs` (re)downloads the NGIB subset → `ngib/llocs.json`.
