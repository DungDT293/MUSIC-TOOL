# Báo Cáo Rà Soát Bảo Mật - Version 3.6.0
**Ngày thực hiện:** 2025-01-22  
**Người thực hiện:** Senior Security Engineer & Software Architect  
**Phương pháp:** White-box Security Audit (OWASP Top 10)

---

## 1. Tổng quan Kiến trúc

### Mục đích App
**93 Media - Tool Mix Nhạc** là ứng dụng desktop (Electron) để:
- Quét và quản lý thư viện nhạc (MP3, WAV, AAC, FLAC)
- Tạo playlist tự động với crossfade
- Xuất audio playlist với metadata
- Cắt/ghép video với FFmpeg
- Xuất video hoàn chỉnh với subtitle (Whisper transcription)
- YouTube downloader
- SEO metadata cho video
- Autopilot: Tự động hóa quy trình sản xuất video hàng loạt
- Visualizer: Tạo visual effects cho audio

### Tech Stack
- **Frontend:** React 18.3.1, TypeScript, Vite, Zustand (state management)
- **Backend:** Node.js (Electron main process), TypeScript
- **IPC:** Electron IPC (contextBridge + ipcMain/ipcRenderer)
- **Video Processing:** FFmpeg (spawn process)
- **Audio Transcription:** @xenova/transformers (Whisper), faster-whisper (Python)
- **Authentication:** Online server (Cloudflare Workers + D1 Database)
- **Encryption:** AES-256-GCM, PBKDF2 (10,000 iterations)
- **Build:** electron-builder, electron-vite

### Luồng dữ liệu quan trọng (3 luồng nhạy cảm nhất)

#### 1. **Authentication & License Flow**
```
User Input (username/password) 
  → IPC: auth:login 
  → Main: POST /api/auth/check (signed request)
  → Server: Validate password (PLAINTEXT COMPARISON - VULNERABILITY)
  → Response: activationKey
  → Encrypted storage: AES-256-GCM (key từ machineId)
```

**Dữ liệu nhạy cảm:**
- Username/password (plaintext trong memory, encrypted trong storage)
- ActivationKey
- MachineId (hardware fingerprint)

#### 2. **File System Operations**
```
User selects folder/file (Electron dialog)
  → IPC: dialog:selectFolder, music:scanFolders, video:listVideosInFolder
  → Main: fs.readdir, fs.stat, path.join/resolve
  → Backend: Process files, build FFmpeg commands
  → spawn(ffmpeg, args) - COMMAND INJECTION RISK nếu path không validate
```

**Dữ liệu nhạy cảm:**
- User file paths (có thể chứa special characters)
- Output paths (user-controlled)

#### 3. **IPC Communication (Renderer ↔ Main)**
```
Renderer: window.api.music.scan(payload)
  → Preload: ipcRenderer.invoke('music:scanFolders', payload)
  → Main: ipcMain.handle('music:scanFolders', async (_event, payload) => {...})
  → Backend: scanMusicFolders(payload.priorityFolder, payload.randomFolder)
```

**Dữ liệu nhạy cảm:**
- Tất cả user input từ renderer
- File paths, folder paths
- Configuration data (Autopilot config, export settings)

---

## 2. Báo cáo Rà soát Bảo mật 🛑

### 🔴 CRITICAL - Cần sửa ngay

#### **Vấn đề 1: Hardcoded Credentials trong LoginPage.tsx**
- **📍 Vị trí:** `src/LoginPage.tsx : 92-94`
- **💀 Tác động:** 
  - Backdoor authentication bypass hoàn toàn
  - Bất kỳ ai đọc source code đều có thể login
  - Không cần server authentication
  - **CVSS Score: 9.8 (Critical)**
- **🛡️ Fix nhanh:**
```typescript
// XÓA HOÀN TOÀN LoginPage.tsx hoặc redirect đến AuthPage
// File này là legacy code, không nên tồn tại
```

#### **Vấn đề 2: Password Comparison Không Hash (Plaintext)**
- **📍 Vị trí:** `server/index.ts : 278`
- **💀 Tác động:**
  - Password được lưu plaintext trong database
  - So sánh trực tiếp: `row.mat_kau !== mat_khau`
  - Nếu database bị leak, tất cả passwords bị expose
  - Không có salt/hash protection
  - **CVSS Score: 9.1 (Critical)**
- **🛡️ Fix nhanh:**
```typescript
// server/index.ts:278
// THAY ĐỔI:
if (row.mat_khau !== mat_khau) {
  return json({ allow: false, reason: 'Sai mật khẩu.' })
}

// THÀNH:
import bcrypt from 'bcryptjs' // hoặc argon2
const isValidPassword = await bcrypt.compare(mat_khau, row.mat_khau)
if (!isValidPassword) {
  return json({ allow: false, reason: 'Sai mật khẩu.' })
}

// VÀ khi register (server/index.ts:80-116):
// Hash password trước khi lưu:
const hashedPassword = await bcrypt.hash(mat_khau, 10)
await env.DB.prepare('INSERT INTO registrations (tai_khoan, mat_khau, ...) VALUES (?, ?, ...)')
  .bind(tai_khoan, hashedPassword, ...)
  .run()
```

#### **Vấn đề 3: Hardcoded Secrets trong Source Code**
- **📍 Vị trí:** 
  - `backend/security/stringEncryption.ts : 10-13, 51-52`
  - `electron/main.ts : 114-115` (fallback secrets)
- **💀 Tác động:**
  - Encryption key được hardcode: `'93MediaToolMixNhac2025StringEncryptionKey!@#'`
  - INSTALLER_SECRET: `'2025LEONYG280722'`
  - INSTALLER_KEY: `'Ins$2025!LEONYG'`
  - Bất kỳ ai reverse engineer đều có thể decrypt strings
  - **CVSS Score: 7.5 (High)**
- **🛡️ Fix nhanh:**
```typescript
// backend/security/stringEncryption.ts
// THAY ĐỔI:
const STRING_ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update('93MediaToolMixNhac2025StringEncryptionKey!@#') // HARDCODED
  .digest()

// THÀNH:
// Option 1: Environment variable
const ENCRYPTION_KEY_SOURCE = process.env.ENCRYPTION_KEY || 
  (() => {
    console.warn('[Security] ENCRYPTION_KEY not set, using weak default')
    return 'fallback-key-change-in-production'
  })()

// Option 2: Derive từ machineId + app secret (better)
const STRING_ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(await getMachineHash() + process.env.APP_SECRET || 'fallback')
  .digest()

// VÀ trong electron/main.ts:114-115, XÓA fallback secrets:
// KHÔNG nên có:
// AUTH_BASE = 'https://license-server.dungdong333.workers.dev'
// INSTALLER_SECRET = '2025LEONYG280722'
```

#### **Vấn đề 4: Sandbox Disabled - CONFIRMED**
- **📍 Vị trí:** `electron/main.ts : 657`
- **💀 Tác động:**
  - `sandbox: false` - **CONFIRMED trong code hiện tại**
  - Cho phép renderer process truy cập Node.js APIs nếu có XSS
  - XSS attack có thể execute arbitrary code
  - **CVSS Score: 8.8 (High)**
- **🛡️ Fix nhanh:**
```typescript
// electron/main.ts:657
// THAY ĐỔI:
webPreferences: {
  preload: preloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false, // ❌ VULNERABLE
  // ...
}

// THÀNH:
webPreferences: {
  preload: preloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true, // ✅ FIXED
  // ...
}
// NOTE: Cần test tất cả features vẫn hoạt động với sandbox: true
```

#### **Vấn đề 5: XSS via innerHTML**
- **📍 Vị trí:** `src/main.tsx : 27-33`
- **💀 Tác động:**
  - Error message được inject trực tiếp vào `innerHTML`
  - Nếu error message chứa HTML/script, có thể XSS
  - **CVSS Score: 6.1 (Medium)**
- **🛡️ Fix nhanh:**
```typescript
// src/main.tsx:27
// THAY ĐỔI:
document.body.innerHTML = `
  <div style="padding: 20px; color: red; font-family: monospace;">
    <h1>Error loading app</h1>
    <pre>${error instanceof Error ? error.message : String(error)}</pre>
    <p>Check console for details.</p>
  </div>
`

// THÀNH:
const errorDiv = document.createElement('div')
errorDiv.style.cssText = 'padding: 20px; color: red; font-family: monospace;'
errorDiv.innerHTML = '<h1>Error loading app</h1><p>Check console for details.</p>'
const pre = document.createElement('pre')
pre.textContent = error instanceof Error ? error.message : String(error) // textContent thay vì innerHTML
errorDiv.appendChild(pre)
document.body.appendChild(errorDiv)
```

### 🟠 HIGH - Ưu tiên cao

#### **Vấn đề 6: IPC Handlers Không Có Authorization Check**
- **📍 Vị trí:** `electron/main.ts : 1236-2503` (tất cả IPC handlers)
- **💀 Tác động:**
  - Bất kỳ renderer process nào cũng có thể gọi IPC handlers
  - Không có check `authState.status === 'allowed'`
  - User chưa authenticated vẫn có thể:
    - Scan music folders
    - Export playlists
    - Cut/merge videos
    - Access file system
  - **CVSS Score: 7.5 (High)**
- **🛡️ Fix nhanh:**
```typescript
// electron/main.ts - Thêm middleware function:
async function requireAuth(): Promise<void> {
  const state = await getOrInitAuthState()
  if (state.status !== 'allowed') {
    throw new Error('Authentication required. Please login first.')
  }
}

// Áp dụng cho tất cả IPC handlers:
ipcMain.handle('music:scanFolders', async (_event, payload) => {
  await requireAuth() // ✅ Thêm check
  // ... existing code
})

ipcMain.handle('music:createPlaylists', async (_event, payload) => {
  await requireAuth() // ✅
  // ...
})

// Tương tự cho: video:*, system:*, dialog:* (trừ dialog:selectFolder có thể public)
```

#### **Vấn đề 7: Command Injection Risk với spawn()**
- **📍 Vị trí:** 
  - `backend/video/finalExport.ts : 340, 1012, 1139, 2153, 2553, 2748`
  - `backend/audio/whisperTranscribe.ts : 182`
  - `backend/youtube/youtubeDownloader.ts : 360, 759, 931, 1182, 1650`
- **💀 Tác động:**
  - Nếu user input (file paths) không được sanitize, có thể inject commands
  - Ví dụ: `filePath = "video.mp4; rm -rf /"`
  - FFmpeg args được build từ user paths
  - **CVSS Score: 8.1 (High)**
- **🛡️ Fix nhanh:**
```typescript
// Tạo utility: backend/utils/pathSanitizer.ts
export function sanitizePathForCommand(filePath: string): string {
  // 1. Normalize path
  const normalized = path.normalize(filePath)
  
  // 2. Resolve để loại bỏ ../
  const resolved = path.resolve(normalized)
  
  // 3. Validate không có dangerous patterns
  if (normalized.includes('..') || 
      normalized.includes('|') || 
      normalized.includes(';') ||
      normalized.includes('&') ||
      normalized.includes('$') ||
      normalized.includes('`')) {
    throw new Error(`Invalid path: ${filePath}`)
  }
  
  // 4. Escape cho FFmpeg
  return normalized.replace(/'/g, "'\\''")
}

// Áp dụng TRƯỚC khi dùng trong spawn:
const safePath = sanitizePathForCommand(userProvidedPath)
const args = ['-i', safePath, ...]
spawn(ffmpeg, args, {...})
```

#### **Vấn đề 8: Không Có Content Security Policy (CSP)**
- **📍 Vị trí:** `index.html`, `server/index.ts:394` (dashboard HTML)
- **💀 Tác động:**
  - Không có CSP headers
  - XSS attacks có thể load external scripts
  - Dashboard HTML có inline scripts không được restrict
  - **CVSS Score: 6.1 (Medium)**
- **🛡️ Fix nhanh:**
```html
<!-- index.html -->
<head>
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';">
</head>

// VÀ trong server/index.ts:392 (serveDashboard):
// Thêm CSP header:
return new Response(dashboardHTML, {
  headers: {
    'Content-Type': 'text/html',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline';"
  }
})
```

### 🟡 MEDIUM - Cần cải thiện

#### **Vấn đề 9: localStorage Lưu Auth Token Plaintext**
- **📍 Vị trí:** `src/LoginPage.tsx : 105-107`
- **💀 Tác động:**
  - `localStorage.setItem('mt_auth_token', 'local-admin')` - plaintext
  - Nếu có XSS, attacker có thể đọc localStorage
  - **CVSS Score: 5.3 (Medium)**
- **🛡️ Fix nhanh:**
```typescript
// XÓA LoginPage.tsx hoàn toàn (legacy code)
// Sử dụng AuthPage.tsx thay thế (đã có encrypted storage)
```

#### **Vấn đề 10: SQL Injection Risk (D1 Database)**
- **📍 Vị trí:** `server/index.ts : 248-255`
- **💀 Tác động:**
  - D1 sử dụng parameterized queries (`.bind()`) - ✅ SAFE
  - NHƯNG cần audit tất cả SQL queries
  - **CVSS Score: 3.1 (Low)** - đã safe nhưng cần verify
- **🛡️ Verification:**
```typescript
// ✅ TẤT CẢ queries đều dùng .bind() - SAFE
// Chỉ cần audit thêm các queries khác
```

#### **Vấn đề 11: Missing Rate Limiting trên IPC Handlers**
- **📍 Vị trí:** Tất cả `ipcMain.handle()` trong `electron/main.ts`
- **💀 Tác động:**
  - Không có rate limiting
  - Attacker có thể spam IPC calls
  - Có thể gây DoS hoặc resource exhaustion
  - **CVSS Score: 5.3 (Medium)**
- **🛡️ Fix nhanh:**
```typescript
// backend/security/rateLimiter.ts (đã có, cần áp dụng)
import { rateLimiter } from '../security/rateLimiter'

ipcMain.handle('music:scanFolders', async (_event, payload) => {
  // Thêm rate limiting
  const clientId = _event.sender.id.toString()
  if (!rateLimiter.allow(clientId, 'music:scanFolders', { maxRequests: 10, windowMs: 60000 })) {
    throw new Error('Rate limit exceeded. Please wait before retrying.')
  }
  // ... existing code
})
```

#### **Vấn đề 12: Dev Mode Bypass Authentication**
- **📍 Vị trí:** `electron/main.ts : 905-916`
- **💀 Tác động:**
  - Dev mode tự động bypass authentication
  - Nếu app được build với `ELECTRON_RENDERER_URL` set, sẽ bypass
  - **CVSS Score: 4.3 (Medium)** - chỉ ảnh hưởng dev builds
- **🛡️ Fix nhanh:**
```typescript
// electron/main.ts:905
// THAY ĐỔI:
if (isDev) {
  console.log('[auth:getState] Dev mode detected - bypassing activation check')
  // ... bypass logic
}

// THÀNH:
if (isDev && process.env.ALLOW_DEV_BYPASS === 'true') {
  // Chỉ bypass nếu explicit env var set
  console.warn('[auth:getState] ⚠️ DEV BYPASS ENABLED - NOT FOR PRODUCTION')
  // ...
} else {
  // Normal auth flow
  const state = await getOrInitAuthState()
  return state
}
```

---

## 3. Điểm mù & Rủi ro

### Kiến trúc

1. **Không có Centralized Authorization Middleware**
   - Mỗi IPC handler phải tự check auth
   - Dễ quên check ở handler mới
   - **Giải pháp:** Tạo `requireAuth()` middleware và apply cho tất cả handlers

2. **Encryption Key Management**
   - String encryption key hardcoded trong source
   - Nếu key bị leak, tất cả encrypted strings bị decrypt
   - **Giải pháp:** Derive key từ machineId + environment variable

3. **Session Management**
   - Session timeout 30 ngày - quá dài
   - Không có refresh token rotation
   - **Giải pháp:** Giảm timeout xuống 7 ngày, implement refresh token

4. **Error Information Disclosure**
   - Error messages có thể leak internal paths, stack traces
   - **Giải pháp:** Sanitize error messages trước khi trả về client

5. **File Path Validation**
   - Một số nơi dùng `path.join()` trực tiếp từ user input
   - Cần validate tất cả paths trước khi dùng trong commands
   - **Giải pháp:** Centralized path validator

### Logic thiếu sót

1. **Không có Input Validation Layer**
   - Payload types có `any` trong nhiều IPC handlers
   - Không validate structure trước khi process
   - **Giải pháp:** Zod schema validation

2. **Concurrent Access Control**
   - Nhiều IPC handlers có thể chạy đồng thời
   - Không có lock mechanism cho critical operations
   - **Giải pháp:** Mutex/semaphore cho file operations

3. **Logging Security**
   - Logs có thể chứa sensitive data (paths, usernames)
   - **Giải pháp:** Sanitize logs trước khi write

---

## 4. Kế hoạch Refactor Chi tiết 🛠️

> **Nguyên tắc:** Mỗi phase phải:
> - ✅ Có thể test độc lập
> - ✅ Không phá vỡ existing functionality
> - ✅ Có rollback plan rõ ràng
> - ✅ Commit riêng biệt để dễ revert nếu cần

---

### **PHASE 1: Xóa Backdoor Authentication (LoginPage.tsx)**

**Thời gian ước tính:** 30 phút  
**Risk Level:** 🟢 LOW (file không được dùng trong production)  
**Dependencies:** None

#### Todo List:

- [ ] **1.1 Verify LoginPage.tsx không được sử dụng**
  - [ ] Search codebase: `import.*LoginPage|from.*LoginPage`
  - [ ] Check `src/router.tsx` - verify không có route đến LoginPage
  - [ ] Check `src/App.tsx` - verify không render LoginPage
  - [ ] **Expected:** Không có reference nào đến LoginPage

- [ ] **1.2 Backup file (optional, để reference)**
  - [ ] `git mv src/LoginPage.tsx src/LoginPage.tsx.backup`
  - [ ] Hoặc copy vào `docs/deprecated/LoginPage.tsx`

- [ ] **1.3 Xóa file**
  - [ ] `git rm src/LoginPage.tsx`
  - [ ] Verify file đã xóa

- [ ] **1.4 Verify app vẫn hoạt động**
  - [ ] Run `npm run dev`
  - [ ] Verify app mở được, không có import errors
  - [ ] Verify authentication flow vẫn hoạt động với AuthPage.tsx
  - [ ] **Expected:** App hoạt động bình thường, auth flow OK

- [ ] **1.5 Commit**
  - [ ] `git commit -m "security(critical): Remove LoginPage.tsx backdoor authentication"`
  - [ ] **Message:** "Removed legacy LoginPage.tsx with hardcoded credentials (adminXXX/abc@123). Authentication now only via AuthPage.tsx with proper server validation."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc restore từ backup
git checkout HEAD~1 -- src/LoginPage.tsx
```

#### Testing Checklist:
- [ ] App starts without errors
- [ ] No import errors in console
- [ ] AuthPage.tsx loads correctly
- [ ] Login flow works with AuthPage

---

### **PHASE 2: Fix XSS trong Error Handler (main.tsx)**

**Thời gian ước tính:** 45 phút  
**Risk Level:** 🟡 MEDIUM (chỉ ảnh hưởng error display)  
**Dependencies:** None

#### Todo List:

- [ ] **2.1 Backup current code**
  - [ ] Copy `src/main.tsx` → `src/main.tsx.backup`

- [ ] **2.2 Replace innerHTML với safe DOM manipulation**
  - [ ] Replace `document.body.innerHTML = ...` 
  - [ ] Use `document.createElement()` + `textContent`
  - [ ] **Code change:**
    ```typescript
    // OLD (vulnerable):
    document.body.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Error loading app</h1>
        <pre>${error.message}</pre>
      </div>
    `
    
    // NEW (safe):
    const errorDiv = document.createElement('div')
    errorDiv.style.cssText = 'padding: 20px; color: red; font-family: monospace;'
    
    const h1 = document.createElement('h1')
    h1.textContent = 'Error loading app'
    errorDiv.appendChild(h1)
    
    const pre = document.createElement('pre')
    pre.textContent = error instanceof Error ? error.message : String(error)
    errorDiv.appendChild(pre)
    
    const p = document.createElement('p')
    p.textContent = 'Check console for details.'
    errorDiv.appendChild(p)
    
    document.body.appendChild(errorDiv)
    ```

- [ ] **2.3 Test error display**
  - [ ] Intentionally break app (e.g., syntax error)
  - [ ] Verify error message displays correctly
  - [ ] Verify no HTML/script injection possible
  - [ ] **Test case:** Error message với `<script>alert('XSS')</script>` → should display as text, not execute

- [ ] **2.4 Verify normal flow**
  - [ ] Remove intentional error
  - [ ] Verify app loads normally
  - [ ] **Expected:** App works normally, error display safe

- [ ] **2.5 Commit**
  - [ ] `git commit -m "security(medium): Fix XSS vulnerability in error handler"`
  - [ ] **Message:** "Replace innerHTML with safe DOM manipulation using textContent to prevent XSS attacks in error messages."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc restore backup
cp src/main.tsx.backup src/main.tsx
```

#### Testing Checklist:
- [ ] Error messages display correctly
- [ ] XSS attempts are escaped (test với `<script>` tag)
- [ ] Normal app flow unaffected
- [ ] No console errors

---

### **PHASE 3: Enable Sandbox Mode**

**Thời gian ước tính:** 2-3 giờ  
**Risk Level:** 🟠 HIGH (có thể break features nếu không test kỹ)  
**Dependencies:** None (nhưng cần test toàn bộ app)

#### Todo List:

- [ ] **3.1 Backup current config**
  - [ ] Copy `electron/main.ts` → `electron/main.ts.backup`
  - [ ] Note current `sandbox: false` line number

- [ ] **3.2 Change sandbox to true**
  - [ ] Edit `electron/main.ts:657`
  - [ ] Change `sandbox: false` → `sandbox: true`
  - [ ] **Code change:**
    ```typescript
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // ✅ Changed from false
      backgroundThrottling: false,
      webSecurity: !isDev,
      allowRunningInsecureContent: isDev,
    }
    ```

- [ ] **3.3 Test basic app functionality**
  - [ ] Run `npm run dev`
  - [ ] Verify app opens
  - [ ] Verify window displays
  - [ ] Check console for errors
  - [ ] **Expected:** App opens, no critical errors

- [ ] **3.4 Test IPC communication**
  - [ ] Test: `window.api.license.getState()` → should work
  - [ ] Test: `window.api.auth.getState()` → should work
  - [ ] Test: `window.api.system.getSystemInfo()` → should work
  - [ ] **Expected:** All IPC calls work via preload

- [ ] **3.5 Test file operations**
  - [ ] Test: Select folder dialog → should work
  - [ ] Test: Scan music folders → should work
  - [ ] Test: Read file via IPC → should work
  - [ ] **Expected:** File operations work via IPC

- [ ] **3.6 Test video operations**
  - [ ] Test: Video probe → should work
  - [ ] Test: List videos in folder → should work
  - [ ] **Expected:** Video operations work

- [ ] **3.7 Test music operations**
  - [ ] Test: Scan music → should work
  - [ ] Test: Create playlist → should work
  - [ ] **Expected:** Music operations work

- [ ] **3.8 Test Autopilot (if time permits)**
  - [ ] Test: Autopilot config loads → should work
  - [ ] **Expected:** Autopilot UI works

- [ ] **3.9 Fix any broken features**
  - [ ] If any feature breaks, check if it's using Node.js APIs directly in renderer
  - [ ] Move to IPC if needed
  - [ ] **Note:** Most features should already work via IPC

- [ ] **3.10 Commit**
  - [ ] `git commit -m "security(critical): Enable sandbox mode for renderer process"`
  - [ ] **Message:** "Enable sandbox: true in BrowserWindow config to prevent XSS attacks from executing arbitrary code. All Node.js operations already go through IPC, so no breaking changes expected."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc manually change back:
# sandbox: true → sandbox: false
```

#### Testing Checklist:
- [ ] App opens successfully
- [ ] All IPC handlers work
- [ ] File dialogs work
- [ ] Music scanning works
- [ ] Video operations work
- [ ] No console errors related to sandbox
- [ ] All major features functional

---

### **PHASE 4: Remove Hardcoded Secrets**

**Thời gian ước tính:** 1-2 giờ  
**Risk Level:** 🟡 MEDIUM (cần test encryption/decryption)  
**Dependencies:** None

#### Todo List:

- [ ] **4.1 Backup current files**
  - [ ] Copy `backend/security/stringEncryption.ts` → `backend/security/stringEncryption.ts.backup`
  - [ ] Copy `electron/main.ts` → `electron/main.ts.backup`

- [ ] **4.2 Create environment variable helper**
  - [ ] Create `backend/utils/envConfig.ts`:
    ```typescript
    export function getEnvSecret(key: string, fallback?: string): string {
      const value = process.env[key]
      if (!value) {
        if (fallback) {
          console.warn(`[envConfig] ${key} not set, using fallback`)
          return fallback
        }
        throw new Error(`[envConfig] Required environment variable ${key} not set`)
      }
      return value
    }
    ```

- [ ] **4.3 Update stringEncryption.ts**
  - [ ] Remove hardcoded key: `'93MediaToolMixNhac2025StringEncryptionKey!@#'`
  - [ ] Use env var: `process.env.STRING_ENCRYPTION_KEY` hoặc derive từ machineId
  - [ ] **Code change:**
    ```typescript
    // OLD:
    const STRING_ENCRYPTION_KEY = crypto
      .createHash('sha256')
      .update('93MediaToolMixNhac2025StringEncryptionKey!@#')
      .digest()
    
    // NEW (Option 1 - Env var):
    const ENCRYPTION_KEY_SOURCE = process.env.STRING_ENCRYPTION_KEY || 
      (() => {
        console.warn('[Security] STRING_ENCRYPTION_KEY not set, using weak default')
        return 'CHANGE_ME_IN_PRODUCTION'
      })()
    const STRING_ENCRYPTION_KEY = crypto
      .createHash('sha256')
      .update(ENCRYPTION_KEY_SOURCE)
      .digest()
    
    // NEW (Option 2 - Derive from machineId, better):
    import { getMachineHash } from '../license/machineId'
    const getEncryptionKey = async () => {
      const machineId = await getMachineHash()
      const appSecret = process.env.APP_SECRET || 'CHANGE_ME_IN_PRODUCTION'
      return crypto.createHash('sha256')
        .update(machineId + appSecret)
        .digest()
    }
    // Cache key
    let cachedKey: Buffer | null = null
    const STRING_ENCRYPTION_KEY = await getEncryptionKey()
    ```

- [ ] **4.4 Update ENCRYPTED_STRINGS**
  - [ ] Remove hardcoded secrets: `INSTALLER_SECRET`, `INSTALLER_KEY`
  - [ ] Use env vars: `process.env.INSTALLER_SECRET`, `process.env.INSTALLER_KEY`
  - [ ] **Code change:**
    ```typescript
    const ENCRYPTED_STRINGS: Record<string, string> = {
      AUTH_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
      LICENSE_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
      // Remove hardcoded secrets, use env vars directly
    }
    
    // Add getter function:
    export function getInstallerSecret(): string {
      return process.env.INSTALLER_SECRET || 
        (() => {
          throw new Error('INSTALLER_SECRET environment variable not set')
        })()
    }
    ```

- [ ] **4.5 Update electron/main.ts fallback**
  - [ ] Remove fallback secrets (lines 114-115)
  - [ ] Throw error nếu env vars không set
  - [ ] **Code change:**
    ```typescript
    // OLD:
    try {
      AUTH_BASE = getDecryptedString('AUTH_BASE')
      INSTALLER_SECRET = getDecryptedString('INSTALLER_SECRET')
    } catch {
      AUTH_BASE = 'https://license-server.dungdong333.workers.dev'
      INSTALLER_SECRET = '2025LEONYG280722' // ❌ REMOVE
    }
    
    // NEW:
    try {
      AUTH_BASE = getDecryptedString('AUTH_BASE')
      INSTALLER_SECRET = process.env.INSTALLER_SECRET || 
        (() => {
          throw new Error('INSTALLER_SECRET environment variable required')
        })()
    } catch (err) {
      console.error('[main] Failed to initialize secrets:', err)
      throw err // Don't silently fallback
    }
    ```

- [ ] **4.6 Test encryption/decryption**
  - [ ] Test: `getDecryptedString('AUTH_BASE')` → should work
  - [ ] Test: `getDecryptedString('LICENSE_BASE')` → should work
  - [ ] **Expected:** Encryption/decryption still works

- [ ] **4.7 Test app startup**
  - [ ] Run `npm run dev`
  - [ ] Verify app opens
  - [ ] Verify auth flow works
  - [ ] **Expected:** App works, auth works

- [ ] **4.8 Document required env vars**
  - [ ] Create `.env.example`:
    ```
    # Required for production
    STRING_ENCRYPTION_KEY=your-secret-key-here
    APP_SECRET=your-app-secret-here
    INSTALLER_SECRET=your-installer-secret-here
    INSTALLER_KEY=your-installer-key-here
    ```
  - [ ] Update `README.md` hoặc `docs/SETUP.md` với instructions

- [ ] **4.9 Commit**
  - [ ] `git commit -m "security(high): Remove hardcoded secrets, use environment variables"`
  - [ ] **Message:** "Replace hardcoded encryption keys and secrets with environment variables. Add .env.example for documentation."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc restore backups
cp backend/security/stringEncryption.ts.backup backend/security/stringEncryption.ts
cp electron/main.ts.backup electron/main.ts
```

#### Testing Checklist:
- [ ] Encryption/decryption works
- [ ] App starts successfully
- [ ] Auth flow works
- [ ] No hardcoded secrets in code
- [ ] Environment variables documented

---

### **PHASE 5: Add Authorization Checks cho IPC Handlers**

**Thời gian ước tính:** 2-3 giờ  
**Risk Level:** 🟡 MEDIUM (có thể break nếu auth flow chưa hoàn chỉnh)  
**Dependencies:** Auth system phải hoạt động

#### Todo List:

- [ ] **5.1 Create authorization middleware**
  - [ ] Create `backend/security/ipcAuth.ts`:
    ```typescript
    import { getOrInitAuthState } from '../../electron/main' // hoặc export từ nơi phù hợp
    
    export async function requireAuth(): Promise<void> {
      const state = await getOrInitAuthState()
      if (state.status !== 'allowed') {
        throw new Error('Authentication required. Please login first.')
      }
    }
    
    export async function requireAuthOrThrow(event: Electron.IpcMainInvokeEvent): Promise<void> {
      try {
        await requireAuth()
      } catch (err) {
        console.error('[IPC] Unauthorized access attempt:', err)
        throw err
      }
    }
    ```

- [ ] **5.2 Identify handlers cần auth**
  - [ ] List tất cả IPC handlers trong `electron/main.ts`
  - [ ] Categorize:
    - **Public (no auth):** `auth:*`, `license:*`, `dialog:selectFolder`, `dialog:selectFile`
    - **Protected (require auth):** `music:*`, `video:*`, `system:*`, `autopilot:*`, `youtube:*`
  - [ ] **List handlers cần protect:**
    - `music:scanFolders`
    - `music:createPlaylists`
    - `music:exportPlaylist`
    - `video:cutSingleSimple`
    - `video:mergeSimple`
    - `video:finalExport`
    - `autopilot:start`
    - `youtube:downloadVideo`
    - `system:createDirectory`
    - ... (tất cả trừ auth/license/dialog)

- [ ] **5.3 Apply auth check cho từng handler (batch 1: Music)**
  - [ ] `music:scanFolders`:
    ```typescript
    ipcMain.handle('music:scanFolders', async (_event, payload) => {
      await requireAuth() // ✅ Add this
      // ... existing code
    })
    ```
  - [ ] `music:createPlaylists`
  - [ ] `music:exportPlaylist`
  - [ ] `music:getExportHistory`
  - [ ] Test sau mỗi handler

- [ ] **5.4 Apply auth check cho batch 2: Video**
  - [ ] `video:cutSingleSimple`
  - [ ] `video:mergeSimple`
  - [ ] `video:finalExport`
  - [ ] `video:listVideosInFolder`
  - [ ] Test sau mỗi handler

- [ ] **5.5 Apply auth check cho batch 3: System & Others**
  - [ ] `system:createDirectory`
  - [ ] `autopilot:start`
  - [ ] `youtube:downloadVideo`
  - [ ] Test sau mỗi handler

- [ ] **5.6 Test unauthorized access**
  - [ ] Set `authState.status = 'unregistered'` (temporarily)
  - [ ] Try: `window.api.music.scanFolders(...)` → should throw error
  - [ ] Try: `window.api.video.cutSingleSimple(...)` → should throw error
  - [ ] **Expected:** All protected handlers reject with "Authentication required"

- [ ] **5.7 Test authorized access**
  - [ ] Login với valid credentials
  - [ ] Verify `authState.status = 'allowed'`
  - [ ] Try: `window.api.music.scanFolders(...)` → should work
  - [ ] Try: `window.api.video.cutSingleSimple(...)` → should work
  - [ ] **Expected:** All protected handlers work when authenticated

- [ ] **5.8 Test public handlers**
  - [ ] Verify `auth:*` handlers work without auth
  - [ ] Verify `license:*` handlers work without auth
  - [ ] Verify `dialog:selectFolder` works without auth
  - [ ] **Expected:** Public handlers work regardless of auth status

- [ ] **5.9 Handle errors gracefully**
  - [ ] Update error messages để user-friendly
  - [ ] Return proper error format: `{ ok: false, error: 'Authentication required' }`
  - [ ] **Code:**
    ```typescript
    ipcMain.handle('music:scanFolders', async (_event, payload) => {
      try {
        await requireAuth()
        // ... existing code
      } catch (err) {
        if (err.message.includes('Authentication required')) {
          return { ok: false, error: 'Vui lòng đăng nhập để sử dụng tính năng này.' }
        }
        throw err
      }
    })
    ```

- [ ] **5.10 Commit**
  - [ ] `git commit -m "security(high): Add authorization checks to IPC handlers"`
  - [ ] **Message:** "Require authentication for all protected IPC handlers (music, video, system, autopilot, youtube). Public handlers (auth, license, dialog) remain accessible."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc remove requireAuth() calls manually
```

#### Testing Checklist:
- [ ] Unauthenticated users cannot access protected handlers
- [ ] Authenticated users can access protected handlers
- [ ] Public handlers work without auth
- [ ] Error messages are user-friendly
- [ ] All major features still work after login

---

### **PHASE 6: Implement Password Hashing (Server-side)**

**Thời gian ước tính:** 2-3 giờ  
**Risk Level:** 🟠 HIGH (ảnh hưởng authentication flow)  
**Dependencies:** Server code, database migration

#### Todo List:

- [ ] **6.1 Backup server code**
  - [ ] Copy `server/index.ts` → `server/index.ts.backup`
  - [ ] Backup database (nếu có production data)

- [ ] **6.2 Install bcryptjs**
  - [ ] `cd server && npm install bcryptjs && npm install --save-dev @types/bcryptjs`
  - [ ] Verify installation

- [ ] **6.3 Update register handler**
  - [ ] Edit `server/index.ts` - `handleRegister` function
  - [ ] Hash password trước khi insert:
    ```typescript
    import bcrypt from 'bcryptjs'
    
    // In handleRegister:
    const hashedPassword = await bcrypt.hash(mat_khau, 10) // 10 rounds
    
    await env.DB.prepare(
      'INSERT INTO registrations (tai_khoan, mat_khau, ma_may, ...) VALUES (?, ?, ...)'
    )
      .bind(tai_khoan, hashedPassword, ma_may, ...) // Use hashedPassword
      .run()
    ```

- [ ] **6.4 Update check handler**
  - [ ] Edit `server/index.ts` - `handleCheck` function
  - [ ] Compare với hash thay vì plaintext:
    ```typescript
    // OLD:
    if (row.mat_khau !== mat_khau) {
      return json({ allow: false, reason: 'Sai mật khẩu.' })
    }
    
    // NEW:
    const isValidPassword = await bcrypt.compare(mat_khau, row.mat_khau)
    if (!isValidPassword) {
      return json({ allow: false, reason: 'Sai mật khẩu.' })
    }
    ```

- [ ] **6.5 Create migration script**
  - [ ] Create `server/migrations/hash-existing-passwords.ts`:
    ```typescript
    // Script để hash existing plaintext passwords
    // Run once after deployment
    import bcrypt from 'bcryptjs'
    
    async function migratePasswords(env: Env) {
      const rows = await env.DB.prepare('SELECT id, mat_khau FROM registrations').all()
      
      for (const row of rows.rows) {
        // Check if already hashed (bcrypt hashes start with $2a$ or $2b$)
        if (row.mat_khau.startsWith('$2')) {
          console.log(`Password for ${row.id} already hashed, skipping`)
          continue
        }
        
        // Hash plaintext password
        const hashed = await bcrypt.hash(row.mat_khau, 10)
        await env.DB.prepare('UPDATE registrations SET mat_khau = ? WHERE id = ?')
          .bind(hashed, row.id)
          .run()
        
        console.log(`Hashed password for ${row.id}`)
      }
    }
    ```

- [ ] **6.6 Test register flow**
  - [ ] Test: Register new user → password should be hashed in DB
  - [ ] Verify: Check database, password should start with `$2a$` or `$2b$`
  - [ ] **Expected:** New registrations have hashed passwords

- [ ] **6.7 Test login flow với hashed password**
  - [ ] Test: Login với user mới (hashed password) → should work
  - [ ] **Expected:** Login works with hashed passwords

- [ ] **6.8 Test migration (nếu có existing users)**
  - [ ] Run migration script (nếu có production data)
  - [ ] Test: Login với existing user → should work
  - [ ] **Expected:** Existing users can still login after migration

- [ ] **6.9 Test backward compatibility**
  - [ ] Test: Login với plaintext password (nếu chưa migrate) → should fail gracefully
  - [ ] **Expected:** Old plaintext passwords rejected, user needs to reset

- [ ] **6.10 Update documentation**
  - [ ] Update `server/README.md` với migration instructions
  - [ ] Document: "After deploying, run migration script to hash existing passwords"

- [ ] **6.11 Commit**
  - [ ] `git commit -m "security(critical): Implement password hashing with bcrypt"`
  - [ ] **Message:** "Hash passwords with bcrypt (10 rounds) on registration and compare hashes on login. Add migration script for existing plaintext passwords."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc restore backup
cp server/index.ts.backup server/index.ts
# Revert database changes (restore from backup)
```

#### Testing Checklist:
- [ ] New registrations have hashed passwords
- [ ] Login works with hashed passwords
- [ ] Migration script works (if applicable)
- [ ] Existing users can login after migration
- [ ] Plaintext passwords rejected

---

### **PHASE 7: Path Sanitization cho Command Injection Prevention**

**Thời gian ước tính:** 3-4 giờ  
**Risk Level:** 🟡 MEDIUM (cần test tất cả file operations)  
**Dependencies:** None

#### Todo List:

- [ ] **7.1 Create path sanitizer utility**
  - [ ] Create `backend/utils/pathSanitizer.ts`:
    ```typescript
    import path from 'node:path'
    import fs from 'node:fs'
    
    export interface SanitizeOptions {
      allowRelative?: boolean
      allowedExtensions?: string[]
    }
    
    export function sanitizePathForCommand(
      filePath: string,
      options: SanitizeOptions = {}
    ): string {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid path: path must be a non-empty string')
      }
      
      // 1. Normalize path
      let normalized = path.normalize(filePath)
      
      // 2. Resolve để loại bỏ ../
      const resolved = path.resolve(normalized)
      
      // 3. Validate không có dangerous patterns
      const dangerousPatterns = [
        /\.\./,           // Path traversal
        /\|/,             // Pipe
        /;/,              // Semicolon
        /&/,              // Background process
        /\$/,             // Variable expansion
        /`/,              // Command substitution
        /\(/,             // Command substitution
        /\)/,             // Command substitution
        /\n/,             // Newline
        /\r/,             // Carriage return
        /\0/,             // Null byte
      ]
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(normalized)) {
          throw new Error(`Invalid path: dangerous pattern detected in ${filePath}`)
        }
      }
      
      // 4. Validate file exists (optional, for read operations)
      // if (!fs.existsSync(resolved)) {
      //   throw new Error(`Path does not exist: ${filePath}`)
      // }
      
      // 5. Return normalized path
      return normalized
    }
    
    export function escapePathForFfmpeg(filePath: string): string {
      const sanitized = sanitizePathForCommand(filePath)
      // Escape single quotes for FFmpeg
      return sanitized.replace(/'/g, "'\\''")
    }
    ```

- [ ] **7.2 Add unit tests**
  - [ ] Create `backend/utils/__tests__/pathSanitizer.test.ts`
  - [ ] Test cases:
    - [ ] Valid paths → should pass
    - [ ] Path với `..` → should throw
    - [ ] Path với `|` → should throw
    - [ ] Path với `;` → should throw
    - [ ] Path với `&` → should throw
    - [ ] Unicode paths → should work
    - [ ] Windows long paths → should work
  - [ ] Run tests: `npm test pathSanitizer`

- [ ] **7.3 Apply to finalExport.ts (batch 1)**
  - [ ] Find all `spawn(ffmpeg, ...)` calls
  - [ ] Apply `sanitizePathForCommand()` cho tất cả paths trong args
  - [ ] **Example:**
    ```typescript
    // OLD:
    const args = ['-i', audioPath, ...]
    spawn(ffmpeg, args, {...})
    
    // NEW:
    const safeAudioPath = sanitizePathForCommand(audioPath)
    const args = ['-i', safeAudioPath, ...]
    spawn(ffmpeg, args, {...})
    ```
  - [ ] Test: Export video → should work

- [ ] **7.4 Apply to whisperTranscribe.ts**
  - [ ] Apply sanitization cho audio paths
  - [ ] Test: Whisper transcription → should work

- [ ] **7.5 Apply to youtubeDownloader.ts**
  - [ ] Apply sanitization cho download paths
  - [ ] Test: YouTube download → should work

- [ ] **7.6 Apply to cutSingleSimple.ts**
  - [ ] Apply sanitization cho input/output paths
  - [ ] Test: Cut video → should work

- [ ] **7.7 Apply to mergeVideosSimple.ts**
  - [ ] Apply sanitization cho video paths
  - [ ] Test: Merge videos → should work

- [ ] **7.8 Test malicious paths**
  - [ ] Test: Path với `../etc/passwd` → should reject
  - [ ] Test: Path với `file|rm -rf /` → should reject
  - [ ] Test: Path với `file;command` → should reject
  - [ ] **Expected:** All malicious paths rejected

- [ ] **7.9 Test legitimate paths**
  - [ ] Test: Normal file paths → should work
  - [ ] Test: Paths với spaces → should work
  - [ ] Test: Unicode paths → should work
  - [ ] **Expected:** All legitimate paths work

- [ ] **7.10 Commit**
  - [ ] `git commit -m "security(high): Add path sanitization to prevent command injection"`
  - [ ] **Message:** "Sanitize all user-provided paths before using in spawn() commands. Reject dangerous patterns (.., |, ;, &, $, `, newlines)."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc remove sanitizePathForCommand() calls
```

#### Testing Checklist:
- [ ] All file operations work with normal paths
- [ ] Malicious paths are rejected
- [ ] Unicode paths work
- [ ] Windows long paths work
- [ ] No false positives (legitimate paths rejected)

---

### **PHASE 8: Add CSP Headers**

**Thời gian ước tính:** 1 giờ  
**Risk Level:** 🟢 LOW (chỉ ảnh hưởng HTML rendering)  
**Dependencies:** None

#### Todo List:

- [ ] **8.1 Add CSP meta tag trong index.html**
  - [ ] Edit `index.html`:
    ```html
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Security-Policy" 
            content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;">
      <title>93 Media - Tool Mix Nhạc</title>
    </head>
    ```

- [ ] **8.2 Add CSP header trong server dashboard**
  - [ ] Edit `server/index.ts` - `serveDashboard()` function:
    ```typescript
    return new Response(dashboardHTML, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
      }
    })
    ```

- [ ] **8.3 Test app với CSP**
  - [ ] Run `npm run dev`
  - [ ] Verify app loads
  - [ ] Check console for CSP violations
  - [ ] **Expected:** No CSP violations, app works

- [ ] **8.4 Test dashboard với CSP**
  - [ ] Open dashboard URL
  - [ ] Verify dashboard loads
  - [ ] Verify Chart.js loads from CDN
  - [ ] **Expected:** Dashboard works, Chart.js loads

- [ ] **8.5 Fix any CSP violations**
  - [ ] Nếu có violations, adjust CSP policy
  - [ ] **Note:** `'unsafe-inline'` cho scripts là cần thiết cho Vite dev mode, nhưng nên remove trong production nếu possible

- [ ] **8.6 Commit**
  - [ ] `git commit -m "security(medium): Add Content Security Policy headers"`
  - [ ] **Message:** "Add CSP meta tag in index.html and CSP header in server dashboard response to prevent XSS attacks."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc remove CSP meta tag/header
```

#### Testing Checklist:
- [ ] App loads with CSP
- [ ] No CSP violations in console
- [ ] Dashboard loads with CSP
- [ ] External resources (CDN) load correctly

---

### **PHASE 9: Add Rate Limiting cho IPC**

**Thời gian ước tính:** 2 giờ  
**Risk Level:** 🟢 LOW (chỉ ảnh hưởng spam requests)  
**Dependencies:** `backend/security/rateLimiter.ts` (đã có)

#### Todo List:

- [ ] **9.1 Verify rateLimiter exists**
  - [ ] Check `backend/security/rateLimiter.ts` exists
  - [ ] Review implementation
  - [ ] **Expected:** Rate limiter exists và hoạt động

- [ ] **9.2 Create IPC rate limiter wrapper**
  - [ ] Create `backend/security/ipcRateLimiter.ts`:
    ```typescript
    import { rateLimiter } from './rateLimiter'
    
    export function requireRateLimit(
      clientId: string,
      action: string,
      options: { maxRequests: number; windowMs: number } = { maxRequests: 10, windowMs: 60000 }
    ): void {
      if (!rateLimiter.allow(clientId, action, options)) {
        throw new Error(`Rate limit exceeded for ${action}. Please wait before retrying.`)
      }
    }
    ```

- [ ] **9.3 Apply to critical handlers (batch 1: Heavy operations)**
  - [ ] `music:scanFolders` - maxRequests: 5, windowMs: 60000
  - [ ] `video:finalExport` - maxRequests: 3, windowMs: 60000
  - [ ] `autopilot:start` - maxRequests: 2, windowMs: 60000
  - [ ] **Code:**
    ```typescript
    ipcMain.handle('music:scanFolders', async (event, payload) => {
      await requireAuth()
      requireRateLimit(event.sender.id.toString(), 'music:scanFolders', {
        maxRequests: 5,
        windowMs: 60000
      })
      // ... existing code
    })
    ```

- [ ] **9.4 Apply to batch 2: Medium operations**
  - [ ] `music:exportPlaylist` - maxRequests: 10, windowMs: 60000
  - [ ] `video:cutSingleSimple` - maxRequests: 10, windowMs: 60000
  - [ ] `video:mergeSimple` - maxRequests: 10, windowMs: 60000

- [ ] **9.5 Test rate limiting**
  - [ ] Test: Spam requests → should throttle after limit
  - [ ] Test: Wait for window → should allow again
  - [ ] **Expected:** Rate limiting works

- [ ] **9.6 Test normal usage**
  - [ ] Test: Normal usage → should not hit limits
  - [ ] **Expected:** Normal users not affected

- [ ] **9.7 Handle rate limit errors gracefully**
  - [ ] Return user-friendly error: "Quá nhiều yêu cầu. Vui lòng đợi một chút."
  - [ ] **Code:**
    ```typescript
    try {
      requireRateLimit(...)
    } catch (err) {
      if (err.message.includes('Rate limit')) {
        return { ok: false, error: 'Quá nhiều yêu cầu. Vui lòng đợi một chút.' }
      }
      throw err
    }
    ```

- [ ] **9.8 Commit**
  - [ ] `git commit -m "security(medium): Add rate limiting to IPC handlers"`
  - [ ] **Message:** "Apply rate limiting to prevent DoS attacks. Heavy operations (scan, export) have lower limits than light operations."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc remove requireRateLimit() calls
```

#### Testing Checklist:
- [ ] Rate limiting works for spam requests
- [ ] Normal usage not affected
- [ ] Error messages are user-friendly
- [ ] Limits are appropriate for each operation type

---

### **PHASE 10: Input Validation với Zod**

**Thời gian ước tính:** 4-5 giờ  
**Risk Level:** 🟡 MEDIUM (có thể break nếu validation quá strict)  
**Dependencies:** Install zod

#### Todo List:

- [ ] **10.1 Install Zod**
  - [ ] `npm install zod`
  - [ ] Verify installation

- [ ] **10.2 Create IPC schemas**
  - [ ] Create `shared/ipcSchemas.ts`:
    ```typescript
    import { z } from 'zod'
    
    export const MusicScanFoldersSchema = z.object({
      priorityFolder: z.string().nullable(),
      randomFolder: z.string().nullable(),
    })
    
    export const VideoCutSingleSchema = z.object({
      inputPath: z.string().min(1),
      outputDir: z.string().min(1),
      segmentLengthSec: z.number().positive(),
      // ... other fields
    })
    
    // ... more schemas
    ```

- [ ] **10.3 Create validation helper**
  - [ ] Create `backend/utils/validatePayload.ts`:
    ```typescript
    import { z } from 'zod'
    import { ZodError } from 'zod'
    
    export function validatePayload<T>(
      schema: z.ZodSchema<T>,
      payload: unknown
    ): T {
      try {
        return schema.parse(payload)
      } catch (err) {
        if (err instanceof ZodError) {
          const errors = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
          throw new Error(`Invalid payload: ${errors}`)
        }
        throw err
      }
    }
    ```

- [ ] **10.4 Apply validation cho handlers (batch 1: Music)**
  - [ ] `music:scanFolders`
  - [ ] `music:createPlaylists`
  - [ ] `music:exportPlaylist`
  - [ ] **Code:**
    ```typescript
    ipcMain.handle('music:scanFolders', async (event, payload) => {
      await requireAuth()
      const validated = validatePayload(MusicScanFoldersSchema, payload)
      // Use validated instead of payload
      // ...
    })
    ```

- [ ] **10.5 Apply validation cho batch 2: Video**
  - [ ] `video:cutSingleSimple`
  - [ ] `video:mergeSimple`
  - [ ] `video:finalExport`

- [ ] **10.6 Apply validation cho batch 3: Others**
  - [ ] `autopilot:start`
  - [ ] `youtube:downloadVideo`

- [ ] **10.7 Test validation**
  - [ ] Test: Invalid payload → should reject với clear error
  - [ ] Test: Valid payload → should work
  - [ ] **Expected:** Validation works, errors are clear

- [ ] **10.8 Test existing functionality**
  - [ ] Test: All features still work
  - [ ] **Expected:** No breaking changes

- [ ] **10.9 Commit**
  - [ ] `git commit -m "security(medium): Add Zod validation for IPC payloads"`
  - [ ] **Message:** "Validate all IPC handler payloads with Zod schemas to prevent invalid data and potential injection attacks."

#### Rollback Plan:
```bash
git revert <commit-hash>
# Hoặc remove validatePayload() calls
```

#### Testing Checklist:
- [ ] Invalid payloads are rejected
- [ ] Valid payloads work
- [ ] Error messages are clear
- [ ] All features still work

---

## 5. Tổng kết & Timeline

### Ưu tiên thực hiện:

**Week 1 (Critical fixes):**
- ✅ Phase 1: Xóa LoginPage.tsx (30 phút)
- ✅ Phase 2: Fix XSS (45 phút)
- ✅ Phase 3: Enable Sandbox (2-3 giờ)
- ✅ Phase 4: Remove Hardcoded Secrets (1-2 giờ)
- ✅ Phase 5: Add Authorization Checks (2-3 giờ)
- ✅ Phase 6: Password Hashing (2-3 giờ)

**Week 2 (High priority):**
- ✅ Phase 7: Path Sanitization (3-4 giờ)
- ✅ Phase 8: CSP Headers (1 giờ)
- ✅ Phase 9: Rate Limiting (2 giờ)

**Week 3 (Medium priority):**
- ✅ Phase 10: Input Validation (4-5 giờ)

### Tổng thời gian ước tính: **20-25 giờ**

### Testing Strategy:
- Mỗi phase có testing checklist riêng
- Test sau mỗi phase trước khi chuyển phase tiếp theo
- Full regression test sau mỗi 3 phases
- Production deployment chỉ sau khi tất cả phases hoàn thành

### Risk Mitigation:
- Mỗi phase có rollback plan
- Commit riêng biệt cho mỗi phase
- Test thoroughly trước khi commit
- Code review cho mỗi phase


#### Task 1.1: Xóa LoginPage.tsx (Legacy Backdoor)
- **File:** `src/LoginPage.tsx`
- **Action:** Xóa file hoàn toàn
- **Verify:** App vẫn hoạt động với AuthPage.tsx
- **Risk:** Low (file không được dùng trong production)

#### Task 1.2: Implement Password Hashing trong Server
- **Files:** 
  - `server/index.ts` (register + check handlers)
  - `server/database-schema.sql` (migration script)
- **Action:**
  1. Install `bcryptjs` hoặc `argon2`
  2. Hash password khi register
  3. Compare với hash khi check
  4. Migration script để hash existing passwords
- **Testing:** Test register + login với hashed passwords

#### Task 1.3: Remove Hardcoded Secrets
- **Files:**
  - `backend/security/stringEncryption.ts`
  - `electron/main.ts` (fallback secrets)
- **Action:**
  1. Move secrets sang environment variables
  2. Derive encryption key từ machineId + env var
  3. Xóa fallback secrets trong main.ts
  4. Document required env vars
- **Testing:** Verify encryption/decryption vẫn hoạt động

#### Task 1.4: Verify Sandbox Enabled
- **File:** `electron/main.ts:657`
- **Action:** 
  1. Verify `sandbox: true` (theo docs đã fix)
  2. Nếu vẫn false → change to true
  3. Test tất cả features vẫn hoạt động
- **Testing:** Full regression test

#### Task 1.5: Fix XSS trong main.tsx
- **File:** `src/main.tsx:27`
- **Action:** Replace `innerHTML` với `textContent` + `createElement`
- **Testing:** Test error display vẫn hiển thị đúng

#### Task 1.6: Add Authorization Check cho IPC Handlers
- **File:** `electron/main.ts`
- **Action:**
  1. Tạo `requireAuth()` helper
  2. Apply cho tất cả handlers (trừ auth:*, license:*, dialog:*)
  3. Test unauthorized access bị reject
- **Testing:** 
  - Test với authState.status !== 'allowed' → should throw
  - Test với status === 'allowed' → should work

**Checklist Giai đoạn 1:**
- [ ] LoginPage.tsx đã xóa
- [ ] Password hashing implemented + tested
- [ ] Hardcoded secrets removed
- [ ] Sandbox = true verified
- [ ] XSS fix applied
- [ ] Authorization checks added + tested

---

### **Giai đoạn 2: Củng cố Kiến trúc (Hardening) - Ưu tiên HIGH**

**Thời gian ước tính:** 8-12 giờ  
**Mục tiêu:** Cải thiện security architecture

#### Task 2.1: Implement Path Sanitization Layer
- **File mới:** `backend/utils/pathSanitizer.ts`
- **Action:**
  1. Tạo `sanitizePathForCommand()` function
  2. Validate: no `..`, no pipes, no semicolons
  3. Apply cho TẤT CẢ spawn() calls
- **Files cần update:**
  - `backend/video/finalExport.ts`
  - `backend/audio/whisperTranscribe.ts`
  - `backend/youtube/youtubeDownloader.ts`
  - `backend/video/cutSingleSimple.ts`
  - `backend/video/mergeVideosSimple.ts`
- **Testing:** Test với malicious paths → should reject

#### Task 2.2: Add CSP Headers
- **Files:**
  - `index.html`
  - `server/index.ts` (dashboard)
- **Action:**
  1. Add CSP meta tag trong HTML
  2. Add CSP header trong server responses
  3. Test inline scripts vẫn hoạt động (nếu cần)
- **Testing:** Verify CSP không block legitimate resources

#### Task 2.3: Implement Rate Limiting cho IPC
- **Files:**
  - `backend/security/rateLimiter.ts` (đã có, cần verify)
  - `electron/main.ts` (apply cho handlers)
- **Action:**
  1. Verify rateLimiter implementation
  2. Apply cho critical handlers (scan, export, video operations)
  3. Config limits hợp lý (10 req/min cho heavy operations)
- **Testing:** Test spam requests → should throttle

#### Task 2.4: Centralized Error Handling
- **File mới:** `backend/utils/errorHandler.ts`
- **Action:**
  1. Tạo `sanitizeError()` function
  2. Remove stack traces, internal paths từ error messages
  3. Apply cho tất cả IPC error responses
- **Testing:** Verify errors không leak sensitive info

#### Task 2.5: Input Validation với Zod
- **File mới:** `shared/ipcSchemas.ts`
- **Action:**
  1. Install `zod`
  2. Define schemas cho tất cả IPC payloads
  3. Validate trong IPC handlers
- **Files cần update:** Tất cả `ipcMain.handle()` trong `electron/main.ts`
- **Testing:** Test invalid payloads → should reject với clear error

**Checklist Giai đoạn 2:**
- [ ] Path sanitization implemented + tested
- [ ] CSP headers added
- [ ] Rate limiting applied
- [ ] Error sanitization implemented
- [ ] Zod validation added

---

### **Giai đoạn 3: Dọn dẹp (Cleanup) - Ưu tiên MEDIUM**

**Thời gian ước tính:** 4-6 giờ  
**Mục tiêu:** Code quality, maintainability

#### Task 3.1: Remove Dead Code
- **Files:**
  - `src/LoginPage.tsx` (nếu chưa xóa ở Giai đoạn 1)
  - Deprecated IPC handlers (video:cutSingle, video:cutBatch - đã có Simple versions)
- **Action:** Xóa hoặc comment với `@deprecated`

#### Task 3.2: Standardize Error Types
- **Action:**
  1. Define error types trong `shared/errors.ts`
  2. Replace `any` error types với typed errors
  3. Consistent error format: `{ code: string, message: string, details?: any }`

#### Task 3.3: Security Audit Logging
- **File mới:** `backend/security/auditLogger.ts`
- **Action:**
  1. Log tất cả security events (failed auth, rate limit, path validation failures)
  2. Send to security monitoring (đã có `securityMonitoring.ts`)
- **Testing:** Verify logs được ghi đúng

#### Task 3.4: Code Style & Type Safety
- **Action:**
  1. Replace `any` types với proper types
  2. Add JSDoc comments cho security-critical functions
  3. Enable strict TypeScript checks
- **Files:** Tất cả files có `any` types

**Checklist Giai đoạn 3:**
- [ ] Dead code removed
- [ ] Error types standardized
- [ ] Audit logging implemented
- [ ] Type safety improved

---

## 5. Ưu tiên Thực hiện

### Immediate (Hôm nay):
1. ✅ Xóa LoginPage.tsx
2. ✅ Implement password hashing
3. ✅ Remove hardcoded secrets
4. ✅ Verify sandbox = true

### This Week:
5. Add authorization checks
6. Fix XSS trong main.tsx
7. Path sanitization
8. CSP headers

### Next Sprint:
9. Rate limiting
10. Input validation (Zod)
11. Error sanitization
12. Audit logging

---

## 6. Metrics & Verification

### Security Metrics cần track:
- Số lần failed authentication attempts
- Số lần rate limit triggered
- Số lần path validation failed
- Số lần unauthorized IPC calls

### Testing Checklist:
- [ ] Tất cả Critical vulnerabilities đã fix
- [ ] Penetration test với malicious inputs
- [ ] Verify không có hardcoded secrets trong build
- [ ] Verify CSP không block legitimate resources
- [ ] Verify authorization checks hoạt động

---

**Kết luận:** Codebase có nhiều lỗ hổng bảo mật nghiêm trọng, đặc biệt là authentication bypass và hardcoded secrets. Cần ưu tiên fix Critical issues trước khi release version 3.6.0.

**Risk Level:** 🔴 **HIGH** - Không nên deploy production cho đến khi fix Critical issues.
