export interface VideoVerificationResult {
    durationSec: number;
    fps: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    durationDiffSec: number | null;
    durationWarning: boolean;
    decodeOk: boolean;
}
export declare function verifyOutputVideo(outputPath: string, opts?: {
    expectedDurationSec?: number | null;
    toleranceSec?: number;
    onLog?: (msg: string) => void;
}): Promise<VideoVerificationResult>;
