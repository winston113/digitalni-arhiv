import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { fs: { allow: ['../..'] }, proxy: { '/api': 'http://localhost:3000' } },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
