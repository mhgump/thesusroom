export interface InstructionEventSpec {
  id: string
  text: string
}

export interface VoteRegionSpec {
  id: string
  label: string
  color: string
  x: number
  z: number
  radius: number
}

export interface GameSpec {
  instructionSpecs: InstructionEventSpec[]
  voteRegions: VoteRegionSpec[]
}

interface RoomBounds { x: number; z: number; width: number; depth: number }

// Returns error messages for any vote region not fully contained within a room floor.
export function validateGameSpec(spec: GameSpec, rooms: RoomBounds[]): string[] {
  const errors: string[] = []
  for (const region of spec.voteRegions) {
    const ok = rooms.some(
      r =>
        region.x - region.radius >= r.x - r.width / 2 &&
        region.x + region.radius <= r.x + r.width / 2 &&
        region.z - region.radius >= r.z - r.depth / 2 &&
        region.z + region.radius <= r.z + r.depth / 2,
    )
    if (!ok) errors.push(`Vote region '${region.id}' is not fully contained within any room`)
  }
  return errors
}
