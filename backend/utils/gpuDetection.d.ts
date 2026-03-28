/**
 * GPU Detection and Encoder Selection
 * Detects available GPU hardware and selects optimal encoder for FFmpeg
 */
export type GpuEncoder = 'nvenc' | 'amf' | 'videotoolbox' | 'cpu';
export interface GpuInfo {
    encoder: GpuEncoder;
    available: boolean;
    name?: string;
    reason?: string;
}
/**
 * Get GPU info (cached)
 */
export declare function getGpuInfo(): Promise<GpuInfo>;
/**
 * Build FFmpeg video encoder args based on GPU availability
 */
export declare function buildVideoEncoderArgs(needsReencode: boolean, quality?: 'fast' | 'medium' | 'slow'): Promise<string[]>;
/**
 * Clear GPU cache (useful for re-detection)
 */
export declare function clearGpuCache(): void;
