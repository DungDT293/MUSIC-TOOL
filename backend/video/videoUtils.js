/**
 * Video Utils - Helper functions for video validation and processing
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
import { getVideoFileInfo } from './videoInfo';
/**
 * Validate input files by probing them with ffprobe
 * Returns valid files and list of invalid file paths
 */
export function validateInputFiles(paths_1) {
    return __awaiter(this, arguments, void 0, function (paths, concurrency) {
        var valid, invalid, currentIndex, batch, batchSize, _loop_1, i, maxLog, invalidToLog;
        var _this = this;
        if (concurrency === void 0) { concurrency = 10; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    valid = [];
                    invalid = [];
                    currentIndex = 0;
                    _a.label = 1;
                case 1:
                    if (!(currentIndex < paths.length)) return [3 /*break*/, 3];
                    batch = [];
                    batchSize = Math.min(concurrency, paths.length - currentIndex);
                    _loop_1 = function (i) {
                        var index = currentIndex + i;
                        var filePath = paths[index];
                        var promise = (function () { return __awaiter(_this, void 0, void 0, function () {
                            var retryCount, maxRetries, info, error_1;
                            var _a, _b;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        retryCount = 0;
                                        maxRetries = 1;
                                        _c.label = 1;
                                    case 1:
                                        if (!(retryCount <= maxRetries)) return [3 /*break*/, 6];
                                        _c.label = 2;
                                    case 2:
                                        _c.trys.push([2, 4, , 5]);
                                        return [4 /*yield*/, getVideoFileInfo(filePath)
                                            // Check if file is valid: must have duration > 0
                                        ];
                                    case 3:
                                        info = _c.sent();
                                        // Check if file is valid: must have duration > 0
                                        if (info.durationSec && info.durationSec > 0) {
                                            valid.push({
                                                path: filePath,
                                                durationSec: info.durationSec,
                                                width: (_a = info.width) !== null && _a !== void 0 ? _a : undefined,
                                                height: (_b = info.height) !== null && _b !== void 0 ? _b : undefined,
                                                sizeBytes: typeof info.sizeBytes === 'number' ? info.sizeBytes : undefined,
                                            });
                                            return [2 /*return*/]; // Success, exit retry loop
                                        }
                                        else {
                                            // durationSec is null or <= 0
                                            invalid.push(filePath);
                                            console.warn("[validateInputFiles] Invalid file (duration <= 0 or null): ".concat(filePath));
                                            return [2 /*return*/]; // Invalid duration, no need to retry
                                        }
                                        return [3 /*break*/, 5];
                                    case 4:
                                        error_1 = _c.sent();
                                        retryCount++;
                                        if (retryCount > maxRetries) {
                                            // Final attempt failed, skip file
                                            invalid.push(filePath);
                                            console.warn("[validateInputFiles] Failed to probe ".concat(filePath, " after ").concat(maxRetries + 1, " attempt(s):"), error_1);
                                            return [2 /*return*/];
                                        }
                                        // Retry once
                                        console.log("[validateInputFiles] Retry ".concat(retryCount, "/").concat(maxRetries, " for ").concat(filePath));
                                        return [3 /*break*/, 5];
                                    case 5: return [3 /*break*/, 1];
                                    case 6: return [2 /*return*/];
                                }
                            });
                        }); })();
                        batch.push(promise);
                    };
                    for (i = 0; i < batchSize; i++) {
                        _loop_1(i);
                    }
                    // Đợi batch này hoàn thành trước khi process batch tiếp theo
                    return [4 /*yield*/, Promise.all(batch)
                        // Move to next batch
                    ];
                case 2:
                    // Đợi batch này hoàn thành trước khi process batch tiếp theo
                    _a.sent();
                    // Move to next batch
                    currentIndex += batchSize;
                    return [3 /*break*/, 1];
                case 3:
                    // Log summary
                    console.log("[validateInputFiles] Summary: total=".concat(paths.length, ", valid=").concat(valid.length, ", invalid=").concat(invalid.length));
                    if (invalid.length > 0) {
                        maxLog = 10;
                        invalidToLog = invalid.slice(0, maxLog);
                        console.log("[validateInputFiles] Invalid files (showing max ".concat(maxLog, "):"));
                        invalidToLog.forEach(function (path, idx) {
                            console.log("  ".concat(idx + 1, ". ").concat(path));
                        });
                        if (invalid.length > maxLog) {
                            console.log("  ... and ".concat(invalid.length - maxLog, " more"));
                        }
                    }
                    return [2 /*return*/, { valid: valid, invalid: invalid }];
            }
        });
    });
}
