import { describe, expect, it } from 'vitest'
import {
  VideoCapacityError,
  VideoSequenceExhaustionError,
  planVideoBatch,
} from '../../../backend/video/utils/videoPlaylistPlan'

const clips = (count: number, durationSec = 5) =>
  Array.from({ length: count }, (_, index) => ({
    id: `clip-${index}`,
    path: `E:/clips/${index}.mp4`,
    durationSec,
  }))

describe('planVideoBatch', () => {
  it('allocates 5,000 physical clips once across outputs', () => {
    const result = planVideoBatch({
      clips: clips(5000),
      jobs: Array.from({ length: 100 }, (_, jobIndex) => ({ jobIndex, targetDurationSec: 120 })),
      uniqueRequired: true,
    })

    const ids = result.jobs.flatMap((job) => job.clips.map((clip) => clip.id))
    expect(ids).toHaveLength(2400)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(result.jobs.map((job) => job.fingerprint)).size).toBe(result.jobs.length)
    expect(result.repeatedClipIds).toEqual([])
  })

  it('deduplicates aliases before capacity calculation', () => {
    expect(() => planVideoBatch({
      clips: [
        { id: 'physical-a', path: 'E:/clips/a.mp4', durationSec: 10 },
        { id: 'physical-a', path: 'E:/alias/a.mp4', durationSec: 10 },
      ],
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }],
      uniqueRequired: true,
    })).toThrow(VideoCapacityError)
  })

  it('fails instead of silently repeating when unique capacity is insufficient', () => {
    expect(() => planVideoBatch({
      clips: clips(2, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }, { jobIndex: 1, targetDurationSec: 15 }],
      uniqueRequired: true,
    })).toThrow(VideoCapacityError)
  })

  it('reports reuse only when explicitly allowed', () => {
    const result = planVideoBatch({
      clips: clips(2, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }, { jobIndex: 1, targetDurationSec: 15 }],
      uniqueRequired: false,
    })

    expect(result.repeatedClipIds).toEqual(['clip-0', 'clip-1'])
  })

  it('allows reuse across outputs while keeping output sequences distinct', () => {
    const result = planVideoBatch({
      clips: clips(3, 10),
      jobs: [
        { jobIndex: 0, targetDurationSec: 25 },
        { jobIndex: 1, targetDurationSec: 25 },
      ],
      uniqueRequired: false,
      requireUniqueSequences: true,
    })

    for (const job of result.jobs) {
      const ids = job.clips.map((clip) => clip.id)
      expect(ids.some((id, index) => index > 0 && id === ids[index - 1])).toBe(false)
    }
    expect(new Set(result.jobs.map((job) => job.fingerprint)).size).toBe(2)
  })

  it('reseeds a retained sequence before export', () => {
    const first = planVideoBatch({
      clips: clips(2, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
    })
    const next = planVideoBatch({
      clips: clips(2, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
      existingFingerprints: new Set([first.jobs[0].fingerprint]),
    })

    expect(next.jobs[0].fingerprint).not.toBe(first.jobs[0].fingerprint)
  })

  it('fails when every bounded candidate is retained', () => {
    const candidate = planVideoBatch({
      clips: clips(1, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
    })

    expect(() => planVideoBatch({
      clips: clips(1, 10),
      jobs: [{ jobIndex: 0, targetDurationSec: 15 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
      existingFingerprints: new Set([candidate.jobs[0].fingerprint]),
      maxSequenceAttempts: 1,
    })).toThrow(VideoSequenceExhaustionError)
  })

  it('generates non-linear diverse permutations across multiple jobs', () => {
    const pool = clips(20, 10) // 20 clips, 10s each
    const result = planVideoBatch({
      clips: pool,
      jobs: [
        { jobIndex: 0, targetDurationSec: 100 }, // 10 clips
        { jobIndex: 1, targetDurationSec: 100 }, // 10 clips
        { jobIndex: 2, targetDurationSec: 100 }, // 10 clips
      ],
      uniqueRequired: false,
      requireUniqueSequences: true,
      seed: 42,
    })

    expect(result.jobs).toHaveLength(3)
    const fingerprints = new Set(result.jobs.map((j) => j.fingerprint))
    expect(fingerprints.size).toBe(3)

    // Verify clips are NOT just shifted by 1 (i.e. not job0[i+1] === job1[i])
    const seq0 = result.jobs[0].clips.map((c) => c.id)
    const seq1 = result.jobs[1].clips.map((c) => c.id)
    const seq2 = result.jobs[2].clips.map((c) => c.id)

    // They must not be identical
    expect(seq0).not.toEqual(seq1)
    expect(seq1).not.toEqual(seq2)

    // Verify that consecutive clip pairs differ significantly (not a linear slide)
    let matchCount01 = 0
    for (let i = 0; i < seq0.length - 1; i++) {
      if (seq1[i] === seq0[i + 1]) matchCount01++
    }
    // In old linear sliding window, matchCount01 would be seq0.length - 1 (e.g. 9 out of 9)
    // With true shuffling, matchCount01 will be nearly 0
    expect(matchCount01).toBeLessThan(seq0.length / 2)
  })

  it('generates completely different sequences across consecutive renders with different seeds', () => {
    const pool = clips(15, 10)
    const render1 = planVideoBatch({
      clips: pool,
      jobs: [{ jobIndex: 0, targetDurationSec: 80 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
      seed: 12345,
    })
    const render2 = planVideoBatch({
      clips: pool,
      jobs: [{ jobIndex: 0, targetDurationSec: 80 }],
      uniqueRequired: false,
      requireUniqueSequences: true,
      seed: 67890,
    })

    const seq1 = render1.jobs[0].clips.map((c) => c.id)
    const seq2 = render2.jobs[0].clips.map((c) => c.id)
    expect(seq1).not.toEqual(seq2)
    expect(render1.jobs[0].fingerprint).not.toBe(render2.jobs[0].fingerprint)
  })
})

