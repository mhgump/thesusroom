import type { GameSpec } from './GameSpec'
import { DEFAULT_ROOM_POSITIONS } from './DefaultWorld'

const southRoom = DEFAULT_ROOM_POSITIONS.get('south_room')!

export const DEFAULT_GAME_SPEC: GameSpec = {
  instructionSpecs: [
    { id: 'vote_instruction', text: 'Vote Yes or No' },
  ],
  voteRegions: [
    { id: 'vote_yes', label: 'Yes', color: '#2ecc71', x: southRoom.x - 5, z: southRoom.z, radius: 3 },
    { id: 'vote_no',  label: 'No',  color: '#e74c3c', x: southRoom.x + 5, z: southRoom.z, radius: 3 },
  ],
}
