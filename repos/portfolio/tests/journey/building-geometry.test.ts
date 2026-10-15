// tests/journey/building-geometry.test.ts
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { mergeByMaterial, normalizePiece } from '../../app/journey/building-geometry'

function box(width: number, height: number, depth: number, material: THREE.Material, at: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
  mesh.position.set(...at)
  return mesh
}

describe('normalizePiece', () => {
  it('scales, puts the pivot at the base center and reports the size', () => {
    const root = new THREE.Group()
    root.add(box(2, 4, 2, new THREE.MeshStandardMaterial(), [5, 10, 7]))
    const piece = normalizePiece(root, { scale: 0.5, facingY: 0 })
    expect(piece.size[0]).toBeCloseTo(1, 5)
    expect(piece.size[1]).toBeCloseTo(2, 5)
    expect(piece.size[2]).toBeCloseTo(1, 5)
    const bounds = new THREE.Box3()
    for (const part of piece.parts) { part.geometry.computeBoundingBox(); bounds.union(part.geometry.boundingBox!) }
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0, 5)
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(0, 5)
  })

  it('applies ancestor transforms', () => {
    const root = new THREE.Group()
    root.position.set(0, 3, 0)
    const child = new THREE.Group()
    child.position.set(0, 2, 0)
    child.add(box(1, 1, 1, new THREE.MeshStandardMaterial(), [0, 0, 0]))
    root.add(child)
    const piece = normalizePiece(root, { scale: 1, facingY: 0 })
    expect(piece.size).toEqual([1, 1, 1].map(v => expect.closeTo(v, 5)))
  })

  it('swaps width and depth for a quarter-turn facing', () => {
    const root = new THREE.Group()
    root.add(box(4, 1, 2, new THREE.MeshStandardMaterial(), [0, 0, 0]))
    const piece = normalizePiece(root, { scale: 1, facingY: Math.PI / 2 })
    expect(piece.size[0]).toBeCloseTo(2, 5)
    expect(piece.size[2]).toBeCloseTo(4, 5)
  })

  it('rejects a model with no meshes', () => {
    expect(() => normalizePiece(new THREE.Group(), { scale: 1, facingY: 0 })).toThrow('has no meshes')
  })

  it('does not change the source geometry', () => {
    const mesh = box(2, 2, 2, new THREE.MeshStandardMaterial(), [3, 3, 3])
    const before = mesh.geometry.getAttribute('position').array.slice()
    const root = new THREE.Group()
    root.add(mesh)
    normalizePiece(root, { scale: 2, facingY: Math.PI })
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(Array.from(before))
  })
})

describe('mergeByMaterial', () => {
  it('merges parts that share a material name into one geometry', () => {
    const wall = new THREE.MeshStandardMaterial({ name: 'wall' })
    const roof = new THREE.MeshStandardMaterial({ name: 'roof' })
    const parts = [
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: wall },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: roof },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: wall },
    ]
    const merged = mergeByMaterial(parts)
    expect(merged).toHaveLength(2)
    const wallPart = merged.find(part => part.material === wall)!
    expect(wallPart.geometry.getAttribute('position').count).toBe(2 * 24)
  })

  it('keeps the first material instance for a name', () => {
    const first = new THREE.MeshStandardMaterial({ name: 'wall' })
    const second = new THREE.MeshStandardMaterial({ name: 'wall' })
    const merged = mergeByMaterial([
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: first },
      { geometry: new THREE.BoxGeometry(1, 1, 1), material: second },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.material).toBe(first)
  })

  it('throws a readable error for incompatible attributes', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'm' })
    const plain = new THREE.BufferGeometry()
    plain.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    expect(() => mergeByMaterial([{ geometry: new THREE.BoxGeometry(1, 1, 1), material }, { geometry: plain, material }]))
      .toThrow('incompatible attributes')
  })
})

it('releases baked geometry when a later mesh is unsupported', () => {
  const root = new THREE.Group()
  const first = box(1, 1, 1, new THREE.MeshStandardMaterial(), [0, 0, 0])
  const clone = first.geometry.clone()
  let disposed = false
  clone.addEventListener('dispose', () => { disposed = true })
  first.geometry.clone = () => clone
  root.add(first, new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial()]))
  expect(() => normalizePiece(root, { scale: 1, facingY: 0 })).toThrow('multi-material')
  expect(disposed).toBe(true)
})

it('bakes quantized normalized attributes without clipping or rounding transformed positions', () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Int16BufferAttribute([-32767, 0, -32767, 32767, 32767, 32767], 3, true))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
  mesh.scale.set(2, 3, 2)
  const root = new THREE.Group(); root.add(mesh)
  const piece = normalizePiece(root, { scale: 2, facingY: 0 })
  expect(piece.size).toEqual([8, 6, 8])
  expect(piece.parts[0]!.geometry.getAttribute('position').array).toBeInstanceOf(Float32Array)
})

it('disposes earlier merged geometry if a later material group is incompatible', () => {
  const good = new THREE.MeshStandardMaterial({ name: 'good' })
  const bad = new THREE.MeshStandardMaterial({ name: 'bad' })
  const a = new THREE.BoxGeometry()
  const b = new THREE.BoxGeometry(); b.deleteAttribute('normal')
  const dispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
  try {
    expect(() => mergeByMaterial([{ geometry: a, material: good }, { geometry: a, material: bad }, { geometry: b, material: bad }])).toThrow('incompatible attributes')
    expect(dispose).toHaveBeenCalledTimes(1)
  } finally { dispose.mockRestore() }
})
