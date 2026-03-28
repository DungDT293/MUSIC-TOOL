/**
 * Shared Progress Engine for Video Jobs
 * Unified types and helpers for single-cut, multi-cut, and merge operations
 */
/**
 * Safe number conversion with fallback
 */
export function safeNumber(v, fallback) {
    if (fallback === void 0) { fallback = 0; }
    return typeof v === 'number' && !Number.isNaN(v) && Number.isFinite(v) ? v : fallback;
}
/**
 * Build SingleCutProgress with safe defaults
 */
export function buildSingleCutProgress(partial) {
    var _a, _b;
    return {
        mode: 'single-cut',
        requestId: partial.requestId,
        percent: safeNumber(partial.percent, 0),
        timeSec: safeNumber(partial.timeSec, 0),
        totalDurationSec: safeNumber(partial.totalDurationSec, 0),
        speedX: (_a = partial.speedX) !== null && _a !== void 0 ? _a : null,
        etaSec: (_b = partial.etaSec) !== null && _b !== void 0 ? _b : null,
        currentSegment: safeNumber(partial.currentSegment, 0),
        totalSegments: safeNumber(partial.totalSegments, 0),
    };
}
/**
 * Build MultiCutProgress with safe defaults
 */
export function buildMultiCutProgress(partial) {
    var _a, _b, _c, _d;
    return {
        mode: 'multi-cut',
        requestId: partial.requestId,
        percent: safeNumber(partial.percent, 0),
        timeSec: safeNumber(partial.timeSec, 0),
        totalDurationSec: safeNumber(partial.totalDurationSec, 0),
        speedX: (_a = partial.speedX) !== null && _a !== void 0 ? _a : null,
        etaSec: (_b = partial.etaSec) !== null && _b !== void 0 ? _b : null,
        currentFileIndex: safeNumber(partial.currentFileIndex, 0),
        totalFiles: safeNumber(partial.totalFiles, 0),
        currentFilePercent: safeNumber(partial.currentFilePercent, 0),
        currentFileSegment: safeNumber(partial.currentFileSegment, 0),
        currentFileTotalSegments: safeNumber(partial.currentFileTotalSegments, 0),
        currentFileSpeedX: (_c = partial.currentFileSpeedX) !== null && _c !== void 0 ? _c : null,
        currentFileEtaSec: (_d = partial.currentFileEtaSec) !== null && _d !== void 0 ? _d : null,
        overallPercent: safeNumber(partial.overallPercent, 0),
        currentFilePath: partial.currentFilePath,
        error: partial.error,
        completed: partial.completed,
        message: partial.message,
    };
}
/**
 * Build MergeProgress with safe defaults
 */
export function buildMergeProgress(partial) {
    var _a, _b, _c;
    return {
        mode: 'merge',
        requestId: partial.requestId,
        percent: safeNumber(partial.percent, 0),
        timeSec: safeNumber(partial.timeSec, 0),
        totalDurationSec: safeNumber(partial.totalDurationSec, 0),
        speedX: (_a = partial.speedX) !== null && _a !== void 0 ? _a : null,
        etaSec: (_b = partial.etaSec) !== null && _b !== void 0 ? _b : null,
        stage: partial.stage,
        batchIndex: safeNumber(partial.batchIndex, 0),
        totalBatches: safeNumber(partial.totalBatches, 0),
        currentJob: partial.currentJob,
        totalJobs: partial.totalJobs,
        currentFile: partial.currentFile,
        completed: (_c = partial.completed) !== null && _c !== void 0 ? _c : false,
        error: partial.error,
        message: partial.message,
    };
}
