export interface PlaybackTestResult {
    player: 'mpv' | 'vlc' | null;
    success: boolean;
    exitCode: number | null;
}
export declare function runPlaybackTest(outputPath: string): Promise<PlaybackTestResult>;
