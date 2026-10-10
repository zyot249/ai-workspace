/** Shortest ramp. A shorter one can click. */
export const MIN_FADE_SECONDS = 0.05

export interface FadePlan {
  readonly startValue: number
  readonly endValue: number
  readonly startTime: number
  readonly endTime: number
}

export function fadePlan(from: number, to: number, seconds: number, now: number): FadePlan {
  const length = Number.isFinite(seconds) ? Math.max(seconds, MIN_FADE_SECONDS) : MIN_FADE_SECONDS
  return { startValue: from, endValue: to, startTime: now, endTime: now + length }
}

/** The gain a plan has reached at `now`. Used to start a new ramp from the current level. */
export function gainAt(plan: FadePlan, now: number): number {
  if (now >= plan.endTime) return plan.endValue
  if (now <= plan.startTime) return plan.startValue
  const progress = (now - plan.startTime) / (plan.endTime - plan.startTime)
  return plan.startValue + (plan.endValue - plan.startValue) * progress
}
