import * as THREE from 'three'
import { GRADIENT_GROUND_Y } from '../../app/journey/facade-gradient'
import { createFacadeMaterial, createFacadeUniforms, type FacadeVariant } from '../../app/journey/facade-material'
import { createTestRenderer } from './gpu-utils'

export interface GradientProbeInput {
  variant: FacadeVariant
  buildingHeight: number
  face: 'front' | 'back' | 'left' | 'right'
  // 'ao' writes the AO multiplier, 'emission' writes the rim plus bounce emission (FACADE_DEBUG_AO 1 or 2).
  output: 'ao' | 'emission'
  // Heights above the ground. The result reports the pixel-center heights actually sampled.
  sampleHeights: readonly number[]
  aoStrength?: number
  rimStrength?: number
  bounce?: number
  sunDir?: readonly [number, number, number]
  sunColor?: readonly [number, number, number] // linear
}

export interface GradientProbeResult {
  samples: number[][]
  heights: number[]
  shaderError: string | null
  glError: number
}

const ROWS = 600
const COLUMNS = 8
const BOX = 1.6
const CAMERA_DISTANCE = 5
const FACE_DIRECTIONS = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] } as const

export function probeGradient(input: GradientProbeInput): GradientProbeResult {
  const gpu = createTestRenderer({ width: COLUMNS, height: ROWS })
  const { renderer, recorder } = gpu
  const target = new THREE.WebGLRenderTarget(COLUMNS, ROWS, {
    type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false,
  })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array([0.5]), 1))
  // Unwindowed: the wall color is untouched except by the gradient.
  geometry.setAttribute('aWindowed', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1))
  const uniforms = createFacadeUniforms(0)
  uniforms.uAoStrength.value = input.aoStrength ?? 1
  uniforms.uRimStrength.value = input.rimStrength ?? 0
  uniforms.uBounce.value = input.bounce ?? 0
  if (input.sunDir) uniforms.uSunDir.value.set(...input.sunDir).normalize()
  if (input.sunColor) uniforms.uSunColor.value.setRGB(...input.sunColor)
  const material = createFacadeMaterial({ color: 0x505050, uniforms, variant: input.variant })
  material.defines = { ...material.defines, FACADE_DEBUG_AO: input.output === 'ao' ? 1 : 2 }
  const mesh = new THREE.InstancedMesh(geometry, material, 1)
  mesh.frustumCulled = false
  const bottom = GRADIENT_GROUND_Y
  const top = GRADIENT_GROUND_Y + input.buildingHeight
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(
    new THREE.Vector3(0, (top + bottom) / 2, 0), new THREE.Quaternion(), new THREE.Vector3(BOX, input.buildingHeight, BOX)))
  mesh.instanceMatrix.needsUpdate = true
  const scene = new THREE.Scene()
  scene.add(mesh)
  // Ortho bounds are view-space (relative to the camera), so center them on the camera at mid-height.
  const camera = new THREE.OrthographicCamera(-BOX / 2, BOX / 2, input.buildingHeight / 2, -input.buildingHeight / 2, 0.1, 50)
  const direction = new THREE.Vector3(...FACE_DIRECTIONS[input.face])
  camera.position.copy(direction).multiplyScalar(CAMERA_DISTANCE)
  camera.position.y = (top + bottom) / 2
  camera.lookAt(0, (top + bottom) / 2, 0)
  renderer.setPixelRatio(1)
  renderer.setSize(COLUMNS, ROWS, false)
  renderer.toneMapping = THREE.NoToneMapping
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  target.texture.colorSpace = THREE.LinearSRGBColorSpace
  try {
    if (!renderer.getContext().getExtension('EXT_color_buffer_float')) {
      throw new Error('Gradient GPU tests require readable float color targets')
    }
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    recorder.assertClean()
    const pixels = new Float32Array(COLUMNS * ROWS * 4)
    renderer.readRenderTargetPixels(target, 0, 0, COLUMNS, ROWS, pixels)
    const column = COLUMNS / 2
    const samples: number[][] = []
    const heights: number[] = []
    for (const height of input.sampleHeights) {
      const row = Math.min(ROWS - 1, Math.max(0, Math.floor((height / input.buildingHeight) * ROWS)))
      const offset = 4 * (row * COLUMNS + column)
      samples.push(Array.from(pixels.subarray(offset, offset + 3)))
      heights.push(((row + 0.5) / ROWS) * input.buildingHeight)
    }
    return { samples, heights, shaderError: recorder.error?.message ?? null, glError: renderer.getContext().getError() }
  } finally {
    renderer.setRenderTarget(null)
    target.dispose()
    geometry.dispose()
    material.dispose()
    gpu.dispose()
  }
}
