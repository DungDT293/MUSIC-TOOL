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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { randomUUID } from 'crypto';
// Fisher-Yates shuffle
function shuffle(array) {
    var _a;
    var shuffled = __spreadArray([], array, true);
    for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        _a = [shuffled[j], shuffled[i]], shuffled[i] = _a[0], shuffled[j] = _a[1];
    }
    return shuffled;
}
// Rotate array
function rotate(array, offset) {
    if (array.length === 0)
        return array;
    var normalizedOffset = offset % array.length;
    return __spreadArray(__spreadArray([], array.slice(normalizedOffset), true), array.slice(0, normalizedOffset), true);
}
function buildSinglePlaylist(index, pinnedTracks, shuffledPriority, shuffledRandom, targetSec, desiredPriorityMin, desiredPriorityMax, allowReuse, // Cho phép reuse tracks khi thiếu
hasPinnedTracks, // Có pinned tracks hay không
shuffledAll // Dùng cho trường hợp 2 (xáo trộn toàn bộ)
) {
    if (allowReuse === void 0) { allowReuse = false; }
    if (hasPinnedTracks === void 0) { hasPinnedTracks = true; }
    if (shuffledAll === void 0) { shuffledAll = []; }
    var playlistTracks = [];
    var usedTrackIds = new Set();
    var lastTrackId = null; // Track ID cuối cùng để tránh trùng liên tiếp
    var currentTotalSec = 0;
    var currentPrioritySec = 0;
    var currentRandomSec = 0;
    // Helper: Chọn track không trùng với lastTrackId
    var pickTrackAvoidingLast = function (pool, avoidId, maxAttempts) {
        if (maxAttempts === void 0) { maxAttempts = 10; }
        if (pool.length === 0)
            return null;
        // Lọc các track không trùng với avoidId
        var available = avoidId ? pool.filter(function (t) { return t.id !== avoidId; }) : pool;
        if (available.length > 0) {
            // Random từ available
            var randomIndex = Math.floor(Math.random() * available.length);
            return available[randomIndex];
        }
        // Nếu không có available (trường hợp cực đoan: chỉ còn 1 bài), chấp nhận trùng
        if (pool.length > 0) {
            return pool[Math.floor(Math.random() * pool.length)];
        }
        return null;
    };
    // TRƯỜNG HỢP 2: Không có pinned tracks → xáo trộn toàn bộ nhưng vẫn đảm bảo tỷ lệ
    if (!hasPinnedTracks && shuffledAll.length > 0) {
        var allIndex = 0;
        var allCycles = 0;
        var maxAllCycles = allowReuse ? 200 : 10;
        while (currentTotalSec < targetSec && allCycles < maxAllCycles) {
            var addedInCycle = false;
            for (var j = 0; j < shuffledAll.length; j++) {
                var track = shuffledAll[allIndex];
                // Kiểm tra tỷ lệ: nếu priority chưa đạt min, ưu tiên priority
                var priorityRatio = currentTotalSec > 0 ? currentPrioritySec / currentTotalSec : 0;
                var shouldPreferPriority = priorityRatio < (desiredPriorityMin / targetSec) && track.folderType === 'priority';
                // Nếu không cho phép reuse và đã dùng, skip
                if (!allowReuse && usedTrackIds.has(track.id)) {
                    allIndex = (allIndex + 1) % shuffledAll.length;
                    continue;
                }
                // Tránh trùng liên tiếp
                if (track.id === lastTrackId) {
                    allIndex = (allIndex + 1) % shuffledAll.length;
                    continue;
                }
                // Nếu priority đã đạt max và track là priority, skip (ưu tiên random)
                var priorityRatioAfter = (currentPrioritySec + track.duration) / (currentTotalSec + track.duration);
                if (track.folderType === 'priority' && priorityRatioAfter > (desiredPriorityMax / targetSec)) {
                    allIndex = (allIndex + 1) % shuffledAll.length;
                    continue;
                }
                // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                var cumulativeDuration = currentTotalSec + track.duration;
                playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                lastTrackId = track.id;
                if (!allowReuse) {
                    usedTrackIds.add(track.id);
                }
                if (track.folderType === 'priority') {
                    currentPrioritySec += track.duration;
                }
                else if (track.folderType === 'random') {
                    currentRandomSec += track.duration;
                }
                addedInCycle = true;
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
                allIndex = (allIndex + 1) % shuffledAll.length;
            }
            if (!addedInCycle && !allowReuse)
                break;
            if (!addedInCycle && allowReuse) {
                var picked = pickTrackAvoidingLast(shuffledAll, lastTrackId);
                if (picked) {
                    // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                    var cumulativeDuration = currentTotalSec + picked.duration;
                    playlistTracks.push(__assign(__assign({}, picked), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                    currentTotalSec = cumulativeDuration;
                    lastTrackId = picked.id;
                    if (picked.folderType === 'priority') {
                        currentPrioritySec += picked.duration;
                    }
                    else if (picked.folderType === 'random') {
                        currentRandomSec += picked.duration;
                    }
                    addedInCycle = true;
                    // SAU KHI THÊM, mới check đạt target để dừng
                    if (currentTotalSec >= targetSec)
                        break;
                }
            }
            if (!addedInCycle)
                break;
            allCycles++;
        }
        // Đảm bảo playlist luôn >= targetSec (BẮT BUỘC) - cho TRƯỜNG HỢP 2
        if (currentTotalSec < targetSec && shuffledAll.length > 0) {
            var fillIndex = 0;
            var fillCycles = 0;
            var maxFillCycles = 500;
            while (currentTotalSec < targetSec && fillCycles < maxFillCycles) {
                var track = shuffledAll[fillIndex % shuffledAll.length];
                // Tránh trùng liên tiếp nếu có thể
                if (track.id === lastTrackId && shuffledAll.length > 1) {
                    fillIndex++;
                    fillCycles++;
                    continue;
                }
                var cumulativeDuration = currentTotalSec + track.duration;
                playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                lastTrackId = track.id;
                if (track.folderType === 'priority') {
                    currentPrioritySec += track.duration;
                }
                else if (track.folderType === 'random') {
                    currentRandomSec += track.duration;
                }
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
                fillIndex++;
                fillCycles++;
            }
        }
        // Tính stats và return
        var finalPrioritySec_1 = 0;
        var finalRandomSec_1 = 0;
        var finalPriorityCount_1 = 0;
        var finalRandomCount_1 = 0;
        for (var _i = 0, playlistTracks_1 = playlistTracks; _i < playlistTracks_1.length; _i++) {
            var track = playlistTracks_1[_i];
            if (track.folderType === 'priority') {
                finalPrioritySec_1 += track.duration;
                finalPriorityCount_1++;
            }
            else if (track.folderType === 'random') {
                finalRandomSec_1 += track.duration;
                finalRandomCount_1++;
            }
        }
        var cumulative_1 = 0;
        for (var _a = 0, playlistTracks_2 = playlistTracks; _a < playlistTracks_2.length; _a++) {
            var track = playlistTracks_2[_a];
            track.cumulativeDuration = cumulative_1;
            cumulative_1 += track.duration;
        }
        return {
            id: randomUUID(),
            name: "Playlist ".concat(index + 1),
            targetDurationSec: targetSec,
            totalDurationSec: cumulative_1,
            priorityDurationSec: finalPrioritySec_1,
            randomDurationSec: finalRandomSec_1,
            priorityCount: finalPriorityCount_1,
            randomCount: finalRandomCount_1,
            tracks: playlistTracks,
            createdAt: Date.now(),
        };
    }
    // TRƯỜNG HỢP 1: Có pinned tracks
    // Bước 1: Pinned lên đầu
    var rotatedPinned = rotate(pinnedTracks, index * 7); // Offset khác nhau cho mỗi playlist
    for (var _b = 0, rotatedPinned_1 = rotatedPinned; _b < rotatedPinned_1.length; _b++) {
        var track = rotatedPinned_1[_b];
        if (!allowReuse && usedTrackIds.has(track.id))
            continue;
        // Tránh trùng liên tiếp
        if (track.id === lastTrackId)
            continue;
        // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
        var cumulativeDuration = currentTotalSec + track.duration;
        playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
        currentTotalSec = cumulativeDuration;
        lastTrackId = track.id;
        if (!allowReuse) {
            usedTrackIds.add(track.id);
        }
        if (track.folderType === 'priority') {
            currentPrioritySec += track.duration;
        }
        else if (track.folderType === 'random') {
            currentRandomSec += track.duration;
        }
        // SAU KHI THÊM, mới check đạt target để dừng
        if (currentTotalSec >= targetSec)
            break;
    }
    // Bước 2: Bổ sung PRIORITY (không pinned) đến khi đạt ngưỡng MIN
    var priorityStart = shuffledPriority.length > 0 ? (index * 13) % shuffledPriority.length : 0; // Offset khác nhau
    var priorityIndex = priorityStart;
    var priorityCycles = 0;
    var maxPriorityCycles = allowReuse ? 100 : 3; // Nếu cho phép reuse, tăng cycles
    while (currentTotalSec < targetSec &&
        currentPrioritySec < desiredPriorityMin &&
        priorityCycles < maxPriorityCycles &&
        shuffledPriority.length > 0) {
        var addedInCycle = false;
        for (var j = 0; j < shuffledPriority.length; j++) {
            var track = shuffledPriority[priorityIndex];
            // Nếu không cho phép reuse và đã dùng, skip
            if (!allowReuse && usedTrackIds.has(track.id)) {
                priorityIndex = (priorityIndex + 1) % shuffledPriority.length;
                continue;
            }
            // Tránh trùng liên tiếp
            if (track.id === lastTrackId) {
                priorityIndex = (priorityIndex + 1) % shuffledPriority.length;
                continue;
            }
            if (currentPrioritySec >= desiredPriorityMin)
                break;
            // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
            var cumulativeDuration = currentTotalSec + track.duration;
            playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
            currentTotalSec = cumulativeDuration;
            currentPrioritySec += track.duration;
            lastTrackId = track.id;
            if (!allowReuse) {
                usedTrackIds.add(track.id);
            }
            addedInCycle = true;
            // SAU KHI THÊM, mới check đạt target để dừng
            if (currentTotalSec >= targetSec)
                break;
            priorityIndex = (priorityIndex + 1) % shuffledPriority.length;
        }
        if (!addedInCycle && !allowReuse)
            break;
        if (!addedInCycle && allowReuse) {
            // Nếu allowReuse và không thêm được, thử lại với logic khác
            var picked = pickTrackAvoidingLast(shuffledPriority, lastTrackId);
            if (picked && currentPrioritySec < desiredPriorityMin) {
                // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                var cumulativeDuration = currentTotalSec + picked.duration;
                playlistTracks.push(__assign(__assign({}, picked), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                currentPrioritySec += picked.duration;
                lastTrackId = picked.id;
                addedInCycle = true;
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
            }
        }
        if (!addedInCycle)
            break;
        priorityCycles++;
    }
    // Bước 3: Bổ sung RANDOM cho đủ target
    if (shuffledRandom.length > 0) {
        var randomStart = (index * 17) % shuffledRandom.length; // Offset khác nhau
        var randomIndex = randomStart;
        var randomCycles = 0;
        var maxRandomCycles = allowReuse ? 100 : 3;
        while (currentTotalSec < targetSec && randomCycles < maxRandomCycles) {
            var addedInCycle = false;
            for (var j = 0; j < shuffledRandom.length; j++) {
                var track = shuffledRandom[randomIndex];
                // Nếu không cho phép reuse và đã dùng, skip
                if (!allowReuse && usedTrackIds.has(track.id)) {
                    randomIndex = (randomIndex + 1) % shuffledRandom.length;
                    continue;
                }
                // Tránh trùng liên tiếp
                if (track.id === lastTrackId) {
                    randomIndex = (randomIndex + 1) % shuffledRandom.length;
                    continue;
                }
                // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                var cumulativeDuration = currentTotalSec + track.duration;
                playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                currentRandomSec += track.duration;
                lastTrackId = track.id;
                if (!allowReuse) {
                    usedTrackIds.add(track.id);
                }
                addedInCycle = true;
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
                randomIndex = (randomIndex + 1) % shuffledRandom.length;
            }
            if (!addedInCycle && !allowReuse)
                break;
            if (!addedInCycle && allowReuse) {
                // Nếu allowReuse và không thêm được, thử lại với logic khác
                var picked = pickTrackAvoidingLast(shuffledRandom, lastTrackId);
                if (picked) {
                    // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                    var cumulativeDuration = currentTotalSec + picked.duration;
                    playlistTracks.push(__assign(__assign({}, picked), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                    currentTotalSec = cumulativeDuration;
                    currentRandomSec += picked.duration;
                    lastTrackId = picked.id;
                    addedInCycle = true;
                    // SAU KHI THÊM, mới check đạt target để dừng
                    if (currentTotalSec >= targetSec)
                        break;
                }
            }
            if (!addedInCycle)
                break;
            randomCycles++;
        }
    }
    // Bước 4: Nếu vẫn thiếu, thêm PRIORITY/RANDOM xen kẽ (với reuse nếu cần)
    // CHỈ CHẠY TRONG TRƯỜNG HỢP 1 (có pinned tracks)
    if (hasPinnedTracks) {
        var marginSec = 5; // Margin để tránh loop vô hạn
        var combinedPool = __spreadArray(__spreadArray([], shuffledPriority, true), shuffledRandom, true);
        var combinedIndex = 0;
        var combinedCycles = 0;
        var maxCombinedCycles = allowReuse ? 200 : 10;
        while (currentTotalSec < targetSec - marginSec &&
            combinedCycles < maxCombinedCycles &&
            combinedPool.length > 0) {
            var addedInCycle = false;
            // Ưu tiên priority nếu chưa đạt min
            var preferPriority = currentPrioritySec < desiredPriorityMin && shuffledPriority.length > 0;
            var candidatePool = preferPriority ? shuffledPriority : combinedPool;
            // Thử chọn track từ pool
            var picked = pickTrackAvoidingLast(candidatePool, lastTrackId, 10);
            if (picked) {
                // Nếu không cho phép reuse và đã dùng, skip
                if (!allowReuse && usedTrackIds.has(picked.id)) {
                    combinedIndex = (combinedIndex + 1) % combinedPool.length;
                    combinedCycles++;
                    continue;
                }
                // THÊM TRACK VÀO TRƯỚC (phát hết bài hát dù có vượt target)
                var cumulativeDuration = currentTotalSec + picked.duration;
                playlistTracks.push(__assign(__assign({}, picked), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                lastTrackId = picked.id;
                if (!allowReuse) {
                    usedTrackIds.add(picked.id);
                }
                if (picked.folderType === 'priority') {
                    currentPrioritySec += picked.duration;
                }
                else if (picked.folderType === 'random') {
                    currentRandomSec += picked.duration;
                }
                addedInCycle = true;
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
            }
            if (!addedInCycle)
                break;
            combinedCycles++;
            combinedIndex = (combinedIndex + 1) % combinedPool.length;
        }
    }
    // Bước 5: Đảm bảo playlist luôn >= targetSec (BẮT BUỘC)
    // Nếu vẫn chưa đạt target sau tất cả các bước trên, tiếp tục thêm tracks
    // Bỏ qua allowReuse ở đây vì đây là yêu cầu bắt buộc
    if (currentTotalSec < targetSec) {
        var allAvailableTracks = __spreadArray(__spreadArray([], shuffledPriority, true), shuffledRandom, true);
        if (allAvailableTracks.length > 0) {
            var fillIndex = 0;
            var fillCycles = 0;
            var maxFillCycles = 500; // Giới hạn để tránh loop vô hạn
            while (currentTotalSec < targetSec && fillCycles < maxFillCycles) {
                var track = allAvailableTracks[fillIndex % allAvailableTracks.length];
                // Tránh trùng liên tiếp nếu có thể
                if (track.id === lastTrackId && allAvailableTracks.length > 1) {
                    fillIndex++;
                    fillCycles++;
                    continue;
                }
                var cumulativeDuration = currentTotalSec + track.duration;
                playlistTracks.push(__assign(__assign({}, track), { order: playlistTracks.length + 1, cumulativeDuration: cumulativeDuration }));
                currentTotalSec = cumulativeDuration;
                lastTrackId = track.id;
                if (track.folderType === 'priority') {
                    currentPrioritySec += track.duration;
                }
                else if (track.folderType === 'random') {
                    currentRandomSec += track.duration;
                }
                // SAU KHI THÊM, mới check đạt target để dừng
                if (currentTotalSec >= targetSec)
                    break;
                fillIndex++;
                fillCycles++;
            }
        }
    }
    // Bước 6: Tính stats chính xác từ playlistTracks
    var finalPrioritySec = 0;
    var finalRandomSec = 0;
    var finalPriorityCount = 0;
    var finalRandomCount = 0;
    for (var _c = 0, playlistTracks_3 = playlistTracks; _c < playlistTracks_3.length; _c++) {
        var track = playlistTracks_3[_c];
        if (track.folderType === 'priority') {
            finalPrioritySec += track.duration;
            finalPriorityCount++;
        }
        else if (track.folderType === 'random') {
            finalRandomSec += track.duration;
            finalRandomCount++;
        }
    }
    // Tính lại cumulativeDuration cho tất cả tracks
    var cumulative = 0;
    for (var _d = 0, playlistTracks_4 = playlistTracks; _d < playlistTracks_4.length; _d++) {
        var track = playlistTracks_4[_d];
        track.cumulativeDuration = cumulative;
        cumulative += track.duration;
    }
    var totalDurationSec = cumulative;
    // VALIDATION CUỐI CÙNG: Đảm bảo playlist luôn >= targetSec
    // Nếu vẫn chưa đạt (edge case hiếm), log warning nhưng vẫn return
    if (totalDurationSec < targetSec) {
        console.warn("[PlaylistEngine] WARNING: Playlist ".concat(index + 1, " ch\u1EC9 c\u00F3 ").concat(totalDurationSec.toFixed(1), "s, nh\u1ECF h\u01A1n target ").concat(targetSec, "s. C\u00F3 th\u1EC3 do kh\u00F4ng \u0111\u1EE7 tracks trong th\u01B0 vi\u1EC7n."));
    }
    return {
        id: randomUUID(),
        name: "Playlist ".concat(index + 1),
        targetDurationSec: targetSec,
        totalDurationSec: totalDurationSec,
        priorityDurationSec: finalPrioritySec,
        randomDurationSec: finalRandomSec,
        priorityCount: finalPriorityCount,
        randomCount: finalRandomCount,
        tracks: playlistTracks,
        createdAt: Date.now(),
    };
}
export function buildPlaylists(options) {
    var tracks = options.tracks, pinnedTrackIds = options.pinnedTrackIds, playlistCount = options.playlistCount, targetDurationMinutes = options.targetDurationMinutes, _a = options.priorityRatioMin, priorityRatioMin = _a === void 0 ? 0.65 : _a, _b = options.priorityRatioMax, priorityRatioMax = _b === void 0 ? 0.8 : _b;
    if (playlistCount < 1) {
        throw new Error('playlistCount must be >= 1');
    }
    if (targetDurationMinutes <= 0) {
        throw new Error('targetDurationMinutes must be > 0');
    }
    var targetSec = targetDurationMinutes * 60;
    var desiredPriorityMin = targetSec * priorityRatioMin;
    var desiredPriorityMax = targetSec * priorityRatioMax;
    // Chuẩn bị chung
    var priorityTracks = tracks.filter(function (t) { return t.folderType === 'priority'; });
    var randomTracks = tracks.filter(function (t) { return t.folderType === 'random'; });
    var pinnedTracks = tracks.filter(function (t) { return pinnedTrackIds.includes(t.id); });
    // PHÂN BIỆT 2 TRƯỜNG HỢP:
    var hasPinnedTracks = pinnedTracks.length > 0;
    // Tính tổng duration thư viện
    var totalLibraryDuration = tracks.reduce(function (sum, t) { return sum + t.duration; }, 0);
    var totalRequiredDuration = playlistCount * targetSec;
    // Xác định có cần reuse không
    var allowReuse = totalRequiredDuration > totalLibraryDuration;
    if (allowReuse) {
        console.log("[PlaylistEngine] Total required duration (".concat(totalRequiredDuration.toFixed(1), "s) > library duration (").concat(totalLibraryDuration.toFixed(1), "s). Enabling track reuse."));
    }
    // TRƯỜNG HỢP 1: Có pinned tracks
    // - Pinned → Priority (không pinned) → Random
    // TRƯỜNG HỢP 2: Không có pinned tracks
    // - Xáo trộn toàn bộ (cả priority và random) nhưng vẫn đảm bảo tỷ lệ
    var shuffledPriority = [];
    var shuffledPriorityNonPinned = [];
    var shuffledRandom = [];
    var shuffledAll = []; // Dùng cho trường hợp 2
    if (hasPinnedTracks) {
        // TRƯỜNG HỢP 1: Tách priority thành pinned và non-pinned
        var priorityPinnedIds_1 = new Set(pinnedTracks.filter(function (t) { return t.folderType === 'priority'; }).map(function (t) { return t.id; }));
        shuffledPriorityNonPinned = shuffle(priorityTracks.filter(function (t) { return !priorityPinnedIds_1.has(t.id); }));
        shuffledRandom = shuffle(randomTracks);
        console.log("[PlaylistEngine] Tr\u01B0\u1EDDng h\u1EE3p 1: C\u00F3 ".concat(pinnedTracks.length, " b\u00E0i \u0111\u00E3 ch\u1ECDn. Priority (kh\u00F4ng pinned): ").concat(shuffledPriorityNonPinned.length, ", Random: ").concat(shuffledRandom.length));
    }
    else {
        // TRƯỜNG HỢP 2: Xáo trộn toàn bộ
        shuffledAll = shuffle(__spreadArray(__spreadArray([], priorityTracks, true), randomTracks, true));
        console.log("[PlaylistEngine] Tr\u01B0\u1EDDng h\u1EE3p 2: Kh\u00F4ng c\u00F3 b\u00E0i \u0111\u00E3 ch\u1ECDn. X\u00E1o tr\u1ED9n to\u00E0n b\u1ED9 ".concat(shuffledAll.length, " b\u00E0i."));
    }
    // Build từng playlist
    var playlists = [];
    var playlistSignatures = new Set(); // Để đảm bảo mỗi playlist khác nhau
    for (var i = 0; i < playlistCount; i++) {
        var playlist = void 0;
        var attempts = 0;
        var MAX_ATTEMPTS = 50; // Tối đa 50 lần thử để tạo playlist khác nhau
        // Đảm bảo mỗi playlist khác nhau
        do {
            if (hasPinnedTracks) {
                // TRƯỜNG HỢP 1: Shuffle lại mỗi lần để đảm bảo khác nhau
                var shuffledPriorityNonPinnedThisTime = shuffle(priorityTracks.filter(function (t) { return !pinnedTrackIds.includes(t.id); }));
                var shuffledRandomThisTime = shuffle(randomTracks);
                var shuffledPinnedThisTime = shuffle(pinnedTracks); // Shuffle pinned để mỗi playlist khác nhau
                playlist = buildSinglePlaylist(i, shuffledPinnedThisTime, shuffledPriorityNonPinnedThisTime, shuffledRandomThisTime, targetSec, desiredPriorityMin, desiredPriorityMax, allowReuse, hasPinnedTracks);
            }
            else {
                // TRƯỜNG HỢP 2: Shuffle lại toàn bộ mỗi lần
                var shuffledAllThisTime = shuffle(__spreadArray(__spreadArray([], priorityTracks, true), randomTracks, true));
                playlist = buildSinglePlaylist(i, [], [], [], targetSec, desiredPriorityMin, desiredPriorityMax, allowReuse, hasPinnedTracks, shuffledAllThisTime);
            }
            // Tạo signature từ thứ tự tracks
            var signature = playlist.tracks.map(function (t) { return t.id; }).join('|');
            if (!playlistSignatures.has(signature)) {
                playlistSignatures.add(signature);
                break; // Tìm được playlist khác nhau
            }
            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
                console.warn("[PlaylistEngine] Kh\u00F4ng th\u1EC3 t\u1EA1o playlist ".concat(i + 1, " kh\u00E1c nhau sau ").concat(MAX_ATTEMPTS, " l\u1EA7n th\u1EED. S\u1EED d\u1EE5ng playlist hi\u1EC7n t\u1EA1i."));
                break; // Chấp nhận playlist trùng nếu không thể tạo khác
            }
        } while (true);
        playlists.push(playlist);
        // Logging
        var priorityPercent = playlist.totalDurationSec > 0
            ? ((playlist.priorityDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
            : '0.0';
        var randomPercent = playlist.totalDurationSec > 0
            ? ((playlist.randomDurationSec / playlist.totalDurationSec) * 100).toFixed(1)
            : '0.0';
        var targetPercent = playlist.totalDurationSec > 0
            ? ((playlist.totalDurationSec / targetSec) * 100).toFixed(1)
            : '0.0';
        console.log("[PlaylistEngine] P".concat(i + 1, ": total=").concat(playlist.totalDurationSec.toFixed(1), "s (").concat(targetPercent, "% of target), priority=").concat(playlist.priorityDurationSec.toFixed(1), "s (").concat(priorityPercent, "%), random=").concat(playlist.randomDurationSec.toFixed(1), "s (").concat(randomPercent, "%), tracks=").concat(playlist.tracks.length));
    }
    return playlists;
}
// In-memory storage
var inMemoryPlaylists = [];
export function savePlaylists(list) {
    // Ghi vào inMemoryPlaylists, có thể overwrite toàn bộ batch mới
    inMemoryPlaylists.length = 0;
    inMemoryPlaylists.push.apply(inMemoryPlaylists, list);
}
export function getPlaylists() {
    return __spreadArray([], inMemoryPlaylists, true);
}
export function getPlaylistById(id) {
    return inMemoryPlaylists.find(function (p) { return p.id === id; });
}
export function clearPlaylists() {
    // Clear in-memory playlists (khi quét nhạc mới)
    inMemoryPlaylists.length = 0;
}
