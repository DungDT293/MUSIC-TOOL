export interface RealtimeStats {
    cpuPercent: number | null;
    gpuPercent: number | null;
    diskThroughputMBps: number | null;
    diskReadMBps: number | null;
    diskWriteMBps: number | null;
}
export declare function getRealtimeStats(): Promise<RealtimeStats>;
