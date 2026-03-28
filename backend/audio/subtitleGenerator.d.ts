/**
 * Subtitle Generator
 * Converts Whisper transcription with timestamps to SRT/ASS subtitle files
 * Supports word-level timestamps for karaoke effects
 */
export interface WordTimestamp {
    word: string;
    start: number;
    end: number;
}
export interface SegmentTimestamp {
    text: string;
    start: number;
    end: number;
    words?: WordTimestamp[];
}
/**
 * Parse Whisper result to segments with timestamps
 * Whisper result format: { text: string, chunks: [{ text, timestamp: [start, end] }] }
 */
export declare function parseWhisperResult(whisperResult: any): SegmentTimestamp[];
/**
 * Generate SRT subtitle file from segments
 */
export declare function generateSRT(segments: SegmentTimestamp[], outputPath: string): void;
/**
 * Generate ASS subtitle file with karaoke effects
 * ASS format supports advanced styling and karaoke effects
 */
export declare function generateASS(segments: SegmentTimestamp[], outputPath: string, options?: {
    fontSize?: number;
    fontColor?: string;
    highlightColor?: string;
    position?: 'top' | 'center' | 'bottom';
    style?: 'simple' | 'karaoke' | 'word-by-word' | 'dynamic';
    leadInSeconds?: number;
}): void;
/**
 * Generate subtitle file (SRT or ASS) from Whisper result
 */
export declare function generateSubtitleFile(whisperResult: any, outputPath: string, format?: 'srt' | 'ass', options?: SubtitleGeneratorOptions): Promise<void>;
