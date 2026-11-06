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

interface ExportQueueStore {
  jobs: ExportJob[]
  enqueue: (input: Omit<ExportJob, 'id' | 'status' | 'progress' | 'createdAt'>) => string
  update: (id: string, patch: Partial<ExportJob>) => void
  remove: (id: string) => void
  clearFinished: () => void
  nextPending: () => ExportJob | undefined
}

export const useExportQueue = create<ExportQueueStore>((set, get) => ({
  jobs: [],
  enqueue: (input) => {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const job: ExportJob = { ...input, id, status: 'pending', progress: 0, createdAt: Date.now() }
    set({ jobs: [...get().jobs, job] })
    return id
  },
  update: (id, patch) => {
    set({ jobs: get().jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)) })
  },
  remove: (id) => set({ jobs: get().jobs.filter((job) => job.id !== id) }),
  clearFinished: () =>
    set({ jobs: get().jobs.filter((job) => job.status === 'pending' || job.status === 'running') }),
  nextPending: () => get().jobs.find((job) => job.status === 'pending'),
}))
