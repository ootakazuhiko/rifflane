export type ScoringLane = 'E' | 'A' | 'D' | 'G'

export type ScoringJudgement = 'Perfect' | 'Good' | 'Miss'

export type ScoringEventSource = 'input' | 'auto-miss'

export type ScoringEventReason =
  | 'perfect-window'
  | 'good-window'
  | 'pitch-window'
  | 'timing-window'
  | 'pitch-missing'
  | 'auto-miss'

export interface ScoringConfig {
  timingWindowMs: number
  pitchWindowCents: number
  latencyOffsetMs: number
  perfectTimingWindowMs: number
  perfectPitchWindowCents: number
}

export interface LoopScoringNote {
  id?: string
  lane: ScoringLane
  timeMs: number
  durationMs?: number
  fret?: number
  targetMidiNote?: number
  targetCents?: number
}

export interface LoopScoringChart {
  loopDurationMs: number
  notes: readonly LoopScoringNote[]
}

export interface ScoringInput {
  evaluatedAtMs: number
  pitchCents: number | null
  lane?: ScoringLane | null
}

export interface ScoringEventNote {
  id: string
  lane: ScoringLane
  fret: number | null
  timeMs: number
  durationMs: number
  targetMidiNote: number
  targetCents: number
  loopIndex: number
  occurrenceTimeMs: number
}

export interface ScoringEvent {
  judgement: ScoringJudgement
  source: ScoringEventSource
  reason: ScoringEventReason
  evaluatedAtMs: number
  adjustedTimeMs: number
  timingErrorMs: number | null
  pitchErrorCents: number | null
  note: ScoringEventNote | null
}

export interface ScoringStats {
  perfect: number
  good: number
  miss: number
  total: number
  accuracy: number
}

export interface OpenStringMidiByLane {
  E: number
  A: number
  D: number
  G: number
}

export type PartialOpenStringMidiByLane = Partial<OpenStringMidiByLane>

export const DEFAULT_OPEN_STRING_MIDI_BY_LANE: Readonly<OpenStringMidiByLane> = Object.freeze({
  E: 28,
  A: 33,
  D: 38,
  G: 43,
})

export interface LoopScoringEngineOptions {
  chart: LoopScoringChart
  config?: Partial<ScoringConfig>
  openStringMidiByLane?: PartialOpenStringMidiByLane
}

export interface ChartDataLikeNote {
  lane: ScoringLane
  fret: number
  timeMs: number
  durationMs: number
}

export interface ChartDataLike {
  notes: readonly ChartDataLikeNote[]
}

export interface LaneScrollerLikeNote {
  lane: ScoringLane
  timeMs: number
  durationMs: number
  fret?: number
}

export interface LaneScrollerLikeChart {
  loopDurationMs: number
  notes: readonly LaneScrollerLikeNote[]
}

export interface ChartDataAdapterOptions {
  loopDurationMs?: number
  openStringMidiByLane?: PartialOpenStringMidiByLane
}

export interface LaneScrollerAdapterOptions {
  openStringMidiByLane?: PartialOpenStringMidiByLane
}
