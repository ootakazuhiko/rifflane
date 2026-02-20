import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { convertSmfTrackToLaneChart, parseSmfFromArrayBuffer, type ParsedSmf } from './midi'

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
})
