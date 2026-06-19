// @ts-check
import { defineConfig } from 'astro/config';

// Web nova (per-sheet). Conviu amb la web vella de l'arrel; per això el dev
// server fixa un port diferent (la vella usa 4321 per defecte).
export default defineConfig({
  site: 'https://example.com',
  // Per desplegar a un subdirectori, descomenta i ajusta:
  // base: '/mapa-despuig',
  build: {
    format: 'directory',
  },
  server: {
    port: 4330,
  },
});
