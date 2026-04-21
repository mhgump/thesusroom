export type { AnimationState, WorldEvent, UpdateAnimationStateEvent, TouchedEvent } from '../game/World'

import type { AnimationState, WorldEvent } from '../game/World'

export type ServerMessage =
  | { type: 'welcome'; playerId: string; color: string; x: number; z: number }
  | { type: 'round_config'; round: number; actions: string[] }
  | { type: 'player_joined'; playerId: string; color: string; x: number; z: number; animState: AnimationState }
  | { type: 'player_left'; playerId: string }
  | { type: 'move_ack'; seq: number; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'player_update'; playerId: string; x: number; z: number; events: WorldEvent[]; startTime: number; endTime: number }
  | { type: 'error'; message: string }

export type ClientMessage =
  | { type: 'move'; seq: number; jx: number; jz: number; dt: number }
  | { type: 'action'; action: string }
