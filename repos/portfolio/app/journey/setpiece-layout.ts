// app/journey/setpiece-layout.ts
import { SET_PIECE_SPECS, type SetPieceRole } from './building-specs'
import { HALL_LENGTH, HALL_PILLAR_SPACING, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from './hall'
import { BUILDING_CLEARANCE, COURTYARD_DEPTH, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'

export type SetPieceGroupName = 'gate' | 'hall' | 'market' | 'house'

export interface PiecePlacement {
  role: SetPieceRole
  x: number
  y: number
  z: number
  rotY: number
  sx: number
  sy: number
  sz: number
}

// Same ground level the procedural pieces stand on (`BASE_Y` in buildings.ts).
const GROUND_Y = -1
const STALL_COUNT = 6
const STALL_SEED = 7000
const HALF_TURN = Math.PI / 2

// Target dimensions in each piece's own model axes: [along x (width), y (height), along z (depth)].
const GATE_PILLAR: readonly [number, number, number] = [0.6, 3.4, 0.6]
const GATE_ARCH_RISE = 0.9
const GATE_ARCH_THICKNESS = 0.35
const GATE_ARCH_SEGMENTS = 16
const HALL_COLUMN: readonly [number, number, number] = [0.52, 3, 0.52]
const HALL_BEAM_BASE_Y = 1.95
const HALL_BEAM_HEIGHT = 0.3
const HALL_BEAM_DEPTH = 0.5
const HALL_WALL_HEIGHT = 2.4
const HALL_WALL_THICKNESS = 0.15
const STALL: readonly [number, number, number] = [1.2, 1.7, 1.2]
const HOUSE: readonly [number, number, number] = [3, 3.05, 3]
const HOUSE_HALF_DEPTH = HOUSE[2] / 2
const HOUSE_BACK_GAP = 1.8

// The courtyard frame has its back wall at -COURTYARD_DEPTH / 2. The house stands HOUSE_BACK_GAP in front of it.
export const HOUSE_CENTER_Z = -COURTYARD_DEPTH / 2 + HOUSE_BACK_GAP
export const HOUSE_FRONT_Z = HOUSE_CENTER_Z + HOUSE_HALF_DEPTH

function place(
  role: SetPieceRole, x: number, y: number, z: number, rotY: number, target: readonly [number, number, number],
): PiecePlacement {
  const size = SET_PIECE_SPECS[role].size
  return { role, x, y, z, rotY, sx: target[0] / size[0], sy: target[1] / size[1], sz: target[2] / size[2] }
}

const GATE_PILLAR_X = ROAD_HALF_WIDTH + 0.4

export interface GateArch {
  span: number
  rise: number
  thickness: number
  depth: number
  segments: number
  // World y of the underside at the arch ends.
  baseY: number
}

// The arch spans the outer pillar edges. Its underside meets the pillar top at the pillar's inner edge and sinks into
// the pillar beyond that, so no gap shows above the pillar.
export function gateArch(): GateArch {
  const half = GATE_PILLAR_X + GATE_PILLAR[0] / 2
  const inner = GATE_PILLAR_X - GATE_PILLAR[0] / 2
  const pillarTop = GROUND_Y + GATE_PILLAR[1]
  return {
    span: half * 2,
    rise: GATE_ARCH_RISE,
    thickness: GATE_ARCH_THICKNESS,
    depth: GATE_PILLAR[2],
    segments: GATE_ARCH_SEGMENTS,
    baseY: pillarTop - GATE_ARCH_RISE * (1 - (inner / half) ** 2),
  }
}

function gatePlacements(): PiecePlacement[] {
  return ([-1, 1] as const).map(side => place('gatePillar', side * GATE_PILLAR_X, GROUND_Y, 0, 0, GATE_PILLAR))
}

function hallPlacements(): PiecePlacement[] {
  const placed: PiecePlacement[] = []
  const segmentCount = Math.ceil(HALL_LENGTH / HALL_PILLAR_SPACING)
  const segmentLength = HALL_LENGTH / segmentCount
  for (const side of [-1, 1] as const) {
    for (const z of hallPillarZs()) placed.push(place('hallColumn', side * HALL_PILLAR_X, GROUND_Y, z, 0, HALL_COLUMN))
    placed.push(place('beam', side * HALL_PILLAR_X, HALL_BEAM_BASE_Y, 0, HALF_TURN, [HALL_LENGTH, HALL_BEAM_HEIGHT, HALL_BEAM_DEPTH]))
    for (let k = 0; k < segmentCount; k++) {
      const z = HALL_LENGTH / 2 - (k + 0.5) * segmentLength
      placed.push(place('hallWall', side * HALL_WALL_X, GROUND_Y, z, side * HALF_TURN,
        [segmentLength, HALL_WALL_HEIGHT, HALL_WALL_THICKNESS]))
    }
  }
  return placed
}

function marketPlacements(): PiecePlacement[] {
  return Array.from({ length: STALL_COUNT }, (_, i) => {
    const seed = STALL_SEED + i
    const side = i % 2 === 0 ? -1 : 1
    const x = side * (BUILDING_CLEARANCE + 0.5 + seeded(seed) * 3)
    const z = (seeded(seed + 1) - 0.5) * 12
    return place('stall', x, GROUND_Y, z, side * HALF_TURN, STALL)
  })
}

export function setPieceLayout(): Readonly<Record<SetPieceGroupName, readonly PiecePlacement[]>> {
  return {
    gate: gatePlacements(),
    hall: hallPlacements(),
    market: marketPlacements(),
    house: [place('house', 0, GROUND_Y, HOUSE_CENTER_Z, Math.PI, HOUSE)],
  }
}
