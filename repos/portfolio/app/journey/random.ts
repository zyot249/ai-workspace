// Deterministic pseudo-random in [0, 1), seeded by index so layout is stable across renders.
export function seeded(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453
  return x - Math.floor(x)
}
