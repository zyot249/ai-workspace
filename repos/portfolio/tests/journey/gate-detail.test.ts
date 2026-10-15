// tests/journey/gate-detail.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GATE_BASE_UV, GATE_PORTHOLE_UV, GATE_TRIM_UV } from '../../app/journey/building-specs'
import { type DetailPart, gateDetailParts, PORTHOLES_PER_FACE, RIB_COUNT } from '../../app/journey/gate-detail'
import { gateLayout } from '../../app/journey/setpiece-layout'

const EPSILON = 1e-4
const layout = gateLayout()
const { arch, boxes } = layout
const innerHalf = arch.span / 2
const outerHalf = innerHalf + arch.footWidth
const outerHeight = arch.rise + arch.thickness
const parts = gateDetailParts(layout)

function ofKind(kind: DetailPart['kind']): DetailPart[] {
  return parts.filter(part => part.kind === kind)
}

function bounds(part: DetailPart): THREE.Box3 {
  part.geometry.computeBoundingBox()
  return part.geometry.boundingBox as THREE.Box3
}

// True when (x, y), in the arch frame with the feet on y = 0, lies between the two parabolas.
function inBand(x: number, y: number): boolean {
  const top = outerHeight * (1 - (x / outerHalf) ** 2)
  const under = Math.abs(x) <= innerHalf ? arch.rise * (1 - (x / innerHalf) ** 2) : 0
  return Math.abs(x) <= outerHalf + EPSILON && y <= top + EPSILON && y >= under - EPSILON
}

describe('gateDetailParts', () => {
  it('is deterministic', () => {
    const again = gateDetailParts(layout)
    expect(again.map(p => p.kind)).toEqual(parts.map(p => p.kind))
    expect(again.map(p => Array.from(p.geometry.getAttribute('position').array)))
      .toEqual(parts.map(p => Array.from(p.geometry.getAttribute('position').array)))
  })

  it('makes the ribs, the portholes on both faces, a plinth under each pier, and a trim under each canopy', () => {
    expect(ofKind('rib')).toHaveLength(RIB_COUNT)
    expect(ofKind('porthole')).toHaveLength(PORTHOLES_PER_FACE * 2)
    expect(ofKind('plinth')).toHaveLength(2)
    expect(ofKind('trim')).toHaveLength(2)
  })

  it('has position, normal, and one flat palette color per kind', () => {
    const colors: Record<DetailPart['kind'], readonly [number, number]> = {
      rib: GATE_TRIM_UV, porthole: GATE_PORTHOLE_UV, plinth: GATE_BASE_UV, trim: GATE_BASE_UV,
    }
    for (const part of parts) {
      expect(Object.keys(part.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv'])
      const uv = part.geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(colors[part.kind][0], 6)
        expect(uv.getY(i)).toBeCloseTo(colors[part.kind][1], 6)
      }
    }
  })

  it('puts nothing below the ground', () => {
    for (const part of parts) expect(bounds(part).min.y).toBeGreaterThanOrEqual(arch.baseY - EPSILON)
  })

  it('spaces the ribs evenly along the arch, mirror symmetric, with one on the middle', () => {
    const centers = ofKind('rib').map(part => bounds(part).getCenter(new THREE.Vector3())).sort((a, b) => a.x - b.x)
    expect(centers.some(c => Math.abs(c.x) < EPSILON)).toBe(true)
    centers.forEach((center, i) => {
      const mirror = centers[centers.length - 1 - i]!
      expect(center.x).toBeCloseTo(-mirror.x, 4)
      expect(center.y).toBeCloseTo(mirror.y, 4)
      expect(inBand(center.x, center.y - arch.baseY)).toBe(true)
    })
  })

  it('lets each rib stand slightly proud of both faces of the arch', () => {
    for (const part of ofKind('rib')) {
      const box = bounds(part)
      expect(box.max.z).toBeGreaterThan(arch.depth / 2)
      expect(box.min.z).toBeLessThan(-arch.depth / 2)
      expect(box.max.z).toBeLessThanOrEqual(arch.depth / 2 + 0.2)
    }
  })

  it('sets the portholes into the band, proud of the face, the same count on each face', () => {
    const front = ofKind('porthole').filter(part => bounds(part).getCenter(new THREE.Vector3()).z > 0)
    const back = ofKind('porthole').filter(part => bounds(part).getCenter(new THREE.Vector3()).z < 0)
    expect(front).toHaveLength(PORTHOLES_PER_FACE)
    expect(back).toHaveLength(PORTHOLES_PER_FACE)
    for (const part of [...front, ...back]) {
      const box = bounds(part)
      const center = box.getCenter(new THREE.Vector3())
      expect(inBand(center.x, center.y - arch.baseY)).toBe(true)
      expect(Math.max(Math.abs(box.min.z), Math.abs(box.max.z))).toBeGreaterThan(arch.depth / 2)
      expect(Math.max(Math.abs(box.min.z), Math.abs(box.max.z))).toBeLessThanOrEqual(arch.depth / 2 + 0.1)
    }
  })

  it('keeps every porthole clear of the ribs', () => {
    const ribs = ofKind('rib').map(bounds)
    for (const part of ofKind('porthole')) {
      const box = bounds(part)
      const ribHits = ribs.filter(rib => rib.min.x < box.max.x && rib.max.x > box.min.x && rib.min.y < box.max.y && rib.max.y > box.min.y)
      expect(ribHits).toHaveLength(0)
    }
  })

  it('stands a plinth on the ground around each pier, wider than the pier', () => {
    const piers = boxes.filter(box => box.height > 1)
    const plinths = ofKind('plinth')
    expect(plinths).toHaveLength(piers.length)
    for (const pier of piers) {
      const plinth = plinths.map(bounds).find(box => Math.abs(box.getCenter(new THREE.Vector3()).x - pier.x) < EPSILON)!
      expect(plinth).toBeDefined()
      expect(plinth.min.y).toBeCloseTo(pier.y, 5)
      expect(plinth.max.x - plinth.min.x).toBeGreaterThan(pier.width)
      expect(plinth.max.z - plinth.min.z).toBeGreaterThan(pier.depth)
      expect(plinth.max.y).toBeLessThan(pier.y + pier.height)
    }
  })

  it('hangs a trim strip right under each canopy', () => {
    const canopies = boxes.filter(box => box.height <= 1)
    const trims = ofKind('trim').map(bounds)
    for (const canopy of canopies) {
      const trim = trims.find(box => Math.abs(box.getCenter(new THREE.Vector3()).x - canopy.x) < EPSILON)!
      expect(trim).toBeDefined()
      expect(trim.max.y).toBeCloseTo(canopy.y, 5)
      expect(trim.max.x - trim.min.x).toBeCloseTo(canopy.width, 5)
    }
  })
})
