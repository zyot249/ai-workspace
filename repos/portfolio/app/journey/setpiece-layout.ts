// app/journey/setpiece-layout.ts
import { SET_PIECE_SPECS, type SetPieceRole } from './building-specs'
import { HALL_LENGTH, HALL_PILLAR_SPACING, HALL_PILLAR_X, HALL_WALL_X, hallPillarZs } from './hall'
import { BUILDING_CLEARANCE, COURTYARD_DEPTH, ROAD_HALF_WIDTH } from './path'
import { seeded } from './random'

export type SetPieceGroupName = 'gate' | 'hall' | 'market' | 'house'
// The groups that are placements of models. The gate is a gateLayout instead.
export type PlacedGroupName = Exclude<SetPieceGroupName, 'gate'>

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
// The gate is a tall parabolic arch that springs from the ground, with a pier and a flat canopy on each side.
// The piers and canopies are plain boxes built in code, because the beam model carries stone detail that stretches badly.
const GATE_INNER_HALF = ROAD_HALF_WIDTH + 0.3
const GATE_ARCH_RISE = 3.2
const GATE_ARCH_THICKNESS = 0.4
const GATE_ARCH_FOOT_WIDTH = 0.6
const GATE_ARCH_DEPTH = 0.8
const GATE_ARCH_SEGMENTS = 24
const GATE_PIER: readonly [number, number, number] = [0.6, 2, 1]
const GATE_CANOPY: readonly [number, number, number] = [1.6, 0.2, 1.4]
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

const GATE_PIER_X = GATE_INNER_HALF + GATE_PIER[0] / 2
const GATE_CANOPY_X = GATE_INNER_HALF + GATE_PIER[0] + GATE_CANOPY[0] / 2

// Half extents of the gate in its own frame, for the footprint that keeps background buildings clear of it.
export const GATE_FOOTPRINT_HALF_X = GATE_INNER_HALF + GATE_PIER[0] + GATE_CANOPY[0]
export const GATE_FOOTPRINT_HALF_Z = GATE_CANOPY[2] / 2

export interface GateArch {
  span: number
  rise: number
  thickness: number
  footWidth: number
  depth: number
  segments: number
  // World y of the arch feet.
  baseY: number
}

// An axis-aligned box in the gate's own frame. `y` is the bottom face.
export interface GateBox {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
}

export interface GateLayout {
  arch: GateArch
  boxes: readonly GateBox[]
}

export function gateLayout(): GateLayout {
  const boxes = ([-1, 1] as const).flatMap((side): GateBox[] => [
    { x: side * GATE_PIER_X, y: GROUND_Y, z: 0, width: GATE_PIER[0], height: GATE_PIER[1], depth: GATE_PIER[2] },
    {
      x: side * GATE_CANOPY_X, y: GROUND_Y + GATE_PIER[1] - GATE_CANOPY[1], z: 0,
      width: GATE_CANOPY[0], height: GATE_CANOPY[1], depth: GATE_CANOPY[2],
    },
  ])
  return {
    arch: {
      span: GATE_INNER_HALF * 2,
      rise: GATE_ARCH_RISE,
      thickness: GATE_ARCH_THICKNESS,
      footWidth: GATE_ARCH_FOOT_WIDTH,
      depth: GATE_ARCH_DEPTH,
      segments: GATE_ARCH_SEGMENTS,
      baseY: GROUND_Y,
    },
    boxes,
  }
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

export function setPieceLayout(): Readonly<Record<PlacedGroupName, readonly PiecePlacement[]>> {
  return {
    hall: hallPlacements(),
    market: marketPlacements(),
    house: [place('house', 0, GROUND_Y, HOUSE_CENTER_Z, Math.PI, HOUSE)],
  }
}
