import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Vite 8 doesn't emit rapier's WASM automatically — copy it to assets/ so
// the rapier chunk's `new URL('rapier_wasm2d_bg.wasm', import.meta.url)` resolves.
function rapierWasm() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildStart = function(this: any) {
    const wasmPath = resolve('node_modules/@dimforge/rapier2d-compat/rapier_wasm2d_bg.wasm');
    this.emitFile({ type: 'asset', fileName: 'assets/rapier_wasm2d_bg.wasm', source: readFileSync(wasmPath) });
  };
  return { name: 'rapier-wasm-copy', buildStart };
}

export default defineConfig({
  plugins: [react(), rapierWasm()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
