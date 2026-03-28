# Security Alerting System - Hệ Thống Cảnh Báo Bảo Mật

## 📋 Tổng Quan

Hệ thống này tự động phát hiện và báo cáo các hoạt động đáng ngờ (crack attempts) lên server để admin có thể theo dõi và hành động.

---

## 🔍 Các Dấu Hiệu Crack Được Phát Hiện

### 1. **SIGNATURE_INVALID** (High)
- **Mô tả**: Signature không hợp lệ trong API request
- **Nguyên nhân**: 
  - User đang cố gắng fake request
  - Code bị sửa đổi
  - Key derivation bị thay đổi
- **Báo cáo**: Tự động khi verify signature fail

### 2. **SIGNATURE_REPLAY** (High)
- **Mô tả**: Request có timestamp quá cũ (replay attack)
- **Nguyên nhân**: User đang cố gắng replay request cũ
- **Báo cáo**: Tự động khi timestamp age > 5 phút

### 3. **NONCE_REUSED** (Critical)
- **Mô tả**: Nonce bị reuse (replay attack)
- **Nguyên nhân**: User đang cố gắng replay request với cùng nonce
- **Báo cáo**: Tự động khi detect nonce đã được dùng

### 4. **LICENSE_CHECK_FAILED** (Medium/High)
- **Mô tả**: License check fail nhiều lần
- **Nguyên nhân**: 
  - User đang cố gắng bypass license check
  - License bị revoke
- **Báo cáo**: Tự động khi có >= 3 failures trong 1 phút

### 5. **TAMPERING_DETECTED** (Critical)
- **Mô tả**: Phát hiện code/file bị sửa đổi
- **Nguyên nhân**: 
  - Executable bị patch
  - Main.js bị sửa
  - Function bị hook
- **Báo cáo**: Tự động khi tamper detection trigger

### 6. **ANTI_DEBUG_TRIGGERED** (High)
- **Mô tả**: Phát hiện debugger/DevTools
- **Nguyên nhân**: User đang cố gắng debug/reverse engineer
- **Báo cáo**: Tự động khi anti-debugging detect

### 7. **MACHINE_ID_MISMATCH** (High)
- **Mô tả**: MachineId không khớp
- **Nguyên nhân**: 
  - User sửa file authState.enc
  - User copy file sang máy khác
- **Báo cáo**: Tự động khi detect mismatch

### 8. **ENCRYPTION_DECRYPT_FAILED** (High)
- **Mô tả**: Encryption/decryption fail
- **Nguyên nhân**: 
  - File bị sửa đổi
  - Key không đúng
- **Báo cáo**: Tự động khi decrypt fail

### 9. **FILE_INTEGRITY_FAILED** (Critical)
- **Mô tả**: File integrity check fail
- **Nguyên nhân**: Executable/code bị sửa đổi
- **Báo cáo**: Tự động khi hash không khớp

### 10. **MULTIPLE_MACHINE_IDS** (High)
- **Mô tả**: Cùng account dùng nhiều machineId khác nhau
- **Nguyên nhân**: User đang share account hoặc crack
- **Báo cáo**: Server-side detection (cần implement)

### 11. **RATE_LIMIT_EXCEEDED** (Medium)
- **Mô tả**: Quá nhiều requests trong thời gian ngắn
- **Nguyên nhân**: Bot attack hoặc automated crack attempt
- **Báo cáo**: Tự động khi rate limit exceeded

---

## 📡 Server Endpoint

### POST `/api/security/report`

**Request Body:**
```json
{
  "event": "SIGNATURE_INVALID",
  "severity": "high",
  "message": "Invalid signature detected for POST /api/auth/check",
  "details": {
    "path": "/api/auth/check",
    "method": "POST",
    "expectedSignature": "...",
    "receivedSignature": "..."
  },
  "timestamp": 1234567890,
  "machineId": "abc123...",
  "username": "user123",
  "appVersion": "1.0.4"
}
```

**Response:**
```json
{
  "ok": true,
  "logged": true
}
```

---

## 🛡️ Rate Limiting

Để tránh spam, hệ thống có rate limiting:
- **Window**: 1 phút
- **Max events per window**: 5 events cùng loại từ cùng machineId
- Nếu vượt quá → không report (chỉ log local)

---

## 📊 Monitoring Dashboard (Cần Implement trên Server)

Server nên có dashboard để hiển thị:

1. **Real-time Alerts**
   - Danh sách các events gần đây
   - Filter theo severity, type, machineId, username

2. **Statistics**
   - Số lượng events theo type
   - Top machineIds có nhiều events
   - Top usernames có nhiều events
   - Timeline của events

3. **Alert Rules**
   - Critical events → email/SMS alert ngay
   - High events → email alert
   - Medium events → log only

4. **Actions**
   - Block machineId
   - Block username
   - Revoke license
   - Send warning email

---

## 🔔 Alert Severity Levels

### **Critical**
- NONCE_REUSED
- TAMPERING_DETECTED
- FILE_INTEGRITY_FAILED

**Action**: Alert ngay lập tức (email/SMS), có thể block tự động

### **High**
- SIGNATURE_INVALID
- SIGNATURE_REPLAY
- ANTI_DEBUG_TRIGGERED
- MACHINE_ID_MISMATCH
- ENCRYPTION_DECRYPT_FAILED
- MULTIPLE_MACHINE_IDS

**Action**: Alert trong vòng 5 phút, review và quyết định block

### **Medium**
- LICENSE_CHECK_FAILED (nếu < 5 attempts)
- RATE_LIMIT_EXCEEDED

**Action**: Log và review định kỳ

### **Low**
- LICENSE_CHECK_FAILED (nếu < 3 attempts)

**Action**: Log only

---

## 📝 Implementation Status

✅ **Completed:**
- Security event types và interfaces
- Report functions cho tất cả event types
- Rate limiting để tránh spam
- Integration vào:
  - API signing verification
  - Encrypted auth store
  - Tamper detection
  - License check
  - Anti-debugging (renderer)

⏳ **Pending (Server-side):**
- Endpoint `/api/security/report` trên server
- Database để lưu events
- Dashboard để xem events
- Alert system (email/SMS)
- Auto-block mechanism

---

## 🚀 Next Steps

1. **Server Implementation:**
   - Tạo endpoint `/api/security/report`
   - Lưu events vào database
   - Setup alerting (email/SMS)

2. **Dashboard:**
   - Tạo admin dashboard
   - Real-time monitoring
   - Statistics và charts

3. **Auto Actions:**
   - Auto-block sau N critical events
   - Auto-revoke license sau M high events
   - Auto-send warning email

---

**Ngày tạo:** 2025-01-XX  
**Phiên bản:** 1.0  
**Tác giả:** Security Team


