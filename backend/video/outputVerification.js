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
import { probeFile } from '../ffmpeg/probe';
function parseFps(rate) {
    if (!rate || rate === '0/0')
        return null;
    var parts = rate.split('/');
    if (parts.length === 2) {
        var num = Number(parts[0]);
        var den = Number(parts[1]);
        if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0)
            return null;
        return num / den;
    }
    var v = Number(rate);
    return Number.isFinite(v) && v > 0 ? v : null;
}
export function verifyOutputVideo(outputPath, opts) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, _b, expectedDurationSec, _c, toleranceSec, onLog, info, durationSec, videoStream, audioStream, fps, videoCodec, audioCodec, durationDiffSec, durationWarning, ffmpeg, decodeOk;
        var _d, _e, _f, _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    _a = opts || {}, _b = _a.expectedDurationSec, expectedDurationSec = _b === void 0 ? null : _b, _c = _a.toleranceSec, toleranceSec = _c === void 0 ? 5 : _c, onLog = _a.onLog;
                    return [4 /*yield*/, probeFile(outputPath)];
                case 1:
                    info = _k.sent();
                    durationSec = (_e = (_d = info === null || info === void 0 ? void 0 : info.format) === null || _d === void 0 ? void 0 : _d.duration) !== null && _e !== void 0 ? _e : 0;
                    videoStream = info === null || info === void 0 ? void 0 : info.video;
                    audioStream = info === null || info === void 0 ? void 0 : info.audio;
                    fps = (_g = (_f = parseFps(videoStream === null || videoStream === void 0 ? void 0 : videoStream.avg_frame_rate)) !== null && _f !== void 0 ? _f : parseFps(videoStream === null || videoStream === void 0 ? void 0 : videoStream.r_frame_rate)) !== null && _g !== void 0 ? _g : null;
                    videoCodec = (_h = videoStream === null || videoStream === void 0 ? void 0 : videoStream.codec_name) !== null && _h !== void 0 ? _h : null;
                    audioCodec = (_j = audioStream === null || audioStream === void 0 ? void 0 : audioStream.codec) !== null && _j !== void 0 ? _j : null;
                    durationDiffSec = null;
                    durationWarning = false;
                    if (expectedDurationSec && expectedDurationSec > 0 && durationSec > 0) {
                        durationDiffSec = Math.abs(durationSec - expectedDurationSec);
                        if (durationDiffSec > toleranceSec) {
                            durationWarning = true;
                        }
                    }
                    if (onLog) {
                        onLog("[verifyOutput] duration=".concat(durationSec.toFixed(2), "s, fps=").concat(fps !== null && fps !== void 0 ? fps : 'unknown', ", vCodec=").concat(videoCodec || 'unknown', ", aCodec=").concat(audioCodec || 'unknown', ", diff=").concat(durationDiffSec !== null && durationDiffSec !== void 0 ? durationDiffSec : 'n/a'));
                    }
                    ffmpeg = getFfmpegPaths().ffmpeg;
                    return [4 /*yield*/, new Promise(function (resolve) {
                            var _a;
                            try {
                                var child = spawn(ffmpeg, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], { windowsHide: true });
                                var stderr_1 = '';
                                (_a = child.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (chunk) {
                                    stderr_1 += chunk.toString('utf-8');
                                });
                                child.on('error', function (err) {
                                    if (onLog) {
                                        onLog("[verifyOutput] ffmpeg decode error: ".concat(err.message));
                                    }
                                    resolve(false);
                                });
                                child.on('close', function (code) {
                                    if (code === 0 && !stderr_1.trim()) {
                                        resolve(true);
                                    }
                                    else {
                                        if (onLog) {
                                            onLog("[verifyOutput] ffmpeg decode finished with code=".concat(code, ", stderrTail=").concat(stderr_1.slice(-400)));
                                        }
                                        resolve(false);
                                    }
                                });
                            }
                            catch (err) {
                                if (onLog) {
                                    onLog("[verifyOutput] Failed to spawn ffmpeg decode: ".concat((err === null || err === void 0 ? void 0 : err.message) || String(err)));
                                }
                                resolve(false);
                            }
                        })];
                case 2:
                    decodeOk = _k.sent();
                    return [2 /*return*/, {
                            durationSec: durationSec,
                            fps: fps,
                            videoCodec: videoCodec,
                            audioCodec: audioCodec,
                            durationDiffSec: durationDiffSec,
                            durationWarning: durationWarning,
                            decodeOk: decodeOk,
                        }];
            }
        });
    });
}
