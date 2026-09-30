/**
 * tests/unit/backend/jobQueue.test.ts
 * Unit tests cho JobQueue — concurrency, cancel, pending queue drain
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JobQueue } from '../../../backend/jobQueue/jobQueue'

// Re-export the class for testing (jobQueue.ts exports singleton + class)
// We import the class directly via named export

describe('JobQueue', () => {
  let queue: InstanceType<typeof JobQueue>

  beforeEach(() => {
    // Fresh queue with maxConcurrent=2 for testing
    queue = new (JobQueue as any)(2)
  })

  // ─── Enqueue & basic run ──────────────────────────────────────────────────

  it('runs a simple job and returns result', async () => {
    const handle = queue.enqueue({
      type: 'test',
      task: async () => 'hello',
    })
    const result = await handle.result
    expect(result).toBe('hello')
  })

  it('marks job as completed after success', async () => {
    const handle = queue.enqueue({
      type: 'test',
      task: async () => 42,
    })
    await handle.result
    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('completed')
    expect(info?.progress).toBe(100)
    expect(info?.completedAt).toBeTypeOf('number')
  })

  it('marks job as failed on error', async () => {
    const handle = queue.enqueue({
      type: 'test',
      task: async () => { throw new Error('boom') },
    })
    await expect(handle.result).rejects.toThrow('boom')
    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('failed')
    expect(info?.error).toBe('boom')
  })

  it('updateProgress emits progress value', async () => {
    const progressValues: number[] = []
    queue.on('update', (info) => {
      if (info.progress !== undefined) progressValues.push(info.progress)
    })

    const handle = queue.enqueue({
      type: 'test',
      task: async (ctx) => {
        ctx.updateProgress(25)
        ctx.updateProgress(75)
      },
    })
    await handle.result
    expect(progressValues).toContain(25)
    expect(progressValues).toContain(75)
    expect(progressValues).toContain(100)
  })

  // ─── Concurrency limit ────────────────────────────────────────────────────

  it('respects maxConcurrent=2 — queues 3rd job as pending', async () => {
    let running = 0
    let maxRunning = 0

    const makeSlowTask = () => {
      return queue.enqueue({
        type: 'slow',
        task: async () => {
          running++
          maxRunning = Math.max(maxRunning, running)
          await new Promise(r => setTimeout(r, 30))
          running--
        },
      })
    }

    const h1 = makeSlowTask()
    const h2 = makeSlowTask()
    const h3 = makeSlowTask() // should be queued

    await Promise.all([h1.result, h2.result, h3.result])
    // Should never have more than 2 running at once
    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  it('drains pending queue after a job completes', async () => {
    const order: number[] = []

    const h1 = queue.enqueue({ type: 'a', task: async () => { await new Promise(r => setTimeout(r, 20)); order.push(1) } })
    const h2 = queue.enqueue({ type: 'b', task: async () => { await new Promise(r => setTimeout(r, 20)); order.push(2) } })
    const h3 = queue.enqueue({ type: 'c', task: async () => { order.push(3) } }) // queued, starts after h1 or h2

    await Promise.all([h1.result, h2.result, h3.result])
    expect(order).toContain(3)
    expect(order.length).toBe(3)
  })

  // ─── Cancel ───────────────────────────────────────────────────────────────

  it('cancels a running job via AbortSignal', async () => {
    const handle = queue.enqueue({
      type: 'cancellable',
      task: async (ctx) => {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 5000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(new Error('Job cancelled — dừng'))
          })
        })
      },
    })

    // Cancel after a tick
    await new Promise(r => setTimeout(r, 10))
    // Suppress the unhandled rejection from the cancelled task
    handle.result.catch(() => {})
    await handle.cancel()

    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('cancelled')
  })

  it('calls onCancel callback when job is cancelled', async () => {
    const onCancel = vi.fn()
    const handle = queue.enqueue({
      type: 'cancellable',
      task: async (ctx) => {
        await new Promise<void>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('cancelled')))
        })
      },
      onCancel,
    })

    await new Promise(r => setTimeout(r, 10))
    // Suppress the unhandled rejection from the cancelled task
    handle.result.catch(() => {})
    await handle.cancel()
    expect(onCancel).toHaveBeenCalledWith(handle.jobId)
  })

  it('rejects pending result and calls onCancel once', async () => {
    const first = queue.enqueue({
      type: 'blocker',
      task: async () => new Promise<void>(() => {}),
    })
    const blocker = queue.enqueue({
      type: 'blocker',
      task: async () => new Promise<void>(() => {}),
    })
    const secondCancel = vi.fn()
    const second = queue.enqueue({
      type: 'pending',
      task: async () => 'never',
      onCancel: secondCancel,
    })
    second.result.catch(() => {})
    await second.cancel()
    await expect(second.result).rejects.toThrow('cancelled before starting')
    expect(secondCancel).toHaveBeenCalledWith(second.jobId)
    first.result.catch(() => {})
    blocker.result.catch(() => {})
    await Promise.all([first.cancel(), blocker.cancel()])
  })

  it('does not mark cancelled task completed after late resolve', async () => {
    let resolveTask!: () => void
    const handle = queue.enqueue({
      type: 'late',
      task: async () => new Promise<void>((resolve) => { resolveTask = resolve }),
    })
    await new Promise(r => setTimeout(r, 10))
    await handle.cancel()
    resolveTask()
    await expect(handle.result).rejects.toThrow('cancelled')
    expect(queue.getJob(handle.jobId)?.status).toBe('cancelled')
  })

  // ─── getJobs / removeJob ──────────────────────────────────────────────────

  it('getJobs returns all tracked jobs', async () => {
    const h1 = queue.enqueue({ type: 'a', task: async () => 1 })
    const h2 = queue.enqueue({ type: 'b', task: async () => 2 })
    await Promise.all([h1.result, h2.result])
    const jobs = queue.getJobs()
    expect(jobs.length).toBe(2)
  })

  it('removeJob removes job from tracking', async () => {
    const h = queue.enqueue({ type: 'x', task: async () => {} })
    await h.result
    queue.removeJob(h.jobId)
    expect(queue.getJob(h.jobId)).toBeUndefined()
  })
})
