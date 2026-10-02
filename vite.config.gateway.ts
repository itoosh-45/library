import { defineConfig } from 'vite';
export default defineConfig({ build: { ssr: 'gateway/run.ts', outDir: '.gateway-dist', target: 'node24', minify: false } });
