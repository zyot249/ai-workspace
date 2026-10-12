// tests/journey/people-layout.test.ts
import { describe, expect, it } from 'vitest'
import { CORNER_BLOCKS } from '../../app/journey/footprints'
import { HALL_PILLAR_RADIUS, HALL_PILLAR_X, hallFrameSlots, hallPillarZs } from '../../app/journey/hall'
import { LAMP_SPACING_FULL, LAMP_SPACING_LOW_POWER, lampPositions } from '../../app/journey/lamps'
import {
  createGuides, createTalkers, GUIDE_X, guideSlots, layoutPeopleCount, peopleLayout, stretchSegment,
  TALKER_LATERAL, TALKER_RING_RADIUS, WALK_STRETCHES, walkerPoseAt, WALK_TURN_SECONDS, type Walker,
} from '../../app/journey/people-layout'
import { PEOPLE_COUNTS, PERSON_RADIUS, peopleTotal, WALK_SPEED_MAX, WALK_SPEED_MIN } from '../../app/journey/people-specs'
import {
  clearsPath, COURTYARD_DEPTH, PATH_SEGMENTS, PLACES, ROAD_HALF_WIDTH, roadRects, SIDEWALK_OUTER,
} from '../../app/journey/path'

const CHARACTERS = 3
const HALL_FRAMES = hallFrameSlots(8)

interface Circle { x: number; z: number; r: number }
interface Box { x: number; z: number; hx: number; hz: number }

const GATE_PILLAR_HALF = 0.3
const LAMP_POST_RADIUS = 0.05
const COURTYARD_WALL_HALF_THICKNESS = 0.15
const COURTYARD_WALL_OFFSET = 3.5
const MARKET_LAMP_OFFSET = ROAD_HALF_WIDTH + 0.3
// Both lamp layouts, plus the two market posts, which sit at the market center +-3.3 across the road.
const POST_CIRCLES: Circle[] = [
  ...lampPositions(LAMP_SPACING_FULL), ...lampPositions(LAMP_SPACING_LOW_POWER),
  { x: PLACES.market.x, z: PLACES.market.z - MARKET_LAMP_OFFSET }, { x: PLACES.market.x, z: PLACES.market.z + MARKET_LAMP_OFFSET },
].map(point => ({ x: point.x, z: point.z, r: LAMP_POST_RADIUS }))
const PILLAR_CIRCLES: Circle[] = [-1, 1].flatMap(side => hallPillarZs().map(z => (
  { x: side * HALL_PILLAR_X, z: PLACES.hall.z + z, r: HALL_PILLAR_RADIUS })))
const BOXES: Box[] = [
  ...[-1, 1].map(side => ({ x: side * (ROAD_HALF_WIDTH + 0.4), z: PLACES.entrance.z, hx: GATE_PILLAR_HALF, hz: GATE_PILLAR_HALF })),
  ...[-1, 1].map(side => ({ x: PLACES.courtyard.x + side * COURTYARD_WALL_OFFSET, z: PLACES.courtyard.z,
    hx: COURTYARD_WALL_HALF_THICKNESS, hz: COURTYARD_DEPTH / 2 })),
  { x: PLACES.courtyard.x, z: PLACES.courtyard.z - COURTYARD_DEPTH / 2, hx: 3.5, hz: COURTYARD_WALL_HALF_THICKNESS },
  ...CORNER_BLOCKS.map(block => ({ x: block.x, z: block.z, hx: block.width / 2, hz: block.depth / 2 })),
]

function clearanceAt(x: number, z: number): number {
  const circles = [...POST_CIRCLES, ...PILLAR_CIRCLES].map(c => Math.hypot(x - c.x, z - c.z) - c.r)
  const boxes = BOXES.map(b => Math.hypot(Math.max(Math.abs(x - b.x) - b.hx, 0), Math.max(Math.abs(z - b.z) - b.hz, 0)))
  return Math.min(...circles, ...boxes)
}

function insideRoad(x: number, z: number): boolean {
  return roadRects().some(([minX, minZ, maxX, maxZ]) =>
    x > minX - PERSON_RADIUS && x < maxX + PERSON_RADIUS && z > minZ - PERSON_RADIUS && z < maxZ + PERSON_RADIUS)
}

function expectOnSidewalk(x: number, z: number) {
  expect(clearanceAt(x, z), JSON.stringify({x,z})).toBeGreaterThanOrEqual(PERSON_RADIUS)
  expect(insideRoad(x, z)).toBe(false)
  expect(clearsPath(x, z, SIDEWALK_OUTER + PERSON_RADIUS)).toBe(false)
}

function stretchLeg(from: number, to: number): number {
  return PATH_SEGMENTS.findIndex(segment => from >= segment.cumStart && to <= segment.cumStart + segment.length)
}

describe('walk stretches', () => {
  it('lies on one leg each and keeps the road, obstacles, and the sidewalk edge clear', () => {
    for (const stretch of WALK_STRETCHES) {
      expect(stretchLeg(stretch.from, stretch.to), JSON.stringify(stretch)).toBeGreaterThanOrEqual(0)
      const { ax, az, bx, bz } = stretchSegment(stretch)
      for (let i = 0; i <= 20; i++) {
        const f = i / 20
        expectOnSidewalk(ax + (bx - ax) * f, az + (bz - az) * f)
      }
    }
  })
})

function walker(stretch = WALK_STRETCHES[0]!, speed = 0.7, phase = 0): Walker {
  return { stretch, speed, phase, character: 0 }
}

describe('walkerPoseAt', () => {
  it('stays on its stretch, finite, and continuous through turns, even for huge or negative t', () => {
    for (const stretch of WALK_STRETCHES) {
      for (const t0 of [0, 1e7, -3.3]) {
        let previous = walkerPoseAt(walker(stretch), t0)
        const cycle = 2 * ((stretch.to - stretch.from) / 0.7 + WALK_TURN_SECONDS)
        for (let t = t0 + 0.05; t < t0 + cycle + 1; t += 0.05) {
          const pose = walkerPoseAt(walker(stretch), t)
          expect(Number.isFinite(pose.x) && Number.isFinite(pose.z) && Number.isFinite(pose.yaw)).toBe(true)
          expect(pose.distance).toBeGreaterThanOrEqual(stretch.from - 1e-6)
          expect(pose.distance).toBeLessThanOrEqual(stretch.to + 1e-6)
          expect(Math.hypot(pose.x - previous.x, pose.z - previous.z)).toBeLessThanOrEqual(0.7 * 0.05 + 1e-6)
          const turn = Math.atan2(Math.sin(pose.yaw - previous.yaw), Math.cos(pose.yaw - previous.yaw))
          expect(Math.abs(turn)).toBeLessThanOrEqual(0.4)
          previous = { ...pose }
        }
      }
    }
  })

  it('walks forward, turns in place, walks back, and turns again', () => {
    const w = walker(WALK_STRETCHES[0]!, 1, 0)
    const length = w.stretch.to - w.stretch.from
    expect(walkerPoseAt(w, 0).moving).toBe(true)
    const turning = walkerPoseAt(w, length + WALK_TURN_SECONDS / 2)
    expect(turning.moving).toBe(false)
    expect(turning.distance).toBeCloseTo(w.stretch.to, 6)
    expect(walkerPoseAt(w, length + WALK_TURN_SECONDS + length / 2).distance).toBeCloseTo(w.stretch.to - length / 2, 6)
    expect(walkerPoseAt(w, 2 * (length + WALK_TURN_SECONDS)).distance).toBeCloseTo(w.stretch.from, 6)
  })

  it('writes into the pose it is given', () => {
    const out = { x: 0, z: 0, yaw: 0, moving: false, distance: 0 }
    expect(walkerPoseAt(walker(), 4, out)).toBe(out)
  })
})

describe('createTalkers', () => {
  it('stands each group on a sidewalk spot, facing its center, clear of obstacles and each other', () => {
    const talkers = createTalkers(PEOPLE_COUNTS.full.talkerGroups, CHARACTERS)
    expect(talkers).toHaveLength(8)
    for (const talker of talkers) expectOnSidewalk(talker.x, talker.z)
    for (const group of [0, 1, 2]) {
      const members = talkers.filter(talker => talker.group === group)
      const cx = members.reduce((sum, m) => sum + m.x, 0) / members.length
      const cz = members.reduce((sum, m) => sum + m.z, 0) / members.length
      for (const m of members) {
        expect(Math.hypot(m.x - cx, m.z - cz)).toBeCloseTo(TALKER_RING_RADIUS, 6)
        // yaw turns a -Z-facing object toward the center: facing = (-sin yaw, -cos yaw)
        const facing = { x: -Math.sin(m.yaw), z: -Math.cos(m.yaw) }
        expect(facing.x * (cx - m.x) + facing.z * (cz - m.z)).toBeCloseTo(TALKER_RING_RADIUS, 6)
      }
      for (const a of members) for (const b of members) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * PERSON_RADIUS + 0.1)
      }
      expect(new Set(members.map(m => m.character)).size).toBe(members.length)
    }
    expect(TALKER_LATERAL + TALKER_RING_RADIUS + PERSON_RADIUS).toBeLessThanOrEqual(SIDEWALK_OUTER)
  })

  it('throws when there are more groups than spots', () => {
    expect(() => createTalkers([2, 2, 2, 2], CHARACTERS)).toThrow(RangeError)
  })
})

describe('guides', () => {
  it('picks one frame per side, preferring the second bay, and none when there are no frames', () => {
    expect(guideSlots([], 2)).toEqual([])
    const picked = guideSlots(HALL_FRAMES, 2)
    expect(picked.map(slot => slot.side)).toEqual([-1, 1])
    expect(picked[0]).toBe(HALL_FRAMES[1])
    expect(picked[1]).toBe(HALL_FRAMES[5])
  })

  it('uses what exists: a single frame, only the left wall, and the cap of eight', () => {
    expect(guideSlots(hallFrameSlots(1), 2)).toEqual([hallFrameSlots(1)[0]])
    expect(guideSlots(hallFrameSlots(3), 2).map(slot => slot.side)).toEqual([-1])
    expect(guideSlots(hallFrameSlots(12), 2)).toHaveLength(2)
    expect(guideSlots(HALL_FRAMES, 1)).toHaveLength(1)
  })

  it('stands in a bay center, off the road and clear of pillars, facing the wall', () => {
    const guides = createGuides(2, HALL_FRAMES, CHARACTERS)
    expect(guides).toHaveLength(2)
    for (const guide of guides) {
      expectOnSidewalk(guide.x, guide.z)
      expect(Math.abs(guide.x)).toBe(GUIDE_X)
      const facing = { x: -Math.sin(guide.yaw), z: -Math.cos(guide.yaw) }
      expect(facing.x * Math.sign(guide.x)).toBeCloseTo(1, 6)
      expect(Math.abs(facing.z)).toBeLessThan(1e-9)
    }
  })
})

describe('peopleLayout', () => {
  it('matches the per-tier counts and is deterministic', () => {
    const full = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    expect(layoutPeopleCount(full)).toBe(peopleTotal(PEOPLE_COUNTS.full))
    expect(peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)).toEqual(full)
    expect(layoutPeopleCount(peopleLayout(PEOPLE_COUNTS.lite, HALL_FRAMES))).toBe(peopleTotal(PEOPLE_COUNTS.lite))
    expect(layoutPeopleCount(peopleLayout(PEOPLE_COUNTS.reduced, HALL_FRAMES))).toBe(0)
  })

  it('has no guides without projects, and one with a single project', () => {
    expect(peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(0)).guides).toHaveLength(0)
    expect(peopleLayout(PEOPLE_COUNTS.full, hallFrameSlots(1)).guides).toHaveLength(1)
  })

  it('gives walkers a speed in range and every person a valid character', () => {
    const layout = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    for (const w of layout.walkers) {
      expect(w.speed).toBeGreaterThanOrEqual(WALK_SPEED_MIN)
      expect(w.speed).toBeLessThanOrEqual(WALK_SPEED_MAX)
    }
    const characters = [...layout.walkers, ...layout.talkers, ...layout.guides].map(person => person.character)
    for (const character of characters) expect(character).toBeLessThan(CHARACTERS)
  })

  it('keeps standing people clear of every walker stretch', () => {
    const layout = peopleLayout(PEOPLE_COUNTS.full, HALL_FRAMES)
    const minimum = 2 * PERSON_RADIUS + 0.1
    for (const person of [...layout.talkers, ...layout.guides]) {
      for (const stretch of WALK_STRETCHES) {
        const { ax, az, bx, bz } = stretchSegment(stretch)
        const dx = bx - ax
        const dz = bz - az
        const f = Math.min(Math.max(((person.x - ax) * dx + (person.z - az) * dz) / (dx * dx + dz * dz), 0), 1)
        expect(Math.hypot(person.x - (ax + dx * f), person.z - (az + dz * f))).toBeGreaterThanOrEqual(minimum)
      }
    }
  })

  it('rejects more walkers than stretches', () => {
    expect(() => peopleLayout({ walkers: 7, talkerGroups: [], guides: 0 }, HALL_FRAMES)).toThrow(RangeError)
  })
})
