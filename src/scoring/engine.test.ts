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
  it('throws for invalid chart.loopDurationMs values', () => {
    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: 0,
            notes: [],
          },
        }),
    ).toThrow('loopDurationMs must be > 0.')

    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: Number.NaN,
            notes: [],
          },
        }),
    ).toThrow('loopDurationMs must be a finite number.')
  })

  it('throws for invalid note definitions during chart normalization', () => {
    const invalidLaneChart = {
      loopDurationMs: 2000,
      notes: [
        {
          lane: 'B',
          timeMs: 1000,
          durationMs: 100,
          fret: 0,
        },
      ],
    } as unknown as LoopScoringChart
    expect(() => new LoopScoringEngine({ chart: invalidLaneChart })).toThrow(
      'notes[0].lane is invalid: B',
    )

    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: 2000,
            notes: [
              {
                lane: 'E',
                timeMs: 1000,
                durationMs: -1,
                fret: 0,
              },
            ],
          },
        }),
    ).toThrow('notes[0].durationMs must be >= 0.')

    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: 2000,
            notes: [
              {
                lane: 'E',
                timeMs: 1000,
                targetMidiNote: Number.NaN,
              },
            ],
          },
        }),
    ).toThrow('notes[0].targetMidiNote must be a finite number.')

    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: 2000,
            notes: [
              {
                lane: 'E',
                timeMs: 1000,
                targetCents: Number.NaN,
              },
            ],
          },
        }),
    ).toThrow('notes[0].targetCents must be a finite number.')

    expect(
      () =>
        new LoopScoringEngine({
          chart: {
            loopDurationMs: 2000,
            notes: [
              {
                lane: 'E',
                timeMs: 1000,
              },
            ],
          },
        }),
    ).toThrow('notes[0] requires either targetCents, targetMidiNote, or fret to resolve pitch.')
  })

  it('returns no events when no candidate is in timing window and no auto-miss is due', () => {
    const engine = createEngine()

    const events = engine.evaluate({
      evaluatedAtMs: 0,
      pitchCents: 2800,
      lane: 'E',
    })

    expect(events).toEqual([])
    expect(engine.getStats()).toEqual({
      perfect: 0,
      good: 0,
      miss: 0,
      total: 0,
      accuracy: 0,
    })
  })

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

  it('updates config via updateConfig and getConfig returns a defensive copy', () => {
    const engine = createEngine()

    const initialConfig = engine.getConfig()
    initialConfig.timingWindowMs = 1
    expect(engine.getConfig().timingWindowMs).toBe(80)

    engine.updateConfig({
      timingWindowMs: 20,
      perfectTimingWindowMs: 8,
      pitchWindowCents: 12,
      perfectPitchWindowCents: 4,
    })

    expect(engine.getConfig()).toEqual({
      timingWindowMs: 20,
      perfectTimingWindowMs: 8,
      pitchWindowCents: 12,
      perfectPitchWindowCents: 4,
      latencyOffsetMs: 0,
    })

    const noCandidate = engine.evaluate({
      evaluatedAtMs: 900,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(noCandidate).toEqual([])

    const goodEvents = engine.evaluate({
      evaluatedAtMs: 1015,
      pitchCents: 2808,
      lane: 'E',
    })
    expect(goodEvents).toHaveLength(1)
    expect(goodEvents[0]).toMatchObject({
      judgement: 'Good',
      reason: 'good-window',
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

  it('throws for non-finite evaluatedAtMs input values', () => {
    const engine = createEngine()

    expect(() =>
      engine.evaluate({
        evaluatedAtMs: Number.NaN,
        pitchCents: 2800,
        lane: 'E',
      }),
    ).toThrow('evaluatedAtMs must be a finite number.')

    expect(() => engine.advance(Number.POSITIVE_INFINITY)).toThrow(
      'evaluatedAtMs must be a finite number.',
    )
  })

  it('normalizes wrapped note time and resolves target pitch from targetMidiNote/targetCents', () => {
    const targetMidiChart: LoopScoringChart = {
      loopDurationMs: 2000,
      notes: [
        {
          id: '',
          lane: 'E',
          timeMs: -10,
          targetMidiNote: 28,
        },
      ],
    }

    const targetMidiEngine = new LoopScoringEngine({ chart: targetMidiChart })
    const targetMidiEvents = targetMidiEngine.evaluate({
      evaluatedAtMs: 1990,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(targetMidiEvents).toHaveLength(1)
    expect(targetMidiEvents[0].note).toMatchObject({
      id: 'note-0',
      lane: 'E',
      fret: null,
      timeMs: 1990,
      durationMs: 0,
      targetMidiNote: 28,
      targetCents: 2800,
    })

    const targetCentsChart: LoopScoringChart = {
      loopDurationMs: 2000,
      notes: [
        {
          lane: 'A',
          timeMs: 500,
          targetCents: 3300,
        },
      ],
    }

    const targetCentsEngine = new LoopScoringEngine({ chart: targetCentsChart })
    const targetCentsEvents = targetCentsEngine.evaluate({
      evaluatedAtMs: 500,
      pitchCents: 3300,
      lane: 'A',
    })
    expect(targetCentsEvents).toHaveLength(1)
    expect(targetCentsEvents[0].note).toMatchObject({
      lane: 'A',
      fret: null,
      durationMs: 0,
      targetMidiNote: 33,
      targetCents: 3300,
    })
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

  it('keeps the current best candidate when next candidate has larger abs timing error', () => {
    const chart: LoopScoringChart = {
      loopDurationMs: 2000,
      notes: [
        {
          id: 'near',
          lane: 'E',
          timeMs: 1000,
          durationMs: 120,
          fret: 0,
        },
        {
          id: 'far',
          lane: 'A',
          timeMs: 1030,
          durationMs: 120,
          fret: 0,
        },
      ],
    }

    const engine = new LoopScoringEngine({ chart })
    const events = engine.evaluate({
      evaluatedAtMs: 1010,
      pitchCents: 2800,
    })

    expect(events).toHaveLength(1)
    expect(events[0].note?.id).toBe('near')
    expect(events[0].timingErrorMs).toBe(10)
  })

  it('prefers earlier occurrence time when abs timing errors are equal', () => {
    const chart: LoopScoringChart = {
      loopDurationMs: 1000,
      notes: [
        {
          id: 'e-late-loop',
          lane: 'E',
          timeMs: 100,
          durationMs: 120,
          fret: 0,
        },
        {
          id: 'a-early-loop',
          lane: 'A',
          timeMs: 700,
          durationMs: 120,
          fret: 0,
        },
      ],
    }

    const engine = new LoopScoringEngine({
      chart,
      config: {
        timingWindowMs: 300,
        perfectTimingWindowMs: 40,
      },
    })

    const first = engine.evaluate({
      evaluatedAtMs: 100,
      pitchCents: 2800,
      lane: 'E',
    })
    expect(first).toHaveLength(1)
    expect(first[0].note?.id).toBe('e-late-loop')
    expect(first[0].note?.loopIndex).toBe(0)

    const second = engine.evaluate({
      evaluatedAtMs: 900,
      pitchCents: 3300,
    })
    expect(second).toHaveLength(1)
    expect(second[0].note?.id).toBe('a-early-loop')
    expect(second[0].note?.occurrenceTimeMs).toBe(700)
    expect(second[0].timingErrorMs).toBe(200)
  })

  it('keeps source order when wrapped note times are equal', () => {
    const chart: LoopScoringChart = {
      loopDurationMs: 2000,
      notes: [
        {
          id: 'first-source',
          lane: 'E',
          timeMs: 2100,
          targetMidiNote: 28,
        },
        {
          id: 'second-source',
          lane: 'E',
          timeMs: 100,
          targetMidiNote: 33,
        },
      ],
    }

    const engine = new LoopScoringEngine({ chart })
    const events = engine.evaluate({
      evaluatedAtMs: 100,
      pitchCents: 2800,
      lane: 'E',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      judgement: 'Perfect',
      reason: 'perfect-window',
    })
    expect(events[0].note?.id).toBe('first-source')
    expect(events[0].note?.timeMs).toBe(100)
  })

  it('falls back to timing-window miss when internal targetCents becomes invalid', () => {
    const engine = createEngine()
    ;(
      engine as unknown as {
        chart: {
          notes: Array<{
            targetCents: number
          }>
        }
      }
    ).chart.notes[0].targetCents = Number.NaN

    const events = engine.evaluate({
      evaluatedAtMs: 1000,
      pitchCents: 2800,
      lane: 'E',
    })

    expect(events).toHaveLength(1)
    expect(events[0].judgement).toBe('Miss')
    expect(events[0].reason).toBe('timing-window')
    expect(Number.isNaN(events[0].pitchErrorCents)).toBe(true)
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
