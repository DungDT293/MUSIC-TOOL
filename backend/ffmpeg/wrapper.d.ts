export interface FfmpegProgress {
    timeSec: number;
    rawTime?: string;
}
export interface FfmpegExecOptions {
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
    onProgress?: (p: FfmpegProgress) => void;
    timeoutMs?: number;
    signal?: AbortSignal;
    requestId?: string;
}
export declare function runFfmpeg(opts: FfmpegExecOptions): Promise<{
    code: number;
    stdout: string;
    stderr: string;
}>;
export declare function runFfprobe(args: string[]): Promise<string>;
