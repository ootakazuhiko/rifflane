import './style.css'
import {
  ensureAudioPermission,
  listAudioInputDevices,
  startAudioCapture,
  type AudioCaptureSession,
  type AudioLevelState,
  type AudioPitchState,
} from './audio'
import {
  convertSmfTrackToLaneChart,
  createDummyChart,
  listSmfTracks,
  parseSmfFromArrayBuffer,
  type ParsedSmf,
  type SmfTrackSummary,
} from './chart'
import {
  LoopScoringEngine,
  createLoopScoringChartFromLaneScrollerChart,
  createScoringConfig,
  loadLatencyOffsetMs,
  saveLatencyOffsetMs,
  type ScoringEvent,
  type ScoringJudgement,
} from './scoring'
import { renderAppShell } from './ui'
import { LaneScroller, createDummyLaneScrollerChart } from './ui/lane-scroller'

const appRoot = document.querySelector<HTMLDivElement>('#app')
if (!appRoot) {
  throw new Error('Missing #app root element')
}

const chart = createDummyChart()
let activeLaneChart = createDummyLaneScrollerChart()

const baseScoringConfig = createScoringConfig()
const initialLatencyOffsetMs = clampLatencyOffsetMs(
  loadLatencyOffsetMs({
    fallbackMs: baseScoringConfig.latencyOffsetMs,
  }),
)
const scoringConfig = createScoringConfig({
  ...baseScoringConfig,
  latencyOffsetMs: initialLatencyOffsetMs,
})

const noteCount = chart.notes.length
const maxFret = chart.notes.reduce((max, note) => Math.max(max, note.fret), 0)
const ui = renderAppShell(appRoot, {
  noteCount,
  maxFret,
  bpm: chart.bpm,
  timingWindowMs: scoringConfig.timingWindowMs,
  pitchWindowCents: scoringConfig.pitchWindowCents,
  latencyOffsetMs: scoringConfig.latencyOffsetMs,
})

const laneScroller = new LaneScroller({
  canvas: ui.laneCanvas,
  chart: activeLaneChart,
  speedMultiplier: 1,
  onFpsSample: (sample) => {
    ui.laneFpsValue.textContent = sample.fps.toFixed(1)
  },
})

const scoringEngine = new LoopScoringEngine({
  chart: createLoopScoringChartFromLaneScrollerChart(activeLaneChart),
  config: scoringConfig,
})

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const PITCH_ON_CONFIDENCE = 0.82
const PITCH_OFF_CONFIDENCE = 0.55
const NOTE_ON_STABLE_FRAMES = 2
const NOTE_OFF_STABLE_FRAMES = 3
const NOTE_CHANGE_SEMITONE_TOLERANCE = 0.8
const LATENCY_OFFSET_MIN_MS = -150
const LATENCY_OFFSET_MAX_MS = 150

let activeSession: AudioCaptureSession | null = null
let meterRenderFrameId: number | null = null
let scoringFrameId: number | null = null

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

const transportClock = {
  loopIndex: 0,
  previousPlayheadMs: laneScroller.getPlayheadMs(),
  absolutePlayheadMs: laneScroller.getPlayheadMs(),
}
let parsedSmf: ParsedSmf | null = null

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function clampLatencyOffsetMs(offsetMs: number): number {
  if (!Number.isFinite(offsetMs)) {
    return 0
  }
  const roundedOffsetMs = Math.round(offsetMs)
  return Math.max(LATENCY_OFFSET_MIN_MS, Math.min(LATENCY_OFFSET_MAX_MS, roundedOffsetMs))
}

function formatLatencyOffsetMs(offsetMs: number): string {
  const normalizedOffsetMs = clampLatencyOffsetMs(offsetMs)
  if (normalizedOffsetMs > 0) {
    return `+${normalizedOffsetMs}ms`
  }
  return `${normalizedOffsetMs}ms`
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

function updateTransportClock(): number {
  const currentPlayheadMs = laneScroller.getPlayheadMs()
  const wrapThresholdMs = activeLaneChart.loopDurationMs * 0.5

  if (currentPlayheadMs + wrapThresholdMs < transportClock.previousPlayheadMs) {
    transportClock.loopIndex += 1
  }

  transportClock.previousPlayheadMs = currentPlayheadMs
  transportClock.absolutePlayheadMs =
    transportClock.loopIndex * activeLaneChart.loopDurationMs + currentPlayheadMs
  return transportClock.absolutePlayheadMs
}

function setMidiImportStatus(message: string): void {
  ui.midiImportStatusValue.textContent = message
}

function resetMidiTrackSelect(): void {
  ui.midiTrackSelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'select track'
  ui.midiTrackSelect.append(placeholder)
  ui.midiTrackSelect.value = ''
}

function updateMidiImportControls(): void {
  const hasParsedSmf = parsedSmf !== null
  const hasSelectedTrack = hasParsedSmf && ui.midiTrackSelect.value !== ''
  ui.midiTrackSelect.disabled = !hasParsedSmf || ui.midiTrackSelect.options.length <= 1
  ui.midiImportButton.disabled = !hasSelectedTrack
}

function populateMidiTrackSelect(tracks: readonly SmfTrackSummary[]): void {
  resetMidiTrackSelect()
  tracks.forEach((track) => {
    const option = document.createElement('option')
    option.value = String(track.index)
    option.textContent = `#${track.index + 1} ${track.name} (${track.noteCount} notes)`
    ui.midiTrackSelect.append(option)
  })

  const firstTrack = tracks.find((track) => track.noteCount > 0) ?? tracks[0]
  if (firstTrack) {
    ui.midiTrackSelect.value = String(firstTrack.index)
  }
}

function findFirstMidiFile(fileList: FileList | null): File | null {
  if (!fileList || fileList.length === 0) {
    return null
  }

  for (let index = 0; index < fileList.length; index += 1) {
    const file = fileList.item(index)
    if (!file) {
      continue
    }
    const lowerName = file.name.toLowerCase()
    if (lowerName.endsWith('.mid') || lowerName.endsWith('.midi')) {
      return file
    }
  }

  return fileList.item(0)
}

function applyImportedLaneChartFromSelectedTrack(): void {
  if (!parsedSmf) {
    setMidiImportStatus('MIDIを先に読み込んでください')
    return
  }

  const trackIndex = Number(ui.midiTrackSelect.value)
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    setMidiImportStatus('track を選択してください')
    updateMidiImportControls()
    return
  }

  const conversion = convertSmfTrackToLaneChart(parsedSmf, trackIndex)
  if (!conversion.ok) {
    setMidiImportStatus(`import失敗: ${conversion.error.code}`)
    return
  }

  if (laneScroller.isRunning()) {
    laneScroller.stop()
    stopScoringLoop()
    ui.laneFpsValue.textContent = '0.0'
  }

  const importedChart = {
    loopDurationMs: conversion.value.loopDurationMs,
    notes: conversion.value.notes.map((note) => ({ ...note })),
  }
  activeLaneChart = importedChart

  laneScroller.setChart(importedChart)
  laneScroller.setPlayheadMs(0)
  laneScroller.renderNow()

  transportClock.loopIndex = 0
  transportClock.previousPlayheadMs = 0
  transportClock.absolutePlayheadMs = 0

  scoringEngine.setChart(createLoopScoringChartFromLaneScrollerChart(importedChart))
  resetScoringView()
  updateLaneStatus()
  setMidiImportStatus(
    `import完了: #${conversion.value.track.index + 1} ${conversion.value.track.name}`,
  )
}

async function loadMidiFile(file: File): Promise<void> {
  ui.midiSelectedNameValue.textContent = file.name
  setMidiImportStatus('MIDI解析中...')
  parsedSmf = null
  resetMidiTrackSelect()
  updateMidiImportControls()

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (error) {
    setMidiImportStatus(`読込失敗: ${formatErrorMessage(error)}`)
    return
  }

  const parseResult = parseSmfFromArrayBuffer(arrayBuffer)
  if (!parseResult.ok) {
    setMidiImportStatus(`解析失敗: ${parseResult.error.code}`)
    return
  }

  parsedSmf = parseResult.value
  const tracks = listSmfTracks(parseResult.value)
  if (tracks.length === 0) {
    setMidiImportStatus('解析成功: trackが存在しません')
    updateMidiImportControls()
    return
  }

  populateMidiTrackSelect(tracks)
  updateMidiImportControls()
  setMidiImportStatus(`解析成功: ${tracks.length} tracks`)
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

function setLatestJudgementBadge(judgement: ScoringJudgement | null): void {
  if (judgement === null) {
    ui.latestJudgmentValue.textContent = '-'
    ui.latestJudgmentValue.dataset.judgement = 'none'
    return
  }

  ui.latestJudgmentValue.textContent = judgement
  ui.latestJudgmentValue.dataset.judgement = judgement.toLowerCase()
}

function updateScoringStatsView(): void {
  const stats = scoringEngine.getStats()
  ui.statsPerfectValue.textContent = String(stats.perfect)
  ui.statsGoodValue.textContent = String(stats.good)
  ui.statsMissValue.textContent = String(stats.miss)
  ui.statsAccuracyValue.textContent = `${(stats.accuracy * 100).toFixed(1)}%`
}

function handleScoringEvents(events: readonly ScoringEvent[]): void {
  if (events.length === 0) {
    return
  }

  const latestEvent = events[events.length - 1]
  setLatestJudgementBadge(latestEvent.judgement)
  updateScoringStatsView()
}

function resetScoringView(): void {
  setLatestJudgementBadge(null)
  updateScoringStatsView()
}

function toPitchCents(pitch: AudioPitchState): number | null {
  if (pitch.midiNote === null || pitch.centsError === null) {
    return null
  }
  return pitch.midiNote * 100 + pitch.centsError
}

function applyLatencyOffset(offsetMs: number, persist: boolean): void {
  const normalizedOffsetMs = clampLatencyOffsetMs(offsetMs)
  scoringEngine.setLatencyOffsetMs(normalizedOffsetMs)
  ui.latencyOffsetSlider.value = String(normalizedOffsetMs)
  ui.latencyOffsetValue.textContent = formatLatencyOffsetMs(normalizedOffsetMs)

  if (persist) {
    saveLatencyOffsetMs(normalizedOffsetMs)
  }
}

function stopScoringLoop(): void {
  if (scoringFrameId === null) {
    return
  }
  window.cancelAnimationFrame(scoringFrameId)
  scoringFrameId = null
}

function scoringFrame(): void {
  scoringFrameId = null
  if (!laneScroller.isRunning()) {
    return
  }

  const evaluatedAtMs = updateTransportClock()
  const events = scoringEngine.advance(evaluatedAtMs)
  handleScoringEvents(events)

  scoringFrameId = window.requestAnimationFrame(scoringFrame)
}

function startScoringLoop(): void {
  if (scoringFrameId !== null) {
    return
  }
  scoringFrameId = window.requestAnimationFrame(scoringFrame)
}

function onPitchState(pitch: AudioPitchState): void {
  updatePitchDebugPanel(pitch)
  updatePitchTrackingState(pitch)

  if (!laneScroller.isRunning()) {
    return
  }

  if (pitch.confidence < PITCH_OFF_CONFIDENCE) {
    return
  }

  const pitchCents = toPitchCents(pitch)
  if (pitchCents === null) {
    return
  }

  const evaluatedAtMs = updateTransportClock()
  const events = scoringEngine.evaluate({
    evaluatedAtMs,
    pitchCents,
  })
  handleScoringEvents(events)
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
    ui.statusValue.textContent = 'ストリーム稼働中（AudioWorklet Meter + Pitch 有効）'
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

ui.resetStatsButton.addEventListener('click', () => {
  scoringEngine.resetStats()
  resetScoringView()
})

ui.latencyOffsetSlider.addEventListener('input', () => {
  const offsetMs = Number(ui.latencyOffsetSlider.value)
  applyLatencyOffset(offsetMs, true)
})

ui.midiDropZone.addEventListener('click', () => {
  ui.midiFileInput.click()
})

ui.midiDropZone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  ui.midiFileInput.click()
})

ui.midiDropZone.addEventListener('dragover', (event) => {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  ui.midiDropZone.dataset.dragOver = 'true'
})

ui.midiDropZone.addEventListener('dragleave', () => {
  ui.midiDropZone.dataset.dragOver = 'false'
})

ui.midiDropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  ui.midiDropZone.dataset.dragOver = 'false'
  const droppedFile = findFirstMidiFile(event.dataTransfer?.files ?? null)
  if (!droppedFile) {
    setMidiImportStatus('MIDIファイルが見つかりません')
    return
  }
  void loadMidiFile(droppedFile)
})

ui.midiFileInput.addEventListener('change', () => {
  const selectedFile = findFirstMidiFile(ui.midiFileInput.files)
  if (!selectedFile) {
    setMidiImportStatus('MIDIファイルが選択されていません')
    return
  }
  void loadMidiFile(selectedFile)
})

ui.midiTrackSelect.addEventListener('change', () => {
  updateMidiImportControls()
})

ui.midiImportButton.addEventListener('click', () => {
  applyImportedLaneChartFromSelectedTrack()
})

ui.laneStartButton.addEventListener('click', () => {
  laneScroller.start()
  updateTransportClock()
  startScoringLoop()
  updateLaneStatus()
})

ui.laneStopButton.addEventListener('click', () => {
  laneScroller.stop()
  stopScoringLoop()
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
  stopScoringLoop()

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
resetScoringView()
applyLatencyOffset(initialLatencyOffsetMs, false)
resetMidiTrackSelect()
setMidiImportStatus('idle')
updateMidiImportControls()
ui.midiDropZone.dataset.dragOver = 'false'
laneScroller.setSpeedMultiplier(parseLaneSpeedMultiplier())
updateTransportClock()
updateLaneStatus()
laneScroller.renderNow()
updateButtons()
void refreshDevices()
