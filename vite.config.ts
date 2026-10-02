import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/library/',
  build: { target: ['es2022', 'safari16'] },
  server: { host: '127.0.0.1', strictPort: true, fs: { strict: true } },
  test: { environment: 'node', setupFiles: ['src/test/setup.ts'], include: ['src/**/*.test.ts'] },
});
