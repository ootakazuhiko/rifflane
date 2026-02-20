import type { ScoringConfig } from './types'

const DEFAULT_TIMING_WINDOW_MS = 80
const DEFAULT_PITCH_WINDOW_CENTS = 35
const DEFAULT_LATENCY_OFFSET_MS = 0
const DEFAULT_PERFECT_TIMING_WINDOW_MS = 40
const DEFAULT_PERFECT_PITCH_WINDOW_CENTS = 20

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function assertFinitePositive(value: number, label: string): number {
  const normalized = assertFiniteNumber(value, label)
  if (normalized <= 0) {
    throw new Error(`${label} must be > 0.`)
  }
  return normalized
}

export function createScoringConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  const timingWindowMs = assertFinitePositive(
    overrides.timingWindowMs ?? DEFAULT_TIMING_WINDOW_MS,
    'timingWindowMs',
  )
  const pitchWindowCents = assertFinitePositive(
    overrides.pitchWindowCents ?? DEFAULT_PITCH_WINDOW_CENTS,
    'pitchWindowCents',
  )
  const latencyOffsetMs = assertFiniteNumber(
    overrides.latencyOffsetMs ?? DEFAULT_LATENCY_OFFSET_MS,
    'latencyOffsetMs',
  )
  const perfectTimingWindowMs = assertFinitePositive(
    overrides.perfectTimingWindowMs ?? DEFAULT_PERFECT_TIMING_WINDOW_MS,
    'perfectTimingWindowMs',
  )
  const perfectPitchWindowCents = assertFinitePositive(
    overrides.perfectPitchWindowCents ?? DEFAULT_PERFECT_PITCH_WINDOW_CENTS,
    'perfectPitchWindowCents',
  )

  if (perfectTimingWindowMs > timingWindowMs) {
    throw new Error('perfectTimingWindowMs must be <= timingWindowMs.')
  }

  if (perfectPitchWindowCents > pitchWindowCents) {
    throw new Error('perfectPitchWindowCents must be <= pitchWindowCents.')
  }

  return {
    timingWindowMs,
    pitchWindowCents,
    latencyOffsetMs,
    perfectTimingWindowMs,
    perfectPitchWindowCents,
  }
}

export const DEFAULT_SCORING_CONFIG: Readonly<ScoringConfig> = Object.freeze(createScoringConfig())
