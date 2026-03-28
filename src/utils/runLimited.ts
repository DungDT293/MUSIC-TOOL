/**
 * runLimited — Concurrent task executor with proper async scheduling.
 * STAB-01 fix: previous copy-pasted implementation had a race condition where
 * processNext() was called without await and Promise.all resolved too early.
 *
 * This implementation uses a correct producer-consumer pattern:
 * - Spawn exactly `limit` workers upfront, each looping until no tasks remain.
 * - await Promise.all(workers) guarantees all tasks are complete before resolving.
 */
export async function runLimited<T>(
  tasks: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (tasks.length === 0) return

  let index = 0

  // Each worker picks the next available task until none remain
  const runWorker = async (): Promise<void> => {
    while (index < tasks.length) {
      const i = index++
      if (i >= tasks.length) break
      const item = tasks[i]!
      await worker(item)
    }
  }

  // Start min(limit, tasks.length) concurrent workers, then wait for ALL to finish
  const workerCount = Math.min(limit, tasks.length)
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(runWorker())
  }

  await Promise.all(workers)
}
