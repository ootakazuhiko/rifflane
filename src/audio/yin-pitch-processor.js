const PROCESSOR_NAME = 'rifflane-yin-pitch'
const DEFAULT_MIN_FREQUENCY_HZ = 35
const DEFAULT_MAX_FREQUENCY_HZ = 200
const DEFAULT_CMND_THRESHOLD = 0.12
const DEFAULT_FALLBACK_THRESHOLD = 0.22
const DEFAULT_REPORT_RATE_HZ = 25
const MIN_ANALYSIS_RMS = 0.0025
const FALLBACK_RENDER_QUANTUM_FRAMES = 128

function clamp01(value) {
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

function readBoundedNumber(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function createUnvoicedResult(analysisTimeSec) {
  return {
    type: 'pitch',
    f0Hz: null,
    midiNote: null,
    centsError: null,
    confidence: 0,
    analysisTimeSec,
  }
}

class YinPitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const processorOptions = options?.processorOptions ?? {}
    const minFrequencyHz = readBoundedNumber(
      processorOptions.minFrequencyHz,
      DEFAULT_MIN_FREQUENCY_HZ,
      20,
      sampleRate / 2,
    )
    const maxFrequencyHz = readBoundedNumber(
      processorOptions.maxFrequencyHz,
      DEFAULT_MAX_FREQUENCY_HZ,
      minFrequencyHz + 1,
      sampleRate / 2,
    )

    this.minFrequencyHz = minFrequencyHz
    this.maxFrequencyHz = maxFrequencyHz
    this.threshold = readBoundedNumber(processorOptions.threshold, DEFAULT_CMND_THRESHOLD, 0.05, 0.4)
    this.fallbackThreshold = readBoundedNumber(
      processorOptions.fallbackThreshold,
      DEFAULT_FALLBACK_THRESHOLD,
      this.threshold,
      0.7,
    )
    this.reportRateHz = readBoundedNumber(
      processorOptions.reportRateHz,
      DEFAULT_REPORT_RATE_HZ,
      5,
      60,
    )
    this.reportIntervalFrames = Math.max(
      FALLBACK_RENDER_QUANTUM_FRAMES,
      Math.round(sampleRate / this.reportRateHz),
    )
    this.framesSinceLastReport = 0

    this.minTau = Math.max(2, Math.floor(sampleRate / this.maxFrequencyHz))
    this.maxTau = Math.max(this.minTau + 1, Math.floor(sampleRate / this.minFrequencyHz))
    this.analysisSampleCount = this.maxTau * 2

    this.sampleBuffer = new Float32Array(this.analysisSampleCount + FALLBACK_RENDER_QUANTUM_FRAMES)
    this.writeIndex = 0
    this.totalSamplesWritten = 0

    this.analysisFrame = new Float32Array(this.analysisSampleCount)
    this.difference = new Float32Array(this.maxTau + 1)
    this.cmnd = new Float32Array(this.maxTau + 1)
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] ?? []
    const outputChannels = outputs[0] ?? []
    this.writeMonoInput(inputChannels)
    this.writeSilence(outputChannels)

    const frameLength =
      inputChannels[0]?.length ?? outputChannels[0]?.length ?? FALLBACK_RENDER_QUANTUM_FRAMES
    this.framesSinceLastReport += frameLength

    if (this.framesSinceLastReport >= this.reportIntervalFrames) {
      this.framesSinceLastReport = 0
      const analysisTimeSec = (currentFrame + frameLength) / sampleRate
      this.port.postMessage(this.detectPitch(analysisTimeSec))
    }

    return true
  }

  writeMonoInput(inputChannels) {
    if (inputChannels.length === 0) {
      return
    }

    const frameLength = inputChannels[0].length
    const channelCount = inputChannels.length
    for (let sampleIndex = 0; sampleIndex < frameLength; sampleIndex += 1) {
      let mixedSample = 0
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        mixedSample += inputChannels[channelIndex][sampleIndex]
      }
      this.pushSample(mixedSample / channelCount)
    }
  }

  writeSilence(outputChannels) {
    for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
      outputChannels[channelIndex].fill(0)
    }
  }

  pushSample(sample) {
    this.sampleBuffer[this.writeIndex] = sample
    this.writeIndex += 1
    if (this.writeIndex >= this.sampleBuffer.length) {
      this.writeIndex = 0
    }
    this.totalSamplesWritten += 1
  }

  copyLatestFrame() {
    if (this.totalSamplesWritten < this.analysisSampleCount) {
      return false
    }

    const bufferLength = this.sampleBuffer.length
    let readIndex = this.writeIndex - this.analysisSampleCount
    if (readIndex < 0) {
      readIndex += bufferLength
    }

    for (let sampleIndex = 0; sampleIndex < this.analysisSampleCount; sampleIndex += 1) {
      this.analysisFrame[sampleIndex] = this.sampleBuffer[readIndex]
      readIndex += 1
      if (readIndex >= bufferLength) {
        readIndex = 0
      }
    }

    return true
  }

  detectPitch(analysisTimeSec) {
    if (!this.copyLatestFrame()) {
      return createUnvoicedResult(analysisTimeSec)
    }

    const rms = this.computeRms(this.analysisFrame)
    if (rms < MIN_ANALYSIS_RMS) {
      return createUnvoicedResult(analysisTimeSec)
    }

    this.computeDifferenceAndCmnd()
    const tau = this.findTauEstimate()
    if (tau < 0) {
      return createUnvoicedResult(analysisTimeSec)
    }

    const refinedTau = this.refineTau(tau)
    if (!Number.isFinite(refinedTau) || refinedTau <= 0) {
      return createUnvoicedResult(analysisTimeSec)
    }

    const f0Hz = sampleRate / refinedTau
    if (!Number.isFinite(f0Hz) || f0Hz < this.minFrequencyHz || f0Hz > this.maxFrequencyHz) {
      return createUnvoicedResult(analysisTimeSec)
    }

    const midiFloat = 69 + 12 * Math.log2(f0Hz / 440)
    const midiNote = Math.round(midiFloat)
    const centsError = (midiFloat - midiNote) * 100
    const confidence = clamp01(1 - this.cmnd[tau])

    return {
      type: 'pitch',
      f0Hz,
      midiNote,
      centsError,
      confidence,
      analysisTimeSec,
    }
  }

  computeRms(frame) {
    let squaredSum = 0
    for (let sampleIndex = 0; sampleIndex < frame.length; sampleIndex += 1) {
      const sample = frame[sampleIndex]
      squaredSum += sample * sample
    }
    return Math.sqrt(squaredSum / frame.length)
  }

  computeDifferenceAndCmnd() {
    const maxTau = this.maxTau
    const frame = this.analysisFrame
    const windowLength = this.maxTau

    for (let tau = 1; tau <= maxTau; tau += 1) {
      let differenceSum = 0
      for (let sampleIndex = 0; sampleIndex < windowLength; sampleIndex += 1) {
        const difference = frame[sampleIndex] - frame[sampleIndex + tau]
        differenceSum += difference * difference
      }
      this.difference[tau] = differenceSum
    }

    this.cmnd[0] = 1
    let cumulativeSum = 0
    for (let tau = 1; tau <= maxTau; tau += 1) {
      cumulativeSum += this.difference[tau]
      this.cmnd[tau] =
        cumulativeSum > 0 ? (this.difference[tau] * tau) / cumulativeSum : 1
    }
  }

  findTauEstimate() {
    for (let tau = this.minTau; tau <= this.maxTau; tau += 1) {
      if (this.cmnd[tau] < this.threshold) {
        while (tau + 1 <= this.maxTau && this.cmnd[tau + 1] < this.cmnd[tau]) {
          tau += 1
        }
        return tau
      }
    }

    let bestTau = -1
    let bestValue = 1
    for (let tau = this.minTau; tau <= this.maxTau; tau += 1) {
      if (this.cmnd[tau] < bestValue) {
        bestValue = this.cmnd[tau]
        bestTau = tau
      }
    }

    if (bestTau >= 0 && bestValue < this.fallbackThreshold) {
      return bestTau
    }
    return -1
  }

  refineTau(tau) {
    if (tau <= this.minTau || tau >= this.maxTau) {
      return tau
    }

    const previous = this.cmnd[tau - 1]
    const current = this.cmnd[tau]
    const next = this.cmnd[tau + 1]
    const denominator = 2 * (2 * current - previous - next)
    if (Math.abs(denominator) < 1e-12) {
      return tau
    }

    const correction = (next - previous) / denominator
    const refinedTau = tau + correction
    if (!Number.isFinite(refinedTau)) {
      return tau
    }
    return refinedTau
  }
}

registerProcessor(PROCESSOR_NAME, YinPitchProcessor)
