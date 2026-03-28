export interface SystemInfo {
    cpuModel: string;
    cpuCores: number;
    gpuModel?: string;
    ramGB: number;
    drives: Array<{
        mount: string;
        totalGB: number;
        freeGB: number;
    }>;
    ffmpegVersion?: string;
}
export declare function getSystemInfo(): Promise<SystemInfo>;
