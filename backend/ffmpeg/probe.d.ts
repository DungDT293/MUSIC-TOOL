/**
 * FFmpeg Probe - Probe file để lấy metadata (audio/video)
 */
export interface ProbeResult {
    path: string;
    format: {
        duration: number;
        size: number;
        bit_rate?: number;
        start_time?: number;
        tags?: {
            title?: string;
            artist?: string;
            album?: string;
            album_artist?: string;
            genre?: string;
            date?: string;
            [key: string]: string | undefined;
        };
    };
    audio?: {
        codec: string;
        sample_rate: number;
        channels: number;
        channel_layout?: string;
    };
    video?: {
        codec: string;
        width: number;
        height: number;
        fps: number;
        pix_fmt?: string;
    };
}
/**
 * Probe file để lấy metadata (audio/video streams, format info)
 */
export declare function probeFile(filePath: string): Promise<ProbeResult>;
