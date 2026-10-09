import * as THREE from 'three'
import { createFacadeMaterial, type FacadeVariant } from '../../app/journey/facade-material'
import { createTestRenderer, diagnostics, readFrame } from './gpu-utils'

export function probeFacade(options: {
  variant: FacadeVariant; height: number
  face: 'front' | 'back' | 'left' | 'right' | 'top'; lit: number; depth?: number; span?: number
}) {
  const gpu = createTestRenderer({ width: 512, height: 512 })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.375]), 1))
  const material = createFacadeMaterial({ color: 0x505050, variant: options.variant,
    uniforms: { uLit: { value: options.lit }, uSkyTint: { value: new THREE.Color(0x6688aa) } } })
  try {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0)
    const mesh = new THREE.InstancedMesh(geometry, material, 1)
    mesh.frustumCulled = false
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, options.height / 2 - 1, 0),
      new THREE.Quaternion(), new THREE.Vector3(1.6, options.height, 1.6)))
    mesh.instanceMatrix.needsUpdate = true
    scene.add(mesh)
    scene.add(new THREE.AmbientLight(0xffffff, 1))
    const halfSpan = (options.span ?? 1.6) / 2
    const camera = new THREE.OrthographicCamera(-halfSpan, halfSpan, halfSpan, -halfSpan, 0.01, 50)
    const center = new THREE.Vector3(0, -0.2, 0)
    const distance = options.depth ?? 3
    const directions = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0] } as const
    const direction = directions[options.face]
    if (options.face === 'top') { center.y = options.height - 1; camera.up.set(0, 0, -1) }
    camera.position.copy(center).add(new THREE.Vector3(...direction).multiplyScalar(distance))
    camera.lookAt(center)
    gpu.renderer.render(scene, camera)
    gpu.recorder.assertClean()
    const pixels = readFrame(gpu.renderer)
    return { diagnostics: diagnostics(gpu.renderer), pixels, calls: gpu.renderer.info.render.calls }
  } finally {
    geometry.dispose()
    material.dispose()
    gpu.dispose()
  }
}
