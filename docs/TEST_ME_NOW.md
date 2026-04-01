# 🚀 TEST NGAY BÂY GIỜ!

**Status**: ✅ BUILD SUCCESS - READY TO TEST  
**Date**: 2026-01-17

---

## ⚡ **QUICK START**

### **1. Build đã chạy xong**
```bash
npm run build
# ✅ Exit code: 0
# ✅ No errors
```

### **2. Start app để test**
```bash
npm run dev
```

---

## 🧪 **TEST 1: VISUALIZER EXPORT FIX** (Ưu tiên!)

### **Bước thử**:
1. ✅ `npm run dev`
2. ✅ Vào tab **Visualizer**
3. ✅ Thêm layer **Image** (click nút Image → chọn ảnh)
4. ✅ Thêm layer **Text** (click nút Text → gõ "VIET MIX")
5. ✅ Play audio (bất kỳ audio nào)
6. ✅ Click nút **"Xuất MP4"**
7. ✅ Đợi export xong

### **Kết quả mong đợi**:
- ✅ Không crash
- ✅ Không lỗi "Impossible to convert between the formats"
- ✅ Video xuất ra (.mp4) chơi được
- ✅ Video **CÓ layer** (ảnh + chữ + visualizer)

### **Nếu lỗi**:
- ❌ Copy toàn bộ console error
- ❌ Chụp màn hình lỗi
- ❌ Gửi lại cho tôi

---

## 🧪 **TEST 2: PHASE 2 API** (Nâng cao - Dev Console)

### **Bước thử**:
1. ✅ `npm run dev`
2. ✅ Press **F12** (mở DevTools)
3. ✅ Vào tab **Console**
4. ✅ **Paste code này** vào console:

```javascript
// Tạo scene test
const scene = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 5, // 5 giây test
  
  visualizer: {
    mode: 'avee',
    avee: {
      presetKey: 'test',
      waveColor: '#00ff00',
      barCount: 64,
    },
  },
  
  layers: [
    {
      id: 'text1',
      type: 'text',
      visible: true,
      locked: false,
      transform: {
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      opacity: 1,
      text: {
        content: 'PHASE 2 TEST',
        fontSize: 72,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        color: '#ffffff',
        textAlign: 'center',
      },
    },
  ],
  
  assets: {
    images: {},
  },
  
  audio: {
    path: 'D:/path/to/your/audio.mp3', // ← SỬA PATH NÀY!
    normalize: false,
  },
}

// Trigger export
window.api.canvasExportToVideo({
  scene,
  outputPath: 'C:/Users/Admin/Desktop/phase2_test.mp4', // ← SỬA PATH NÀY!
}).then(result => {
  console.log('✅ Export done:', result)
}).catch(error => {
  console.error('❌ Export failed:', error)
})

// Listen for progress
const removeListener = window.api.onCanvasExportProgress((progress) => {
  console.log(`[Progress] ${progress.phase}: ${progress.percent.toFixed(1)}%`, progress.message)
})
```

5. ✅ **SỬA 2 PATH**:
   - `audio.path`: Đường dẫn đến file audio của bạn
   - `outputPath`: Nơi muốn save video test

6. ✅ Press **Enter**

### **Kết quả mong đợi**:
- ✅ Console hiện log progress: `[Progress] ...`
- ✅ Console hiện: `✅ Export done: { success: true, outputPath: "..." }`
- ✅ File video được tạo tại `outputPath`
- ✅ Video có chữ "PHASE 2 TEST" ở giữa màn hình

### **Nếu lỗi**:
- ❌ Copy toàn bộ console error
- ❌ Gửi lại cho tôi

---

## 📊 **CHECK APP INIT**

Khi chạy `npm run dev`, console phải hiện:
```
[App] Starting initialization...
[App] IPC handlers registered
[App] Window created
[App] Security monitoring initialized
[App] Offscreen export manager initialized  ← CÁI NÀY QUAN TRỌNG!
```

Nếu **KHÔNG** có dòng `Offscreen export manager initialized`:
- ❌ Build bị lỗi, chạy lại `npm run build`
- ❌ Copy error gửi lại

---

## 🎯 **CHECKLIST**

### **Build**:
- [ ] `npm run build` → Exit code: 0 ✅

### **App Start**:
- [ ] `npm run dev` → App mở được ✅
- [ ] Console có dòng "Offscreen export manager initialized" ✅

### **Test 1 (Visualizer Export)**:
- [ ] Thêm image layer ✅
- [ ] Thêm text layer ✅
- [ ] Export video ✅
- [ ] Video chơi được ✅
- [ ] Video có layers ✅

### **Test 2 (Phase 2 API)**:
- [ ] Dev console API tồn tại: `window.api.canvasExportToVideo` ✅
- [ ] Export trigger thành công ✅
- [ ] Video được tạo ✅
- [ ] Video có text "PHASE 2 TEST" ✅

---

## 📝 **BÁO CÁO KẾT QUẢ**

Sau khi test xong, paste cái này:

```markdown
## KẾT QUẢ TEST

**Test 1 (Visualizer Export)**: ✅ / ❌
- Video xuất được: CÓ / KHÔNG
- Video có layers: CÓ / KHÔNG
- Lỗi: _______

**Test 2 (Phase 2 API)**: ✅ / ❌ / ⏳ (chưa test)
- API tồn tại: CÓ / KHÔNG
- Export chạy: CÓ / KHÔNG
- Video có text layer: CÓ / KHÔNG
- Lỗi: _______

**Console Errors**:
```
(paste errors nếu có)
```
```

---

## 🚨 **NẾU BẠN THẤY LỖI**

### **Lỗi: "Cannot find module offscreenManager"**
**Fix**: Chạy lại `npm run build`

### **Lỗi: "Impossible to convert between the formats"**
**Fix**: Đã fix rồi, nếu vẫn lỗi → gửi log

### **Lỗi: "window.api.canvasExportToVideo is not a function"**
**Fix**: Preload chưa load, restart app

### **Lỗi: Video không có layers**
**Fix**: Đây là lý do tạo Phase 2! Test 2 sẽ fix cái này.

---

## 📚 **CHI TIẾT HƠN**

Xem thêm:
- `docs/PHASE_2_TESTING_GUIDE.md` - Hướng dẫn chi tiết
- `docs/PHASE_2_DEPLOYMENT_STATUS.md` - Tổng quan triển khai
- `docs/PHASE_2_IMPLEMENTATION_ROADMAP.md` - Lộ trình kỹ thuật

---

**READY**: ✅  
**BUILD**: ✅  
**TESTED**: ⏳ (đang chờ bạn test)  
**NEXT**: Report kết quả test!
