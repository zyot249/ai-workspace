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
    camera: lerp3(a.camera, b.camera, p),
    lookAt: lerp3(a.lookAt, b.lookAt, p),
    color: lerp3(a.color, b.color, p),
    strength: lerp(a.strength, b.strength, p),
    speed: lerp(a.speed, b.speed, p),
    scale: lerp(a.scale, b.scale, p),
    offsetWide: lerp3(a.offsetWide, b.offsetWide, p),
    offsetNarrow: lerp3(a.offsetNarrow, b.offsetNarrow, p),
  }
}

// Moves `current` a fixed fraction toward `target`. Called once per frame.
export function damp(current: number, target: number, factor: number): number {
  return lerp(current, target, factor)
}

export function dampState(current: StopState, target: StopState, factor: number): StopState {
  return lerpStop(current, target, factor)
}
