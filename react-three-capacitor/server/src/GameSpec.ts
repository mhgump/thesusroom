// Mirror of src/game/GameSpec.ts — must stay in sync.
export type RuleLabel = 'RULE' | 'COMMAND' | 'FACT'

export type ButtonState = 'idle' | 'pressed' | 'cooldown' | 'disabled'

// Default visual dimensions — spread into a ButtonSpec, then override per-scenario as needed.
export const DEFAULT_BUTTON_DIMENSIONS = {
  platformRadius: 1.2,
  ringOuterRadius: 1.32,  // ~10% wider than platformRadius
  ringInnerRadius: 1.2,   // = platformRadius (no gap)
  raisedHeight: 0.36,
  triggerRadius: 1.5,
}

export interface ButtonConfig {
  requiredPlayers: number
  holdAfterRelease: boolean
  cooldownMs: number
  enableClientPress: boolean
}

export interface ButtonSpec extends ButtonConfig {
  id: string
  x: number
  z: number
  triggerRadius: number
  ringOuterRadius: number
  ringInnerRadius: number
  platformRadius: number
  raisedHeight: number
  color: string
  ringColor: string
  initialState?: ButtonState
}

export interface InstructionEventSpec {
  id: string
  text: string
  label: RuleLabel
}

export interface VoteRegionSpec {
  id: string
  label: string
  color: string
  x: number
  z: number
  radius: number
}

export interface FloorGeometrySpec {
  id: string
  x: number
  z: number
  width: number
  depth: number
  color: string
  height?: number
}

export interface GameSpec {
  instructionSpecs: InstructionEventSpec[]
  voteRegions: VoteRegionSpec[]
  geometry: FloorGeometrySpec[]
  buttons: ButtonSpec[]
  // Initial visibility per geometry element id. Geometry defaults to visible (true) if not specified.
  // Vote regions always start inactive.
  initialVisibility: Record<string, boolean>
}

interface RoomBounds { x: number; z: number; width: number; depth: number }

// Returns error messages for any vote region not fully contained within a room floor.
export function validateGameSpec(spec: GameSpec, rooms: RoomBounds[]): string[] {
  const errors: string[] = []
  for (const region of spec.voteRegions) {
    const ok = rooms.some(
      r =>
        region.x - region.radius >= r.x - r.width / 2 &&
        region.x + region.radius <= r.x + r.width / 2 &&
        region.z - region.radius >= r.z - r.depth / 2 &&
        region.z + region.radius <= r.z + r.depth / 2,
    )
    if (!ok) errors.push(`Vote region '${region.id}' is not fully contained within any room`)
  }
  return errors
}
