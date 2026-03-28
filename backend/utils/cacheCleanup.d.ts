/**
 * Kiểm tra và xóa cache nếu version mới hơn
 * Chỉ xóa cache khi version thay đổi, không xóa khi downgrade
 */
export declare function checkAndCleanCacheOnUpdate(): Promise<void>;
