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
var _a, _b;
import { app } from 'electron';
import { getMachineHash } from './machineId';
import { readStoredTicket, writeStoredTicket, clearStoredTicket } from './ticketStore';
import { getDecryptedString } from '../security/stringEncryption';
// Fallback về plaintext nếu encryption fail
var DEFAULT_BASE;
var DEFAULT_INSTALLER_KEY;
try {
    DEFAULT_BASE = getDecryptedString('LICENSE_BASE');
    DEFAULT_INSTALLER_KEY = getDecryptedString('INSTALLER_KEY');
}
catch (_c) {
    DEFAULT_BASE = 'https://license-server.dungdong333.workers.dev';
    DEFAULT_INSTALLER_KEY = 'Ins$2025!LEONYG';
}
var API_BASE = (_a = process.env.LICENSE_SERVER_BASE) !== null && _a !== void 0 ? _a : DEFAULT_BASE;
var INSTALLER_KEY = (_b = process.env.LICENSE_INSTALLER_KEY) !== null && _b !== void 0 ? _b : DEFAULT_INSTALLER_KEY;
var REQUEST_TIMEOUT_MS = 8000;
var OFFLINE_TTL_MS = 24 * 60 * 60 * 1000;
function postJson(path_1, body_1) {
    return __awaiter(this, arguments, void 0, function (path, body, headers) {
        var controller, timeout, response, text;
        if (headers === void 0) { headers = {}; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    controller = new AbortController();
                    timeout = setTimeout(function () { return controller.abort(); }, REQUEST_TIMEOUT_MS);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, , 6, 7]);
                    return [4 /*yield*/, fetch("".concat(API_BASE).concat(path), {
                            method: 'POST',
                            headers: __assign({ 'content-type': 'application/json' }, headers),
                            body: JSON.stringify(body),
                            signal: controller.signal,
                        })];
                case 2:
                    response = _a.sent();
                    if (!!response.ok) return [3 /*break*/, 4];
                    return [4 /*yield*/, response.text()];
                case 3:
                    text = _a.sent();
                    throw new Error("HTTP ".concat(response.status, ": ").concat(text));
                case 4: return [4 /*yield*/, response.json()];
                case 5: return [2 /*return*/, (_a.sent())];
                case 6:
                    clearTimeout(timeout);
                    return [7 /*endfinally*/];
                case 7: return [2 /*return*/];
            }
        });
    });
}
export function submitLicenseRequest(note) {
    return __awaiter(this, void 0, void 0, function () {
        var machineHash, version, stored, payload, ticket, state, error_1;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineHash = _b.sent();
                    version = app.getVersion();
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    stored = readStoredTicket();
                    if (stored === null || stored === void 0 ? void 0 : stored.requestId) {
                        return [2 /*return*/, {
                                success: true,
                                state: {
                                    status: 'pending',
                                    machineHash: machineHash,
                                    requestId: stored.requestId,
                                    note: stored.note,
                                    message: 'Yêu cầu kích hoạt đã được gửi trước đó, đang chờ admin phê duyệt.',
                                },
                            }];
                    }
                    return [4 /*yield*/, postJson('/api/licenses/register', {
                            machineId: machineHash,
                            version: version,
                            note: note,
                        }, { 'x-installer-key': INSTALLER_KEY })];
                case 3:
                    payload = _b.sent();
                    if (payload.status === 'approved') {
                        ticket = payload.ticket;
                        state = {
                            status: 'ok',
                            machineHash: machineHash,
                            ticket: ticket,
                            lastSuccessAt: Date.now(),
                        };
                        writeStoredTicket({
                            ticket: ticket,
                            lastSuccessAt: state.lastSuccessAt,
                        });
                        return [2 /*return*/, { success: true, state: state }];
                    }
                    writeStoredTicket({
                        requestId: payload.requestId,
                        note: note,
                    });
                    return [2 /*return*/, {
                            success: true,
                            state: {
                                status: 'pending',
                                machineHash: machineHash,
                                requestId: payload.requestId,
                                note: note,
                                message: (_a = payload.message) !== null && _a !== void 0 ? _a : 'Yêu cầu kích hoạt đã được gửi. Vui lòng đợi admin phê duyệt.',
                            },
                        }];
                case 4:
                    error_1 = _b.sent();
                    return [2 /*return*/, {
                            success: false,
                            error: (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || String(error_1),
                            state: {
                                status: 'needsRegistration',
                                machineHash: machineHash,
                                message: (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || 'Không thể gửi yêu cầu kích hoạt.',
                            },
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function pollApproval(requestId, machineHash) {
    return __awaiter(this, void 0, void 0, function () {
        var result, ticket, lastSuccessAt, stored, error_2;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, postJson('/api/licenses/poll', {
                            requestId: requestId,
                            machineId: machineHash,
                        })];
                case 1:
                    result = _d.sent();
                    if (result.status === 'approved') {
                        ticket = result.ticket;
                        lastSuccessAt = Date.now();
                        writeStoredTicket({
                            ticket: ticket,
                            lastSuccessAt: lastSuccessAt,
                        });
                        return [2 /*return*/, {
                                status: 'ok',
                                machineHash: machineHash,
                                ticket: ticket,
                                lastSuccessAt: lastSuccessAt,
                                message: 'Yêu cầu đã được phê duyệt.',
                            }];
                    }
                    if (result.status === 'denied') {
                        clearStoredTicket();
                        return [2 /*return*/, {
                                status: 'denied',
                                machineHash: machineHash,
                                message: (_a = result.reason) !== null && _a !== void 0 ? _a : 'Yêu cầu bị từ chối. Gửi lại yêu cầu mới.',
                            }];
                    }
                    stored = readStoredTicket();
                    return [2 /*return*/, {
                            status: 'pending',
                            machineHash: machineHash,
                            requestId: (_b = stored === null || stored === void 0 ? void 0 : stored.requestId) !== null && _b !== void 0 ? _b : requestId,
                            note: stored === null || stored === void 0 ? void 0 : stored.note,
                            message: (_c = result.message) !== null && _c !== void 0 ? _c : 'Đang chờ admin phê duyệt...',
                        }];
                case 2:
                    error_2 = _d.sent();
                    return [2 /*return*/, {
                            status: 'pending',
                            machineHash: machineHash,
                            requestId: requestId,
                            message: (error_2 === null || error_2 === void 0 ? void 0 : error_2.message) || 'Không thể kiểm tra trạng thái. Thử lại sau.',
                        }];
                case 3: return [2 /*return*/];
            }
        });
    });
}
export function clearLicense() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            clearStoredTicket();
            return [2 /*return*/];
        });
    });
}
export function evaluateLicenseState() {
    return __awaiter(this, arguments, void 0, function (forceRemote) {
        var machineHash, stored, version, age, result, lastSuccessAt, error_3, canUseOffline;
        var _a;
        if (forceRemote === void 0) { forceRemote = false; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineHash = _b.sent();
                    stored = readStoredTicket();
                    if (!stored || (!stored.ticket && !stored.requestId)) {
                        return [2 /*return*/, {
                                status: 'needsRegistration',
                                machineHash: machineHash,
                                message: 'Chưa gửi yêu cầu kích hoạt. Nhấn “Gửi yêu cầu” để bắt đầu.',
                            }];
                    }
                    if (!(!stored.ticket && stored.requestId)) return [3 /*break*/, 3];
                    return [4 /*yield*/, pollApproval(stored.requestId, machineHash)];
                case 2: return [2 /*return*/, _b.sent()];
                case 3:
                    if (!stored.ticket) {
                        return [2 /*return*/, {
                                status: 'needsRegistration',
                                machineHash: machineHash,
                                message: 'Thiếu ticket license, vui lòng gửi lại yêu cầu.',
                            }];
                    }
                    version = app.getVersion();
                    _b.label = 4;
                case 4:
                    _b.trys.push([4, 6, , 7]);
                    if (!forceRemote) {
                        age = stored.lastSuccessAt ? Date.now() - stored.lastSuccessAt : Infinity;
                        if (age < 5000) {
                            return [2 /*return*/, {
                                    status: 'ok',
                                    machineHash: machineHash,
                                    ticket: stored.ticket,
                                    lastSuccessAt: stored.lastSuccessAt,
                                }];
                        }
                    }
                    return [4 /*yield*/, postJson('/api/licenses/check', {
                            ticket: stored.ticket,
                            machineId: machineHash,
                            version: version,
                        })];
                case 5:
                    result = _b.sent();
                    if (result.allow) {
                        lastSuccessAt = Date.now();
                        writeStoredTicket(__assign(__assign({}, stored), { lastSuccessAt: lastSuccessAt }));
                        return [2 /*return*/, {
                                status: 'ok',
                                machineHash: machineHash,
                                ticket: stored.ticket,
                                lastSuccessAt: lastSuccessAt,
                            }];
                    }
                    return [2 /*return*/, {
                            status: 'denied',
                            machineHash: machineHash,
                            ticket: stored.ticket,
                            message: (_a = result.reason) !== null && _a !== void 0 ? _a : 'License bị từ chối bởi server',
                        }];
                case 6:
                    error_3 = _b.sent();
                    canUseOffline = stored.lastSuccessAt && Date.now() - stored.lastSuccessAt < OFFLINE_TTL_MS
                        ? true
                        : false;
                    if (canUseOffline) {
                        return [2 /*return*/, {
                                status: 'offline',
                                machineHash: machineHash,
                                ticket: stored.ticket,
                                lastSuccessAt: stored.lastSuccessAt,
                                message: 'Không thể kết nối tới license server, tạm thời cho phép chạy offline.',
                            }];
                    }
                    return [2 /*return*/, {
                            status: 'denied',
                            machineHash: machineHash,
                            ticket: stored.ticket,
                            message: (error_3 === null || error_3 === void 0 ? void 0 : error_3.message) || 'Không thể kiểm tra license.',
                        }];
                case 7: return [2 /*return*/];
            }
        });
    });
}
