# Build from repo root:  docker build -f docker/prod/Dockerfile -t thesusrooms .

# ── Stage 1: Build the React/Vite frontend ────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app

# Install client dependencies
COPY react-three-capacitor/package-lock.json react-three-capacitor/package.json ./react-three-capacitor/
RUN cd react-three-capacitor && npm ci --silent

# Copy source (content/ is imported by client maps)
COPY content/ ./content/
COPY react-three-capacitor/index.html \
     react-three-capacitor/tsconfig.json \
     react-three-capacitor/tsconfig.node.json \
     react-three-capacitor/vite.config.ts \
     ./react-three-capacitor/
COPY react-three-capacitor/src/    ./react-three-capacitor/src/
COPY react-three-capacitor/public/ ./react-three-capacitor/public/

# VITE_WS_URL intentionally omitted — client auto-detects wss:// from page protocol at runtime
RUN cd react-three-capacitor && npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Install server dependencies (includes tsx for TS runtime, express for static serving)
COPY react-three-capacitor/server/package-lock.json react-three-capacitor/server/package.json ./react-three-capacitor/server/
RUN cd react-three-capacitor/server && npm ci --silent

# Server TypeScript source
COPY react-three-capacitor/server/src/ ./react-three-capacitor/server/src/

# Shared content (server maps & scenarios — imported at runtime via relative TS paths)
COPY content/ ./content/

# Built frontend (served as static files by prod.ts)
COPY --from=frontend /app/react-three-capacitor/dist/ ./react-three-capacitor/dist/

EXPOSE 8080

# tsx runs prod.ts directly — no compile step needed
CMD ["react-three-capacitor/server/node_modules/.bin/tsx", "react-three-capacitor/server/src/prod.ts"]
