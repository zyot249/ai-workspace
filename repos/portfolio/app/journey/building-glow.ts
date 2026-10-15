// app/journey/building-glow.ts
import type * as THREE from 'three'
import type { BuildingModels } from './building-models'
import { GLOW_END, GLOW_START, UNIFORM_GLOW, WINDOW_GLOW, WINDOW_MATERIAL_NAMES } from './building-specs'
import { smoothstep } from './sky-mirror'
import { WINDOW_PALETTE } from './window-look'

const [warm] = WINDOW_PALETTE

// 0 by day, 1 once the street is lit.
export function glowFor(windowLitRatio: number): number {
  return smoothstep(GLOW_START, GLOW_END, windowLitRatio)
}

function uniqueMaterials(models: BuildingModels): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>()
  const pieces = [...Object.values(models.setPieces), ...models.near]
  for (const piece of pieces) {
    for (const part of piece.parts) found.add(part.material as THREE.MeshStandardMaterial)
  }
  return [...found]
}

// Window materials glow warm at night. A kit with no window material gets a faint uniform glow on every material.
export function applyBuildingGlow(
  models: BuildingModels, windowLitRatio: number, windowNames: readonly string[] = WINDOW_MATERIAL_NAMES,
): void {
  const ramp = glowFor(windowLitRatio)
  const materials = uniqueMaterials(models)
  const windows = materials.filter(material => windowNames.includes(material.name))
  if (windows.length > 0) {
    for (const material of windows) {
      material.emissive.setHex(warm.hex)
      material.emissiveIntensity = WINDOW_GLOW * ramp
    }
    return
  }
  for (const material of materials) {
    material.emissive.setHex(warm.hex)
    material.emissiveIntensity = UNIFORM_GLOW * ramp
  }
}
