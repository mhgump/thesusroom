export type { AnimationState, WorldEvent, UpdateAnimationStateEvent, TouchedEvent, DamageEvent, MoveInput } from './World.js'

import type { AnimationState, WorldEvent, MoveInput } from './World.js'
import type { WireGeometry, ButtonSpec, ButtonConfig, ButtonState, RuleLabel } from './GameSpec.js'
import type { SerializedMap } from '../../src/game/GameMap.js'

export type ServerMessage =
  | { type: 'welcome'; playerId: string; color: string; x: number; z: number; hp: 0 | 1 | 2; serverTick: number; tickRateHz: number }
  | { type: 'player_joined'; playerId: string; color: string; x: number; z: number; animState: AnimationState; hp: 0 | 1 | 2; isNpc?: boolean; hasHealth?: boolean; serverTick: number }
  | { type: 'player_left'; playerId: string }
  | { type: 'move_ack'; clientTick: number; x: number; z: number; events: WorldEvent[]; serverTick: number }
  | { type: 'player_update'; playerId: string; x: number; z: number; events: WorldEvent[]; serverTick: number }
  | { type: 'instruction'; lines: Array<{ text: string; label: RuleLabel; specId: string }> }
  | { type: 'vote_assignment_change'; assignments: Record<string, string[]> }
  | { type: 'world_reset'; maps: SerializedMap[]; geometry: WireGeometry[]; connections: Record<string, string[]> }
  | { type: 'map_add'; map: SerializedMap; geometry: WireGeometry[]; connections: Record<string, string[]> }
  | { type: 'map_remove'; mapInstanceId: string }
  | { type: 'connections_state'; connections: Record<string, string[]> }
  | { type: 'geometry_state'; updates: Array<{ id: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'room_visibility_state'; updates: Array<{ roomId: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'button_init'; buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }> }
  | { type: 'button_state'; id: string; state: ButtonState; occupancy: number }
  | { type: 'button_config'; id: string; changes: Partial<ButtonConfig> }
  | { type: 'add_rule'; text: string }
  | { type: 'notification'; text: string }
  | { type: 'ability_grant'; abilityId: string; label: string; color?: string }
  | { type: 'ability_revoke'; abilityId: string }
  | { type: 'error'; message: string }
  | { type: 'observer_player_left'; eliminated: boolean }
  | { type: 'replay_ended' }

export type ClientMessage =
  | { type: 'move'; tick: number; inputs: MoveInput[] }
  | { type: 'choice'; eventId: string; optionId: string }
  | { type: 'ready' }
  | { type: 'ability_use'; abilityId: string }
