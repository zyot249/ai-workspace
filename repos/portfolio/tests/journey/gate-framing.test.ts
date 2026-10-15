// tests/journey/gate-framing.test.ts
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { fovForAspect } from '../../app/journey/camera'
import { headingFor, pathPointAt, pathSegmentAt, PLACES } from '../../app/journey/path'
import { gateLayout } from '../../app/journey/setpiece-layout'
import { PATH_STOPS } from '../../app/journey/stops'

// How much of the frame, as a fraction of its half size, the gate may fill. Leaves a margin for the mouse tilt.
const FRAME_FILL = 0.97
const ASPECTS = [
  ['a 16:9 desktop', 16 / 9],
  ['a 4:3 tablet', 4 / 3],
  ['a portrait phone', 390 / 844],
] as const

// The camera at the start of the journey, built the way the scene builds it.
function openingCamera(aspect: number): THREE.PerspectiveCamera {
  const stop = PATH_STOPS.intro
  const from = pathPointAt(stop.cameraDistance)
  const to = pathPointAt(stop.cameraDistance + stop.lookAheadDistance)
  const camera = new THREE.PerspectiveCamera(fovForAspect(aspect), aspect, 0.1, 200)
  camera.position.set(from.x, stop.cameraHeight, from.z)
  camera.lookAt(to.x, stop.lookHeight, to.z)
  camera.updateMatrixWorld()
  return camera
}

// Outline points of the arch and the piers in world space.
function gatePoints(): THREE.Vector3[] {
  const { arch, boxes } = gateLayout()
  const innerHalf = arch.span / 2
  const outerHalf = innerHalf + arch.footWidth
  const height = arch.rise + arch.thickness
  const local: THREE.Vector3[] = []
  for (let i = 0; i <= 32; i++) {
    const x = -outerHalf + (2 * outerHalf * i) / 32
    for (const z of [-arch.depth / 2, arch.depth / 2]) local.push(new THREE.Vector3(x, arch.baseY + height * (1 - (x / outerHalf) ** 2), z))
  }
  // Piers: the bottom and top corners on the road side, which are the corners nearest the middle of the frame.
  for (const box of boxes.filter(b => b.height > 1)) {
    for (const x of [box.x - box.width / 2, box.x + box.width / 2]) {
      for (const y of [box.y, box.y + box.height]) for (const z of [-box.depth / 2, box.depth / 2]) local.push(new THREE.Vector3(x, y, z))
    }
  }
  const segment = pathSegmentAt(0)
  const group = new THREE.Group()
  group.position.set(PLACES.entrance.x, 0, PLACES.entrance.z)
  group.rotation.y = headingFor(segment.dirX, segment.dirZ)
  group.updateMatrixWorld()
  return local.map(point => point.applyMatrix4(group.matrixWorld))
}

describe('the gate in the opening frame', () => {
  it.each(ASPECTS)('fits whole, arch and piers, on %s', (_name, aspect) => {
    const camera = openingCamera(aspect)
    const points = gatePoints()
    for (const point of points) {
      const ndc = point.clone().project(camera)
      expect(Math.abs(ndc.x), `x of ${point.toArray()}`).toBeLessThanOrEqual(FRAME_FILL)
      expect(ndc.y, `y of ${point.toArray()}`).toBeLessThanOrEqual(FRAME_FILL)
    }
  })

  it('sits ahead of the camera, not beside or behind it', () => {
    const camera = openingCamera(16 / 9)
    for (const point of gatePoints()) expect(point.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeLessThan(0)
  })
})
