import { expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { attenuateAdditiveFog, createShaderErrorRecorder, getShaderErrorRecorder, glslFloat, glslVec3, replaceOrThrow } from '../../app/journey/shader-utils'

it('replaces exactly the requested marker and reports a missing marker', () => {
  expect(replaceOrThrow('a MARK b', 'MARK', 'PATCH')).toBe('a PATCH b')
  expect(() => replaceOrThrow('a b', 'MARK', 'PATCH')).toThrow('Missing shader marker: MARK')
})

it('retains the first shader error and restores renderer debug settings on disposal', () => {
  const previous = vi.fn()
  const renderer = { debug: { checkShaderErrors: false, onShaderError: previous } } as unknown as THREE.WebGLRenderer
  const gl = {
    getProgramInfoLog: () => 'bad link',
    getShaderInfoLog: () => 'bad GLSL',
  } as unknown as WebGLRenderingContext
  const recorder = createShaderErrorRecorder(renderer)

  expect(renderer.debug.checkShaderErrors).toBe(true)
  expect(getShaderErrorRecorder(renderer)).toBe(recorder)
  renderer.debug.onShaderError!(gl, {} as WebGLProgram, {} as WebGLShader, {} as WebGLShader)
  const first = recorder.error
  renderer.debug.onShaderError!(gl, {} as WebGLProgram, {} as WebGLShader, {} as WebGLShader)
  expect(recorder.error).toBe(first)
  expect(() => recorder.assertClean()).toThrow('bad link')
  expect(first?.message).toContain('bad GLSL')

  recorder.dispose()
  recorder.dispose()
  expect(renderer.debug.onShaderError).toBe(previous)
  expect(renderer.debug.checkShaderErrors).toBe(false)
  expect(getShaderErrorRecorder(renderer)).toBeUndefined()
})

it('formats GLSL float and vec3 literals', () => {
  expect(glslFloat(1)).toBe('1.0')
  expect(glslFloat(-1)).toBe('-1.0')
  expect(glslFloat(0.92)).toBe('0.920000000000')
  expect(glslVec3([1, .5, 0])).toBe('vec3(1.0, 0.500000000000, 0.0)')
})

function fakeShader(vertexShader: string, fragmentShader: string): THREE.WebGLProgramParametersWithUniforms {
  return { vertexShader, fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms
}

it('replaces the fog mix with an attenuation toward black', () => {
  const material = new THREE.MeshBasicMaterial()
  material.customProgramCacheKey = () => 'test-light'
  attenuateAdditiveFog(material)
  const shader = fakeShader('', 'before\n#include <fog_fragment>\nafter')
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  expect(shader.fragmentShader).not.toContain('#include <fog_fragment>')
  expect(shader.fragmentShader).not.toContain('mix(')
  expect(shader.fragmentShader).toContain('gl_FragColor.rgb *= 1.0 - fogFactor;')
  expect(shader.fragmentShader).toContain('FOG_EXP2')
  expect(shader.fragmentShader.startsWith('before')).toBe(true)
  expect(shader.fragmentShader.endsWith('after')).toBe(true)
})

it('runs the earlier onBeforeCompile first and appends additive-fog to the cache key', () => {
  const material = new THREE.MeshBasicMaterial()
  const earlier = vi.fn((shader: THREE.WebGLProgramParametersWithUniforms) => { shader.vertexShader += '/* earlier */' })
  material.onBeforeCompile = earlier
  material.customProgramCacheKey = () => 'street-halo'
  attenuateAdditiveFog(material)
  const shader = fakeShader('v', '#include <fog_fragment>')
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
  expect(earlier).toHaveBeenCalledTimes(1)
  expect(shader.vertexShader).toBe('v/* earlier */')
  expect(material.customProgramCacheKey()).toBe('street-halo|additive-fog')
})

it('throws when the fog marker is missing', () => {
  const material = new THREE.MeshBasicMaterial()
  material.customProgramCacheKey = () => 'test-light'
  attenuateAdditiveFog(material)
  expect(() => material.onBeforeCompile(fakeShader('', 'void main() {}'), {} as THREE.WebGLRenderer))
    .toThrow('Missing shader marker: #include <fog_fragment>')
})
