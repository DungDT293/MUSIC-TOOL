/**
 * Result shape returned by faster_whisper_service.py
 */
export interface FasterWhisperWord {
    word: string;
    start: number;
    end: number;
}
export interface FasterWhisperSegment {
    text: string;
    start: number;
    end: number;
    words?: FasterWhisperWord[];
}
export interface FasterWhisperResult {
    text: string;
    segments: FasterWhisperSegment[];
}
interface GpuWhisperOptions {
    audioPath: string;
    language?: string;
    model?: string;
    beamSize?: number;
}
/**
 * Call external Python Faster-Whisper service on GPU.
 * This requires:
 *  - Python in PATH (or PYTHON_EXEC env)
 *  - pip install faster-whisper
 *  - CUDA/cuDNN properly installed
 */
export declare function transcribeWithFasterWhisper(options: GpuWhisperOptions): Promise<FasterWhisperResult>;
export {};
