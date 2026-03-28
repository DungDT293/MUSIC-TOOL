import { EventEmitter } from 'events';
export interface JobInfo {
    id: string;
    type: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    progress?: number;
    payload?: any;
    error?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}
export interface JobContext {
    jobId: string;
    signal: AbortSignal;
    updateProgress: (percent: number, message?: string) => void;
}
export interface JobHandle<T = any> {
    jobId: string;
    result: Promise<T>;
    cancel: () => Promise<void>;
}
interface JobTask<T = any> {
    type: string;
    payload?: any;
    task: (ctx: JobContext) => Promise<T>;
    onCancel?: (jobId: string) => void;
}
declare class JobQueue extends EventEmitter {
    private jobs;
    private running;
    private abortControllers;
    /**
     * Thêm job vào queue và chạy ngay
     */
    enqueue<T = any>(job: JobTask<T>): JobHandle<T>;
    /**
     * Hủy job
     */
    cancelJob(jobId: string): Promise<void>;
    /**
     * Lấy danh sách tất cả jobs
     */
    getJobs(): JobInfo[];
    /**
     * Lấy job theo ID
     */
    getJob(jobId: string): JobInfo | undefined;
    /**
     * Xóa job khỏi queue (cleanup)
     */
    removeJob(jobId: string): void;
}
export declare const jobQueue: JobQueue;
export {};
