import { Midi } from '@tonejs/midi'
import type { BassLane, ChartData, ChartNote, LaneChart } from './types'

const DEFAULT_BPM = 120
const BASS_LANE_ORDER = ['E', 'A', 'D', 'G'] as const
const LANE_ORDER_INDEX: Readonly<Record<BassLane, number>> = Object.freeze({
  E: 0,
  A: 1,
  D: 2,
  G: 3,
})

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

export interface SmfTrackSummary {
  index: number
  name: string
  noteCount: number
}

export interface ParsedSmfTrackNote {
  midi: number
  timeMs: number
  durationMs: number
}

export interface ParsedSmfTrack extends SmfTrackSummary {
  notes: readonly ParsedSmfTrackNote[]
}

export interface ParsedSmf {
  bpm: number
  tracks: readonly ParsedSmfTrack[]
}

export type MidiChartErrorCode =
  | 'SMF_PARSE_FAILED'
  | 'INVALID_OPTIONS'
  | 'TRACK_NOT_FOUND'
  | 'NOTE_OUT_OF_RANGE'

export interface MidiChartError {
  code: MidiChartErrorCode
  message: string
}

export type MidiChartResult<T> = { ok: true; value: T } | { ok: false; error: MidiChartError }

export type ParseSmfResult = MidiChartResult<ParsedSmf>

export interface ConvertSmfTrackToLaneChartOptions {
  openStringMidiByLane?: PartialOpenStringMidiByLane
  maxFret?: number
}

export interface SmfTrackLaneChart extends LaneChart {
  bpm: number
  track: SmfTrackSummary
}

export type ConvertSmfTrackToLaneChartResult = MidiChartResult<SmfTrackLaneChart>

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'Unknown error.'
}

function createFailure<T>(code: MidiChartErrorCode, message: string): MidiChartResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  }
}

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function normalizeMidiNote(midiNote: number, trackIndex: number, noteIndex: number): number {
  assertFiniteNumber(midiNote, `tracks[${trackIndex}].notes[${noteIndex}].midi`)
  const normalized = Math.round(midiNote)
  if (normalized < 0 || normalized > 127) {
    throw new Error(`tracks[${trackIndex}].notes[${noteIndex}].midi must be in the 0-127 range.`)
  }
  return normalized
}

function secondsToMs(seconds: number, label: string): number {
  assertFiniteNumber(seconds, label)
  if (seconds <= 0) {
    return 0
  }
  return Math.round(seconds * 1000)
}

function normalizeTrackName(name: string, index: number): string {
  const trimmed = name.trim()
  if (trimmed.length > 0) {
    return trimmed
  }
  return `Track ${index + 1}`
}

function deriveBpm(midi: Midi): number {
  const firstTempoBpm = midi.header.tempos.at(0)?.bpm
  if (typeof firstTempoBpm === 'number' && Number.isFinite(firstTempoBpm) && firstTempoBpm > 0) {
    return firstTempoBpm
  }
  return DEFAULT_BPM
}

function compareParsedNotes(left: ParsedSmfTrackNote, right: ParsedSmfTrackNote): number {
  return left.timeMs - right.timeMs || left.durationMs - right.durationMs || left.midi - right.midi
}

function compareChartNotes(left: ChartNote, right: ChartNote): number {
  return (
    left.timeMs - right.timeMs ||
    left.durationMs - right.durationMs ||
    left.fret - right.fret ||
    LANE_ORDER_INDEX[left.lane] - LANE_ORDER_INDEX[right.lane]
  )
}

function resolveOpenStringMidiByLane(
  overrides: PartialOpenStringMidiByLane | undefined,
): OpenStringMidiByLane {
  const resolved: OpenStringMidiByLane = {
    E: DEFAULT_OPEN_STRING_MIDI_BY_LANE.E,
    A: DEFAULT_OPEN_STRING_MIDI_BY_LANE.A,
    D: DEFAULT_OPEN_STRING_MIDI_BY_LANE.D,
    G: DEFAULT_OPEN_STRING_MIDI_BY_LANE.G,
  }

  if (!overrides) {
    return resolved
  }

  for (const lane of BASS_LANE_ORDER) {
    const override = overrides[lane]
    if (override === undefined) {
      continue
    }
    assertFiniteNumber(override, `openStringMidiByLane.${lane}`)
    resolved[lane] = Math.round(override)
  }

  return resolved
}

function resolveMaxFret(maxFret: number | undefined): number {
  if (maxFret === undefined) {
    return Number.POSITIVE_INFINITY
  }
  assertFiniteNumber(maxFret, 'maxFret')
  if (maxFret < 0) {
    throw new Error('maxFret must be >= 0.')
  }
  return Math.floor(maxFret)
}

function resolveLaneAndFret(
  midiNote: number,
  openStringMidiByLane: OpenStringMidiByLane,
  maxFret: number,
): { lane: BassLane; fret: number } | null {
  let resolvedLane: BassLane | null = null
  let resolvedFret = Number.POSITIVE_INFINITY

  for (const lane of BASS_LANE_ORDER) {
    const fret = midiNote - openStringMidiByLane[lane]
    if (fret < 0 || fret > maxFret) {
      continue
    }
    if (fret < resolvedFret) {
      resolvedLane = lane
      resolvedFret = fret
    }
  }

  if (resolvedLane === null || !Number.isFinite(resolvedFret)) {
    return null
  }

  return {
    lane: resolvedLane,
    fret: resolvedFret,
  }
}

export function parseSmfFromArrayBuffer(arrayBuffer: ArrayBuffer): ParseSmfResult {
  if (!(arrayBuffer instanceof ArrayBuffer)) {
    return createFailure(
      'SMF_PARSE_FAILED',
      'Failed to parse Standard MIDI File (SMF): input must be an ArrayBuffer.',
    )
  }

  try {
    const midi = new Midi(arrayBuffer)
    const tracks: ParsedSmfTrack[] = midi.tracks.map((track, trackIndex) => {
      const notes = track.notes.map((note, noteIndex) => {
        return {
          midi: normalizeMidiNote(note.midi, trackIndex, noteIndex),
          timeMs: secondsToMs(note.time, `tracks[${trackIndex}].notes[${noteIndex}].time`),
          durationMs: secondsToMs(
            note.duration,
            `tracks[${trackIndex}].notes[${noteIndex}].duration`,
          ),
        }
      })
      notes.sort(compareParsedNotes)

      return {
        index: trackIndex,
        name: normalizeTrackName(track.name, trackIndex),
        noteCount: notes.length,
        notes,
      }
    })

    return {
      ok: true,
      value: {
        bpm: deriveBpm(midi),
        tracks,
      },
    }
  } catch (error: unknown) {
    return createFailure(
      'SMF_PARSE_FAILED',
      `Failed to parse Standard MIDI File (SMF): ${toErrorMessage(error)}`,
    )
  }
}

export function listSmfTracks(parsedSmf: ParsedSmf): SmfTrackSummary[] {
  return parsedSmf.tracks.map((track) => {
    return {
      index: track.index,
      name: track.name,
      noteCount: track.noteCount,
    }
  })
}

export function deriveLoopDurationMs(
  notes: readonly Pick<ChartNote, 'timeMs' | 'durationMs'>[],
): number {
  let maxEndTimeMs = 0

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]
    const timeMs = assertFiniteNumber(note.timeMs, `notes[${index}].timeMs`)
    const durationMs = assertFiniteNumber(note.durationMs, `notes[${index}].durationMs`)
    const endTimeMs = Math.max(0, timeMs) + Math.max(0, durationMs)
    maxEndTimeMs = Math.max(maxEndTimeMs, endTimeMs)
  }

  return Math.max(1, Math.ceil(maxEndTimeMs))
}

export function convertSmfTrackToLaneChart(
  parsedSmf: ParsedSmf,
  trackIndex: number,
  options: ConvertSmfTrackToLaneChartOptions = {},
): ConvertSmfTrackToLaneChartResult {
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    return createFailure(
      'TRACK_NOT_FOUND',
      `Track index must be a non-negative integer. Received: ${String(trackIndex)}.`,
    )
  }

  const track = parsedSmf.tracks.find((candidate) => candidate.index === trackIndex)
  if (!track) {
    return createFailure('TRACK_NOT_FOUND', `Track index ${trackIndex} was not found.`)
  }

  let openStringMidiByLane: OpenStringMidiByLane
  let maxFret: number

  try {
    openStringMidiByLane = resolveOpenStringMidiByLane(options.openStringMidiByLane)
    maxFret = resolveMaxFret(options.maxFret)
  } catch (error: unknown) {
    return createFailure('INVALID_OPTIONS', toErrorMessage(error))
  }

  const notes: ChartNote[] = []
  for (let noteIndex = 0; noteIndex < track.notes.length; noteIndex += 1) {
    const sourceNote = track.notes[noteIndex]
    const laneAndFret = resolveLaneAndFret(sourceNote.midi, openStringMidiByLane, maxFret)

    if (!laneAndFret) {
      return createFailure(
        'NOTE_OUT_OF_RANGE',
        `Track ${track.index} note ${noteIndex} (midi=${sourceNote.midi}, timeMs=${sourceNote.timeMs}) cannot be mapped to E/A/D/G lanes.`,
      )
    }

    notes.push({
      lane: laneAndFret.lane,
      fret: laneAndFret.fret,
      timeMs: sourceNote.timeMs,
      durationMs: sourceNote.durationMs,
    })
  }

  notes.sort(compareChartNotes)

  return {
    ok: true,
    value: {
      bpm: parsedSmf.bpm,
      track: {
        index: track.index,
        name: track.name,
        noteCount: track.noteCount,
      },
      loopDurationMs: deriveLoopDurationMs(notes),
      notes,
    },
  }
}

export function createChartDataFromSmfTrackLaneChart(chart: SmfTrackLaneChart): ChartData {
  return {
    bpm: chart.bpm,
    notes: chart.notes.map((note) => {
      return { ...note }
    }),
  }
}
