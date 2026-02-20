export interface AudioTelemetry {
  sampleRateHz: number
  channelCount: number | null
  baseLatencySec: number | null
}

export interface AudioConstraintsState {
  echoCancellation: boolean | null
  noiseSuppression: boolean | null
  autoGainControl: boolean | null
}

export interface AudioCaptureSession {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  telemetry: AudioTelemetry
  constraints: AudioConstraintsState
  stop: () => Promise<void>
}

const REQUESTED_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}

function assertMediaDevices(): void {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('MediaDevices API is not available in this browser')
  }
}

function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export async function ensureAudioPermission(): Promise<void> {
  assertMediaDevices()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  stream.getTracks().forEach((track) => track.stop())
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  assertMediaDevices()
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'audioinput')
}

export async function startAudioCapture(deviceId?: string): Promise<AudioCaptureSession> {
  assertMediaDevices()

  const constraints: MediaTrackConstraints = { ...REQUESTED_CONSTRAINTS }
  if (deviceId) {
    constraints.deviceId = { exact: deviceId }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const audioTrack = stream.getAudioTracks()[0]
  if (!audioTrack) {
    throw new Error('No audio track available')
  }

  const settings = audioTrack.getSettings()
  const telemetry: AudioTelemetry = {
    sampleRateHz:
      typeof settings.sampleRate === 'number' ? settings.sampleRate : context.sampleRate,
    channelCount:
      typeof settings.channelCount === 'number' ? settings.channelCount : source.channelCount,
    baseLatencySec: typeof context.baseLatency === 'number' ? context.baseLatency : null,
  }

  const constraintsState: AudioConstraintsState = {
    echoCancellation: readBool(settings.echoCancellation),
    noiseSuppression: readBool(settings.noiseSuppression),
    autoGainControl: readBool(settings.autoGainControl),
  }

  const stop = async (): Promise<void> => {
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    await context.close()
  }

  return {
    stream,
    context,
    source,
    telemetry,
    constraints: constraintsState,
    stop,
  }
}
