import { useMemo } from 'react';
import * as THREE from 'three';
import type { RoomSpec } from '../game/RoomSpec';
import type { WallOpening, WallOpenings } from '../game/WorldSpec';
import { Textures } from '../game/textures';

function makeMaterials(): THREE.Material[] {
  const side = new THREE.MeshLambertMaterial({ map: Textures.barrierSide() });
  const top = new THREE.MeshLambertMaterial({ map: Textures.barrierTop() });
  const hidden = new THREE.MeshLambertMaterial({ visible: false });
  // BoxGeometry face order: +X, -X, +Y (top), -Y, +Z, -Z
  return [side, side, top, hidden, side, side];
}

// Split [from, to] into solid segments with openings cut out.
function segmentWall(
  from: number, to: number,
  opens: Array<{ center: number; width: number }>,
): Array<{ from: number; to: number }> {
  if (!opens.length) return [{ from, to }]

  const cuts = opens
    .map(o => ({ from: Math.max(from, o.center - o.width / 2), to: Math.min(to, o.center + o.width / 2) }))
    .filter(c => c.to > c.from)
    .sort((a, b) => a.from - b.from)

  const segs: { from: number; to: number }[] = []
  let cursor = from
  for (const cut of cuts) {
    if (cut.from > cursor) segs.push({ from: cursor, to: cut.from })
    cursor = Math.max(cursor, cut.to)
  }
  if (cursor < to) segs.push({ from: cursor, to })
  return segs
}

interface BarrierProps {
  room: RoomSpec
  openings?: Partial<WallOpenings>
}

// Low barrier around room edges. N/S walls span the full room width and own the 4 corner
// squares. E/W walls fill the interior strip between the N/S blocks (±(hd−bt)).
// Each opening is inset by bt on both sides: the wall segment extends into the corner square
// where the perpendicular barrier of the adjacent room meets this one, closing the gap.
export function Barrier({ room, openings = {} }: BarrierProps) {
  const { floorWidth: fw, floorDepth: fd, barrierHeight: bh, barrierThickness: bt } = room
  const hw = fw / 2, hd = fd / 2, hy = bh / 2
  const disabled = new Set(room.disabledWalls ?? [])

  const mats = useMemo(makeMaterials, [])

  const inset = (opens: WallOpening[]) =>
    opens.map(o => ({ center: o.center, width: o.width - 2 * bt }))

  const ewFrom = disabled.has('north') ? -hd : -(hd - bt)
  const ewTo   = disabled.has('south') ? +hd : +(hd - bt)

  const northSegs = disabled.has('north') ? [] : segmentWall(-hw, hw, inset(openings.north ?? []))
  const southSegs = disabled.has('south') ? [] : segmentWall(-hw, hw, inset(openings.south ?? []))
  const eastSegs  = disabled.has('east')  ? [] : segmentWall(ewFrom, ewTo, inset(openings.east  ?? []))
  const westSegs  = disabled.has('west')  ? [] : segmentWall(ewFrom, ewTo, inset(openings.west  ?? []))

  return (
    <group>
      {northSegs.map((seg, i) => (
        <mesh key={i} material={mats} position={[(seg.from + seg.to) / 2, hy, -(hd - bt / 2)]} castShadow receiveShadow>
          <boxGeometry args={[seg.to - seg.from, bh, bt]} />
        </mesh>
      ))}
      {southSegs.map((seg, i) => (
        <mesh key={i} material={mats} position={[(seg.from + seg.to) / 2, hy, +(hd - bt / 2)]} castShadow receiveShadow>
          <boxGeometry args={[seg.to - seg.from, bh, bt]} />
        </mesh>
      ))}
      {eastSegs.map((seg, i) => (
        <mesh key={i} material={mats} position={[+(hw - bt / 2), hy, (seg.from + seg.to) / 2]} castShadow receiveShadow>
          <boxGeometry args={[bt, bh, seg.to - seg.from]} />
        </mesh>
      ))}
      {westSegs.map((seg, i) => (
        <mesh key={i} material={mats} position={[-(hw - bt / 2), hy, (seg.from + seg.to) / 2]} castShadow receiveShadow>
          <boxGeometry args={[bt, bh, seg.to - seg.from]} />
        </mesh>
      ))}
    </group>
  )
}
