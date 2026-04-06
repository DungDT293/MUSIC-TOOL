# Kế Hoạch Thêm Tùy Chọn GPU/CPU Encoding

## 📋 Tổng Quan

Thêm tùy chọn cho phép user chọn sử dụng GPU hoặc CPU encoding cho các chức năng video processing, với fallback tự động khi GPU không available.

## 🎯 Mục Tiêu

1. Thêm UI option "Sử dụng GPU (nhanh hơn)" / "Sử dụng CPU (chất lượng tốt hơn)" cho các chức năng encoding
2. Tự động fallback về CPU nếu user chọn GPU nhưng GPU không available
3. Không ảnh hưởng đến các chức năng hiện tại (backward compatible)
4. Đảm bảo chất lượng output tương đương

## 📍 Các Chức Năng Cần Thay Đổi

### 1. **Cắt đơn** (`cutSingleSimple.ts`)
- **Vị trí**: `backend/video/cutSingleSimple.ts` (dòng 155-178)
- **Hiện tại**: Hardcode `libx264` khi `normalizeOutput = true`
- **Thay đổi**: Dùng `buildVideoEncoderArgsWithChoice()` dựa trên user choice

### 2. **Cắt nhiều** (`splitManySimple.ts`)
- **Vị trí**: Gọi `cutSingleSimple.ts`
- **Thay đổi**: Truyền `useGpuEncoding` parameter xuống `cutSingleSimple`

### 3. **Ghép video** (`mergeVideosSimple.ts`)
- **Vị trí**: `backend/video/mergeVideosSimple.ts` (dòng 838-853)
- **Hiện tại**: Hardcode `libx264` trong `fallbackTranscodeAndConcat()`
- **Thay đổi**: Dùng GPU encoder nếu có và user chọn

### 4. **Xuất video cuối** (`finalExport.ts`)
- **Vị trí**: `backend/video/finalExport.ts` (dòng 1890)
- **Hiện tại**: Đã có auto-detect GPU, nhưng không có option user chọn
- **Thay đổi**: Thêm option để user override auto-detection

## 🏗️ Architecture Design

### Backend Changes

#### 1. **Cập nhật `gpuDetection.ts`**
```typescript
// Thêm function mới
export async function buildVideoEncoderArgsWithChoice(
  needsReencode: boolean,
  userChoice: 'gpu' | 'cpu' | 'auto', // User choice
  quality: 'fast' | 'medium' | 'slow' = 'fast'
): Promise<{ args: string[], usedEncoder: 'gpu' | 'cpu', gpuInfo?: GpuInfo }>
```

**Logic:**
- `userChoice = 'auto'`: Dùng logic hiện tại (auto-detect GPU)
- `userChoice = 'gpu'`: Ưu tiên GPU, fallback về CPU nếu không available
- `userChoice = 'cpu'`: Luôn dùng CPU (libx264)

**Return value:**
- `args`: FFmpeg encoder arguments
- `usedEncoder`: 'gpu' hoặc 'cpu' (để log)
- `gpuInfo`: Thông tin GPU nếu dùng GPU

#### 2. **Cập nhật `cutSingleSimple.ts`**
```typescript
export interface CutSingleSimpleRequest {
  // ... existing fields
  useGpuEncoding?: boolean // true = GPU, false = CPU, undefined = auto
}

// Trong codecArgs:
const encoderChoice = req.useGpuEncoding === true ? 'gpu' : req.useGpuEncoding === false ? 'cpu' : 'auto'
const { args: encoderArgs, usedEncoder } = await buildVideoEncoderArgsWithChoice(
  normalizeOutput,
  encoderChoice,
  'fast' // Quality preset
)
```

**Lưu ý:**
- Giữ nguyên `-force_key_frames` và các args khác
- Chỉ thay thế phần `-c:v libx264` và preset/CRF
- Log encoder được sử dụng để debug

#### 3. **Cập nhật `mergeVideosSimple.ts`**
```typescript
async function fallbackTranscodeAndConcat(
  // ... existing params
  useGpuEncoding?: boolean
): Promise<void> {
  // Thay thế hardcode libx264 bằng buildVideoEncoderArgsWithChoice()
}
```

#### 4. **Cập nhật `finalExport.ts`**
```typescript
export interface FinalExportRequestPayload {
  // ... existing fields
  useGpuEncoding?: 'gpu' | 'cpu' | 'auto' // Default: 'auto'
}

// Trong executeFinalExport:
const encoderChoice = req.useGpuEncoding || 'auto'
const { args: encoderArgs, usedEncoder } = await buildVideoEncoderArgsWithChoice(
  needsReencode,
  encoderChoice,
  'fast'
)
```

### Frontend Changes

#### 1. **SingleCutTabSimple.tsx**
- Thêm checkbox/radio button:
  - ☑️ "Sử dụng GPU (nhanh hơn)" - Default: false (giữ nguyên CPU)
  - Tooltip: "Sử dụng GPU để encode nhanh hơn. Tự động chuyển về CPU nếu GPU không available."
- Truyền `useGpuEncoding` vào IPC request

#### 2. **MultiCutTab.tsx**
- Thêm checkbox tương tự
- Truyền `useGpuEncoding` vào `splitManySimple` request

#### 3. **MergeTab.tsx**
- Thêm checkbox cho fallback transcode
- Truyền `useGpuEncoding` vào `mergeVideosSimple` request

#### 4. **FinalExportTab.tsx**
- Thêm radio buttons:
  - ○ Auto (mặc định) - Tự động detect GPU
  - ○ GPU - Ưu tiên GPU
  - ○ CPU - Luôn dùng CPU
- Tooltip giải thích từng option

### IPC Changes

#### 1. **Cập nhật IPC handlers trong `electron/main.ts`**
```typescript
// video:cutSingleSimple
ipcMain.handle('video:cutSingleSimple', async (event, req: CutSingleSimpleRequest) => {
  // req.useGpuEncoding đã có trong request
})

// video:splitManySimple
ipcMain.handle('video:splitManySimple', async (event, req: SplitManySimpleRequest) => {
  // req.useGpuEncoding đã có trong request
})

// video:mergeVideosSimple
ipcMain.handle('video:mergeVideosSimple', async (event, req: MergeVideosSimpleRequest) => {
  // req.useGpuEncoding đã có trong request
})

// video:finalExport
ipcMain.handle('video:finalExport', async (event, req: FinalExportRequestPayload) => {
  // req.useGpuEncoding đã có trong request
})
```

## ⚠️ Rủi Ro Và Cách Xử Lý

### 1. **GPU không available nhưng user chọn GPU**
- **Xử lý**: Tự động fallback về CPU
- **Thông báo**: Log warning và có thể hiển thị notification cho user
- **Code**: Trong `buildVideoEncoderArgsWithChoice()`, nếu `userChoice = 'gpu'` nhưng GPU không available → return CPU args

### 2. **Backward Compatibility**
- **Xử lý**: Tất cả parameters mới đều là optional (`useGpuEncoding?`)
- **Default behavior**: Nếu không có `useGpuEncoding` → dùng CPU (giữ nguyên behavior cũ)
- **Testing**: Test với requests không có `useGpuEncoding` để đảm bảo không break

### 3. **Chất lượng output khác nhau**
- **Xử lý**: 
  - GPU encoder dùng preset/quality tương đương CPU
  - Có thể cần điều chỉnh CRF/bitrate để match chất lượng
  - Document rõ ràng cho user về trade-off

### 4. **Progress tracking với GPU**
- **Xử lý**: 
  - GPU encoding có thể output progress khác CPU
  - Đảm bảo progress bar vẫn hoạt động đúng
  - Test kỹ progress tracking với GPU encoder

### 5. **Cancel job với GPU**
- **Xử lý**: 
  - Đảm bảo `videoJobManager.cancelJob()` hoạt động với GPU encoding
  - Test cancel khi đang encode với GPU

## 🧪 Testing Plan

### Test Cases

1. **Cắt đơn với GPU (GPU available)**
   - Bật "Chuẩn hóa" + "Sử dụng GPU"
   - Verify: Dùng GPU encoder (h264_nvenc/h264_amf)
   - Verify: Progress bar hoạt động
   - Verify: Output chất lượng tốt

2. **Cắt đơn với GPU (GPU không available)**
   - Bật "Chuẩn hóa" + "Sử dụng GPU" trên máy không có GPU
   - Verify: Tự động fallback về CPU
   - Verify: Có log warning về fallback
   - Verify: Vẫn hoàn thành thành công

3. **Cắt đơn với CPU**
   - Bật "Chuẩn hóa" + "Sử dụng CPU"
   - Verify: Dùng libx264
   - Verify: Chất lượng output tốt

4. **Cắt nhiều với GPU**
   - Tương tự test case 1-3 nhưng với nhiều files

5. **Ghép video với GPU (fallback transcode)**
   - Tạo scenario cần fallback transcode
   - Bật "Sử dụng GPU"
   - Verify: Dùng GPU encoder trong fallback

6. **Xuất video cuối với các option**
   - Test Auto, GPU, CPU
   - Verify: Mỗi option hoạt động đúng

7. **Backward compatibility**
   - Test requests không có `useGpuEncoding`
   - Verify: Vẫn dùng CPU (behavior cũ)

8. **Cancel job**
   - Start job với GPU encoding
   - Cancel job
   - Verify: Process được kill đúng cách

## 📝 Implementation Order

### Phase 1: Backend Core (Không ảnh hưởng frontend)
1. ✅ Tạo `buildVideoEncoderArgsWithChoice()` trong `gpuDetection.ts`
2. ✅ Cập nhật `cutSingleSimple.ts` - thêm parameter và logic
3. ✅ Cập nhật `mergeVideosSimple.ts` - fallback transcode
4. ✅ Cập nhật `finalExport.ts` - thêm option
5. ✅ Test backend với hardcoded values

### Phase 2: IPC Layer
6. ✅ Cập nhật IPC handlers để truyền `useGpuEncoding`
7. ✅ Cập nhật TypeScript interfaces cho requests
8. ✅ Test IPC communication

### Phase 3: Frontend UI
9. ✅ Cập nhật `SingleCutTabSimple.tsx`
10. ✅ Cập nhật `MultiCutTab.tsx`
11. ✅ Cập nhật `MergeTab.tsx`
12. ✅ Cập nhật `FinalExportTab.tsx`
13. ✅ Test UI và user interaction

### Phase 4: Integration Testing
14. ✅ Test end-to-end tất cả scenarios
15. ✅ Test error handling và fallback
16. ✅ Test performance (tốc độ GPU vs CPU)
17. ✅ Test chất lượng output

## 🔍 Code Review Checklist

- [ ] Tất cả parameters mới đều optional
- [ ] Default behavior giữ nguyên (backward compatible)
- [ ] Error handling đầy đủ (GPU không available, fallback)
- [ ] Logging rõ ràng (encoder được sử dụng)
- [ ] Progress tracking vẫn hoạt động với GPU
- [ ] Cancel job vẫn hoạt động với GPU
- [ ] UI/UX rõ ràng (tooltips, labels)
- [ ] TypeScript types đầy đủ
- [ ] Không có hardcoded values còn sót

## 📊 Success Criteria

1. ✅ User có thể chọn GPU/CPU cho tất cả chức năng encoding
2. ✅ Tự động fallback về CPU nếu GPU không available
3. ✅ Không có regression (các chức năng cũ vẫn hoạt động)
4. ✅ Progress tracking hoạt động với cả GPU và CPU
5. ✅ Cancel job hoạt động với cả GPU và CPU
6. ✅ Chất lượng output tương đương (hoặc user hiểu trade-off)

## 🚀 Next Steps

Sau khi implement xong, có thể:
1. Thêm preference storage để lưu user choice (localStorage hoặc config file)
2. Thêm benchmark/test để so sánh tốc độ GPU vs CPU
3. Thêm advanced options (quality preset, bitrate) cho GPU encoding
4. Thêm monitoring để track GPU usage và performance



