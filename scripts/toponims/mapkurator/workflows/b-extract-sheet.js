// Approach-B vision extraction for ONE quadrant sheet (page-by-page pipeline).
// Reference script — set BASE to the sheet's window dir and N to the window count
// (printed by b_windows.py), then run via the Workflow tool. One agent per window
// groups the spotter boxes into toponyms and reads them DIPLOMATICALLY (Sô/Câ kept).
// Save the returned {windows:[...]} to <BASE>/extract.json for b_assemble.py.
//
// NW (NO) run 2026-06-18: BASE=.../no/b, N=18 → 599 toponyms.
export const meta = {
  name: 'b-extract-sheet',
  description: 'Approach B extraction for one quadrant sheet: N agents read map windows, group spotter boxes into toponyms and read them diplomatically',
  phases: [{ title: 'Extract', detail: 'one agent per sheet window' }],
}

const BASE = '/home/acpicornell/projects/despuig/data/toponims/mapkurator/no/b'
const N = 18
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    toponims: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          boxes: { type: 'array', items: { type: 'number' } },
          reading: { type: 'string' },
        },
        required: ['boxes', 'reading'],
      },
    },
  },
  required: ['toponims'],
}

function prompt(nn) {
  return `You are transcribing place-names from an 18th-century engraved map of Mallorca (Despuig, 1785). Names are in Mallorqui/Catalan with period spelling (So = Son, Ca = Can, accents written as circumflex o a e, ll/y, b/v).

Read BOTH files:
- window image: ${BASE}/w${nn}.png
- detected word boxes: ${BASE}/w${nn}.json

Each red box in the image is a detected word; its number is printed at its top-left corner. The json "words" array lists per box: n (number) and text (a rough machine OCR that is OFTEN WRONG - a hint only).

Your job: GROUP the boxes into complete toponyms and READ each one correctly from the engraving.
- A toponym may span several boxes ("So"+"Toni"+"Coll" = one name "Son Toni Coll"); group their numbers.
- Two adjacent boxes may be two different names - keep them apart.
- Read the ACTUAL engraving, not the machine hint. Transcribe DIPLOMATICALLY - keep the abbreviation marks exactly as engraved (circumflex So, Ca, Sa, circumflex vowels, Pta., Rfl.); do NOT modernize or expand them (the modern form is derived later as nom).
- Coastal/feature names count too (Cala, Punta, Cap, Illa, Torrent, Puig...). Town names in CAPITALS are nuclei - include them.
- Ignore boxes that are pure noise/illegible; do NOT invent names. Some windows are sparse - that's fine.

Return {"toponims": [{"boxes": [n,...], "reading": "..."}]} covering every legible name in the window.`
}

phase('Extract')
const results = await parallel(
  Array.from({ length: N }, (_, i) => {
    const nn = String(i + 1).padStart(2, '0')
    return () => agent(prompt(nn), { label: `w${nn}`, phase: 'Extract', schema: SCHEMA })
  })
)
const out = results.map((r, i) => ({ w: i + 1, toponims: (r && r.toponims) || [] }))
const total = out.reduce((s, w) => s + w.toponims.length, 0)
log(`extracted ${total} toponyms across ${results.filter(Boolean).length}/${N} windows`)
return { total, windows: out }
