import { describe, expect, it } from 'vitest'
import { resolveOpenStringMidiByLane, toCentsFromMidiNote, toMidiNoteFromLaneAndFret } from './pitch'
import { DEFAULT_OPEN_STRING_MIDI_BY_LANE } from './types'

describe('resolveOpenStringMidiByLane', () => {
  it('returns defaults when overrides are omitted', () => {
    expect(resolveOpenStringMidiByLane()).toEqual(DEFAULT_OPEN_STRING_MIDI_BY_LANE)
  })

  it('applies partial overrides lane-by-lane', () => {
    expect(resolveOpenStringMidiByLane({ E: 29, D: 39 })).toEqual({
      E: 29,
      A: 33,
      D: 39,
      G: 43,
    })
  })

  it('throws when override includes a non-finite value', () => {
    expect(() => resolveOpenStringMidiByLane({ A: Number.NaN })).toThrow(
      'openStringMidiByLane.A must be a finite number.',
    )
  })
})

describe('toMidiNoteFromLaneAndFret', () => {
  it('derives midi note from lane and fret', () => {
    const midi = toMidiNoteFromLaneAndFret('G', 2, resolveOpenStringMidiByLane())
    expect(midi).toBe(45)
  })

  it('throws when fret is non-finite', () => {
    expect(() => toMidiNoteFromLaneAndFret('E', Number.POSITIVE_INFINITY, resolveOpenStringMidiByLane())).toThrow(
      'fret must be a finite number.',
    )
  })
})

describe('toCentsFromMidiNote', () => {
  it('converts midi note to cents', () => {
    expect(toCentsFromMidiNote(28)).toBe(2800)
  })

  it('throws when midi note is non-finite', () => {
    expect(() => toCentsFromMidiNote(Number.NaN)).toThrow('midiNote must be a finite number.')
  })
})
