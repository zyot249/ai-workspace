// tests/journey/building-models.test.ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  BUILDING_MODEL_DIR, NEAR_VARIANT_SPECS, type PieceSpec, SET_PIECE_ROLES, SET_PIECE_SPECS,
} from '../../app/journey/building-specs'
import { attachBuildingModels, type BuildingGltfSource, disposeBuildingModels, loadBuildingModels } from '../../app/journey/building-models'

const allSpecs: readonly PieceSpec[] = [...SET_PIECE_ROLES.map(role => SET_PIECE_SPECS[role]), ...NEAR_VARIANT_SPECS]

// A stand-in GLB scene whose normalized size equals the spec. A quarter-turn facing swaps width and depth.
function fakeScene(spec: PieceSpec, materialName = 'palette', map = new THREE.Texture()): THREE.Group {
  const turned = Math.abs(Math.sin(spec.facingY)) > 0.5
  const [w, h, d] = spec.size.map(v => v / spec.scale) as [number, number, number]
  const material = new THREE.MeshStandardMaterial({ name: materialName, map })
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.BoxGeometry(turned ? d : w, h, turned ? w : d), material))
  return group
}

function fakeSource(overrides: Record<string, () => THREE.Object3D> = {}): BuildingGltfSource {
  return async url => {
    const spec = allSpecs.find(candidate => url === BUILDING_MODEL_DIR + candidate.file)
    if (!spec) throw new Error(`Unexpected url ${url}`)
    return { scene: overrides[spec.file]?.() ?? fakeScene(spec) }
  }
}

describe('loadBuildingModels', () => {
  it('returns a normalized model for every role and every near variant', async () => {
    const models = await loadBuildingModels(fakeSource())
    for (const role of SET_PIECE_ROLES) {
      expect(models.setPieces[role].parts.length).toBeGreaterThan(0)
      for (const [i, value] of models.setPieces[role].size.entries()) expect(value).toBeCloseTo(SET_PIECE_SPECS[role].size[i] ?? 0, 2)
    }
    expect(models.near).toHaveLength(NEAR_VARIANT_SPECS.length)
    disposeBuildingModels(models)
  })

  it('fetches each file once even when two specs name it', async () => {
    const source = vi.fn(fakeSource())
    const models = await loadBuildingModels(source)
    const unique = new Set(allSpecs.map(spec => spec.file))
    expect(source).toHaveBeenCalledTimes(unique.size)
    disposeBuildingModels(models)
  })

  it('shares one material instance per material name and disposes the spares', async () => {
    const maps = allSpecs.map(() => new THREE.Texture())
    const spies = maps.map(texture => vi.spyOn(texture, 'dispose'))
    let index = 0
    const source: BuildingGltfSource = async url => {
      const spec = allSpecs.find(candidate => url === BUILDING_MODEL_DIR + candidate.file)!
      return { scene: fakeScene(spec, 'palette', maps[index++]) }
    }
    const models = await loadBuildingModels(source)
    const materials = new Set([...SET_PIECE_ROLES.flatMap(role => models.setPieces[role].parts), ...models.near.flatMap(piece => piece.parts)]
      .map(part => part.material))
    expect(materials.size).toBe(1)
    const kept = [...materials][0] as THREE.MeshStandardMaterial
    expect(spies.filter(spy => spy.mock.calls.length > 0)).toHaveLength(new Set(allSpecs.map(spec => spec.file)).size - 1)
    expect(kept.map).toBe(maps[0])
    disposeBuildingModels(models)
  })

  it('rejects a model whose size drifts, and disposes what it built', async () => {
    const first = allSpecs[0]!
    const drift = () => {
      const group = new THREE.Group()
      group.add(new THREE.Mesh(new THREE.BoxGeometry(...first.size.map(v => (v / first.scale) * 3) as [number, number, number]),
        new THREE.MeshStandardMaterial({ name: 'palette' })))
      return group
    }
    await expect(loadBuildingModels(fakeSource({ [first.file]: drift }))).rejects.toThrow('does not match its spec')
  })

  it('rejects a model with no meshes', async () => {
    const first = allSpecs[0]!
    await expect(loadBuildingModels(fakeSource({ [first.file]: () => new THREE.Group() }))).rejects.toThrow('has no meshes')
  })

  it('rejects when a download fails', async () => {
    const failing: BuildingGltfSource = async () => { throw new Error('404') }
    await expect(loadBuildingModels(failing)).rejects.toThrow('404')
  })
})

describe('disposeBuildingModels', () => {
  it('disposes every geometry and the shared material and its texture', async () => {
    const models = await loadBuildingModels(fakeSource())
    const parts = [...SET_PIECE_ROLES.flatMap(role => models.setPieces[role].parts), ...models.near.flatMap(piece => piece.parts)]
    const geometrySpies = parts.map(part => vi.spyOn(part.geometry, 'dispose'))
    const material = parts[0]!.material as THREE.MeshStandardMaterial
    const materialSpy = vi.spyOn(material, 'dispose')
    const textureSpy = vi.spyOn(material.map as THREE.Texture, 'dispose')
    disposeBuildingModels(models)
    expect(geometrySpies.every(spy => spy.mock.calls.length > 0)).toBe(true)
    expect(materialSpy).toHaveBeenCalled()
    expect(textureSpy).toHaveBeenCalled()
  })
})

describe('attachBuildingModels', () => {
  it('stages, warms, shows, then reports ready', async () => {
    const calls: string[] = []
    const models = await loadBuildingModels(fakeSource())
    await attachBuildingModels({
      target: { stageModels: () => calls.push('stage'), showModels: () => calls.push('show'), discardModels: () => calls.push('discard') },
      load: async () => models,
      isDisposed: () => false,
      warm: async () => { calls.push('warm') },
      onReady: () => calls.push('ready'),
    })
    expect(calls).toEqual(['stage', 'warm', 'show', 'ready'])
    disposeBuildingModels(models)
  })
})

describe('source ownership', () => {
  it('releases source geometries after successful baking', async () => {
    const disposed: string[] = []
    const models = await loadBuildingModels(async url => {
      const spec = allSpecs.find(spec => url.endsWith(spec.file))!
      const scene = fakeScene(spec)
      ;(scene.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => disposed.push(url))
      return { scene }
    })
    expect(disposed).toHaveLength(new Set(allSpecs.map(spec => spec.file)).size)
    disposeBuildingModels(models)
  })

  it('releases successful downloads when another download rejects', async () => {
    const released: string[] = []
    await expect(loadBuildingModels(async url => {
      if (url.endsWith(allSpecs[0]!.file)) throw new Error('network')
      await Promise.resolve()
      const scene = fakeScene(allSpecs.find(spec => url.endsWith(spec.file))!)
      const mesh = scene.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      mesh.geometry.addEventListener('dispose', () => released.push('geometry'))
      mesh.material.addEventListener('dispose', () => released.push('material'))
      mesh.material.map!.addEventListener('dispose', () => released.push('texture'))
      return { scene }
    })).rejects.toThrow('network')
    expect(released).toHaveLength((new Set(allSpecs.map(spec => spec.file)).size - 1) * 3)
  })

  it('keeps a texture shared by canonical and spare materials until disposal', async () => {
    const map = new THREE.Texture()
    const dispose = vi.spyOn(map, 'dispose')
    const models = await loadBuildingModels(async url => ({ scene: fakeScene(allSpecs.find(spec => url.endsWith(spec.file))!, 'palette', map) }))
    expect(dispose).not.toHaveBeenCalled()
    disposeBuildingModels(models)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
