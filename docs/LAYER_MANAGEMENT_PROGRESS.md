# Tiến Độ Phát Triển Layer Management - Chức Năng Số 10

## ✅ Đã Hoàn Thành

### Phase 1: Setup & Infrastructure ✅
- [x] Cài đặt dependencies:
  - `fabric` (v5.x) - Canvas manipulation
  - `react-dnd`, `react-dnd-html5-backend` - Drag & drop
  - `@types/fabric` - TypeScript types

- [x] LayerManagerService (`src/components/AudioVisualizer/services/LayerManagerService.ts`)
  - Quản lý Fabric.js canvas instance
  - CRUD operations cho text/image layers
  - Event handling (drag, resize, rotate, delete)
  - Sync với ProjectConfig
  - Text và Image object management

- [x] Delete Functions trong `useProjectConfig`:
  - `deleteTextLayer(id: string)`
  - `deleteImageLayer(id: string)`
  - `reorderLayers(layerIds: string[], type: 'text' | 'image')`

- [x] Helper Functions (`src/components/AudioVisualizer/utils/layerHelpers.ts`):
  - `createDefaultTextLayer()` - Tạo text layer mặc định
  - `createDefaultImageLayer()` - Tạo image layer mặc định

### Phase 2: UI Components ✅
- [x] LayerTabEnhanced Component (`src/components/AudioVisualizer/components/LayerTabEnhanced.tsx`)
  - Danh sách layers (text + image)
  - Nút thêm text/image layer
  - Nút xóa layer với confirmation dialog
  - Toggle visibility cho từng layer
  - Highlight selected layer
  - Scrollable layer list

- [x] IPC Integration:
  - Thêm `selectImageFile` handler trong `electron/main.ts`
  - Thêm `selectImageFile` trong `electron/preload.ts`
  - Thêm type definition trong `src/types/ipc.ts`

- [x] Integration vào AudioVisualizerPage:
  - Thay LayerTab bằng LayerTabEnhanced
  - Thêm state cho selected layer (selectedLayerId, selectedLayerType)
  - Connect với ProjectConfig hooks

### Phase 3: Fabric.js Canvas Integration 🔄
- [x] FabricCanvasOverlay Component (`src/components/AudioVisualizer/canvas/FabricCanvasOverlay.tsx`)
  - React component với forwardRef
  - Initialize Fabric.js canvas
  - Sync với ProjectConfig
  - Event handlers (select, update, delete)
  - Expose methods via ref

- [x] VisualizerWrapper Integration:
  - Thêm props cho project và callbacks
  - Render FabricCanvasOverlay trong wrapper
  - Position overlay trên visualizer canvas

- [ ] Sync với ProjectConfig khi layers thay đổi (đang làm)
- [ ] Drag & drop handlers (đang làm)

## 🚧 Đang Phát Triển

### Phase 4: Drag & Drop trên Canvas
**Status:** In Progress

**Tasks:**
- [ ] Implement drag handlers trong Fabric.js
  - `object:moving` event
  - Sync position với ProjectConfig
  - Update transform.position khi drag
- [ ] Visual feedback khi drag
  - Highlight selected object
  - Show guides/alignment lines (optional)
- [ ] Resize handlers
  - `object:scaling` event
  - Sync scale với ProjectConfig
- [ ] Rotate handlers
  - `object:rotating` event
  - Sync rotation với ProjectConfig
- [ ] Multi-select (optional)
  - Select multiple layers
  - Move/resize multiple layers together

**Code Location:**
- `src/components/AudioVisualizer/services/LayerManagerService.ts` - Event handlers
- `src/components/AudioVisualizer/canvas/FabricCanvasOverlay.tsx` - Component integration

## ⏳ Kế Hoạch Tiếp Theo

### Phase 5: Text Editor Component
**Mục tiêu:** Text editor đầy đủ với nhiều kiểu chữ và hiệu ứng

**Tasks:**
1. **Text Input Component**
   - Rich text input
   - Real-time preview
   - Multi-line support

2. **Font Controls**
   - Font family selector (Google Fonts, system fonts)
   - Font size slider
   - Font weight selector
   - Font style (normal, italic)
   - Letter spacing
   - Line height

3. **Color & Effects**
   - Color picker
   - Gradient editor (linear, radial, conic)
   - Stroke/outline settings
   - Shadow settings (multiple shadows)
   - Glow settings

4. **Text Alignment**
   - Anchor point selector (9 positions)
   - Text alignment (left, center, right)

**File sẽ tạo:**
- `src/components/AudioVisualizer/components/TextEditor.tsx`

### Phase 6: Image Upload & Management
**Mục tiêu:** Upload, preview, và quản lý image layers

**Tasks:**
1. **Image Upload Component**
   - File picker integration
   - Image preview
   - Image validation

2. **Image Properties Editor**
   - Position controls (X, Y)
   - Scale controls (X, Y)
   - Rotation control
   - Opacity slider
   - Z-index control

3. **Image Effects** (Optional)
   - Blur
   - Brightness/Contrast
   - Saturation
   - Color filters
   - Glow
   - Shadow

**File sẽ tạo:**
- `src/components/AudioVisualizer/components/ImageUpload.tsx`
- `src/components/AudioVisualizer/components/ImagePropertiesEditor.tsx`

### Phase 7: Text Effects & Animations
**Mục tiêu:** Nhiều hiệu ứng và animation cho text

**Features:**
- Gradient text (linear, radial, conic)
- Multiple shadows
- Glow effects
- Stroke/outline
- 3D text (optional, WebGL)
- Animations:
  - Fade in/out
  - Glow pulse
  - Bounce
  - Typewriter
  - Beat sync animations

**Thư viện đề xuất:**
- GSAP (GreenSock) cho animations
- Canvas API cho effects
- WebGL shaders cho 3D (optional)

### Phase 8-14: Xem `docs/ROADMAP_VISUALIZER.md`

## 📊 So Sánh Với Các App Nổi Tiếng

### Avee Player (Android)
**Tính năng chính:**
- ✅ Multi-layer visualization
- ✅ Text layers với animation
- ✅ Image layers với transform
- ✅ Audio-reactive effects
- ✅ Custom presets
- ✅ Export video
- ✅ Drag & drop layers
- ✅ Layer properties
- ✅ Blend modes
- ✅ Color grading
- ✅ Particle effects
- ✅ 3D transforms

**Chúng ta đã có:**
- ✅ Multi-layer support
- ✅ Text layers
- ✅ Image layers
- ✅ Export video
- 🔄 Drag & drop (đang làm)
- ⏳ Text effects (chưa có)
- ⏳ Animations (chưa có)
- ⏳ Presets (chưa có)
- ⏳ 3D effects (chưa có)

## 🎯 Next Immediate Steps

1. **Hoàn thiện Drag & Drop** (Phase 4)
   - Implement event handlers trong LayerManagerService
   - Test với text và image layers
   - Sync với ProjectConfig

2. **Text Editor Component** (Phase 5)
   - Tạo component cơ bản
   - Tích hợp với LayerTabEnhanced
   - Test với real-time preview

3. **Image Management** (Phase 6)
   - Hoàn thiện upload
   - Properties editor
   - Preview component

## 📝 Notes

- Fabric.js v5 sử dụng named exports thay vì default export
- Cần sync Fabric.js canvas với ProjectConfig khi layers thay đổi
- Drag & drop đã có trong Fabric.js, chỉ cần implement handlers
- Text effects có thể implement bằng Canvas API hoặc WebGL

## 🔧 Technical Details

### Fabric.js Integration
- Sử dụng `Canvas`, `Text`, `Image` từ `fabric` package
- Canvas được overlay trên visualizer canvas
- Objects được sync với ProjectConfig
- Events: `selection:created`, `selection:updated`, `object:modified`, `keydown`

### State Management
- ProjectConfig là source of truth
- Fabric.js canvas sync với ProjectConfig
- Updates từ UI → ProjectConfig → Fabric.js canvas
- Updates từ Fabric.js → ProjectConfig → UI

### Performance
- Canvas được render chỉ khi cần
- Objects được cached trong Maps
- Updates được batched khi có thể


