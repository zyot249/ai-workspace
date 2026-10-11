export const VEHICLE_TYPES = ['sedan', 'suv', 'truck'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

// Kenney's cars are 2.55 to 3 model units long. At 0.36 the sedan is 0.92 scene units, near the old box car (0.9).
export const VEHICLE_SCALE = 0.36

// Measured from the Kenney GLBs, in model units. The model faces +Z, so the front is at `frontZ`.
// Wheel bottoms sit at y = 0 and the roof at VEHICLE_HEIGHT. The loader re-checks these against the real files.
export const VEHICLE_HALF_WIDTH = 0.75
export const VEHICLE_HEIGHT = 1.3

export interface VehicleSpec {
  file: string
  frontZ: number
  rearZ: number
}

export const VEHICLE_SPECS: Readonly<Record<VehicleType, VehicleSpec>> = {
  sedan: { file: 'sedan.glb', frontZ: 1.25, rearZ: -1.3 },
  suv: { file: 'suv.glb', frontZ: 1.35, rearZ: -1.35 },
  truck: { file: 'truck.glb', frontZ: 1.45, rearZ: -1.5 },
}

export interface VehicleBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

// Scene units after normalization: front toward -Z, wheels on y = 0, scaled by VEHICLE_SCALE.
export function vehicleBounds(type: VehicleType): VehicleBounds {
  const { frontZ, rearZ } = VEHICLE_SPECS[type]
  return {
    minX: -VEHICLE_HALF_WIDTH * VEHICLE_SCALE,
    maxX: VEHICLE_HALF_WIDTH * VEHICLE_SCALE,
    minY: 0,
    maxY: VEHICLE_HEIGHT * VEHICLE_SCALE,
    minZ: -frontZ * VEHICLE_SCALE,
    maxZ: -rearZ * VEHICLE_SCALE,
  }
}

export interface VehicleLightOffset {
  x: number
  y: number
  z: number
  kind: 'front' | 'rear'
}

// Light height and inset in model units. Tuned by eye against the Kenney bumpers.
const LIGHT_HEIGHT = 0.55
const LIGHT_INSET_X = 0.45
// The light box is 0.03 deep. Center it just inside the bumper.
const LIGHT_Z_INSET = 0.02

function lightOffsetsFor(type: VehicleType): readonly VehicleLightOffset[] {
  const bounds = vehicleBounds(type)
  const x = LIGHT_INSET_X * VEHICLE_SCALE
  const y = LIGHT_HEIGHT * VEHICLE_SCALE
  const front = bounds.minZ + LIGHT_Z_INSET
  const rear = bounds.maxZ - LIGHT_Z_INSET
  return [
    { x: -x, y, z: front, kind: 'front' },
    { x, y, z: front, kind: 'front' },
    { x: -x, y, z: rear, kind: 'rear' },
    { x, y, z: rear, kind: 'rear' },
  ]
}

const LIGHT_OFFSETS: Readonly<Record<VehicleType, readonly VehicleLightOffset[]>> = {
  sedan: lightOffsetsFor('sedan'),
  suv: lightOffsetsFor('suv'),
  truck: lightOffsetsFor('truck'),
}

export function vehicleLightOffsets(type: VehicleType): readonly VehicleLightOffset[] {
  return LIGHT_OFFSETS[type]
}
