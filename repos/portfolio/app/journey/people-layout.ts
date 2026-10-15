import { type FrameSlot } from './hall'
import { headingFor, PATH_SEGMENTS, pathPointAt, PLACES } from './path'
import { CHARACTER_SPECS, type PeopleCounts, PEOPLE_SEED, WALK_SPEED_MAX, WALK_SPEED_MIN } from './people-specs'
import { seeded } from './random'

// Lateral offset of a walker from the road center line. The sidewalk strip is 3.0 to 3.9 wide and the lamp
// posts stand at 3.3, so walkers use the outer part of the strip.
export const WALK_OFFSET = 3.65
// Inside the hall the pillars stand at 3.6 with radius 0.26. A walker keeps to the road side of them.
export const HALL_WALK_OFFSET = 3.15
export const WALK_TURN_SECONDS = 0.6

// A straight piece of sidewalk, in path distance, that one walker patrols. Each lies on a single leg and
// stops short of the entrance gate pillars, the courtyard walls, the corner blocks, and the road corners.
// Ordered so the first three (the `lite` count) are spread over the street.
export interface WalkStretch {
  side: 1 | -1
  from: number
  to: number
  offset: number
}

// The two stretches on a side that also holds a talker spot end 3.5 units short of it.
export const WALK_STRETCHES: readonly WalkStretch[] = [
  { side: -1, from: 40, to: 51, offset: WALK_OFFSET },
  { side: -1, from: 12.4, to: 27.6, offset: HALL_WALK_OFFSET },
  { side: 1, from: 66, to: 75, offset: WALK_OFFSET },
  { side: 1, from: 37.5, to: 53.5, offset: WALK_OFFSET },
  { side: 1, from: 12.4, to: 27.6, offset: HALL_WALK_OFFSET },
  { side: -1, from: 69.5, to: 75, offset: WALK_OFFSET },
]

export interface Walker {
  stretch: WalkStretch
  // Units per second.
  speed: number
  // Seconds added to `t`, so walkers do not start together.
  phase: number
  character: number
}

export interface WalkerPose {
  x: number
  z: number
  yaw: number
  // False while the walker turns in place at an end.
  moving: boolean
  // Path distance of the walker, for the camera-distance checks.
  distance: number
}

const PHASE_RANGE = 60

function pointOn(stretch: WalkStretch, distance: number): { x: number; z: number } {
  const point = pathPointAt(distance)
  return {
    x: point.x + point.rightX * stretch.side * stretch.offset,
    z: point.z + point.rightZ * stretch.side * stretch.offset,
  }
}

export function stretchSegment(stretch: WalkStretch): { ax: number; az: number; bx: number; bz: number } {
  const a = pointOn(stretch, stretch.from)
  const b = pointOn(stretch, stretch.to)
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z }
}

// A pure function of `t`: walk to the far end, turn in place, walk back, turn in place, repeat. The modulo
// runs in double precision, so a large `t` loses nothing, and a negative `t` wraps.
export function walkerPoseAt(
  walker: Walker,
  t: number,
  out: WalkerPose = { x: 0, z: 0, yaw: 0, moving: true, distance: 0 },
): WalkerPose {
  const { stretch, speed } = walker
  const length = stretch.to - stretch.from
  const walkTime = length / speed
  const half = walkTime + WALK_TURN_SECONDS
  const cycle = 2 * half
  const raw = (t + walker.phase) % cycle
  const clock = raw < 0 ? raw + cycle : raw
  const outbound = clock < half
  const local = outbound ? clock : clock - half
  const fraction = Math.min(local, walkTime) / walkTime
  const along = outbound ? fraction * length : length - fraction * length
  const distance = stretch.from + along
  const point = pathPointAt(distance)
  const sign = outbound ? 1 : -1
  const baseYaw = headingFor(sign * point.dirX, sign * point.dirZ)
  const position = pointOn(stretch, distance)
  const walking = local < walkTime
  out.x = position.x
  out.z = position.z
  out.yaw = walking ? baseYaw : baseYaw + Math.PI * ((local - walkTime) / WALK_TURN_SECONDS)
  out.moving = walking
  out.distance = distance
  return out
}

export function createWalkers(count: number, characterCount: number): Walker[] {
  if (count > WALK_STRETCHES.length) throw new RangeError(`There are ${WALK_STRETCHES.length} walk stretches, not ${count}`)
  return WALK_STRETCHES.slice(0, count).map((stretch, i) => ({
    stretch,
    speed: WALK_SPEED_MIN + (WALK_SPEED_MAX - WALK_SPEED_MIN) * seeded(PEOPLE_SEED + i),
    phase: seeded(PEOPLE_SEED + 50 + i) * PHASE_RANGE,
    character: i % characterCount,
  }))
}

// Where a standing group's center sits: a path distance and a side. The three spots keep clear of the
// lamp stations (every 6 from 3), the gate, and the hall.
export interface TalkerSpot {
  distance: number
  side: 1 | -1
}

export const TALKER_SPOTS: readonly TalkerSpot[] = [
  { distance: 54.5, side: -1 },
  { distance: 65.5, side: -1 },
  { distance: 6, side: 1 },
]
// Group center lateral offset and the ring the members stand on. The ring stays inside the 3.0 to 3.9 strip.
export const TALKER_LATERAL = 3.45
export const TALKER_RING_RADIUS = 0.28

export interface Talker {
  x: number
  z: number
  yaw: number
  character: number
  distance: number
  group: number
}

export function createTalkers(groupSizes: readonly number[], characterCount: number): Talker[] {
  if (groupSizes.length > TALKER_SPOTS.length) throw new RangeError(`There are ${TALKER_SPOTS.length} talker spots, not ${groupSizes.length}`)
  const talkers: Talker[] = []
  groupSizes.forEach((size, group) => {
    const spot = TALKER_SPOTS[group]
    if (!spot) return
    const point = pathPointAt(spot.distance)
    const centerX = point.x + point.rightX * spot.side * TALKER_LATERAL
    const centerZ = point.z + point.rightZ * spot.side * TALKER_LATERAL
    const phase = seeded(PEOPLE_SEED + 100 + group) * Math.PI * 2
    for (let member = 0; member < size; member++) {
      const angle = phase + (2 * Math.PI * member) / size
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      talkers.push({
        x: centerX + TALKER_RING_RADIUS * cos,
        z: centerZ + TALKER_RING_RADIUS * sin,
        yaw: headingFor(-cos, -sin),
        character: (group + member) % characterCount,
        distance: spot.distance,
        group,
      })
    }
  })
  return talkers
}

// Guides stand between the pillars and the wall, a little off the sidewalk's outer edge of the pillars.
export const GUIDE_X = 3.7
// Per side, the first bay in this order that holds a frame.
const BAY_PREFERENCE = [1, 0, 2, 3] as const

export interface Guide {
  x: number
  z: number
  yaw: number
  character: number
  distance: number
}

export function guideSlots(frameSlots: readonly FrameSlot[], count: number): FrameSlot[] {
  const picked: FrameSlot[] = []
  for (const side of [-1, 1] as const) {
    const sideSlots = frameSlots.filter(slot => slot.side === side)
    const slot = BAY_PREFERENCE.map(bay => sideSlots[bay]).find(candidate => candidate !== undefined)
    if (slot) picked.push(slot)
  }
  return picked.slice(0, count)
}

const LEG_ONE = PATH_SEGMENTS[0]

export function createGuides(count: number, frameSlots: readonly FrameSlot[], characterCount: number): Guide[] {
  if (!LEG_ONE) throw new Error('expected path segment 0')
  return guideSlots(frameSlots, count).map((slot, i) => {
    const z = PLACES.hall.z + slot.z
    return {
      x: slot.side * GUIDE_X,
      z,
      yaw: headingFor(slot.side, 0),
      character: (i + 1) % characterCount,
      // The hall stands on leg 1, which runs toward -Z from its start.
      distance: LEG_ONE.fromZ - z,
    }
  })
}

export interface PeopleLayout {
  walkers: readonly Walker[]
  talkers: readonly Talker[]
  guides: readonly Guide[]
}

export function peopleLayout(
  counts: PeopleCounts,
  frameSlots: readonly FrameSlot[],
  characterCount = CHARACTER_SPECS.length,
): PeopleLayout {
  return {
    walkers: createWalkers(counts.walkers, characterCount),
    talkers: createTalkers(counts.talkerGroups, characterCount),
    guides: createGuides(counts.guides, frameSlots, characterCount),
  }
}

export function layoutPeopleCount(layout: PeopleLayout): number {
  return layout.walkers.length + layout.talkers.length + layout.guides.length
}
