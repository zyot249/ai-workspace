export type Tier = 'full' | 'lite' | 'reduced' | 'none'

export interface TierInput {
  webgl: boolean
  reducedMotion: boolean
  coarsePointer: boolean
  width: number
}

export const LITE_MAX_WIDTH = 768

export function pickTier(input: TierInput): Tier {
  if (!input.webgl) return 'none'
  if (input.reducedMotion) return 'reduced'
  if (input.coarsePointer || input.width < LITE_MAX_WIDTH) return 'lite'
  return 'full'
}
