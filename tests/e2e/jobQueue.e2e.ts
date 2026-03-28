/**
 * tests/e2e/jobQueue.e2e.ts
 * Playwright E2E — JobQueue integration: concurrency, cancel, drain
 *
 * NOTE: Tests chạy trực tiếp trong Node (import JobQueue), không cần
 * Electron launch. Playwright runner cho phép import module như Vitest.
 * Điều này kiểm tra behavior thực tế của class, không mock.
 */

import { test, expect } from '@playwright/test'
import path from 'node:path'

// ─── Import JobQueue từ source ─────────────────────────────────────────────

async function getJobQueue() {
  const { JobQueue } = await import(
    path.resolve(__dirname, '../../backend/jobQueue/jobQueue')
  )
  return JobQueue
}

// ─── Basic Job Execution ───────────────────────────────────────────────────

test.describe('JobQueue — basic execution', () => {
  test('runs a job and returns result', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const handle = queue.enqueue({
      type: 'e2e-basic',
      task: async () => 'e2e-result',
    })

    const result = await handle.result
    expect(result).toBe('e2e-result')
  })

  test('job status is completed after success', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const handle = queue.enqueue({
      type: 'e2e-status',
      task: async () => 42,
    })

    await handle.result
    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('completed')
    expect(info?.progress).toBe(100)
  })

  test('job status is failed on error', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const handle = queue.enqueue({
      type: 'e2e-fail',
      task: async () => {
        throw new Error('e2e-boom')
      },
    })

    await expect(handle.result).rejects.toThrow('e2e-boom')
    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('failed')
    expect(info?.error).toBe('e2e-boom')
  })
})

// ─── Concurrency ────────────────────────────────────────────────────────────

test.describe('JobQueue — concurrency enforcement', () => {
  test('maxConcurrent=2 never runs more than 2 jobs simultaneously', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    let running = 0
    let maxRunning = 0

    const makeTask = () =>
      queue.enqueue({
        type: 'concurrent',
        task: async () => {
          running++
          maxRunning = Math.max(maxRunning, running)
          await new Promise((r) => setTimeout(r, 50))
          running--
        },
      })

    const handles = [makeTask(), makeTask(), makeTask(), makeTask()]
    await Promise.all(handles.map((h: any) => h.result))

    expect(maxRunning).toBeLessThanOrEqual(2)
  })

  test('pending queue drains in order after slots free up', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(1) // maxConcurrent=1 for predictable order

    const order: number[] = []

    const h1 = queue.enqueue({
      type: 'drain-1',
      task: async () => {
        await new Promise((r) => setTimeout(r, 20))
        order.push(1)
      },
    })
    const h2 = queue.enqueue({
      type: 'drain-2',
      task: async () => {
        await new Promise((r) => setTimeout(r, 10))
        order.push(2)
      },
    })
    const h3 = queue.enqueue({
      type: 'drain-3',
      task: async () => {
        order.push(3)
      },
    })

    await Promise.all([h1.result, h2.result, h3.result])

    // With maxConcurrent=1, must be in enqueue order
    expect(order).toEqual([1, 2, 3])
  })
})

// ─── Cancel ─────────────────────────────────────────────────────────────────

test.describe('JobQueue — cancel', () => {
  test('cancel() aborts running job via AbortSignal', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const handle = queue.enqueue({
      type: 'cancellable',
      task: async (ctx: any) => {
        await new Promise<void>((_, reject) => {
          const timeout = setTimeout(() => {}, 30_000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timeout)
            reject(new Error('aborted'))
          })
        })
      },
    })

    // Give it a tick to start running
    await new Promise((r) => setTimeout(r, 20))
    await handle.cancel()

    const info = queue.getJob(handle.jobId)
    expect(info?.status).toBe('cancelled')
  })

  test('onCancel callback is called when job is cancelled', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    let cancelledId: string | null = null

    const handle = queue.enqueue({
      type: 'cancellable-cb',
      task: async (ctx: any) => {
        await new Promise<void>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      },
      onCancel: (jobId: string) => {
        cancelledId = jobId
      },
    })

    await new Promise((r) => setTimeout(r, 20))
    await handle.cancel()

    expect(cancelledId).toBe(handle.jobId)
  })

  test('cancelling pending job (not yet running) removes it', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(1)

    // Fill the one slot with a slow job
    const blocker = queue.enqueue({
      type: 'blocker',
      task: async () => {
        await new Promise((r) => setTimeout(r, 100))
      },
    })

    // This job is queued (pending), not running
    const pending = queue.enqueue({
      type: 'pending-cancel',
      task: async () => 'should-not-run',
    })

    // Cancel while still pending
    await pending.cancel()
    const info = queue.getJob(pending.jobId)
    expect(info?.status).toBe('cancelled')

    // Let blocker finish
    await blocker.result
  })
})

// ─── Progress Updates ────────────────────────────────────────────────────────

test.describe('JobQueue — progress tracking', () => {
  test('updateProgress emits values in order', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const progressValues: number[] = []
    queue.on('update', (info: any) => {
      if (info.progress !== undefined) progressValues.push(info.progress)
    })

    const handle = queue.enqueue({
      type: 'progress-test',
      task: async (ctx: any) => {
        ctx.updateProgress(10)
        ctx.updateProgress(50)
        ctx.updateProgress(80)
      },
    })

    await handle.result

    expect(progressValues).toContain(10)
    expect(progressValues).toContain(50)
    expect(progressValues).toContain(80)
    expect(progressValues).toContain(100) // auto-set on completion
  })
})

// ─── Job Management ──────────────────────────────────────────────────────────

test.describe('JobQueue — job management', () => {
  test('getJobs returns all tracked jobs', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(3)

    const h1 = queue.enqueue({ type: 'a', task: async () => 1 })
    const h2 = queue.enqueue({ type: 'b', task: async () => 2 })
    const h3 = queue.enqueue({ type: 'c', task: async () => 3 })

    await Promise.all([h1.result, h2.result, h3.result])

    const jobs = queue.getJobs()
    expect(jobs.length).toBe(3)
    expect(jobs.map((j: any) => j.status).every((s: string) => s === 'completed')).toBe(true)
  })

  test('removeJob removes job from tracking', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    const h = queue.enqueue({ type: 'remove-me', task: async () => {} })
    await h.result

    queue.removeJob(h.jobId)
    expect(queue.getJob(h.jobId)).toBeUndefined()
  })

  test('getJob returns undefined for unknown jobId', async () => {
    const { JobQueue } = await import('../../backend/jobQueue/jobQueue')
    const queue = new (JobQueue as any)(2)

    expect(queue.getJob('nonexistent-id')).toBeUndefined()
  })
})
