export const FACADE_CELL = [0.16, 0.22] as const
export const FACADE_BASE_Y = -1

export function facadeBaseY(localY: number, height: number): number {
  return (localY + 0.5) * height
}

export function floorWorldY(row: number): number {
  return FACADE_BASE_Y + row * FACADE_CELL[1]
}

export function facadeCellAtWorldY(worldY: number): { row: number; local: number } {
  const cells = (worldY - FACADE_BASE_Y) / FACADE_CELL[1]
  const row = Math.floor(cells)
  return { row, local: cells - row }
}
