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

export function createDummyChart(): ChartData {
  return {
    bpm: 100,
    notes: [
      { lane: 'E', fret: 0, timeMs: 0, durationMs: 500 },
      { lane: 'A', fret: 2, timeMs: 600, durationMs: 500 },
      { lane: 'D', fret: 2, timeMs: 1200, durationMs: 500 },
      { lane: 'G', fret: 4, timeMs: 1800, durationMs: 500 },
    ],
  }
}
