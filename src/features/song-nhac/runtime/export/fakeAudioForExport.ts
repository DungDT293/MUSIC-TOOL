/**
 * fakeAudioForExport.ts
 *
 * Creates a fake AudioContext + MediaElementAudioSourceNode for offline export.
 * Engines like Butterchurn, AudioMotion, Wave.js need a live AudioContext to
 * pull FFT data from their internal AnalyserNode. In offline export, there's no
 * live audio playback — so we:
 *
 * 1. Create a real AudioContext (suspended/running, doesn't matter — no speakers).
 * 2. Create a silent OscillatorNode as a dummy "source".
 * 3. Wrap it as a fake MediaElementAudioSourceNode (duck-typed).
 * 4. After the engine calls connectAudio(source) → butterchurn/audiomotion/wavejs
 *    create their internal AnalyserNode from our AudioContext.
 * 5. We monkey-patch ALL AnalyserNodes created from this AudioContext so that
 *    getByteFrequencyData() / getByteTimeDomainData() return our pre-computed
 *    frame data instead of real FFT data.
 *
 * Result: engine.render() reads "live" audio data that is actually our per-frame
 * pre-computed FFT → identical visual output to preview.
 */

export interface FakeAudioExportContext {
  audioContext: AudioContext
  /** Duck-typed as MediaElementAudioSourceNode for engine.attachAudioSource(). */
  fakeSource: MediaElementAudioSourceNode
  /** Call before each frame to update the data that AnalyserNodes will return. */
  setFrameData(frequencyData: Uint8Array, waveformData: Uint8Array): void
  /** Clean up. */
  destroy(): void
}

/**
 * Create a fake audio environment for offline export.
 * The returned fakeSource can be passed to engine.attachAudioSource().
 */
export function createFakeAudioForExport(): FakeAudioExportContext {
  // ── 1. Create real AudioContext ──
  const audioContext = new AudioContext({ sampleRate: 44100 })

  // Current frame data — updated per-frame by setFrameData()
  let currentFreq = new Uint8Array(1024)
  let currentWave = new Uint8Array(1024)

  // ── 2. Monkey-patch AudioContext.createAnalyser ──
  // Every AnalyserNode created from this context will return our pre-computed data.
  const originalCreateAnalyser = audioContext.createAnalyser.bind(audioContext)
  audioContext.createAnalyser = function (): AnalyserNode {
    const analyser = originalCreateAnalyser()

    // Override getByteFrequencyData to return our pre-computed frequency data
    analyser.getByteFrequencyData = function (array: Uint8Array): void {
      const len = Math.min(array.length, currentFreq.length)
      for (let i = 0; i < len; i++) {
        array[i] = currentFreq[i]
      }
      // Fill remainder with zeros if array is larger
      for (let i = len; i < array.length; i++) {
        array[i] = 0
      }
    }

    // Override getByteTimeDomainData to return our pre-computed waveform data
    analyser.getByteTimeDomainData = function (array: Uint8Array): void {
      const len = Math.min(array.length, currentWave.length)
      for (let i = 0; i < len; i++) {
        array[i] = currentWave[i]
      }
      for (let i = len; i < array.length; i++) {
        array[i] = 128 // silence = 128 in byte domain
      }
    }

    // Override Float32 variants too (butterchurn may use these)
    analyser.getFloatFrequencyData = function (array: Float32Array): void {
      for (let i = 0; i < array.length; i++) {
        if (i < currentFreq.length) {
          // Convert byte [0-255] → dB [-100, -30] range (AnalyserNode convention)
          array[i] = -100 + (currentFreq[i] / 255) * 70
        } else {
          array[i] = -100 // silence
        }
      }
    }

    analyser.getFloatTimeDomainData = function (array: Float32Array): void {
      for (let i = 0; i < array.length; i++) {
        if (i < currentWave.length) {
          // Convert byte [0-255] → float [-1, 1]
          array[i] = (currentWave[i] - 128) / 128
        } else {
          array[i] = 0
        }
      }
    }

    return analyser
  }

  // ── 3. Create a silent source node (duck-typed as MediaElementAudioSourceNode) ──
  // We use an OscillatorNode with gain=0 so no sound is produced.
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()
  gainNode.gain.value = 0 // Silent
  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)
  oscillator.start()

  // Duck-type the oscillator+gain as a MediaElementAudioSourceNode.
  // Engines only call connect() on the source node, which OscillatorNode supports.
  // We also need to expose .mediaElement for AudioMotion (it may check it).
  const fakeMediaElement = document.createElement('audio') as HTMLMediaElement
  const fakeSource = gainNode as unknown as MediaElementAudioSourceNode
  // Patch mediaElement property for engines that check it
  Object.defineProperty(fakeSource, 'mediaElement', {
    get: () => fakeMediaElement,
    configurable: true,
  })

  return {
    audioContext,
    fakeSource,
    setFrameData(frequencyData: Uint8Array, waveformData: Uint8Array) {
      currentFreq = frequencyData
      currentWave = waveformData
    },
    destroy() {
      try { oscillator.stop() } catch {}
      try { oscillator.disconnect() } catch {}
      try { gainNode.disconnect() } catch {}
      try { audioContext.close() } catch {}
    },
  }
}
