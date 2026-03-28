/**
 * License Check Helper
 * Kiểm tra license trước khi thực hiện actions quan trọng
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
import { evaluateLicenseState } from '../license/onlineLicenseService';
import { reportLicenseCheckFailed } from './securityMonitoring';
// Track license check failures
var licenseCheckFailures = new Map();
var FAILURE_WINDOW_MS = 60 * 1000; // 1 phút
/**
 * Check license và throw error nếu không hợp lệ
 */
export function requireValidLicense() {
    return __awaiter(this, void 0, void 0, function () {
        var state, machineId_1, failures, message, machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, evaluateLicenseState(false)]; // Không force remote để nhanh hơn
                case 1:
                    state = _a.sent() // Không force remote để nhanh hơn
                    ;
                    if (!(state.status !== 'ok')) return [3 /*break*/, 4];
                    machineId_1 = state.machineHash;
                    failures = (licenseCheckFailures.get(machineId_1) || 0) + 1;
                    licenseCheckFailures.set(machineId_1, failures);
                    // Cleanup old failures
                    setTimeout(function () {
                        licenseCheckFailures.delete(machineId_1);
                    }, FAILURE_WINDOW_MS);
                    if (!(failures >= 3)) return [3 /*break*/, 3];
                    return [4 /*yield*/, reportLicenseCheckFailed({
                            reason: state.message || 'License check failed',
                            status: state.status,
                            attemptCount: failures,
                        })];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3:
                    message = 'License không hợp lệ. ';
                    switch (state.status) {
                        case 'needsRegistration':
                            message += 'Vui lòng đăng ký license.';
                            break;
                        case 'pending':
                            message += 'License đang chờ admin duyệt.';
                            break;
                        case 'denied':
                            message += state.message || 'License bị từ chối.';
                            break;
                        case 'offline':
                            message += 'Không thể kiểm tra license (offline mode).';
                            break;
                        default:
                            message += 'Trạng thái license không xác định.';
                    }
                    throw new Error(message);
                case 4:
                    machineId = state.machineHash;
                    licenseCheckFailures.delete(machineId);
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Check license và return boolean (không throw)
 */
export function hasValidLicense() {
    return __awaiter(this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, requireValidLicense()];
                case 1:
                    _b.sent();
                    return [2 /*return*/, true];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Get current license state
 */
export function getLicenseState() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, evaluateLicenseState(false)];
                case 1: return [2 /*return*/, _a.sent()];
            }
        });
    });
}
