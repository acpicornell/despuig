// Geometry of the Despuig map frame (master image 19306 × 14902 — the ORIGINAL
// 1785 engraving from the Biblioteca Virtual de Defensa, CC BY 4.0).
//
// The original carries 36 vignettes (35 villages + Palma) around the border and
// is printed on 4 sheets with white "gutter" gaps between them (we work with the
// image un-joined). The uniform cellRect/cellPct grid below no longer matches the
// real vignette layout — it is kept ONLY as a seed for the vignette annotator
// (scripts/toponims/vinetes-server.mjs). The authoritative vignette boxes will be
// the explicit ones in data/toponims/vinetes.json (Slice B).
//
// All values are in master-image pixels.

// Master image, relative to repo root. Gitignored (large); sourced from the
// Biblioteca Virtual de Defensa (signature Ar.G bis-T.3-C.1-023bis).
export const MASTER_REL = 'data/jpg/despuig-1785-original.jpg';

export const IMG = { w: 19306, h: 14902 };

// Printed frame lines, measured on the master (darkness profile; APPROXIMATE —
// refine in Slice B / Phase 2). OUTER = outer edge of the vignette band;
// MAP = inner map frame (the rectangle around the island).
export const OUTER = { l: 289, t: 250, r: 19076, b: 14191 };
export const MAP = { l: 1800, t: 1355, r: 17600, b: 13780 };

// White gutters between the 4 sheets (master pixels), for Phase 2 extraction/georef.
export const GUTTER_V = { a: 9590, b: 9840 };
export const GUTTER_H = { a: 7340, b: 7720 };

// Inner map region (where the toponyms are), used for the extraction.
export const MAP_REGION = { x: MAP.l, y: MAP.t, w: MAP.r - MAP.l, h: MAP.b - MAP.t };

// Seed hints only (carried over from the reduced edition; the original's real
// per-side layout comes from vinetes.json, captured in Slice B).
const N_H = 9; // vignettes per horizontal row (top / bottom)
const N_V = 8; // vignettes per vertical column (left / right)

const colW = (OUTER.r - OUTER.l) / N_H;
const cellH = (MAP.b - MAP.t) / N_V;

// Full rectangle of a cell (image + engraved caption) by border and order (1-based).
export function cellRect(borde, ordre) {
  const i = ordre - 1;
  switch (borde) {
    case 'superior':
      return { x: OUTER.l + i * colW, y: OUTER.t, w: colW, h: MAP.t - OUTER.t };
    case 'inferior':
      return { x: OUTER.l + i * colW, y: MAP.b, w: colW, h: OUTER.b - MAP.b };
    case 'izquierdo':
      return { x: OUTER.l, y: MAP.t + i * cellH, w: MAP.l - OUTER.l, h: cellH };
    case 'derecho':
      return { x: MAP.r, y: MAP.t + i * cellH, w: OUTER.r - MAP.r, h: cellH };
    default:
      throw new Error(`unknown border: ${borde}`);
  }
}

// Same rectangle expressed as image percentages (for the web hotspots).
export function cellPct(borde, ordre) {
  const r = cellRect(borde, ordre);
  return {
    left: (r.x / IMG.w) * 100,
    top: (r.y / IMG.h) * 100,
    width: (r.w / IMG.w) * 100,
    height: (r.h / IMG.h) * 100,
  };
}
