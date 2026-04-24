import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NUMBER_DISPLAY_PATHS } from './server/src/numberDisplayRoutes';

// Proxy every number-display path (HTTP + WS) to the game server so dev mirrors
// prod. VITE_WS_URL (e.g. ws://localhost:8080) points at the same backend.
const wsUrl = process.env.VITE_WS_URL ?? 'ws://localhost:8080';
const httpTarget = wsUrl.replace(/^ws/, 'http');
const numberDisplayProxy = Object.fromEntries(
  NUMBER_DISPLAY_PATHS.map(path => [
    path,
    { target: httpTarget, ws: true, changeOrigin: true },
  ]),
);

// Paths that require server-side existence validation. In prod the Express
// server returns 404 directly; in dev Vite would otherwise serve its SPA
// fallback for anything it doesn't recognize, so we ping the backend to
// replicate prod 404 behavior before Vite answers with index.html.
const VALIDATION_PATH_REGEXES: RegExp[] = [
  /^\/observe\/hub\/\d+\/\d+$/,
  /^\/observe\/scenarios\/[^/]+\/\d+\/\d+$/,
  /^\/observe\/scenariorun\/[^/]+\/\d+\/\d+$/,
  /^\/recordings\/\d+$/,
  /^\/scenarios\/[^/]+$/,
  /^\/scenariorun\/[^/]+$/,
];

// Dev uses Vite's server (not Express) to serve HTML, so the sr_uid cookie
// that prod.ts sets must also be set here — otherwise the player recording
// system sees no browser identity and skips recording in dev.
function srUidCookiePlugin() {
  return {
    name: 'sus-rooms-sr-uid-cookie',
    configureServer(server: {
      middlewares: {
        use: (fn: (req: { url?: string; method?: string; headers: { cookie?: string; accept?: string } }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void;
      };
    }) {
      server.middlewares.use((req, res, next) => {
        if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
          const raw = req.headers.cookie ?? '';
          if (!/\bsr_uid=/.test(raw)) {
            const uuid = crypto.randomUUID();
            // Deliberately NOT HttpOnly: the SPA reads it and appends
            // the UUID as a WS query param for cross-origin dev setups
            // where the cookie doesn't follow the WS upgrade.
            res.setHeader(
              'Set-Cookie',
              `sr_uid=${uuid}; Path=/; Max-Age=31536000; SameSite=Lax`,
            );
          }
        }
        next();
      });
    },
  };
}

// Dev uses Vite's SPA fallback for any path it doesn't recognize — by
// default `/bogus`, `/recordings/999`, `/scenarios/nonexistent` all render
// the SPA. Mirror prod's 404 behavior by validating navigation requests
// against the game server: paths matching `VALIDATION_PATH_REGEXES` get
// a HEAD ping, and any other top-level HTML navigation that isn't `/`
// also 404s.
function validate404Plugin() {
  return {
    name: 'sus-rooms-validate-404',
    configureServer(server: {
      middlewares: {
        use: (fn: (req: { url?: string; method?: string; headers: { accept?: string } }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }, next: () => void) => void) => void;
      };
    }) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.url) { next(); return; }
        if (!req.headers.accept?.includes('text/html')) { next(); return; }
        const path = req.url.split('?')[0];
        // Root is always the hub; let Vite serve it.
        if (path === '/' || path === '') { next(); return; }
        // Vite-internal paths must pass through untouched.
        if (path.startsWith('/@') || path.startsWith('/__vite') || path.startsWith('/node_modules')) { next(); return; }

        const needsBackendValidation = VALIDATION_PATH_REGEXES.some(re => re.test(path));
        if (needsBackendValidation) {
          try {
            const resp = await fetch(`${httpTarget}${path}`, { method: 'HEAD', redirect: 'manual' });
            if (resp.status === 404) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end('<html><body><p>not found</p></body></html>');
              return;
            }
          } catch {
            // Backend down — fall through so dev stays usable.
          }
          next();
          return;
        }

        // Any other HTML navigation to an unknown top-level path → 404.
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<html><body><p>not found</p></body></html>');
      });
    },
  };
}

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
  plugins: [react(), rapierWasm(), srUidCookiePlugin(), validate404Plugin()],
  // Absolute from root so multi-segment SPA routes like `/scenarios/scenario2`
  // still resolve asset imports to `/assets/...` (relative `./assets/...`
  // would resolve against the route's parent path and 404).
  base: '/',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: numberDisplayProxy,
  },
});
