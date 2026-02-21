import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import {
  convertSmfTrackToLaneChart,
  createChartDataFromSmfTrackLaneChart,
  deriveLoopDurationMs,
  listSmfTracks,
  parseSmfFromArrayBuffer,
  type ParsedSmf,
  type SmfTrackLaneChart,
} from './midi'

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

function createValidSmfArrayBuffer(): ArrayBuffer {
  const midi = new Midi()
  midi.header.setTempo(140)

  const bassTrack = midi.addTrack()
  bassTrack.name = ' Bass '
  bassTrack.addNote({ midi: 40, time: 1, duration: 0.25 })
  bassTrack.addNote({ midi: 28, time: 0.5, duration: 0.5 })

  const emptyTrack = midi.addTrack()
  emptyTrack.name = ' '

  return toArrayBuffer(midi.toArray())
}

function createSmfArrayBufferWithoutTempo(): ArrayBuffer {
  const midi = new Midi()
  const track = midi.addTrack()
  track.name = 'NoTempo'
  track.addNote({ midi: 40, time: 0, duration: 0.25 })
  return toArrayBuffer(midi.toArray())
}

describe('parseSmfFromArrayBuffer', () => {
  it('parses bpm, normalizes track metadata, and sorts notes', () => {
    const result = parseSmfFromArrayBuffer(createValidSmfArrayBuffer())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    expect(result.value.bpm).toBeCloseTo(140, 3)
    expect(result.value.tracks).toHaveLength(2)
    expect(result.value.tracks[0]).toMatchObject({
      index: 0,
      name: 'Bass',
      noteCount: 2,
    })
    expect(result.value.tracks[0].notes).toEqual([
      { midi: 28, timeMs: 500, durationMs: 500 },
      { midi: 40, timeMs: 1000, durationMs: 250 },
    ])
    expect(result.value.tracks[1]).toMatchObject({
      index: 1,
      name: 'Track 2',
      noteCount: 0,
      notes: [],
    })
  })

  it('returns SMF_PARSE_FAILED for an invalid binary', () => {
    const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer
    const result = parseSmfFromArrayBuffer(invalid)

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected parse failure')
    }
    expect(result.error.code).toBe('SMF_PARSE_FAILED')
    expect(result.error.message).toContain('Failed to parse Standard MIDI File')
  })

  it('falls back to bpm=120 when tempo events are missing', () => {
    const result = parseSmfFromArrayBuffer(createSmfArrayBufferWithoutTempo())
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    expect(result.value.bpm).toBe(120)
  })

  it('returns SMF_PARSE_FAILED for non-ArrayBuffer input', () => {
    const invalidInput = new Uint8Array([0x4d, 0x54, 0x68, 0x64])
    const result = parseSmfFromArrayBuffer(invalidInput as unknown as ArrayBuffer)

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected parse failure')
    }
    expect(result.error.code).toBe('SMF_PARSE_FAILED')
    expect(result.error.message).toContain('input must be an ArrayBuffer')
  })
})

describe('convertSmfTrackToLaneChart', () => {
  const parsedSmf: ParsedSmf = {
    bpm: 120,
    tracks: [
      {
        index: 0,
        name: 'Bass',
        noteCount: 3,
        notes: [
          { midi: 45, timeMs: 300, durationMs: 100 },
          { midi: 28, timeMs: 100, durationMs: 80 },
          { midi: 33, timeMs: 200, durationMs: 90 },
        ],
      },
    ],
  }

  it('maps notes to lane/fret and keeps deterministic order', () => {
    const result = convertSmfTrackToLaneChart(parsedSmf, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    expect(result.value.track).toEqual({
      index: 0,
      name: 'Bass',
      noteCount: 3,
    })
    expect(result.value.loopDurationMs).toBe(400)
    expect(result.value.notes).toEqual([
      { lane: 'E', fret: 0, timeMs: 100, durationMs: 80 },
      { lane: 'A', fret: 0, timeMs: 200, durationMs: 90 },
      { lane: 'G', fret: 2, timeMs: 300, durationMs: 100 },
    ])
  })

  it('returns TRACK_NOT_FOUND when track index does not exist', () => {
    const result = convertSmfTrackToLaneChart(parsedSmf, 1)
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected TRACK_NOT_FOUND')
    }
    expect(result.error.code).toBe('TRACK_NOT_FOUND')
  })

  it('returns TRACK_NOT_FOUND when track index is negative', () => {
    const result = convertSmfTrackToLaneChart(parsedSmf, -1)
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected TRACK_NOT_FOUND')
    }
    expect(result.error.code).toBe('TRACK_NOT_FOUND')
    expect(result.error.message).toContain('non-negative integer')
  })

  it('returns TRACK_NOT_FOUND when track index is fractional', () => {
    const result = convertSmfTrackToLaneChart(parsedSmf, 0.5)
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected TRACK_NOT_FOUND')
    }
    expect(result.error.code).toBe('TRACK_NOT_FOUND')
    expect(result.error.message).toContain('Received: 0.5')
  })

  it('returns INVALID_OPTIONS when options are not valid', () => {
    const result = convertSmfTrackToLaneChart(parsedSmf, 0, { maxFret: -1 })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected INVALID_OPTIONS')
    }
    expect(result.error.code).toBe('INVALID_OPTIONS')
    expect(result.error.message).toContain('maxFret must be >= 0.')
  })

  it('returns NOTE_OUT_OF_RANGE when a note cannot be mapped to E/A/D/G lanes', () => {
    const outOfRangeParsedSmf: ParsedSmf = {
      bpm: 120,
      tracks: [
        {
          index: 0,
          name: 'OutOfRange',
          noteCount: 1,
          notes: [{ midi: 10, timeMs: 0, durationMs: 100 }],
        },
      ],
    }

    const result = convertSmfTrackToLaneChart(outOfRangeParsedSmf, 0)
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected NOTE_OUT_OF_RANGE')
    }
    expect(result.error.code).toBe('NOTE_OUT_OF_RANGE')
    expect(result.error.message).toContain('cannot be mapped to E/A/D/G lanes')
  })

  it('applies openStringMidiByLane and maxFret options', () => {
    const optionParsedSmf: ParsedSmf = {
      bpm: 120,
      tracks: [
        {
          index: 0,
          name: 'CustomTuning',
          noteCount: 4,
          notes: [
            { midi: 45, timeMs: 0, durationMs: 100 },
            { midi: 40, timeMs: 100, durationMs: 100 },
            { midi: 35, timeMs: 200, durationMs: 100 },
            { midi: 30, timeMs: 300, durationMs: 100 },
          ],
        },
      ],
    }

    const result = convertSmfTrackToLaneChart(optionParsedSmf, 0, {
      openStringMidiByLane: { E: 30, A: 35, D: 40, G: 45 },
      maxFret: 5.9,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    expect(result.value.notes).toEqual([
      { lane: 'G', fret: 0, timeMs: 0, durationMs: 100 },
      { lane: 'D', fret: 0, timeMs: 100, durationMs: 100 },
      { lane: 'A', fret: 0, timeMs: 200, durationMs: 100 },
      { lane: 'E', fret: 0, timeMs: 300, durationMs: 100 },
    ])
    expect(result.value.loopDurationMs).toBe(400)
  })

  it('keeps defaults for undefined openStringMidiByLane entries', () => {
    const optionParsedSmf: ParsedSmf = {
      bpm: 120,
      tracks: [
        {
          index: 0,
          name: 'PartialCustomTuning',
          noteCount: 4,
          notes: [
            { midi: 30, timeMs: 0, durationMs: 100 },
            { midi: 33, timeMs: 100, durationMs: 100 },
            { midi: 40, timeMs: 200, durationMs: 100 },
            { midi: 43, timeMs: 300, durationMs: 100 },
          ],
        },
      ],
    }

    const result = convertSmfTrackToLaneChart(optionParsedSmf, 0, {
      openStringMidiByLane: {
        E: 30,
        A: undefined,
        D: 40,
        G: undefined,
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.message)
    }

    expect(result.value.notes).toEqual([
      { lane: 'E', fret: 0, timeMs: 0, durationMs: 100 },
      { lane: 'A', fret: 0, timeMs: 100, durationMs: 100 },
      { lane: 'D', fret: 0, timeMs: 200, durationMs: 100 },
      { lane: 'G', fret: 0, timeMs: 300, durationMs: 100 },
    ])
  })
})

describe('listSmfTracks', () => {
  it('returns only summary fields for each track', () => {
    const parsedSmf: ParsedSmf = {
      bpm: 128,
      tracks: [
        {
          index: 0,
          name: 'Main',
          noteCount: 1,
          notes: [{ midi: 33, timeMs: 0, durationMs: 100 }],
        },
        {
          index: 1,
          name: 'Sub',
          noteCount: 0,
          notes: [],
        },
      ],
    }

    const result = listSmfTracks(parsedSmf)
    expect(result).toEqual([
      { index: 0, name: 'Main', noteCount: 1 },
      { index: 1, name: 'Sub', noteCount: 0 },
    ])
    expect(result[0]).not.toHaveProperty('notes')
  })
})

describe('deriveLoopDurationMs', () => {
  it('returns 1 when notes are empty', () => {
    expect(deriveLoopDurationMs([])).toBe(1)
  })

  it('clamps negative values and rounds up end time', () => {
    const loopDurationMs = deriveLoopDurationMs([
      { timeMs: -25.4, durationMs: 20.2 },
      { timeMs: 99.1, durationMs: 50.3 },
    ])
    expect(loopDurationMs).toBe(150)
  })

  it('throws when a non-finite value is included', () => {
    expect(() => {
      deriveLoopDurationMs([{ timeMs: Number.NaN, durationMs: 100 }])
    }).toThrow('notes[0].timeMs must be a finite number.')
  })

  it('returns 1 when all computed end times are non-positive', () => {
    expect(
      deriveLoopDurationMs([
        { timeMs: -100, durationMs: -20 },
        { timeMs: -0.1, durationMs: 0 },
      ]),
    ).toBe(1)
  })

  it('throws when durationMs is non-finite', () => {
    expect(() => {
      deriveLoopDurationMs([{ timeMs: 0, durationMs: Number.POSITIVE_INFINITY }])
    }).toThrow('notes[0].durationMs must be a finite number.')
  })
})

describe('createChartDataFromSmfTrackLaneChart', () => {
  it('copies bpm and deep-copies note objects', () => {
    const laneChart: SmfTrackLaneChart = {
      bpm: 110,
      track: {
        index: 0,
        name: 'Bass',
        noteCount: 1,
      },
      loopDurationMs: 480,
      notes: [{ lane: 'A', fret: 3, timeMs: 120, durationMs: 80 }],
    }

    const result = createChartDataFromSmfTrackLaneChart(laneChart)
    expect(result).toEqual({
      bpm: 110,
      notes: [{ lane: 'A', fret: 3, timeMs: 120, durationMs: 80 }],
    })
    expect(result.notes).not.toBe(laneChart.notes)
    expect(result.notes[0]).not.toBe(laneChart.notes[0])

    laneChart.notes[0].fret = 7
    expect(result.notes[0].fret).toBe(3)
  })
})
