export const meta = {
  name: 'b-recheck',
  description: 'Vision recheck of approach-B suggerit toponyms: 30 agents confirm NGIB candidates from the engraving',
  phases: [{ title: 'Read pages' }],
}
const BASE = '/home/acpicornell/projects/despuig/data/toponims/mapkurator/b-recheck'
const PAGES = 30
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { picks: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: { id: { type: 'string' }, grafia: { type: 'string' } },
    required: ['id', 'grafia'] } } },
  required: ['picks'],
}
function prompt(nn) {
  return `You are matching place-names engraved on an 18th-century map of Mallorca against the modern NGIB gazetteer.

Read BOTH files:
- montage image: ${BASE}/r${nn}.png
- candidates:    ${BASE}/r${nn}.json

The montage is a grid of numbered crops (#1..up to 24), 4 columns × 6 rows, row-major. Each crop has a small RED crosshair (+) at its centre marking the exact toponym — read the engraved name AT the crosshair, ignore the neighbours.

The json "items" array gives per crop: n (its number), id, graf (machine reading), nom, and candidates (a list of {grafia, municipi, km, sim} gazetteer names near it).

For each crop, decide whether the engraving CLEARLY matches ONE candidate grafia, allowing period-spelling differences only (Cabo=Cap, Pta=Punta, Sô=Son, Câ=Can; dropped accents; ll↔y; b↔v; ç↔s; h-drop).
- If yes, output a pick with that crop's id and the EXACT grafia string copied from its candidates.
- Otherwise OMIT it. Be conservative: only confident matches. Omit if illegible, if the real name is not among the candidates (many capes/coves aren't in the gazetteer), or if several candidates are equally plausible. A small km helps but the NAME must match the engraving.

Return {"picks": [...]} with only the confident matches (may be empty).`
}
phase('Read pages')
const results = await parallel(Array.from({ length: PAGES }, (_, i) => {
  const nn = String(i + 1).padStart(2, '0')
  return () => agent(prompt(nn), { label: `page ${nn}`, phase: 'Read pages', schema: SCHEMA })
}))
const picks = results.filter(Boolean).flatMap(r => (r && r.picks) || [])
log(`collected ${picks.length} picks across ${results.filter(Boolean).length}/${PAGES} pages`)
return { total: picks.length, picks }
