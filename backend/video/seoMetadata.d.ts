export interface SeoMetadataRequest {
    files: Array<{
        path: string;
        title: string;
    }>;
    mode: 'title' | 'genre';
    channelName: string;
    channelUrl: string;
    genre: string;
    tags: string;
}
export interface SeoMetadataResult {
    file: string;
    success: boolean;
    error?: string;
}
export declare function applySeoMetadata(req: SeoMetadataRequest): Promise<SeoMetadataResult[]>;
