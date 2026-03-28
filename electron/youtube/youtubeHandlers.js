var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { ipcMain } from 'electron';
import { YouTubeDownloader } from '../../backend/youtube/youtubeDownloader';
import { jobQueue } from '../../backend/jobQueue/jobQueue';
// Global downloader instance
var downloader = null;
var currentYoutubeJobId = null;
/**
 * Initialize YouTube downloader và setup IPC handlers
 */
export function setupYouTubeHandlers(mainWindow) {
    var _this = this;
    console.log('[IPC] Setting up YouTube handlers...');
    // Create downloader instance
    downloader = new YouTubeDownloader();
    // Forward progress events to renderer
    downloader.on('progress', function (progress) {
        mainWindow.webContents.send('youtube:progress', progress);
    });
    downloader.on('batch-progress', function (progress) {
        mainWindow.webContents.send('youtube:batch-progress', progress);
    });
    // ============================================
    // Handler: Verify yt-dlp
    // ============================================
    ipcMain.handle('youtube:verify', function () { return __awaiter(_this, void 0, void 0, function () {
        var isAvailable, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    return [4 /*yield*/, downloader.verify()];
                case 1:
                    isAvailable = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            available: isAvailable
                        }];
                case 2:
                    error_1 = _a.sent();
                    console.error('[IPC] youtube:verify error:', error_1);
                    return [2 /*return*/, {
                            success: false,
                            error: error_1.message
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Validate URL
    // ============================================
    ipcMain.handle('youtube:validate-url', function (event, url) { return __awaiter(_this, void 0, void 0, function () {
        var isValid, type;
        return __generator(this, function (_a) {
            try {
                if (!downloader) {
                    throw new Error('Downloader not initialized');
                }
                isValid = downloader.isValidYouTubeUrl(url);
                type = downloader.detectUrlType(url);
                return [2 /*return*/, {
                        success: true,
                        isValid: isValid,
                        type: type
                    }];
            }
            catch (error) {
                console.error('[IPC] youtube:validate-url error:', error);
                return [2 /*return*/, {
                        success: false,
                        error: error.message
                    }];
            }
            return [2 /*return*/];
        });
    }); });
    // ============================================
    // Handler: Get video info
    // ============================================
    ipcMain.handle('youtube:get-video-info', function (event, url) { return __awaiter(_this, void 0, void 0, function () {
        var videoInfo, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    return [4 /*yield*/, downloader.getVideoInfo(url)];
                case 1:
                    videoInfo = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            videoInfo: videoInfo
                        }];
                case 2:
                    error_2 = _a.sent();
                    console.error('[IPC] youtube:get-video-info error:', error_2);
                    return [2 /*return*/, {
                            success: false,
                            error: error_2.message
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Get channel info
    // ============================================
    ipcMain.handle('youtube:get-channel-info', function (event, url) { return __awaiter(_this, void 0, void 0, function () {
        var channelInfo, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    return [4 /*yield*/, downloader.getChannelInfo(url)];
                case 1:
                    channelInfo = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            channelInfo: channelInfo
                        }];
                case 2:
                    error_3 = _a.sent();
                    console.error('[IPC] youtube:get-channel-info error:', error_3);
                    return [2 /*return*/, {
                            success: false,
                            error: error_3.message
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Get channel videos
    // ============================================
    ipcMain.handle('youtube:get-channel-videos', function (event, url, limit) { return __awaiter(_this, void 0, void 0, function () {
        var videos, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    return [4 /*yield*/, downloader.getChannelVideos(url, limit)];
                case 1:
                    videos = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            videos: videos
                        }];
                case 2:
                    error_4 = _a.sent();
                    console.error('[IPC] youtube:get-channel-videos error:', error_4);
                    return [2 /*return*/, {
                            success: false,
                            error: error_4.message
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Estimate channel size
    // ============================================
    ipcMain.handle('youtube:estimate-channel-size', function (event, url, quality, limit) { return __awaiter(_this, void 0, void 0, function () {
        var estimate, error_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    return [4 /*yield*/, downloader.estimateChannelSize(url, quality, limit)];
                case 1:
                    estimate = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            estimate: estimate
                        }];
                case 2:
                    error_5 = _a.sent();
                    console.error('[IPC] youtube:estimate-channel-size error:', error_5);
                    return [2 /*return*/, {
                            success: false,
                            error: error_5.message
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Download single video
    // ============================================
    ipcMain.handle('youtube:download-video', function (_event, request) { return __awaiter(_this, void 0, void 0, function () {
        var activeDownloader_1, jobHandle, outputFile, error_6;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    activeDownloader_1 = downloader;
                    console.log('[IPC] Starting video download:', request);
                    jobHandle = jobQueue.enqueue({
                        type: 'youtube:download-video',
                        payload: { url: request.url, quality: request.quality },
                        onCancel: function () { return activeDownloader_1.cancelDownload(); },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var progressListener, outputFile_1;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        currentYoutubeJobId = ctx.jobId;
                                        progressListener = function (progress) {
                                            var _a, _b;
                                            var percent = (_a = progress.percent) !== null && _a !== void 0 ? _a : (progress.type === 'complete' ? 100 : 0);
                                            ctx.updateProgress(percent, (_b = progress.message) !== null && _b !== void 0 ? _b : progress.type);
                                        };
                                        activeDownloader_1.on('progress', progressListener);
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, , 3, 4]);
                                        return [4 /*yield*/, activeDownloader_1.downloadVideo(request)];
                                    case 2:
                                        outputFile_1 = _a.sent();
                                        ctx.updateProgress(100, 'Download completed');
                                        return [2 /*return*/, outputFile_1];
                                    case 3:
                                        currentYoutubeJobId = null;
                                        activeDownloader_1.off('progress', progressListener);
                                        return [7 /*endfinally*/];
                                    case 4: return [2 /*return*/];
                                }
                            });
                        }); },
                    });
                    return [4 /*yield*/, jobHandle.result];
                case 1:
                    outputFile = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            outputFile: outputFile,
                        }];
                case 2:
                    error_6 = _a.sent();
                    console.error('[IPC] youtube:download-video error:', error_6);
                    return [2 /*return*/, {
                            success: false,
                            error: error_6.message,
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Download channel
    // ============================================
    ipcMain.handle('youtube:download-channel', function (event, params) { return __awaiter(_this, void 0, void 0, function () {
        var activeDownloader_2, jobHandle, result, error_7;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    activeDownloader_2 = downloader;
                    console.log('[IPC] Starting channel download:', params);
                    jobHandle = jobQueue.enqueue({
                        type: 'youtube:download-channel',
                        payload: { url: params.url, limit: params.options.limit },
                        onCancel: function () { return activeDownloader_2.cancelDownload(); },
                        task: function (ctx) { return __awaiter(_this, void 0, void 0, function () {
                            var progressListener, batchListener, result_1, _a;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        currentYoutubeJobId = ctx.jobId;
                                        progressListener = function (progress) {
                                            var _a, _b;
                                            var percent = (_a = progress.percent) !== null && _a !== void 0 ? _a : 0;
                                            ctx.updateProgress(percent, (_b = progress.message) !== null && _b !== void 0 ? _b : progress.type);
                                        };
                                        batchListener = function (batch) {
                                            var _a;
                                            var percent = (_a = batch.overallPercent) !== null && _a !== void 0 ? _a : 0;
                                            ctx.updateProgress(percent, "Channel: ".concat(batch.currentVideoTitle));
                                        };
                                        activeDownloader_2.on('progress', progressListener);
                                        activeDownloader_2.on('batch-progress', batchListener);
                                        _b.label = 1;
                                    case 1:
                                        _b.trys.push([1, , 6, 7]);
                                        if (!params.options.concurrent) return [3 /*break*/, 3];
                                        return [4 /*yield*/, activeDownloader_2.downloadChannelConcurrent(params.url, params.outputDir, params.quality, params.options)];
                                    case 2:
                                        _a = _b.sent();
                                        return [3 /*break*/, 5];
                                    case 3: return [4 /*yield*/, activeDownloader_2.downloadChannel(params.url, params.outputDir, params.quality, params.options)];
                                    case 4:
                                        _a = _b.sent();
                                        _b.label = 5;
                                    case 5:
                                        result_1 = _a;
                                        ctx.updateProgress(100, 'Channel download completed');
                                        return [2 /*return*/, result_1];
                                    case 6:
                                        currentYoutubeJobId = null;
                                        activeDownloader_2.off('progress', progressListener);
                                        activeDownloader_2.off('batch-progress', batchListener);
                                        return [7 /*endfinally*/];
                                    case 7: return [2 /*return*/];
                                }
                            });
                        }); },
                    });
                    return [4 /*yield*/, jobHandle.result];
                case 1:
                    result = _a.sent();
                    return [2 /*return*/, {
                            success: true,
                            downloaded: result.downloaded,
                            failed: result.failed,
                        }];
                case 2:
                    error_7 = _a.sent();
                    console.error('[IPC] youtube:download-channel error:', error_7);
                    return [2 /*return*/, {
                            success: false,
                            error: error_7.message,
                        }];
                case 3: return [2 /*return*/];
            }
        });
    }); });
    // ============================================
    // Handler: Cancel download
    // ============================================
    ipcMain.handle('youtube:cancel-download', function () { return __awaiter(_this, void 0, void 0, function () {
        var error_8;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    if (!downloader) {
                        throw new Error('Downloader not initialized');
                    }
                    if (!currentYoutubeJobId) return [3 /*break*/, 2];
                    return [4 /*yield*/, jobQueue.cancelJob(currentYoutubeJobId)];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 3];
                case 2:
                    downloader.cancelDownload();
                    _a.label = 3;
                case 3: return [2 /*return*/, {
                        success: true
                    }];
                case 4:
                    error_8 = _a.sent();
                    console.error('[IPC] youtube:cancel-download error:', error_8);
                    return [2 /*return*/, {
                            success: false,
                            error: error_8.message
                        }];
                case 5: return [2 /*return*/];
            }
        });
    }); });
    console.log('[IPC] YouTube handlers setup complete');
}
/**
 * Cleanup YouTube handlers
 */
export function cleanupYouTubeHandlers() {
    console.log('[IPC] Cleaning up YouTube handlers...');
    if (downloader) {
        downloader.removeAllListeners();
        downloader = null;
    }
    // Remove IPC handlers
    ipcMain.removeHandler('youtube:verify');
    ipcMain.removeHandler('youtube:validate-url');
    ipcMain.removeHandler('youtube:get-video-info');
    ipcMain.removeHandler('youtube:get-channel-info');
    ipcMain.removeHandler('youtube:get-channel-videos');
    ipcMain.removeHandler('youtube:estimate-channel-size');
    ipcMain.removeHandler('youtube:download-video');
    ipcMain.removeHandler('youtube:download-channel');
    ipcMain.removeHandler('youtube:cancel-download');
    console.log('[IPC] YouTube handlers cleaned up');
}
