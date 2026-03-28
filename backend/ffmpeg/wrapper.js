var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
import { spawn } from 'child_process';
import { getFfmpegPaths } from './config';
import { videoJobManager } from '../video/videoJobManager';
/**
 * Convert time string "HH:MM:SS.xx" to seconds (float)
 */
function parseTimeToSeconds(timeStr) {
    var parts = timeStr.split(':');
    if (parts.length === 3) {
        var hours = parseFloat(parts[0]) || 0;
        var minutes = parseFloat(parts[1]) || 0;
        var seconds = parseFloat(parts[2]) || 0;
        return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
}
export function runFfmpeg(opts) {
    return __awaiter(this, void 0, void 0, function () {
        var paths, args, cwd, env, onStdoutChunk, onStderrChunk, onProgress, timeoutMs, signal, requestId, ffmpegPath;
        return __generator(this, function (_a) {
            paths = getFfmpegPaths();
            args = opts.args, cwd = opts.cwd, env = opts.env, onStdoutChunk = opts.onStdoutChunk, onStderrChunk = opts.onStderrChunk, onProgress = opts.onProgress, timeoutMs = opts.timeoutMs, signal = opts.signal, requestId = opts.requestId;
            ffmpegPath = paths.ffmpeg;
            if (process.platform === 'win32' && ffmpegPath.match(/^[A-Z]:\\.*$/) && ffmpegPath.length > 240) {
                if (!ffmpegPath.startsWith('\\\\?\\')) {
                    ffmpegPath = '\\\\?\\' + ffmpegPath;
                }
            }
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a, _b;
                    var chunks = [];
                    var stderrChunks = [];
                    var child = spawn(ffmpegPath, args, {
                        cwd: cwd || process.cwd(),
                        env: __assign(__assign({}, process.env), env),
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    // Register process vào videoJobManager để có thể cancel (nếu có requestId)
                    if (requestId) {
                        videoJobManager.registerJob(requestId, child);
                    }
                    // Listen AbortSignal để cancel khi cần
                    if (signal) {
                        signal.addEventListener('abort', function () {
                            console.log("[runFfmpeg] Job ".concat(requestId || 'unknown', " cancelled via AbortSignal"));
                            if (!child.killed) {
                                child.kill('SIGTERM');
                                setTimeout(function () {
                                    if (!child.killed) {
                                        child.kill('SIGKILL');
                                    }
                                }, 2000);
                            }
                        });
                    }
                    var timeoutId = null;
                    if (timeoutMs && timeoutMs > 0) {
                        timeoutId = setTimeout(function () {
                            try {
                                child.kill();
                            }
                            catch (err) {
                                // Ignore kill errors
                            }
                            reject(new Error("FFmpeg timeout after ".concat(timeoutMs, "ms")));
                        }, timeoutMs);
                    }
                    (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                        chunks.push(chunk);
                        if (onStdoutChunk) {
                            onStdoutChunk(chunk.toString('utf-8'));
                        }
                    });
                    (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', function (chunk) {
                        // Check nếu job đã bị cancel
                        if ((signal === null || signal === void 0 ? void 0 : signal.aborted) || (requestId && videoJobManager.isCancelled(requestId))) {
                            return; // Không xử lý progress nữa
                        }
                        stderrChunks.push(chunk);
                        var chunkStr = chunk.toString('utf-8');
                        if (onStderrChunk) {
                            onStderrChunk(chunkStr);
                        }
                        // Parse progress từ FFmpeg stderr
                        if (onProgress) {
                            var match = chunkStr.match(/time=\s*([0-9:.]+)/);
                            if (match && match[1]) {
                                var rawTime = match[1];
                                var timeSec = parseTimeToSeconds(rawTime);
                                onProgress({ timeSec: timeSec, rawTime: rawTime });
                            }
                        }
                    });
                    child.on('error', function (err) {
                        if (timeoutId)
                            clearTimeout(timeoutId);
                        reject(err);
                    });
                    child.on('close', function (code) {
                        if (timeoutId)
                            clearTimeout(timeoutId);
                        // Nếu job đã bị cancel, reject với error
                        if ((signal === null || signal === void 0 ? void 0 : signal.aborted) || (requestId && videoJobManager.isCancelled(requestId))) {
                            reject(new Error('Đã dừng bởi người dùng'));
                            return;
                        }
                        var stdout = Buffer.concat(chunks).toString('utf-8');
                        var stderr = Buffer.concat(stderrChunks).toString('utf-8');
                        var result = {
                            code: code || 0,
                            stdout: stdout,
                            stderr: stderr,
                        };
                        if (code !== 0) {
                            var errorMsg = "FFmpeg exited with code ".concat(code, ". stderr: ").concat(stderr.slice(-500));
                            reject(new Error(errorMsg));
                        }
                        else {
                            resolve(result);
                        }
                    });
                })];
        });
    });
}
export function runFfprobe(args) {
    return __awaiter(this, void 0, void 0, function () {
        var paths, ffprobePath;
        return __generator(this, function (_a) {
            paths = getFfmpegPaths();
            ffprobePath = paths.ffprobe;
            if (process.platform === 'win32' && ffprobePath.match(/^[A-Z]:\\.*$/) && ffprobePath.length > 240) {
                if (!ffprobePath.startsWith('\\\\?\\')) {
                    ffprobePath = '\\\\?\\' + ffprobePath;
                }
            }
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a, _b;
                    var chunks = [];
                    var stderrChunks = [];
                    var child = spawn(ffprobePath, args, {
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                        chunks.push(chunk);
                    });
                    (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', function (chunk) {
                        stderrChunks.push(chunk);
                    });
                    child.on('error', function (err) {
                        reject(err);
                    });
                    child.on('close', function (code) {
                        var stdout = Buffer.concat(chunks).toString('utf-8');
                        var stderr = Buffer.concat(stderrChunks).toString('utf-8');
                        if (code !== 0) {
                            reject(new Error("ffprobe exited with code ".concat(code, ". stderr: ").concat(stderr.slice(-500))));
                        }
                        else {
                            resolve(stdout);
                        }
                    });
                })];
        });
    });
}
