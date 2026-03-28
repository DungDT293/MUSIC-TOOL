/**
 * Phát hiện tracklist từ mô tả video YouTube
 */
/**
 * Phát hiện tracklist từ description
 * Hỗ trợ các format:
 * - Số thứ tự: "1. Song Name - Artist", "01. Song Name"
 * - Timestamp: "0:00 Song Name - Artist", "00:00 Song Name"
 * - Danh sách: "- Song Name - Artist", "• Song Name"
 */
export function detectTracklist(description) {
    if (!description || description.trim().length === 0) {
        return null;
    }
    var lines = description.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(function (line) { return line.length > 0; });
    if (lines.length === 0) {
        return null;
    }
    // Tìm phần tracklist (thường có pattern đặc biệt)
    var tracklistStartIndex = -1;
    var tracklistEndIndex = -1;
    // Tìm các keyword báo hiệu tracklist
    var tracklistKeywords = [
        'tracklist',
        'track list',
        'playlist',
        'danh sách',
        'danh sach',
        'bài hát',
        'bai hat',
        'songs',
        'tracks',
        'setlist'
    ];
    var _loop_1 = function (i) {
        var lineLower = lines[i].toLowerCase();
        if (tracklistKeywords.some(function (keyword) { return lineLower.includes(keyword); })) {
            tracklistStartIndex = i;
            return "break";
        }
    };
    for (var i = 0; i < lines.length; i++) {
        var state_1 = _loop_1(i);
        if (state_1 === "break")
            break;
    }
    // Nếu không tìm thấy keyword, thử tìm pattern tracklist từ đầu
    if (tracklistStartIndex === -1) {
        // Tìm dòng đầu tiên có pattern tracklist (số + tên bài)
        for (var i = 0; i < Math.min(20, lines.length); i++) {
            if (isTracklistLine(lines[i])) {
                tracklistStartIndex = i;
                break;
            }
        }
    }
    if (tracklistStartIndex === -1) {
        return null; // Không tìm thấy tracklist
    }
    // Tìm điểm kết thúc tracklist (dòng trống hoặc không phải tracklist pattern)
    tracklistEndIndex = tracklistStartIndex;
    for (var i = tracklistStartIndex + 1; i < lines.length; i++) {
        if (isTracklistLine(lines[i])) {
            tracklistEndIndex = i;
        }
        else if (i - tracklistEndIndex > 2) {
            // Nếu có 2 dòng liên tiếp không phải tracklist, dừng lại
            break;
        }
    }
    // Extract tracklist items
    var tracklistLines = lines.slice(tracklistStartIndex, tracklistEndIndex + 1);
    var items = [];
    var format = 'unknown';
    for (var i = 0; i < tracklistLines.length; i++) {
        var line = tracklistLines[i];
        var item = parseTracklistLine(line, i + 1);
        if (item) {
            items.push(item);
            // Xác định format
            if (item.time && format === 'unknown') {
                format = 'timestamped';
            }
            else if (item.index > 0 && format === 'unknown') {
                format = 'numbered';
            }
            else if (format === 'unknown' && (line.startsWith('-') || line.startsWith('•'))) {
                format = 'simple';
            }
        }
    }
    if (items.length === 0) {
        return null;
    }
    // Nếu format vẫn unknown, mặc định là numbered
    if (format === 'unknown') {
        format = 'numbered';
    }
    return {
        items: items,
        format: format
    };
}
/**
 * Kiểm tra xem một dòng có phải là tracklist line không
 */
function isTracklistLine(line) {
    if (!line || line.length < 3) {
        return false;
    }
    // Pattern 1: Số thứ tự + tên bài
    if (/^\d+[\.\)]\s*/.test(line)) {
        return true;
    }
    // Pattern 2: Timestamp + tên bài
    if (/^\d{1,2}:\d{2}(:\d{2})?\s+/.test(line)) {
        return true;
    }
    // Pattern 3: Danh sách với ký tự đặc biệt
    if (/^[-•*]\s+/.test(line)) {
        return true;
    }
    // Pattern 4: [Số] + tên bài
    if (/^\[\d+\]\s*/.test(line)) {
        return true;
    }
    return false;
}
/**
 * Parse một dòng tracklist thành TracklistItem
 */
function parseTracklistLine(line, defaultIndex) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!line || line.trim().length === 0) {
        return null;
    }
    var time = undefined;
    var title = '';
    var artist = undefined;
    var index = 0;
    // Pattern 1: Timestamp format "mm:ss Title - Artist" hoặc "hh:mm:ss Title - Artist"
    var timestampMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (timestampMatch) {
        time = timestampMatch[1];
        var rest = timestampMatch[2].trim();
        var parts = rest.split(/\s*-\s*/);
        title = ((_a = parts[0]) === null || _a === void 0 ? void 0 : _a.trim()) || '';
        artist = ((_b = parts[1]) === null || _b === void 0 ? void 0 : _b.trim()) || undefined;
        index = defaultIndex;
    }
    else {
        // Pattern 2: Số thứ tự format "1. Title - Artist" hoặc "01. Title"
        var numberedMatch = line.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (numberedMatch) {
            index = parseInt(numberedMatch[1], 10);
            var rest = numberedMatch[2].trim();
            var parts = rest.split(/\s*-\s*/);
            title = ((_c = parts[0]) === null || _c === void 0 ? void 0 : _c.trim()) || '';
            artist = ((_d = parts[1]) === null || _d === void 0 ? void 0 : _d.trim()) || undefined;
        }
        else {
            // Pattern 3: [Số] format "[1] Title - Artist"
            var bracketMatch = line.match(/^\[(\d+)\]\s*(.+)$/);
            if (bracketMatch) {
                index = parseInt(bracketMatch[1], 10);
                var rest = bracketMatch[2].trim();
                var parts = rest.split(/\s*-\s*/);
                title = ((_e = parts[0]) === null || _e === void 0 ? void 0 : _e.trim()) || '';
                artist = ((_f = parts[1]) === null || _f === void 0 ? void 0 : _f.trim()) || undefined;
            }
            else {
                // Pattern 4: Danh sách đơn giản "- Title - Artist" hoặc "• Title"
                var listMatch = line.match(/^[-•*]\s*(.+)$/);
                if (listMatch) {
                    index = defaultIndex;
                    var rest = listMatch[1].trim();
                    var parts = rest.split(/\s*-\s*/);
                    title = ((_g = parts[0]) === null || _g === void 0 ? void 0 : _g.trim()) || '';
                    artist = ((_h = parts[1]) === null || _h === void 0 ? void 0 : _h.trim()) || undefined;
                }
                else {
                    // Không match pattern nào, bỏ qua
                    return null;
                }
            }
        }
    }
    if (!title || title.length === 0) {
        return null;
    }
    return {
        index: index,
        time: time,
        title: title,
        artist: artist,
        rawLine: line
    };
}
/**
 * Format tracklist thành text để lưu vào file
 */
export function formatTracklistForFile(tracklist) {
    var lines = [];
    for (var _i = 0, _a = tracklist.items; _i < _a.length; _i++) {
        var item = _a[_i];
        if (tracklist.format === 'timestamped' && item.time) {
            // Format: "mm:ss Title - Artist"
            var artistPart = item.artist ? " - ".concat(item.artist) : '';
            lines.push("".concat(item.time, " ").concat(item.title).concat(artistPart));
        }
        else {
            // Format: "Số. Title - Artist"
            var artistPart = item.artist ? " - ".concat(item.artist) : '';
            lines.push("".concat(item.index, ". ").concat(item.title).concat(artistPart));
        }
    }
    return lines.join('\n');
}
