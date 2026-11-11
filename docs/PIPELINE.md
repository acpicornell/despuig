# Toponym pipeline and curation tool

How the toponym data behind the website is produced and hand-curated, sheet by
sheet. Moved here from the top-level README.

The repository holds **two applications** — a public website (see
[`WEBSITE.md`](WEBSITE.md)) and an internal curation tool — plus the **data
pipeline** that feeds them.

## `scripts/toponims/` — the toponym pipeline (per sheet)

The data engine behind both apps. The map is worked **quadrant by quadrant**
(NW/NE/SE/SW): GCPs from hand-marked dots → mapKurator spotter (GPU) → Approach-B vision
reading → assemble → per-sheet georeference (+ dense refinement from confirmed matches) →
NGIB gazetteer match. Quality is recorded on two orthogonal axes: **confidence**
(`decision`) and **human review** (`review`).

Full reproducible recipe: [`scripts/toponims/mapkurator/PER-SHEET.md`](../scripts/toponims/mapkurator/PER-SHEET.md).
Spotter setup: [`scripts/toponims/mapkurator/README.md`](../scripts/toponims/mapkurator/README.md)
— a slim multi-stage GPU image (~5.8 GB; the custom `adet._C` op is baked in).
Pipeline overview: [`scripts/toponims/README.md`](../scripts/toponims/README.md).
Per-sheet outputs live in `data/toponims/<q>/` (versioned); the raw scans (`data/jpg/`),
the gazetteer and the detection intermediates are local-only (regenerable) — note that
the *built* deploy imagery under `web/public/` is versioned (see [`WEBSITE.md`](WEBSITE.md#deploy)).
`node`/`python3` come from the nix
shells (`nix-shell -p nodejs --run …`, `scripts/toponims/{,mapkurator/}shell.nix`).

## `scripts/toponims/review-server.mjs` — the curation tool (internal)

A local, single-file web app used to hand-curate the toponyms quadrant by quadrant. It is
**not part of the deployed website** and is intentionally not documented inside it. Three
views over the same data:

- **Taula** — an editable grid (fast bulk edits: reading, tipus/ordre, NGIB pick, verdict).
- **Fitxes** — one toponym at a time with the engraving crop, the nearby NGIB candidates,
  and a map (click a point to associate its NGIB form).
- **Mapa** — all toponyms on a geographic layer, coloured by confidence.

All hand edits persist to a single overlay per sheet — `data/toponims/<q>/curation.json`,
one record per toponym id, e.g. `{ "graf": "...", "tipus": [...], "ordre": [...], "ngib":
"...", "verdict": "ok|pick|none|trash" }`. Picks are stored as *pending* until the sheet
is baked.

```bash
nix-shell -p nodejs --run 'node scripts/toponims/review-server.mjs'   # http://localhost:4400
```

After a curation round, **bake** the changed sheet(s) and regenerate the website data:

```bash
nix-shell scripts/toponims/shell.nix --run 'python3 scripts/toponims/mapkurator/bake.py <q>'
cd web && npm run data
```
