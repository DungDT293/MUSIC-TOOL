/**
 * Video Utils - Helper functions for video validation and processing
 */
export interface ValidatedInputFile {
    path: string;
    durationSec: number;
    width?: number;
    height?: number;
    codecName?: string;
    fps?: number;
    sizeBytes?: number;
}
/**
 * Validate input files by probing them with ffprobe
 * Returns valid files and list of invalid file paths
 */
export declare function validateInputFiles(paths: string[], concurrency?: number): Promise<{
    valid: ValidatedInputFile[];
    invalid: string[];
}>;
