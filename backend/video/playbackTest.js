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
function runPlayerOnce(cmd, args, label) {
    return new Promise(function (resolve) {
        try {
            var child = spawn(cmd, args, { windowsHide: true });
            child.on('error', function () {
                resolve({ player: label, success: false, exitCode: null });
            });
            child.on('close', function (code) {
                resolve({ player: label, success: code === 0, exitCode: code !== null && code !== void 0 ? code : null });
            });
        }
        catch (_a) {
            resolve({ player: label, success: false, exitCode: null });
        }
    });
}
export function runPlaybackTest(outputPath) {
    return __awaiter(this, void 0, void 0, function () {
        var mpvArgs, vlcArgs, mpvResult, vlcResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    mpvArgs = ['--no-config', '--really-quiet', '--vo=null', '--ao=null', '--length=5', outputPath];
                    vlcArgs = [
                        '-I',
                        'dummy',
                        '--play-and-exit',
                        '--no-video-title-show',
                        '--start-time=0',
                        '--run-time=5',
                        outputPath,
                    ];
                    return [4 /*yield*/, runPlayerOnce('mpv', mpvArgs, 'mpv')];
                case 1:
                    mpvResult = _a.sent();
                    if (mpvResult.success)
                        return [2 /*return*/, mpvResult];
                    return [4 /*yield*/, runPlayerOnce('vlc', vlcArgs, 'vlc')];
                case 2:
                    vlcResult = _a.sent();
                    if (vlcResult.success)
                        return [2 /*return*/, vlcResult
                            // Nếu cả 2 đều không chạy được thành công, trả về kết quả xấu nhất (ưu tiên mpv nếu có thử)
                        ];
                    // Nếu cả 2 đều không chạy được thành công, trả về kết quả xấu nhất (ưu tiên mpv nếu có thử)
                    if (mpvResult.player && mpvResult.exitCode !== null)
                        return [2 /*return*/, mpvResult];
                    if (vlcResult.player && vlcResult.exitCode !== null)
                        return [2 /*return*/, vlcResult];
                    return [2 /*return*/, { player: null, success: false, exitCode: null }];
            }
        });
    });
}
