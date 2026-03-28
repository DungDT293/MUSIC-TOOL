import type { ScannedTrack } from './scanMusic';
export interface PlaylistTrack extends ScannedTrack {
    order: number;
    cumulativeDuration: number;
}
export interface PlaylistDefinition {
    id: string;
    name: string;
    targetDurationSec: number;
    totalDurationSec: number;
    priorityDurationSec: number;
    randomDurationSec: number;
    priorityCount: number;
    randomCount: number;
    tracks: PlaylistTrack[];
    createdAt: number;
}
export interface BuildPlaylistsOptions {
    tracks: ScannedTrack[];
    pinnedTrackIds: string[];
    playlistCount: number;
    targetDurationMinutes: number;
    priorityRatioMin?: number;
    priorityRatioMax?: number;
}
export declare function buildPlaylists(options: BuildPlaylistsOptions): PlaylistDefinition[];
export declare function savePlaylists(list: PlaylistDefinition[]): void;
export declare function getPlaylists(): PlaylistDefinition[];
export declare function getPlaylistById(id: string): PlaylistDefinition | undefined;
export declare function clearPlaylists(): void;
