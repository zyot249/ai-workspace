import { ROAD_HALF_WIDTH } from './path'

export const HALL_LENGTH = 16
export const HALL_WALL_X = ROAD_HALF_WIDTH + 1.1
export const HALL_PILLAR_SPACING = 3.5
// The colonnade pillars stand 0.6 off the road edge. Their base radius is 0.26.
export const HALL_PILLAR_X = ROAD_HALF_WIDTH + 0.6
export const HALL_PILLAR_RADIUS = 0.26

export interface FrameSlot {
  side: -1 | 1
  z: number
}

// z (in the hall's own local frame, center = 0) of each pillar along one wall.
export function hallPillarZs(): number[] {
  const pillarCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const zs: number[] = []
  for (let i = 0; i <= pillarCount; i++) zs.push(HALL_LENGTH / 2 - i * HALL_PILLAR_SPACING)
  return zs
}

// One slot per bay between pillars, left wall first (the projects HTML panel
// covers the right wall's screen position at the projects camera stop — see
// `stops.ts`). At most 8 projects fit (4 bays per wall at HALL_LENGTH 16);
// beyond that, extra projects are simply not given a frame.
export function hallFrameSlots(projectCount: number): FrameSlot[] {
  const bayCount = Math.floor(HALL_LENGTH / HALL_PILLAR_SPACING)
  const slots: FrameSlot[] = []
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < bayCount; k++) {
      slots.push({ side, z: HALL_LENGTH / 2 - (k + 0.5) * HALL_PILLAR_SPACING })
    }
  }
  return slots.slice(0, Math.min(projectCount, slots.length))
}
