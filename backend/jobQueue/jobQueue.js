var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
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
import { EventEmitter } from 'events';
var JobQueue = /** @class */ (function (_super) {
    __extends(JobQueue, _super);
    function JobQueue() {
        var _this = _super !== null && _super.apply(this, arguments) || this;
        _this.jobs = new Map();
        _this.running = new Map();
        _this.abortControllers = new Map();
        return _this;
    }
    /**
     * Thêm job vào queue và chạy ngay
     */
    JobQueue.prototype.enqueue = function (job) {
        var _this = this;
        var jobId = "job-".concat(Date.now(), "-").concat(Math.random().toString(36).substr(2, 9));
        var abortController = new AbortController();
        this.abortControllers.set(jobId, abortController);
        var jobInfo = {
            id: jobId,
            type: job.type,
            status: 'pending',
            payload: job.payload,
            createdAt: Date.now(),
        };
        this.jobs.set(jobId, jobInfo);
        this.emit('update', jobInfo);
        var context = {
            jobId: jobId,
            signal: abortController.signal,
            updateProgress: function (percent, message) {
                var info = _this.jobs.get(jobId);
                if (info) {
                    info.progress = percent;
                    _this.jobs.set(jobId, info);
                    _this.emit('update', info);
                }
            },
        };
        var taskPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
            var result, error_1;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, 3, 4]);
                        jobInfo.status = 'running';
                        jobInfo.startedAt = Date.now();
                        this.emit('update', jobInfo);
                        return [4 /*yield*/, job.task(context)];
                    case 1:
                        result = _c.sent();
                        jobInfo.status = 'completed';
                        jobInfo.completedAt = Date.now();
                        jobInfo.progress = 100;
                        this.jobs.set(jobId, jobInfo);
                        this.emit('update', jobInfo);
                        return [2 /*return*/, result];
                    case 2:
                        error_1 = _c.sent();
                        if (((_a = error_1 === null || error_1 === void 0 ? void 0 : error_1.message) === null || _a === void 0 ? void 0 : _a.includes('cancelled')) || ((_b = error_1 === null || error_1 === void 0 ? void 0 : error_1.message) === null || _b === void 0 ? void 0 : _b.includes('dừng'))) {
                            jobInfo.status = 'cancelled';
                        }
                        else {
                            jobInfo.status = 'failed';
                            jobInfo.error = (error_1 === null || error_1 === void 0 ? void 0 : error_1.message) || String(error_1);
                        }
                        jobInfo.completedAt = Date.now();
                        this.jobs.set(jobId, jobInfo);
                        this.emit('update', jobInfo);
                        throw error_1;
                    case 3:
                        this.running.delete(jobId);
                        this.abortControllers.delete(jobId);
                        return [7 /*endfinally*/];
                    case 4: return [2 /*return*/];
                }
            });
        }); })();
        this.running.set(jobId, taskPromise);
        return {
            jobId: jobId,
            result: taskPromise,
            cancel: function () { return __awaiter(_this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, this.cancelJob(jobId)];
                        case 1:
                            _a.sent();
                            if (job.onCancel) {
                                job.onCancel(jobId);
                            }
                            return [2 /*return*/];
                    }
                });
            }); },
        };
    };
    /**
     * Hủy job
     */
    JobQueue.prototype.cancelJob = function (jobId) {
        return __awaiter(this, void 0, void 0, function () {
            var jobInfo, abortController;
            return __generator(this, function (_a) {
                jobInfo = this.jobs.get(jobId);
                if (!jobInfo)
                    return [2 /*return*/];
                if (jobInfo.status === 'running' || jobInfo.status === 'pending') {
                    abortController = this.abortControllers.get(jobId);
                    if (abortController) {
                        abortController.abort();
                    }
                    jobInfo.status = 'cancelled';
                    jobInfo.completedAt = Date.now();
                    this.jobs.set(jobId, jobInfo);
                    this.emit('update', jobInfo);
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Lấy danh sách tất cả jobs
     */
    JobQueue.prototype.getJobs = function () {
        return Array.from(this.jobs.values());
    };
    /**
     * Lấy job theo ID
     */
    JobQueue.prototype.getJob = function (jobId) {
        return this.jobs.get(jobId);
    };
    /**
     * Xóa job khỏi queue (cleanup)
     */
    JobQueue.prototype.removeJob = function (jobId) {
        this.jobs.delete(jobId);
        this.running.delete(jobId);
        this.abortControllers.delete(jobId);
    };
    return JobQueue;
}(EventEmitter));
// Singleton instance
export var jobQueue = new JobQueue();
