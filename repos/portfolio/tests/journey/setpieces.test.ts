// tests/journey/setpieces.test.ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { GATE_WHITE_UV, HOUSE_WINDOW_SLOTS, SCENERY_GROUP_NAME, SET_PIECE_ROLES, SET_PIECE_SPECS } from '../../app/journey/building-specs'
import type { BuildingModels } from '../../app/journey/building-models'
import { createSetPieces, placeOnPath } from '../../app/journey/setpieces'
import { parabolicArchGeometry } from '../../app/journey/arch-geometry'
import { GATE_FOOTPRINT_HALF_X, gateLayout, HOUSE_FRONT_Z, setPieceLayout } from '../../app/journey/setpiece-layout'

function fakeModels(materialNames: readonly string[] = ['palette']): BuildingModels {
  const materials = materialNames.map(name => new THREE.MeshStandardMaterial({ name }))
  const setPieces = Object.fromEntries(SET_PIECE_ROLES.map(role => {
    const size = SET_PIECE_SPECS[role].size
    const parts = materials.map(material => {
      const geometry = new THREE.BoxGeometry(size[0], size[1], size[2])
      geometry.translate(0, size[1] / 2, 0)
      return { geometry, material }
    })
    return [role, { parts, size }]
  })) as unknown as BuildingModels['setPieces']
  return { setPieces, near: [] }
}

function fallbacks() {
  return {
    gate: new THREE.Group(), hall: new THREE.Group(), market: new THREE.Group(), house: new THREE.Group(),
    houseWindows: [new THREE.Mesh(), new THREE.Mesh()],
  }
}

describe('placeOnPath', () => {
  it('moves the group to the point and rotates it to the heading', () => {
    const group = placeOnPath(new THREE.Group(), { x: 3, z: -4 }, 0, -1)
    expect(group.position.x).toBe(3)
    expect(group.position.z).toBe(-4)
    expect(group.rotation.y).toBeCloseTo(0, 5)
  })
})

describe('createSetPieces', () => {
  it('builds nothing visible before models arrive', () => {
    const setPieces = createSetPieces(fallbacks())
    expect(setPieces.group.name).toBe(SCENERY_GROUP_NAME + '-set-pieces')
    expect(setPieces.group.children).toHaveLength(0)
  })

  it('stages four hidden groups with one mesh per material, then shows them and hides the fallbacks', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels(['wall', 'roof']))
    expect(setPieces.group.children).toHaveLength(4)
    expect(setPieces.group.visible).toBe(false)
    for (const child of setPieces.group.children) {
      const meshes = child.children.filter(object => (object as THREE.Mesh).isMesh)
      // The gate is white concrete in the beam's one material. The other groups keep every material.
      expect(meshes).toHaveLength(child.name.endsWith('gate') ? 1 : 2)
    }
    expect(fb.gate.visible).toBe(true)
    setPieces.show()
    expect(setPieces.group.visible).toBe(true)
    expect([fb.gate, fb.hall, fb.market, fb.house].map(object => object.visible)).toEqual([false, false, false, false])
  })

  it('bakes each placement into the merged geometry', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    const layout = setPieceLayout()
    const marketGroup = setPieces.group.children.find(child => child.name.endsWith('market'))!
    const mesh = marketGroup.children.find(object => (object as THREE.Mesh).isMesh) as THREE.Mesh
    // One box (24 vertices) per stall.
    expect(mesh.geometry.getAttribute('position').count).toBe(layout.market.length * 24)
  })

  it('merges the arch, piers, and canopies into one gate mesh, rising from the ground', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    const gateGroup = setPieces.group.children.find(child => child.name.endsWith('gate'))!
    const meshes = gateGroup.children.filter(object => (object as THREE.Mesh).isMesh) as THREE.Mesh[]
    expect(meshes).toHaveLength(1)
    const { arch: { baseY, ...spec }, boxes } = gateLayout()
    const archVertices = parabolicArchGeometry({ ...spec, uv: GATE_WHITE_UV }).getAttribute('position').count
    // One box (24 vertices) per pier and canopy.
    expect(meshes[0]!.geometry.getAttribute('position').count).toBe(boxes.length * 24 + archVertices)
    const box = new THREE.Box3().setFromObject(gateGroup)
    expect(box.max.y).toBeCloseTo(baseY + spec.rise + spec.thickness, 4)
    expect(box.min.y).toBeCloseTo(baseY, 4)
    // The canopies reach the footprint edge on both sides.
    expect(box.max.x - box.min.x).toBeCloseTo(GATE_FOOTPRINT_HALF_X * 2, 4)
  })

  it('colors the whole gate one white palette tile', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    const gateGroup = setPieces.group.children.find(child => child.name.endsWith('gate'))!
    const meshes = gateGroup.children.filter(object => (object as THREE.Mesh).isMesh) as THREE.Mesh[]
    for (const mesh of meshes) {
      const uv = mesh.geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeCloseTo(GATE_WHITE_UV[0], 6)
        expect(uv.getY(i)).toBeCloseTo(GATE_WHITE_UV[1], 6)
      }
    }
    // Other groups keep the model's own uv.
    const market = setPieces.group.children.find(child => child.name.endsWith('market'))!
    const marketUv = (market.children.find(object => (object as THREE.Mesh).isMesh) as THREE.Mesh).geometry.getAttribute('uv')
    expect(Array.from(marketUv.array).some(value => Math.abs(value - GATE_WHITE_UV[0]) > 1e-3 && Math.abs(value - GATE_WHITE_UV[1]) > 1e-3)).toBe(true)
  })

  it('fails the stage and shows nothing when the beam model has no part to take the arch material from', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    const models = fakeModels()
    ;(models.setPieces.beam as { parts: unknown[] }).parts = []
    expect(() => setPieces.stage(models)).toThrow('beam')
    expect(setPieces.group.children).toHaveLength(0)
    expect(fb.gate.visible).toBe(true)
  })

  it('moves the courtyard windows onto the house front', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels())
    setPieces.show()
    HOUSE_WINDOW_SLOTS.forEach((slot, i) => {
      const win = fb.houseWindows[i]!
      expect(win.position.x).toBeCloseTo(slot.x, 5)
      expect(win.position.y).toBeCloseTo(-1 + slot.y, 5)
      expect(win.position.z).toBeGreaterThan(HOUSE_FRONT_Z)
    })
  })

  it('release removes the groups, disposes their geometry, and leaves the fallbacks visible', () => {
    const fb = fallbacks()
    const setPieces = createSetPieces(fb)
    setPieces.stage(fakeModels())
    const geometries: THREE.BufferGeometry[] = []
    setPieces.group.traverse(object => { if ((object as THREE.Mesh).isMesh) geometries.push((object as THREE.Mesh).geometry) })
    const disposed = geometries.map(geometry => { let called = false; geometry.addEventListener('dispose', () => { called = true }); return () => called })
    setPieces.release()
    expect(setPieces.group.children).toHaveLength(0)
    expect(disposed.every(check => check())).toBe(true)
    expect(fb.gate.visible).toBe(true)
    setPieces.release()
  })

  it('ignores a second stage', () => {
    const setPieces = createSetPieces(fallbacks())
    setPieces.stage(fakeModels())
    setPieces.stage(fakeModels())
    expect(setPieces.group.children).toHaveLength(4)
  })
})

it('restores primitives and window positions when a shown swap is discarded', () => {
  const fb = fallbacks()
  fb.houseWindows[0]!.position.set(0.9, 0, 2)
  const pieces = createSetPieces(fb)
  pieces.stage(fakeModels())
  pieces.show()
  pieces.release()
  expect([fb.gate, fb.hall, fb.market, fb.house].every(object => object.visible)).toBe(true)
  expect(fb.houseWindows[0]!.position.toArray()).toEqual([0.9, 0, 2])
})

it('releases all temporary and merged geometry when one material group fails', () => {
  const models = fakeModels(['good', 'bad'])
  models.setPieces.beam.parts[1]!.geometry.deleteAttribute('normal')
  const clone = vi.spyOn(THREE.BufferGeometry.prototype, 'clone')
  const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
  try {
    const pieces = createSetPieces(fallbacks())
    expect(() => pieces.stage(models)).toThrow('incompatible attributes')
    expect(pieces.group.children).toHaveLength(0)
    // Every placement clone was disposed.
    const disposed = new Set(dispose.mock.contexts)
    for (const result of clone.mock.results) expect(disposed.has(result.value)).toBe(true)
    // The gate succeeds and the hall fails, because the hall mixes the broken beam with the columns. The gate builds
    // no clones: its four boxes and its arch are temporaries, and its one merged mesh is released with the failed
    // stage. The hall's first successful material merge is the last disposal.
    const gateTemporaries = 5
    const gateMergedMeshes = 1
    const hallFirstMerge = 1
    expect(dispose.mock.calls.length).toBe(clone.mock.calls.length + gateTemporaries + gateMergedMeshes + hallFirstMerge)
  } finally { clone.mockRestore(); dispose.mockRestore() }
})
