// Registre dels quadrants ACABATS del pipeline per-sheet: tots quatre (NW, NE,
// SE, SW). build-data.mjs n'és additiu: un quadrant nou és una entrada més.
// Camins relatius a l'arrel del repo.
export const QUADRANTS = [
  {
    key: 'nw',
    nom: 'Nord-oest',
    topo: 'data/toponims/nw/toponims.json',
    matches: 'data/toponims/nw/matches.json',
    gcps: 'data/toponims/nw/gcps-nw.json',
  },
  {
    key: 'ne',
    nom: 'Nord-est',
    topo: 'data/toponims/ne/toponims.json',
    matches: 'data/toponims/ne/matches.json',
    gcps: 'data/toponims/ne/gcps-ne.json',
  },
  {
    key: 'se',
    nom: 'Sud-est',
    topo: 'data/toponims/se/toponims.json',
    matches: 'data/toponims/se/matches.json',
    gcps: 'data/toponims/se/gcps-se.json',
  },
  {
    key: 'sw',
    nom: 'Sud-oest',
    topo: 'data/toponims/sw/toponims.json',
    matches: 'data/toponims/sw/matches.json',
    gcps: 'data/toponims/sw/gcps-sw.json',
  },
];
