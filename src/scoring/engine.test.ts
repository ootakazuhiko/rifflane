import { describe, expect, it } from 'vitest'
import { LoopScoringEngine } from './engine'

const BASE_CHART = {
  loopDurationMs: 2000,
  notes: [
    {
      id: 'note-0',
      lane: 'E',
      timeMs: 1000,
      durationMs: 120,
      fret: 0,
    },
  ],
} as const

function createEngine(): LoopScoringEngine {
  return new LoopScoringEngine({ chart: BASE_CHART })
}

describe('LoopScoringEngine', () => {
  it('judges Perfect/Good/Miss based on pitch and timing windows', () => {
    const engine = createEngine()

    const perfectEvents = engine.evaluate({
      evaluatedAtMs: 1000,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(perfectEvents).toHaveLength(1)
    expect(perfectEvents[0]).toMatchObject({
      judgement: 'Perfect',
      reason: 'perfect-window',
    })

    const goodEvents = engine.evaluate({
      evaluatedAtMs: 3000,
      pitchCents: 2825,
      lane: 'E',
    })
    expect(goodEvents).toHaveLength(1)
    expect(goodEvents[0]).toMatchObject({
      judgement: 'Good',
      reason: 'good-window',
    })

    const missEvents = engine.evaluate({
      evaluatedAtMs: 5000,
      pitchCents: 2860,
      lane: 'E',
    })
    expect(missEvents).toHaveLength(1)
    expect(missEvents[0]).toMatchObject({
      judgement: 'Miss',
      reason: 'pitch-window',
    })

    expect(engine.getStats()).toEqual({
      perfect: 1,
      good: 1,
      miss: 1,
      total: 3,
      accuracy: 0.5,
    })
  })

  it('applies latency offset before candidate matching', () => {
    const engine = createEngine()
    engine.setLatencyOffsetMs(50)

    expect(engine.getLatencyOffsetMs()).toBe(50)

    const events = engine.evaluate({
      evaluatedAtMs: 950,
      pitchCents: 2800,
      lane: 'E',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      judgement: 'Perfect',
      adjustedTimeMs: 1000,
      timingErrorMs: 0,
    })
  })

  it('reset clears stats and loop progress', () => {
    const engine = createEngine()

    engine.evaluate({
      evaluatedAtMs: 1000,
      pitchCents: 2800,
      lane: 'E',
    })
    engine.evaluate({
      evaluatedAtMs: 3000,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(engine.getStats().total).toBe(2)

    engine.reset()
    expect(engine.getStats()).toEqual({
      perfect: 0,
      good: 0,
      miss: 0,
      total: 0,
      accuracy: 0,
    })

    const events = engine.evaluate({
      evaluatedAtMs: 1000,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(events).toHaveLength(1)
    expect(events[0].note?.loopIndex).toBe(0)
  })
})
