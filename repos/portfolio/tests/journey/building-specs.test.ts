// tests/journey/building-specs.test.ts
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILDING_ASSET_BUDGET_BYTES, BUILDING_MODEL_DIR, HOUSE_WINDOW_SLOTS, MAX_NEAR_MESHES, NEAR_VARIANT_SPECS,
  SET_PIECE_ROLES, SET_PIECE_SPECS, WINDOW_MATERIAL_NAMES,
} from '../../app/journey/building-specs'

const MODEL_DIR = join(__dirname, '../../public', BUILDING_MODEL_DIR)
const allSpecs = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]

describe('building specs', () => {
  it('has a positive scale and size for every piece', () => {
    for (const spec of allSpecs) {
      expect(spec.scale).toBeGreaterThan(0)
      expect(spec.size.every(value => value > 0)).toBe(true)
    }
  })

  it('names a .glb file that exists in public/models/buildings for every piece', () => {
    for (const spec of allSpecs) {
      expect(spec.file.endsWith('.glb')).toBe(true)
      expect(existsSync(join(MODEL_DIR, spec.file)), spec.file).toBe(true)
    }
  })

  it('ships no unused GLB and stays inside the download budget', () => {
    const published = readdirSync(MODEL_DIR).filter(name => name.endsWith('.glb')).sort()
    const used = [...new Set(allSpecs.map(spec => spec.file))].sort()
    expect(published).toEqual(used)
    const bytes = published.reduce((sum, name) => sum + statSync(join(MODEL_DIR, name)).size, 0)
    expect(bytes).toBeLessThanOrEqual(BUILDING_ASSET_BUDGET_BYTES)
  })

  it('has between 2 and 6 near variants and a license file', () => {
    expect(NEAR_VARIANT_SPECS.length).toBeGreaterThanOrEqual(2)
    expect(NEAR_VARIANT_SPECS.length).toBeLessThanOrEqual(MAX_NEAR_MESHES)
    expect(existsSync(join(MODEL_DIR, 'LICENSE.txt'))).toBe(true)
  })

  it('has exactly two courtyard window slots', () => {
    expect(HOUSE_WINDOW_SLOTS).toHaveLength(2)
  })

  it('has no duplicate window material names', () => {
    expect(new Set(WINDOW_MATERIAL_NAMES).size).toBe(WINDOW_MATERIAL_NAMES.length)
  })
})
