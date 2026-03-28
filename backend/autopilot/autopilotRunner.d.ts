export type DayPresetId = 'tomorrowland' | 'partymix' | 'custom';
import type { SubtitleOptions } from '../../shared/videoFinalExportChannels';
export interface DayPlanDetailOverrides {
    priorityTracksPerPlaylist?: number;
    videoPickPercent?: number;
    enableCrossfade?: boolean;
    crossfadeSeconds?: number;
    titleVariant?: 'pipe' | 'fire';
    topDj?: string;
    allowDjRepeatAcrossVideos?: boolean;
    generateTracklist?: boolean;
    /** Bật re-encode + kiểm tra sâu khi ghép video (an toàn hơn nhưng chậm hơn) */
    normalizeVideoInput?: boolean;
    /** Bật chế độ nhập tiêu đề thủ công */
    useCustomTitles?: boolean;
    /** Danh sách tiêu đề tùy chỉnh (mỗi phần tử = 1 file) */
    customTitles?: string[];
    /** Cách chọn bài ưu tiên: 'auto' (mặc định) hoặc 'manual' (user tự chọn giống tab 2) */
    prioritySelectionMode?: 'auto' | 'manual';
    /** Danh sách track id ưu tiên (chọn tay) dùng khi prioritySelectionMode === 'manual' */
    priorityPinnedTrackIds?: string[];
    /** Cấu hình subtitle (phụ đề nhạc) cho video xuất ra */
    subtitle?: SubtitleOptions;
}
export interface DayPlanConfig {
    id: string;
    dateCode: string;
    playlistCount: number;
    minutesPerPlaylist: number;
    presetId: DayPresetId;
    overrides?: DayPlanDetailOverrides;
}
export interface AutopilotFoldersConfig {
    rootAudio: string;
    rootVideo: string;
    rootFinal: string;
    autoCreateDailySubfolder: boolean;
    priorityMusicFolder?: string;
    randomMusicFolder?: string;
    /** Thư mục video ưu tiên (tùy chọn) – các clip trong thư mục này sẽ được ưu tiên xuất hiện đầu video khi Final Export */
    priorityVideoFolder?: string;
}
export interface AutopilotConfig {
    dayPlans: DayPlanConfig[];
    folders: AutopilotFoldersConfig;
}
export type AutopilotStatus = 'idle' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'error' | 'cancelling';
export interface AutopilotProgress {
    status: AutopilotStatus;
    currentDayIndex: number | null;
    currentStep: 1 | 2 | 3 | 4 | 5 | null;
    stepPercent: number;
    message?: string;
    error?: string;
    videoSelectedCount?: number;
    videoTargetMin?: number;
}
export type AutopilotProgressListener = (progress: AutopilotProgress) => void;
export declare function getAutopilotProgress(): AutopilotProgress;
export declare function onAutopilotProgress(listener: AutopilotProgressListener): void;
export declare function offAutopilotProgress(): void;
export declare function onAutopilotLog(listener: (log: {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}) => void): void;
export declare function offAutopilotLog(): void;
export declare function cancelAutopilot(): void;
export declare function startAutopilot(config: AutopilotConfig): Promise<void>;
