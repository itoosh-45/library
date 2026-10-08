import { defineConfig } from 'vite';
export default defineConfig({build:{ssr:'gateway/nli.ts',outDir:'.gateway-dist/nli',target:'node24',minify:false,rollupOptions:{output:{entryFileNames:'nli-adapter.mjs'}}}});
