import type { ChartData } from './types'

export type { BassLane, ChartData, ChartNote, LaneChart } from './types'
export {
  DEFAULT_OPEN_STRING_MIDI_BY_LANE,
  convertSmfTrackToLaneChart,
  createChartDataFromSmfTrackLaneChart,
  deriveLoopDurationMs,
  listSmfTracks,
  parseSmfFromArrayBuffer,
} from './midi'
export type {
  ConvertSmfTrackToLaneChartOptions,
  ConvertSmfTrackToLaneChartResult,
  MidiChartError,
  MidiChartErrorCode,
  MidiChartResult,
  OpenStringMidiByLane,
  ParseSmfResult,
  ParsedSmf,
  ParsedSmfTrack,
  ParsedSmfTrackNote,
  PartialOpenStringMidiByLane,
  SmfTrackLaneChart,
  SmfTrackSummary,
} from './midi'

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
