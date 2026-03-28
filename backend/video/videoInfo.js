/**
 * Video Info - Probe video file để lấy metadata cơ bản
 */
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
import { getFfmpegPaths } from '../ffmpeg/config';
import fs from 'node:fs';
/**
 * Probe video file để lấy duration, width, height
 */
export function getVideoFileInfo(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var stats, sizeBytes, paths, ffprobePath;
        var _a;
        return __generator(this, function (_b) {
            // Kiểm tra file tồn tại
            if (!fs.existsSync(filePath)) {
                throw new Error("File kh\u00F4ng t\u1ED3n t\u1EA1i: ".concat(filePath));
            }
            stats = fs.statSync(filePath);
            sizeBytes = (_a = stats === null || stats === void 0 ? void 0 : stats.size) !== null && _a !== void 0 ? _a : null;
            paths = getFfmpegPaths();
            ffprobePath = paths.ffprobe;
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    var _a, _b;
                    // Dùng ffprobe để lấy metadata
                    var args = [
                        '-v', 'error',
                        '-show_entries', 'format=duration:stream=width,height',
                        '-of', 'json',
                        filePath,
                    ];
                    var proc = spawn(ffprobePath, args, {
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    var stdout = '';
                    var stderr = '';
                    (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', function (data) {
                        stdout += data.toString('utf-8');
                    });
                    (_b = proc.stderr) === null || _b === void 0 ? void 0 : _b.on('data', function (data) {
                        stderr += data.toString('utf-8');
                    });
                    proc.on('close', function (code) {
                        if (code !== 0) {
                            console.warn("[getVideoFileInfo] ffprobe failed for ".concat(filePath, ":"), stderr);
                            // Trả về null values nhưng không throw
                            resolve({
                                filePath: filePath,
                                durationSec: null,
                                width: null,
                                height: null,
                                sizeBytes: sizeBytes,
                            });
                            return;
                        }
                        try {
                            var json = JSON.parse(stdout);
                            var format = json.format || {};
                            var streams = json.streams || [];
                            // Tìm video stream đầu tiên
                            var videoStream = streams.find(function (s) { return s.codec_type === 'video'; });
                            var durationSec = format.duration ? parseFloat(format.duration) : null;
                            var width = (videoStream === null || videoStream === void 0 ? void 0 : videoStream.width) ? parseInt(videoStream.width, 10) : null;
                            var height = (videoStream === null || videoStream === void 0 ? void 0 : videoStream.height) ? parseInt(videoStream.height, 10) : null;
                            resolve({
                                filePath: filePath,
                                durationSec: durationSec,
                                width: width,
                                height: height,
                                sizeBytes: sizeBytes,
                            });
                        }
                        catch (error) {
                            console.warn("[getVideoFileInfo] Failed to parse ffprobe output:", error);
                            resolve({
                                filePath: filePath,
                                durationSec: null,
                                width: null,
                                height: null,
                                sizeBytes: sizeBytes,
                            });
                        }
                    });
                    proc.on('error', function (error) {
                        console.warn("[getVideoFileInfo] Spawn error:", error);
                        resolve({
                            filePath: filePath,
                            durationSec: null,
                            width: null,
                            height: null,
                            sizeBytes: sizeBytes,
                        });
                    });
                })];
        });
    });
}
