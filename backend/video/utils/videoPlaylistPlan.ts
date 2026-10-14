import crypto from 'node:crypto'

export interface PlannerClip {
  id: string
  path: string
  durationSec: number
}

export interface PlannerJob {
  jobIndex: number
  targetDurationSec: number
}

export interface PlannedVideoJob extends PlannerJob {
  clips: PlannerClip[]
  concatDurationSec: number
  fingerprint: string
}

export interface VideoBatchPlan {
  jobs: PlannedVideoJob[]
  requiredDurationSec: number
  availableUniqueDurationSec: number
  repeatedClipIds: string[]
  uniqueRequired: boolean
}

export class VideoCapacityError extends Error {
  readonly requiredDurationSec: number
  readonly availableUniqueDurationSec: number

  constructor(requiredDurationSec: number, availableUniqueDurationSec: number) {
    super(
      `Không đủ thời lượng video duy nhất: cần ${requiredDurationSec.toFixed(2)}s, ` +
      `chỉ có ${availableUniqueDurationSec.toFixed(2)}s sau khi loại alias/trùng vật lý. ` +
      'Giảm số output/thời lượng audio hoặc thêm video; không tự lặp clip trong chế độ unique.',
    )
    this.name = 'VideoCapacityError'
    this.requiredDurationSec = requiredDurationSec
    this.availableUniqueDurationSec = availableUniqueDurationSec
  }
}

export class VideoSequenceExhaustionError extends Error {
  constructor(attempts: number) {
    super(`Không còn sequence video mới sau ${attempts} lần thử; không chạy FFmpeg để tránh trùng output.`)
    this.name = 'VideoSequenceExhaustionError'
  }
}

function fingerprint(clips: PlannerClip[]): string {
  return crypto.createHash('sha256').update(clips.map((clip) => clip.id).join(',')).digest('hex')
}


function uniqueClips(clips: PlannerClip[]): PlannerClip[] {
  const seen = new Set<string>()
  return clips.filter((clip) => {
    if (seen.has(clip.id)) return false
    if (!Number.isFinite(clip.durationSec) || clip.durationSec <= 0) return false
    seen.add(clip.id)
    return true
  })
}

function createSeededPrng(seed: number): () => number {
  let s = (seed >>> 0) || 0x12345678
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function deriveSeed(baseSeed: number, jobIndex: number, attempt: number): number {
  const h1 = Math.imul((baseSeed ^ 0x9e3779b9) >>> 0, 0x85ebca6b)
  const h2 = Math.imul((jobIndex ^ (h1 >>> 13)) >>> 0, 0xc2b2ae35)
  const h3 = Math.imul((attempt ^ (h2 >>> 16)) >>> 0, 0x27d4eb2d)
  return ((h1 ^ h2 ^ h3) >>> 0) || 0x5a5a5a5a
}

function buildSequence(clips: PlannerClip[], target: number, seed: number): PlannerClip[] {
  if (clips.length === 0) return []
  if (clips.length === 1) {
    const selected: PlannerClip[] = []
    let duration = 0
    while (duration < target) {
      selected.push(clips[0])
      duration += clips[0].durationSec
    }
    return selected
  }

  const prng = createSeededPrng(seed)
  const selected: PlannerClip[] = []
  let duration = 0
  let loopCount = 0

  while (duration < target) {
    const pool = [...clips]
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }

    // Tránh clip đầu pool trùng với clip cuối vừa được chọn ở vòng trước
    if (selected.length > 0 && pool.length > 1 && pool[0].id === selected[selected.length - 1].id) {
      const swapIdx = pool.findIndex((c) => c.id !== selected[selected.length - 1].id)
      if (swapIdx > 0) {
        ;[pool[0], pool[swapIdx]] = [pool[swapIdx], pool[0]]
      }
    }

    for (const clip of pool) {
      selected.push(clip)
      duration += clip.durationSec
      if (duration >= target) break
    }

    loopCount++
    if (loopCount > 10000) break
  }

  return selected
}

export function planVideoBatch(input: {
  jobs: PlannerJob[]
  clips: PlannerClip[]
  uniqueRequired: boolean
  requireUniqueSequences?: boolean
  existingFingerprints?: ReadonlySet<string>
  maxSequenceAttempts?: number
  seed?: number
}): VideoBatchPlan {
  const clips = uniqueClips(input.clips)
  const requiredDurationSec = input.jobs.reduce((sum, job) => sum + Math.max(0, job.targetDurationSec), 0)
  const availableUniqueDurationSec = clips.reduce((sum, clip) => sum + clip.durationSec, 0)

  if (input.uniqueRequired && availableUniqueDurationSec < requiredDurationSec) {
    throw new VideoCapacityError(requiredDurationSec, availableUniqueDurationSec)
  }

  const sequenceMode = !!input.requireUniqueSequences && !input.uniqueRequired
  const sequenceAttempts = Math.max(1, input.maxSequenceAttempts ?? 64)
  const reservedFingerprints = new Set(input.existingFingerprints ?? [])
  const baseSeed = input.seed ?? 0
  let cursor = 0
  const used = new Set<string>()
  const repeatedClipIds: string[] = []
  const plannedJobs: PlannedVideoJob[] = []

  for (const job of input.jobs) {
    const target = Math.max(0, job.targetDurationSec)
    if (clips.length === 0 && target > 0) throw new VideoCapacityError(requiredDurationSec, availableUniqueDurationSec)

    let selected: PlannerClip[] = []
    if (sequenceMode) {
      let accepted = false
      for (let attempt = 0; attempt < sequenceAttempts; attempt++) {
        const attemptSeed = deriveSeed(baseSeed, job.jobIndex, cursor + attempt)
        const candidate = buildSequence(clips, target, attemptSeed)
        const candidateFingerprint = fingerprint(candidate)
        if (!reservedFingerprints.has(candidateFingerprint)) {
          selected = candidate
          reservedFingerprints.add(candidateFingerprint)
          accepted = true
          cursor += attempt + 1
          break
        }
      }
      if (!accepted) throw new VideoSequenceExhaustionError(sequenceAttempts)
    } else {
      let duration = 0
      while (duration < target) {
        if (clips.length === 0) throw new VideoCapacityError(requiredDurationSec, availableUniqueDurationSec)
        if (input.uniqueRequired && cursor >= clips.length) {
          throw new VideoCapacityError(requiredDurationSec, availableUniqueDurationSec)
        }
        const clip = clips[cursor % clips.length]
        cursor++
        if (used.has(clip.id)) repeatedClipIds.push(clip.id)
        else used.add(clip.id)
        selected.push(clip)
        duration += clip.durationSec
      }
    }

    const concatDurationSec = selected.reduce((sum, clip) => sum + clip.durationSec, 0)
    plannedJobs.push({ ...job, clips: selected, concatDurationSec, fingerprint: fingerprint(selected) })
  }

  if (input.uniqueRequired && repeatedClipIds.length > 0) {
    throw new VideoCapacityError(requiredDurationSec, availableUniqueDurationSec)
  }

  return {
    jobs: plannedJobs,
    requiredDurationSec,
    availableUniqueDurationSec,
    repeatedClipIds,
    uniqueRequired: input.uniqueRequired,
  }
}
