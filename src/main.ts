import './style.css'
import {
  ensureAudioPermission,
  listAudioInputDevices,
  startAudioCapture,
  type AudioCaptureSession,
} from './audio'
import { createDummyChart } from './chart'
import { createScoringConfig } from './scoring'
import { renderAppShell } from './ui'

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

let activeSession: AudioCaptureSession | null = null

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unknown error'
}

function updateButtons(): void {
  const hasDevice = ui.deviceSelect.options.length > 0 && ui.deviceSelect.value.length > 0
  ui.startButton.disabled = activeSession !== null || !hasDevice
  ui.stopButton.disabled = activeSession === null
}

function resetTelemetry(): void {
  ui.sampleRateValue.textContent = '-'
  ui.channelCountValue.textContent = '-'
  ui.baseLatencyValue.textContent = '-'
  ui.constraintsValue.textContent = 'echo/noise/agc = - / - / -'
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
    activeSession = await startAudioCapture(ui.deviceSelect.value)
    ui.statusValue.textContent = 'ストリーム稼働中'
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

window.addEventListener('beforeunload', () => {
  if (!activeSession) {
    return
  }
  void activeSession.stop()
})

resetTelemetry()
updateButtons()
void refreshDevices()
