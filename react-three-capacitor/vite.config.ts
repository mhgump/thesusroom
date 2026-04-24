import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NUMBER_DISPLAY_ROUTES } from './server/src/numberDisplayRoutes';

// Proxy every number-display path (HTTP + WS) to the game server so dev mirrors
// prod. VITE_WS_URL (e.g. ws://localhost:8080) points at the same backend.
const wsUrl = process.env.VITE_WS_URL ?? 'ws://localhost:8080';
const httpTarget = wsUrl.replace(/^ws/, 'http');
const numberDisplayProxy = Object.fromEntries(
  Object.keys(NUMBER_DISPLAY_ROUTES).map(path => [
    path,
    { target: httpTarget, ws: true, changeOrigin: true },
  ]),
);

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
    proxy: numberDisplayProxy,
  },
});
