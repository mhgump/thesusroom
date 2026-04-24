# Demo Scenarios — Assumptions

## Scenario 2: Find Your Partner

- Initial countdown before the "10 seconds to vote!" warning instruction: `WARN_MS = 20_000` ms (`content/server/scenarios/scenario2.ts`).
- Delay between the warning and vote resolution: `RESOLVE_MS = 10_000` ms. The displayed wording "10 seconds to vote!" is tied to this constant — changing the delay without updating the text would mislead players.
- Player cap is exactly 8; once reached the script closes the scenario so subsequent connections route to a fresh instance.

## Scenario 1: Find Your Circle

- Player cap is exactly 4; the fourth connection triggers `closeScenario`.
- The locked walkable variant (all cage interiors + corridors) activates the moment all twelve `s1_w*` cage walls become visible simultaneously. The walls are revealed as a single global `setGeometryVisible` call so the walkable variant check fires once.
