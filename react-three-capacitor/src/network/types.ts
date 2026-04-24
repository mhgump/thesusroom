export type { AnimationState, WorldEvent, UpdateAnimationStateEvent, TouchedEvent, DamageEvent, MoveInput } from '../game/World'

import type { AnimationState, WorldEvent, MoveInput } from '../game/World'
import type { WireGeometry, ButtonSpec, ButtonConfig, ButtonState, RuleLabel } from '../game/GameSpec'

export type { RuleLabel }

export type ChoiceOption = {
  id: string
  title: string
  upperDetail?: string
  lowerDetail?: string
}

export type ShowChoiceEvent = {
  type: 'show_choice'
  eventId: string
  options: ChoiceOption[]
}

export type ShowRuleEvent = {
  type: 'show_rule'
  eventId: string
  rules: { label: RuleLabel; text: string }[]
}

export type GlobalGameEvent = ShowChoiceEvent | ShowRuleEvent

export type ServerMessage =
  | { type: 'welcome'; playerId: string; color: string; x: number; z: number; hp: 0 | 1 | 2; serverTick: number; tickRateHz: number }
  | { type: 'player_joined'; playerId: string; color: string; x: number; z: number; animState: AnimationState; hp: 0 | 1 | 2; isNpc?: boolean; hasHealth?: boolean; serverTick: number }
  | { type: 'player_left'; playerId: string }
  | { type: 'move_ack'; clientTick: number; x: number; z: number; events: WorldEvent[]; serverTick: number }
  | { type: 'player_update'; playerId: string; x: number; z: number; events: WorldEvent[]; serverTick: number }
  | { type: 'game_event'; event: GlobalGameEvent; serverTick: number }
  | { type: 'instruction'; lines: Array<{ text: string; label: RuleLabel; specId: string }> }
  | { type: 'map_init'; geometry: WireGeometry[] }
  | { type: 'geometry_state'; updates: Array<{ id: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'button_init'; buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }> }
  | { type: 'button_state'; id: string; state: ButtonState; occupancy: number }
  | { type: 'button_config'; id: string; changes: Partial<ButtonConfig> }
  | { type: 'notification'; text: string }
  | { type: 'room_visibility_state'; updates: Array<{ roomId: string; visible: boolean }>; perPlayer?: boolean }
  | { type: 'add_rule'; text: string }
  | { type: 'error'; message: string }
  | { type: 'observer_player_left'; eliminated: boolean }
  | { type: 'replay_ended' }

export type ClientMessage =
  | { type: 'move'; tick: number; inputs: MoveInput[] }
  | { type: 'choice'; eventId: string; optionId: string }
  | { type: 'ready' }
