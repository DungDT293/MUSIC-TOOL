import type { PlaylistDefinition } from '../../types/ipc'

/**
 * Sanitize tên file cho Windows/Linux:
 * - Chuyển đổi đ/Đ thành d/D
 * - Bỏ dấu tiếng Việt (normalize NFKD + strip combining diacritics)
 * - Bỏ ký tự đặc biệt không hợp lệ cho file
 * - Chuẩn hóa khoảng trắng và dấu gạch nối thành dấu gạch dưới `_`
 * - Không để nhiều dấu gạch dưới liên tiếp, bỏ gạch dưới ở đầu/cuối
 */
export function sanitizeFileName(name: string): string {
  if (!name) return ''
  return name
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu kết hợp
    .replace(/[^a-zA-Z0-9\-_. ]/g, '') // chỉ giữ chữ, số, gạch ngang, chấm, gạch dưới, khoảng trắng
    .trim()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export interface BuildExportFileNameOptions {
  commonPrefix?: string
  genreCustomName?: string
  isMultiGenreExport?: boolean
  collisionIndex?: number
}

/**
 * Xây dựng tên file xuất cho 1 playlist dựa trên:
 * - Tiền tố chung (nếu có)
 * - Tên/tiền tố thể loại (người dùng tự nhập hoặc lấy mặc định từ tên thể loại)
 * - Tên playlist (đã lọc sạch)
 * - Tự động đính kèm tên thể loại nếu tên playlist mang tính generic (như "Playlist 1")
 *   hoặc khi có nhiều thể loại xuất chung.
 */
export function buildPlaylistExportFileName(
  playlist: PlaylistDefinition,
  options: BuildExportFileNameOptions = {}
): string {
  const commonPrefix = options.commonPrefix?.trim() ? sanitizeFileName(options.commonPrefix.trim()) : ''
  const genreCustom = options.genreCustomName?.trim() ? sanitizeFileName(options.genreCustomName.trim()) : ''
  const defaultGenreTag = playlist.genreName ? sanitizeFileName(playlist.genreName) : ''
  const genreTag = genreCustom || defaultGenreTag

  // Chuẩn hóa tên playlist
  let rawName = sanitizeFileName(playlist.name || '')
  if (!rawName) {
    rawName = 'playlist'
  }

  // Kiểm tra xem rawName đã có genreTag ở đầu chưa
  const hasGenrePrefix = genreTag && (rawName === genreTag || rawName.startsWith(`${genreTag}_`))

  if (!hasGenrePrefix && genreTag) {
    // Nếu tên playlist mang tính generic như "playlist_1", "playlist",
    // HOẶC nếu đang xuất nhiều thể loại (đặc biệt là chung folder),
    // HOẶC người dùng có nhập genreCustom riêng -> luôn gắn genreTag vào đầu
    const isGeneric = /^playlist(_\d+)?$/i.test(rawName)
    if (isGeneric || options.isMultiGenreExport || Boolean(genreCustom)) {
      rawName = `${genreTag}_${rawName}`
    }
  }

  // Thêm tiền tố chung nếu có
  let result = commonPrefix ? `${commonPrefix}_${rawName}` : rawName

  // Thêm số thứ tự tránh trùng nếu cần
  if (options.collisionIndex && options.collisionIndex > 1) {
    result = `${result}_${options.collisionIndex}`
  }

  result = result.replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return result || 'playlist'
}

/**
 * Giải quyết toàn bộ tên file cho một mảng playlists được chọn để xuất.
 * Đảm bảo 100% KHÔNG CÓ 2 PLAYLIST NÀO XUẤT RA CÙNG MỘT ĐƯỜNG DẪN TRONG CÙNG 1 BATCH!
 */
export function resolveBatchFileNames(
  selectedPlaylists: PlaylistDefinition[],
  getOutputDir: (pl: PlaylistDefinition) => string,
  options: {
    commonPrefix?: string
    genreCustomNames?: Record<string, string>
    quality?: 'mp3_320' | 'aac_384'
  } = {}
): Map<string, string> {
  const ext = options.quality === 'mp3_320' ? '.mp3' : '.m4a'

  // Kiểm tra xem có nhiều thể loại khác nhau được chọn không
  const selectedGenreIds = new Set(selectedPlaylists.map((p) => p.genreId || 'legacy'))
  const isMultiGenre = selectedGenreIds.size > 1

  // Đếm số lượng playlist trên từng thư mục xuất
  const dirCounts = new Map<string, number>()
  for (const pl of selectedPlaylists) {
    const dir = getOutputDir(pl)
    if (dir) {
      dirCounts.set(dir.toLowerCase(), (dirCounts.get(dir.toLowerCase()) || 0) + 1)
    }
  }

  const result = new Map<string, string>() // playlistId -> unique fileName (no ext)
  const usedPaths = new Set<string>() // normalized full path key: dir::name.ext

  for (const pl of selectedPlaylists) {
    const dir = getOutputDir(pl)
    const genreId = pl.genreId || 'legacy'
    const genreCustom = options.genreCustomNames?.[genreId]
    const dirCount = dir ? dirCounts.get(dir.toLowerCase()) || 0 : 0
    const sharesDirWithOthers = dirCount > 1

    const candidate = buildPlaylistExportFileName(pl, {
      commonPrefix: options.commonPrefix,
      genreCustomName: genreCustom,
      isMultiGenreExport: isMultiGenre || sharesDirWithOthers,
    })

    let finalName = candidate
    let counter = 1

    // Kiểm tra trùng lặp trong cùng thư mục
    if (dir) {
      const makeKey = (name: string) => `${dir.toLowerCase()}::${name.toLowerCase()}${ext}`
      while (usedPaths.has(makeKey(finalName))) {
        counter++
        finalName = `${candidate}_${counter}`
      }
      usedPaths.add(makeKey(finalName))
    }

    result.set(pl.id, finalName)
  }

  return result
}
