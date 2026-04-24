// Sub-types used to author map-level gameplay content (vote regions, buttons,
// instruction strings) and to describe wire messages derived from map geometry.
// These live on `GameMap` directly — there is no aggregated `GameSpec` shape.

export type RuleLabel = 'RULE' | 'COMMAND' | 'FACT'

export type ButtonState = 'idle' | 'pressed' | 'cooldown' | 'disabled'

// Default visual dimensions — spread into a ButtonSpec, then override per-scenario as needed.
export const DEFAULT_BUTTON_DIMENSIONS = {
  platformRadius: 1.2,
  ringOuterRadius: 1.32,  // exactly 10% wider than platformRadius
  ringInnerRadius: 1.2,   // = platformRadius (flush with inner cylinder)
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

// A single geometry piece after the server has flattened the owning map's
// per-room geometry to global coordinates. Sent to the client via `map_init`
// so the renderer can place each box without re-deriving room positions.
// `roomId` carries the owning scoped room id so the client can gate
// rendering by room visibility.
export interface WireGeometry {
  id: string
  roomId: string
  cx: number; cy: number; cz: number
  width: number; height: number; depth: number
  color?: string
  imageUrl?: string
}
