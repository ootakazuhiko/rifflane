import './style.css'
import {
  ensureAudioPermission,
  listAudioInputDevices,
  startAudioCapture,
  type AudioCaptureSession,
  type AudioLevelState,
  type AudioPitchState,
} from './audio'
import { createDummyChart } from './chart'
import { createScoringConfig } from './scoring'
import { renderAppShell } from './ui'
import { LaneScroller, createDummyLaneScrollerChart } from './ui/lane-scroller'

const appRoot = document.querySelector<HTMLDivElement>('#app')
if (!appRoot) {
  throw new Error('Missing #app root element')
}

const chart = createDummyChart()
const scoring = createScoringConfig()
const noteCount = chart.notes.length
const maxFret = chart.notes.reduce((max, note) => Math.max(max, note.fret), 0)
const ui = renderAppShell(appRoot, {
  noteCount,
  maxFret,
  bpm: chart.bpm,
  timingWindowMs: scoring.timingWindowMs,
  pitchWindowCents: scoring.pitchWindowCents,
  latencyOffsetMs: scoring.latencyOffsetMs,
})
const laneScroller = new LaneScroller({
  canvas: ui.laneCanvas,
  chart: createDummyLaneScrollerChart(),
  speedMultiplier: 1,
  onFpsSample: (sample) => {
    ui.laneFpsValue.textContent = sample.fps.toFixed(1)
  },
})
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCH_ON_CONFIDENCE = 0.82
const PITCH_OFF_CONFIDENCE = 0.55
const NOTE_ON_STABLE_FRAMES = 2
const NOTE_OFF_STABLE_FRAMES = 3
const NOTE_CHANGE_SEMITONE_TOLERANCE = 0.8

let activeSession: AudioCaptureSession | null = null
let meterRenderFrameId: number | null = null
const pitchTracking = {
  activeMidiNote: null as number | null,
  candidateMidiNote: null as number | null,
  candidateStableFrames: 0,
  offStableFrames: 0,
}
const meterStats = {
  rms: 0,
  peak: 0,
  updateHz: 0,
  updateCount: 0,
  windowStartedAtMs: performance.now(),
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function parseLaneSpeedMultiplier(): number {
  const value = Number(ui.laneSpeedSelect.value)
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  return value
}

function updateLaneStatus(): void {
  const speed = laneScroller.getSpeedMultiplier().toFixed(2)
  const running = laneScroller.isRunning()
  ui.laneStateValue.textContent = running ? `playing (${speed}x)` : `stopped (${speed}x)`
  ui.laneStartButton.disabled = running
  ui.laneStopButton.disabled = !running
}

function updateButtons(): void {
  const hasDevice = ui.deviceSelect.options.length > 0 && ui.deviceSelect.value.length > 0
  ui.startButton.disabled = activeSession !== null || !hasDevice
  ui.stopButton.disabled = activeSession === null
}

function formatMidiNoteLabel(midiNote: number): string {
  const normalized = Math.round(midiNote)
  const noteName = NOTE_NAMES[((normalized % 12) + 12) % 12]
  const octave = Math.floor(normalized / 12) - 1
  return `${noteName}${octave}`
}

function resetPitchTracking(): void {
  pitchTracking.activeMidiNote = null
  pitchTracking.candidateMidiNote = null
  pitchTracking.candidateStableFrames = 0
  pitchTracking.offStableFrames = 0
}

function resetPitchDebugPanel(): void {
  resetPitchTracking()
  ui.pitchF0HzValue.textContent = '-'
  ui.pitchMidiNoteValue.textContent = '-'
  ui.pitchCentsErrorValue.textContent = '-'
  ui.pitchConfidenceValue.textContent = '0.00'
  ui.pitchNoteTrackingStateValue.textContent = 'off'
}

function updatePitchDebugPanel(pitch: AudioPitchState): void {
  ui.pitchF0HzValue.textContent = pitch.f0Hz === null ? '-' : `${pitch.f0Hz.toFixed(2)} Hz`
  ui.pitchMidiNoteValue.textContent =
    pitch.midiNote === null ? '-' : `${formatMidiNoteLabel(pitch.midiNote)} (${Math.round(pitch.midiNote)})`
  ui.pitchCentsErrorValue.textContent =
    pitch.centsError === null ? '-' : `${pitch.centsError.toFixed(1)} cents`
  ui.pitchConfidenceValue.textContent = pitch.confidence.toFixed(2)
}

function updatePitchTrackingState(pitch: AudioPitchState): void {
  const midiNote = pitch.midiNote
  const confidence = pitch.confidence

  if (midiNote === null || confidence < PITCH_OFF_CONFIDENCE) {
    pitchTracking.candidateMidiNote = null
    pitchTracking.candidateStableFrames = 0

    if (pitchTracking.activeMidiNote !== null) {
      pitchTracking.offStableFrames += 1
      if (pitchTracking.offStableFrames >= NOTE_OFF_STABLE_FRAMES) {
        pitchTracking.activeMidiNote = null
        pitchTracking.offStableFrames = 0
      }
    } else {
      pitchTracking.offStableFrames = 0
    }

    ui.pitchNoteTrackingStateValue.textContent =
      pitchTracking.activeMidiNote === null
        ? 'off'
        : `release-hold ${formatMidiNoteLabel(pitchTracking.activeMidiNote)}`
    return
  }

  pitchTracking.offStableFrames = 0
  if (pitchTracking.candidateMidiNote === midiNote) {
    pitchTracking.candidateStableFrames += 1
  } else {
    pitchTracking.candidateMidiNote = midiNote
    pitchTracking.candidateStableFrames = 1
  }

  if (pitchTracking.activeMidiNote === null) {
    if (
      confidence >= PITCH_ON_CONFIDENCE &&
      pitchTracking.candidateStableFrames >= NOTE_ON_STABLE_FRAMES
    ) {
      pitchTracking.activeMidiNote = midiNote
      ui.pitchNoteTrackingStateValue.textContent = `note on ${formatMidiNoteLabel(midiNote)}`
      return
    }

    ui.pitchNoteTrackingStateValue.textContent = `arming ${formatMidiNoteLabel(midiNote)}`
    return
  }

  const semitoneDelta = Math.abs(midiNote - pitchTracking.activeMidiNote)
  if (semitoneDelta <= NOTE_CHANGE_SEMITONE_TOLERANCE) {
    ui.pitchNoteTrackingStateValue.textContent =
      `note on ${formatMidiNoteLabel(pitchTracking.activeMidiNote)}`
    return
  }

  if (
    confidence >= PITCH_ON_CONFIDENCE &&
    pitchTracking.candidateStableFrames >= NOTE_ON_STABLE_FRAMES
  ) {
    pitchTracking.activeMidiNote = midiNote
    ui.pitchNoteTrackingStateValue.textContent = `note on ${formatMidiNoteLabel(midiNote)}`
    return
  }

  ui.pitchNoteTrackingStateValue.textContent =
    `transition ${formatMidiNoteLabel(pitchTracking.activeMidiNote)} -> ${formatMidiNoteLabel(midiNote)}`
}

function onPitchState(pitch: AudioPitchState): void {
  updatePitchDebugPanel(pitch)
  updatePitchTrackingState(pitch)
}

function resetTelemetry(): void {
  ui.sampleRateValue.textContent = '-'
  ui.channelCountValue.textContent = '-'
  ui.baseLatencyValue.textContent = '-'
  ui.constraintsValue.textContent = 'echo/noise/agc = - / - / -'
}

function resetLevelMeter(): void {
  if (meterRenderFrameId !== null) {
    window.cancelAnimationFrame(meterRenderFrameId)
    meterRenderFrameId = null
  }
  meterStats.rms = 0
  meterStats.peak = 0
  meterStats.updateHz = 0
  meterStats.updateCount = 0
  meterStats.windowStartedAtMs = performance.now()
  ui.resetLevelMeter()
}

function renderLevelMeter(): void {
  meterRenderFrameId = null
  ui.updateLevelMeter(meterStats.rms, meterStats.peak, meterStats.updateHz)
}

function scheduleLevelMeterRender(): void {
  if (meterRenderFrameId !== null) {
    return
  }
  meterRenderFrameId = window.requestAnimationFrame(renderLevelMeter)
}

function onMeterLevel(level: AudioLevelState): void {
  meterStats.rms = level.rms
  meterStats.peak = level.peak
  meterStats.updateCount += 1

  const now = performance.now()
  const elapsedMs = now - meterStats.windowStartedAtMs
  if (elapsedMs >= 1000) {
    meterStats.updateHz = (meterStats.updateCount / elapsedMs) * 1000
    meterStats.updateCount = 0
    meterStats.windowStartedAtMs = now
  }

  scheduleLevelMeterRender()
}

async function refreshDevices(): Promise<void> {
  ui.statusValue.textContent = '権限要求中...'
  try {
    await ensureAudioPermission()
    const devices = await listAudioInputDevices()
    const selectedId = ui.deviceSelect.value
    ui.deviceSelect.innerHTML = ''
    devices.forEach((device, index) => {
      const option = document.createElement('option')
      option.value = device.deviceId
      option.textContent = device.label || `Audio Input ${index + 1}`
      ui.deviceSelect.append(option)
    })

    if (devices.length === 0) {
      ui.statusValue.textContent = 'audioinput デバイスが見つかりません'
      updateButtons()
      return
    }

    const hasPreviousSelection = devices.some((device) => device.deviceId === selectedId)
    ui.deviceSelect.value = hasPreviousSelection ? selectedId : devices[0].deviceId
    ui.statusValue.textContent = `${devices.length} 台の audioinput を検出`
    updateButtons()
  } catch (error) {
    ui.statusValue.textContent = `権限取得失敗: ${formatErrorMessage(error)}`
    updateButtons()
  }
}

function formatConstraint(value: boolean | null): string {
  if (value === null) {
    return 'n/a'
  }
  return value ? 'on' : 'off'
}

async function startCapture(): Promise<void> {
  if (activeSession) {
    return
  }

  if (!ui.deviceSelect.value) {
    ui.statusValue.textContent = 'デバイスを選択してください'
    return
  }

  ui.statusValue.textContent = 'ストリーム開始中...'
  try {
    resetLevelMeter()
    resetPitchDebugPanel()
    activeSession = await startAudioCapture(ui.deviceSelect.value, {
      onLevel: onMeterLevel,
      onPitch: onPitchState,
    })
    ui.statusValue.textContent = 'ストリーム稼働中（AudioWorklet Meter 有効）'
    ui.sampleRateValue.textContent = `${activeSession.telemetry.sampleRateHz} Hz`
    ui.channelCountValue.textContent = `${activeSession.telemetry.channelCount ?? 'n/a'}`
    ui.baseLatencyValue.textContent =
      activeSession.telemetry.baseLatencySec === null
        ? 'n/a'
        : `${activeSession.telemetry.baseLatencySec.toFixed(4)} sec`
    ui.constraintsValue.textContent =
      `echo/noise/agc = ${formatConstraint(activeSession.constraints.echoCancellation)} / ` +
      `${formatConstraint(activeSession.constraints.noiseSuppression)} / ` +
      `${formatConstraint(activeSession.constraints.autoGainControl)}`
    updateButtons()
  } catch (error) {
    ui.statusValue.textContent = `開始失敗: ${formatErrorMessage(error)}`
    resetTelemetry()
    resetLevelMeter()
    resetPitchDebugPanel()
    updateButtons()
  }
}

async function stopCapture(): Promise<void> {
  if (!activeSession) {
    return
  }

  await activeSession.stop()
  activeSession = null
  ui.statusValue.textContent = 'ストリーム停止'
  resetTelemetry()
  resetLevelMeter()
  resetPitchDebugPanel()
  updateButtons()
}

ui.refreshButton.addEventListener('click', () => {
  void refreshDevices()
})

ui.startButton.addEventListener('click', () => {
  void startCapture()
})

ui.stopButton.addEventListener('click', () => {
  void stopCapture()
})

ui.laneStartButton.addEventListener('click', () => {
  laneScroller.start()
  updateLaneStatus()
})

ui.laneStopButton.addEventListener('click', () => {
  laneScroller.stop()
  ui.laneFpsValue.textContent = '0.0'
  updateLaneStatus()
})

ui.laneSpeedSelect.addEventListener('change', () => {
  laneScroller.setSpeedMultiplier(parseLaneSpeedMultiplier())
  updateLaneStatus()
})

window.addEventListener('resize', () => {
  laneScroller.renderNow()
})

window.addEventListener('beforeunload', () => {
  laneScroller.dispose()
  if (meterRenderFrameId !== null) {
    window.cancelAnimationFrame(meterRenderFrameId)
    meterRenderFrameId = null
  }
  if (!activeSession) {
    return
  }
  void activeSession.stop()
})

resetTelemetry()
resetLevelMeter()
resetPitchDebugPanel()
laneScroller.setSpeedMultiplier(parseLaneSpeedMultiplier())
updateLaneStatus()
laneScroller.renderNow()
updateButtons()
void refreshDevices()
