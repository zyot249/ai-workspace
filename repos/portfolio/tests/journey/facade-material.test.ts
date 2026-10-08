import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createFacadeMaterial } from '../../app/journey/facade-material'

it.each(['full', 'lite'] as const)('patches pinned standard shader: %s', variant => {
  const uniforms = { uLit: { value: 0.9 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) } }
  const material = createFacadeMaterial({ color: 0x1f2438, uniforms, variant })
  const shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  expect(shader.uniforms).toMatchObject(uniforms)
  expect((shader.uniforms as typeof uniforms).uLit).toBe(uniforms.uLit)
  expect(material.customProgramCacheKey()).toBe(`facade-${variant}`)
  expect(shader.vertexShader).toContain('(position + vec3(0.0, 0.5, 0.0)) * facadeScale')
  expect(shader.vertexShader.indexOf('vFacadeDepth = -mvPosition.z')).toBeGreaterThan(shader.vertexShader.indexOf('#include <project_vertex>'))
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance += facadeWindowEmission')
  expect(shader.fragmentShader.includes('fwidth(')).toBe(variant === 'full')
  expect(shader.fragmentShader).toContain('#include <color_fragment>')
  expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>')
})

it('separates program cache variants', () => {
  const uniforms = { uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() } }
  const full = createFacadeMaterial({ color: 0, uniforms, variant: 'full' })
  const lite = createFacadeMaterial({ color: 0, uniforms, variant: 'lite' })
  expect(full.customProgramCacheKey()).not.toBe(lite.customProgramCacheKey())
})
