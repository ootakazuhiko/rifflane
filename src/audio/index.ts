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

export interface AudioLevelState {
  rms: number
  peak: number
  analysisTimeSec: number | null
}

export interface AudioPitchState {
  f0Hz: number | null
  midiNote: number | null
  centsError: number | null
  confidence: number
  analysisTimeSec: number | null
}

export interface AudioCaptureOptions {
  onLevel?: (level: AudioLevelState) => void
  onPitch?: (pitch: AudioPitchState) => void
}

export interface AudioCaptureSession {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  meterNode: AudioWorkletNode
  telemetry: AudioTelemetry
  constraints: AudioConstraintsState
  level: AudioLevelState
  pitch: AudioPitchState
  stop: () => Promise<void>
}

const REQUESTED_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}
const LEVEL_METER_PROCESSOR_NAME = 'rifflane-level-meter'
const YIN_PITCH_PROCESSOR_NAME = 'rifflane-yin-pitch'
const LEVEL_METER_MODULE_URL = new URL('./level-meter-processor.js', import.meta.url).href
const YIN_PITCH_MODULE_URL = new URL('./yin-pitch-processor.js', import.meta.url).href
const YIN_MIN_FREQUENCY_HZ = 35
const YIN_MAX_FREQUENCY_HZ = 200

interface LevelMeterMessage {
  type: 'level'
  rms: number
  peak: number
  analysisTimeSec: number
}

interface YinPitchMessage {
  type: 'pitch'
  f0Hz: number | null
  midiNote: number | null
  centsError: number | null
  confidence: number
  analysisTimeSec: number
}

function assertMediaDevices(): void {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('MediaDevices API is not available in this browser')
  }
}

function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isLevelMeterMessage(data: unknown): data is LevelMeterMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const message = data as Partial<LevelMeterMessage>
  return (
    message.type === 'level' &&
    isFiniteNumber(message.rms) &&
    isFiniteNumber(message.peak) &&
    isFiniteNumber(message.analysisTimeSec)
  )
}

function isYinPitchMessage(data: unknown): data is YinPitchMessage {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const message = data as Partial<YinPitchMessage>
  return (
    message.type === 'pitch' &&
    isNullableFiniteNumber(message.f0Hz) &&
    isNullableFiniteNumber(message.midiNote) &&
    isNullableFiniteNumber(message.centsError) &&
    isFiniteNumber(message.confidence) &&
    isFiniteNumber(message.analysisTimeSec)
  )
}

function disconnectAudioNode(node: AudioNode | null): void {
  if (!node) {
    return
  }

  try {
    node.disconnect()
  } catch {
    // Ignore disconnect errors during teardown.
  }
}

function closeWorkletPort(node: AudioWorkletNode | null): void {
  if (!node) {
    return
  }

  node.port.onmessage = null
  try {
    node.port.close()
  } catch {
    // Ignore port close errors during teardown.
  }
}

function stopStreamTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop())
}

async function releaseCaptureResources(
  stream: MediaStream,
  context: AudioContext,
  source: MediaStreamAudioSourceNode | null,
  levelMeterNode: AudioWorkletNode | null,
  pitchNode: AudioWorkletNode | null,
  sinkGainNode: GainNode | null,
): Promise<void> {
  closeWorkletPort(levelMeterNode)
  closeWorkletPort(pitchNode)
  disconnectAudioNode(source)
  disconnectAudioNode(levelMeterNode)
  disconnectAudioNode(pitchNode)
  disconnectAudioNode(sinkGainNode)
  stopStreamTracks(stream)

  if (context.state !== 'closed') {
    await context.close()
  }
}

export async function ensureAudioPermission(): Promise<void> {
  assertMediaDevices()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  stopStreamTracks(stream)
}

export async function listAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  assertMediaDevices()
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((device) => device.kind === 'audioinput')
}

export async function startAudioCapture(
  deviceId?: string,
  options: AudioCaptureOptions = {},
): Promise<AudioCaptureSession> {
  assertMediaDevices()

  const constraints: MediaTrackConstraints = { ...REQUESTED_CONSTRAINTS }
  if (deviceId) {
    constraints.deviceId = { exact: deviceId }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false })
  const context = new AudioContext()
  let source: MediaStreamAudioSourceNode | null = null
  let levelMeterNode: AudioWorkletNode | null = null
  let pitchNode: AudioWorkletNode | null = null
  let sinkGainNode: GainNode | null = null

  try {
    source = context.createMediaStreamSource(stream)
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

    if (typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorkletNode is not available in this browser')
    }

    await Promise.all([
      context.audioWorklet.addModule(LEVEL_METER_MODULE_URL),
      context.audioWorklet.addModule(YIN_PITCH_MODULE_URL),
    ])
    levelMeterNode = new AudioWorkletNode(context, LEVEL_METER_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    pitchNode = new AudioWorkletNode(context, YIN_PITCH_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        minFrequencyHz: YIN_MIN_FREQUENCY_HZ,
        maxFrequencyHz: YIN_MAX_FREQUENCY_HZ,
      },
    })
    sinkGainNode = context.createGain()
    sinkGainNode.gain.value = 0
    source.connect(levelMeterNode)
    source.connect(pitchNode)
    levelMeterNode.connect(sinkGainNode)
    pitchNode.connect(sinkGainNode)
    sinkGainNode.connect(context.destination)

    const level: AudioLevelState = {
      rms: 0,
      peak: 0,
      analysisTimeSec: null,
    }
    const pitch: AudioPitchState = {
      f0Hz: null,
      midiNote: null,
      centsError: null,
      confidence: 0,
      analysisTimeSec: null,
    }

    levelMeterNode.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!isLevelMeterMessage(event.data)) {
        return
      }

      level.rms = event.data.rms
      level.peak = event.data.peak
      level.analysisTimeSec = event.data.analysisTimeSec
      options.onLevel?.({ ...level })
    }
    pitchNode.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!isYinPitchMessage(event.data)) {
        return
      }

      pitch.f0Hz = event.data.f0Hz
      pitch.midiNote = event.data.midiNote
      pitch.centsError = event.data.centsError
      pitch.confidence = event.data.confidence
      pitch.analysisTimeSec = event.data.analysisTimeSec
      options.onPitch?.({ ...pitch })
    }

    if (context.state === 'suspended') {
      await context.resume()
    }

    let stopPromise: Promise<void> | null = null
    const stop = (): Promise<void> => {
      if (!stopPromise) {
        stopPromise = releaseCaptureResources(
          stream,
          context,
          source,
          levelMeterNode,
          pitchNode,
          sinkGainNode,
        )
      }
      return stopPromise
    }

    return {
      stream,
      context,
      source,
      meterNode: levelMeterNode,
      telemetry,
      constraints: constraintsState,
      level,
      pitch,
      stop,
    }
  } catch (error) {
    try {
      await releaseCaptureResources(stream, context, source, levelMeterNode, pitchNode, sinkGainNode)
    } catch {
      // Ignore cleanup failures and preserve the original startup error.
    }
    throw error
  }
}
