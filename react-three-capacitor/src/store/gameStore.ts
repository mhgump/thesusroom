import { create } from 'zustand'
import type { AnimationState } from '../game/World'
import type { ShowChoiceEvent, ShowRuleEvent } from '../network/types'
import type { WireGeometry, ButtonSpec, ButtonConfig, ButtonState } from '../game/GameSpec'
import { getInputMode, setInputMode as persistInputMode, type InputMode } from '../settings'

interface JoystickInput { x: number; y: number }
interface MoveTarget { x: number; z: number }

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
  observerEndReason: 'none' | 'eliminated' | 'disconnected' | 'replay_ended'
  playerId: string | null
  localColor: string
  initialPosition: { x: number; z: number }
  currentRoomId: string
  joystickInput: JoystickInput
  inputMode: InputMode
  moveTarget: MoveTarget | null
  settingsOpen: boolean
  remotePlayers: Record<string, RemotePlayerInfo>
  notifications: Notification[]
  playerHp: Record<string, 0 | 1 | 2>
  eliminated: boolean
  activeChoiceEvent: ShowChoiceEvent | null
  activeRuleEvent: ShowRuleEvent | null
  activeRules: string[]
  rulesOpen: boolean
  geometryObjects: WireGeometry[]
  geometryVisibility: Record<string, boolean>
  localGeometryOverride: Record<string, boolean>
  roomVisibility: Record<string, boolean>
  playerRoomVisibilityOverride: Record<string, boolean>
  buttonSpecs: Record<string, ButtonSpec>
  buttonStates: Record<string, { state: ButtonState; occupancy: number }>
  localButtonPressing: Record<string, boolean>
  sceneReady: boolean

  setConnected: (v: boolean) => void
  setSceneReady: (v: boolean) => void
  setObserverMode: (v: boolean) => void
  setObserverEndReason: (r: 'none' | 'eliminated' | 'disconnected' | 'replay_ended') => void
  setPlayerId: (id: string) => void
  setLocalColor: (color: string) => void
  setInitialPosition: (x: number, z: number) => void
  setCurrentRoomId: (roomId: string) => void
  setJoystickInput: (input: JoystickInput) => void
  setInputMode: (mode: InputMode) => void
  setMoveTarget: (target: MoveTarget | null) => void
  setSettingsOpen: (open: boolean) => void
  addRemotePlayer: (id: string, color: string, animState: AnimationState, isNpc?: boolean, hasHealth?: boolean) => void
  removeRemotePlayer: (id: string) => void
  addNotification: (message: string, durationMs?: number) => void
  setPlayerHp: (id: string, hp: 0 | 1 | 2) => void
  applyDamage: (targetId: string, newHp: 0 | 1 | 2) => void
  showChoice: (event: ShowChoiceEvent) => void
  dismissChoice: () => void
  showRule: (event: ShowRuleEvent) => void
  dismissRule: () => void
  addRule: (text: string) => void
  setRulesOpen: (v: boolean) => void
  setGeometryObjects: (objects: WireGeometry[]) => void
  appendGeometryObjects: (objects: WireGeometry[]) => void
  removeGeometryForMap: (mapInstanceId: string) => void
  applyGeometryUpdates: (updates: Array<{ id: string; visible: boolean }>) => void
  applyLocalGeometryOverride: (updates: Array<{ id: string; visible: boolean }>) => void
  applyRoomVisibilityUpdates: (updates: Array<{ roomId: string; visible: boolean }>) => void
  applyPlayerRoomVisibilityOverride: (updates: Array<{ roomId: string; visible: boolean }>) => void
  initButtons: (buttons: Array<ButtonSpec & { state: ButtonState; occupancy: number }>) => void
  applyButtonStateUpdate: (id: string, state: ButtonState, occupancy: number) => void
  applyButtonConfigUpdate: (id: string, changes: Partial<ButtonConfig>) => void
  setLocalButtonPressing: (id: string, pressing: boolean) => void
  reset: () => void
}

export const useGameStore = create<GameState>((set) => ({
  connected: false,
  observerMode: false,
  observerEndReason: 'none',
  playerId: null,
  localColor: '#cccccc',
  initialPosition: { x: 0, z: 0 },
  currentRoomId: '',
  joystickInput: { x: 0, y: 0 },
  inputMode: getInputMode(),
  moveTarget: null,
  settingsOpen: false,
  remotePlayers: {},
  notifications: [],
  playerHp: {},
  eliminated: false,
  activeChoiceEvent: null,
  activeRuleEvent: null,
  activeRules: [],
  rulesOpen: false,
  geometryObjects: [],
  geometryVisibility: {},
  localGeometryOverride: {},
  roomVisibility: {},
  playerRoomVisibilityOverride: {},
  buttonSpecs: {},
  buttonStates: {},
  localButtonPressing: {},
  sceneReady: false,

  setConnected: (v) => set({ connected: v }),
  setSceneReady: (v) => set({ sceneReady: v }),
  setObserverMode: (v) => set({ observerMode: v }),
  setObserverEndReason: (r) => set({ observerEndReason: r }),
  setPlayerId: (id) => set({ playerId: id }),
  setLocalColor: (color) => set({ localColor: color }),
  setInitialPosition: (x, z) => set({ initialPosition: { x, z } }),
  setCurrentRoomId: (roomId) => set({ currentRoomId: roomId }),
  setJoystickInput: (input) => set({ joystickInput: input }),

  setInputMode: (mode) => {
    persistInputMode(mode)
    set({ inputMode: mode, joystickInput: { x: 0, y: 0 }, moveTarget: null })
  },

  setMoveTarget: (target) => set({ moveTarget: target }),

  setSettingsOpen: (open) => set({ settingsOpen: open }),

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
  addRule: (text) => set((s) => ({ activeRules: [...s.activeRules, text] })),
  setRulesOpen: (v) => set({ rulesOpen: v }),

  setGeometryObjects: (objects) => set({ geometryObjects: objects }),

  appendGeometryObjects: (objects) =>
    set((s) => ({ geometryObjects: [...s.geometryObjects, ...objects] })),

  removeGeometryForMap: (mapInstanceId) =>
    set((s) => {
      const prefix = `${mapInstanceId}_`
      return { geometryObjects: s.geometryObjects.filter(g => !g.roomId.startsWith(prefix)) }
    }),

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

  applyRoomVisibilityUpdates: (updates) =>
    set((s) => {
      const roomVisibility = { ...s.roomVisibility }
      for (const { roomId, visible } of updates) roomVisibility[roomId] = visible
      return { roomVisibility }
    }),

  applyPlayerRoomVisibilityOverride: (updates) =>
    set((s) => {
      const playerRoomVisibilityOverride = { ...s.playerRoomVisibilityOverride }
      for (const { roomId, visible } of updates) playerRoomVisibilityOverride[roomId] = visible
      return { playerRoomVisibilityOverride }
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

  reset: () => set({
    connected: false,
    observerEndReason: 'none',
    playerId: null,
    localColor: '#cccccc',
    initialPosition: { x: 0, z: 0 },
    currentRoomId: '',
    joystickInput: { x: 0, y: 0 },
    moveTarget: null,
    settingsOpen: false,
    remotePlayers: {},
    notifications: [],
    playerHp: {},
    eliminated: false,
    activeChoiceEvent: null,
    activeRuleEvent: null,
    activeRules: [],
    rulesOpen: false,
    geometryObjects: [],
    geometryVisibility: {},
    localGeometryOverride: {},
    roomVisibility: {},
    playerRoomVisibilityOverride: {},
    buttonSpecs: {},
    buttonStates: {},
    localButtonPressing: {},
    sceneReady: false,
  }),
}))

export function selectInputBlocked(s: GameState): boolean {
  return (
    s.activeChoiceEvent !== null ||
    s.activeRuleEvent !== null ||
    s.rulesOpen ||
    s.settingsOpen ||
    s.eliminated
  )
}
