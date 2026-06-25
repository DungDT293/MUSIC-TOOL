# Plan: Chroma Key Overlay cho Xuất Video Hoàn Chỉnh (Tab 6)

## Tổng quan
Thêm chức năng tách phông xanh/đen cho video overlay, đè lên video hoàn chỉnh khi xuất. User chọn video phông xanh/đen → setting màu, tolerance, smoothing → di chuyển lên/xuống → preview → áp dụng khi xuất.

## Kiến trúc: FFmpeg `filter_complex`

### Phông xanh (green screen)
```
[1:v]chromakey=color=0x00FF00:similarity=0.15:blend=0.05[fg];
[0:v][fg]overlay=x=0:y=100[out]
```

### Phông đen (black background)
```
[1:v]colorkey=color=0x000000:similarity=0.1:blend=0.08[fg];
[0:v][fg]overlay=x=0:y=100[out]
```

## Files cần sửa/tạo

### 1. `shared/videoFinalExportChannels.ts` — Thêm ChromaKeyOverlay interface

```typescript
export interface ChromaKeyOverlay {
  enabled: boolean
  videoPath: string              // Path video phông xanh/đen
  bgType: 'green' | 'black'     // Loại nền cần tách
  keyColor: string               // Hex color (#00FF00 hoặc #000000)
  similarity: number             // 0.01-1.0 (tolerance)
  blend: number                  // 0.0-1.0 (smoothing/feather)
  offsetY: number                // Offset Y (pixel) — di chuyển lên/xuống
  scale: number                  // Scale factor (0.1-2.0, default 1.0)
}
```

Thêm vào `FinalExportRequestPayload`:
```typescript
chromaKeyOverlay?: ChromaKeyOverlay
```

### 2. `src/pages/Video/FinalExportTab.tsx` — UI Section mới

Thêm Card mới giữa "Chọn nguồn" và "Thư mục & tên file":

**State mới:**
```typescript
const [chromaKeyEnabled, setChromaKeyEnabled] = useState(false)
const [chromaKeyVideoPath, setChromaKeyVideoPath] = useState<string | null>(null)
const [chromaKeyBgType, setChromaKeyBgType] = useState<'green' | 'black'>('green')
const [chromaKeyColor, setChromaKeyColor] = useState('#00FF00')
const [chromaKeySimilarity, setChromaKeySimilarity] = useState(0.15)
const [chromaKeyBlend, setChromaKeyBlend] = useState(0.05)
const [chromaKeyOffsetY, setChromaKeyOffsetY] = useState(0)
const [chromaKeyScale, setChromaKeyScale] = useState(1.0)
```

**UI Card:**
```
┌─── Chèn Video Phông Xanh/Đen ──────────────────────┐
│ ☑ Bật chèn video phông xanh/đen                     │
│                                                       │
│ [Chọn video phông xanh/đen]  filename.mp4            │
│                                                       │
│ Loại nền:  (●) Phông xanh  (○) Phông đen            │
│                                                       │
│ Cài đặt tách nền:                                    │
│ Màu nền (Hex): [#00FF00]  [Chọn màu từ video]       │
│ Tolerance: ────────●──── 0.15                        │
│ Smoothing: ──●──────── 0.05                          │
│                                                       │
│ Vị trí & kích thước:                                 │
│ Vị trí Y: ────────●──── 0 px (↑↓)                   │
│ Tỉ lệ:   ────────●──── 100%                         │
│                                                       │
│ [Preview nhanh]  ← mở cửa sổ preview nhỏ            │
└───────────────────────────────────────────────────────┘
```

### 3. `backend/video/finalExport.ts` — Tích hợp FFmpeg filter_complex

Sửa `runFinalCommand_SingleStep` và `runFinalCommand_TwoPass`:

**Khi có chromaKeyOverlay:**
- Thêm input: `-i chromaKeyVideo.mp4`
- Thay `-map 0:v:0` bằng `-filter_complex`:
  ```
  [1:v]chromakey=color=0x00FF00:similarity=0.15:blend=0.05,
       scale=iw*1.0:ih*1.0[fg];
  [0:v][fg]overlay=x=(W-w)/2:y=100:shortest=1[out]
  ```
- Map: `-map [out]` thay vì `-map 0:v:0`
- Audio map dịch: `-map 2:a:0` (vì thêm 1 input)

**Logic chọn filter:**
```typescript
function buildChromaKeyFilterComplex(overlay: ChromaKeyOverlay): string {
  const filterName = overlay.bgType === 'green' ? 'chromakey' : 'colorkey'
  const hexColor = '0x' + overlay.keyColor.replace('#', '')
  const scaleExpr = overlay.scale !== 1.0
    ? `,scale=iw*${overlay.scale}:ih*${overlay.scale}`
    : ''
  return [
    `[1:v]${filterName}=color=${hexColor}:similarity=${overlay.similarity}:blend=${overlay.blend}${scaleExpr}[fg]`,
    `[0:v][fg]overlay=x=(W-w)/2:y=${overlay.offsetY}:shortest=1:eof_action=pass[out]`
  ].join(';')
}
```

### 4. Gửi payload từ UI

Trong hàm `handleStartExport` của FinalExportTab.tsx, thêm vào payload:
```typescript
chromaKeyOverlay: chromaKeyEnabled && chromaKeyVideoPath ? {
  enabled: true,
  videoPath: chromaKeyVideoPath,
  bgType: chromaKeyBgType,
  keyColor: chromaKeyColor,
  similarity: chromaKeySimilarity,
  blend: chromaKeyBlend,
  offsetY: chromaKeyOffsetY,
  scale: chromaKeyScale,
} : undefined,
```

## Thứ tự triển khai

1. **shared types** — Thêm `ChromaKeyOverlay` interface + field vào payload
2. **Backend FFmpeg** — `buildChromaKeyFilterComplex()` + tích hợp vào `runFinalCommand_SingleStep` và `runFinalCommand_TwoPass`
3. **UI FinalExportTab** — Card mới với controls
4. **Gửi payload** — Wire UI state vào export payload
5. **Test** — Build và test
