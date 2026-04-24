// Single source of truth for number-display routes. Kept in a dep-free file
// so it can be imported from `vite.config.ts` (where `ws` and `express` are
// not resolvable) as well as from `NumberDisplay.ts` at runtime.
export const NUMBER_DISPLAY_ROUTES: Record<string, number> = {
  '/tenthousand': 10000,
}
