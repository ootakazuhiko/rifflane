export type BassLane = 'E' | 'A' | 'D' | 'G'

export interface ChartNote {
  lane: BassLane
  fret: number
  timeMs: number
  durationMs: number
}

export interface ChartData {
  bpm: number
  notes: ChartNote[]
}

export interface LaneChart {
  loopDurationMs: number
  notes: ChartNote[]
}
