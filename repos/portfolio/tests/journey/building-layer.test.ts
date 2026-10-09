import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  applyBuildingState, BEACON_PERIOD, BEACON_RADIUS, type BuildingLayer, createBuildingLayer, layerMeshes, LAYERS,
} from '../../app/journey/buildings'
import { createFacadeUniforms } from '../../app/journey/facade-material'

const layerFor = (index: number, lowPower = false): BuildingLayer =>
  createBuildingLayer(index, { lowPower, facade: createFacadeUniforms() })
const run = (layer: BuildingLayer, o: { height?: number, density?: number, time?: number, steady?: boolean } = {}) =>
  applyBuildingState(layer, o.height ?? 1, o.density ?? 1, o.time ?? 0, o.steady ?? false)

const matrix = new THREE.Matrix4()
function scaleAt(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
}
// A time at which a building with `phase` sits at `cycle` of its 1.6 s blink cycle.
const timeAtCycle = (phase: number, cycle: number) => ((((cycle - phase) % 1) + 1) % 1) * BEACON_PERIOD

describe('createBuildingLayer', () => {
  it('builds the part-instanced box mesh with per-part attributes', () => {
    const layer = layerFor(0)
    const { boxMesh } = layer
    const total = layer.partRanges.reduce((sum, r) => sum + r.count, 0)
    expect(boxMesh.count).toBe(total)
    expect(boxMesh.userData.buildingCount).toBe(LAYERS[0].count)
    expect(boxMesh.frustumCulled).toBe(false)
    expect(boxMesh.name).toBe('journey-building-near')
    expect(boxMesh.geometry.getAttribute('aSeed').count).toBe(total)
    expect(boxMesh.geometry.getAttribute('aWindowed').count).toBe(total)
    expect((boxMesh.material as THREE.Material).name).toBe('journey-facade-full')
  })

  it('marks bodies windowed and rooftop blocks not, and shares one seed per building', () => {
    const layer = layerFor(1)
    const windowed = layer.boxMesh.geometry.getAttribute('aWindowed')
    const seeds = layer.boxMesh.geometry.getAttribute('aSeed')
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      const equipment = building.archetype === 'crowned' || building.archetype === 'spire'
      for (let p = 0; p < count; p++) {
        expect(windowed.getX(start + p)).toBe(equipment && p === 1 ? 0 : 1)
        expect(seeds.getX(start + p)).toBe(seeds.getX(start))
      }
    })
  })

  it('tints bodies within 8% of the layer color and equipment dark gray', () => {
    const layer = layerFor(0)
    const base = new THREE.Color(LAYERS[0].color)
    const equipment = new THREE.Color(0x2a2a30)
    const color = new THREE.Color()
    let sawEquipment = false
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      for (let p = 0; p < count; p++) {
        layer.boxMesh.getColorAt(start + p, color)
        const isEquipment = (building.archetype === 'crowned' || building.archetype === 'spire') && p === 1
        if (isEquipment) {
          sawEquipment = true
          expect(color.r).toBeCloseTo(equipment.r, 5)
        } else {
          expect(color.r / base.r).toBeGreaterThanOrEqual(0.92 - 1e-4)
          expect(color.r / base.r).toBeLessThanOrEqual(1.08 + 1e-4)
        }
      }
    })
    expect(sawEquipment).toBe(true)
    expect((layer.boxMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff)
  })

  it('creates spire and beacon meshes only where the layer has spires', () => {
    const [near, mid, far] = [0, 1, 2].map(i => layerFor(i))
    for (const layer of [near!, mid!]) {
      expect(layer.spireBuildingIndices).toHaveLength(2)
      expect(layer.spireMesh?.count).toBe(2)
      expect(layer.beaconMesh?.count).toBe(2)
      expect(layer.spireMesh?.frustumCulled).toBe(false)
      expect(layer.beaconMesh?.frustumCulled).toBe(false)
    }
    expect(far!.spireMesh).toBeNull()
    expect(far!.beaconMesh).toBeNull()
    expect(layerMeshes(near!)).toHaveLength(3)
    expect(layerMeshes(far!)).toHaveLength(1)
  })

  it('uses 60% counts and no spires on lowPower', () => {
    LAYERS.forEach((config, index) => {
      const layer = layerFor(index, true)
      expect(layer.buildings).toHaveLength(Math.round(config.count * 0.6))
      expect(layer.spireMesh).toBeNull()
      expect(layer.beaconMesh).toBeNull()
      expect(layer.buildings.some(b => b.archetype === 'spire')).toBe(false)
      expect((layer.boxMesh.material as THREE.Material).name).toBe('journey-facade-lite')
    })
  })

  it('makes the beacon material emissive above the bloom threshold', () => {
    const material = layerFor(0).beaconMesh!.material
    expect(0.2126 * material.color.r + 0.7152 * material.color.g + 0.0722 * material.color.b).toBeGreaterThanOrEqual(2)
  })
})

describe('applyBuildingState', () => {
  it('rewrites matrices once for an unchanged state', () => {
    const layer = layerFor(0)
    run(layer, { density: 0.5 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { density: 0.5 })
    run(layer, { density: 0.5 })
    expect(layer.boxMesh.instanceMatrix.version).toBe(version)
  })

  it('rewrites when activeCount crosses a rounding boundary by less than 1e-4 in density', () => {
    const layer = layerFor(0)
    const boundary = 12.5 / layer.buildings.length
    run(layer, { density: boundary - 1e-6 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { density: boundary + 1e-6 })
    expect(layer.boxMesh.instanceMatrix.version).toBeGreaterThan(version)
  })

  it('skips a height change under 1e-4 with the same count and rewrites at 1e-4 or more', () => {
    const layer = layerFor(0)
    run(layer, { height: 1 })
    const version = layer.boxMesh.instanceMatrix.version
    run(layer, { height: 1 + 5e-5 })
    expect(layer.boxMesh.instanceMatrix.version).toBe(version)
    run(layer, { height: 1 + 2e-4 })
    expect(layer.boxMesh.instanceMatrix.version).toBeGreaterThan(version)
  })

  it('clamps density outside [0, 1]', () => {
    const layer = layerFor(0)
    run(layer, { density: 1.5 })
    expect(layer.lastActiveCount).toBe(layer.buildings.length)
    run(layer, { density: -1 })
    expect(layer.lastActiveCount).toBe(0)
    for (let i = 0; i < layer.boxMesh.count; i++) expect(scaleAt(layer.boxMesh, i).length()).toBe(0)
  })

  it('writes finite zero-scale matrices at height 0', () => {
    const layer = layerFor(0)
    run(layer, { height: 0 })
    for (const mesh of layerMeshes(layer)) {
      expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true)
      for (let i = 0; i < mesh.count; i++) expect(scaleAt(mesh, i).length()).toBe(0)
    }
  })

  it('shows only active, placed buildings and hides the rest', () => {
    const layer = layerFor(0)
    const density = 0.5
    run(layer, { density })
    const active = Math.round(density * layer.buildings.length)
    layer.buildings.forEach((building, i) => {
      const { start, count } = layer.partRanges[i]!
      const shown = i < active && building.width > 0
      for (let p = 0; p < count; p++) {
        expect(scaleAt(layer.boxMesh, start + p).length() > 0).toBe(shown)
      }
    })
  })

  it('keeps rooftop equipment at constant size while height animates', () => {
    const layer = layerFor(0)
    const index = layer.buildings.findIndex(b => b.archetype === 'crowned' && b.width > 0)
    expect(index).toBeGreaterThanOrEqual(0)
    const blockIndex = layer.partRanges[index]!.start + 1
    run(layer, { height: 0.6 })
    const small = scaleAt(layer.boxMesh, blockIndex)
    run(layer, { height: 1.2 })
    const tall = scaleAt(layer.boxMesh, blockIndex)
    expect(tall.toArray()).toEqual(small.toArray())
  })

  describe('beacons', () => {
    const beaconScale = (layer: BuildingLayer, k: number) => scaleAt(layer.beaconMesh!, k).x

    it('is zero for an inactive building in both blink phases', () => {
      const layer = layerFor(0)
      const bi = layer.spireBuildingIndices[0]!
      const phase = layer.buildings[bi]!.blinkPhase
      const density = bi / layer.buildings.length
      for (const time of [timeAtCycle(phase, 0.05), timeAtCycle(phase, 0.5)]) {
        run(layer, { density, time })
        expect(beaconScale(layer, 0)).toBe(0)
      }
    })

    it('is BEACON_RADIUS or 0 by blink phase for an active building', () => {
      const layer = layerFor(0)
      const phase = layer.buildings[layer.spireBuildingIndices[0]!]!.blinkPhase
      run(layer, { time: timeAtCycle(phase, 0.05) })
      expect(beaconScale(layer, 0)).toBeCloseTo(BEACON_RADIUS, 6)
      run(layer, { time: timeAtCycle(phase, 0.5) })
      expect(beaconScale(layer, 0)).toBe(0)
    })

    it('follows the roof while height animates', () => {
      const layer = layerFor(0)
      run(layer, { height: 0.6, steady: true })
      layer.beaconMesh!.getMatrixAt(0, matrix)
      const low = new THREE.Vector3().setFromMatrixPosition(matrix).y
      run(layer, { height: 1.2, steady: true })
      layer.beaconMesh!.getMatrixAt(0, matrix)
      expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(low)
    })

    it('writes the beacon mesh only when the on/off state changes', () => {
      const layer = layerFor(0)
      const phase = layer.buildings[layer.spireBuildingIndices[0]!]!.blinkPhase
      run(layer, { time: timeAtCycle(phase, 0.05) })
      const version = layer.beaconMesh!.instanceMatrix.version
      run(layer, { time: timeAtCycle(phase, 0.06) })
      expect(layer.beaconMesh!.instanceMatrix.version).toBe(version)
    })

    it('ignores time when steady (reduced motion)', () => {
      const layer = layerFor(0)
      run(layer, { time: 0, steady: true })
      const versions = layerMeshes(layer).map(mesh => mesh.instanceMatrix.version)
      run(layer, { time: 0.9, steady: true })
      run(layer, { time: 33.3, steady: true })
      expect(layerMeshes(layer).map(mesh => mesh.instanceMatrix.version)).toEqual(versions)
      expect(beaconScale(layer, 0)).toBeCloseTo(BEACON_RADIUS, 6)
    })
  })
})
