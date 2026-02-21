import { describe, expect, it } from 'vitest'
import {
  createLoopScoringChartFromChartData,
  createLoopScoringChartFromLaneScrollerChart,
} from './adapters'

describe('createLoopScoringChartFromChartData', () => {
  it('derives loop duration from max note end time and maps pitch targets', () => {
    const chart = createLoopScoringChartFromChartData({
      notes: [
        { lane: 'E', fret: 0, timeMs: 100, durationMs: 50 },
        { lane: 'A', fret: 2, timeMs: 400, durationMs: 120 },
      ],
    })

    expect(chart.loopDurationMs).toBe(520)
    expect(chart.notes).toEqual([
      {
        id: 'chart-0',
        lane: 'E',
        fret: 0,
        timeMs: 100,
        durationMs: 50,
        targetMidiNote: 28,
        targetCents: 2800,
      },
      {
        id: 'chart-1',
        lane: 'A',
        fret: 2,
        timeMs: 400,
        durationMs: 120,
        targetMidiNote: 35,
        targetCents: 3500,
      },
    ])
  })

  it('uses explicit loop duration and open-string overrides when provided', () => {
    const chart = createLoopScoringChartFromChartData(
      {
        notes: [{ lane: 'E', fret: 1, timeMs: 0, durationMs: 100 }],
      },
      {
        loopDurationMs: 2000,
        openStringMidiByLane: { E: 40 },
      },
    )

    expect(chart.loopDurationMs).toBe(2000)
    expect(chart.notes[0]).toMatchObject({
      id: 'chart-0',
      targetMidiNote: 41,
      targetCents: 4100,
    })
  })

  it('throws when chart notes include invalid timing data', () => {
    expect(() =>
      createLoopScoringChartFromChartData({
        notes: [{ lane: 'E', fret: 0, timeMs: Number.NaN, durationMs: 100 }],
      }),
    ).toThrow('notes[0].timeMs must be a finite number.')

    expect(() =>
      createLoopScoringChartFromChartData({
        notes: [{ lane: 'E', fret: 0, timeMs: 0, durationMs: -1 }],
      }),
    ).toThrow('notes[0].durationMs must be >= 0.')
  })

  it('throws when explicit loop duration is not positive', () => {
    expect(() =>
      createLoopScoringChartFromChartData(
        {
          notes: [{ lane: 'E', fret: 0, timeMs: 0, durationMs: 100 }],
        },
        { loopDurationMs: 0 },
      ),
    ).toThrow('loopDurationMs must be > 0.')
  })
})

describe('createLoopScoringChartFromLaneScrollerChart', () => {
  it('maps lane scroller notes with target pitch metadata', () => {
    const chart = createLoopScoringChartFromLaneScrollerChart(
      {
        loopDurationMs: 1800,
        notes: [
          { lane: 'D', fret: 3, timeMs: 250, durationMs: 100 },
          { lane: 'G', fret: 0, timeMs: 600, durationMs: 120 },
        ],
      },
      { openStringMidiByLane: { D: 40 } },
    )

    expect(chart.loopDurationMs).toBe(1800)
    expect(chart.notes).toEqual([
      {
        id: 'lane-0',
        lane: 'D',
        fret: 3,
        timeMs: 250,
        durationMs: 100,
        targetMidiNote: 43,
        targetCents: 4300,
      },
      {
        id: 'lane-1',
        lane: 'G',
        fret: 0,
        timeMs: 600,
        durationMs: 120,
        targetMidiNote: 43,
        targetCents: 4300,
      },
    ])
  })

  it('throws when fret is missing or non-finite', () => {
    expect(() =>
      createLoopScoringChartFromLaneScrollerChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'E', timeMs: 100, durationMs: 50 }],
      }),
    ).toThrow('notes[0].fret is required for scoring.')

    expect(() =>
      createLoopScoringChartFromLaneScrollerChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'E', fret: Number.NaN, timeMs: 100, durationMs: 50 }],
      }),
    ).toThrow('notes[0].fret is required for scoring.')
  })

  it('throws when loop duration or note timing values are invalid', () => {
    expect(() =>
      createLoopScoringChartFromLaneScrollerChart({
        loopDurationMs: 0,
        notes: [{ lane: 'E', fret: 0, timeMs: 0, durationMs: 50 }],
      }),
    ).toThrow('loopDurationMs must be > 0.')

    expect(() =>
      createLoopScoringChartFromLaneScrollerChart({
        loopDurationMs: 1000,
        notes: [{ lane: 'E', fret: 0, timeMs: 0, durationMs: -10 }],
      }),
    ).toThrow('notes[0].durationMs must be >= 0.')
  })
})
