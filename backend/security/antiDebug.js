/**
 * Anti-Debugging Utilities
 * Phát hiện và ngăn chặn debugger, DevTools, reverse engineering
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
/**
 * Detect DevTools (Chrome DevTools, Firefox DevTools)
 */
export function detectDevTools() {
    if (typeof window === 'undefined') {
        return false; // Node.js environment
    }
    // Method 1: Check console size
    var threshold = 160;
    if (window.outerHeight - window.innerHeight > threshold ||
        window.outerWidth - window.innerWidth > threshold) {
        return true;
    }
    // Method 2: Check console object
    var devtools = false;
    var element = new Image();
    Object.defineProperty(element, 'id', {
        get: function () {
            devtools = true;
            return '';
        },
    });
    console.log(element);
    console.clear();
    return devtools;
}
/**
 * Detect debugger statement
 */
export function detectDebugger() {
    var detected = false;
    var start = Date.now();
    debugger; // eslint-disable-line no-debugger
    var end = Date.now();
    // Nếu debugger được attach, thời gian sẽ > 100ms
    if (end - start > 100) {
        detected = true;
    }
    return detected;
}
/**
 * Detect common debugging tools (process names)
 */
export function detectDebuggerProcess() {
    return new Promise(function (resolve) {
        if (typeof process === 'undefined' || process.platform !== 'win32') {
            resolve(false);
            return;
        }
        var exec = require('child_process').exec;
        exec('tasklist', { windowsHide: true }, function (error, stdout) {
            if (error) {
                resolve(false);
                return;
            }
            var debuggerProcesses = [
                'ollydbg.exe',
                'x64dbg.exe',
                'x32dbg.exe',
                'windbg.exe',
                'ida.exe',
                'ida64.exe',
                'idaq.exe',
                'idaq64.exe',
                'ghidra.exe',
                'cheatengine.exe',
                'processhacker.exe',
                'procmon.exe',
                'wireshark.exe',
                'fiddler.exe',
                'charles.exe',
            ];
            var lowerStdout = stdout.toLowerCase();
            var found = debuggerProcesses.some(function (proc) { return lowerStdout.includes(proc); });
            resolve(found);
        });
    });
}
/**
 * Detect VM/Sandbox environment
 */
export function detectVM() {
    if (typeof process === 'undefined') {
        return false;
    }
    // Check common VM indicators
    var vmIndicators = [
        'VMware',
        'VirtualBox',
        'VBOX',
        'QEMU',
        'Xen',
        'Bochs',
        'Parallels',
    ];
    var env = process.env;
    var envString = JSON.stringify(env).toLowerCase();
    return vmIndicators.some(function (indicator) { return envString.includes(indicator.toLowerCase()); });
}
/**
 * Anti-debugging loop (làm chậm debugger)
 */
export function antiDebugLoop() {
    if (typeof window === 'undefined') {
        return;
    }
    setInterval(function () {
        var start = Date.now();
        debugger; // eslint-disable-line no-debugger
        var end = Date.now();
        if (end - start > 100) {
            // Debugger detected - có thể log hoặc thực hiện action
            console.warn('[Security] Debugger detected');
        }
    }, 1000);
}
/**
 * Disable right-click context menu (basic protection)
 */
export function disableContextMenu() {
    if (typeof window === 'undefined') {
        return;
    }
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });
    // Disable F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    document.addEventListener('keydown', function (e) {
        if (e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
            (e.ctrlKey && e.key === 'U')) {
            e.preventDefault();
            return false;
        }
    });
}
/**
 * Main anti-debugging check
 * Returns true if debugging detected
 */
export function checkAntiDebug() {
    return __awaiter(this, void 0, void 0, function () {
        var checks, processCheck;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    // Chỉ check trong production
                    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
                        return [2 /*return*/, false];
                    }
                    checks = [
                        detectDevTools(),
                        detectDebugger(),
                        detectVM(),
                    ];
                    return [4 /*yield*/, detectDebuggerProcess()];
                case 1:
                    processCheck = _a.sent();
                    checks.push(processCheck);
                    return [2 /*return*/, checks.some(function (check) { return check === true; })];
            }
        });
    });
}
/**
 * Initialize anti-debugging (chỉ trong production)
 */
export function initAntiDebug() {
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) {
        return; // Skip in dev mode
    }
    // Disable context menu
    if (typeof window !== 'undefined') {
        disableContextMenu();
    }
    // Start anti-debug loop (chỉ trong renderer)
    if (typeof window !== 'undefined') {
        antiDebugLoop();
    }
}
