const PROCESSOR_NAME = 'rifflane-level-meter'
const REPORT_RATE_HZ = 25
const FALLBACK_RENDER_QUANTUM_FRAMES = 128

class LevelMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.accumulatedSquare = 0
    this.accumulatedSamples = 0
    this.accumulatedPeak = 0
    this.framesSinceLastReport = 0
    this.reportIntervalFrames = Math.max(
      FALLBACK_RENDER_QUANTUM_FRAMES,
      Math.round(sampleRate / REPORT_RATE_HZ),
    )
  }

  process(inputs) {
    const channels = inputs[0] ?? []
    const frameLength = channels[0]?.length ?? FALLBACK_RENDER_QUANTUM_FRAMES

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const channelData = channels[channelIndex]
      for (let sampleIndex = 0; sampleIndex < channelData.length; sampleIndex += 1) {
        const sample = channelData[sampleIndex]
        const absSample = Math.abs(sample)
        this.accumulatedSquare += sample * sample
        if (absSample > this.accumulatedPeak) {
          this.accumulatedPeak = absSample
        }
      }
      this.accumulatedSamples += channelData.length
    }

    this.framesSinceLastReport += frameLength

    if (this.framesSinceLastReport >= this.reportIntervalFrames) {
      const rms =
        this.accumulatedSamples > 0
          ? Math.sqrt(this.accumulatedSquare / this.accumulatedSamples)
          : 0
      this.port.postMessage({
        type: 'level',
        rms,
        peak: this.accumulatedPeak,
      })
      this.accumulatedSquare = 0
      this.accumulatedSamples = 0
      this.accumulatedPeak = 0
      this.framesSinceLastReport = 0
    }

    return true
  }
}

registerProcessor(PROCESSOR_NAME, LevelMeterProcessor)
