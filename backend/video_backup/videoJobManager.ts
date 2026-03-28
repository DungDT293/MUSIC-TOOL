/**
 * VIDEO TURBO ENGINE - Job Manager
 * Quản lý active FFmpeg processes và cancel jobs
 */

import { type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

export interface VideoJob {
  requestId: string
  process: ChildProcess
  type: 'cut' | 'split' | 'merge'
  inputPath?: string
  outputPath?: string
  ramBuffer?: any // RAM buffer reference để cleanup
  groupId?: string // Group ID để cancel-group
  createdAt: number
}

class VideoJobManager {
  private jobs = new Map<string, VideoJob>()
  private stopRequested = new Set<string>()
  private groupJobs = new Map<string, Set<string>>() // groupId → Set<requestId>

  /**
   * Đăng ký job mới
   */
  registerJob(
    process: ChildProcess,
    type: VideoJob['type'],
    inputPath?: string,
    outputPath?: string,
    ramBuffer?: any,
    groupId?: string
  ): string {
    const requestId = randomUUID()
    
    const job: VideoJob = {
      requestId,
      process,
      type,
      inputPath,
      outputPath,
      ramBuffer,
      groupId,
      createdAt: Date.now(),
    }

    this.jobs.set(requestId, job)

    // Track group nếu có
    if (groupId) {
      if (!this.groupJobs.has(groupId)) {
        this.groupJobs.set(groupId, new Set())
      }
      this.groupJobs.get(groupId)!.add(requestId)
    }

    // Auto cleanup khi process kết thúc
    process.on('close', () => {
      this.jobs.delete(requestId)
      this.stopRequested.delete(requestId)
      
      // Remove from group
      if (groupId && this.groupJobs.has(groupId)) {
        this.groupJobs.get(groupId)!.delete(requestId)
        if (this.groupJobs.get(groupId)!.size === 0) {
          this.groupJobs.delete(groupId)
        }
      }
    })

    console.log(`[VideoJobManager] Registered job ${requestId} (${type})${groupId ? ` in group ${groupId}` : ''}`)
    return requestId
  }

  /**
   * Hủy job theo requestId
   */
  cancelJob(requestId: string): boolean {
    const job = this.jobs.get(requestId)
    if (!job) {
      console.warn(`[VideoJobManager] Job ${requestId} not found`)
      return false
    }

    console.log(`[VideoJobManager] Cancelling job ${requestId} (${job.type})`)

    // Kill process
    try {
      if (job.process && !job.process.killed) {
        job.process.kill('SIGTERM')
        // Force kill sau 2 giây nếu chưa chết
        setTimeout(() => {
          if (!job.process.killed) {
            job.process.kill('SIGKILL')
          }
        }, 2000)
      }
    } catch (error) {
      console.warn(`[VideoJobManager] Error killing process:`, error)
    }

    // Release RAM buffer nếu có
    if (job.ramBuffer) {
      try {
        // @ts-ignore
        job.ramBuffer.buffer = null
        console.log(`[VideoJobManager] RAM buffer released for ${requestId}`)
      } catch (error) {
        console.warn(`[VideoJobManager] Error releasing RAM buffer:`, error)
      }
    }

    // Mark as stop requested
    this.stopRequested.add(requestId)

    // Remove from jobs
    this.jobs.delete(requestId)

    return true
  }

  /**
   * Hủy tất cả jobs
   */
  cancelAllJobs(): number {
    const requestIds = Array.from(this.jobs.keys())
    let cancelled = 0

    for (const requestId of requestIds) {
      if (this.cancelJob(requestId)) {
        cancelled++
      }
    }

    console.log(`[VideoJobManager] Cancelled ${cancelled} jobs`)
    return cancelled
  }

  /**
   * Kiểm tra job có bị yêu cầu dừng không
   */
  isStopRequested(requestId: string): boolean {
    return this.stopRequested.has(requestId)
  }

  /**
   * Đánh dấu job bị yêu cầu dừng (cho multi-job)
   */
  requestStop(requestId: string): void {
    this.stopRequested.add(requestId)
  }

  /**
   * Lấy thông tin job
   */
  getJob(requestId: string): VideoJob | undefined {
    return this.jobs.get(requestId)
  }

  /**
   * Lấy tất cả active jobs
   */
  getAllJobs(): VideoJob[] {
    return Array.from(this.jobs.values())
  }

  /**
   * Hủy tất cả jobs trong một group
   */
  cancelGroup(groupId: string): number {
    const groupJobIds = this.groupJobs.get(groupId)
    if (!groupJobIds || groupJobIds.size === 0) {
      console.warn(`[VideoJobManager] Group ${groupId} not found or empty`)
      return 0
    }

    console.log(`[VideoJobManager] Cancelling group ${groupId} (${groupJobIds.size} jobs)`)
    
    // Mark group as stop requested
    this.requestStop(groupId)
    
    // Cancel tất cả jobs trong group
    let cancelled = 0
    for (const requestId of groupJobIds) {
      if (this.cancelJob(requestId)) {
        cancelled++
      }
    }

    // Cleanup group
    this.groupJobs.delete(groupId)
    this.stopRequested.delete(groupId)

    console.log(`[VideoJobManager] Cancelled ${cancelled} jobs in group ${groupId}`)
    return cancelled
  }

  /**
   * Cleanup tất cả jobs (shutdown)
   */
  cleanup(): void {
    this.cancelAllJobs()
    this.jobs.clear()
    this.stopRequested.clear()
    this.groupJobs.clear()
  }
}

// Singleton instance
export const videoJobManager = new VideoJobManager()

