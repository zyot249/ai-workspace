// tests/journey/building-glow.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GLOW_END, GLOW_START, UNIFORM_GLOW, WINDOW_GLOW } from '../../app/journey/building-specs'
import { applyBuildingGlow, glowFor } from '../../app/journey/building-glow'
import type { BuildingModels } from '../../app/journey/building-models'

function models(): { models: BuildingModels; wall: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial } {
  // Three.js defaults emissiveIntensity to 1, so start at 0 to make "untouched" observable.
  const wall = new THREE.MeshStandardMaterial({ name: 'wall', emissiveIntensity: 0 })
  const glass = new THREE.MeshStandardMaterial({ name: 'glass', emissiveIntensity: 0 })
  const part = (material: THREE.Material) => ({ geometry: new THREE.BoxGeometry(1, 1, 1), material })
  const piece = { parts: [part(wall), part(glass)], size: [1, 1, 1] as const }
  return {
    models: { setPieces: { beam: piece, hallColumn: piece, hallWall: piece, stall: piece, house: piece }, near: [piece] },
    wall, glass,
  }
}

describe('glowFor', () => {
  it('is 0 by day and 1 at night, rising between the thresholds', () => {
    expect(glowFor(0)).toBe(0)
    expect(glowFor(GLOW_START)).toBe(0)
    expect(glowFor(GLOW_END)).toBe(1)
    expect(glowFor(1)).toBe(1)
    const mid = glowFor((GLOW_START + GLOW_END) / 2)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

describe('applyBuildingGlow', () => {
  it('glow ramps with windowLitRatio on window materials only', () => {
    const { models: m, wall, glass } = models()
    applyBuildingGlow(m, 0, ['glass'])
    expect(glass.emissiveIntensity).toBe(0)
    expect(wall.emissiveIntensity).toBe(0)
    applyBuildingGlow(m, 1, ['glass'])
    expect(glass.emissiveIntensity).toBeCloseTo(WINDOW_GLOW, 5)
    expect(wall.emissiveIntensity).toBe(0)
    expect(glass.emissive.getHex()).not.toBe(0)
  })

  it('falls back to uniform glow without a window material', () => {
    const { models: m, wall, glass } = models()
    applyBuildingGlow(m, 1, [])
    expect(wall.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
    expect(glass.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
  })

  it('falls back to uniform glow when no material matches a window name', () => {
    const { models: m, wall } = models()
    applyBuildingGlow(m, 1, ['does-not-exist'])
    expect(wall.emissiveIntensity).toBeCloseTo(UNIFORM_GLOW, 5)
  })

  it('writes each shared material once', () => {
    const { models: m, glass } = models()
    let writes = 0
    let intensity = 0
    Object.defineProperty(glass, 'emissiveIntensity', { get: () => intensity, set: (value: number) => { writes++; intensity = value } })
    applyBuildingGlow(m, 1, ['glass'])
    expect(writes).toBe(1)
  })
})
