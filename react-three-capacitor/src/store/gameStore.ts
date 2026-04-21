import { create } from 'zustand'
import type { AnimationState } from '../game/World'

interface JoystickInput {
  x: number
  y: number
}

export interface RemotePlayerInfo {
  id: string
  color: string
  initialAnimState: AnimationState
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
  currentRound: number
  availableActions: string[]
  joystickInput: JoystickInput
  remotePlayers: Record<string, RemotePlayerInfo>
  notifications: Notification[]

  setConnected: (v: boolean) => void
  setPlayerId: (id: string) => void
  setLocalColor: (color: string) => void
  setInitialPosition: (x: number, z: number) => void
  setCurrentRound: (round: number) => void
  setAvailableActions: (actions: string[]) => void
  setJoystickInput: (input: JoystickInput) => void
  addRemotePlayer: (id: string, color: string, animState: AnimationState) => void
  removeRemotePlayer: (id: string) => void
  addNotification: (message: string) => void
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  playerId: null,
  localColor: '#cccccc',
  initialPosition: { x: 0, z: 0 },
  currentRound: 0,
  availableActions: ['SKIP'],
  joystickInput: { x: 0, y: 0 },
  remotePlayers: {},
  notifications: [],

  setConnected: (v) => set({ connected: v }),
  setPlayerId: (id) => set({ playerId: id }),
  setLocalColor: (color) => set({ localColor: color }),
  setInitialPosition: (x, z) => set({ initialPosition: { x, z } }),
  setCurrentRound: (round) => set({ currentRound: round }),
  setAvailableActions: (actions) => set({ availableActions: actions }),
  setJoystickInput: (input) => set({ joystickInput: input }),

  addRemotePlayer: (id, color, animState) =>
    set((s) => ({ remotePlayers: { ...s.remotePlayers, [id]: { id, color, initialAnimState: animState } } })),

  removeRemotePlayer: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = s.remotePlayers
      return { remotePlayers: rest }
    }),

  addNotification: (message) => {
    const id = Math.random().toString(36).slice(2)
    const expiresAt = Date.now() + 2000
    set((s) => ({ notifications: [...s.notifications, { id, message, expiresAt }] }))
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
    }, 2000)
  },
}))
