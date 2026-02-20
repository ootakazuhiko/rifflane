import { createScoringConfig } from './config'
import { resolveOpenStringMidiByLane, toCentsFromMidiNote, toMidiNoteFromLaneAndFret } from './pitch'
import type {
  LoopScoringChart,
  LoopScoringEngineOptions,
  OpenStringMidiByLane,
  ScoringConfig,
  ScoringEvent,
  ScoringEventNote,
  ScoringInput,
  ScoringJudgement,
  ScoringLane,
  ScoringStats,
} from './types'

const GOOD_ACCURACY_WEIGHT = 0.5
const LANE_NAME_SET = new Set<ScoringLane>(['E', 'A', 'D', 'G'])

interface InternalNote {
  id: string
  lane: ScoringLane
  timeMs: number
  durationMs: number
  fret: number | null
  targetMidiNote: number
  targetCents: number
  sourceOrder: number
}

interface NormalizedChart {
  loopDurationMs: number
  notes: InternalNote[]
}

interface Candidate {
  noteIndex: number
  loopIndex: number
  occurrenceTimeMs: number
  timingErrorMs: number
  absTimingErrorMs: number
}

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

function wrapTimeMs(timeMs: number, loopDurationMs: number): number {
  const wrapped = timeMs % loopDurationMs
  return wrapped < 0 ? wrapped + loopDurationMs : wrapped
}

function isScoringLane(value: string): value is ScoringLane {
  return LANE_NAME_SET.has(value as ScoringLane)
}

function normalizeChart(
  chart: LoopScoringChart,
  openStringMidiByLane: OpenStringMidiByLane,
): NormalizedChart {
  const loopDurationMs = assertFinitePositive(chart.loopDurationMs, 'loopDurationMs')

  const notes = chart.notes.map((rawNote, index) => {
    if (!isScoringLane(rawNote.lane)) {
      throw new Error(`notes[${index}].lane is invalid: ${String(rawNote.lane)}`)
    }

    const timeMs = wrapTimeMs(assertFiniteNumber(rawNote.timeMs, `notes[${index}].timeMs`), loopDurationMs)
    const durationMs = assertFiniteNonNegative(rawNote.durationMs ?? 0, `notes[${index}].durationMs`)
    const fret =
      rawNote.fret === undefined || rawNote.fret === null
        ? null
        : assertFiniteNumber(rawNote.fret, `notes[${index}].fret`)

    let targetMidiNote: number | null = null
    if (rawNote.targetMidiNote !== undefined) {
      targetMidiNote = assertFiniteNumber(rawNote.targetMidiNote, `notes[${index}].targetMidiNote`)
    } else if (fret !== null) {
      targetMidiNote = toMidiNoteFromLaneAndFret(rawNote.lane, fret, openStringMidiByLane)
    }

    let targetCents: number | null = null
    if (rawNote.targetCents !== undefined) {
      targetCents = assertFiniteNumber(rawNote.targetCents, `notes[${index}].targetCents`)
    } else if (targetMidiNote !== null) {
      targetCents = toCentsFromMidiNote(targetMidiNote)
    }

    if (targetCents === null) {
      throw new Error(
        `notes[${index}] requires either targetCents, targetMidiNote, or fret to resolve pitch.`,
      )
    }
    if (targetMidiNote === null) {
      targetMidiNote = targetCents / 100
    }

    return {
      id:
        typeof rawNote.id === 'string' && rawNote.id.trim().length > 0
          ? rawNote.id
          : `note-${index}`,
      lane: rawNote.lane,
      timeMs,
      durationMs,
      fret,
      targetMidiNote,
      targetCents,
      sourceOrder: index,
    }
  })

  notes.sort((left, right) => {
    if (left.timeMs !== right.timeMs) {
      return left.timeMs - right.timeMs
    }
    return left.sourceOrder - right.sourceOrder
  })

  return {
    loopDurationMs,
    notes,
  }
}

export class LoopScoringEngine {
  private chart: NormalizedChart
  private readonly openStringMidiByLane: OpenStringMidiByLane
  private config: ScoringConfig
  private nextLoopIndexByNote: number[]
  private perfectCount = 0
  private goodCount = 0
  private missCount = 0

  public constructor(options: LoopScoringEngineOptions) {
    this.openStringMidiByLane = resolveOpenStringMidiByLane(options.openStringMidiByLane)
    this.config = createScoringConfig(options.config)
    this.chart = normalizeChart(options.chart, this.openStringMidiByLane)
    this.nextLoopIndexByNote = new Array(this.chart.notes.length).fill(0)
  }

  public evaluate(input: ScoringInput): ScoringEvent[] {
    const evaluatedAtMs = assertFiniteNumber(input.evaluatedAtMs, 'evaluatedAtMs')
    const adjustedTimeMs = this.applyLatencyOffset(evaluatedAtMs)
    const events = this.collectAutoMisses(evaluatedAtMs, adjustedTimeMs)
    const candidate = this.findBestCandidate(adjustedTimeMs, input.lane ?? null)
    if (!candidate) {
      return events
    }

    const note = this.chart.notes[candidate.noteIndex]
    this.nextLoopIndexByNote[candidate.noteIndex] = candidate.loopIndex + 1

    const pitchCents = input.pitchCents
    if (typeof pitchCents !== 'number' || !Number.isFinite(pitchCents)) {
      const missEvent = this.createEvent({
        judgement: 'Miss',
        source: 'input',
        reason: 'pitch-missing',
        evaluatedAtMs,
        adjustedTimeMs,
        timingErrorMs: candidate.timingErrorMs,
        pitchErrorCents: null,
        note,
        loopIndex: candidate.loopIndex,
        occurrenceTimeMs: candidate.occurrenceTimeMs,
      })
      this.registerJudgement(missEvent.judgement)
      events.push(missEvent)
      return events
    }

    const pitchErrorCents = pitchCents - note.targetCents
    const absPitchErrorCents = Math.abs(pitchErrorCents)
    const absTimingErrorMs = candidate.absTimingErrorMs

    let judgement: ScoringJudgement
    let reason: ScoringEvent['reason']

    if (
      absTimingErrorMs <= this.config.perfectTimingWindowMs &&
      absPitchErrorCents <= this.config.perfectPitchWindowCents
    ) {
      judgement = 'Perfect'
      reason = 'perfect-window'
    } else if (
      absTimingErrorMs <= this.config.timingWindowMs &&
      absPitchErrorCents <= this.config.pitchWindowCents
    ) {
      judgement = 'Good'
      reason = 'good-window'
    } else if (absPitchErrorCents > this.config.pitchWindowCents) {
      judgement = 'Miss'
      reason = 'pitch-window'
    } else {
      judgement = 'Miss'
      reason = 'timing-window'
    }

    const event = this.createEvent({
      judgement,
      source: 'input',
      reason,
      evaluatedAtMs,
      adjustedTimeMs,
      timingErrorMs: candidate.timingErrorMs,
      pitchErrorCents,
      note,
      loopIndex: candidate.loopIndex,
      occurrenceTimeMs: candidate.occurrenceTimeMs,
    })
    this.registerJudgement(judgement)
    events.push(event)
    return events
  }

  public advance(evaluatedAtMs: number): ScoringEvent[] {
    const normalizedEvaluatedAtMs = assertFiniteNumber(evaluatedAtMs, 'evaluatedAtMs')
    const adjustedTimeMs = this.applyLatencyOffset(normalizedEvaluatedAtMs)
    return this.collectAutoMisses(normalizedEvaluatedAtMs, adjustedTimeMs)
  }

  public setChart(chart: LoopScoringChart): void {
    this.chart = normalizeChart(chart, this.openStringMidiByLane)
    this.nextLoopIndexByNote = new Array(this.chart.notes.length).fill(0)
    this.resetStats()
  }

  public getConfig(): ScoringConfig {
    return { ...this.config }
  }

  public updateConfig(overrides: Partial<ScoringConfig>): void {
    this.config = createScoringConfig({
      ...this.config,
      ...overrides,
    })
  }

  public setLatencyOffsetMs(offsetMs: number): void {
    this.config = createScoringConfig({
      ...this.config,
      latencyOffsetMs: offsetMs,
    })
  }

  public getLatencyOffsetMs(): number {
    return this.config.latencyOffsetMs
  }

  public getStats(): ScoringStats {
    const total = this.perfectCount + this.goodCount + this.missCount
    return {
      perfect: this.perfectCount,
      good: this.goodCount,
      miss: this.missCount,
      total,
      accuracy: total === 0 ? 0 : (this.perfectCount + this.goodCount * GOOD_ACCURACY_WEIGHT) / total,
    }
  }

  public resetStats(): void {
    this.perfectCount = 0
    this.goodCount = 0
    this.missCount = 0
  }

  public reset(): void {
    this.resetStats()
    this.nextLoopIndexByNote.fill(0)
  }

  private applyLatencyOffset(evaluatedAtMs: number): number {
    return evaluatedAtMs + this.config.latencyOffsetMs
  }

  private getOccurrenceTimeMs(note: InternalNote, loopIndex: number): number {
    return note.timeMs + this.chart.loopDurationMs * loopIndex
  }

  private collectAutoMisses(evaluatedAtMs: number, adjustedTimeMs: number): ScoringEvent[] {
    const events: ScoringEvent[] = []
    const missThresholdTimeMs = adjustedTimeMs - this.config.timingWindowMs

    for (let index = 0; index < this.chart.notes.length; index += 1) {
      const note = this.chart.notes[index]
      const nextLoopIndex = this.nextLoopIndexByNote[index]
      const firstOccurrenceTimeMs = this.getOccurrenceTimeMs(note, nextLoopIndex)

      if (firstOccurrenceTimeMs > missThresholdTimeMs) {
        continue
      }

      const loopCountToMiss =
        Math.floor((missThresholdTimeMs - firstOccurrenceTimeMs) / this.chart.loopDurationMs) + 1

      for (let offset = 0; offset < loopCountToMiss; offset += 1) {
        const loopIndex = nextLoopIndex + offset
        const occurrenceTimeMs = this.getOccurrenceTimeMs(note, loopIndex)
        const event = this.createEvent({
          judgement: 'Miss',
          source: 'auto-miss',
          reason: 'auto-miss',
          evaluatedAtMs,
          adjustedTimeMs,
          timingErrorMs: adjustedTimeMs - occurrenceTimeMs,
          pitchErrorCents: null,
          note,
          loopIndex,
          occurrenceTimeMs,
        })
        events.push(event)
        this.registerJudgement(event.judgement)
      }

      this.nextLoopIndexByNote[index] = nextLoopIndex + loopCountToMiss
    }

    return events
  }

  private findBestCandidate(adjustedTimeMs: number, laneFilter: ScoringLane | null): Candidate | null {
    let best: Candidate | null = null

    for (let index = 0; index < this.chart.notes.length; index += 1) {
      const note = this.chart.notes[index]
      if (laneFilter !== null && note.lane !== laneFilter) {
        continue
      }

      const loopIndex = this.nextLoopIndexByNote[index]
      const occurrenceTimeMs = this.getOccurrenceTimeMs(note, loopIndex)
      const timingErrorMs = adjustedTimeMs - occurrenceTimeMs
      const absTimingErrorMs = Math.abs(timingErrorMs)

      if (absTimingErrorMs > this.config.timingWindowMs) {
        continue
      }

      if (!best) {
        best = {
          noteIndex: index,
          loopIndex,
          occurrenceTimeMs,
          timingErrorMs,
          absTimingErrorMs,
        }
        continue
      }

      if (absTimingErrorMs < best.absTimingErrorMs) {
        best = {
          noteIndex: index,
          loopIndex,
          occurrenceTimeMs,
          timingErrorMs,
          absTimingErrorMs,
        }
        continue
      }

      if (absTimingErrorMs > best.absTimingErrorMs) {
        continue
      }

      if (occurrenceTimeMs < best.occurrenceTimeMs) {
        best = {
          noteIndex: index,
          loopIndex,
          occurrenceTimeMs,
          timingErrorMs,
          absTimingErrorMs,
        }
        continue
      }

      if (
        occurrenceTimeMs === best.occurrenceTimeMs &&
        note.sourceOrder < this.chart.notes[best.noteIndex].sourceOrder
      ) {
        best = {
          noteIndex: index,
          loopIndex,
          occurrenceTimeMs,
          timingErrorMs,
          absTimingErrorMs,
        }
      }
    }

    return best
  }

  private createEvent(params: {
    judgement: ScoringJudgement
    source: ScoringEvent['source']
    reason: ScoringEvent['reason']
    evaluatedAtMs: number
    adjustedTimeMs: number
    timingErrorMs: number | null
    pitchErrorCents: number | null
    note: InternalNote
    loopIndex: number
    occurrenceTimeMs: number
  }): ScoringEvent {
    return {
      judgement: params.judgement,
      source: params.source,
      reason: params.reason,
      evaluatedAtMs: params.evaluatedAtMs,
      adjustedTimeMs: params.adjustedTimeMs,
      timingErrorMs: params.timingErrorMs,
      pitchErrorCents: params.pitchErrorCents,
      note: this.createEventNote(params.note, params.loopIndex, params.occurrenceTimeMs),
    }
  }

  private createEventNote(
    note: InternalNote,
    loopIndex: number,
    occurrenceTimeMs: number,
  ): ScoringEventNote {
    return {
      id: note.id,
      lane: note.lane,
      fret: note.fret,
      timeMs: note.timeMs,
      durationMs: note.durationMs,
      targetMidiNote: note.targetMidiNote,
      targetCents: note.targetCents,
      loopIndex,
      occurrenceTimeMs,
    }
  }

  private registerJudgement(judgement: ScoringJudgement): void {
    if (judgement === 'Perfect') {
      this.perfectCount += 1
      return
    }
    if (judgement === 'Good') {
      this.goodCount += 1
      return
    }
    this.missCount += 1
  }
}
