/**
 * Environment Detection
 * Phát hiện VM, sandbox, và môi trường không an toàn
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
var execFileAsync = promisify(execFile);
/**
 * Detect Virtual Machine
 */
export function detectVM() {
    return __awaiter(this, void 0, void 0, function () {
        var vmIndicators, _i, vmIndicators_1, vm, _a, _b, check, stdout, output, vmKeywords, keywords, _c, keywords_1, keyword, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (process.platform !== 'win32') {
                        return [2 /*return*/, { detected: false }];
                    }
                    vmIndicators = [
                        {
                            type: 'VMware',
                            checks: [
                                { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
                                { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
                                { command: 'reg', args: ['query', 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\vmware'] },
                            ],
                        },
                        {
                            type: 'VirtualBox',
                            checks: [
                                { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
                                { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
                                { command: 'reg', args: ['query', 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\VBoxGuest'] },
                            ],
                        },
                        {
                            type: 'QEMU',
                            checks: [
                                { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
                                { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
                            ],
                        },
                        {
                            type: 'Hyper-V',
                            checks: [
                                { command: 'wmic', args: ['path', 'Win32_BaseBoard', 'get', 'Product'] },
                                { command: 'wmic', args: ['path', 'Win32_BIOS', 'get', 'Manufacturer'] },
                            ],
                        },
                    ];
                    _i = 0, vmIndicators_1 = vmIndicators;
                    _e.label = 1;
                case 1:
                    if (!(_i < vmIndicators_1.length)) return [3 /*break*/, 8];
                    vm = vmIndicators_1[_i];
                    _a = 0, _b = vm.checks;
                    _e.label = 2;
                case 2:
                    if (!(_a < _b.length)) return [3 /*break*/, 7];
                    check = _b[_a];
                    _e.label = 3;
                case 3:
                    _e.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, execFileAsync(check.command, check.args, {
                            windowsHide: true,
                            timeout: 3000,
                        })];
                case 4:
                    stdout = (_e.sent()).stdout;
                    output = stdout.toLowerCase();
                    vmKeywords = {
                        VMware: ['vmware', 'vmware, inc.'],
                        VirtualBox: ['virtualbox', 'innotek', 'oracle'],
                        QEMU: ['qemu', 'bochs'],
                        'Hyper-V': ['microsoft corporation', 'hyper-v'],
                    };
                    keywords = vmKeywords[vm.type] || [];
                    for (_c = 0, keywords_1 = keywords; _c < keywords_1.length; _c++) {
                        keyword = keywords_1[_c];
                        if (output.includes(keyword)) {
                            return [2 /*return*/, { detected: true, type: vm.type }];
                        }
                    }
                    return [3 /*break*/, 6];
                case 5:
                    _d = _e.sent();
                    return [3 /*break*/, 6];
                case 6:
                    _a++;
                    return [3 /*break*/, 2];
                case 7:
                    _i++;
                    return [3 /*break*/, 1];
                case 8: return [2 /*return*/, { detected: false }];
            }
        });
    });
}
/**
 * Detect Sandbox Environment
 */
export function detectSandbox() {
    return __awaiter(this, void 0, void 0, function () {
        var sandboxIndicators, stdout, processes, _i, sandboxIndicators_1, sandbox, _a, _b, processName, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    if (process.platform !== 'win32') {
                        return [2 /*return*/, { detected: false }];
                    }
                    sandboxIndicators = [
                        {
                            type: 'Sandboxie',
                            processNames: ['sandboxiedcomlaunch.exe', 'sandboxierpcss.exe', 'sandboxiedcomlaunch.exe'],
                        },
                        {
                            type: 'Cuckoo',
                            processNames: ['cuckoo.exe', 'cuckoo-sandbox.exe'],
                        },
                        {
                            type: 'JoeBox',
                            processNames: ['joeboxserver.exe', 'joeboxcontrol.exe'],
                        },
                        {
                            type: 'Anubis',
                            processNames: ['anubis.exe'],
                        },
                    ];
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
                            windowsHide: true,
                            timeout: 3000,
                        })];
                case 2:
                    stdout = (_d.sent()).stdout;
                    processes = stdout.toLowerCase();
                    for (_i = 0, sandboxIndicators_1 = sandboxIndicators; _i < sandboxIndicators_1.length; _i++) {
                        sandbox = sandboxIndicators_1[_i];
                        for (_a = 0, _b = sandbox.processNames; _a < _b.length; _a++) {
                            processName = _b[_a];
                            if (processes.includes(processName.toLowerCase())) {
                                return [2 /*return*/, { detected: true, type: sandbox.type }];
                            }
                        }
                    }
                    return [3 /*break*/, 4];
                case 3:
                    _c = _d.sent();
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/, { detected: false }];
            }
        });
    });
}
/**
 * Check if environment is safe
 */
export function isSafeEnvironment() {
    return __awaiter(this, void 0, void 0, function () {
        var detected, vmResult, sandboxResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Skip check trong development mode
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
                        return [2 /*return*/, { safe: true }];
                    }
                    detected = [];
                    return [4 /*yield*/, detectVM()];
                case 1:
                    vmResult = _a.sent();
                    if (vmResult.detected) {
                        detected.push("VM detected: ".concat(vmResult.type));
                    }
                    return [4 /*yield*/, detectSandbox()];
                case 2:
                    sandboxResult = _a.sent();
                    if (sandboxResult.detected) {
                        detected.push("Sandbox detected: ".concat(sandboxResult.type));
                    }
                    if (detected.length > 0) {
                        return [2 /*return*/, {
                                safe: false,
                                reason: "Unsafe environment detected: ".concat(detected.join(', ')),
                                detected: detected,
                            }];
                    }
                    return [2 /*return*/, { safe: true }];
            }
        });
    });
}
