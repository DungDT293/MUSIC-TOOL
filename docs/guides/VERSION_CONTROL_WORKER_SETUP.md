# Hướng dẫn cập nhật Cloudflare Worker cho Version Control

## Tổng quan

Sau khi cập nhật code app, bạn cần cập nhật Worker để:
1. **Kiểm tra version** từ app và so sánh với `MIN_VERSION`
2. **Trả về `latestVersion` và `downloadUrl`** để app hiển thị thông báo có bản mới

---

## Bước 1: Thêm hàm so sánh version

Thêm vào đầu file Worker (sau các constant):

```javascript
const MIN_VERSION = '1.0.0' // Phiên bản tối thiểu yêu cầu - cập nhật khi phát hành bản mới
const LATEST_VERSION = '1.0.0' // Phiên bản mới nhất hiện có
const DOWNLOAD_URL = 'https://your-download-link.com/app-v1.0.0.exe' // Link tải bản mới

// Hàm so sánh version (đơn giản, dạng x.y.z)
function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0
    const vb = pb[i] || 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}
```

---

## Bước 2: Cập nhật hàm `handleCheck`

Tìm hàm `handleCheck` (endpoint `/api/auth/check`) và sửa như sau:

### 2.1. Đọc `version` từ body

```javascript
async function handleCheck(request, env) {
  const body = await request.json().catch(() => null)
  const { tai_khoan, mat_khau, ma_may, version } = body || {}
  
  // ... phần còn lại
}
```

### 2.2. Kiểm tra version TRƯỚC khi check tài khoản

Thêm ngay sau khi đọc body:

```javascript
// 1) Check version trước
if (version && compareVersion(version, MIN_VERSION) < 0) {
  return json(
    {
      allow: false,
      reason: 'Đã có bản mới, vui lòng cập nhật.',
      latestVersion: LATEST_VERSION,
      downloadUrl: DOWNLOAD_URL,
    },
    200
  )
}
```

### 2.3. Luôn trả về `latestVersion` và `downloadUrl` trong response thành công

Tìm phần trả về khi `allow: true` và thêm 2 field này:

```javascript
// Nếu tài khoản hợp lệ và được phép
return json({
  allow: true,
  key_kich_hoat: row.key_kich_hoat,
  trang_thai: row.trang_thai,
  latestVersion: LATEST_VERSION,  // ← Thêm dòng này
  downloadUrl: DOWNLOAD_URL,      // ← Thêm dòng này
})
```

---

## Bước 3: Khi phát hành bản mới

Ví dụ bạn build bản `1.1.0`:

1. **Trong app (`electron/main.ts`)**:
   ```typescript
   const APP_VERSION = '1.1.0' // ← Đổi thành version mới
   ```

2. **Trong Worker**:
   ```javascript
   const MIN_VERSION = '1.1.0' // ← Đổi thành version mới (ép tất cả phải update)
   const LATEST_VERSION = '1.1.0' // ← Đổi thành version mới
   const DOWNLOAD_URL = 'https://your-download-link.com/app-v1.1.0.exe' // ← Link tải bản mới
   ```

3. **Deploy Worker** → tất cả app bản cũ sẽ:
   - Bị chặn đăng nhập với message "Đã có bản mới, vui lòng cập nhật."
   - Thấy banner xanh ở trên cùng với nút "Tải ngay" → click vào tải bản mới

---

## Ví dụ code Worker hoàn chỉnh (phần handleCheck)

```javascript
async function handleCheck(request, env) {
  const body = await request.json().catch(() => null)
  const { tai_khoan, mat_khau, ma_may, version } = body || {}

  // 1) Check version trước
  if (version && compareVersion(version, MIN_VERSION) < 0) {
    return json(
      {
        allow: false,
        reason: 'Đã có bản mới, vui lòng cập nhật.',
        latestVersion: LATEST_VERSION,
        downloadUrl: DOWNLOAD_URL,
      },
      200
    )
  }

  // 2) Validate input
  if (!tai_khoan || !mat_khau || !ma_may) {
    return json({ allow: false, reason: 'Thiếu thông tin đăng nhập.' }, 400)
  }

  // 3) Query database
  const row = await env.DB.prepare(
    `SELECT key_kich_hoat, trang_thai
     FROM registrations
     WHERE tai_khoan = ?1 AND mat_khau = ?2 AND ma_may = ?3
     LIMIT 1`
  )
    .bind(tai_khoan, mat_khau, ma_may)
    .first()

  if (!row) {
    return json({ allow: false, reason: 'Tài khoản / mật khẩu / máy không đúng.' }, 200)
  }

  if (row.trang_thai === 'CHAN') {
    return json(
      {
        allow: false,
        reason: 'Tài khoản / máy này đã bị chặn.',
        trang_thai: 'CHAN',
        latestVersion: LATEST_VERSION,
        downloadUrl: DOWNLOAD_URL,
      },
      200
    )
  }

  if (row.trang_thai !== 'CHO_PHEP') {
    return json(
      {
        allow: false,
        reason: 'Tài khoản chưa được cấp quyền.',
        trang_thai: row.trang_thai,
        latestVersion: LATEST_VERSION,
        downloadUrl: DOWNLOAD_URL,
      },
      200
    )
  }

  // 4) Trả về thành công
  return json({
    allow: true,
    key_kich_hoat: row.key_kich_hoat,
    trang_thai: row.trang_thai,
    latestVersion: LATEST_VERSION,
    downloadUrl: DOWNLOAD_URL,
  })
}
```

---

## Lưu ý

- **`MIN_VERSION`**: Version tối thiểu để app chạy được. Nếu app gửi version < MIN_VERSION → bị chặn.
- **`LATEST_VERSION`**: Version mới nhất hiện có, luôn trả về cho app để hiển thị.
- **`DOWNLOAD_URL`**: Link tải bản mới (có thể là GitHub Releases, Google Drive, server riêng, v.v.)

---

## Test

1. **Test version cũ bị chặn**:
   - Tạm thời set `MIN_VERSION = '2.0.0'` trong Worker
   - App đang dùng `APP_VERSION = '1.0.0'`
   - Đăng nhập → phải thấy message "Đã có bản mới, vui lòng cập nhật." + banner xanh

2. **Test version mới OK**:
   - Set `MIN_VERSION = '1.0.0'` trong Worker
   - App dùng `APP_VERSION = '1.0.0'`
   - Đăng nhập → thành công, banner xanh chỉ hiện nếu `LATEST_VERSION > APP_VERSION`

