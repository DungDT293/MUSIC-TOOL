/**
 * useAudioChain.ts — Web Audio API hook cho real-time audio preview
 * Graph: AudioElement → inputGain → bass → mid → treble → [dry/wet compressor] → stereoWidener → masterGain → analyser → destination
 *
 * StrictMode safety: createMediaElementSource chỉ gọi 1 lần duy nhất.
 * Cleanup chỉ cancel RAF, KHÔNG close AudioContext hay disconnect source
 * vì keep-alive router không bao giờ truly unmount component.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { EQSettings, CompressorSettings, StereoSettings } from '../../../types/ipc'

interface StereoWidenerNodes {
  input: GainNode
  output: ChannelMergerNode
  sideScaler: GainNode
}

function createStereoWidener(ctx: AudioContext, initialAmount = 1): StereoWidenerNodes {
  // M/S stereo widening
  // amount=0 → mono, amount=1 → original, amount>1 → wide
  const input = ctx.createGain()
  const splitter = ctx.createChannelSplitter(2)
  const midL = ctx.createGain(); midL.gain.value = 0.5
  const midR = ctx.createGain(); midR.gain.value = 0.5
  const midBus = ctx.createGain()
  const sideL = ctx.createGain(); sideL.gain.value = 0.5
  const sideR = ctx.createGain(); sideR.gain.value = -0.5
  const sideBus = ctx.createGain()
  const sideScaler = ctx.createGain(); sideScaler.gain.value = initialAmount
  const leftOut = ctx.createGain()
  const sideNeg = ctx.createGain(); sideNeg.gain.value = -1
  const rightOut = ctx.createGain()
  const output = ctx.createChannelMerger(2)

  input.connect(splitter)
  splitter.connect(midL, 0); splitter.connect(midR, 1)
  splitter.connect(sideL, 0); splitter.connect(sideR, 1)
  midL.connect(midBus); midR.connect(midBus)
  sideL.connect(sideBus); sideR.connect(sideBus)
  sideBus.connect(sideScaler)
  midBus.connect(leftOut); sideScaler.connect(leftOut)
  midBus.connect(rightOut); sideScaler.connect(sideNeg); sideNeg.connect(rightOut)
  leftOut.connect(output, 0, 0)
  rightOut.connect(output, 0, 1)

  return { input, output, sideScaler }
}

export interface AudioChainNodes {
  ctx: AudioContext
  bassFilter: BiquadFilterNode
  midFilter: BiquadFilterNode
  trebleFilter: BiquadFilterNode
  compressorWet: DynamicsCompressorNode
  compressorWetGain: GainNode
  compressorDryGain: GainNode
  stereoWidener: StereoWidenerNodes
  masterGain: GainNode
  analyser: AnalyserNode
}

export interface UseAudioChainReturn {
  audioRef: React.RefObject<HTMLAudioElement>
  chain: AudioChainNodes | null
  lufs: number
  gainReduction: number
  isReady: boolean
  updateEQ: (eq: EQSettings) => void
  updateCompressor: (c: CompressorSettings) => void
  updateStereo: (s: StereoSettings) => void
  setBypass: (bypassed: boolean) => void
}

export function useAudioChain(): UseAudioChainReturn {
  const audioRef = useRef<HTMLAudioElement>(null)
  const chainRef = useRef<AudioChainNodes | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const lufsBufferRef = useRef<number[]>([])

  const [isReady, setIsReady] = useState(false)
  const [lufs, setLufs] = useState(-Infinity)
  const [gainReduction, setGainReduction] = useState(0)

  // Extracted meter loop so it can be restarted without rebuilding the chain
  const startMeterLoop = useCallback((chain: AudioChainNodes) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const timeBuffer = new Float32Array(chain.analyser.fftSize)
    const poll = () => {
      chain.analyser.getFloatTimeDomainData(timeBuffer)
      let sum = 0
      for (let i = 0; i < timeBuffer.length; i++) sum += timeBuffer[i] * timeBuffer[i]
      const rms = Math.sqrt(sum / timeBuffer.length)
      const instant = rms > 0 ? 20 * Math.log10(rms) - 3 : -Infinity

      const history = lufsBufferRef.current
      history.push(instant)
      if (history.length > 180) history.shift()
      const valid = history.filter(isFinite)
      if (valid.length > 0) {
        const avgPower = valid.reduce((a, v) => a + Math.pow(10, v / 10), 0) / valid.length
        setLufs(10 * Math.log10(avgPower))
      }

      setGainReduction(chain.compressorWet.reduction)
      rafRef.current = requestAnimationFrame(poll)
    }
    rafRef.current = requestAnimationFrame(poll)
  }, [])

  // Build Audio chain — only ONCE per audio element lifetime
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // ── StrictMode guard ─────────────────────────────────────────────────────
    // React StrictMode double-invokes effects in dev. On the second run,
    // sourceRef.current already exists (browser keeps the binding even after
    // ctx.close()). Calling createMediaElementSource again throws:
    //   "HTMLMediaElement already connected to a different MediaElementSourceNode"
    // Fix: reuse existing chain + restart RAF only.
    if (sourceRef.current && chainRef.current) {
      setIsReady(true)
      startMeterLoop(chainRef.current)
      return () => {
        if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      }
    }

    // ── First real mount: build full chain ───────────────────────────────────
    const ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 })

    // EQ nodes
    const bassFilter = ctx.createBiquadFilter()
    bassFilter.type = 'lowshelf'; bassFilter.frequency.value = 110; bassFilter.gain.value = 0

    const midFilter = ctx.createBiquadFilter()
    midFilter.type = 'peaking'; midFilter.frequency.value = 1000; midFilter.Q.value = 0.707; midFilter.gain.value = 0

    const trebleFilter = ctx.createBiquadFilter()
    trebleFilter.type = 'highshelf'; trebleFilter.frequency.value = 3000; trebleFilter.gain.value = 0

    // Compressor dry/wet
    const compressorWet = ctx.createDynamicsCompressor()
    compressorWet.threshold.value = -18
    compressorWet.ratio.value = 4
    compressorWet.attack.value = 0.005
    compressorWet.release.value = 0.05
    compressorWet.knee.value = 3

    const compressorWetGain = ctx.createGain(); compressorWetGain.gain.value = 0
    const compressorDryGain = ctx.createGain(); compressorDryGain.gain.value = 1

    // Stereo widener
    const stereoWidener = createStereoWidener(ctx, 1)

    // Output
    const masterGain = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.85

    // Resume AudioContext on play (required by autoplay policy in Electron/Chrome)
    const resumeCtx = () => { if (ctx.state === 'suspended') ctx.resume() }
    audio.addEventListener('play', resumeCtx)
    audio.addEventListener('click', resumeCtx)

    // Wire: audioElement → source → bass → mid → treble → [dry/wet] → stereo → master → analyser → dest
    const source = ctx.createMediaElementSource(audio)
    sourceRef.current = source

    source.connect(bassFilter)
    bassFilter.connect(midFilter)
    midFilter.connect(trebleFilter)

    // Parallel compressor
    trebleFilter.connect(compressorDryGain)
    trebleFilter.connect(compressorWet); compressorWet.connect(compressorWetGain)

    // Both paths → stereoWidener.input
    compressorDryGain.connect(stereoWidener.input)
    compressorWetGain.connect(stereoWidener.input)

    stereoWidener.output.connect(masterGain)
    masterGain.connect(analyser)
    analyser.connect(ctx.destination)

    const chain: AudioChainNodes = {
      ctx, bassFilter, midFilter, trebleFilter,
      compressorWet, compressorWetGain, compressorDryGain,
      stereoWidener, masterGain, analyser,
    }
    chainRef.current = chain

    setIsReady(true)
    startMeterLoop(chain)

    // ── Cleanup ──────────────────────────────────────────────────────────────
    // Only cancel RAF here. Do NOT close ctx or disconnect source because:
    // 1. In StrictMode dev, cleanup runs before remount → closing ctx here
    //    makes the guard branch above fail (ctx is closed, chain unusable)
    // 2. In keep-alive router, this component is NEVER truly unmounted
    //    (only hidden via display:none), so ctx stays valid indefinitely.
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [startMeterLoop])

  const smooth = 0.015

  const updateEQ = useCallback((eq: EQSettings) => {
    const chain = chainRef.current
    if (!chain) return
    const t = chain.ctx.currentTime
    if (eq.enabled) {
      chain.bassFilter.gain.setTargetAtTime(eq.bassGainDb, t, smooth)
      chain.midFilter.gain.setTargetAtTime(eq.midGainDb, t, smooth)
      chain.trebleFilter.gain.setTargetAtTime(eq.trebleGainDb, t, smooth)
    } else {
      chain.bassFilter.gain.setTargetAtTime(0, t, smooth)
      chain.midFilter.gain.setTargetAtTime(0, t, smooth)
      chain.trebleFilter.gain.setTargetAtTime(0, t, smooth)
    }
  }, [])

  const updateCompressor = useCallback((c: CompressorSettings) => {
    const chain = chainRef.current
    if (!chain) return
    const t = chain.ctx.currentTime
    const wet = c.enabled ? 1 : 0
    chain.compressorWetGain.gain.setTargetAtTime(wet, t, smooth)
    chain.compressorDryGain.gain.setTargetAtTime(1 - wet, t, smooth)
    if (c.enabled) {
      chain.compressorWet.threshold.setTargetAtTime(c.thresholdDb, t, smooth)
      chain.compressorWet.ratio.setTargetAtTime(c.ratio, t, smooth)
      chain.compressorWet.attack.setTargetAtTime(c.attackMs / 1000, t, smooth)
      chain.compressorWet.release.setTargetAtTime(c.releaseMs / 1000, t, smooth)
    }
  }, [])

  const updateStereo = useCallback((s: StereoSettings) => {
    const chain = chainRef.current
    if (!chain) return
    const t = chain.ctx.currentTime
    const amount = s.enabled ? Math.max(0, Math.min(3, s.amount)) : 1
    chain.stereoWidener.sideScaler.gain.setTargetAtTime(amount, t, smooth)
  }, [])

  const setBypass = useCallback((bypassed: boolean) => {
    const chain = chainRef.current
    if (!chain) return
    const t = chain.ctx.currentTime
    chain.masterGain.gain.setTargetAtTime(bypassed ? 0 : 1, t, 0.01)
  }, [])

  return {
    audioRef,
    chain: chainRef.current,
    lufs,
    gainReduction,
    isReady,
    updateEQ,
    updateCompressor,
    updateStereo,
    setBypass,
  }
}
