import { create } from 'zustand'
import type { AnimationState } from '../game/World'
import type { ShowChoiceEvent, ShowRuleEvent } from '../network/types'
import type { FloorGeometrySpec, ButtonSpec, ButtonConfig, ButtonState } from '../game/GameSpec'
import type { WalkableArea } from '../game/WorldSpec'

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
  observerMode: boolean
  observerEndReason: 'none' | 'eliminated' | 'disconnected'
  playerId: string | null
  localColor: string
  initialPosition: { x: number; z: number }
  currentRoomId: string
  joystickInput: JoystickInput
  remotePlayers: Record<string, RemotePlayerInfo>
  notifications: Notification[]
  playerHp: Record<string, 0 | 1 | 2>
  eliminated: boolean
  activeChoiceEvent: ShowChoiceEvent | null
  activeRuleEvent: ShowRuleEvent | null
  geometryObjects: FloorGeometrySpec[]
  geometryVisibility: Record<string, boolean>
  localGeometryOverride: Record<string, boolean>
  activeWalkable: WalkableArea | null
  buttonSpecs: Record<string, ButtonSpec>
  buttonStates: Record<string, { state: ButtonState; occupancy: number }>
  localButtonPressing: Record<string, boolean>

  setConnected: (v: boolean) => void
  setObserverMode: (v: boolean) => void
  setObserverEndReason: (r: 'none' | 'eliminated' | 'disconnected') => void
  setPlayerId: (id: string) => void
  setLocalColor: (color: string) => void
  setInitialPosition: (x: number, z: number) => void
  setCurrentRoomId: (roomId: string) => void
  setJoystickInput: (input: JoystickInput) => void
  addRemotePlayer: (id: string, color: string, animState: AnimationState, isNpc?: boolean, hasHealth?: boolean) => void
  removeRemotePlayer: (id: string) => void
  addNotification: (message: string, durationMs?: number) => void
  setPlayerHp: (id: string, hp: 0 | 1 | 2) => void
  applyDamage: (targetId: string, newHp: 0 | 1 | 2) => void
  showChoice: (event: ShowChoiceEvent) => void
  dismissChoice: () => void
  showRule: (event: ShowRuleEvent) => void
  dismissRule: () => void
  setGeometryObjects: (objects: FloorGeometrySpec[]) => void
  applyGeometryUpdates: (updates: Array<{ id: string; visible: boolean }>) => void
  applyLocalGeometryOverride: (updates: Array<{ id: string; visible: boolean }>) => void
  setActiveWalkable: (area: WalkableArea | null) => void
  initButtons: (buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void
  applyButtonStateUpdate: (id: string, state: ButtonState, occupancy: number) => void
  applyButtonConfigUpdate: (id: string, changes: Partial<ButtonConfig>) => void
  setLocalButtonPressing: (id: string, pressing: boolean) => void
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  observerMode: false,
  observerEndReason: 'none',
  playerId: null,
  localColor: '#cccccc',
  initialPosition: { x: 0, z: 0 },
  currentRoomId: 'room1',
  joystickInput: { x: 0, y: 0 },
  remotePlayers: {},
  notifications: [],
  playerHp: {},
  eliminated: false,
  activeChoiceEvent: null,
  activeRuleEvent: null,
  geometryObjects: [],
  geometryVisibility: {},
  localGeometryOverride: {},
  activeWalkable: null,
  buttonSpecs: {},
  buttonStates: {},
  localButtonPressing: {},

  setConnected: (v) => set({ connected: v }),
  setObserverMode: (v) => set({ observerMode: v }),
  setObserverEndReason: (r) => set({ observerEndReason: r }),
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

  addNotification: (message, durationMs = 2000) => {
    if (useGameStore.getState().eliminated) return
    const id = Math.random().toString(36).slice(2)
    const expiresAt = Date.now() + durationMs
    set((s) => ({ notifications: [...s.notifications, { id, message, expiresAt }] }))
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }))
    }, durationMs)
  },

  setPlayerHp: (id, hp) => set((s) => ({ playerHp: { ...s.playerHp, [id]: hp } })),

  applyDamage: (targetId, newHp) => set((s) => {
    const playerHp = { ...s.playerHp, [targetId]: newHp }
    if (newHp === 0 && targetId === s.playerId) {
      return { playerHp, eliminated: true, activeRuleEvent: null, activeChoiceEvent: null }
    }
    return { playerHp }
  }),

  showChoice: (event) => set((s) => s.eliminated ? {} : { activeChoiceEvent: event }),
  dismissChoice: () => set({ activeChoiceEvent: null }),
  showRule: (event) => set((s) => s.eliminated ? {} : { activeRuleEvent: event }),
  dismissRule: () => set({ activeRuleEvent: null }),

  setGeometryObjects: (objects) => set({ geometryObjects: objects }),

  setActiveWalkable: (area) => set({ activeWalkable: area }),

  applyGeometryUpdates: (updates) =>
    set((s) => {
      const geometryVisibility = { ...s.geometryVisibility }
      for (const { id, visible } of updates) geometryVisibility[id] = visible
      return { geometryVisibility }
    }),

  applyLocalGeometryOverride: (updates) =>
    set((s) => {
      const localGeometryOverride = { ...s.localGeometryOverride }
      for (const { id, visible } of updates) localGeometryOverride[id] = visible
      return { localGeometryOverride }
    }),

  initButtons: (buttons) =>
    set(() => {
      const buttonSpecs: Record<string, ButtonSpec> = {}
      const buttonStates: Record<string, { state: ButtonState; occupancy: number }> = {}
      for (const b of buttons) {
        const { state, occupancy, ...spec } = b
        buttonSpecs[b.id] = spec
        buttonStates[b.id] = { state, occupancy }
      }
      return { buttonSpecs, buttonStates }
    }),

  applyButtonStateUpdate: (id, state, occupancy) =>
    set((s) => ({ buttonStates: { ...s.buttonStates, [id]: { state, occupancy } } })),

  applyButtonConfigUpdate: (id, changes) =>
    set((s) => {
      const existing = s.buttonSpecs[id]
      if (!existing) return {}
      return { buttonSpecs: { ...s.buttonSpecs, [id]: { ...existing, ...changes } } }
    }),

  setLocalButtonPressing: (id, pressing) =>
    set((s) => ({ localButtonPressing: { ...s.localButtonPressing, [id]: pressing } })),
}))
