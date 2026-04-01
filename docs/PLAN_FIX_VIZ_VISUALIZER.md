# Kế Hoạch Tổng Thể: Sửa Visualizer & Parser .viz File

## 🎯 Mục Tiêu
1. **Sóng nhạc phải nhảy theo nhạc** (audio reactive)
2. **Load được images/GIFs từ .viz file**
3. **Visualizer render đúng như Avee Player**

---

## 🔍 Phân Tích Vấn Đề Hiện Tại

### 1. Sóng Không Nhảy Theo Nhạc

**Nguyên nhân có thể:**
- ❌ AudioProcessor không được khởi tạo đúng
- ❌ `isPlaying` state không được update đúng
- ❌ AudioContext bị suspended (browser autoplay policy)
- ❌ Spectrum data không được process đúng
- ❌ Animation loop không chạy liên tục
- ❌ `audioProcessorRef.current.process()` trả về data rỗng

**Debug cần làm:**
```javascript
// Thêm logs để kiểm tra:
console.log('[MultiLayerCircularBars] isPlaying:', isPlaying)
console.log('[MultiLayerCircularBars] audioProcessor:', !!audioProcessorRef.current)
console.log('[MultiLayerCircularBars] analyser:', !!analyserRef.current)
console.log('[MultiLayerCircularBars] spectrum length:', spectrum?.length)
console.log('[MultiLayerCircularBars] spectrum max:', Math.max(...spectrum || [0]))
```

### 2. Images Không Load Được

**Nguyên nhân:**
- ❌ Regex pattern không match với format JSON thực tế
- ❌ File images không có trong ZIP (có thể là internalres:)
- ❌ Images được extract nhưng không được apply vào UI
- ❌ Album art state không được update

**Debug cần làm:**
```javascript
// Kiểm tra format JSON thực tế:
console.log('[VizParser] Sample customImage:', JSON.stringify(vizJson).substring(0, 500))
// Kiểm tra tất cả files trong ZIP:
console.log('[VizParser] ZIP files:', Object.keys(zip.files))
```

---

## 📋 Kế Hoạch Chi Tiết

### Phase 1: Fix Audio Reactive (Sóng Nhảy Theo Nhạc)

#### Task 1.1: Kiểm tra AudioContext & Analyser
- [ ] Đảm bảo AudioContext không bị suspended
- [ ] Thêm `audioContext.resume()` khi user click play
- [ ] Kiểm tra `analyser.getByteFrequencyData()` có trả về data không
- [ ] Log raw frequency data để verify

**File cần sửa:**
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`
- `src/components/AudioVisualizer/AudioAnalyzer.ts`

#### Task 1.2: Fix AudioProcessor
- [ ] Kiểm tra `AudioProcessor.process()` có trả về data đúng không
- [ ] Verify spectrum data sau khi process
- [ ] Đảm bảo `outputMultiplier` được apply đúng
- [ ] Kiểm tra frequency range filtering

**File cần sửa:**
- `src/components/AudioVisualizer/audio/AudioProcessor.ts`
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

#### Task 1.3: Fix Animation Loop
- [ ] Đảm bảo `requestAnimationFrame` luôn chạy
- [ ] Không skip frames khi `isPlaying = false` (vẫn render fallback)
- [ ] Kiểm tra canvas size không = 0
- [ ] Verify `draw()` function được gọi mỗi frame

**File cần sửa:**
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

#### Task 1.4: Fix Spectrum Data Mapping
- [ ] Đảm bảo spectrum data length = barCount từ .viz
- [ ] Map đúng frequency bins đến bars
- [ ] Apply smoothing đúng cách
- [ ] Verify bar heights thay đổi theo audio

**File cần sửa:**
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

---

### Phase 2: Fix Image Loading

#### Task 2.1: Fix Regex Pattern
- [ ] Kiểm tra format JSON thực tế trong scene.json
- [ ] Sửa regex để match đúng format: `"customImage": {"v": "local:123"}`
- [ ] Test với nhiều file .viz khác nhau
- [ ] Handle cả `internalres:` và `local:` formats

**File cần sửa:**
- `src/components/AudioVisualizer/parsers/VizParser.ts`

**Code mẫu:**
```typescript
// Thử nhiều patterns:
const patterns = [
  /"customImage":\s*{\s*"v":\s*"local:(\d+)"/g,
  /"customImage"\s*:\s*{\s*"v"\s*:\s*"local:(\d+)"/g,
  /"v"\s*:\s*"local:(\d+)"/g, // More flexible
]

// Hoặc parse JSON và traverse object tree:
function findImageIds(obj: any, ids: Set<string>) {
  if (typeof obj !== 'object' || obj === null) return
  if (obj.customImage?.v?.startsWith('local:')) {
    ids.add(obj.customImage.v.replace('local:', ''))
  }
  for (const key in obj) {
    findImageIds(obj[key], ids)
  }
}
```

#### Task 2.2: Extract All Files from ZIP
- [ ] List tất cả files trong ZIP (không chỉ dựa vào regex)
- [ ] Filter files có thể là images (không phải scene.json)
- [ ] Try load mỗi file như image
- [ ] Store successful images vào Map

**File cần sửa:**
- `src/components/AudioVisualizer/parsers/VizParser.ts`

**Code mẫu:**
```typescript
// List all files in ZIP
const allFiles = Object.keys(zip.files)
const imageFiles = allFiles.filter(name => 
  name !== 'scene.json' && 
  !name.includes('/') && // Root level files only
  /^\d+$/.test(name) // Numeric IDs
)

for (const imageId of imageFiles) {
  try {
    const file = zip.file(imageId)
    if (file) {
      // Try to load as image
      const blob = await file.async('blob')
      // ... convert to dataURL
    }
  } catch (e) {
    console.warn('Failed to load', imageId, e)
  }
}
```

#### Task 2.3: Apply Images to UI
- [ ] Set `albumArtSrc` khi load .viz
- [ ] Apply background images
- [ ] Handle multiple images (background + album art)
- [ ] Verify images hiển thị trong preview

**File cần sửa:**
- `src/pages/Music/AudioVisualizerPage.tsx`
- `src/components/AudioVisualizer/parsers/VizParser.ts`

---

### Phase 3: Fix Visual Quality (Màu Sắc, Smoothing)

#### Task 3.1: Fix Colors
- [ ] Extract đúng `colorFrom` và `colorTo` từ .viz
- [ ] Convert Avee color format (-1 = default) đúng cách
- [ ] Apply gradient colors đúng
- [ ] Verify colors match với .viz file

**File cần sửa:**
- `src/components/AudioVisualizer/parsers/VizParser.ts`
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

#### Task 3.2: Fix Smoothing & Softness
- [ ] Apply layer-specific smoothing đúng
- [ ] Verify `softness` parameter (0-20) được map đúng
- [ ] Test với different softness values
- [ ] Ensure smooth transitions

**File cần sửa:**
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

#### Task 3.3: Fix Bar Rendering
- [ ] Verify bar width, height scale
- [ ] Check mirror effect
- [ ] Test với multiple layers
- [ ] Ensure bars glow/shadow effects

**File cần sửa:**
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`

---

## 🧪 Testing Checklist

### Audio Reactive Test
- [ ] Play audio → bars should move
- [ ] Pause audio → bars should still animate (fallback)
- [ ] Change volume → bars should react
- [ ] Different songs → bars should adapt

### Image Loading Test
- [ ] Load .viz with images → images should appear
- [ ] Load .viz with GIF → GIF should animate
- [ ] Load .viz without images → no errors
- [ ] Multiple .viz files → all should work

### Visual Quality Test
- [ ] Colors match .viz file
- [ ] Smoothing works correctly
- [ ] Multiple layers render correctly
- [ ] Bars glow/shadow effects visible

---

## 🐛 Debug Tools

### Console Logs to Add
```javascript
// In MultiLayerCircularBarsVisualizer.tsx
console.log('[MultiLayerCircularBars] Frame:', {
  isPlaying,
  hasAudioProcessor: !!audioProcessorRef.current,
  hasAnalyser: !!analyserRef.current,
  spectrumLength: spectrum?.length,
  spectrumMax: spectrum ? Math.max(...spectrum) : 0,
  layersCount: layersRef.current.length,
})

// In VizParser.ts
console.log('[VizParser] ZIP contents:', Object.keys(zip.files))
console.log('[VizParser] JSON sample:', vizJson.substring(0, 1000))
console.log('[VizParser] Image IDs found:', Array.from(imageIds))
```

### Visual Debug Overlay
- [ ] Add on-canvas debug info (FPS, spectrum max, etc.)
- [ ] Show audio level indicator
- [ ] Display current bar count

---

## 📝 Implementation Order

1. **Priority 1: Fix Audio Reactive** (sóng nhảy theo nhạc)
   - Task 1.1 → 1.2 → 1.3 → 1.4

2. **Priority 2: Fix Image Loading** (load images/GIFs)
   - Task 2.1 → 2.2 → 2.3

3. **Priority 3: Fix Visual Quality** (màu sắc, smoothing)
   - Task 3.1 → 3.2 → 3.3

---

## ✅ Success Criteria

- [x] Sóng nhạc nhảy theo nhạc khi play
- [x] Images/GIFs từ .viz file được load và hiển thị
- [x] Visual quality match với Avee Player
- [x] No console errors
- [x] Smooth 60 FPS animation

---

## 🔗 Related Files

- `src/components/AudioVisualizer/parsers/VizParser.ts`
- `src/components/AudioVisualizer/visualizers/MultiLayerCircularBarsVisualizer.tsx`
- `src/components/AudioVisualizer/audio/AudioProcessor.ts`
- `src/components/AudioVisualizer/AudioAnalyzer.ts`
- `src/pages/Music/AudioVisualizerPage.tsx`

---

**Last Updated:** 2024
**Status:** 🚧 In Progress











