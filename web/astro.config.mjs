// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://despuig.corpusbalear.org',
  // Per desplegar a un subdirectori, descomenta i ajusta:
  // base: '/mapa-despuig',
  build: {
    format: 'directory',
  },
  // Amaga la barra d'eines de desenvolupament d'Astro (només sortia en mode dev).
  devToolbar: {
    enabled: false,
  },
  server: {
    port: 4330,
  },
});
