import * as THREE from 'three'
import { expect, it } from 'vitest'
import { REFLECT_LAYER, reflectInPuddles } from '../../app/journey/reflect-layer'

it('opts an object and its descendants into the reflection layer without leaving layer 0', () => {
  const group = new THREE.Group()
  const child = new THREE.Mesh()
  const light = new THREE.DirectionalLight()
  group.add(child)
  reflectInPuddles(group, light)
  const reflection = new THREE.Layers()
  reflection.set(REFLECT_LAYER)
  const main = new THREE.Layers()
  for (const object of [group, child, light]) {
    expect(object.layers.test(reflection)).toBe(true)
    expect(object.layers.test(main)).toBe(true)
  }
})

it('leaves objects that were not listed on layer 0 only', () => {
  const reflection = new THREE.Layers()
  reflection.set(REFLECT_LAYER)
  expect(new THREE.Mesh().layers.test(reflection)).toBe(false)
})
