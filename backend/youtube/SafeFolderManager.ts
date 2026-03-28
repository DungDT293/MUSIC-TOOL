import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Quản lý folder an toàn cho download
 * Sanitize folder names để tránh lỗi với ký tự đặc biệt, tên quá dài, reserved names
 */
export class SafeFolderManager {
  private basePath: string;
  private maxFolderLength: number = 100; // Giới hạn độ dài folder
  private reservedNames: Set<string> = new Set([
    'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
    'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2',
    'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ]);

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Làm sạch tên folder để tránh lỗi
   */
  sanitizeFolderName(name: string | null | undefined): string {
    if (!name || typeof name !== 'string') {
      return 'Unknown_Channel';
    }

    // Loại bỏ ký tự Unicode không hợp lệ và normalize
    let sanitized = name.normalize('NFKD');

    // Thay thế ký tự đặc biệt bằng underscore
    sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '_');

    // Loại bỏ khoảng trắng đầu cuối
    sanitized = sanitized.trim();

    // Loại bỏ khoảng trắng liên tiếp
    sanitized = sanitized.replace(/\s+/g, ' ');

    // Thay khoảng trắng bằng underscore
    sanitized = sanitized.replace(/\s/g, '_');

    // Loại bỏ ký tự không in được
    sanitized = sanitized.split('').filter(c => {
      const code = c.charCodeAt(0);
      return code >= 32 && code !== 127; // Printable ASCII + extended
    }).join('');

    // Giới hạn độ dài
    if (sanitized.length > this.maxFolderLength) {
      sanitized = sanitized.substring(0, this.maxFolderLength).replace(/_+$/, '');
    }

    // Kiểm tra tên reserved
    if (this.reservedNames.has(sanitized.toUpperCase())) {
      sanitized = `Channel_${sanitized}`;
    }

    // Đảm bảo không trống
    if (!sanitized || sanitized.trim().length === 0) {
      sanitized = 'Unknown_Channel';
    }

    return sanitized;
  }

  /**
   * Tạo folder cho kênh một cách an toàn
   */
  async createChannelFolder(channelName: string, videoTitle?: string): Promise<string> {
    try {
      // Làm sạch tên kênh
      const safeChannelName = this.sanitizeFolderName(channelName);

      // Tạo đường dẫn folder
      const channelFolder = path.join(this.basePath, safeChannelName);

      // Kiểm tra và tạo folder
      try {
        await fs.access(channelFolder);
        console.log(`[SafeFolderManager] Folder đã tồn tại: ${channelFolder}`);
      } catch {
        await fs.mkdir(channelFolder, { recursive: true });
        console.log(`[SafeFolderManager] ✅ Đã tạo folder: ${channelFolder}`);
      }

      // Tạo subfolder cho video nếu có
      if (videoTitle) {
        const safeVideoName = this.sanitizeFolderName(videoTitle);
        const videoFolder = path.join(channelFolder, safeVideoName);

        try {
          await fs.access(videoFolder);
        } catch {
          await fs.mkdir(videoFolder, { recursive: true });
          console.log(`[SafeFolderManager] ✅ Đã tạo subfolder: ${videoFolder}`);
        }

        return videoFolder;
      }

      return channelFolder;
    } catch (error: any) {
      console.error(`[SafeFolderManager] ❌ Lỗi tạo folder: ${error.message}`);
      return this.basePath;
    }
  }

  /**
   * Lấy đường dẫn output an toàn
   */
  async getSafeOutputPath(channelName: string, videoTitle: string, filename: string): Promise<string> {
    try {
      // Tạo folder kênh
      const channelPath = await this.createChannelFolder(channelName, videoTitle);

      // Tạo đường dẫn file
      let outputPath = path.join(channelPath, filename);

      // Kiểm tra độ dài đường dẫn (Windows limit ~260 chars)
      if (outputPath.length > 250) {
        // Rút ngắn filename nếu cần
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        const maxNameLength = 250 - channelPath.length - ext.length;
        if (maxNameLength > 0) {
          const shortName = name.substring(0, maxNameLength);
          outputPath = path.join(channelPath, `${shortName}${ext}`);
        }
      }

      return outputPath;
    } catch (error: any) {
      console.error(`[SafeFolderManager] ❌ Lỗi tạo đường dẫn: ${error.message}`);
      return path.join(this.basePath, filename);
    }
  }
}

