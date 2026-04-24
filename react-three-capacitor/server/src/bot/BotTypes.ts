export enum MovementIntent {
  COMMIT = 'COMMIT',
}

export interface CircularTarget {
  type: 'circle'
  x: number
  z: number
  radius: number
}

export interface SquareTarget {
  type: 'square'
  x: number
  z: number
  width: number
  height: number
}

export type BotTarget = CircularTarget | SquareTarget | null

export interface BotState {
  target: BotTarget
  intent: MovementIntent
  phase: string
  [key: string]: unknown
}

export interface BotCallbackContext {
  readonly state: BotState
  updateBotState(updates: Partial<BotState>): void
  getPosition(): { x: number; z: number }
  getOtherPlayers(): Map<string, { x: number; z: number }>
}

export type BotCommand =
  | { type: 'move'; jx: number; jz: number }
  | { type: 'idle' }

export interface BotSpec {
  phases: string[]
  initialState: BotState
  // Keyed by instruction spec id; framework validates keys match the scenario's instructionSpecs.
  onInstructMap: Record<string, (ctx: BotCallbackContext) => void>
  // One handler per phase; called at most every 500ms per player if they moved >= 0.5m.
  onOtherPlayerMove: Record<string, (ctx: BotCallbackContext, playerId: string, from: { x: number; z: number }, to: { x: number; z: number }) => void>
  // One handler per phase; called whenever active vote region assignments change.
  onActiveVoteAssignmentChange: Record<string, (ctx: BotCallbackContext, assignments: Map<string, string[]>) => void>
  // One handler per phase; called every 250ms or immediately when the previous command completes.
  nextCommand: Record<string, (ctx: BotCallbackContext, position: { x: number; z: number }) => BotCommand>
  onChoice?(ctx: BotCallbackContext, eventId: string, options: string[]): string | null
}

export function isAtTarget(position: { x: number; z: number }, target: BotTarget): boolean {
  if (!target) return true
  if (target.type === 'circle') {
    return Math.hypot(position.x - target.x, position.z - target.z) <= target.radius
  }
  return (
    position.x >= target.x - target.width / 2 &&
    position.x <= target.x + target.width / 2 &&
    position.z >= target.z - target.height / 2 &&
    position.z <= target.z + target.height / 2
  )
}

export function moveToward(position: { x: number; z: number }, target: BotTarget): BotCommand {
  if (!target || isAtTarget(position, target)) return { type: 'idle' }
  const dx = target.x - position.x
  const dz = target.z - position.z
  const len = Math.hypot(dx, dz)
  if (len < 0.01) return { type: 'idle' }
  return { type: 'move', jx: dx / len, jz: dz / len }
}
