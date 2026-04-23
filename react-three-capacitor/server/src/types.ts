export type { AnimationState, WorldEvent, UpdateAnimationStateEvent, TouchedEvent, DamageEvent } from './World.js'

import type { AnimationState, WorldEvent } from './World.js'
import type { FloorGeometrySpec, ButtonSpec, ButtonConfig, ButtonState, RuleLabel } from './GameSpec.js'

export type ServerMessage =
  | { type: 'welcome'; playerId: string; color: string; x: number; z: number; hp: 0 | 1 | 2 }
  | { type: 'player_joined'; playerId: string; color: string; x: number; z: number; animState: AnimationState; hp: 0 | 1 | 2; isNpc?: boolean; hasHealth?: boolean }
  | { type: 'player_left'; playerId: string }
  | { type: 'move_ack'; seq: number; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'player_update'; playerId: string; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'instruction'; lines: Array<{ text: string; label: RuleLabel; specId: string }> }
  | { type: 'vote_assignment_change'; assignments: Record<string, string[]> }
  | { type: 'map_init'; geometry: FloorGeometrySpec[] }
  | { type: 'geometry_state'; updates: Array<{ id: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'room_visibility_state'; updates: Array<{ roomId: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'button_init'; buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }> }
  | { type: 'button_state'; id: string; state: ButtonState; occupancy: number }
  | { type: 'button_config'; id: string; changes: Partial<ButtonConfig> }
  | { type: 'add_rule'; text: string }
  | { type: 'notification'; text: string }
  | { type: 'error'; message: string }
  | { type: 'observer_player_left'; eliminated: boolean }

export type ClientMessage =
  | { type: 'move'; seq: number; jx: number; jz: number; dt: number }
