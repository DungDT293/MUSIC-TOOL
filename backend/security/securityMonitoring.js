/**
 * Security Monitoring & Alerting
 * Phát hiện và báo cáo các hoạt động đáng ngờ (crack attempts)
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
import { getMachineHash } from '../license/machineId';
// Cache để track các events gần đây (tránh spam)
var recentEvents = new Map();
var EVENT_WINDOW_MS = 60 * 1000; // 1 phút
var MAX_EVENTS_PER_WINDOW = 5;
/**
 * Check nếu event này nên được report (rate limiting)
 */
function shouldReportEvent(eventType, machineId) {
    var key = "".concat(machineId, ":").concat(eventType);
    var now = Date.now();
    var events = recentEvents.get(key) || [];
    // Remove old events
    var recent = events.filter(function (time) { return now - time < EVENT_WINDOW_MS; });
    if (recent.length >= MAX_EVENTS_PER_WINDOW) {
        // Quá nhiều events trong window → không report để tránh spam
        return false;
    }
    recent.push(now);
    recentEvents.set(key, recent);
    return true;
}
/**
 * Report security event lên server
 */
export function reportSecurityEvent(event) {
    return __awaiter(this, void 0, void 0, function () {
        var response, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    // Chỉ report nếu không bị rate limit
                    if (!shouldReportEvent(event.type, event.machineId)) {
                        console.warn("[SecurityMonitoring] Rate limited: ".concat(event.type, " for ").concat(event.machineId));
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, fetch('https://license-server.dungdong333.workers.dev/api/security/report', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                event: event.type,
                                severity: event.severity,
                                message: event.message,
                                details: event.details,
                                timestamp: event.timestamp,
                                machineId: event.machineId,
                                username: event.username,
                                appVersion: '1.0.4',
                            }),
                        })];
                case 1:
                    response = _a.sent();
                    if (!response.ok) {
                        console.warn("[SecurityMonitoring] Failed to report event: ".concat(response.status));
                    }
                    else {
                        console.log("[SecurityMonitoring] Event reported: ".concat(event.type, " (").concat(event.severity, ")"));
                    }
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _a.sent();
                    // Không throw - chỉ log để không làm gián đoạn app
                    console.warn("[SecurityMonitoring] Failed to report security event:", error_1.message);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Report signature invalid
 */
export function reportSignatureInvalid(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'SIGNATURE_INVALID',
                            severity: 'high',
                            message: "Invalid signature detected for ".concat(details.method, " ").concat(details.path),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report signature replay (timestamp quá cũ hoặc nonce reused)
 */
export function reportSignatureReplay(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'SIGNATURE_REPLAY',
                            severity: 'high',
                            message: "Possible replay attack detected: timestamp age ".concat(details.age, "ms"),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report nonce reused
 */
export function reportNonceReused(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'NONCE_REUSED',
                            severity: 'critical',
                            message: "Nonce reused detected - possible replay attack",
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report license check failed nhiều lần
 */
export function reportLicenseCheckFailed(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'LICENSE_CHECK_FAILED',
                            severity: details.attemptCount && details.attemptCount > 5 ? 'high' : 'medium',
                            message: "License check failed: ".concat(details.reason),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report tampering detected
 */
export function reportTamperingDetected(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'TAMPERING_DETECTED',
                            severity: 'critical',
                            message: "Tampering detected: ".concat(details.reasons.join(', ')),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report anti-debugging triggered
 */
export function reportAntiDebugTriggered(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'ANTI_DEBUG_TRIGGERED',
                            severity: 'high',
                            message: "Anti-debugging triggered: ".concat(details.method),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report machine ID mismatch
 */
export function reportMachineIdMismatch(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'MACHINE_ID_MISMATCH',
                            severity: 'high',
                            message: "Machine ID mismatch in ".concat(details.context),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report encryption/decryption failed
 */
export function reportEncryptionFailed(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'ENCRYPTION_DECRYPT_FAILED',
                            severity: 'high',
                            message: "".concat(details.operation, " failed: ").concat(details.error),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report file integrity check failed
 */
export function reportFileIntegrityFailed(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'FILE_INTEGRITY_FAILED',
                            severity: 'critical',
                            message: "File integrity check failed: ".concat(details.file),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report multiple machine IDs cho cùng account
 */
export function reportMultipleMachineIds(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'MULTIPLE_MACHINE_IDS',
                            severity: 'high',
                            message: "Account ".concat(details.username, " using ").concat(details.count, " different machine IDs"),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                            username: details.username,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Report rate limit exceeded
 */
export function reportRateLimitExceeded(details) {
    return __awaiter(this, void 0, void 0, function () {
        var machineId;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, reportSecurityEvent({
                            type: 'RATE_LIMIT_EXCEEDED',
                            severity: 'medium',
                            message: "Rate limit exceeded: ".concat(details.count, " requests in ").concat(details.window, "ms"),
                            details: details,
                            timestamp: Date.now(),
                            machineId: machineId,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Initialize security monitoring
 */
export function initSecurityMonitoring() {
    // Cleanup old events mỗi 5 phút
    setInterval(function () {
        var now = Date.now();
        for (var _i = 0, _a = recentEvents.entries(); _i < _a.length; _i++) {
            var _b = _a[_i], key = _b[0], events = _b[1];
            var recent = events.filter(function (time) { return now - time < EVENT_WINDOW_MS; });
            if (recent.length === 0) {
                recentEvents.delete(key);
            }
            else {
                recentEvents.set(key, recent);
            }
        }
    }, 5 * 60 * 1000); // 5 phút
}
