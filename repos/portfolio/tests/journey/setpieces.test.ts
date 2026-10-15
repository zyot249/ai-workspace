// tests/journey/setpieces.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { HOUSE_WINDOW_SLOTS, SCENERY_GROUP_NAME, SET_PIECE_ROLES, SET_PIECE_SPECS } from '../../app/journey/building-specs'
import type { BuildingModels } from '../../app/journey/building-models'
import { createSetPieces, placeOnPath } from '../../app/journey/setpieces'
import { HOUSE_FRONT_Z, setPieceLayout } from '../../app/journey/setpiece-layout'

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
      expect(meshes).toHaveLength(2)
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
