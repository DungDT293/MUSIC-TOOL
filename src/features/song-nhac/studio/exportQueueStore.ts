import { create } from 'zustand'
import type { StudioAnyLayer } from './layerTypes'
import type { CompositionEffects } from './effectsStore'

export type ExportJobStatus = 'pending' | 'running' | 'done' | 'error' | 'canceled'

export interface ExportJobSnapshot {
  width: number
  height: number
  fps: number
  codec: 'h264' | 'hevc'
  bitrateTier: 'high' | 'balanced' | 'light'
  theme: string
  intensity: number
  layers: StudioAnyLayer[]
  effects: CompositionEffects
  /** Optional sub-range, so a queue item can export just a section. */
  rangeStartSec?: number
  rangeEndSec?: number
}

export interface ExportJob {
  id: string
  name: string
  audioPath: string
  outputPath: string
  status: ExportJobStatus
  progress: number
  message?: string
  createdAt: number
  snapshot: ExportJobSnapshot
}

const STORAGE_KEY = 'song-nhac.export-queue.v1'
const MAX_PERSISTED = 40

function loadJobs(): ExportJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { jobs?: ExportJob[] }
    if (!Array.isArray(parsed.jobs)) return []
    // A job that was running when the app closed is resumed rather than lost.
    return parsed.jobs.map((job) =>
      job.status === 'running'
        ? { ...job, status: 'pending' as const, progress: 0, message: 'Tiếp tục sau khi mở lại app' }
        : job,
    )
  } catch {
    return []
  }
}

function persist(jobs: ExportJob[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs: jobs.slice(-MAX_PERSISTED) }))
  } catch {
    // Large batches can exceed the quota; the queue still works for this session.
  }
}

interface ExportQueueStore {
  jobs: ExportJob[]
  /** Structural history (add / remove / clear). Progress ticks are not recorded. */
  past: ExportJob[][]
  future: ExportJob[][]
  enqueue: (input: Omit<ExportJob, 'id' | 'status' | 'progress' | 'createdAt'>) => string
  update: (id: string, patch: Partial<ExportJob>) => void
  remove: (id: string) => void
  clearFinished: () => void
  nextPending: () => ExportJob | undefined
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

const HISTORY_LIMIT = 30

export const useExportQueue = create<ExportQueueStore>((set, get) => {
  /** Persists without touching history (progress ticks). */
  const commit = (jobs: ExportJob[]) => {
    persist(jobs)
    set({ jobs })
  }
  /** Persists and records an undo step (add / remove / clear). */
  const commitWithHistory = (jobs: ExportJob[]) => {
    persist(jobs)
    set({
      jobs,
      past: [...get().past, get().jobs].slice(-HISTORY_LIMIT),
      future: [],
    })
  }
  return {
    jobs: loadJobs(),
    past: [],
    future: [],
    enqueue: (input) => {
      const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const job: ExportJob = { ...input, id, status: 'pending', progress: 0, createdAt: Date.now() }
      commitWithHistory([...get().jobs, job])
      return id
    },
    update: (id, patch) => {
      commit(get().jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)))
    },
    remove: (id) => commitWithHistory(get().jobs.filter((job) => job.id !== id)),
    clearFinished: () =>
      commitWithHistory(get().jobs.filter((job) => job.status === 'pending' || job.status === 'running')),
    nextPending: () => get().jobs.find((job) => job.status === 'pending'),
    undo: () => {
      const past = get().past
      if (!past.length) return
      const previous = past[past.length - 1]
      persist(previous)
      set({ jobs: previous, past: past.slice(0, -1), future: [get().jobs, ...get().future].slice(0, HISTORY_LIMIT) })
    },
    redo: () => {
      const future = get().future
      if (!future.length) return
      const next = future[0]
      persist(next)
      set({ jobs: next, past: [...get().past, get().jobs].slice(-HISTORY_LIMIT), future: future.slice(1) })
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  }
})
