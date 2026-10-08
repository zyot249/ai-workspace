export type Tier = 'full' | 'lite' | 'reduced' | 'none'

export interface TierInput {
  webgl: boolean
  reducedMotion: boolean
  coarsePointer: boolean
  width: number
}

export const LITE_MAX_WIDTH = 768

export function lowPowerFor(input: TierInput): boolean {
  return input.coarsePointer || input.width < LITE_MAX_WIDTH
}

export function pickTier(input: TierInput): Tier {
  if (!input.webgl) return 'none'
  if (input.reducedMotion) return 'reduced'
  if (lowPowerFor(input)) return 'lite'
  return 'full'
}
