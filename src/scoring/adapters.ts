import { resolveOpenStringMidiByLane, toCentsFromMidiNote, toMidiNoteFromLaneAndFret } from './pitch'
import type {
  ChartDataAdapterOptions,
  ChartDataLike,
  LaneScrollerAdapterOptions,
  LaneScrollerLikeChart,
  LoopScoringChart,
} from './types'

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

function assertFiniteNonNegative(value: number, label: string): number {
  const normalized = assertFiniteNumber(value, label)
  if (normalized < 0) {
    throw new Error(`${label} must be >= 0.`)
  }
  return normalized
}

function deriveLoopDurationMs(chart: ChartDataLike): number {
  const maxEndTimeMs = chart.notes.reduce((maxValue, note, index) => {
    const timeMs = assertFiniteNumber(note.timeMs, `notes[${index}].timeMs`)
    const durationMs = assertFiniteNonNegative(note.durationMs, `notes[${index}].durationMs`)
    return Math.max(maxValue, timeMs + durationMs)
  }, 0)

  return Math.max(1, maxEndTimeMs)
}

export function createLoopScoringChartFromChartData(
  chart: ChartDataLike,
  options: ChartDataAdapterOptions = {},
): LoopScoringChart {
  const openStringMidiByLane = resolveOpenStringMidiByLane(options.openStringMidiByLane)
  const loopDurationMs =
    options.loopDurationMs === undefined
      ? deriveLoopDurationMs(chart)
      : assertFinitePositive(options.loopDurationMs, 'loopDurationMs')

  return {
    loopDurationMs,
    notes: chart.notes.map((note, index) => {
      const timeMs = assertFiniteNumber(note.timeMs, `notes[${index}].timeMs`)
      const durationMs = assertFiniteNonNegative(note.durationMs, `notes[${index}].durationMs`)
      const fret = assertFiniteNumber(note.fret, `notes[${index}].fret`)
      const targetMidiNote = toMidiNoteFromLaneAndFret(note.lane, fret, openStringMidiByLane)
      return {
        id: `chart-${index}`,
        lane: note.lane,
        fret,
        timeMs,
        durationMs,
        targetMidiNote,
        targetCents: toCentsFromMidiNote(targetMidiNote),
      }
    }),
  }
}

export function createLoopScoringChartFromLaneScrollerChart(
  chart: LaneScrollerLikeChart,
  options: LaneScrollerAdapterOptions = {},
): LoopScoringChart {
  const openStringMidiByLane = resolveOpenStringMidiByLane(options.openStringMidiByLane)
  const loopDurationMs = assertFinitePositive(chart.loopDurationMs, 'loopDurationMs')

  return {
    loopDurationMs,
    notes: chart.notes.map((note, index) => {
      const timeMs = assertFiniteNumber(note.timeMs, `notes[${index}].timeMs`)
      const durationMs = assertFiniteNonNegative(note.durationMs, `notes[${index}].durationMs`)
      const rawFret = note.fret
      if (typeof rawFret !== 'number' || !Number.isFinite(rawFret)) {
        throw new Error(`notes[${index}].fret is required for scoring.`)
      }
      const fret = rawFret
      const targetMidiNote = toMidiNoteFromLaneAndFret(note.lane, fret, openStringMidiByLane)
      return {
        id: `lane-${index}`,
        lane: note.lane,
        fret,
        timeMs,
        durationMs,
        targetMidiNote,
        targetCents: toCentsFromMidiNote(targetMidiNote),
      }
    }),
  }
}
