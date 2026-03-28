var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
import { detectTracklist, formatTracklistForFile } from './tracklistDetector';
var YouTubeDownloader = /** @class */ (function (_super) {
    __extends(YouTubeDownloader, _super);
    function YouTubeDownloader() {
        var _this = _super.call(this) || this;
        // private ffmpegPath: string; // Reserved for future upscale feature
        _this.currentProcess = null;
        // Determine yt-dlp path based on platform and environment
        // Use same logic as FFmpeg config
        var platform = process.platform;
        var binDir;
        var isPackaged = false;
        try {
            // Try to get isPackaged from Electron app (only available in main process)
            var app = require('electron').app;
            isPackaged = app.isPackaged;
        }
        catch (_a) {
            // If not in main process or electron not loaded, use fallback
            var resourcesPath = process.resourcesPath;
            if (resourcesPath && typeof resourcesPath === 'string') {
                // In DEV, resourcesPath points to node_modules/electron/dist/resources
                // In PROD, resourcesPath points to app resources
                var isNodeModulesPath = resourcesPath.includes('node_modules') && resourcesPath.includes('electron');
                isPackaged = !isNodeModulesPath;
            }
        }
        if (isPackaged) {
            // Production: yt-dlp is in resources/bin (extraResources)
            var resourcesPath = process.resourcesPath || process.resourcesPath || path.join(process.execPath, '..', 'resources');
            binDir = path.join(resourcesPath, 'bin');
        }
        else {
            // Development: yt-dlp is in bin/ at project root
            binDir = path.join(process.cwd(), 'bin');
        }
        if (platform === 'win32') {
            _this.ytDlpPath = path.join(binDir, 'yt-dlp.exe');
        }
        else {
            _this.ytDlpPath = path.join(binDir, 'yt-dlp');
        }
        console.log("[YouTubeDownloader] yt-dlp path: ".concat(_this.ytDlpPath));
        console.log("[YouTubeDownloader] isPackaged: ".concat(isPackaged, ", binDir: ").concat(binDir, ", cwd: ").concat(process.cwd()));
        return _this;
        // Get FFmpeg path (reserved for future upscale feature)
        // const ffmpegPaths = getFfmpegPaths();
        // this.ffmpegPath = ffmpegPaths.ffmpeg;
    }
    /**
     * Verify yt-dlp is available
     */
    YouTubeDownloader.prototype.verify = function () {
        return __awaiter(this, void 0, void 0, function () {
            var version, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, fs.access(this.ytDlpPath)];
                    case 1:
                        _a.sent();
                        return [4 /*yield*/, this.getVersion()];
                    case 2:
                        version = _a.sent();
                        console.log("[YouTubeDownloader] yt-dlp version: ".concat(version));
                        return [2 /*return*/, true];
                    case 3:
                        error_1 = _a.sent();
                        console.error('[YouTubeDownloader] yt-dlp not found:', error_1);
                        return [2 /*return*/, false];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get yt-dlp version
     */
    YouTubeDownloader.prototype.getVersion = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var process = spawn(_this.ytDlpPath, ['--version']);
                        var output = '';
                        process.stdout.on('data', function (data) {
                            output += data.toString().trim();
                        });
                        process.stderr.on('data', function (data) {
                            // Version might be in stderr
                            var stderrOutput = data.toString().trim();
                            if (stderrOutput && !output) {
                                output = stderrOutput;
                            }
                        });
                        process.on('close', function (code) {
                            if (code === 0 || output) {
                                resolve(output || 'unknown');
                            }
                            else {
                                reject(new Error('Failed to get yt-dlp version'));
                            }
                        });
                        process.on('error', function (error) {
                            reject(new Error("Failed to spawn yt-dlp: ".concat(error.message)));
                        });
                    })];
            });
        });
    };
    /**
     * Check if URL is valid YouTube URL
     */
    YouTubeDownloader.prototype.isValidYouTubeUrl = function (url) {
        var patterns = [
            /^https?:\/\/(www\.)?youtube\.com\/watch\?v=.+/, // Video
            /^https?:\/\/youtu\.be\/.+/, // Short URL
            /^https?:\/\/(www\.)?youtube\.com\/channel\/.+/, // Channel
            /^https?:\/\/(www\.)?youtube\.com\/c\/.+/, // Custom channel
            /^https?:\/\/(www\.)?youtube\.com\/@.+/, // Handle
            /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=.+/, // Playlist
            /^https?:\/\/(www\.)?youtube\.com\/user\/.+/ // User
        ];
        return patterns.some(function (pattern) { return pattern.test(url); });
    };
    /**
     * Detect URL type
     */
    YouTubeDownloader.prototype.detectUrlType = function (url) {
        if (url.includes('/watch?v=') || url.includes('youtu.be/')) {
            return 'video';
        }
        if (url.includes('/channel/') || url.includes('/c/') || url.includes('/@') || url.includes('/user/')) {
            return 'channel';
        }
        if (url.includes('/playlist?list=')) {
            return 'playlist';
        }
        return 'unknown';
    };
    /**
     * Get quality format string for yt-dlp
     */
    YouTubeDownloader.prototype.getQualityFormat = function (quality) {
        // Format: bestvideo + bestaudio, merged to mp4
        // Sử dụng format selector theo best practices từ GitHub projects
        // bv* = best video (tất cả codecs), ba = best audio
        // Ưu tiên format đúng height, sau đó format cao nhất có sẵn
        var formats = {
            'best': 'bv*+ba/b',
            // 2160p: Ưu tiên đúng 2160, sau đó format cao nhất <= 2160
            '2160': 'bv*[height=2160]+ba/bv*[height>=2160]+ba/bv*[height<=2160]+ba/b[height<=2160]',
            // 1440p: Ưu tiên đúng 1440, sau đó format cao nhất trong khoảng 1080-1440
            '1440': 'bv*[height=1440]+ba/bv*[height>=1440][height<=2160]+ba/bv*[height>=1080][height<=1440]+ba/bv*[height<=1440]+ba/b[height<=1440]',
            // 1080p: Ưu tiên đúng 1080, sau đó format cao nhất có sẵn
            // Sử dụng bv* thay vì bestvideo để có nhiều codec options hơn
            '1080': 'bv*[height=1080]+ba/bv*[height>=1080][height<=1440]+ba/bv*[height>=720][height<=1080]+ba/bv*[height<=1080]+ba/b[height<=1080]',
            '720': 'bv*[height=720]+ba/bv*[height>=720][height<=1080]+ba/bv*[height>=480][height<=720]+ba/bv*[height<=720]+ba/b[height<=720]',
            '480': 'bv*[height=480]+ba/bv*[height>=480][height<=720]+bv*[height>=360][height<=480]+bv*[height<=480]+ba/b[height<=480]'
        };
        return formats[quality] || formats['best'];
    };
    /**
     * Check if yt-dlp executable exists (for backward compatibility)
     */
    YouTubeDownloader.prototype.checkYtDlpAvailable = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.verify()];
            });
        });
    };
    /**
     * Get video information without downloading
     * Thử web client trước (có format cao hơn), nếu fail thì fallback về android
     */
    YouTubeDownloader.prototype.getVideoInfo = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var clientsToTry, lastError, _i, clientsToTry_1, client, videoInfo, videoFormats, maxHeight, error_2, errorMsg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("[YouTubeDownloader] Getting info for: ".concat(url));
                        return [4 /*yield*/, this.verify()];
                    case 1:
                        if (!(_a.sent())) {
                            throw new Error("yt-dlp not found at ".concat(this.ytDlpPath, ". Please download it from https://github.com/yt-dlp/yt-dlp/releases"));
                        }
                        clientsToTry = ['web', 'ios', 'tv_embedded', 'android'];
                        lastError = null;
                        _i = 0, clientsToTry_1 = clientsToTry;
                        _a.label = 2;
                    case 2:
                        if (!(_i < clientsToTry_1.length)) return [3 /*break*/, 7];
                        client = clientsToTry_1[_i];
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, , 6]);
                        console.log("[YouTubeDownloader] Trying ".concat(client, " client for video info..."));
                        return [4 /*yield*/, this.getVideoInfoWithClient(url, client)];
                    case 4:
                        videoInfo = _a.sent();
                        videoFormats = videoInfo.formats.filter(function (f) { return f.vcodec && f.vcodec !== 'none'; });
                        maxHeight = Math.max.apply(Math, videoFormats.map(function (f) {
                            var match = f.resolution.match(/(\d+)x(\d+)/);
                            return match ? parseInt(match[2], 10) : 0;
                        }));
                        if (maxHeight >= 720 || client === 'android') {
                            // Nếu có format >= 720p hoặc đã thử hết các client khác, dùng kết quả này
                            console.log("[YouTubeDownloader] Using ".concat(client, " client - max resolution: ").concat(maxHeight, "p"));
                            return [2 /*return*/, videoInfo];
                        }
                        else {
                            console.log("[YouTubeDownloader] ".concat(client, " client only has ").concat(maxHeight, "p, trying next client..."));
                            // Tiếp tục thử client khác
                            return [3 /*break*/, 6];
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        error_2 = _a.sent();
                        errorMsg = ((error_2 === null || error_2 === void 0 ? void 0 : error_2.message) || '').toLowerCase();
                        console.warn("[YouTubeDownloader] ".concat(client, " client failed: ").concat(errorMsg.substring(0, 100)));
                        lastError = error_2;
                        // Nếu là lỗi SABR/challenge, thử client tiếp theo
                        if (errorMsg.includes('sabr') || errorMsg.includes('challenge') || errorMsg.includes('format is not available') || errorMsg.includes('only images')) {
                            return [3 /*break*/, 6];
                        }
                        // Nếu là lỗi khác, thử client tiếp theo nhưng không throw ngay
                        return [3 /*break*/, 6];
                    case 6:
                        _i++;
                        return [3 /*break*/, 2];
                    case 7: 
                    // Nếu tất cả client đều fail, throw lỗi cuối cùng
                    throw lastError || new Error('All clients failed to get video info');
                }
            });
        });
    };
    /**
     * Helper: Get video info với client cụ thể
     */
    YouTubeDownloader.prototype.getVideoInfoWithClient = function (url, client) {
        return __awaiter(this, void 0, void 0, function () {
            var args;
            var _this = this;
            return __generator(this, function (_a) {
                args = [
                    '--dump-json',
                    '--no-playlist', // Single video only (nếu URL trong playlist)
                    '--skip-download', // Don't download
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--referer', 'https://www.youtube.com/',
                    '--add-header', 'Accept-Language:en-US,en;q=0.9',
                    '--extractor-args',
                    "youtube:player_client=".concat(client),
                    url
                ];
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var proc = spawn(_this.ytDlpPath, args);
                        var stdout = '';
                        var stderr = '';
                        proc.stdout.on('data', function (data) {
                            stdout += data.toString();
                        });
                        proc.stderr.on('data', function (data) {
                            stderr += data.toString();
                        });
                        proc.on('close', function (code) {
                            var _a, _b;
                            if (code === 0) {
                                try {
                                    var rawInfo = JSON.parse(stdout);
                                    // Kiểm tra phụ đề có sẵn
                                    var subtitles = rawInfo.subtitles || rawInfo.automatic_captions || {};
                                    var subtitleLangs = Object.keys(subtitles);
                                    var hasSubtitles = subtitleLangs.length > 0;
                                    var parsedFormatsWithSize = rawInfo.formats ? rawInfo.formats.map(function (f) { return ({
                                        formatId: f.format_id || '',
                                        ext: f.ext || '',
                                        resolution: f.resolution || "".concat(f.width || 0, "x").concat(f.height || 0),
                                        fps: f.fps || 0,
                                        filesize: f.filesize || f.filesize_approx || 0,
                                        vcodec: f.vcodec || 'none',
                                        acodec: f.acodec || 'none',
                                        width: f.width || 0,
                                        height: f.height || 0
                                    }); }) : [];
                                    // Tìm format có resolution cao nhất (video only, có vcodec)
                                    var videoFormats = parsedFormatsWithSize.filter(function (f) { return f.vcodec && f.vcodec !== 'none'; });
                                    var maxHeight_1 = videoFormats.length > 0
                                        ? Math.max.apply(Math, videoFormats.map(function (f) { return f.height || 0; })) : (rawInfo.height || 0);
                                    var maxWidth = videoFormats.length > 0
                                        ? ((_a = videoFormats.find(function (f) { return f.height === maxHeight_1; })) === null || _a === void 0 ? void 0 : _a.width) || (rawInfo.width || 0)
                                        : (rawInfo.width || 0);
                                    // Convert to VideoFormat[] (bỏ width/height vì không có trong interface)
                                    var formats = parsedFormatsWithSize.map(function (f) { return ({
                                        formatId: f.formatId,
                                        ext: f.ext,
                                        resolution: f.resolution,
                                        fps: f.fps,
                                        filesize: f.filesize,
                                        vcodec: f.vcodec,
                                        acodec: f.acodec
                                    }); });
                                    // Parse to our VideoInfo format
                                    var videoInfo = {
                                        id: rawInfo.id || '',
                                        title: rawInfo.title || '',
                                        duration: rawInfo.duration || 0,
                                        thumbnail: rawInfo.thumbnail || '',
                                        description: rawInfo.description || '',
                                        uploader: rawInfo.uploader || rawInfo.channel || 'Unknown',
                                        uploadDate: rawInfo.upload_date || '',
                                        viewCount: rawInfo.view_count || 0,
                                        likeCount: rawInfo.like_count || 0,
                                        width: maxWidth, // Sử dụng resolution cao nhất
                                        height: maxHeight_1, // Sử dụng resolution cao nhất
                                        formats: formats,
                                        hasSubtitles: hasSubtitles,
                                        subtitles: subtitleLangs.map(function (lang) { return ({
                                            lang: lang,
                                            langCode: lang
                                        }); })
                                    };
                                    console.log("[YouTubeDownloader] Video info:", {
                                        title: videoInfo.title,
                                        duration: videoInfo.duration,
                                        resolution: "".concat(videoInfo.width, "x").concat(videoInfo.height),
                                        uploader: videoInfo.uploader,
                                        hasSubtitles: videoInfo.hasSubtitles,
                                        subtitleCount: ((_b = videoInfo.subtitles) === null || _b === void 0 ? void 0 : _b.length) || 0,
                                        availableFormats: videoInfo.formats.length,
                                        maxResolution: "".concat(maxWidth, "x").concat(maxHeight_1)
                                    });
                                    // Log các format có sẵn để debug
                                    if (videoInfo.formats.length > 0) {
                                        var videoOnlyFormats = videoInfo.formats.filter(function (f) { return f.vcodec && f.vcodec !== 'none'; });
                                        var uniqueResolutions = Array.from(new Set(videoOnlyFormats.map(function (f) { return f.resolution; })));
                                        console.log("[YouTubeDownloader] Available video resolutions:", uniqueResolutions);
                                        // Log format IDs có sẵn để debug
                                        var formatIds = videoOnlyFormats.map(function (f) { return "".concat(f.formatId, " (").concat(f.resolution, ", ").concat(f.vcodec, ")"); }).slice(0, 10);
                                        console.log("[YouTubeDownloader] Sample format IDs:", formatIds);
                                        // Log format cao nhất có sẵn
                                        var maxHeightFormat = videoOnlyFormats.reduce(function (max, f) {
                                            var height = parseInt(f.resolution.split('x')[1] || '0');
                                            var maxHeight = parseInt(max.resolution.split('x')[1] || '0');
                                            return height > maxHeight ? f : max;
                                        }, videoOnlyFormats[0]);
                                        if (maxHeightFormat) {
                                            console.log("[YouTubeDownloader] Highest quality format: ".concat(maxHeightFormat.formatId, " (").concat(maxHeightFormat.resolution, ", ").concat(maxHeightFormat.vcodec, ")"));
                                        }
                                    }
                                    resolve(videoInfo);
                                }
                                catch (error) {
                                    reject(new Error("Failed to parse video info: ".concat(error.message)));
                                }
                            }
                            else {
                                // Check for SABR streaming / challenge solving errors
                                var stderrLower = stderr.toLowerCase();
                                if (stderrLower.includes('sabr') || stderrLower.includes('challenge') || stderrLower.includes('format is not available') || stderrLower.includes('only images')) {
                                    reject(new Error("Web client blocked: ".concat(stderr.substring(0, 200))));
                                }
                                else {
                                    reject(new Error("yt-dlp failed: ".concat(stderr || 'Unknown error')));
                                }
                            }
                        });
                        proc.on('error', function (error) {
                            reject(new Error("Failed to spawn yt-dlp: ".concat(error.message)));
                        });
                    })];
            });
        });
    };
    /**
     * Validate download request (including disk space)
     */
    YouTubeDownloader.prototype.validateDownloadRequest = function (outputDir, estimatedSizeBytes) {
        return __awaiter(this, void 0, void 0, function () {
            var error_3, _a, getDiskSpace, checkMinimumSpace, formatBytes, diskInfo, minGB, spaceCheck, freeGB, estimatedGB, requiredGB, freeGB, error_4;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, fs.mkdir(outputDir, { recursive: true })];
                    case 1:
                        _b.sent();
                        return [3 /*break*/, 3];
                    case 2:
                        error_3 = _b.sent();
                        throw new Error("Th\u01B0 m\u1EE5c output kh\u00F4ng t\u1ED3n t\u1EA1i: ".concat(outputDir));
                    case 3: return [4 /*yield*/, import('../utils/diskSpace')];
                    case 4:
                        _a = _b.sent(), getDiskSpace = _a.getDiskSpace, checkMinimumSpace = _a.checkMinimumSpace, formatBytes = _a.formatBytes;
                        _b.label = 5;
                    case 5:
                        _b.trys.push([5, 7, , 8]);
                        return [4 /*yield*/, getDiskSpace(outputDir)];
                    case 6:
                        diskInfo = _b.sent();
                        console.log("[YouTubeDownloader] Disk space check:");
                        console.log("  Drive: ".concat(diskInfo.drive));
                        console.log("  Free: ".concat(formatBytes(diskInfo.free)));
                        minGB = 1;
                        spaceCheck = checkMinimumSpace(diskInfo.free, minGB);
                        if (!spaceCheck.enough) {
                            freeGB = spaceCheck.freeBytes / (Math.pow(1024, 3));
                            throw new Error("Kh\u00F4ng \u0111\u1EE7 dung l\u01B0\u1EE3ng \u1ED5 \u0111\u0129a!\n\n" +
                                "\u1ED4 \u0111\u0129a: ".concat(diskInfo.drive, "\n") +
                                "Dung l\u01B0\u1EE3ng tr\u1ED1ng: ".concat(freeGB.toFixed(2), " GB\n") +
                                "Y\u00EAu c\u1EA7u t\u1ED1i thi\u1EC3u: ".concat(minGB, " GB\n\n") +
                                "Vui l\u00F2ng d\u1ECDn d\u1EB9p \u1ED5 \u0111\u0129a ho\u1EB7c ch\u1ECDn th\u01B0 m\u1EE5c output kh\u00E1c.");
                        }
                        // If we have estimated size, check if enough
                        if (estimatedSizeBytes) {
                            estimatedGB = estimatedSizeBytes / (Math.pow(1024, 3));
                            requiredGB = estimatedGB + 0.5;
                            freeGB = spaceCheck.freeBytes / (Math.pow(1024, 3));
                            if (diskInfo.free < requiredGB * (Math.pow(1024, 3))) {
                                throw new Error("Kh\u00F4ng \u0111\u1EE7 dung l\u01B0\u1EE3ng \u0111\u1EC3 download!\n\n" +
                                    "\u1ED4 \u0111\u0129a: ".concat(diskInfo.drive, "\n") +
                                    "Dung l\u01B0\u1EE3ng tr\u1ED1ng: ".concat(freeGB.toFixed(2), " GB\n") +
                                    "Dung l\u01B0\u1EE3ng c\u1EA7n thi\u1EBFt: ~".concat(requiredGB.toFixed(2), " GB\n") +
                                    "Thi\u1EBFu: ".concat((requiredGB - freeGB).toFixed(2), " GB\n\n") +
                                    "Vui l\u00F2ng:\n" +
                                    "1. D\u1ECDn d\u1EB9p \u1ED5 \u0111\u0129a ".concat(diskInfo.drive, "\n") +
                                    "2. Ho\u1EB7c ch\u1ECDn th\u01B0 m\u1EE5c output \u1EDF \u1ED5 \u0111\u0129a kh\u00E1c\n" +
                                    "3. Ho\u1EB7c gi\u1EA3m s\u1ED1 l\u01B0\u1EE3ng videos c\u1EA7n download");
                            }
                            console.log("  Estimated size: ".concat(formatBytes(estimatedSizeBytes)));
                            console.log("  \u2713 Disk space OK");
                        }
                        else {
                            console.log("  \u2713 Minimum disk space OK");
                        }
                        return [3 /*break*/, 8];
                    case 7:
                        error_4 = _b.sent();
                        if (error_4.message.includes('Không đủ dung lượng')) {
                            throw error_4;
                        }
                        console.warn("[YouTubeDownloader] Disk space check warning:", error_4.message);
                        return [3 /*break*/, 8];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Cancel ongoing download
     */
    YouTubeDownloader.prototype.cancelDownload = function () {
        if (this.currentProcess) {
            console.log('[YouTubeDownloader] Cancelling download...');
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
            this.emit('progress', {
                type: 'error',
                message: 'Download cancelled by user'
            });
        }
    };
    /**
     * Parse download progress from yt-dlp output
     */
    YouTubeDownloader.prototype.parseDownloadProgress = function (output, title) {
        // Example output:
        // [download]   45.6% of  123.45MiB at    1.23MiB/s ETA 00:42
        var progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+(~?\s*[\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\d+:\d+)/);
        if (progressMatch) {
            var percent = parseFloat(progressMatch[1]);
            // const totalSize = progressMatch[2].trim(); // Not used currently
            var speed = progressMatch[3].trim();
            var eta = progressMatch[4].trim();
            // Emit progress event
            this.emit('progress', {
                type: 'download',
                title: title,
                percent: percent,
                speed: speed,
                eta: eta,
                message: "Downloading: ".concat(percent.toFixed(1), "% at ").concat(speed)
            });
        }
        // Check for other status messages
        if (output.includes('[download] Downloading video')) {
            this.emit('progress', {
                type: 'info',
                message: 'Starting download...'
            });
        }
        if (output.includes('[Merger]')) {
            this.emit('progress', {
                type: 'postprocess',
                message: 'Merging video and audio...'
            });
        }
        if (output.includes('[EmbedSubtitle]')) {
            this.emit('progress', {
                type: 'postprocess',
                message: 'Embedding subtitles...'
            });
        }
        if (output.includes('[EmbedThumbnail]')) {
            this.emit('progress', {
                type: 'postprocess',
                message: 'Embedding thumbnail...'
            });
        }
    };
    /**
     * Download single video với tự động thử các browser nếu cookies fail
     */
    YouTubeDownloader.prototype.downloadVideo = function (request) {
        return __awaiter(this, void 0, void 0, function () {
            var outputDir, outputTemplate, browsersToTry, _i, browsersToTry_1, browser, error_5, errorMsg;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Check URL
                        if (!this.isValidYouTubeUrl(request.url)) {
                            throw new Error("Invalid YouTube URL: ".concat(request.url));
                        }
                        // Validate (including disk space)
                        return [4 /*yield*/, this.validateDownloadRequest(request.outputDir)];
                    case 1:
                        // Validate (including disk space)
                        _a.sent();
                        console.log("[YouTubeDownloader] Starting download:", {
                            url: request.url,
                            quality: request.quality,
                            outputDir: request.outputDir
                        });
                        outputDir = request.outputDir;
                        outputTemplate = path.join(outputDir, '%(title)s [%(id)s].%(ext)s');
                        browsersToTry = ['chrome', 'firefox', 'edge'];
                        if (!request.cookiesFile) return [3 /*break*/, 3];
                        // Nếu user cung cấp cookies file, dùng nó
                        console.log("[YouTubeDownloader] Using cookies file: ".concat(request.cookiesFile));
                        return [4 /*yield*/, this.downloadVideoWithArgs(request, outputTemplate, ['--cookies', request.cookiesFile])];
                    case 2: return [2 /*return*/, _a.sent()];
                    case 3:
                        if (!request.cookiesFromBrowser) return [3 /*break*/, 5];
                        // Nếu user chỉ định browser, dùng nó
                        console.log("[YouTubeDownloader] Using cookies from browser: ".concat(request.cookiesFromBrowser));
                        return [4 /*yield*/, this.downloadVideoWithArgs(request, outputTemplate, ['--cookies-from-browser', request.cookiesFromBrowser])];
                    case 4: return [2 /*return*/, _a.sent()];
                    case 5:
                        _i = 0, browsersToTry_1 = browsersToTry;
                        _a.label = 6;
                    case 6:
                        if (!(_i < browsersToTry_1.length)) return [3 /*break*/, 11];
                        browser = browsersToTry_1[_i];
                        _a.label = 7;
                    case 7:
                        _a.trys.push([7, 9, , 10]);
                        console.log("[YouTubeDownloader] Trying cookies from ".concat(browser, " for better quality formats..."));
                        return [4 /*yield*/, this.downloadVideoWithArgs(request, outputTemplate, ['--cookies-from-browser', browser])];
                    case 8: return [2 /*return*/, _a.sent()];
                    case 9:
                        error_5 = _a.sent();
                        errorMsg = (error_5 === null || error_5 === void 0 ? void 0 : error_5.message) || '';
                        if (errorMsg.includes('cookie') || errorMsg.includes('Cookie') || errorMsg.includes('Could not copy') || errorMsg.includes('unsupported keyring') || errorMsg.includes('cookie database')) {
                            console.warn("[YouTubeDownloader] Failed to use cookies from ".concat(browser, ", trying next browser..."));
                            return [3 /*break*/, 10];
                        }
                        throw error_5; // Re-throw non-cookie related errors immediately
                    case 10:
                        _i++;
                        return [3 /*break*/, 6];
                    case 11:
                        // Nếu tất cả browser cookies đều fail, vẫn thử download với web,android client (không cookies)
                        // yt-dlp sẽ tự động fallback về android nếu web bị chặn
                        console.warn("[YouTubeDownloader] All browser cookies failed, using web,android client without cookies (may have limited quality)");
                        return [4 /*yield*/, this.downloadVideoWithArgs(request, outputTemplate, [])];
                    case 12: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    /**
     * Helper: Download video với args cụ thể
     */
    YouTubeDownloader.prototype.downloadVideoWithArgs = function (request, outputTemplate, cookieArgs) {
        return __awaiter(this, void 0, void 0, function () {
            var MAX_ATTEMPTS, isTransientNetworkError, delay, attempt, err_1, msg, backoffMs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        MAX_ATTEMPTS = 3 // Low: simple network retry
                        ;
                        isTransientNetworkError = function (msg) {
                            var m = msg.toLowerCase();
                            return (m.includes('network') ||
                                m.includes('timed out') ||
                                m.includes('timeout') ||
                                m.includes('econnreset') ||
                                m.includes('enotfound') ||
                                m.includes('http error 429') ||
                                m.includes('http error 5') ||
                                m.includes('server issued') ||
                                m.includes('temporarily unavailable'));
                        };
                        delay = function (ms) { return new Promise(function (r) { return setTimeout(r, ms); }); };
                        attempt = 1;
                        _a.label = 1;
                    case 1:
                        if (!(attempt <= MAX_ATTEMPTS)) return [3 /*break*/, 7];
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 4, , 6]);
                        return [4 /*yield*/, this.downloadVideoWithArgsOnce(request, outputTemplate, cookieArgs)];
                    case 3: return [2 /*return*/, _a.sent()];
                    case 4:
                        err_1 = _a.sent();
                        msg = (err_1 === null || err_1 === void 0 ? void 0 : err_1.message) || "".concat(err_1);
                        if (attempt >= MAX_ATTEMPTS || !isTransientNetworkError(msg)) {
                            throw err_1;
                        }
                        backoffMs = attempt === 1 ? 2000 : 5000;
                        console.warn("[YouTubeDownloader] Retry ".concat(attempt, "/").concat(MAX_ATTEMPTS, " after error: ").concat(msg.substring(0, 120), " (wait ").concat(backoffMs, "ms)"));
                        return [4 /*yield*/, delay(backoffMs)];
                    case 5:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        attempt++;
                        return [3 /*break*/, 1];
                    case 7: throw new Error('Unknown download error');
                }
            });
        });
    };
    /**
     * Internal single-attempt downloader (extracted for retry wrapper)
     */
    YouTubeDownloader.prototype.downloadVideoWithArgsOnce = function (request, outputTemplate, cookieArgs) {
        return __awaiter(this, void 0, void 0, function () {
            var url, quality, downloadSubtitles, downloadThumbnail, _a, audioOnly, _b, audioFormat, downloadTracklist, args;
            var _this = this;
            var _c;
            return __generator(this, function (_d) {
                url = request.url, quality = request.quality, downloadSubtitles = request.downloadSubtitles, downloadThumbnail = request.downloadThumbnail, _a = request.audioOnly, audioOnly = _a === void 0 ? false : _a, _b = request.audioFormat, audioFormat = _b === void 0 ? 'mp3' : _b;
                downloadTracklist = (_c = request.downloadTracklist) !== null && _c !== void 0 ? _c : downloadSubtitles;
                args = [
                    '-o', outputTemplate,
                    '--newline',
                    '--progress',
                    '--no-playlist',
                    '--retries', '5',
                    '--fragment-retries', '5',
                    '--retry-sleep', '2',
                    // IDM-style optimization: Download nhiều fragments đồng thời để tăng tốc độ
                    // YouTube DASH videos được chia thành nhiều fragments, download song song sẽ nhanh hơn
                    '--concurrent-fragments', '8', // Download 8 fragments đồng thời (tương tự IDM multi-threaded)
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--referer', 'https://www.youtube.com/',
                    '--add-header', 'Accept-Language:en-US,en;q=0.9',
                ];
                // Strategy: Ưu tiên format cao nhất (1080p, 1440p, 4K)
                // - Có cookies: Dùng web client (có format cao nhất) → fallback android nếu bị chặn
                // - Không cookies: Dùng android client (ít bị chặn, nhưng format có thể thấp hơn)
                if (cookieArgs.length > 0) {
                    // Có cookies: Thử web, ios, tv_embedded trước (có format cao nhất)
                    // yt-dlp sẽ tự động fallback về client tiếp theo nếu bị chặn
                    args.push.apply(args, __spreadArray(['--extractor-args', 'youtube:player_client=web,ios,tv_embedded,android'], cookieArgs, false));
                    console.log("[YouTubeDownloader] Using web/ios/tv_embedded clients with cookies for best quality (1080p+)");
                }
                else {
                    // Không có cookies: Thử ios, tv_embedded trước (có thể có format cao hơn android)
                    // Fallback về android nếu fail
                    args.push('--extractor-args', 'youtube:player_client=ios,tv_embedded,android');
                    console.log("[YouTubeDownloader] Using ios/tv_embedded/android clients (no cookies) - may have limited quality");
                }
                if (audioOnly) {
                    args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0', '--add-metadata');
                }
                else {
                    args.push('-f', this.getQualityFormat(quality), '--merge-output-format', 'mp4');
                }
                // Add subtitle options
                if (downloadSubtitles) {
                    args.push('--write-subs', // Download subtitles
                    '--sub-lang', 'vi,en', // Vietnamese and English
                    '--embed-subs' // Embed into video file
                    );
                }
                // Add thumbnail options - FIX: Convert to JPEG
                if (downloadThumbnail) {
                    args.push('--write-thumbnail', // Download thumbnail
                    '--convert-thumbnails', 'jpg', // Convert to JPEG format
                    '--embed-thumbnail' // Embed into file
                    );
                }
                // Add URL
                args.push(url);
                console.log("[YouTubeDownloader] yt-dlp args:", args);
                console.log("[YouTubeDownloader] Full command: ".concat(this.ytDlpPath, " ").concat(args.map(function (a) { return a.includes(' ') ? "\"".concat(a, "\"") : a; }).join(' ')));
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var proc = spawn(_this.ytDlpPath, args);
                        _this.currentProcess = proc; // Store for cancellation
                        var downloadedFile = '';
                        var currentTitle = '';
                        var stderrBuffer = '';
                        proc.stdout.on('data', function (data) {
                            var output = data.toString();
                            // Log output
                            console.log('[yt-dlp]', output.trim());
                            // Debug: Log format selection info
                            if (output.includes('[format]') || output.includes('format selection') || output.includes('Selected format')) {
                                console.log('[YouTubeDownloader] Format selection info:', output.trim());
                            }
                            // Debug: Log which format ID is being downloaded
                            var formatIdMatch = output.match(/\[download\]\s+Format\s+(\d+)/i);
                            if (formatIdMatch) {
                                console.log("[YouTubeDownloader] Downloading format ID: ".concat(formatIdMatch[1]));
                            }
                            // Parse progress
                            _this.parseDownloadProgress(output, currentTitle);
                            // Extract destination file
                            var destMatch = output.match(/\[download\] Destination: (.+)/);
                            if (destMatch) {
                                downloadedFile = destMatch[1].trim();
                            }
                            // Extract merged file (final output)
                            var mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
                            if (mergeMatch) {
                                downloadedFile = mergeMatch[1].trim();
                            }
                            // Extract title from destination
                            if (downloadedFile && !currentTitle) {
                                var titleMatch = downloadedFile.match(/(.+?)\s+\[/);
                                if (titleMatch) {
                                    currentTitle = titleMatch[1].trim();
                                }
                            }
                        });
                        proc.stderr.on('data', function (data) {
                            var output = data.toString();
                            stderrBuffer += output;
                            console.log('[yt-dlp stderr]', output.trim());
                            // yt-dlp outputs progress to stderr sometimes
                            _this.parseDownloadProgress(output, currentTitle);
                            // Extract destination from stderr too
                            var destMatch = output.match(/\[download\] Destination: (.+)/);
                            if (destMatch) {
                                downloadedFile = destMatch[1].trim();
                            }
                        });
                        proc.on('close', function (code) { return __awaiter(_this, void 0, void 0, function () {
                            var videoInfo, tracklist, tracklistText, tracklistPath, error_6, stderrText, errorMsg;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        this.currentProcess = null; // Clear reference
                                        if (!(code === 0)) return [3 /*break*/, 8];
                                        console.log("[YouTubeDownloader] Download completed: ".concat(downloadedFile));
                                        if (!(downloadTracklist && downloadedFile)) return [3 /*break*/, 7];
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 6, , 7]);
                                        return [4 /*yield*/, this.getVideoInfo(url)];
                                    case 2:
                                        videoInfo = _a.sent();
                                        if (!videoInfo.description) return [3 /*break*/, 5];
                                        tracklist = detectTracklist(videoInfo.description);
                                        if (!(tracklist && tracklist.items.length > 0)) return [3 /*break*/, 4];
                                        tracklistText = formatTracklistForFile(tracklist);
                                        tracklistPath = path.join(path.dirname(downloadedFile), path.basename(downloadedFile, path.extname(downloadedFile)) + '_tracklist.txt');
                                        return [4 /*yield*/, fs.writeFile(tracklistPath, tracklistText, 'utf-8')];
                                    case 3:
                                        _a.sent();
                                        console.log("[YouTubeDownloader] Tracklist saved: ".concat(tracklistPath, " (").concat(tracklist.items.length, " tracks)"));
                                        this.emit('progress', {
                                            type: 'info',
                                            message: "Tracklist \u0111\u00E3 \u0111\u01B0\u1EE3c l\u01B0u: ".concat(path.basename(tracklistPath))
                                        });
                                        return [3 /*break*/, 5];
                                    case 4:
                                        console.log("[YouTubeDownloader] No tracklist found in video description");
                                        _a.label = 5;
                                    case 5: return [3 /*break*/, 7];
                                    case 6:
                                        error_6 = _a.sent();
                                        console.warn("[YouTubeDownloader] Failed to download tracklist:", error_6.message);
                                        return [3 /*break*/, 7];
                                    case 7:
                                        // Emit completion event
                                        this.emit('progress', {
                                            type: 'complete',
                                            message: 'Download completed',
                                            percent: 100
                                        });
                                        resolve(downloadedFile);
                                        return [3 /*break*/, 9];
                                    case 8:
                                        stderrText = stderrBuffer || '';
                                        errorMsg = "yt-dlp failed with exit code ".concat(code);
                                        // Detect bot verification errors
                                        if (stderrText.includes('Please sign in to confirm you are not a bot') ||
                                            stderrText.includes('Sign in to confirm your age') ||
                                            stderrText.includes('unable to extract') ||
                                            stderrText.includes('Private video') ||
                                            stderrText.includes('Video unavailable') ||
                                            stderrText.includes('HTTP Error 403') ||
                                            stderrText.includes('HTTP Error 429')) {
                                            errorMsg = "YouTube y\u00EAu c\u1EA7u x\u00E1c minh. Tool \u0111\u00E3 t\u1EF1 \u0111\u1ED9ng th\u1EED cookies t\u1EEB Chrome/Firefox/Edge nh\u01B0ng v\u1EABn b\u1ECB ch\u1EB7n.\n\n" +
                                                "Vui l\u00F2ng:\n" +
                                                "1. M\u1EDF tr\u00ECnh duy\u1EC7t Chrome/Firefox/Edge v\u00E0 \u0111\u0103ng nh\u1EADp YouTube\n" +
                                                "2. \u0110\u1EA3m b\u1EA3o b\u1EA1n \u0111\u00E3 xem video tr\u00EAn YouTube \u00EDt nh\u1EA5t 1 l\u1EA7n\n" +
                                                "3. \u0110\u1EE3i v\u00E0i ph\u00FAt r\u1ED3i th\u1EED l\u1EA1i\n\n" +
                                                "L\u1ED7i chi ti\u1EBFt: ".concat(stderrText.substring(0, 200));
                                        }
                                        this.emit('progress', {
                                            type: 'error',
                                            message: errorMsg
                                        });
                                        reject(new Error(errorMsg));
                                        _a.label = 9;
                                    case 9: return [2 /*return*/];
                                }
                            });
                        }); });
                        proc.on('error', function (error) {
                            _this.currentProcess = null;
                            var errorMsg = "Failed to spawn yt-dlp: ".concat(error.message);
                            _this.emit('progress', {
                                type: 'error',
                                message: errorMsg
                            });
                            reject(new Error(errorMsg));
                        });
                    })];
            });
        });
    };
    /**
     * Get list of videos from channel or playlist
     */
    YouTubeDownloader.prototype.getChannelVideos = function (url, limit) {
        return __awaiter(this, void 0, void 0, function () {
            var args;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("[YouTubeDownloader] Getting channel/playlist videos: ".concat(url));
                        console.log("  Limit: ".concat(limit || 'unlimited'));
                        return [4 /*yield*/, this.verify()];
                    case 1:
                        if (!(_a.sent())) {
                            throw new Error("yt-dlp not found at ".concat(this.ytDlpPath, ". Please download it from https://github.com/yt-dlp/yt-dlp/releases"));
                        }
                        args = [
                            '--flat-playlist', // Fast extraction (don't get full info)
                            '--dump-json', // Output JSON
                            '--skip-download', // Don't download
                            url
                        ];
                        // Limit number of videos
                        if (limit && limit > 0) {
                            args.push('--playlist-end', limit.toString());
                        }
                        console.log("[YouTubeDownloader] yt-dlp args:", args.join(' '));
                        return [2 /*return*/, new Promise(function (resolve, reject) {
                                var proc = spawn(_this.ytDlpPath, args);
                                var stdout = '';
                                var stderr = '';
                                proc.stdout.on('data', function (data) {
                                    stdout += data.toString();
                                });
                                proc.stderr.on('data', function (data) {
                                    stderr += data.toString();
                                });
                                proc.on('close', function (code) {
                                    if (code === 0) {
                                        try {
                                            // Parse multiple JSON objects (one per line)
                                            var lines = stdout.trim().split('\n').filter(function (line) { return line.trim(); });
                                            console.log("[YouTubeDownloader] Raw output lines: ".concat(lines.length));
                                            if (lines.length === 0) {
                                                console.warn('[YouTubeDownloader] No videos found in output');
                                                resolve([]);
                                                return;
                                            }
                                            // Debug: Log first line sample
                                            if (lines.length > 0) {
                                                console.log("[YouTubeDownloader] First line sample:", lines[0].substring(0, 200));
                                            }
                                            var videos = lines
                                                .map(function (line) {
                                                var _a, _b;
                                                try {
                                                    var raw = JSON.parse(line);
                                                    // Try multiple fields for channel name
                                                    var uploader = raw.uploader ||
                                                        raw.channel ||
                                                        raw.channel_name ||
                                                        raw.uploader_id ||
                                                        'Unknown';
                                                    return {
                                                        id: raw.id || raw.url || '',
                                                        title: raw.title || 'Unknown',
                                                        duration: raw.duration || 0,
                                                        thumbnail: raw.thumbnail || ((_b = (_a = raw.thumbnails) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url) || '',
                                                        description: '',
                                                        uploader: uploader,
                                                        uploadDate: raw.upload_date || '',
                                                        viewCount: raw.view_count || 0,
                                                        likeCount: 0,
                                                        width: 0,
                                                        height: 0,
                                                        formats: []
                                                    };
                                                }
                                                catch (e) {
                                                    console.warn('[YouTubeDownloader] Failed to parse video line:', line.substring(0, 100));
                                                    return null;
                                                }
                                            })
                                                .filter(function (v) { return v !== null; });
                                            console.log("[YouTubeDownloader] Parsed ".concat(videos.length, " videos"));
                                            // Log first few videos with uploader info
                                            if (videos.length > 0) {
                                                console.log("[YouTubeDownloader] Sample video:", {
                                                    title: videos[0].title,
                                                    uploader: videos[0].uploader,
                                                    id: videos[0].id
                                                });
                                                videos.slice(0, 5).forEach(function (v, i) {
                                                    console.log("  ".concat(i + 1, ". ").concat(v.title, " (").concat(v.duration, "s) - ").concat(v.uploader));
                                                });
                                                if (videos.length > 5) {
                                                    console.log("  ... and ".concat(videos.length - 5, " more"));
                                                }
                                            }
                                            resolve(videos);
                                        }
                                        catch (error) {
                                            console.error('[YouTubeDownloader] Parse error:', error);
                                            console.error('[YouTubeDownloader] Raw stdout:', stdout.substring(0, 500));
                                            reject(new Error("Failed to parse: ".concat(error.message)));
                                        }
                                    }
                                    else {
                                        console.error('[YouTubeDownloader] yt-dlp failed with code:', code);
                                        console.error('[YouTubeDownloader] stderr:', stderr);
                                        reject(new Error("yt-dlp failed: ".concat(stderr || "Exit code ".concat(code))));
                                    }
                                });
                                proc.on('error', function (error) {
                                    console.error('[YouTubeDownloader] Process error:', error);
                                    reject(new Error("Failed to spawn yt-dlp: ".concat(error.message)));
                                });
                            })];
                }
            });
        });
    };
    /**
     * Get channel info - FIXED VERSION (extract from URL + first video)
     */
    YouTubeDownloader.prototype.getChannelInfo = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            var channelNameFromUrl, urlMatch, channelName, firstVideos, firstVideoId, firstVideoUrl, fullVideoInfo, error_7, allVideos, result, error_8;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("\n[YouTubeDownloader] ====== GET CHANNEL INFO ======");
                        console.log("[YouTubeDownloader] URL: ".concat(url));
                        console.log("[YouTubeDownloader] URL Type: ".concat(this.detectUrlType(url)));
                        return [4 /*yield*/, this.verify()];
                    case 1:
                        if (!(_a.sent())) {
                            throw new Error("yt-dlp not found at ".concat(this.ytDlpPath, ". Please download it from https://github.com/yt-dlp/yt-dlp/releases"));
                        }
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 11, , 12]);
                        channelNameFromUrl = '';
                        urlMatch = url.match(/youtube\.com\/@([^\/\?]+)/);
                        if (urlMatch) {
                            channelNameFromUrl = urlMatch[1];
                            console.log("[YouTubeDownloader] Extracted from URL: ".concat(channelNameFromUrl));
                        }
                        // Method 2: Get first video with full info (not flat-playlist) to get channel name
                        console.log("[YouTubeDownloader] Step 1: Getting first video with full info...");
                        channelName = channelNameFromUrl;
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 8, , 9]);
                        return [4 /*yield*/, this.getChannelVideos(url, 1)];
                    case 4:
                        firstVideos = _a.sent();
                        if (!(firstVideos.length > 0)) return [3 /*break*/, 6];
                        firstVideoId = firstVideos[0].id;
                        firstVideoUrl = "https://www.youtube.com/watch?v=".concat(firstVideoId);
                        console.log("[YouTubeDownloader] Getting full info for first video: ".concat(firstVideoUrl));
                        return [4 /*yield*/, this.getVideoInfo(firstVideoUrl)];
                    case 5:
                        fullVideoInfo = _a.sent();
                        if (fullVideoInfo.uploader && fullVideoInfo.uploader !== 'Unknown') {
                            channelName = fullVideoInfo.uploader;
                            console.log("[YouTubeDownloader] \u2713 Channel name from video: ".concat(channelName));
                        }
                        else if (channelNameFromUrl) {
                            channelName = channelNameFromUrl;
                            console.log("[YouTubeDownloader] \u2713 Using channel name from URL: ".concat(channelName));
                        }
                        else {
                            channelName = firstVideos[0].uploader || 'Unknown Channel';
                            console.log("[YouTubeDownloader] \u26A0 Using uploader from flat-playlist: ".concat(channelName));
                        }
                        return [3 /*break*/, 7];
                    case 6:
                        if (channelNameFromUrl) {
                            channelName = channelNameFromUrl;
                        }
                        else {
                            throw new Error('Không tìm thấy video nào trong channel');
                        }
                        _a.label = 7;
                    case 7: return [3 /*break*/, 9];
                    case 8:
                        error_7 = _a.sent();
                        console.warn("[YouTubeDownloader] Could not get channel name from video: ".concat(error_7.message));
                        if (channelNameFromUrl) {
                            channelName = channelNameFromUrl;
                        }
                        else {
                            channelName = 'Unknown Channel';
                        }
                        return [3 /*break*/, 9];
                    case 9:
                        // Step 2: Count all videos
                        console.log("[YouTubeDownloader] Step 2: Counting all videos...");
                        return [4 /*yield*/, this.getChannelVideos(url, undefined)];
                    case 10:
                        allVideos = _a.sent();
                        console.log("[YouTubeDownloader] \u2713 Total videos: ".concat(allVideos.length));
                        result = {
                            channelName: channelName,
                            channelId: '', // Not available in flat playlist mode
                            videoCount: allVideos.length
                        };
                        console.log("[YouTubeDownloader] ====== RESULT ======");
                        console.log(result);
                        console.log("[YouTubeDownloader] ====================\n");
                        return [2 /*return*/, result];
                    case 11:
                        error_8 = _a.sent();
                        console.error("[YouTubeDownloader] ====== ERROR ======");
                        console.error('[YouTubeDownloader] Error:', error_8);
                        console.error("[YouTubeDownloader] ===================\n");
                        throw error_8;
                    case 12: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Estimate total download size for channel
     */
    YouTubeDownloader.prototype.estimateChannelSize = function (url, quality, limit) {
        return __awaiter(this, void 0, void 0, function () {
            var videos, qualityToBitrate, bitrate, totalSize, _i, videos_1, video, durationSec, videoSize, avgSize, formatBytes;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("[YouTubeDownloader] Estimating channel download size...");
                        return [4 /*yield*/, this.getChannelVideos(url, limit)];
                    case 1:
                        videos = _a.sent();
                        qualityToBitrate = {
                            'best': 8000000, // 8 Mbps
                            '2160': 15000000, // 15 Mbps for 4K
                            '1440': 10000000, // 10 Mbps for 1440p
                            '1080': 5000000, // 5 Mbps for 1080p
                            '720': 2500000, // 2.5 Mbps for 720p
                            '480': 1000000 // 1 Mbps for 480p
                        };
                        bitrate = qualityToBitrate[quality] || qualityToBitrate['1080'];
                        totalSize = 0;
                        for (_i = 0, videos_1 = videos; _i < videos_1.length; _i++) {
                            video = videos_1[_i];
                            durationSec = video.duration || 300;
                            videoSize = (bitrate / 8) * durationSec;
                            totalSize += videoSize;
                        }
                        avgSize = videos.length > 0 ? totalSize / videos.length : 0;
                        return [4 /*yield*/, import('../utils/diskSpace')];
                    case 2:
                        formatBytes = (_a.sent()).formatBytes;
                        return [2 /*return*/, {
                                videoCount: videos.length,
                                estimatedSizeBytes: totalSize,
                                estimatedSizeFormatted: formatBytes(totalSize),
                                avgSizePerVideo: avgSize
                            }];
                }
            });
        });
    };
    /**
     * Download entire channel or playlist
     */
    YouTubeDownloader.prototype.downloadChannel = function (url_1, outputDir_1, quality_1) {
        return __awaiter(this, arguments, void 0, function (url, outputDir, quality, options) {
            var channelInfo, sanitizedChannelName, channelFolder, videosFolder, thumbnailsFolder, videos, formatBytes, estimate, downloaded, failed, i, video, videoUrl, outputFile, error_9;
            var _a, _b;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        console.log("[YouTubeDownloader] Downloading channel/playlist: ".concat(url));
                        return [4 /*yield*/, this.getChannelInfo(url)];
                    case 1:
                        channelInfo = _c.sent();
                        sanitizedChannelName = channelInfo.channelName
                            .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars
                            .replace(/\s+/g, ' ') // Normalize spaces
                            .trim();
                        channelFolder = path.join(outputDir, sanitizedChannelName);
                        return [4 /*yield*/, fs.mkdir(channelFolder, { recursive: true })];
                    case 2:
                        _c.sent();
                        console.log("[YouTubeDownloader] Created channel folder: ".concat(channelFolder));
                        videosFolder = path.join(channelFolder, 'videos');
                        return [4 /*yield*/, fs.mkdir(videosFolder, { recursive: true })];
                    case 3:
                        _c.sent();
                        if (!options.downloadThumbnail) return [3 /*break*/, 5];
                        thumbnailsFolder = path.join(channelFolder, 'thumbnails');
                        return [4 /*yield*/, fs.mkdir(thumbnailsFolder, { recursive: true })];
                    case 4:
                        _c.sent();
                        console.log("[YouTubeDownloader] Created thumbnails folder: ".concat(thumbnailsFolder));
                        _c.label = 5;
                    case 5:
                        console.log("[YouTubeDownloader] Folder structure:");
                        console.log("  ".concat(channelFolder, "/"));
                        console.log("    videos/");
                        if (thumbnailsFolder) {
                            console.log("    thumbnails/");
                        }
                        return [4 /*yield*/, this.getChannelVideos(url, options.limit)];
                    case 6:
                        videos = _c.sent();
                        if (videos.length === 0) {
                            throw new Error('Không tìm thấy video nào trong channel/playlist');
                        }
                        return [4 /*yield*/, import('../utils/diskSpace')];
                    case 7:
                        formatBytes = (_c.sent()).formatBytes;
                        return [4 /*yield*/, this.estimateChannelSize(url, quality, options.limit)];
                    case 8:
                        estimate = _c.sent();
                        console.log("[YouTubeDownloader] Estimated download size: ".concat(formatBytes(estimate.estimatedSizeBytes)));
                        // Validate disk space với estimated size
                        return [4 /*yield*/, this.validateDownloadRequest(outputDir, estimate.estimatedSizeBytes)];
                    case 9:
                        // Validate disk space với estimated size
                        _c.sent();
                        console.log("[YouTubeDownloader] Starting batch download: ".concat(videos.length, " videos"));
                        downloaded = [];
                        failed = [];
                        i = 0;
                        _c.label = 10;
                    case 10:
                        if (!(i < videos.length)) return [3 /*break*/, 15];
                        video = videos[i];
                        videoUrl = "https://www.youtube.com/watch?v=".concat(video.id);
                        console.log("\n[YouTubeDownloader] [".concat(i + 1, "/").concat(videos.length, "] ").concat(video.title));
                        // Emit batch progress
                        this.emit('batch-progress', {
                            currentVideoIndex: i,
                            totalVideos: videos.length,
                            currentVideoTitle: video.title,
                            currentVideoPercent: 0,
                            completedVideos: downloaded.length,
                            failedVideos: failed.length,
                            overallPercent: (i / videos.length) * 100,
                            errors: failed.map(function (f) { return ({ videoTitle: f.video.title, error: f.error }); })
                        });
                        _c.label = 11;
                    case 11:
                        _c.trys.push([11, 13, , 14]);
                        return [4 /*yield*/, this.downloadVideoToFolder(videoUrl, videosFolder, thumbnailsFolder, quality, options.downloadSubtitles || false, options.downloadThumbnail || false, (_a = options.audioOnly) !== null && _a !== void 0 ? _a : false, (_b = options.audioFormat) !== null && _b !== void 0 ? _b : 'mp3')];
                    case 12:
                        outputFile = _c.sent();
                        downloaded.push(outputFile);
                        console.log("[YouTubeDownloader] \u2713 Downloaded: ".concat(video.title));
                        return [3 /*break*/, 14];
                    case 13:
                        error_9 = _c.sent();
                        console.error("[YouTubeDownloader] \u2717 Failed to download: ".concat(video.title), error_9.message);
                        failed.push({
                            video: video,
                            error: error_9.message
                        });
                        // Continue or abort?
                        if (!options.continueOnError) {
                            console.log('[YouTubeDownloader] Aborting batch download due to error');
                            return [3 /*break*/, 15];
                        }
                        else {
                            console.log('[YouTubeDownloader] Continuing to next video...');
                        }
                        return [3 /*break*/, 14];
                    case 14:
                        i++;
                        return [3 /*break*/, 10];
                    case 15:
                        // Final batch progress
                        this.emit('batch-progress', {
                            currentVideoIndex: videos.length,
                            totalVideos: videos.length,
                            currentVideoTitle: '',
                            currentVideoPercent: 100,
                            completedVideos: downloaded.length,
                            failedVideos: failed.length,
                            overallPercent: 100,
                            errors: failed.map(function (f) { return ({ videoTitle: f.video.title, error: f.error }); })
                        });
                        console.log("\n[YouTubeDownloader] Batch download completed:");
                        console.log("  \u2713 Downloaded: ".concat(downloaded.length));
                        console.log("  \u2717 Failed: ".concat(failed.length));
                        console.log("  \uD83D\uDCC1 Channel folder: ".concat(channelFolder));
                        return [2 /*return*/, { downloaded: downloaded, failed: failed, channelFolder: channelFolder }];
                }
            });
        });
    };
    /**
     * Download video to specific folders (videos & thumbnails separate)
     */
    YouTubeDownloader.prototype.downloadVideoToFolder = function (url_1, videosFolder_1, thumbnailsFolder_1, quality_1, downloadSubtitles_1, downloadThumbnail_1) {
        return __awaiter(this, arguments, void 0, function (url, videosFolder, thumbnailsFolder, quality, downloadSubtitles, downloadThumbnail, audioOnly, audioFormat) {
            var outputTemplate, args, thumbnailTemplate;
            var _this = this;
            if (audioOnly === void 0) { audioOnly = false; }
            if (audioFormat === void 0) { audioFormat = 'mp3'; }
            return __generator(this, function (_a) {
                outputTemplate = path.join(videosFolder, '%(title)s [%(id)s].%(ext)s');
                args = [
                    '-o', outputTemplate,
                    '--newline',
                    '--progress',
                    '--no-playlist',
                    '--retries', '5',
                    '--fragment-retries', '5',
                    '--retry-sleep', '2',
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--referer', 'https://www.youtube.com/',
                    '--add-header', 'Accept-Language:en-US,en;q=0.9',
                    '--extractor-args', 'youtube:player_client=android', // Dùng Android client (không cần cookies)
                ];
                if (audioOnly) {
                    args.push('-f', 'bestaudio/best', '--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0', '--add-metadata');
                }
                else {
                    args.push('-f', this.getQualityFormat(quality), '--merge-output-format', 'mp4');
                }
                if (downloadSubtitles) {
                    args.push('--write-subs', '--sub-lang', 'vi,en', '--embed-subs');
                }
                if (downloadThumbnail && thumbnailsFolder) {
                    thumbnailTemplate = path.join(thumbnailsFolder, '%(title)s [%(id)s].%(ext)s');
                    args.push('--write-thumbnail', // Download thumbnail
                    '--convert-thumbnails', 'jpg', // Convert to JPEG
                    '-o', "thumbnail:".concat(thumbnailTemplate), // Separate thumbnail path
                    '--embed-thumbnail' // Also embed in video
                    );
                }
                else if (downloadThumbnail) {
                    // Just embed, no separate file
                    args.push('--write-thumbnail', '--convert-thumbnails', 'jpg', '--embed-thumbnail');
                }
                args.push(url);
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var proc = spawn(_this.ytDlpPath, args);
                        _this.currentProcess = proc;
                        var downloadedFile = '';
                        proc.stdout.on('data', function (data) {
                            var output = data.toString();
                            _this.parseDownloadProgress(output, '');
                            var destMatch = output.match(/\[download\] Destination: (.+)/);
                            if (destMatch) {
                                downloadedFile = destMatch[1].trim();
                            }
                            var mergeMatch = output.match(/\[Merger\] Merging formats into "(.+)"/);
                            if (mergeMatch) {
                                downloadedFile = mergeMatch[1].trim();
                            }
                        });
                        proc.stderr.on('data', function (data) {
                            _this.parseDownloadProgress(data.toString(), '');
                        });
                        proc.on('close', function (code) {
                            _this.currentProcess = null;
                            if (code === 0) {
                                resolve(downloadedFile);
                            }
                            else {
                                reject(new Error("yt-dlp failed with exit code ".concat(code)));
                            }
                        });
                        proc.on('error', function (error) {
                            _this.currentProcess = null;
                            reject(error);
                        });
                    })];
            });
        });
    };
    /**
     * Download channel with concurrent downloads (faster but more complex)
     */
    YouTubeDownloader.prototype.downloadChannelConcurrent = function (url_1, outputDir_1, quality_1) {
        return __awaiter(this, arguments, void 0, function (url, outputDir, quality, options) {
            var concurrency, videos, downloaded, failed, _loop_1, this_1, i;
            var _this = this;
            if (options === void 0) { options = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        console.log("[YouTubeDownloader] Downloading channel (concurrent): ".concat(url));
                        concurrency = options.concurrency || 2;
                        return [4 /*yield*/, this.getChannelVideos(url, options.limit)];
                    case 1:
                        videos = _a.sent();
                        if (videos.length === 0) {
                            throw new Error('No videos found');
                        }
                        console.log("[YouTubeDownloader] Starting concurrent download: ".concat(videos.length, " videos, ").concat(concurrency, " at a time"));
                        downloaded = [];
                        failed = [];
                        _loop_1 = function (i) {
                            var chunk, results;
                            return __generator(this, function (_b) {
                                switch (_b.label) {
                                    case 0:
                                        chunk = videos.slice(i, i + concurrency);
                                        return [4 /*yield*/, Promise.allSettled(chunk.map(function (video) {
                                                var _a, _b;
                                                var videoUrl = "https://www.youtube.com/watch?v=".concat(video.id);
                                                return _this.downloadVideo({
                                                    url: videoUrl,
                                                    outputDir: outputDir,
                                                    quality: quality,
                                                    downloadSubtitles: options.downloadSubtitles || false,
                                                    downloadThumbnail: options.downloadThumbnail || false,
                                                    audioOnly: (_a = options.audioOnly) !== null && _a !== void 0 ? _a : false,
                                                    audioFormat: (_b = options.audioFormat) !== null && _b !== void 0 ? _b : 'mp3'
                                                }).then(function (file) { return ({ video: video, file: file }); });
                                            }))];
                                    case 1:
                                        results = _b.sent();
                                        // Process results
                                        results.forEach(function (result, idx) {
                                            var _a, _b;
                                            var video = chunk[idx];
                                            if (result.status === 'fulfilled') {
                                                downloaded.push(result.value.file);
                                                console.log("[YouTubeDownloader] \u2713 Downloaded: ".concat(video.title));
                                            }
                                            else {
                                                failed.push({
                                                    video: video,
                                                    error: ((_a = result.reason) === null || _a === void 0 ? void 0 : _a.message) || 'Unknown error'
                                                });
                                                console.error("[YouTubeDownloader] \u2717 Failed: ".concat(video.title), (_b = result.reason) === null || _b === void 0 ? void 0 : _b.message);
                                                if (!options.continueOnError) {
                                                    throw new Error("Download failed: ".concat(video.title));
                                                }
                                            }
                                        });
                                        // Emit progress
                                        this_1.emit('batch-progress', {
                                            currentVideoIndex: Math.min(i + concurrency, videos.length),
                                            totalVideos: videos.length,
                                            currentVideoTitle: '',
                                            currentVideoPercent: 100,
                                            completedVideos: downloaded.length,
                                            failedVideos: failed.length,
                                            overallPercent: (Math.min(i + concurrency, videos.length) / videos.length) * 100,
                                            errors: failed.map(function (f) { return ({ videoTitle: f.video.title, error: f.error }); })
                                        });
                                        return [2 /*return*/];
                                }
                            });
                        };
                        this_1 = this;
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < videos.length)) return [3 /*break*/, 5];
                        return [5 /*yield**/, _loop_1(i)];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i += concurrency;
                        return [3 /*break*/, 2];
                    case 5:
                        console.log("\n[YouTubeDownloader] Concurrent download completed:");
                        console.log("  \u2713 Downloaded: ".concat(downloaded.length));
                        console.log("  \u2717 Failed: ".concat(failed.length));
                        return [2 /*return*/, { downloaded: downloaded, failed: failed }];
                }
            });
        });
    };
    /**
     * Upscale video to 4K using FFmpeg (placeholder - will be implemented later)
     */
    YouTubeDownloader.prototype.upscaleTo4K = function (_inputPath, _outputPath, _onProgress) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                throw new Error('upscaleTo4K will be implemented later');
            });
        });
    };
    return YouTubeDownloader;
}(EventEmitter));
export { YouTubeDownloader };
