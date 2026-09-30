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

function buildSequence(clips: PlannerClip[], target: number, start: number): PlannerClip[] {
  if (clips.length === 0) return []
  const selected: PlannerClip[] = []
  let duration = 0
  let cursor = ((start % clips.length) + clips.length) % clips.length
  while (duration < target) {
    let clip = clips[cursor]
    if (selected.length > 0 && clips.length > 1 && clip.id === selected[selected.length - 1].id) {
      clip = clips[(cursor + 1) % clips.length]
    }
    selected.push(clip)
    duration += clip.durationSec
    cursor = (cursor + 1) % clips.length
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
        const candidate = buildSequence(clips, target, cursor + attempt)
        const candidateFingerprint = fingerprint(candidate)
        if (!reservedFingerprints.has(candidateFingerprint)) {
          selected = candidate
          reservedFingerprints.add(candidateFingerprint)
          accepted = true
          cursor += 1
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
