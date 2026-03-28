/**
 * Video Job Manager - Quản lý đơn giản các FFmpeg processes để có thể cancel
 */

import { type ChildProcess } from 'child_process'

/** Max number of cancelled job IDs to retain (prevent unbounded memory growth) */
const MAX_CANCELLED_HISTORY = 200

class VideoJobManager {
  private jobs = new Map<string, ChildProcess>()
  private cancelledJobs = new Set<string>()

  /**
   * Đăng ký job mới
   */
  registerJob(requestId: string, proc: ChildProcess): void {
    this.jobs.set(requestId, proc)

    // Auto cleanup khi process kết thúc
    proc.on('close', () => {
      this.jobs.delete(requestId)
      // Cleanup cancelled flag after job finishes — safe to remove now
      this.cancelledJobs.delete(requestId)
    })
  }

  /**
   * Lấy job theo requestId
   */
  getJob(requestId: string): ChildProcess | undefined {
    return this.jobs.get(requestId)
  }

  /**
   * Hủy job theo requestId
   */
  cancelJob(requestId: string): void {
    // Fix Critical #1.3: Check và mark cancelled atomically to avoid race condition
    // Nếu job đã được cancel rồi, không làm gì thêm
    if (this.cancelledJobs.has(requestId)) {
      return
    }

    // Mark as cancelled trước (để các hàm khác có thể check)
    this.cancelledJobs.add(requestId)

    // Evict oldest entry if history cap exceeded
    if (this.cancelledJobs.size > MAX_CANCELLED_HISTORY) {
      const oldest = this.cancelledJobs.values().next().value
      if (oldest !== undefined) this.cancelledJobs.delete(oldest)
    }

    // Fix Critical #1.3: Get proc after marking cancelled to avoid race condition
    // Nếu proc không tồn tại, cancelled flag vẫn được giữ để các hàm khác có thể check
    const proc = this.jobs.get(requestId)
    if (!proc) {
      // Job không tồn tại trong Map, nhưng đã mark cancelled rồi
      // Có thể job đã hoàn thành hoặc chưa được register
      return
    }

    try {
      if (!proc.killed) {
        // Thử SIGTERM trước, sau đó SIGKILL nếu cần
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed && proc.pid) {
            // Chỉ kill nếu process vẫn còn sống
            try {
              proc.kill('SIGKILL')
            } catch (err) {
              // Ignore errors khi kill (process có thể đã tự exit)
            }
          }
        }, 2000)
      }
    } catch (error) {
      console.warn(`[VideoJobManager] Error killing process:`, error)
    }

    // Không xóa job khỏi Map ngay lập tức - để process.on('close') tự cleanup
  }

  /**
   * Kiểm tra job có bị cancel không
   */
  isCancelled(requestId: string): boolean {
    return this.cancelledJobs.has(requestId)
  }

  /**
   * Clear cancelled flag cho job (dùng khi job hoàn thành thành công)
   */
  clearCancelled(requestId: string): void {
    this.cancelledJobs.delete(requestId)
  }

  /**
   * Hủy tất cả jobs
   */
  cancelAll(): void {
    const requestIds = Array.from(this.jobs.keys())
    for (const requestId of requestIds) {
      this.cancelJob(requestId)
    }
  }

  /**
   * Lấy tất cả active job IDs (để restore UI state)
   */
  getAllJobIds(): string[] {
    return Array.from(this.jobs.keys())
  }

  /**
   * Kiểm tra job có đang chạy không
   */
  hasJob(requestId: string): boolean {
    return this.jobs.has(requestId)
  }
}

// Singleton instance
export const videoJobManager = new VideoJobManager()







