// app/journey/gate-detail.ts
import * as THREE from 'three'
import { archStation } from './arch-geometry'
import { setUniformUv } from './building-geometry'
import { GATE_BASE_UV, GATE_PORTHOLE_UV, GATE_TRIM_UV } from './building-specs'
import type { GateBox, GateLayout } from './setpiece-layout'

export type DetailKind = 'rib' | 'porthole' | 'plinth' | 'trim'

export interface DetailPart {
  kind: DetailKind
  // In the gate's own frame, with the arch feet at `arch.baseY`.
  geometry: THREE.BufferGeometry
}

// Ribs cross the arch at even steps, like the panel joints of a precast arch. The middle one is at the apex.
export const RIB_COUNT = 11
// One porthole in each gap between two ribs, on each face of the arch.
export const PORTHOLES_PER_FACE = RIB_COUNT - 1

const RIB_WIDTH = 0.1
// How far a rib stands out of the band radially, and out of each face.
const RIB_RADIAL_EXTRA = 0.08
const RIB_FACE_PROUD = 0.05
const PORTHOLE_RADIUS = 0.09
const PORTHOLE_THICKNESS = 0.04
// How far a porthole sinks into the face, so it does not float.
const PORTHOLE_SINK = 0.01
const PORTHOLE_SEGMENTS = 14
const PLINTH_HEIGHT = 0.25
const PLINTH_MARGIN = 0.14
const TRIM_HEIGHT = 0.06

function colored(geometry: THREE.BufferGeometry, uv: readonly [number, number]): THREE.BufferGeometry {
  setUniformUv(geometry, uv)
  return geometry
}

function ribs(layout: GateLayout): DetailPart[] {
  const { arch } = layout
  return Array.from({ length: RIB_COUNT }, (_, k) => {
    const station = archStation(arch, (k + 1) / (RIB_COUNT + 1))
    const radial = Math.hypot(station.outer.x - station.inner.x, station.outer.y - station.inner.y)
    const geometry = new THREE.BoxGeometry(RIB_WIDTH, radial + RIB_RADIAL_EXTRA, arch.depth + RIB_FACE_PROUD * 2)
    geometry.rotateZ(Math.atan2(station.tangent.y, station.tangent.x))
    geometry.translate((station.inner.x + station.outer.x) / 2, arch.baseY + (station.inner.y + station.outer.y) / 2, 0)
    return { kind: 'rib', geometry: colored(geometry, GATE_TRIM_UV) }
  })
}

function portholes(layout: GateLayout): DetailPart[] {
  const { arch } = layout
  const parts: DetailPart[] = []
  for (let k = 0; k < PORTHOLES_PER_FACE; k++) {
    const station = archStation(arch, (k + 1.5) / (RIB_COUNT + 1))
    const x = (station.inner.x + station.outer.x) / 2
    const y = arch.baseY + (station.inner.y + station.outer.y) / 2
    for (const face of [-1, 1] as const) {
      const geometry = new THREE.CylinderGeometry(PORTHOLE_RADIUS, PORTHOLE_RADIUS, PORTHOLE_THICKNESS, PORTHOLE_SEGMENTS)
      // The cylinder's axis is y. Turn it onto z so the disc faces out of the arch.
      geometry.rotateX(Math.PI / 2)
      geometry.translate(x, y, face * (arch.depth / 2 + PORTHOLE_THICKNESS / 2 - PORTHOLE_SINK))
      parts.push({ kind: 'porthole', geometry: colored(geometry, GATE_PORTHOLE_UV) })
    }
  }
  return parts
}

function boxPart(kind: DetailKind, uv: readonly [number, number], width: number, height: number, depth: number,
  x: number, bottom: number, z: number): DetailPart {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate(x, bottom + height / 2, z)
  return { kind, geometry: colored(geometry, uv) }
}

// Piers are the tall boxes of the layout and canopies the low ones.
function isPier(box: GateBox): boolean {
  return box.height > 1
}

function plinths(layout: GateLayout): DetailPart[] {
  return layout.boxes.filter(isPier).map(pier => boxPart('plinth', GATE_BASE_UV,
    pier.width + PLINTH_MARGIN, PLINTH_HEIGHT, pier.depth + PLINTH_MARGIN, pier.x, pier.y, pier.z))
}

function trims(layout: GateLayout): DetailPart[] {
  return layout.boxes.filter(box => !isPier(box)).map(canopy => boxPart('trim', GATE_BASE_UV,
    canopy.width, TRIM_HEIGHT, canopy.depth, canopy.x, canopy.y - TRIM_HEIGHT, canopy.z))
}

// The surface detail of the gate: panel ribs and portholes on the arch, a plinth under each pier and a trim strip
// under each canopy. Each part is a flat palette color, so the whole gate stays one material.
export function gateDetailParts(layout: GateLayout): DetailPart[] {
  return [...ribs(layout), ...portholes(layout), ...plinths(layout), ...trims(layout)]
}
