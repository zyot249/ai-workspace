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

// GLSL float literal: integers keep a ".0", others use 12 significant digits.
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : n.toPrecision(12)
}

export function glslVec3(rgb: readonly number[]): string {
  return `vec3(${rgb.map(glslFloat).join(', ')})`
}

const FOG_FRAGMENT_MARKER = '#include <fog_fragment>'

// r186 fog_fragment mixes the output toward the fog colour. That is right for alpha-blended
// objects, but an additive object that outputs black would then add the fog colour to the frame.
// This version scales the output toward black instead, so a switched-off light adds exactly zero.
export const ADDITIVE_FOG_GLSL = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb *= 1.0 - fogFactor;
#endif
`

// Set `customProgramCacheKey` on the material BEFORE calling this: the default key is the text
// of `onBeforeCompile`, which this function replaces.
export function attenuateAdditiveFog(material: THREE.Material): void {
  const earlierCompile = material.onBeforeCompile
  const earlierKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    earlierCompile.call(material, shader, renderer)
    shader.fragmentShader = replaceOrThrow(shader.fragmentShader, FOG_FRAGMENT_MARKER, ADDITIVE_FOG_GLSL)
  }
  material.customProgramCacheKey = () => `${earlierKey.call(material)}|additive-fog`
}
