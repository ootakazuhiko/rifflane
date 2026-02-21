import { describe, expect, it } from 'vitest'
import { createScoringConfig, DEFAULT_SCORING_CONFIG } from './config'

describe('createScoringConfig', () => {
  it('returns default config when overrides are omitted', () => {
    expect(createScoringConfig()).toEqual(DEFAULT_SCORING_CONFIG)
  })

  it('applies valid overrides', () => {
    expect(
      createScoringConfig({
        timingWindowMs: 90,
        pitchWindowCents: 40,
        latencyOffsetMs: -18,
        perfectTimingWindowMs: 30,
        perfectPitchWindowCents: 15,
      }),
    ).toEqual({
      timingWindowMs: 90,
      pitchWindowCents: 40,
      latencyOffsetMs: -18,
      perfectTimingWindowMs: 30,
      perfectPitchWindowCents: 15,
    })
  })

  it('throws when positive-only windows are not > 0', () => {
    expect(() => createScoringConfig({ timingWindowMs: 0 })).toThrow('timingWindowMs must be > 0.')
    expect(() => createScoringConfig({ pitchWindowCents: -1 })).toThrow('pitchWindowCents must be > 0.')
    expect(() => createScoringConfig({ perfectTimingWindowMs: 0 })).toThrow(
      'perfectTimingWindowMs must be > 0.',
    )
    expect(() => createScoringConfig({ perfectPitchWindowCents: -1 })).toThrow(
      'perfectPitchWindowCents must be > 0.',
    )
  })

  it('throws when values are not finite', () => {
    expect(() => createScoringConfig({ timingWindowMs: Number.POSITIVE_INFINITY })).toThrow(
      'timingWindowMs must be a finite number.',
    )
    expect(() => createScoringConfig({ latencyOffsetMs: Number.NaN })).toThrow(
      'latencyOffsetMs must be a finite number.',
    )
  })

  it('throws when perfect windows exceed normal windows', () => {
    expect(() =>
      createScoringConfig({
        timingWindowMs: 80,
        perfectTimingWindowMs: 81,
      }),
    ).toThrow('perfectTimingWindowMs must be <= timingWindowMs.')

    expect(() =>
      createScoringConfig({
        pitchWindowCents: 35,
        perfectPitchWindowCents: 36,
      }),
    ).toThrow('perfectPitchWindowCents must be <= pitchWindowCents.')
  })
})
