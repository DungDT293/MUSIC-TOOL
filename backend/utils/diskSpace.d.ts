export interface DiskSpaceInfo {
    drive: string;
    total: number;
    free: number;
}
export interface SpaceCheckResult {
    freeBytes: number;
    requiredBytes: number;
    enough: boolean;
}
export declare function getDiskSpace(targetPath: string): Promise<DiskSpaceInfo>;
export declare function checkMinimumSpace(freeBytes: number, minGigabytes: number): SpaceCheckResult;
export declare function formatBytes(bytes: number): string;
export declare function createDiskSpaceErrorMessage(info: DiskSpaceInfo, check: SpaceCheckResult, meta?: {
    tabName?: string;
    operation?: string;
    additionalInfo?: string;
}): string;
