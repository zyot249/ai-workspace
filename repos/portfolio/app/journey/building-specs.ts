// app/journey/building-specs.ts
import type { Vec3 } from './stops'

// Absolute path: it assumes the site is deployed at the domain root, as vehicles and people do.
export const BUILDING_MODEL_DIR = '/models/buildings/'
// How far a normalized model may drift from its spec size, in scene units, before the load is rejected.
export const BUILDING_BOUNDS_TOLERANCE = 0.05
export const BUILDING_ASSET_BUDGET_BYTES = 1_500_000
export const MAX_SET_PIECE_DRAW_CALLS = 12
export const MAX_NEAR_MESHES = 6

export const SET_PIECE_ROLES = ['gatePillar', 'beam', 'hallColumn', 'hallWall', 'stall', 'house'] as const
export type SetPieceRole = (typeof SET_PIECE_ROLES)[number]

export interface PieceSpec {
  file: string
  // Uniform scale from the model's own units to scene units.
  scale: number
  // These prepared models face +Z. The scene authors things facing -Z, so the default is half a circle.
  facingY: number
  // Expected size after the scale and the facing turn: x (width), y (height), z (depth).
  size: Vec3
}

// Rows printed by `row.mjs` in Task 1, one per role.
export const SET_PIECE_SPECS: Readonly<Record<SetPieceRole, PieceSpec>> = {
  gatePillar: {"file": "gate-pillar.glb", "scale": 3.3999999999999955, "facingY": 3.141592653589793, "size": [0.5441328165532395, 3.4, 0.5441328165532395]},
  beam: {"file": "beam.glb", "scale": 3.124237223493507, "facingY": 3.141592653589793, "size": [3.124237223493512, 0.5, 0.4999999999999992]},
  hallColumn: {"file": "hall-column.glb", "scale": 2.999999999999996, "facingY": 3.141592653589793, "size": [0.48011719107638784, 3, 0.48011719107638784]},
  hallWall: {"file": "hall-wall.glb", "scale": 2.4, "facingY": 3.141592653589793, "size": [2.4, 2.4, 0.23994872890408095]},
  stall: {"file": "stall.glb", "scale": 1.3743117278513388, "facingY": Math.PI / 2, "size": [1.3743919186986908, 1.7, 1.3743919186986908]},
  house: {"file": "house.glb", "scale": 1.9415501029646036, "facingY": 3.141592653589793, "size": [5.824650308893812, 3.05, 3.8833372187900705]},
}

// Near-layer variants, in the order the rows were printed.
export const NEAR_VARIANT_SPECS: readonly PieceSpec[] = [
  {"file": "near-1.glb", "scale": 0.6366232756945794, "facingY": 3.141592653589793, "size": [1.273246551389159, 1, 1.273246551389159]},
  {"file": "near-2.glb", "scale": 0.5834962385722879, "facingY": 3.141592653589793, "size": [1.167104098635823, 1.5, 1.167104098635823]},
  {"file": "near-3.glb", "scale": 0.6223773401236987, "facingY": 3.141592653589793, "size": [1.8671320203710964, 1.6, 1.2448306563624068]}
]

// Material names that are windows in the chosen kit. Empty when the kit bakes windows into its palette.
export const WINDOW_MATERIAL_NAMES: readonly string[] = []

// Centers of the two always-lit courtyard windows on the house front: x from the front-face center, y above the base.
export const HOUSE_WINDOW_SLOTS: readonly { x: number; y: number }[] = [{ x: -1, y: 0.9707750514823018 }, { x: 1, y: 0.9707750514823018 }]
export const HOUSE_WINDOW_SIZE = { width: 0.4, height: 0.5 } as const

// The near layer scales a building's height by the scroll height factor clamped to this range, so facades never stretch far.
export const NEAR_Y_MIN = 0.85
export const NEAR_Y_MAX = 1.15
export const NEAR_VARIANT_SEED = 7100

// Night glow. Window materials glow at WINDOW_GLOW. A kit without window materials gets UNIFORM_GLOW on every material.
export const WINDOW_GLOW = 0.9
export const UNIFORM_GLOW = 0.08
export const GLOW_START = 0.15
export const GLOW_END = 0.6

// `journey-building-` is reserved for the box layers (their GPU probes match that prefix).
export const SCENERY_GROUP_NAME = 'journey-scenery'
export const NEAR_MESH_PREFIX = 'journey-near-building-'
