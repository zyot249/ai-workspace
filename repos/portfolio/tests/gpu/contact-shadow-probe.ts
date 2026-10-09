import * as THREE from 'three'
import { createContactShadowField, SHADOW_NAME } from '../../app/journey/contact-shadows'
import { createTestRenderer, diagnostics } from './gpu-utils'

const WIDTH = 480
const HEIGHT = 240
const HALF_WIDTH = 6
const HALF_DEPTH = 3
const GROUND_Y = -1.01
const BUILDING = { width: 1.2, depth: 1.2 }
const ACTIVE_X = -3
const INACTIVE_X = 3
const BUILDING_HEIGHT = 1.5
// 0.2 units outside the building edge.
const OFFSET = BUILDING.width / 2 + 0.2

// Top-down render of white ground with one active and one inactive building shadow, into an 8-bit linear target.
export function probeContactShadow() {
  const gpu = createTestRenderer({ width: WIDTH, height: HEIGHT })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true, stencilBuffer: false })
  const field = createContactShadowField(2)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  const scene = new THREE.Scene()
  scene.add(ground, field.mesh)
  field.write(0, { x: ACTIVE_X, z: 0, ...BUILDING }, BUILDING_HEIGHT, true)
  field.write(1, { x: INACTIVE_X, z: 0, ...BUILDING }, BUILDING_HEIGHT, false)
  field.commit()
  const camera = new THREE.OrthographicCamera(-HALF_WIDTH, HALF_WIDTH, HALF_DEPTH, -HALF_DEPTH, 0.1, 50)
  camera.position.set(0, 10, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    recorder.assertClean()
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
    const sample = (x: number) => {
      const column = Math.round(((x + HALF_WIDTH) / (2 * HALF_WIDTH)) * WIDTH)
      return pixels[4 * (Math.floor(HEIGHT / 2) * WIDTH + column)]! / 255
    }
    return {
      nearActive: sample(ACTIVE_X - OFFSET),
      nearInactive: sample(INACTIVE_X + OFFSET),
      far: sample(0),
      shaderError: recorder.error?.message ?? null,
      glError: renderer.getContext().getError(),
    }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    ground.geometry.dispose()
    ;(ground.material as THREE.Material).dispose()
    field.dispose()
    gpu.dispose()
  }
}

// Like buildingDrawCalls: hide everything except the shadow mesh and count the direct-path draw calls.
export function contactShadowDrawCalls() {
  const { scene, camera, renderer } = window.cityGpu.getJourneyContext()
  const mesh = scene.getObjectByName(SHADOW_NAME) as THREE.InstancedMesh
  const hidden: THREE.Object3D[] = []
  for (const child of scene.children) {
    if (child === mesh || !child.visible) continue
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
      calls: renderer.info.render.calls, count: mesh.count, frustumCulled: mesh.frustumCulled,
      renderOrder: mesh.renderOrder, shaderError: base.shaderError, glError: base.glError,
    }
  } finally {
    renderer.info.autoReset = autoReset
    for (const object of hidden) object.visible = true
  }
}

// Largest per-channel byte difference between a frame with and without the shadow mesh, for each chapter.
export function contactShadowFrameDelta(chapters: number[]): number[] {
  return chapters.map(chapter => {
    const mesh = window.cityGpu.getJourneyContext().scene.getObjectByName(SHADOW_NAME) as THREE.InstancedMesh
    mesh.visible = true
    // `reduced` applies the target state directly (no damping), so two frames reach the final state.
    window.cityGpu.renderJourney({ chapter, frames: 2 })
    const withShadows = window.cityGpu.readFrame()
    mesh.visible = false
    window.cityGpu.renderJourney({ chapter, frames: 2 })
    const without = window.cityGpu.readFrame()
    mesh.visible = true
    return withShadows.reduce((max, byte, index) => Math.max(max, Math.abs(byte - without[index]!)), 0)
  })
}
