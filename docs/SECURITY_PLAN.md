## Implementation Status (2026-03-28)

| Security Control | Status | Notes |
|-----------------|--------|-------|
| AES-256-GCM encrypted auth state | ✅ DONE | encryptedAuthStore.ts |
| PBKDF2 key derivation | ✅ DONE (⚠️ weak) | 10k iterations — needs 300k+ |
| Machine-ID binding | ✅ DONE | Mismatch → null return |
| HMAC integrity check | ✅ DONE | Before decrypt |
| Anti-debug (renderer) | ✅ DONE | src/security/antiDebug.ts |
| Anti-debug (main) | ✅ DONE | backend/security/antiDebug.ts |
| CSP headers | ✅ DONE | blob: data: in media-src |
| Tamper detection | 🔴 STUB | Hash checks return true always |
| API request signing | ⚠️ DEFINED | Module exists, NOT wired to HTTP calls |
| IPC rate limiting | ⚠️ DEFINED | Module exists, NOT applied to handlers |
| Hardcoded secrets | ❌ RISK | INSTALLER_KEY visible in stringEncryption.ts |
| contextIsolation | ✅ DONE | All BrowserWindows |
| sandbox | ⚠️ OFF | sandbox: false — should be true |
| Environment detection | ✅ DONE | VM/sandbox check on startup |
| Security monitoring | ✅ DONE | Event reporting to remote |

---

# Kế Hoạch Nâng Cấp Bảo Mật - 93 Media Tool Mix Nhạc

## 📋 Tổng Quan

Tài liệu này trình bày kế hoạch nâng cấp bảo mật toàn diện để bảo vệ tool khỏi các cuộc tấn công crack, reverse engineering, và tampering.

---

## 🔍 Phân Tích Điểm Yếu Hiện Tại

### 1. **Lưu Trữ Dữ Liệu Nhạy Cảm (CRITICAL)**
- ❌ **Password lưu plaintext** trong `authState.json`
- ❌ **Auth state không được mã hóa** - dễ đọc và sửa
- ❌ **MachineId có thể bị fake** nếu user biết cách
- ❌ **Không có integrity check** - không phát hiện được file bị sửa

### 2. **Bảo Mật Code (HIGH)**
- ❌ **Không có code obfuscation** - dễ reverse engineer
- ❌ **Source code dễ đọc** - TypeScript/JavaScript không được minify/obfuscate
- ❌ **Không có anti-debugging** - dễ debug và crack
- ❌ **Không có tamper detection** - không phát hiện khi code bị sửa

### 3. **Bảo Mật Giao Tiếp (MEDIUM)**
- ⚠️ **API calls không có signing** - có thể bị intercept và replay
- ⚠️ **Không có rate limiting** - có thể bị brute force
- ⚠️ **Không có request timestamp** - dễ bị replay attack

### 4. **Bảo Mật Runtime (MEDIUM)**
- ⚠️ **Không có process protection** - dễ bị attach debugger
- ⚠️ **Không có environment detection** - không phát hiện VM/sandbox
- ⚠️ **Không có license check định kỳ** - chỉ check khi start

---

## 🛡️ Kế Hoạch Nâng Cấp Bảo Mật

### **GIAI ĐOẠN 1: Bảo Mật Dữ Liệu Nhạy Cảm (Ưu Tiên Cao)**

#### 1.1. Mã Hóa Auth State
**Mục tiêu:** Mã hóa toàn bộ `authState.json` để không thể đọc/sửa dễ dàng.

**Giải pháp:**
- Sử dụng **AES-256-GCM** với key derivation từ machineId
- Key được derive từ: `PBKDF2(machineId + salt, iterations=10000)`
- Thêm **HMAC-SHA256** để integrity check
- Salt được lưu riêng hoặc embed trong code

**Implementation:**
```typescript
// backend/auth/encryptedAuthStore.ts
- encryptAuthState(state: StoredAuthState): string
- decryptAuthState(encrypted: string): StoredAuthState | null
- verifyIntegrity(data: string, hmac: string): boolean
```

**Lợi ích:**
- Password không còn plaintext
- File bị sửa sẽ không decrypt được
- MachineId thay đổi → key thay đổi → không decrypt được

---

#### 1.2. Cải Thiện MachineId Generation
**Mục tiêu:** Làm cho MachineId khó fake hơn.

**Giải pháp:**
- Kết hợp nhiều hardware identifiers:
  - CPU ID (wmic cpu get ProcessorId)
  - Motherboard Serial (wmic baseboard get serialnumber)
  - Disk Serial (wmic diskdrive get serialnumber)
  - MAC Address (primary network adapter)
  - Windows Installation ID
- Hash tất cả với SHA-256
- Thêm **hardware fingerprint** phức tạp hơn

**Implementation:**
```typescript
// backend/license/machineId.ts
- getAdvancedMachineId(): Promise<string>
  - Collect: CPU ID, MB Serial, Disk Serial, MAC, Windows ID
  - Combine và hash với SHA-256
  - Thêm salt từ app version
```

**Lợi ích:**
- Khó fake hơn nhiều
- Thay đổi hardware → MachineId thay đổi → yêu cầu re-auth

---

#### 1.3. Integrity Check cho Auth State
**Mục tiêu:** Phát hiện khi file bị sửa.

**Giải pháp:**
- Tính HMAC-SHA256 của toàn bộ auth state
- Lưu HMAC riêng hoặc embed trong encrypted data
- Mỗi lần đọc, verify HMAC trước khi decrypt

**Implementation:**
```typescript
// Thêm vào encryptedAuthStore.ts
- calculateHMAC(data: string, key: string): string
- verifyHMAC(data: string, hmac: string, key: string): boolean
```

---

### **GIAI ĐOẠN 2: Bảo Mật Code (Ưu Tiên Trung Bình)**

#### 2.1. Code Obfuscation
**Mục tiêu:** Làm cho code khó đọc và reverse engineer.

**Giải pháp:**
- **JavaScript Obfuscator** cho renderer process
- **Webpack/Uglify** với mangle và compress
- **String encryption** cho các string nhạy cảm (API URLs, keys)
- **Control flow flattening** cho các hàm quan trọng

**Tools:**
- `javascript-obfuscator` cho frontend
- `webpack-obfuscator` plugin
- Custom string encryption cho backend

**Implementation:**
```typescript
// build.config.js
- Thêm obfuscation vào webpack config
- Encrypt strings: API URLs, error messages
- Obfuscate function names
```

---

#### 2.2. Anti-Debugging
**Mục tiêu:** Ngăn chặn debugger attach và reverse engineering.

**Giải pháp:**
- **DevTools detection** - phát hiện khi DevTools mở
- **Debugger statement** - làm chậm debugger
- **Process check** - phát hiện debugger process (OllyDbg, x64dbg, etc.)
- **Memory protection** - detect memory read/write

**Implementation:**
```typescript
// backend/security/antiDebug.ts
- detectDevTools(): boolean
- detectDebugger(): boolean
- detectVM(): boolean
- protectMemory(): void
```

**Lưu ý:**
- Không quá aggressive để tránh false positive
- Chỉ áp dụng cho các hàm quan trọng (auth, license check)

---

#### 2.3. Tamper Detection
**Mục tiêu:** Phát hiện khi code/executable bị sửa.

**Giải pháp:**
- **File integrity check** - tính hash của main executable
- **Code signature verification** - verify digital signature
- **Self-checksum** - verify checksum của chính nó
- **Critical function protection** - detect khi hàm bị hook

**Implementation:**
```typescript
// backend/security/tamperDetection.ts
- verifyExecutableIntegrity(): boolean
- verifyCodeSignature(): boolean
- detectFunctionHooking(): boolean
```

---

### **GIAI ĐOẠN 3: Bảo Mật Giao Tiếp (Ưu Tiên Thấp)**

#### 3.1. API Request Signing
**Mục tiêu:** Ngăn chặn replay attack và request tampering.

**Giải pháp:**
- Mỗi request kèm theo:
  - **Timestamp** (chống replay)
  - **Nonce** (chống replay)
  - **HMAC signature** (chống tampering)
- Server verify signature trước khi xử lý

**Implementation:**
```typescript
// backend/auth/apiSigning.ts
- signRequest(payload: any, secret: string): string
- verifyRequest(payload: any, signature: string, secret: string): boolean
```

---

#### 3.2. Rate Limiting
**Mục tiêu:** Ngăn chặn brute force attack.

**Giải pháp:**
- Client-side: giới hạn số lần thử đăng nhập
- Server-side: rate limiting (đã có trên server)
- Exponential backoff khi thất bại

---

### **GIAI ĐOẠN 4: Bảo Mật Runtime (Ưu Tiên Thấp)**

#### 4.1. License Check Định Kỳ
**Mục tiêu:** Kiểm tra license thường xuyên, không chỉ khi start.

**Giải pháp:**
- Check license mỗi 30 phút
- Check khi user thực hiện action quan trọng
- Silent check (không hiển thị UI nếu OK)

**Implementation:**
```typescript
// electron/main.ts
- setInterval(() => checkLicense(), 30 * 60 * 1000)
- Check trước khi export, merge, etc.
```

---

#### 4.2. Environment Detection
**Mục tiêu:** Phát hiện VM/sandbox và từ chối chạy.

**Giải pháp:**
- Detect VM: check registry keys, processes, hardware
- Detect sandbox: check processes, network, filesystem
- Nếu detect → log và có thể từ chối

**Implementation:**
```typescript
// backend/security/environmentDetection.ts
- detectVM(): boolean
- detectSandbox(): boolean
- isSafeEnvironment(): boolean
```

---

## 📊 Thứ Tự Ưu Tiên Thực Hiện

### **Phase 1 (Ngay lập tức - 1-2 tuần):**
1. ✅ Mã hóa Auth State (AES-256-GCM)
2. ✅ Integrity Check (HMAC)
3. ✅ Cải thiện MachineId Generation

### **Phase 2 (Sau Phase 1 - 2-3 tuần):**
4. ✅ Code Obfuscation
5. ✅ Anti-Debugging cơ bản
6. ✅ Tamper Detection cơ bản

### **Phase 3 (Sau Phase 2 - 1-2 tuần):**
7. ✅ API Request Signing
8. ✅ License Check Định Kỳ

### **Phase 4 (Tùy chọn - sau khi test):**
9. ⚠️ Environment Detection (có thể false positive)
10. ⚠️ Advanced Anti-Debugging

---

## 🎯 Kết Quả Mong Đợi

Sau khi triển khai:

1. **Password không còn plaintext** → Khó crack hơn 90%
2. **Code obfuscated** → Khó reverse engineer hơn 70%
3. **Tamper detection** → Phát hiện sửa đổi ngay lập tức
4. **Anti-debugging** → Làm chậm quá trình crack
5. **License check định kỳ** → Khó bypass hơn

**Tổng thể:** Tăng độ khó crack từ **2/10** lên **7-8/10**

---

## ⚠️ Lưu Ý Quan Trọng

1. **Không có bảo mật 100%** - Mục tiêu là làm cho việc crack **khó và tốn thời gian** hơn
2. **Balance giữa bảo mật và UX** - Không làm app chậm hoặc khó dùng
3. **Test kỹ** - Đảm bảo không có false positive
4. **Backup plan** - Có cơ chế recovery nếu có vấn đề

---

## 📝 Checklist Triển Khai

### Phase 1:
- [ ] Tạo `encryptedAuthStore.ts`
- [ ] Implement AES-256-GCM encryption
- [ ] Implement HMAC integrity check
- [ ] Migrate existing auth state
- [ ] Test encryption/decryption
- [ ] Cải thiện `getMachineHash()`
- [ ] Test machineId generation

### Phase 2:
- [ ] Setup JavaScript obfuscator
- [ ] Obfuscate frontend code
- [ ] Encrypt sensitive strings
- [ ] Implement anti-debugging
- [ ] Implement tamper detection
- [ ] Test không có false positive

### Phase 3:
- [ ] Implement API signing
- [ ] Update server để verify signature
- [ ] Implement periodic license check
- [ ] Test performance impact

---

## 🔗 Tài Liệu Tham Khảo

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [JavaScript Obfuscation](https://obfuscator.io/)
- [AES-GCM Encryption](https://nodejs.org/api/crypto.html#crypto_class_cipher)

---

**Ngày tạo:** 2025-01-XX  
**Phiên bản:** 1.0  
**Tác giả:** Security Team


