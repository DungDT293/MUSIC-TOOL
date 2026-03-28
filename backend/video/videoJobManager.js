/**
 * Video Job Manager - Quản lý đơn giản các FFmpeg processes để có thể cancel
 */
var VideoJobManager = /** @class */ (function () {
    function VideoJobManager() {
        this.jobs = new Map();
        this.cancelledJobs = new Set();
    }
    /**
     * Đăng ký job mới
     */
    VideoJobManager.prototype.registerJob = function (requestId, proc) {
        var _this = this;
        this.jobs.set(requestId, proc);
        // Auto cleanup khi process kết thúc
        proc.on('close', function () {
            _this.jobs.delete(requestId);
            // Fix Critical #1.3: Don't delete cancelledJobs here to avoid race condition
            // cancelledJobs will be cleaned up when job is actually cancelled or when explicitly cleared
        });
    };
    /**
     * Lấy job theo requestId
     */
    VideoJobManager.prototype.getJob = function (requestId) {
        return this.jobs.get(requestId);
    };
    /**
     * Hủy job theo requestId
     */
    VideoJobManager.prototype.cancelJob = function (requestId) {
        // Fix Critical #1.3: Check và mark cancelled atomically to avoid race condition
        // Nếu job đã được cancel rồi, không làm gì thêm
        if (this.cancelledJobs.has(requestId)) {
            return;
        }
        // Mark as cancelled trước (để các hàm khác có thể check)
        this.cancelledJobs.add(requestId);
        // Fix Critical #1.3: Get proc after marking cancelled to avoid race condition
        // Nếu proc không tồn tại, cancelled flag vẫn được giữ để các hàm khác có thể check
        var proc = this.jobs.get(requestId);
        if (!proc) {
            // Job không tồn tại trong Map, nhưng đã mark cancelled rồi
            // Có thể job đã hoàn thành hoặc chưa được register
            // cancelledJobs sẽ được cleanup sau khi job thực sự hoàn thành
            return;
        }
        try {
            if (!proc.killed) {
                // Thử SIGTERM trước, sau đó SIGKILL nếu cần
                proc.kill('SIGTERM');
                setTimeout(function () {
                    if (!proc.killed && proc.pid) {
                        // Chỉ kill nếu process vẫn còn sống
                        try {
                            proc.kill('SIGKILL');
                        }
                        catch (err) {
                            // Ignore errors khi kill (process có thể đã tự exit)
                        }
                    }
                }, 2000);
            }
        }
        catch (error) {
            console.warn("[VideoJobManager] Error killing process:", error);
        }
        // Không xóa job khỏi Map ngay lập tức - để process.on('close') tự cleanup
        // cancelledJobs sẽ được giữ lại để các hàm khác có thể check
    };
    /**
     * Kiểm tra job có bị cancel không
     */
    VideoJobManager.prototype.isCancelled = function (requestId) {
        return this.cancelledJobs.has(requestId);
    };
    /**
     * Clear cancelled flag cho job (dùng khi job hoàn thành thành công)
     */
    VideoJobManager.prototype.clearCancelled = function (requestId) {
        this.cancelledJobs.delete(requestId);
    };
    /**
     * Hủy tất cả jobs
     */
    VideoJobManager.prototype.cancelAll = function () {
        var requestIds = Array.from(this.jobs.keys());
        for (var _i = 0, requestIds_1 = requestIds; _i < requestIds_1.length; _i++) {
            var requestId = requestIds_1[_i];
            this.cancelJob(requestId);
        }
    };
    /**
     * Lấy tất cả active job IDs (để restore UI state)
     */
    VideoJobManager.prototype.getAllJobIds = function () {
        return Array.from(this.jobs.keys());
    };
    /**
     * Kiểm tra job có đang chạy không
     */
    VideoJobManager.prototype.hasJob = function (requestId) {
        return this.jobs.has(requestId);
    };
    return VideoJobManager;
}());
// Singleton instance
export var videoJobManager = new VideoJobManager();
