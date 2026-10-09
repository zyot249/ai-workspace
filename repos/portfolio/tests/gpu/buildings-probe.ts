import type * as THREE from 'three'
import { diagnostics } from './gpu-utils'

const BUILDING_PREFIX = 'journey-building-'

// With a composer, renderer.info resets on every pass, so a count taken after
// composer.render() can reflect only the output pass. Measure on the direct
// path instead: hide everything except the building meshes, render once with
// autoReset off, and read the call count.
export function buildingDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child.name.startsWith(BUILDING_PREFIX) || !child.visible) continue
    child.visible = false
    hidden.push(child)
  }
  const autoReset = renderer.info.autoReset
  try {
    renderer.setRenderTarget(null)
    renderer.info.autoReset = false
    renderer.info.reset()
    renderer.render(scene, camera)
    const base = diagnostics(renderer)
    return {
      calls: renderer.info.render.calls,
      shaderError: base.shaderError,
      glError: base.glError,
      meshNames: scene.children.filter(child => child.name.startsWith(BUILDING_PREFIX)).map(child => child.name),
    }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}
