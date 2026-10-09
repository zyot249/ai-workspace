import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createFacadeMaterial } from '../../app/journey/facade-material'

it.each(['full', 'lite'] as const)('patches pinned standard shader: %s', variant => {
  const uniforms = { uLit: { value: 0.9 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) },
    uTime: { value: 0 }, uFlicker: { value: 0 }, uEmissiveScale: { value: 1 } }
  const material = createFacadeMaterial({ color: 0x1f2438, uniforms, variant })
  const shader = {
    uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  expect(shader.uniforms).toMatchObject(uniforms)
  expect((shader.uniforms as typeof uniforms).uLit).toBe(uniforms.uLit)
  expect(material.customProgramCacheKey()).toBe(`facade-${variant}-windows-ab-0`)
  expect(shader.vertexShader).toContain('(position + vec3(0.0, 0.5, 0.0)) * facadeScale')
  expect(shader.vertexShader.indexOf('vFacadeDepth = -mvPosition.z')).toBeGreaterThan(shader.vertexShader.indexOf('#include <project_vertex>'))
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance += facadeWindowEmission')
  expect(shader.fragmentShader.includes('fwidth(')).toBe(variant === 'full')
  expect(shader.fragmentShader).toContain('#include <color_fragment>')
  expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>')
})

it('separates program cache variants', () => {
  const uniforms = { uLit: { value: 0 }, uSkyTint: { value: new THREE.Color() },
    uTime: { value: 0 }, uFlicker: { value: 0 }, uEmissiveScale: { value: 1 } }
  const full = createFacadeMaterial({ color: 0, uniforms, variant: 'full' })
  const lite = createFacadeMaterial({ color: 0, uniforms, variant: 'lite' })
  expect(full.customProgramCacheKey()).not.toBe(lite.customProgramCacheKey())
})

it('removes obsolete skyline window mesh and opts changing matrices out of culling', () => {
  const scene = readFileSync(new URL('../../app/journey/scene.ts', import.meta.url), 'utf8')
  for (const oldName of ['createWindows', 'applyWindowState', 'windowsMesh', 'interface WindowLight']) {
    expect(scene).not.toContain(oldName)
  }
  const buildings = readFileSync(new URL('../../app/journey/buildings.ts', import.meta.url), 'utf8')
  expect(buildings).toContain('mesh.frustumCulled = false')
})

function patched(variant: 'full' | 'lite', debug = 0) {
  const uniforms = { uLit: { value: .65 }, uSkyTint: { value: new THREE.Color(0xbfdbfe) },
    uTime: { value: 0 }, uFlicker: { value: 0 }, uEmissiveScale: { value: 1 } }
  const m = createFacadeMaterial({ color: 0x353b5c, uniforms, variant })
  if (debug) m.defines = { ...m.defines, FACADE_DEBUG_WINDOW: debug }
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, THREE.IUniform> }
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  return { m, shader, uniforms }
}
it('registers window uniforms and emits the reduced-cost variant separately', () => {
  const full = patched('full'); const lite = patched('lite')
  for (const key of ['uTime', 'uFlicker', 'uEmissiveScale'] as const)
    expect(full.shader.uniforms[key]).toBe(full.uniforms[key])
  expect(full.shader.fragmentShader).toContain('precision highp float;')
  expect(full.shader.fragmentShader).toContain('sin(uTime * 6.3')
  expect(lite.shader.fragmentShader).not.toContain('sin(uTime * 6.3')
  expect(lite.shader.fragmentShader).not.toContain('fwidth(')
  expect(full.m.customProgramCacheKey()).not.toBe(lite.m.customProgramCacheKey())
  expect(full.m.customProgramCacheKey()).not.toBe(patched('full', 1).m.customProgramCacheKey())
  expect(full.shader.fragmentShader).toContain('facadeWindowEmission')
  for (const variant of [full, lite]) {
    expect(variant.shader.fragmentShader).toContain('facadeLit')
    expect(variant.shader.fragmentShader).not.toContain('uSunVisibility')
    variant.m.dispose()
  }
})

it.each(['full', 'lite'] as const)('%s: gates window drawing on the aWindowed attribute', variant => {
  const { shader } = patched(variant)
  expect(shader.vertexShader).toContain('attribute float aWindowed;')
  expect(shader.vertexShader).toContain('vWindowed = aWindowed;')
  expect(shader.fragmentShader).toContain('varying float vWindowed;')
  expect(shader.fragmentShader).toContain('abs(vFaceNormal.y) < 0.5 && vWindowed > 0.5')
})
