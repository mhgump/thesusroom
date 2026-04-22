import { create } from 'zustand'
import type { AnimationState } from '../game/World'
import type { ShowChoiceEvent, ShowRuleEvent } from '../network/types'

interface JoystickInput { x: number; y: number }

export interface RemotePlayerInfo {
  id: string
  color: string
  initialAnimState: AnimationState
  isNpc: boolean
  hasHealth: boolean
}

export interface Notification {
  id: string
  message: string
  expiresAt: number
}

interface GameState {
  connected: boolean
  playerId: string | null
  localColor: string
  initialPosition: { x: number; z: number }
  currentRoomId: string
  joystickInput: JoystickInput
  remotePlayers: Record<string, RemotePlayerInfo>
  notifications: Notification[]
  playerHp: Record<string, 0 | 1 | 2>
  activeChoiceEvent: ShowChoiceEvent | null
  activeRuleEvent: ShowRuleEvent | null

  setConnected: (v: boolean) => void
  setPlayerId: (id: string) => void
  setLocalColor: (color: string) => void
  setInitialPosition: (x: number, z: number) => void
  setCurrentRoomId: (roomId: string) => void
  setJoystickInput: (input: JoystickInput) => void
  addRemotePlayer: (id: string, color: string, animState: AnimationState, isNpc?: boolean, hasHealth?: boolean) => void
  removeRemotePlayer: (id: string) => void
  addNotification: (message: string) => void
  setPlayerHp: (id: string, hp: 0 | 1 | 2) => void
  applyDamage: (targetId: string, newHp: 0 | 1 | 2) => void
  showChoice: (event: ShowChoiceEvent) => void
  dismissChoice: () => void
  showRule: (event: ShowRuleEvent) => void
  dismissRule: () => void
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  playerId: null,
  localColor: '#cccccc',
  initialPosition: { x: 0, z: 0 },
  currentRoomId: 'room1',
  joystickInput: { x: 0, y: 0 },
  remotePlayers: {},
  notifications: [],
  playerHp: {},
  activeChoiceEvent: null,
  activeRuleEvent: null,

  setConnected: (v) => set({ connected: v }),
  setPlayerId: (id) => set({ playerId: id }),
  setLocalColor: (color) => set({ localColor: color }),
  setInitialPosition: (x, z) => set({ initialPosition: { x, z } }),
  setCurrentRoomId: (roomId) => set({ currentRoomId: roomId }),
  setJoystickInput: (input) => set({ joystickInput: input }),

  addRemotePlayer: (id, color, animState, isNpc = false, hasHealth = true) =>
    set((s) => ({ remotePlayers: { ...s.remotePlayers, [id]: { id, color, initialAnimState: animState, isNpc, hasHealth } } })),

  removeRemotePlayer: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _r, ...remotePlayers } = s.remotePlayers
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _h, ...playerHp } = s.playerHp
      return { remotePlayers, playerHp }
    }),

  addNotification: (message) => {
    const id = Math.random().toString(36).slice(2)
    const expiresAt = Date.now() + 2000
    set((s) => ({ notifications: [...s.notifications, { id, message, expiresAt }] }))
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
    }, 2000)
  },

  setPlayerHp: (id, hp) => set((s) => ({ playerHp: { ...s.playerHp, [id]: hp } })),

  applyDamage: (targetId, newHp) => set((s) => ({ playerHp: { ...s.playerHp, [targetId]: newHp } })),

  showChoice: (event) => set({ activeChoiceEvent: event }),
  dismissChoice: () => set({ activeChoiceEvent: null }),
  showRule: (event) => set({ activeRuleEvent: event }),
  dismissRule: () => set({ activeRuleEvent: null }),
}))
