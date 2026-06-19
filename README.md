# El mapa del Cardenal Despuig (1785)

Outreach project around the *Mapa de la Isla de Mallorca* by Cardinal Antoni Despuig,
engraved **1785** (high-resolution original from the Biblioteca Virtual de Defensa,
CC BY 4.0). Two parts:

## `web/` — the public website (Astro, static)

The site: town pages (1785 census + cartela text + clean vignette + locator map),
a filterable table of the ~2,570 toponyms, an interactive **Mapa** (geographic layer +
deep-zoom of the engraving), and statistics. Catalan UI; cartela texts kept in their
original period spelling.

```bash
cd web
npm install
npm run data        # build src/data/*.json from the per-sheet pipeline output
npm run vinetes     # town vignettes  (needs data/jpg/, local-only)
npm run hero        # homepage hero crop
npm run map         # DZI tiles for the engraving deep-zoom (slow; only when the master changes)
npm run dev         # http://localhost:4330
npm run build       # → web/dist  (prebuild runs data + vinetes + hero)
```

Deploy = **Cloudflare Pages Direct Upload** (build locally because the source images are
not in git): `npm run deploy` (= build + `wrangler pages deploy dist`).

## `scripts/toponims/` — the toponym pipeline (per sheet)

The map is worked **quadrant by quadrant** (NW/NE/SE/SW): GCPs from hand-marked dots →
mapKurator spotter (GPU) → Approach-B vision reading → assemble → per-sheet georeference
(+ dense refinement from confirmed matches) → NGIB gazetteer match. Quality is recorded
on two orthogonal axes: **confidence** (`decision`) and **human review** (`review`).

Full reproducible recipe: [`scripts/toponims/mapkurator/PER-SHEET.md`](scripts/toponims/mapkurator/PER-SHEET.md).
Spotter setup: [`scripts/toponims/mapkurator/README.md`](scripts/toponims/mapkurator/README.md).
Per-sheet outputs live in `data/toponims/<q>/` (versioned); the gazetteer and large
image/tile assets are local-only (regenerable). `node`/`python3` come from the nix
shells (`nix-shell -p nodejs --run …`, `scripts/toponims/{,mapkurator/}shell.nix`).
