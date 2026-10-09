import * as THREE from 'three'
import { createShaderErrorRecorder, getShaderErrorRecorder, type ShaderErrorRecorder } from '../../app/journey/shader-utils'

export interface GpuDiagnostics {
  shaderError: string | null
  glError: number
  calls: number
  width: number
  height: number
  geometries: number
  textures: number
}

export function diagnostics(renderer: THREE.WebGLRenderer): GpuDiagnostics {
  const gl = renderer.getContext()
  return {
    shaderError: getShaderErrorRecorder(renderer)?.error?.message ?? null,
    glError: gl.getError(), calls: renderer.info.render.calls,
    width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
    geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
  }
}

export function readPixel(renderer: THREE.WebGLRenderer, x: number, y: number): number[] {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(4)
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}

export function readFrame(renderer: THREE.WebGLRenderer): number[] {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}

export function createTestRenderer(options: { width?: number; height?: number } = {}): {
  renderer: THREE.WebGLRenderer; recorder: ShaderErrorRecorder
  canvas: HTMLCanvasElement; dispose(): void
} {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(1)
  renderer.setSize(options.width ?? 512, options.height ?? 512, false)
  const recorder = createShaderErrorRecorder(renderer)
  let disposed = false
  return { renderer, recorder, canvas, dispose() {
    if (disposed) return
    disposed = true
    recorder.dispose()
    renderer.dispose()
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
    canvas.remove()
  } }
}
