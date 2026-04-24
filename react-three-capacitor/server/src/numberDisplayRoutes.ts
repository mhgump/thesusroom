// Dep-free path list used by the Vite dev proxy (which is loaded at config
// time and can't import from `NumberDisplay.ts`, since that pulls in `ws`
// and `express`). Each entry is a prefix passed to Vite's proxy — Vite
// forwards matching paths (including sub-paths like `/tests/3`) to the game
// server, where the pattern is matched properly via `NumberDisplay.ts`.
export const NUMBER_DISPLAY_PATHS: readonly string[] = [
  '/tenthousand',
  '/scenariocount',
  '/vetted',
  '/tests',
  '/costs',
]
