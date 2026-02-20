export interface ScoringConfig {
  timingWindowMs: number
  pitchWindowCents: number
  latencyOffsetMs: number
}

export function createScoringConfig(): ScoringConfig {
  return {
    timingWindowMs: 80,
    pitchWindowCents: 35,
    latencyOffsetMs: 0,
  }
}
