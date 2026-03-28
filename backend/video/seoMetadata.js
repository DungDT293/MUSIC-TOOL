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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'child_process';
import { getFfmpegPaths } from '../ffmpeg/config';
// ===== HELPER FUNCTIONS =====
function getExiftoolPath() {
    var candidates = [
        path.join(process.cwd(), 'bin', 'exiftool.exe'),
        path.join(process.cwd(), 'bin', 'exiftool'),
        path.join(process.resourcesPath || '', 'bin', 'exiftool.exe'),
    ];
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var p = candidates_1[_i];
        if (p && fs.existsSync(p))
            return p;
    }
    return null;
}
function getAtomicParsleyPath() {
    var candidates = [
        path.join(process.cwd(), 'bin', 'AtomicParsley.exe'),
        path.join(process.cwd(), 'bin', 'AtomicParsley'),
        path.join(process.resourcesPath || '', 'bin', 'AtomicParsley.exe'),
    ];
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var p = candidates_2[_i];
        if (p && fs.existsSync(p))
            return p;
    }
    return null;
}
// ===== ATOMICPARSLEY (iTunes atoms - QUAN TRỌNG NHẤT) =====
function applyAtomicParsleyMetadata(atomicParsleyPath, req, file) {
    return __awaiter(this, void 0, void 0, function () {
        var baseTitle, useGenre, titleValue, channel, url, genreValue, year, source, tempDir, ext, tempPath, args, atomicParsleySuccess;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    baseTitle = file.title || path.basename(file.path);
                    useGenre = req.mode === 'genre';
                    titleValue = useGenre ? req.genre : baseTitle;
                    channel = req.channelName;
                    url = req.channelUrl || channel;
                    genreValue = useGenre ? req.genre : '';
                    year = new Date().getFullYear().toString();
                    source = useGenre ? genreValue : baseTitle;
                    return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ap-'))];
                case 1:
                    tempDir = _a.sent();
                    ext = path.extname(file.path) || '.mp4';
                    tempPath = path.join(tempDir, "temp".concat(ext));
                    return [4 /*yield*/, fs.promises.copyFile(file.path, tempPath)
                        // CHỈ GHI DESCRIPTION - các phần khác không cần
                    ];
                case 2:
                    _a.sent();
                    args = [
                        tempPath,
                        '--overWrite',
                        '--description',
                        titleValue,
                        '--longdesc',
                        titleValue,
                    ];
                    atomicParsleySuccess = false;
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var proc = spawn(atomicParsleyPath, args, {
                                windowsHide: true,
                                // Ensure UTF-8 encoding for Unicode support (Vietnamese, Chinese, Japanese, Indonesian, etc.)
                                env: __assign(__assign({}, process.env), { PYTHONIOENCODING: 'utf-8' }),
                            });
                            var stderr = '';
                            (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (buf) {
                                stderr += buf.toString('utf8');
                            });
                            proc.on('error', function (err) { return reject(err); });
                            proc.on('close', function (code) {
                                if (code === 0) {
                                    atomicParsleySuccess = true;
                                    resolve();
                                }
                                else {
                                    // Nếu lỗi do file structure (atom moov lớn hơn file size), skip AtomicParsley và tiếp tục với Exiftool
                                    if (stderr.includes('atom was detected that presents as larger than filesize') ||
                                        stderr.includes('atom moov') ||
                                        stderr.includes('filesize') ||
                                        stderr.includes('Aborting')) {
                                        console.warn('[SEO] AtomicParsley failed due to file structure issue, skipping iTunes atoms. Will use Exiftool only.');
                                        // Không reject, chỉ resolve để tiếp tục với Exiftool
                                        // Không copy file về vì AtomicParsley đã fail
                                        resolve();
                                    }
                                    else {
                                        reject(new Error("AtomicParsley exited ".concat(code, ". stderr: ").concat(stderr)));
                                    }
                                }
                            });
                        })
                        // Chỉ copy file về nếu AtomicParsley thành công
                    ];
                case 3:
                    _a.sent();
                    if (!atomicParsleySuccess) return [3 /*break*/, 5];
                    return [4 /*yield*/, fs.promises.copyFile(tempPath, file.path)];
                case 4:
                    _a.sent();
                    _a.label = 5;
                case 5: return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ===== EXIFTOOL (Extended tags) =====
function buildExiftoolArgs(req, file) {
    var baseTitle = file.title || path.basename(file.path);
    var useGenre = req.mode === 'genre';
    var genreValue = useGenre ? req.genre : '';
    var yearValue = useGenre ? new Date().getFullYear().toString() : '';
    var source = useGenre ? genreValue : baseTitle;
    var channel = req.channelName;
    var url = req.channelUrl;
    var titleValue = useGenre ? genreValue : baseTitle;
    var pairs = [];
    // Xử lý tags: join multi-line thành một string, loại bỏ dòng trống
    var tagsValue = (req.tags || '').trim();
    if (tagsValue) {
        // Nếu tags có nhiều dòng, join lại bằng dấu phẩy
        var tagsLines = tagsValue.split('\n').map(function (line) { return line.trim(); }).filter(function (line) { return line.length > 0; });
        tagsValue = tagsLines.join(', ');
    }
    // Title, Subtitle, Comments = tiêu đề video (hoặc thể loại tùy mode)
    pairs.push(['-Title', titleValue], ['-XMP:Title', titleValue], ['-QuickTime:Title', titleValue], ['-Subtitle', titleValue], ['-XMP:Subtitle', titleValue], ['-QuickTime:Subtitle', titleValue], ['-Comment', titleValue], ['-QuickTime:Comment', titleValue], ['-Description', titleValue], ['-XMP:Description', titleValue], ['-QuickTime:Description', titleValue]);
    // Tags = từ user input - CHỈ DÙNG CÁC TAG HỢP LỆ
    if (tagsValue) {
        pairs.push(
        // Keywords (chuẩn nhất - hỗ trợ tốt)
        ['-Keywords', tagsValue], ['-XMP:Keywords', tagsValue], ['-XMP:TagsList', tagsValue], ['-QuickTime:Keywords', tagsValue], ['-XPKeywords', tagsValue], 
        // Subject cũng có thể chứa tags
        ['-Subject', tagsValue], ['-XMP:Subject', tagsValue]);
    }
    // Rating 5 sao - CHỈ DÙNG CÁC TAG HỢP LỆ
    pairs.push(['-Rating', '100'], // Rating chuẩn (5 sao = 100)
    ['-XMP:Rating', '5'], // XMP standard (5 sao = 5)
    ['-QuickTime:Rating', '5'] // QuickTime standard (5 sao = 5)
    );
    var args = [];
    for (var _i = 0, pairs_1 = pairs; _i < pairs_1.length; _i++) {
        var _a = pairs_1[_i], k = _a[0], v = _a[1];
        if (v && v.length > 0) {
            args.push("".concat(k, "=").concat(v));
        }
    }
    args.push('-overwrite_original');
    // Charset for Unicode
    args.unshift('-charset', 'filename=utf8', '-charset', 'exiftool=utf8', '-charset', 'iptc=utf8', '-charset', 'quicktime=utf8', '-charset', 'id3=utf8', '-codedcharacterset=utf8');
    args.push(file.path);
    return args;
}
function applyExiftoolMetadata(exiftoolPath, req, file) {
    return __awaiter(this, void 0, void 0, function () {
        var tempDir, ext, tempPath, args, argFilePath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-exif-'))];
                case 1:
                    tempDir = _a.sent();
                    ext = path.extname(file.path) || '.mp4';
                    tempPath = path.join(tempDir, "temp".concat(ext));
                    return [4 /*yield*/, fs.promises.copyFile(file.path, tempPath)];
                case 2:
                    _a.sent();
                    args = buildExiftoolArgs(req, __assign(__assign({}, file), { path: tempPath }));
                    argFilePath = path.join(tempDir, 'args.txt');
                    return [4 /*yield*/, fs.promises.writeFile(argFilePath, args.join('\n'), { encoding: 'utf8' })];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var proc = spawn(exiftoolPath, ['-@', argFilePath], {
                                windowsHide: true,
                                cwd: path.dirname(exiftoolPath),
                            });
                            var stderr = '';
                            (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (buf) {
                                stderr += buf.toString();
                            });
                            proc.on('error', function (err) { return reject(err); });
                            proc.on('close', function (code) {
                                if (code === 0)
                                    resolve();
                                else
                                    reject(new Error("exiftool exited ".concat(code, ". stderr: ").concat(stderr)));
                            });
                        })];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, fs.promises.copyFile(tempPath, file.path)];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 6:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ===== WINDOWS PROPERTY SYSTEM (PowerShell) =====
function applyWithWindowsPropertySystem(req, file) {
    return __awaiter(this, void 0, void 0, function () {
        var baseTitle, useGenre, titleValue, genreValue, year, finalGenre, channel, source, stars, script, tempDir, psPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    baseTitle = file.title || path.basename(file.path);
                    useGenre = req.mode === 'genre';
                    titleValue = useGenre ? req.genre : baseTitle;
                    genreValue = useGenre ? req.genre : '';
                    year = new Date().getFullYear().toString();
                    finalGenre = useGenre ? genreValue : titleValue;
                    channel = req.channelName;
                    source = useGenre ? genreValue : baseTitle;
                    stars = 5;
                    script = "\nparam(\n  [string]$Path,\n  [string]$Title,\n  [string]$Subtitle,\n  [string]$Tags,\n  [string]$Comment\n)\n\n$shell = New-Object -ComObject Shell.Application\n$folder = $shell.Namespace((Split-Path $Path))\n$file = $folder.ParseName((Split-Path $Path -Leaf))\n\n# Function \u0111\u1EC3 t\u00ECm property ID b\u1EB1ng t\u00EAn (dynamic lookup)\nfunction GetColumnIndexByName($fld, $targetName) {\n  for ($i = 0; $i -lt 300; $i++) {\n    $n = $fld.GetDetailsOf($null, $i)\n    if ($n -and $n -eq $targetName) { return $i }\n  }\n  return -1\n}\n\nfunction SetProp($id, $value) {\n  if ($value -ne $null -and $value -ne '') {\n    try {\n      $result = $folder.SetDetailsOf($file, $id, $value)\n      # Force refresh \u0111\u1EC3 Windows Explorer nh\u1EADn gi\u00E1 tr\u1ECB m\u1EDBi\n      if ($result -eq $null) {\n        # SetDetailsOf th\u00E0nh c\u00F4ng\n      }\n    } catch {\n      # Log error nh\u01B0ng kh\u00F4ng throw \u0111\u1EC3 ti\u1EBFp t\u1EE5c set c\u00E1c property kh\u00E1c\n      Write-Host \"Warning: Failed to set property ID $id : $($_.Exception.Message)\" -ForegroundColor Yellow\n    }\n  }\n}\n\n# Function \u0111\u1EC3 set property b\u1EB1ng t\u00EAn (dynamic lookup)\nfunction SetPropByName($propName, $value) {\n  if ($value -ne $null -and $value -ne '') {\n    $id = GetColumnIndexByName $folder $propName\n    if ($id -ge 0) {\n      try {\n        $folder.SetDetailsOf($file, $id, $value) | Out-Null\n      } catch {\n        Write-Host \"Warning: Failed to set property '$propName' (ID $id): $($_.Exception.Message)\" -ForegroundColor Yellow\n      }\n    } else {\n      Write-Host \"Warning: Property '$propName' not found in folder namespace\" -ForegroundColor Yellow\n    }\n  }\n}\n\n# Windows 10/11 Property Column IDs\n# Title, Subtitle, Comments = ti\u00EAu \u0111\u1EC1 video\nSetProp 21 $Title          # Title *\nSetPropByName \"Title\" $Title\nSetProp 26 $Subtitle       # Subtitle *\nSetPropByName \"Subtitle\" $Subtitle\nSetProp 24 $Comment        # Comments *\nSetPropByName \"Comments\" $Comment\nSetPropByName \"Description\" $Comment\n\n# Tags = t\u1EEB user input\nif ($Tags -ne '' -and $Tags -ne $null) {\n  SetProp 18 $Tags           # Tags *\n  SetPropByName \"Tags\" $Tags\n  SetPropByName \"Keywords\" $Tags\n}\n\n# Rating 5 sao - PH\u1EA2I C\u00D3\nSetProp 19 \"5\"               # Rating * - 5 sao\nSetPropByName \"Rating\" \"5\"\n";
                    return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ps-'))];
                case 1:
                    tempDir = _a.sent();
                    psPath = path.join(tempDir, 'setmeta.ps1');
                    return [4 /*yield*/, fs.promises.writeFile(psPath, script, { encoding: 'utf8' })];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var proc = spawn('powershell.exe', [
                                '-NoProfile',
                                '-NonInteractive',
                                '-ExecutionPolicy',
                                'Bypass',
                                '-File',
                                psPath,
                                '-Path',
                                file.path,
                                '-Title',
                                titleValue,
                                '-Subtitle',
                                titleValue,
                                '-Tags',
                                tagsValue,
                                '-Comment',
                                titleValue,
                                '-Rating',
                                '5',
                            ], {
                                windowsHide: true,
                                // Ensure UTF-8 encoding for Unicode support (Vietnamese, Chinese, Japanese, Indonesian, etc.)
                                env: __assign(__assign({}, process.env), { PYTHONIOENCODING: 'utf-8' }),
                            });
                            var stderr = '';
                            (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (buf) { return (stderr += buf.toString('utf8')); });
                            proc.on('error', function (err) { return reject(err); });
                            proc.on('close', function (code) {
                                if (code === 0)
                                    resolve();
                                else
                                    reject(new Error(stderr || "PowerShell exited ".concat(code)));
                            });
                        })];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 4:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ===== FFMPEG (Bổ sung cho Tags và Rating) =====
function applyFfmpegMetadata(req, file) {
    return __awaiter(this, void 0, void 0, function () {
        var paths, baseTitle, useGenre, titleValue, tagsValue, tempDir, ext, tempPath, args;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    paths = getFfmpegPaths();
                    if (!paths.ffmpeg || !fs.existsSync(paths.ffmpeg)) {
                        throw new Error('FFmpeg not found');
                    }
                    baseTitle = file.title || path.basename(file.path);
                    useGenre = req.mode === 'genre';
                    titleValue = useGenre ? req.genre : baseTitle;
                    tagsValue = req.tags || '';
                    return [4 /*yield*/, fs.promises.mkdtemp(path.join(os.tmpdir(), 'seo-ffmpeg-'))];
                case 1:
                    tempDir = _a.sent();
                    ext = path.extname(file.path) || '.mp4';
                    tempPath = path.join(tempDir, "temp".concat(ext));
                    return [4 /*yield*/, fs.promises.copyFile(file.path, tempPath)];
                case 2:
                    _a.sent();
                    args = [
                        '-i',
                        tempPath,
                        '-c',
                        'copy', // Copy stream, không re-encode
                        '-metadata',
                        "title=".concat(titleValue),
                        '-metadata',
                        "comment=".concat(titleValue),
                        '-metadata',
                        "description=".concat(titleValue),
                        // Bỏ rating vì test cho thấy FFmpeg không ghi được rating
                    ];
                    // Tags - FFmpeg ghi Keywords tốt (test đã xác nhận)
                    if (tagsValue) {
                        args.push('-metadata', "keywords=".concat(tagsValue), '-metadata', "comment=".concat(titleValue, " | Tags: ").concat(tagsValue) // Thêm tags vào comment
                        );
                    }
                    args.push('-y'); // Overwrite output file
                    args.push(file.path);
                    return [4 /*yield*/, new Promise(function (resolve, reject) {
                            var _a;
                            var proc = spawn(paths.ffmpeg, args, {
                                windowsHide: true,
                                env: __assign({}, process.env),
                            });
                            var stderr = '';
                            (_a = proc.stderr) === null || _a === void 0 ? void 0 : _a.on('data', function (buf) {
                                stderr += buf.toString('utf8');
                            });
                            proc.on('error', function (err) { return reject(err); });
                            proc.on('close', function (code) {
                                if (code === 0)
                                    resolve();
                                else
                                    reject(new Error("FFmpeg exited ".concat(code, ". stderr: ").concat(stderr.substring(0, 500))));
                            });
                        })];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, fs.promises.rm(tempDir, { recursive: true, force: true }).catch(function () { })];
                case 4:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
// ===== MAIN WORKFLOW =====
function applyMetadataComplete(req, file) {
    return __awaiter(this, void 0, void 0, function () {
        var exiftoolPath, paths, hasFfmpeg, err_1, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    exiftoolPath = getExiftoolPath();
                    paths = getFfmpegPaths();
                    hasFfmpeg = paths.ffmpeg && fs.existsSync(paths.ffmpeg);
                    if (!exiftoolPath) return [3 /*break*/, 4];
                    console.log('[SEO] Applying Exiftool metadata...');
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, applyExiftoolMetadata(exiftoolPath, req, file)];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _a.sent();
                    console.warn('[SEO] Exiftool failed:', err_1.message);
                    // Tiếp tục với FFmpeg nếu có
                    if (!hasFfmpeg)
                        throw err_1;
                    return [3 /*break*/, 4];
                case 4:
                    if (!(!exiftoolPath && hasFfmpeg)) return [3 /*break*/, 8];
                    console.log('[SEO] Exiftool not found, using FFmpeg as fallback...');
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, applyFfmpegMetadata(req, file)];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 8];
                case 7:
                    err_2 = _a.sent();
                    console.warn('[SEO] FFmpeg failed:', err_2.message);
                    throw err_2; // Throw vì đây là fallback duy nhất
                case 8:
                    // Bỏ Windows Property System vì không hoạt động (SetDetailsOf method không tồn tại)
                    // Test cho thấy: "Method invocation failed because [System.__ComObject] does not contain a method named 'SetDetailsOf'"
                    // Exiftool và FFmpeg đã đủ để ghi metadata vào file
                    // Nếu không có tool nào
                    if (!exiftoolPath && !hasFfmpeg) {
                        throw new Error('Neither Exiftool nor FFmpeg found. Cannot apply metadata.');
                    }
                    return [2 /*return*/];
            }
        });
    });
}
// ===== EXPORT =====
export function applySeoMetadata(req) {
    return __awaiter(this, void 0, void 0, function () {
        var results, atomicParsleyPath, exiftoolPath, warnings, _i, _a, file, err_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    results = [];
                    atomicParsleyPath = getAtomicParsleyPath();
                    exiftoolPath = getExiftoolPath();
                    warnings = [];
                    if (!atomicParsleyPath) {
                        warnings.push('⚠️ AtomicParsley.exe not found in bin/ - iTunes atoms will not be written');
                    }
                    if (!exiftoolPath) {
                        warnings.push('⚠️ exiftool.exe not found in bin/ - Extended tags will not be written');
                    }
                    if (warnings.length > 0) {
                        console.warn('[SEO] Warnings:\n' + warnings.join('\n'));
                    }
                    // At least one tool must be available
                    if (!atomicParsleyPath && !exiftoolPath) {
                        return [2 /*return*/, req.files.map(function (f) { return ({
                                file: f.path,
                                success: false,
                                error: 'Both AtomicParsley and exiftool are missing. Please place them in bin/ folder.',
                            }); })];
                    }
                    _i = 0, _a = req.files;
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 6];
                    file = _a[_i];
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, applyMetadataComplete(req, file)];
                case 3:
                    _b.sent();
                    results.push({ file: file.path, success: true });
                    return [3 /*break*/, 5];
                case 4:
                    err_3 = _b.sent();
                    results.push({ file: file.path, success: false, error: (err_3 === null || err_3 === void 0 ? void 0 : err_3.message) || String(err_3) });
                    return [3 /*break*/, 5];
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, results];
            }
        });
    });
}
