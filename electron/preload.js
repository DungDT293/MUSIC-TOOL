import { contextBridge, ipcRenderer } from 'electron';
import { pathToFileURL } from 'node:url';
import { VIDEO_FINAL_EXPORT_DONE, VIDEO_FINAL_EXPORT_ERROR, VIDEO_FINAL_EXPORT_PROGRESS, VIDEO_FINAL_EXPORT_REQUEST, VIDEO_FINAL_EXPORT_SCAN_AUDIO, VIDEO_FINAL_EXPORT_SCAN_VIDEO, } from '../shared/videoFinalExportChannels';
var api = {
    license: {
        getState: function () { return ipcRenderer.invoke('license:getState'); },
        register: function (note) {
            return ipcRenderer.invoke('license:register', { note: note });
        },
        retry: function () { return ipcRenderer.invoke('license:retry'); },
        clear: function () { return ipcRenderer.invoke('license:clear'); },
    },
    auth: {
        getState: function () { return ipcRenderer.invoke('auth:getState'); },
        register: function (data) {
            return ipcRenderer.invoke('auth:register', data);
        },
        refresh: function () { return ipcRenderer.invoke('auth:refresh'); },
        login: function (data) {
            return ipcRenderer.invoke('auth:login', data);
        },
        clear: function () { return ipcRenderer.invoke('auth:clear'); },
    },
    music: {
        scan: function (payload) { return ipcRenderer.invoke('music:scan', payload); },
        createPlaylist: function (payload) { return ipcRenderer.invoke('music:createPlaylist', payload); },
        preview: function (payload) { return ipcRenderer.invoke('music:preview', payload); },
        export: function (payload) { return ipcRenderer.invoke('music:export', payload); },
        validatePlaylistsForCrossfade: function (payload) { return ipcRenderer.invoke('music:validatePlaylistsForCrossfade', payload); },
    },
    video: {
        cutSingle: function (payload) { return ipcRenderer.invoke('video:cutSingle', payload); },
        cutBatch: function (payload) { return ipcRenderer.invoke('video:cutBatch', payload); },
        merge: function (payload) { return ipcRenderer.invoke('video:merge', payload); },
        finalExport: function (payload) { return ipcRenderer.invoke('video:finalExport', payload); }
    },
    probeFile: function (path) { return ipcRenderer.invoke('ffmpeg:probe', path); },
    getSystemInfo: function () { return ipcRenderer.invoke('system:info'); },
    getRealtimeStats: function () { return ipcRenderer.invoke('system:realtime'); },
    getDiskInfo: function () { return ipcRenderer.invoke('system:getDiskInfo'); },
    refreshDiskInfo: function () { return ipcRenderer.invoke('system:refreshDiskInfo'); },
    onDiskInfo: function (handler) {
        var channel = 'system:disk-info';
        var listener = function (_event, payload) { return handler(payload); };
        ipcRenderer.on(channel, listener);
        return function () {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    selectFolder: function () { return ipcRenderer.invoke('dialog:selectFolder'); },
    selectAudioFile: function () { return ipcRenderer.invoke('dialog:selectAudioFile'); },
    selectAudioFilesMulti: function () { return ipcRenderer.invoke('dialog:selectAudioFilesMulti'); },
    scanMusicFolders: function (payload) {
        return ipcRenderer.invoke('music:scanFolders', payload);
    },
    getLastScanResult: function () { return ipcRenderer.invoke('music:getLastScan'); },
    createPlaylists: function (payload) { return ipcRenderer.invoke('music:createPlaylists', payload); },
    listPlaylists: function () { return ipcRenderer.invoke('music:listPlaylists'); },
    getExportHistory: function () { return ipcRenderer.invoke('music:getExportHistory'); },
    exportPlaylist: function (req) { return ipcRenderer.invoke('music:exportPlaylist', req); },
    validatePlaylistsForCrossfade: function (playlistIds) {
        return ipcRenderer.invoke('music:validatePlaylistsForCrossfade', playlistIds);
    },
    cutVideoSegment: function (req) { return ipcRenderer.invoke('video:cutSegment', req); },
    selectVideoFile: function () { return ipcRenderer.invoke('dialog:selectVideoFile'); },
    selectVideoFilesMulti: function () { return ipcRenderer.invoke('dialog:selectVideoFilesMulti'); },
    selectManyVideos: function () { return ipcRenderer.invoke('dialog:selectManyVideos'); },
    videoProbeFile: function (filePath) { return ipcRenderer.invoke('video:probeFile', filePath); },
    videoSplitFile: function (options) { return ipcRenderer.invoke('video:splitFile', options); },
    videoMergeFile: function (options) { return ipcRenderer.invoke('video:mergeFile', options); },
    // Video Simple Module APIs
    videoGetFileInfo: function (filePath) { return ipcRenderer.invoke('video:getFileInfo', filePath); },
    videoCutSingleSimple: function (req) { return ipcRenderer.invoke('video:cutSingleSimple', req); },
    videoSplitManySimple: function (req) { return ipcRenderer.invoke('video:splitManySimple', req); },
    videoMergeSimple: function (req) { return ipcRenderer.invoke('video:mergeSimple', req); },
    listVideosInFolder: function (dir) { return ipcRenderer.invoke('video:listVideosInFolder', dir); },
    listVideosInFolderSimple: function (dir) { return ipcRenderer.invoke('video:listVideosInFolderSimple', dir); },
    ultraFastScanFolder: function (folderPath) { return ipcRenderer.invoke('video:ultraFastScanFolder', folderPath); },
    batchLazyProbe: function (paths, concurrency) { return ipcRenderer.invoke('video:batchLazyProbe', paths, concurrency); },
    createDirectory: function (dirPath) { return ipcRenderer.invoke('system:createDirectory', dirPath); },
    openPath: function (pathToOpen) { return ipcRenderer.invoke('system:openPath', pathToOpen); },
    videoFinalExport: {
        start: function (payload) { return ipcRenderer.send(VIDEO_FINAL_EXPORT_REQUEST, payload); },
        cancel: function (requestId) {
            return ipcRenderer.invoke('video:final-export:cancel', requestId);
        },
        scanAudioSource: function (payload) {
            return ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_AUDIO, payload);
        },
        scanVideoSource: function (payload) {
            return ipcRenderer.invoke(VIDEO_FINAL_EXPORT_SCAN_VIDEO, payload);
        },
        onProgress: function (handler) {
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(VIDEO_FINAL_EXPORT_PROGRESS, listener);
            return function () {
                ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_PROGRESS, listener);
            };
        },
        onDone: function (handler) {
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(VIDEO_FINAL_EXPORT_DONE, listener);
            return function () {
                ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_DONE, listener);
            };
        },
        onError: function (handler) {
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(VIDEO_FINAL_EXPORT_ERROR, listener);
            return function () {
                ipcRenderer.removeListener(VIDEO_FINAL_EXPORT_ERROR, listener);
            };
        },
    },
    // Turbo Engine APIs
    detectDiskType: function (filePath) { return ipcRenderer.invoke('video:detectDiskType', filePath); },
    videoGetDiskInfo: function (filePath) { return ipcRenderer.invoke('video:getDiskInfo', filePath); },
    videoCutSingleTurbo: function (req) { return ipcRenderer.invoke('video:cutSingleTurbo', req); },
    videoSplitManyTurbo: function (req) { return ipcRenderer.invoke('video:splitManyTurbo', req); },
    videoMergeTurbo: function (req) { return ipcRenderer.invoke('video:mergeTurbo', req); },
    videoCancelJob: function (requestId) { return ipcRenderer.invoke('video:cancelJob', requestId); },
    videoGetAllJobIds: function () { return ipcRenderer.invoke('video:getAllJobIds'); },
    videoGetActiveMergeJobId: function () { return ipcRenderer.invoke('video:getActiveMergeJobId'); },
    videoHasJob: function (requestId) { return ipcRenderer.invoke('video:hasJob', requestId); },
    onVideoProgress: function (handler) {
        var channel = 'video:progress';
        var listener = function (_event, payload) {
            handler(payload);
        };
        ipcRenderer.on(channel, listener);
        return function () {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    onExportProgress: function (handler) {
        var channel = 'music:exportProgress';
        var listener = function (_event, payload) {
            handler(payload);
        };
        ipcRenderer.on(channel, listener);
        // trả về hàm unsubscribe để React cleanup
        return function () {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    toFileUrl: function (filePath) {
        try {
            if (!filePath)
                return '';
            // pathToFileURL sẽ tự xử lý backslash, khoảng trắng, ký tự UTF-8...
            return pathToFileURL(filePath).toString();
        }
        catch (err) {
            console.error('[preload] toFileUrl error', filePath, err);
            return '';
        }
    },
    // YouTube API
    youtube: {
        // Verify yt-dlp
        verify: function () { return ipcRenderer.invoke('youtube:verify'); },
        // Validate URL
        validateUrl: function (url) { return ipcRenderer.invoke('youtube:validate-url', url); },
        // Get video info
        getVideoInfo: function (url) { return ipcRenderer.invoke('youtube:get-video-info', url); },
        // Get channel info
        getChannelInfo: function (url) { return ipcRenderer.invoke('youtube:get-channel-info', url); },
        // Get channel videos
        getChannelVideos: function (url, limit) {
            return ipcRenderer.invoke('youtube:get-channel-videos', url, limit);
        },
        // Estimate channel size
        estimateChannelSize: function (url, quality, limit) {
            return ipcRenderer.invoke('youtube:estimate-channel-size', url, quality, limit);
        },
        // Download single video
        downloadVideo: function (request) { return ipcRenderer.invoke('youtube:download-video', request); },
        // Download channel
        downloadChannel: function (params) { return ipcRenderer.invoke('youtube:download-channel', params); },
        // Cancel download
        cancelDownload: function () { return ipcRenderer.invoke('youtube:cancel-download'); },
        // Listen to progress events
        onProgress: function (callback) {
            var listener = function (_event, progress) { return callback(progress); };
            ipcRenderer.on('youtube:progress', listener);
            return function () {
                ipcRenderer.removeListener('youtube:progress', listener);
            };
        },
        // Listen to batch progress events
        onBatchProgress: function (callback) {
            var listener = function (_event, progress) { return callback(progress); };
            ipcRenderer.on('youtube:batch-progress', listener);
            return function () {
                ipcRenderer.removeListener('youtube:batch-progress', listener);
            };
        },
        // Remove listeners
        removeProgressListener: function () {
            ipcRenderer.removeAllListeners('youtube:progress');
        },
        removeBatchProgressListener: function () {
            ipcRenderer.removeAllListeners('youtube:batch-progress');
        }
    },
    jobQueue: {
        list: function () { return ipcRenderer.invoke('jobQueue:list'); },
        get: function (jobId) { return ipcRenderer.invoke('jobQueue:get', jobId); },
        cancel: function (jobId) { return ipcRenderer.invoke('jobQueue:cancel', jobId); },
        onUpdate: function (handler) {
            var channel = 'jobQueue:update';
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(channel, listener);
            return function () {
                ipcRenderer.removeListener(channel, listener);
            };
        },
    },
    videoSeoApply: function (payload) { return ipcRenderer.invoke('video:seo:apply', payload); },
    autopilot: {
        getStatus: function () { return ipcRenderer.invoke('autopilot:getStatus'); },
        start: function (config) { return ipcRenderer.invoke('autopilot:start', config); },
        cancel: function () { return ipcRenderer.invoke('autopilot:cancel'); },
        onStatus: function (handler) {
            var channel = 'autopilot:status';
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(channel, listener);
            return function () {
                ipcRenderer.removeListener(channel, listener);
            };
        },
        onLog: function (handler) {
            var channel = 'autopilot:log';
            var listener = function (_event, payload) { return handler(payload); };
            ipcRenderer.on(channel, listener);
            return function () {
                ipcRenderer.removeListener(channel, listener);
            };
        },
    },
};
contextBridge.exposeInMainWorld('api', api);
