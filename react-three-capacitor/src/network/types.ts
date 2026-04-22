export type { AnimationState, WorldEvent, UpdateAnimationStateEvent, TouchedEvent, DamageEvent } from '../game/World'

import type { AnimationState, WorldEvent } from '../game/World'

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
  rules: { text: string }[]
}

export type GlobalGameEvent = ShowChoiceEvent | ShowRuleEvent

export type ServerMessage =
  | { type: 'welcome'; playerId: string; color: string; x: number; z: number; hp: 0 | 1 | 2 }
  | { type: 'player_joined'; playerId: string; color: string; x: number; z: number; animState: AnimationState; hp: 0 | 1 | 2; isNpc?: boolean; hasHealth?: boolean }
  | { type: 'player_left'; playerId: string }
  | { type: 'move_ack'; seq: number; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'player_update'; playerId: string; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'game_event'; event: GlobalGameEvent; serverTime: number }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'move'; seq: number; jx: number; jz: number; dt: number }
  | { type: 'choice_action'; eventId: string; optionId: string }
