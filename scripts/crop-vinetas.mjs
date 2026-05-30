// Retalla les 34 viñetas de la imatge mestra cap a public/vinetas/<slug>.jpg
// fent servir la geometria de src/lib/frame.mjs.
//
//   node scripts/crop-vinetas.mjs            → genera els retalls
//   node scripts/crop-vinetas.mjs --contact  → a més, un full de contacte numerat
//
import sharp from 'sharp';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cellRect, IMG } from '../src/lib/frame.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MASTER = join(ROOT, 'data/jpg/T0023524.jpg');
const OUT = join(ROOT, 'public/vinetas');

const { pobles } = JSON.parse(await readFile(join(ROOT, 'src/data/pobles.json'), 'utf8'));

await mkdir(OUT, { recursive: true });

// Manté el retall dins dels límits de la imatge.
function clamp(r) {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  const w = Math.min(IMG.w - x, Math.round(r.w));
  const h = Math.min(IMG.h - y, Math.round(r.h));
  return { left: x, top: y, width: w, height: h };
}

const thumbs = [];
for (const p of pobles) {
  const region = clamp(cellRect(p.borde, p.ordre));
  const dest = join(OUT, `${p.slug}.jpg`);
  await sharp(MASTER).extract(region).jpeg({ quality: 86 }).toFile(dest);
  thumbs.push({ p, region });
  console.log(`✓ ${p.slug.padEnd(18)} ${p.borde}/${p.ordre}  ${region.width}×${region.height}`);
}
console.log(`\n${thumbs.length} viñetas → public/vinetas/`);

// Full de contacte per a calibratge visual.
if (process.argv.includes('--contact')) {
  const COLS = 6;
  const CW = 360, CH = 280, PAD = 8, LABEL = 22;
  const rows = Math.ceil(thumbs.length / COLS);
  const W = COLS * (CW + PAD) + PAD;
  const H = rows * (CH + LABEL + PAD) + PAD;
  const composites = [];
  for (let k = 0; k < thumbs.length; k++) {
    const { p } = thumbs[k];
    const col = k % COLS, row = Math.floor(k / COLS);
    const x = PAD + col * (CW + PAD);
    const y = PAD + row * (CH + LABEL + PAD);
    const buf = await sharp(join(OUT, `${p.slug}.jpg`))
      .resize(CW, CH, { fit: 'contain', background: '#fff' }).toBuffer();
    composites.push({ input: buf, left: x, top: y + LABEL });
    const label = Buffer.from(
      `<svg width="${CW}" height="${LABEL}"><text x="2" y="16" font-size="15" font-family="sans-serif">${p.id}. ${p.nom} (${p.borde}/${p.ordre})</text></svg>`
    );
    composites.push({ input: label, left: x, top: y });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#eee' } })
    .composite(composites).png().toFile(join(ROOT, 'public/vinetas/_contact.png'));
  console.log('Full de contacte → public/vinetas/_contact.png');
}
