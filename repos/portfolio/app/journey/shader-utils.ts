import type * as THREE from 'three'

export interface ShaderErrorRecorder {
  readonly error: Error | null
  assertClean(): void
  dispose(): void
}

const recorders = new WeakMap<THREE.WebGLRenderer, ShaderErrorRecorder>()

export function replaceOrThrow(source: string, marker: string, replacement: string): string {
  const index = source.indexOf(marker)
  if (index < 0) throw new Error(`Missing shader marker: ${marker}`)
  return source.slice(0, index) + replacement + source.slice(index + marker.length)
}

export function getShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder | undefined {
  return recorders.get(renderer)
}

export function createShaderErrorRecorder(renderer: THREE.WebGLRenderer): ShaderErrorRecorder {
  const previous = renderer.debug.onShaderError
  const checked = renderer.debug.checkShaderErrors
  let first: Error | null = null
  let disposed = false
  renderer.debug.checkShaderErrors = true
  const callback: NonNullable<THREE.WebGLRenderer['debug']['onShaderError']> = (gl, program, vertex, fragment) => {
    first ??= new Error([
      '[journey] Shader compile/link failed',
      gl.getProgramInfoLog(program) ?? '',
      gl.getShaderInfoLog(vertex) ?? '',
      gl.getShaderInfoLog(fragment) ?? '',
    ].join('\n'))
  }
  renderer.debug.onShaderError = callback
  const recorder: ShaderErrorRecorder = {
    get error() { return first },
    assertClean() { if (first) throw first },
    dispose() {
      if (disposed) return
      disposed = true
      if (renderer.debug.onShaderError === callback) renderer.debug.onShaderError = previous
      renderer.debug.checkShaderErrors = checked
      recorders.delete(renderer)
    },
  }
  recorders.set(renderer, recorder)
  return recorder
}
