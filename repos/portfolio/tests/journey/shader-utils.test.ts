import { expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import { createShaderErrorRecorder, getShaderErrorRecorder, glslFloat, glslVec3, replaceOrThrow } from '../../app/journey/shader-utils'

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
