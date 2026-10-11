import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { VEHICLE_SCALE, VEHICLE_SPECS, VEHICLE_TYPES, type VehicleType } from '../../app/journey/vehicle-specs'
import { mergeVehicleParts } from '../../app/journey/vehicle-geometry'
import {
  attachVehicleModels, disposeVehicleModels, type GltfSource, loadVehicleModels, type VehicleModels,
} from '../../app/journey/vehicle-models'

vi.mock('../../app/journey/vehicle-geometry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../app/journey/vehicle-geometry')>()
  return { ...actual, mergeVehicleParts: vi.fn(actual.mergeVehicleParts) }
})

const MODEL_HEIGHT = 1.3
const MODEL_HALF_WIDTH = 0.75

// A stand-in GLB scene: one body block spanning the spec'd front and rear, plus a wheel on the ground.
function fakeScene(type: VehicleType, map = new THREE.Texture()): THREE.Group {
  const { frontZ, rearZ } = VEHICLE_SPECS[type]
  const material = new THREE.MeshStandardMaterial({ map })
  const length = frontZ - rearZ
  const body = new THREE.Mesh(new THREE.BoxGeometry(MODEL_HALF_WIDTH * 2, MODEL_HEIGHT - 0.3, length), material)
  body.position.set(0, 0.3 + (MODEL_HEIGHT - 0.3) / 2, (frontZ + rearZ) / 2)
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.6), material)
  wheel.position.set(0.3, 0.3, frontZ - 0.5)
  const group = new THREE.Group()
  group.add(body, wheel)
  return group
}

function fakeSource(overrides: Partial<Record<VehicleType, THREE.Object3D>> = {}): GltfSource {
  return async url => {
    const type = VEHICLE_TYPES.find(candidate => url.endsWith(VEHICLE_SPECS[candidate].file))
    if (!type) throw new Error(`Unexpected url ${url}`)
    return { scene: overrides[type] ?? fakeScene(type) }
  }
}

describe('loadVehicleModels', () => {
  it('returns one merged geometry per type, scaled and facing -Z, with one shared texture', async () => {
    const models = await loadVehicleModels(fakeSource())
    for (const type of VEHICLE_TYPES) {
      const box = models.geometries[type].boundingBox!
      const { frontZ, rearZ } = VEHICLE_SPECS[type]
      expect(box.min.z).toBeCloseTo(-frontZ * VEHICLE_SCALE, 5)
      expect(box.max.z).toBeCloseTo(-rearZ * VEHICLE_SCALE, 5)
      expect(box.min.y).toBeCloseTo(0, 5)
      expect(box.max.y).toBeCloseTo(MODEL_HEIGHT * VEHICLE_SCALE, 5)
    }
    expect(models.map).toBeInstanceOf(THREE.Texture)
    disposeVehicleModels(models)
  })

  it('applies parent node transforms to the parts', async () => {
    // The inner scene sits 0.5 low and 0.4 back; the parent offset cancels that, so only the baked
    // world matrix puts the bounds back on the spec.
    const nested = new THREE.Group()
    const inner = fakeScene('sedan')
    inner.position.set(0, -0.5, -0.4)
    const offset = new THREE.Group()
    offset.position.set(0, 0.5, 0.4)
    offset.add(inner)
    nested.add(offset)
    const models = await loadVehicleModels(fakeSource({ sedan: nested }))
    const box = models.geometries.sedan.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 5)
    expect(box.max.y).toBeCloseTo(MODEL_HEIGHT * VEHICLE_SCALE, 5)
    expect(box.min.z).toBeCloseTo(-VEHICLE_SPECS.sedan.frontZ * VEHICLE_SCALE, 5)
    disposeVehicleModels(models)
  })

  it('keeps the first palette texture and disposes the other copies', async () => {
    const [first, second, third] = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()]
    const spies = [first, second, third].map(texture => vi.spyOn(texture, 'dispose'))
    const source = fakeSource({
      sedan: fakeScene('sedan', first), suv: fakeScene('suv', second), truck: fakeScene('truck', third),
    })
    const models = await loadVehicleModels(source)
    expect(models.map).toBe(first)
    expect(spies[0]).not.toHaveBeenCalled()
    expect(spies[1]).toHaveBeenCalledTimes(1)
    expect(spies[2]).toHaveBeenCalledTimes(1)
    disposeVehicleModels(models)
  })

  it('disposes everything built so far when a later model fails its spec', async () => {
    const [kept, spare] = [new THREE.Texture(), new THREE.Texture()]
    const keptSpy = vi.spyOn(kept, 'dispose')
    const spareSpy = vi.spyOn(spare, 'dispose')
    const tooTall = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 2.55), new THREE.MeshStandardMaterial({ map: spare }))
    slab.position.set(0, 1.5, -0.025)
    tooTall.add(slab)
    const merge = vi.mocked(mergeVehicleParts)
    merge.mockClear()
    const disposed = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    try {
      await expect(loadVehicleModels(fakeSource({ sedan: fakeScene('sedan', kept), suv: tooTall })))
        .rejects.toThrow(/suv.*does not match/)
      const merged = merge.mock.results.map(result => result.value as THREE.BufferGeometry)
      expect(merged).toHaveLength(2)
      for (const geometry of merged) expect(disposed.mock.contexts).toContain(geometry)
    } finally {
      disposed.mockRestore()
    }
    expect(keptSpy).toHaveBeenCalledTimes(1)
    expect(spareSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects with the measured size when a model does not match its spec', async () => {
    const tooTall = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 2.55), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))
    slab.position.set(0, 1.5, -0.025)
    tooTall.add(slab)
    await expect(loadVehicleModels(fakeSource({ sedan: tooTall }))).rejects.toThrow(/sedan.*does not match/)
  })

  it('rejects when a model has no textured material', async () => {
    const bare = new THREE.Group()
    bare.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    await expect(loadVehicleModels(fakeSource({ truck: bare }))).rejects.toThrow(/truck/)
  })

  it('rejects when a download fails', async () => {
    const failing: GltfSource = async () => { throw new Error('404') }
    await expect(loadVehicleModels(failing)).rejects.toThrow('404')
  })

  it('disposes the geometries and the texture on request', async () => {
    const models = await loadVehicleModels(fakeSource())
    const spies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    disposeVehicleModels(models)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
  })
})

describe('attachVehicleModels', () => {
  function stubModels(): VehicleModels {
    const geometries = { sedan: new THREE.BufferGeometry(), suv: new THREE.BufferGeometry(), truck: new THREE.BufferGeometry() }
    return { geometries, map: new THREE.Texture() }
  }

  it('hands the loaded models to traffic and reports ready', async () => {
    const models = stubModels()
    const traffic = { useModels: vi.fn() }
    const onReady = vi.fn()
    await attachVehicleModels({ traffic, load: async () => models, isDisposed: () => false, onReady })
    expect(traffic.useModels).toHaveBeenCalledWith(models)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('keeps the box cars and reports the error once when the load fails', async () => {
    const traffic = { useModels: vi.fn() }
    const onError = vi.fn()
    const onReady = vi.fn()
    const failure = new Error('404')
    await expect(attachVehicleModels({
      traffic, load: async () => { throw failure }, isDisposed: () => false, onReady, onError,
    })).resolves.toBeUndefined()
    expect(traffic.useModels).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('keeps the box cars when traffic rejects the models', async () => {
    const onError = vi.fn()
    const traffic = { useModels: () => { throw new Error('bad models') } }
    await attachVehicleModels({ traffic, load: async () => stubModels(), isDisposed: () => false, onError })
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('adds nothing and disposes the models when the scene was disposed before they arrived', async () => {
    const models = stubModels()
    const spies = VEHICLE_TYPES.map(type => vi.spyOn(models.geometries[type], 'dispose'))
    const mapSpy = vi.spyOn(models.map, 'dispose')
    const traffic = { useModels: vi.fn() }
    const onReady = vi.fn()
    await attachVehicleModels({ traffic, load: async () => models, isDisposed: () => true, onReady })
    expect(traffic.useModels).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(mapSpy).toHaveBeenCalledTimes(1)
  })
})
