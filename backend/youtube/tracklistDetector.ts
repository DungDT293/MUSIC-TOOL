/**
 * Phát hiện tracklist từ mô tả video YouTube
 */

export interface TracklistItem {
  index: number;
  time?: string; // Format: "mm:ss" hoặc "hh:mm:ss"
  title: string;
  artist?: string;
  rawLine: string; // Dòng gốc từ description
}

export interface DetectedTracklist {
  items: TracklistItem[];
  format: 'numbered' | 'timestamped' | 'simple' | 'unknown';
}

/**
 * Phát hiện tracklist từ description
 * Hỗ trợ các format:
 * - Số thứ tự: "1. Song Name - Artist", "01. Song Name"
 * - Timestamp: "0:00 Song Name - Artist", "00:00 Song Name"
 * - Danh sách: "- Song Name - Artist", "• Song Name"
 */
export function detectTracklist(description: string): DetectedTracklist | null {
  if (!description || description.trim().length === 0) {
    return null;
  }

  const lines = description.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  if (lines.length === 0) {
    return null;
  }

  // Tìm phần tracklist (thường có pattern đặc biệt)
  let tracklistStartIndex = -1;
  let tracklistEndIndex = -1;
  
  // Tìm các keyword báo hiệu tracklist
  const tracklistKeywords = [
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
  
  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    if (tracklistKeywords.some(keyword => lineLower.includes(keyword))) {
      tracklistStartIndex = i;
      break;
    }
  }
  
  // Nếu không tìm thấy keyword, thử tìm pattern tracklist từ đầu
  if (tracklistStartIndex === -1) {
    // Tìm dòng đầu tiên có pattern tracklist (số + tên bài)
    for (let i = 0; i < Math.min(20, lines.length); i++) {
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
  for (let i = tracklistStartIndex + 1; i < lines.length; i++) {
    if (isTracklistLine(lines[i])) {
      tracklistEndIndex = i;
    } else if (i - tracklistEndIndex > 2) {
      // Nếu có 2 dòng liên tiếp không phải tracklist, dừng lại
      break;
    }
  }
  
  // Extract tracklist items
  const tracklistLines = lines.slice(tracklistStartIndex, tracklistEndIndex + 1);
  const items: TracklistItem[] = [];
  let format: DetectedTracklist['format'] = 'unknown';
  
  for (let i = 0; i < tracklistLines.length; i++) {
    const line = tracklistLines[i];
    const item = parseTracklistLine(line, i + 1);
    
    if (item) {
      items.push(item);
      
      // Xác định format
      if (item.time && format === 'unknown') {
        format = 'timestamped';
      } else if (item.index > 0 && format === 'unknown') {
        format = 'numbered';
      } else if (format === 'unknown' && (line.startsWith('-') || line.startsWith('•'))) {
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
    items,
    format
  };
}

/**
 * Kiểm tra xem một dòng có phải là tracklist line không
 */
function isTracklistLine(line: string): boolean {
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
function parseTracklistLine(line: string, defaultIndex: number): TracklistItem | null {
  if (!line || line.trim().length === 0) {
    return null;
  }
  
  let time: string | undefined = undefined;
  let title = '';
  let artist: string | undefined = undefined;
  let index = 0;
  
  // Pattern 1: Timestamp format "mm:ss Title - Artist" hoặc "hh:mm:ss Title - Artist"
  const timestampMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
  if (timestampMatch) {
    time = timestampMatch[1];
    const rest = timestampMatch[2].trim();
    const parts = rest.split(/\s*-\s*/);
    title = parts[0]?.trim() || '';
    artist = parts[1]?.trim() || undefined;
    index = defaultIndex;
  } else {
    // Pattern 2: Số thứ tự format "1. Title - Artist" hoặc "01. Title"
    const numberedMatch = line.match(/^(\d+)[\.\)]\s*(.+)$/);
    if (numberedMatch) {
      index = parseInt(numberedMatch[1], 10);
      const rest = numberedMatch[2].trim();
      const parts = rest.split(/\s*-\s*/);
      title = parts[0]?.trim() || '';
      artist = parts[1]?.trim() || undefined;
    } else {
      // Pattern 3: [Số] format "[1] Title - Artist"
      const bracketMatch = line.match(/^\[(\d+)\]\s*(.+)$/);
      if (bracketMatch) {
        index = parseInt(bracketMatch[1], 10);
        const rest = bracketMatch[2].trim();
        const parts = rest.split(/\s*-\s*/);
        title = parts[0]?.trim() || '';
        artist = parts[1]?.trim() || undefined;
      } else {
        // Pattern 4: Danh sách đơn giản "- Title - Artist" hoặc "• Title"
        const listMatch = line.match(/^[-•*]\s*(.+)$/);
        if (listMatch) {
          index = defaultIndex;
          const rest = listMatch[1].trim();
          const parts = rest.split(/\s*-\s*/);
          title = parts[0]?.trim() || '';
          artist = parts[1]?.trim() || undefined;
        } else {
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
    index,
    time,
    title,
    artist,
    rawLine: line
  };
}

/**
 * Format tracklist thành text để lưu vào file
 */
export function formatTracklistForFile(tracklist: DetectedTracklist): string {
  const lines: string[] = [];
  
  for (const item of tracklist.items) {
    if (tracklist.format === 'timestamped' && item.time) {
      // Format: "mm:ss Title - Artist"
      const artistPart = item.artist ? ` - ${item.artist}` : '';
      lines.push(`${item.time} ${item.title}${artistPart}`);
    } else {
      // Format: "Số. Title - Artist"
      const artistPart = item.artist ? ` - ${item.artist}` : '';
      lines.push(`${item.index}. ${item.title}${artistPart}`);
    }
  }
  
  return lines.join('\n');
}



