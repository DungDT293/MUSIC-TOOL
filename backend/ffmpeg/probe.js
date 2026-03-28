/**
 * FFmpeg Probe - Probe file để lấy metadata (audio/video)
 */
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
import { runFfprobe } from './wrapper';
import fs from 'node:fs';
/**
 * Probe file để lấy metadata (audio/video streams, format info)
 */
export function probeFile(filePath) {
    return __awaiter(this, void 0, void 0, function () {
        var args, output, json, format, streams, audioStream, videoStream, _i, streams_1, s, formatInfo, audioInfo, sampleRate, channels, videoInfo, fps, parts, num, den, error_1;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    // Kiểm tra file tồn tại
                    if (!fs.existsSync(filePath)) {
                        throw new Error("File kh\u00F4ng t\u1ED3n t\u1EA1i: ".concat(filePath));
                    }
                    args = [
                        '-v', 'error',
                        '-show_entries', 'format=duration,size,bit_rate,start_time:format_tags=title,artist,album,album_artist,genre,date,lyrics,LYRICS,USLT:stream=codec_name,codec_type,sample_rate,channels,channel_layout,width,height,r_frame_rate,pix_fmt',
                        '-of', 'json',
                        filePath,
                    ];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, runFfprobe(args)];
                case 2:
                    output = _d.sent();
                    if (!output || output.trim().length === 0) {
                        throw new Error("FFprobe returned empty output for: ".concat(filePath));
                    }
                    json = JSON.parse(output);
                    format = json.format || {};
                    streams = Array.isArray(json.streams) ? json.streams : [];
                    audioStream = undefined;
                    videoStream = undefined;
                    for (_i = 0, streams_1 = streams; _i < streams_1.length; _i++) {
                        s = streams_1[_i];
                        if (!audioStream && (s === null || s === void 0 ? void 0 : s.codec_type) === 'audio')
                            audioStream = s;
                        else if (!videoStream && (s === null || s === void 0 ? void 0 : s.codec_type) === 'video')
                            videoStream = s;
                        if (audioStream && videoStream)
                            break;
                    }
                    formatInfo = {
                        duration: format.duration ? parseFloat(format.duration) : 0,
                        size: format.size ? parseInt(format.size, 10) : 0,
                        bit_rate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
                        start_time: format.start_time ? parseFloat(format.start_time) : undefined,
                        tags: __assign(__assign({}, (format.tags || {})), { 
                            // Try to get lyrics from various tag formats
                            lyrics: ((_a = format.tags) === null || _a === void 0 ? void 0 : _a.lyrics) || ((_b = format.tags) === null || _b === void 0 ? void 0 : _b.LYRICS) || ((_c = format.tags) === null || _c === void 0 ? void 0 : _c.USLT) || undefined }),
                    };
                    audioInfo = void 0;
                    if (audioStream) {
                        sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0;
                        channels = audioStream.channels ? parseInt(audioStream.channels, 10) : 0;
                        audioInfo = {
                            codec: audioStream.codec_name || 'unknown',
                            sample_rate: sampleRate,
                            channels: channels,
                            channel_layout: audioStream.channel_layout || undefined,
                        };
                    }
                    videoInfo = void 0;
                    if (videoStream) {
                        fps = 0;
                        if (videoStream.r_frame_rate) {
                            parts = videoStream.r_frame_rate.split('/');
                            if (parts.length === 2) {
                                num = parseFloat(parts[0]);
                                den = parseFloat(parts[1]);
                                fps = den > 0 ? num / den : 0;
                            }
                            else {
                                fps = parseFloat(videoStream.r_frame_rate) || 0;
                            }
                        }
                        videoInfo = {
                            codec: videoStream.codec_name || 'unknown',
                            width: videoStream.width ? parseInt(videoStream.width, 10) : 0,
                            height: videoStream.height ? parseInt(videoStream.height, 10) : 0,
                            fps: fps,
                            pix_fmt: videoStream.pix_fmt || undefined,
                        };
                    }
                    return [2 /*return*/, {
                            path: filePath,
                            format: formatInfo,
                            audio: audioInfo,
                            video: videoInfo,
                        }];
                case 3:
                    error_1 = _d.sent();
                    console.error("[probeFile] Error probing file ".concat(filePath, ":"), error_1);
                    // Re-throw với message rõ ràng hơn
                    if (error_1 instanceof SyntaxError) {
                        throw new Error("Failed to parse FFprobe JSON output for ".concat(filePath, ": ").concat(error_1.message));
                    }
                    throw error_1;
                case 4: return [2 /*return*/];
            }
        });
    });
}
