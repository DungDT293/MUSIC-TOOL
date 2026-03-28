/**
 * Encrypted Auth Store - Mã hóa auth state để bảo mật
 * Sử dụng AES-256-GCM với key derivation từ machineId
 * Kèm HMAC-SHA256 để integrity check
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
import fs from 'node:fs';
import path from 'node:path';
import { getMachineHash } from '../license/machineId';
import { reportEncryptionFailed, reportMachineIdMismatch } from '../security/securityMonitoring';
var AUTH_FILE_NAME = 'authState.enc';
var SALT_LENGTH = 32;
var IV_LENGTH = 16;
var TAG_LENGTH = 16;
var HMAC_LENGTH = 32;
var PBKDF2_ITERATIONS = 10000;
var KEY_LENGTH = 32; // 256 bits
// Salt cố định được embed trong code (không lưu trong file)
// Nếu muốn tăng bảo mật, có thể random mỗi lần và lưu riêng
var EMBEDDED_SALT = Buffer.from('93MediaToolMixNhac2025SecuritySalt!', 'utf8');
function resolveStoragePath() {
    if (process.env.AUTH_STATE_PATH) {
        return process.env.AUTH_STATE_PATH.replace(/\.json$/, '.enc');
    }
    var commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData');
    var dir = path.join(commonAppData, '93MediaToolMixNhac');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, AUTH_FILE_NAME);
}
/**
 * Derive encryption key từ machineId
 */
function deriveKey(machineId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    crypto.pbkdf2(machineId, EMBEDDED_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', function (err, derivedKey) {
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
 * Derive HMAC key từ machineId (key khác với encryption key)
 */
function deriveHMACKey(machineId) {
    return __awaiter(this, void 0, void 0, function () {
        var hmacSalt;
        return __generator(this, function (_a) {
            hmacSalt = Buffer.from('93MediaToolMixNhac2025HMACSalt!', 'utf8');
            return [2 /*return*/, new Promise(function (resolve, reject) {
                    crypto.pbkdf2(machineId, hmacSalt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256', function (err, derivedKey) {
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
 * Tính HMAC-SHA256 của data
 */
function calculateHMAC(data, key) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, crypto.createHmac('sha256', key).update(data).digest()];
        });
    });
}
/**
 * Verify HMAC
 */
function verifyHMAC(data, hmac, key) {
    return __awaiter(this, void 0, void 0, function () {
        var calculated;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, calculateHMAC(data, key)];
                case 1:
                    calculated = _a.sent();
                    return [2 /*return*/, crypto.timingSafeEqual(calculated, hmac)];
            }
        });
    });
}
/**
 * Mã hóa auth state
 */
function encryptAuthState(state, machineId) {
    return __awaiter(this, void 0, void 0, function () {
        var plaintext, plaintextBuffer, encryptionKey, hmacKey, iv, cipher, encrypted, authTag, encryptedData, hmac, final;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    plaintext = JSON.stringify(state);
                    plaintextBuffer = Buffer.from(plaintext, 'utf8');
                    return [4 /*yield*/, deriveKey(machineId)];
                case 1:
                    encryptionKey = _a.sent();
                    return [4 /*yield*/, deriveHMACKey(machineId)
                        // Generate IV (Initialization Vector)
                    ];
                case 2:
                    hmacKey = _a.sent();
                    iv = crypto.randomBytes(IV_LENGTH);
                    cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
                    encrypted = Buffer.concat([cipher.update(plaintextBuffer, 'utf8'), cipher.final()]);
                    authTag = cipher.getAuthTag();
                    encryptedData = Buffer.concat([iv, encrypted, authTag]);
                    return [4 /*yield*/, calculateHMAC(encryptedData, hmacKey)
                        // Final format: HMAC + IV + Encrypted + AuthTag
                    ];
                case 3:
                    hmac = _a.sent();
                    final = Buffer.concat([hmac, encryptedData]);
                    // Return base64 encoded
                    return [2 /*return*/, final.toString('base64')];
            }
        });
    });
}
/**
 * Giải mã auth state
 */
function decryptAuthState(encryptedBase64, machineId) {
    return __awaiter(this, void 0, void 0, function () {
        var final, hmac, encryptedData, iv, encrypted, authTag, encryptionKey, hmacKey, isValidHMAC, decipher, decrypted, state, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 6, , 7]);
                    final = Buffer.from(encryptedBase64, 'base64');
                    // Extract components
                    if (final.length < HMAC_LENGTH + IV_LENGTH + TAG_LENGTH) {
                        console.warn('[encryptedAuthStore] Invalid encrypted data length');
                        return [2 /*return*/, null];
                    }
                    hmac = final.subarray(0, HMAC_LENGTH);
                    encryptedData = final.subarray(HMAC_LENGTH);
                    iv = encryptedData.subarray(0, IV_LENGTH);
                    encrypted = encryptedData.subarray(IV_LENGTH, encryptedData.length - TAG_LENGTH);
                    authTag = encryptedData.subarray(encryptedData.length - TAG_LENGTH);
                    return [4 /*yield*/, deriveKey(machineId)];
                case 1:
                    encryptionKey = _a.sent();
                    return [4 /*yield*/, deriveHMACKey(machineId)
                        // Verify HMAC trước khi decrypt
                    ];
                case 2:
                    hmacKey = _a.sent();
                    return [4 /*yield*/, verifyHMAC(encryptedData, hmac, hmacKey)];
                case 3:
                    isValidHMAC = _a.sent();
                    if (!!isValidHMAC) return [3 /*break*/, 5];
                    console.warn('[encryptedAuthStore] HMAC verification failed - data may be tampered');
                    // Report tampering attempt
                    return [4 /*yield*/, reportEncryptionFailed({
                            operation: 'decrypt',
                            error: 'HMAC verification failed - possible tampering',
                        })];
                case 4:
                    // Report tampering attempt
                    _a.sent();
                    return [2 /*return*/, null];
                case 5:
                    decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
                    decipher.setAuthTag(authTag);
                    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
                    state = JSON.parse(decrypted.toString('utf8'));
                    return [2 /*return*/, state];
                case 6:
                    error_1 = _a.sent();
                    console.warn('[encryptedAuthStore] Decryption failed:', error_1.message);
                    return [2 /*return*/, null];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/**
 * Đọc encrypted auth state từ file
 */
export function readEncryptedAuthState() {
    return __awaiter(this, void 0, void 0, function () {
        var file, encryptedBase64, currentMachineId, state, isSessionValid, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 8, , 9]);
                    file = resolveStoragePath();
                    if (!fs.existsSync(file)) {
                        return [2 /*return*/, null];
                    }
                    encryptedBase64 = fs.readFileSync(file, 'utf8').trim();
                    if (!encryptedBase64) {
                        return [2 /*return*/, null];
                    }
                    return [4 /*yield*/, getMachineHash()
                        // Decrypt
                    ];
                case 1:
                    currentMachineId = _a.sent();
                    return [4 /*yield*/, decryptAuthState(encryptedBase64, currentMachineId)];
                case 2:
                    state = _a.sent();
                    if (!state) {
                        console.warn('[encryptedAuthStore] Failed to decrypt auth state');
                        return [2 /*return*/, null];
                    }
                    if (!(state && state.status === 'allowed' && state.sessionInfo)) return [3 /*break*/, 5];
                    return [4 /*yield*/, import('./sessionManager')];
                case 3:
                    isSessionValid = (_a.sent()).isSessionValid;
                    if (!!isSessionValid(state.sessionInfo)) return [3 /*break*/, 5];
                    console.warn('[encryptedAuthStore] Session expired, clearing auth state');
                    return [4 /*yield*/, clearEncryptedAuthState()];
                case 4:
                    _a.sent();
                    return [2 /*return*/, null];
                case 5:
                    if (!(state.machineId !== currentMachineId)) return [3 /*break*/, 7];
                    console.warn('[encryptedAuthStore] MachineId mismatch! Stored:', state.machineId.substring(0, 16), '... Current:', currentMachineId.substring(0, 16), '...');
                    console.warn('[encryptedAuthStore] This may indicate tampering or machine change');
                    // Report machine ID mismatch
                    return [4 /*yield*/, reportMachineIdMismatch({
                            storedMachineId: state.machineId,
                            currentMachineId: currentMachineId,
                            context: 'encryptedAuthStore.read',
                        })];
                case 6:
                    // Report machine ID mismatch
                    _a.sent();
                    return [2 /*return*/, null];
                case 7: return [2 /*return*/, state];
                case 8:
                    error_2 = _a.sent();
                    console.warn('[encryptedAuthStore] Failed to read encrypted auth state:', error_2.message);
                    return [2 /*return*/, null];
                case 9: return [2 /*return*/];
            }
        });
    });
}
/**
 * Ghi encrypted auth state vào file
 */
export function writeEncryptedAuthState(state) {
    return __awaiter(this, void 0, void 0, function () {
        var currentMachineId, encryptedBase64, file, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, getMachineHash()];
                case 1:
                    currentMachineId = _a.sent();
                    if (state.machineId !== currentMachineId) {
                        console.warn('[encryptedAuthStore] MachineId mismatch when writing - using current machineId');
                        state.machineId = currentMachineId;
                    }
                    return [4 /*yield*/, encryptAuthState(state, currentMachineId)
                        // Write to file
                    ];
                case 2:
                    encryptedBase64 = _a.sent();
                    file = resolveStoragePath();
                    fs.writeFileSync(file, encryptedBase64, 'utf8');
                    return [3 /*break*/, 4];
                case 3:
                    error_3 = _a.sent();
                    console.error('[encryptedAuthStore] Failed to write encrypted auth state:', error_3.message);
                    throw error_3;
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Xóa encrypted auth state file
 */
export function clearEncryptedAuthState() {
    try {
        var file = resolveStoragePath();
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }
    catch (error) {
        console.error('[encryptedAuthStore] Failed to clear encrypted auth state:', error.message);
    }
}
/**
 * Migrate từ old plaintext format sang encrypted format
 * (Chỉ chạy một lần khi upgrade)
 */
export function migrateFromPlaintext() {
    return __awaiter(this, void 0, void 0, function () {
        var oldFile, oldData, oldState, backupFile, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    oldFile = resolveStoragePath().replace(/\.enc$/, '.json');
                    if (!fs.existsSync(oldFile)) {
                        return [2 /*return*/, false]; // Không có file cũ
                    }
                    oldData = fs.readFileSync(oldFile, 'utf8');
                    oldState = JSON.parse(oldData);
                    // Write new encrypted format
                    return [4 /*yield*/, writeEncryptedAuthState(oldState)
                        // Backup old file (đổi tên thay vì xóa)
                    ];
                case 1:
                    // Write new encrypted format
                    _a.sent();
                    backupFile = oldFile + '.backup';
                    fs.renameSync(oldFile, backupFile);
                    console.log('[encryptedAuthStore] Migrated from plaintext to encrypted format');
                    return [2 /*return*/, true];
                case 2:
                    error_4 = _a.sent();
                    console.warn('[encryptedAuthStore] Migration failed:', error_4.message);
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
