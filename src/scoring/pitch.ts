import {
  DEFAULT_OPEN_STRING_MIDI_BY_LANE,
  type OpenStringMidiByLane,
  type PartialOpenStringMidiByLane,
  type ScoringLane,
} from './types'

function assertFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

const LANE_ORDER: readonly ScoringLane[] = ['E', 'A', 'D', 'G']

export function resolveOpenStringMidiByLane(
  overrides?: PartialOpenStringMidiByLane,
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

  for (const lane of LANE_ORDER) {
    const overrideValue = overrides[lane]
    if (overrideValue === undefined) {
      continue
    }
    resolved[lane] = assertFiniteNumber(overrideValue, `openStringMidiByLane.${lane}`)
  }

  return resolved
}

export function toMidiNoteFromLaneAndFret(
  lane: ScoringLane,
  fret: number,
  openStringMidiByLane: OpenStringMidiByLane,
): number {
  const normalizedFret = assertFiniteNumber(fret, 'fret')
  return openStringMidiByLane[lane] + normalizedFret
}

export function toCentsFromMidiNote(midiNote: number): number {
  return assertFiniteNumber(midiNote, 'midiNote') * 100
}
