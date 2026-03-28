/**
 * Video Job Manager - Quản lý đơn giản các FFmpeg processes để có thể cancel
 */
import { type ChildProcess } from 'child_process';
declare class VideoJobManager {
    private jobs;
    private cancelledJobs;
    /**
     * Đăng ký job mới
     */
    registerJob(requestId: string, proc: ChildProcess): void;
    /**
     * Lấy job theo requestId
     */
    getJob(requestId: string): ChildProcess | undefined;
    /**
     * Hủy job theo requestId
     */
    cancelJob(requestId: string): void;
    /**
     * Kiểm tra job có bị cancel không
     */
    isCancelled(requestId: string): boolean;
    /**
     * Clear cancelled flag cho job (dùng khi job hoàn thành thành công)
     */
    clearCancelled(requestId: string): void;
    /**
     * Hủy tất cả jobs
     */
    cancelAll(): void;
    /**
     * Lấy tất cả active job IDs (để restore UI state)
     */
    getAllJobIds(): string[];
    /**
     * Kiểm tra job có đang chạy không
     */
    hasJob(requestId: string): boolean;
}
export declare const videoJobManager: VideoJobManager;
export {};
