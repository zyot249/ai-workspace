import type { StopState, Vec3 } from './stops'

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function easeInOut(p: number): number {
  const x = clamp01(p)
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
}

export function lerp(a: number, b: number, p: number): number {
  // Written as a weighted sum so p = 0 and p = 1 return a and b exactly.
  return a * (1 - p) + b * p
}

function lerp3(a: Vec3, b: Vec3, p: number): Vec3 {
  return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)]
}

export function lerpStop(a: StopState, b: StopState, p: number): StopState {
  return {
    cameraDistance: lerp(a.cameraDistance, b.cameraDistance, p),
    cameraHeight: lerp(a.cameraHeight, b.cameraHeight, p),
    lookAheadDistance: lerp(a.lookAheadDistance, b.lookAheadDistance, p),
    lookHeight: lerp(a.lookHeight, b.lookHeight, p),
    skyColor: lerp3(a.skyColor, b.skyColor, p),
    fogColor: lerp3(a.fogColor, b.fogColor, p),
    fogDensity: lerp(a.fogDensity, b.fogDensity, p),
    buildingDensity: lerp(a.buildingDensity, b.buildingDensity, p),
    buildingHeight: lerp(a.buildingHeight, b.buildingHeight, p),
    windowLitRatio: lerp(a.windowLitRatio, b.windowLitRatio, p),
  }
}

// Moves `current` a fixed fraction toward `target`. Called once per frame.
export function damp(current: number, target: number, factor: number): number {
  return lerp(current, target, factor)
}

export function dampState(current: StopState, target: StopState, factor: number): StopState {
  return lerpStop(current, target, factor)
}
