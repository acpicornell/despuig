// Geometria del marc de viñetas del mapa Despuig (imatge mestra 8280 × 6460).
//
// Disposició: les files SUPERIOR i INFERIOR tenen 9 viñetas i ocupen tota
// l'amplada (cantonades incloses). Les columnes ESQUERRA i DRETA tenen 8
// viñetas al tram vertical central, entre les dues files.
//
// Aquests són els únics paràmetres a tocar si cal afinar el retall/hotspots.
// Tots els valors són en píxels de la imatge mestra.

export const IMG = { w: 8280, h: 6460 };

// Línies del marc imprès, mesurades sobre la imatge mestra (perfil de foscor).
// OUTER = vora exterior de la banda de viñetas; MAP = requadre interior del mapa.
export const OUTER = { l: 560, t: 140, r: 7765, b: 6280 };
export const MAP = { l: 1410, t: 835, r: 6915, b: 5555 };

// Regió interior del mapa (on hi ha els topònims), per al buidatge OCR.
export const MAP_REGION = { x: MAP.l, y: MAP.t, w: MAP.r - MAP.l, h: MAP.b - MAP.t };

const N_H = 9; // viñetas per fila horitzontal (superior / inferior)
const N_V = 8; // viñetas per columna vertical (esquerra / dreta)

const colW = (OUTER.r - OUTER.l) / N_H; // ≈ 800,6
const cellH = (MAP.b - MAP.t) / N_V;    // ≈ 590

// Rectangle complet d'una cel·la (imatge + llegenda gravada) segons vora i ordre (1-based).
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
      throw new Error(`borde desconegut: ${borde}`);
  }
}

// Mateix rectangle expressat en percentatges de la imatge (per als hotspots a la web).
export function cellPct(borde, ordre) {
  const r = cellRect(borde, ordre);
  return {
    left: (r.x / IMG.w) * 100,
    top: (r.y / IMG.h) * 100,
    width: (r.w / IMG.w) * 100,
    height: (r.h / IMG.h) * 100,
  };
}
