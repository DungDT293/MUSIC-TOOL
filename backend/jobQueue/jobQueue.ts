import { EventEmitter } from 'events'

export interface JobInfo {
  id: string
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  payload?: any
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface JobContext {
  jobId: string
  signal: AbortSignal
  updateProgress: (percent: number, message?: string) => void
}

export interface JobHandle<T = any> {
  jobId: string
  result: Promise<T>
  cancel: () => Promise<void>
}

interface JobTask<T = any> {
  type: string
  payload?: any
  task: (ctx: JobContext) => Promise<T>
  onCancel?: (jobId: string) => void
}

export class JobQueue extends EventEmitter {
  private jobs = new Map<string, JobInfo>()
  private running = new Map<string, Promise<any>>()
  private abortControllers = new Map<string, AbortController>()
  private pendingQueue: Array<{ jobId: string; fn: () => void }> = []
  private maxConcurrent: number
  // Bug #4 fix: auto-evict completed/failed/cancelled jobs after 30 min to prevent Map growth
  private readonly JOB_TTL_MS = 30 * 60 * 1000
  private cleanupTimer: NodeJS.Timeout

  constructor(maxConcurrent = 3) {
    super()
    this.maxConcurrent = maxConcurrent
    // Periodic cleanup every 10 minutes
    this.cleanupTimer = setInterval(() => this._evictExpiredJobs(), 10 * 60 * 1000)
    this.cleanupTimer.unref?.() // Don't prevent process exit
  }

  private _evictExpiredJobs(): void {
    const now = Date.now()
    for (const [id, info] of this.jobs) {
      if (
        info.status !== 'pending' &&
        info.status !== 'running' &&
        info.completedAt &&
        now - info.completedAt > this.JOB_TTL_MS
      ) {
        this.jobs.delete(id)
      }
    }
  }

  private get runningCount(): number {
    return this.running.size
  }

  private drainPending(): void {
    while (this.pendingQueue.length > 0 && this.runningCount < this.maxConcurrent) {
      const next = this.pendingQueue.shift()!
      // Skip cancelled pending jobs
      const info = this.jobs.get(next.jobId)
      if (info?.status === 'cancelled') continue
      next.fn()
    }
  }

  enqueue<T = any>(job: JobTask<T>): JobHandle<T> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const abortController = new AbortController()
    this.abortControllers.set(jobId, abortController)

    const jobInfo: JobInfo = {
      id: jobId,
      type: job.type,
      status: 'pending',
      payload: job.payload,
      createdAt: Date.now(),
    }

    this.jobs.set(jobId, jobInfo)
    this.emit('update', jobInfo)

    const context: JobContext = {
      jobId,
      signal: abortController.signal,
      updateProgress: (percent: number, _message?: string) => {
        const info = this.jobs.get(jobId)
        if (info) {
          info.progress = percent
          this.jobs.set(jobId, info)
          this.emit('update', info)
        }
      },
    }

    const runTask = () => {
      const taskPromise = (async () => {
        try {
          // Bug #5 fix: guard against cancel/drain race — if the job was cancelled
          // between pendingQueue.shift() and runTask() execution, abort immediately.
          if (abortController.signal.aborted) {
            throw new Error('Job cancelled before starting')
          }

          jobInfo.status = 'running'
          jobInfo.startedAt = Date.now()
          this.emit('update', jobInfo)

          const result = await job.task(context)

          jobInfo.status = 'completed'
          jobInfo.completedAt = Date.now()
          jobInfo.progress = 100
          this.jobs.set(jobId, jobInfo)
          this.emit('update', jobInfo)

          return result
        } catch (error: any) {
          const isAborted = abortController.signal.aborted
          const isCancelMsg =
            error?.message?.includes('cancelled') ||
            error?.message?.includes('dừng') ||
            error?.message?.includes('aborted') ||
            error?.name === 'AbortError'
          if (isAborted || isCancelMsg) {
            jobInfo.status = 'cancelled'
          } else {
            jobInfo.status = 'failed'
            jobInfo.error = error?.message || String(error)
          }
          jobInfo.completedAt = Date.now()
          this.jobs.set(jobId, jobInfo)
          this.emit('update', jobInfo)
          throw error
        } finally {
          this.running.delete(jobId)
          this.abortControllers.delete(jobId)
          // Start next pending job (if any)
          this.drainPending()
        }
      })()

      this.running.set(jobId, taskPromise)
      return taskPromise
    }

    // Enforce concurrency limit: queue if at capacity
    let taskPromise: Promise<T>
    if (this.runningCount < this.maxConcurrent) {
      taskPromise = runTask() as Promise<T>
    } else {
      taskPromise = new Promise<T>((resolve, reject) => {
        this.pendingQueue.push({
          jobId,
          fn: () => {
            // If job was cancelled while pending, skip execution
            const info = this.jobs.get(jobId)
            if (info?.status === 'cancelled') {
              reject(new Error('Job cancelled before starting'))
              return
            }
            runTask().then(resolve, reject)
          },
        })
      })
    }

    return {
      jobId,
      result: taskPromise,
      cancel: async () => {
        await this.cancelJob(jobId)
        if (job.onCancel) {
          job.onCancel(jobId)
        }
      },
    }
  }

  /**
   * Hủy job
   */
  async cancelJob(jobId: string): Promise<void> {
    const jobInfo = this.jobs.get(jobId)
    if (!jobInfo) return

    if (jobInfo.status === 'running' || jobInfo.status === 'pending') {
      const abortController = this.abortControllers.get(jobId)
      if (abortController) {
        abortController.abort()
      }

      jobInfo.status = 'cancelled'
      jobInfo.completedAt = Date.now()
      this.jobs.set(jobId, jobInfo)
      this.emit('update', jobInfo)

      // Remove cancelled job from pending queue so it is not started when a slot opens
      this.pendingQueue = this.pendingQueue.filter((entry) => entry.jobId !== jobId)
      // Cleanup abortController to avoid memory leak
      this.abortControllers.delete(jobId)
    }
  }

  /**
   * Lấy danh sách tất cả jobs
   */
  getJobs(): JobInfo[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Lấy job theo ID
   */
  getJob(jobId: string): JobInfo | undefined {
    return this.jobs.get(jobId)
  }

  /**
   * Xóa job khỏi queue (cleanup)
   */
  removeJob(jobId: string): void {
    this.jobs.delete(jobId)
    this.running.delete(jobId)
    this.abortControllers.delete(jobId)
  }
}

// Singleton instance
export const jobQueue = new JobQueue()
