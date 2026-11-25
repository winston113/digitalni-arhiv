import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Branje slikovnih zapisov skenerjev (JBIG2, JPEG 2000) brez WebAssembly; pregledovalnik datoteke poišče po imenu.
const PDFJS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG'];
const pdfjs: Plugin = {
  name: 'pdfjs-datoteke',
  apply: 'build',
  generateBundle() {
    for (const name of PDFJS) this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(`node_modules/pdfjs-dist/wasm/${name}`) });
  },
};

export default defineConfig({
  root: 'src/web',
  plugins: [react(), pdfjs],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: { fs: { allow: ['../..'] }, proxy: { '/api': 'http://localhost:3000' } },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
