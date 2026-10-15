// app/journey/setpieces.ts
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BuildingModels } from './building-models'
import type { SceneryPart } from './building-scenery'
import { HOUSE_WINDOW_SLOTS, SCENERY_GROUP_NAME } from './building-specs'
import { headingFor, pathSegmentAt, PLACES } from './path'
import { HOUSE_FRONT_Z, type PiecePlacement, type SetPieceGroupName, setPieceLayout } from './setpiece-layout'

// Where each set-piece group stands. The groups are authored facing world -Z, as the primitives are.
const GROUP_PLACES = {
  gate: { place: PLACES.entrance, segment: 0 },
  hall: { place: PLACES.hall, segment: 0 },
  market: { place: PLACES.market, segment: 1 },
  house: { place: PLACES.courtyard, segment: 2 },
} as const satisfies Record<SetPieceGroupName, { place: { x: number; z: number }; segment: number }>

const GROUP_ORDER: readonly SetPieceGroupName[] = ['gate', 'hall', 'market', 'house']
// The window planes sit just in front of the house wall so they do not z-fight with it.
const WINDOW_OFFSET_Z = 0.01
const GROUND_Y = -1

// Places a set-piece group, authored facing world -Z, at `point` and rotates it to face `dirX, dirZ`
// (the heading of the segment it belongs to).
export function placeOnPath(group: THREE.Group, point: { x: number; z: number }, dirX: number, dirZ: number): THREE.Group {
  group.position.set(point.x, 0, point.z)
  group.rotation.y = headingFor(dirX, dirZ)
  return group
}

export interface SetPieceFallbacks {
  // The primitive stand-ins that hide once the models show.
  gate: THREE.Object3D
  hall: THREE.Object3D
  market: THREE.Object3D
  house: THREE.Object3D
  // The always-lit window planes. They stay visible and move onto the model's front face.
  houseWindows: readonly THREE.Object3D[]
}

export interface SetPieces extends SceneryPart {
  readonly group: THREE.Group
}

const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const scale = new THREE.Vector3()
const rotation = new THREE.Quaternion()
const axisY = new THREE.Vector3(0, 1, 0)

// Bakes every placement of one group into one geometry per material, so a group costs one draw call per material.
function bakeGroup(name: SetPieceGroupName, placements: readonly PiecePlacement[], models: BuildingModels): THREE.Group {
  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
  for (const placement of placements) {
    matrix.compose(position.set(placement.x, placement.y, placement.z), rotation.setFromAxisAngle(axisY, placement.rotY),
      scale.set(placement.sx, placement.sy, placement.sz))
    for (const part of models.setPieces[placement.role].parts) {
      const list = byMaterial.get(part.material) ?? []
      list.push(part.geometry.clone().applyMatrix4(matrix))
      byMaterial.set(part.material, list)
    }
  }
  const group = new THREE.Group()
  group.name = `${SCENERY_GROUP_NAME}-${name}`
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false)
    for (const geometry of geometries) geometry.dispose()
    if (!merged) throw new Error(`The ${name} set-piece parts have incompatible attributes`)
    const mesh = new THREE.Mesh(merged, material)
    mesh.name = `${SCENERY_GROUP_NAME}-${name}-mesh`
    group.add(mesh)
  }
  const { place, segment } = GROUP_PLACES[name]
  const direction = pathSegmentAt(segment)
  return placeOnPath(group, place, direction.dirX, direction.dirZ)
}

export function createSetPieces(fallbacks: SetPieceFallbacks): SetPieces {
  const group = new THREE.Group()
  group.name = `${SCENERY_GROUP_NAME}-set-pieces`
  let staged = false
  const primitiveObjects = [fallbacks.gate, fallbacks.hall, fallbacks.market, fallbacks.house]
  const primitiveVisibility = primitiveObjects.map(object => object.visible)
  const windowState = fallbacks.houseWindows.map(window => ({ position: window.position.clone(), visible: window.visible }))

  function release(): void {
    for (const child of [...group.children]) {
      child.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.dispose() })
      group.remove(child)
    }
    primitiveObjects.forEach((object, i) => { object.visible = primitiveVisibility[i] ?? true })
    fallbacks.houseWindows.forEach((window, i) => {
      const state = windowState[i]
      if (state) { window.position.copy(state.position); window.visible = state.visible }
    })
    staged = false
  }

  return {
    group,
    stage(models) {
      if (staged) return
      staged = true
      const layout = setPieceLayout()
      try {
        for (const name of GROUP_ORDER) group.add(bakeGroup(name, layout[name], models))
      } catch (error) {
        release()
        throw error
      }
      group.visible = false
    },
    show() {
      if (!staged) return
      group.visible = true
      for (const fallback of [fallbacks.gate, fallbacks.hall, fallbacks.market, fallbacks.house]) fallback.visible = false
      fallbacks.houseWindows.forEach((window, i) => {
        const slot = HOUSE_WINDOW_SLOTS[i]
        if (!slot) { window.visible = false; return }
        window.position.set(slot.x, GROUND_Y + slot.y, HOUSE_FRONT_Z + WINDOW_OFFSET_Z)
      })
    },
    release,
  }
}
