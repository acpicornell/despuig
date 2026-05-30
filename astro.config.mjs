// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build
export default defineConfig({
  site: 'https://example.com',
  // Per desplegar a un subdirectori (p. ex. GitHub Pages /mapa-despuig),
  // descomenta i ajusta:
  // base: '/mapa-despuig',
  build: {
    format: 'directory',
  },
});
