import { describe, expect, it } from 'vitest'
import { LoopScoringEngine } from './engine'
import type { LoopScoringChart } from './types'

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

  it('emits multiple auto-miss events across loop boundaries', () => {
    const engine = createEngine()

    const autoMissEvents = engine.advance(7200)
    expect(autoMissEvents).toHaveLength(4)
    expect(autoMissEvents.map((event) => event.note?.loopIndex)).toEqual([0, 1, 2, 3])
    expect(autoMissEvents.every((event) => event.source === 'auto-miss')).toBe(true)
    expect(autoMissEvents.every((event) => event.reason === 'auto-miss')).toBe(true)
    expect(engine.getStats()).toEqual({
      perfect: 0,
      good: 0,
      miss: 4,
      total: 4,
      accuracy: 0,
    })

    const judged = engine.evaluate({
      evaluatedAtMs: 9000,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(judged).toHaveLength(1)
    expect(judged[0].judgement).toBe('Perfect')
    expect(judged[0].note?.loopIndex).toBe(4)
  })

  it('marks candidate as miss when pitch input is missing', () => {
    const engine = createEngine()

    const events = engine.evaluate({
      evaluatedAtMs: 1000,
      pitchCents: null,
      lane: 'E',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      judgement: 'Miss',
      reason: 'pitch-missing',
      source: 'input',
      timingErrorMs: 0,
      pitchErrorCents: null,
    })
    expect(engine.getStats().miss).toBe(1)
  })

  it('respects lane filter during candidate selection', () => {
    const chart: LoopScoringChart = {
      loopDurationMs: 2000,
      notes: [
        {
          id: 'e-note',
          lane: 'E',
          timeMs: 1000,
          durationMs: 120,
          fret: 0,
        },
        {
          id: 'a-note',
          lane: 'A',
          timeMs: 1020,
          durationMs: 120,
          fret: 0,
        },
      ],
    }

    const filteredEngine = new LoopScoringEngine({ chart })
    const filteredEvents = filteredEngine.evaluate({
      evaluatedAtMs: 1020,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(filteredEvents).toHaveLength(1)
    expect(filteredEvents[0].note?.id).toBe('e-note')
    expect(filteredEvents[0].timingErrorMs).toBe(20)

    const unfilteredEngine = new LoopScoringEngine({ chart })
    const unfilteredEvents = unfilteredEngine.evaluate({
      evaluatedAtMs: 1020,
      pitchCents: 3300,
    })
    expect(unfilteredEvents).toHaveLength(1)
    expect(unfilteredEvents[0].note?.id).toBe('a-note')
    expect(unfilteredEvents[0].timingErrorMs).toBe(0)
  })

  it('setChart replaces notes and reset restarts loop progress for the current chart', () => {
    const firstChart: LoopScoringChart = BASE_CHART
    const secondChart: LoopScoringChart = {
      loopDurationMs: 1500,
      notes: [
        {
          id: 'second-a-note',
          lane: 'A',
          timeMs: 500,
          durationMs: 100,
          fret: 0,
        },
      ],
    }

    const engine = new LoopScoringEngine({ chart: firstChart })
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

    engine.setChart(secondChart)
    expect(engine.getStats()).toEqual({
      perfect: 0,
      good: 0,
      miss: 0,
      total: 0,
      accuracy: 0,
    })

    const noMatchOnOldLane = engine.evaluate({
      evaluatedAtMs: 500,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(noMatchOnOldLane).toEqual([])

    const firstOnNewChart = engine.evaluate({
      evaluatedAtMs: 500,
      pitchCents: 3300,
      lane: 'A',
    })
    expect(firstOnNewChart).toHaveLength(1)
    expect(firstOnNewChart[0].note?.id).toBe('second-a-note')
    expect(firstOnNewChart[0].note?.loopIndex).toBe(0)

    engine.reset()
    expect(engine.getStats().total).toBe(0)

    const afterReset = engine.evaluate({
      evaluatedAtMs: 500,
      pitchCents: 3300,
      lane: 'A',
    })
    expect(afterReset).toHaveLength(1)
    expect(afterReset[0].note?.id).toBe('second-a-note')
    expect(afterReset[0].note?.loopIndex).toBe(0)
  })
})
