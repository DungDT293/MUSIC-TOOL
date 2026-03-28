export type DiskType = 'SSD' | 'HDD' | 'UNKNOWN';
export interface DiskDriveInfo {
    drive: string;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
    usedPercent: number | null;
    diskType?: DiskType;
}
export interface DiskTypeSummary {
    type: DiskType;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    driveCount: number;
}
export interface DiskInfoSummary {
    drives: DiskDriveInfo[];
    byType: {
        ssd: DiskTypeSummary | null;
        hdd: DiskTypeSummary | null;
    };
    updatedAt: number;
}
export declare function getDiskInfo(): Promise<DiskInfoSummary>;
