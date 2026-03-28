/**
 * API Request Signing
 * Mỗi request kèm theo timestamp, nonce, và HMAC signature để chống replay attack và tampering
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
import crypto from 'node:crypto';
import { getMachineHash } from '../license/machineId';
import { reportSignatureInvalid, reportSignatureReplay, reportNonceReused, } from './securityMonitoring';
// Cache để track nonces đã dùng (chống replay)
var usedNonces = new Map();
var NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút
var SIGNATURE_ALGORITHM = 'sha256';
var NONCE_LENGTH = 16;
var TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 phút
/**
 * Generate nonce (random string)
 */
function generateNonce() {
    return crypto.randomBytes(NONCE_LENGTH).toString('hex');
}
/**
 * Derive signing key từ machineId
 */
function deriveSigningKey(machineId) {
    return __awaiter(this, void 0, void 0, function () {
        var salt;
        return __generator(this, function (_a) {
            salt = Buffer.from('93MediaToolMixNhac2025APISigningSalt!', 'utf8');
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    crypto.pbkdf2(machineId, salt, 10000, 32, 'sha256', function (err, derivedKey) {
                        if (err)
                            reject(err);
                        else
                            resolve(derivedKey);
                    });
                })];
        });
    });
}
/**
 * Create signature string từ payload
 * Format: timestamp|nonce|method|path|body
 */
function createSignatureString(timestamp, nonce, method, path, body) {
    return "".concat(timestamp, "|").concat(nonce, "|").concat(method, "|").concat(path, "|").concat(body);
}
/**
 * Calculate HMAC signature
 */
function calculateSignature(signatureString, key) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, crypto.createHmac(SIGNATURE_ALGORITHM, key).update(signatureString).digest('hex')];
        });
    });
}
/**
 * Sign request
 * Returns: { timestamp, nonce, signature }
 */
export function signRequest(method, path, body) {
    return __awaiter(this, void 0, void 0, function () {
        var timestamp, nonce, bodyString, machineId, signingKey, signatureString, signature;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    timestamp = Date.now();
                    nonce = generateNonce();
                    bodyString = typeof body === 'string' ? body : JSON.stringify(body);
                    return [4 /*yield*/, getMachineHash()];
                case 1:
                    machineId = _a.sent();
                    return [4 /*yield*/, deriveSigningKey(machineId)];
                case 2:
                    signingKey = _a.sent();
                    signatureString = createSignatureString(timestamp, nonce, method, path, bodyString);
                    return [4 /*yield*/, calculateSignature(signatureString, signingKey)];
                case 3:
                    signature = _a.sent();
                    return [2 /*return*/, {
                            timestamp: timestamp,
                            nonce: nonce,
                            signature: signature,
                        }];
            }
        });
    });
}
/**
 * Verify request signature
 * (Dùng cho server-side, nhưng có thể test client-side)
 */
export function verifyRequest(method, path, body, timestamp, nonce, signature) {
    return __awaiter(this, void 0, void 0, function () {
        var now, age, nonceKey, _i, _a, _b, key, time, machineId, signingKey, signatureString, expectedSignature, isValid, error_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 10, , 11]);
                    now = Date.now();
                    age = Math.abs(now - timestamp);
                    if (!(age > TIMESTAMP_TOLERANCE_MS)) return [3 /*break*/, 2];
                    console.warn("[APISigning] Request timestamp too old/new: ".concat(age, "ms"));
                    // Report replay attack
                    return [4 /*yield*/, reportSignatureReplay({
                            path: path,
                            method: method,
                            timestamp: timestamp,
                            age: age,
                        })];
                case 1:
                    // Report replay attack
                    _c.sent();
                    return [2 /*return*/, false];
                case 2:
                    nonceKey = "".concat(timestamp, ":").concat(nonce);
                    if (!usedNonces.has(nonceKey)) return [3 /*break*/, 4];
                    console.warn("[APISigning] Nonce reused: ".concat(nonce));
                    // Report nonce reuse
                    return [4 /*yield*/, reportNonceReused({
                            path: path,
                            method: method,
                            nonce: nonce,
                        })];
                case 3:
                    // Report nonce reuse
                    _c.sent();
                    return [2 /*return*/, false];
                case 4:
                    // Mark nonce as used
                    usedNonces.set(nonceKey, now);
                    // Cleanup old nonces
                    for (_i = 0, _a = usedNonces.entries(); _i < _a.length; _i++) {
                        _b = _a[_i], key = _b[0], time = _b[1];
                        if (now - time > NONCE_CACHE_TTL_MS) {
                            usedNonces.delete(key);
                        }
                    }
                    return [4 /*yield*/, getMachineHash()];
                case 5:
                    machineId = _c.sent();
                    return [4 /*yield*/, deriveSigningKey(machineId)];
                case 6:
                    signingKey = _c.sent();
                    signatureString = createSignatureString(timestamp, nonce, method, path, body);
                    return [4 /*yield*/, calculateSignature(signatureString, signingKey)];
                case 7:
                    expectedSignature = _c.sent();
                    isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
                    if (!!isValid) return [3 /*break*/, 9];
                    // Report invalid signature
                    return [4 /*yield*/, reportSignatureInvalid({
                            path: path,
                            method: method,
                            expectedSignature: expectedSignature,
                            receivedSignature: signature,
                        })];
                case 8:
                    // Report invalid signature
                    _c.sent();
                    _c.label = 9;
                case 9: return [2 /*return*/, isValid];
                case 10:
                    error_1 = _c.sent();
                    console.warn('[APISigning] Signature verification failed:', error_1);
                    return [2 /*return*/, false];
                case 11: return [2 /*return*/];
            }
        });
    });
}
/**
 * Create signed headers cho request
 */
export function createSignedHeaders(method, path, body) {
    return __awaiter(this, void 0, void 0, function () {
        var signed, _a;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, signRequest(method, path, body)];
                case 1:
                    signed = _c.sent();
                    _b = {
                        'x-timestamp': signed.timestamp.toString(),
                        'x-nonce': signed.nonce,
                        'x-signature': signed.signature
                    };
                    _a = 'x-machine-id';
                    return [4 /*yield*/, getMachineHash()];
                case 2: return [2 /*return*/, (_b[_a] = _c.sent(),
                        _b)];
            }
        });
    });
}
