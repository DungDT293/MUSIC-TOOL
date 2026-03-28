# Kế Hoạch Phát Triển Layer Management cho Chức Năng Số 10 (Tạo Sóng Nhạc)

## 📋 Tổng Quan

Chức năng số 10 hiện tại đã có cấu trúc cơ bản cho text layers và image layers trong `ProjectConfig`, nhưng thiếu:
- UI để quản lý layers (thêm, xóa, sắp xếp)
- Drag & drop để di chuyển layers trên canvas
- Text editor với nhiều kiểu chữ và hiệu ứng
- Image upload và quản lý
- Xóa layers

## 🎯 Mục Tiêu

1. **Thêm/Xóa Layers**: Cho phép người dùng thêm nhiều text layers và image layers, xóa từng layer
2. **Di Chuyển Layers**: Drag & drop để di chuyển layers trên canvas như phần mềm edit chuyên nghiệp
3. **Text Editor**: Text editor với nhiều kiểu chữ, font, màu sắc, hiệu ứng (shadow, glow, gradient, stroke)
4. **Image Management**: Upload, preview, resize, rotate images
5. **Layer Ordering**: Sắp xếp thứ tự layers (z-index)
6. **Layer Properties**: Transform (position, scale, rotation, opacity) cho từng layer

## 📚 Thư Viện Đề Xuất

### 1. **Fabric.js** (Khuyến nghị chính)
- **GitHub**: https://github.com/fabricjs/fabric.js
- **NPM**: `fabric`
- **React wrapper**: `react-fabricjs` hoặc tích hợp trực tiếp
- **Ưu điểm**:
  - Mạnh mẽ, hỗ trợ đầy đủ canvas manipulation
  - Built-in drag & drop, resize, rotate
  - Text editing với rich text support
  - Image manipulation
  - Layer management
  - Event handling tốt
  - Performance tốt
- **Nhược điểm**:
  - Bundle size lớn (~200KB)
  - Learning curve trung bình

### 2. **Konva.js + React-Konva** (Alternative)
- **GitHub**: https://github.com/konvajs/konva
- **NPM**: `konva`, `react-konva`
- **Ưu điểm**:
  - React-friendly (react-konva)
  - Performance tốt với 2D canvas
  - Layer management tốt
  - Drag & drop built-in
  - TypeScript support tốt
- **Nhược điểm**:
  - Text editing không mạnh bằng Fabric.js
  - Ít tính năng text effects hơn

### 3. **React-DnD** (Cho drag & drop trong UI panel)
- **GitHub**: https://github.com/react-dnd/react-dnd
- **NPM**: `react-dnd`, `react-dnd-html5-backend`
- **Ưu điểm**:
  - Chuyên cho drag & drop trong React
  - Tích hợp tốt với React
  - Hỗ trợ touch events
- **Nhược điểm**:
  - Chỉ cho UI panel, không cho canvas

### 4. **Text Effects Libraries**
- **Three.js** (nếu cần 3D text effects)
- **GSAP** (cho animations)
- **Canvas API** (native, cho text rendering với effects)

## 🏗️ Kiến Trúc Đề Xuất

### Option A: Fabric.js (Khuyến nghị)
```
Canvas Layer (Fabric.js)
├── Background Layer
├── Visualizer Layer (existing)
├── Album Art Layer (existing)
├── Image Layers (Fabric.Image objects)
└── Text Layers (Fabric.Text objects)
```

**Ưu điểm**:
- Tất cả layers trong một canvas, dễ quản lý
- Built-in transform controls
- Event handling tốt
- Performance tốt

**Nhược điểm**:
- Cần refactor rendering system hiện tại
- Có thể conflict với visualizer rendering

### Option B: Hybrid (Khuyến nghị cho giai đoạn đầu)
```
Canvas 1 (existing): Visualizer rendering
Canvas 2 (Fabric.js): Overlay layers (text + images)
```

**Ưu điểm**:
- Giữ nguyên visualizer rendering
- Chỉ thêm overlay canvas
- Dễ tích hợp
- Ít rủi ro

**Nhược điểm**:
- 2 canvas cần sync
- Slightly more complex

### Option C: Konva.js (Alternative)
```
Stage (Konva)
├── Background Layer
├── Visualizer Layer (custom rendering)
├── Album Art Layer
├── Image Layers (Konva.Image)
└── Text Layers (Konva.Text)
```

## 📝 Kế Hoạch Chi Tiết

### Phase 1: Setup & Infrastructure (1-2 ngày)

#### 1.1. Cài đặt thư viện
```bash
npm install fabric
npm install @types/fabric --save-dev
```

#### 1.2. Tạo Layer Manager Service
- File: `src/components/AudioVisualizer/services/LayerManagerService.ts`
- Chức năng:
  - Quản lý Fabric.js canvas instance
  - CRUD operations cho layers
  - Event handling (drag, resize, rotate)
  - Sync với ProjectConfig

#### 1.3. Tạo Layer Types
- Extend `TextLayerConfig` và `ImageLayerConfig` với Fabric.js properties
- File: `src/components/AudioVisualizer/types/LayerTypes.ts`

### Phase 2: UI Components (2-3 ngày)

#### 2.1. Layer Panel Component
- File: `src/components/AudioVisualizer/components/LayerPanelEnhanced.tsx`
- Features:
  - Danh sách layers (text + image)
  - Thêm layer button
  - Xóa layer button
  - Toggle visibility
  - Drag để sắp xếp thứ tự
  - Click để select layer

#### 2.2. Text Editor Component
- File: `src/components/AudioVisualizer/components/TextEditor.tsx`
- Features:
  - Text input
  - Font family selector
  - Font size, weight, style
  - Color picker
  - Gradient editor
  - Stroke settings
  - Shadow settings
  - Glow settings
  - Animation settings

#### 2.3. Image Upload Component
- File: `src/components/AudioVisualizer/components/ImageUpload.tsx`
- Features:
  - File picker
  - Image preview
  - Crop/resize options
  - Image properties editor

#### 2.4. Layer Properties Panel
- File: `src/components/AudioVisualizer/components/LayerPropertiesPanel.tsx`
- Features:
  - Position (X, Y)
  - Scale (X, Y)
  - Rotation
  - Opacity
  - Z-index
  - Blend mode

### Phase 3: Canvas Integration (3-4 ngày)

#### 3.1. Fabric.js Canvas Setup
- File: `src/components/AudioVisualizer/canvas/FabricCanvas.tsx`
- Features:
  - Initialize Fabric.js canvas
  - Overlay trên visualizer canvas
  - Sync với ProjectConfig
  - Event handling

#### 3.2. Text Layer Rendering
- File: `src/components/AudioVisualizer/canvas/TextLayerRenderer.ts`
- Features:
  - Create Fabric.Text objects
  - Apply text styles
  - Apply effects (shadow, glow, gradient, stroke)
  - Handle animations

#### 3.3. Image Layer Rendering
- File: `src/components/AudioVisualizer/canvas/ImageLayerRenderer.ts`
- Features:
  - Create Fabric.Image objects
  - Load images
  - Apply transforms
  - Handle resize/rotate

#### 3.4. Drag & Drop Integration
- Implement drag handlers
- Implement resize handlers
- Implement rotate handlers
- Sync với ProjectConfig

### Phase 4: Delete Layer Functionality (1 ngày)

#### 4.1. Delete Functions
- File: `src/components/AudioVisualizer/hooks/useProjectConfig.ts`
- Add:
  - `deleteTextLayer(id: string)`
  - `deleteImageLayer(id: string)`
  - `reorderLayers(layerIds: string[])`

#### 4.2. UI Integration
- Add delete button trong LayerPanel
- Confirmation dialog
- Update canvas

### Phase 5: Text Effects & Styles (2-3 ngày)

#### 5.1. Text Effects Library
- Research và tích hợp text effects:
  - Gradient text
  - Stroke/outline
  - Shadow (multiple shadows)
  - Glow
  - 3D text (optional)
  - Animated text

#### 5.2. Font Management
- Google Fonts integration
- System fonts
- Custom fonts loading

#### 5.3. Text Animation
- Fade in/out
- Glow pulse
  - Bounce
  - Typewriter
  - Sync with beat

### Phase 6: Testing & Polish (2 ngày)

#### 6.1. Testing
- Test thêm/xóa layers
- Test drag & drop
- Test text editing
- Test image upload
- Test export với layers

#### 6.2. Performance Optimization
- Canvas optimization
- Layer rendering optimization
- Memory management

#### 6.3. UI/UX Polish
- Animations
- Tooltips
- Keyboard shortcuts
- Undo/redo (optional)

## 🔧 Implementation Details

### 1. Layer Manager Service

```typescript
// src/components/AudioVisualizer/services/LayerManagerService.ts
import { fabric } from 'fabric'
import { TextLayerConfig, ImageLayerConfig, ProjectConfig } from '../config/ProjectConfig'

export class LayerManagerService {
  private canvas: fabric.Canvas | null = null
  private project: ProjectConfig | null = null
  
  init(canvasElement: HTMLCanvasElement, project: ProjectConfig) {
    this.canvas = new fabric.Canvas(canvasElement, {
      width: project.canvas.width,
      height: project.canvas.height,
      selection: true,
    })
    this.project = project
    this.setupEventHandlers()
  }
  
  addTextLayer(layer: TextLayerConfig) {
    // Create Fabric.Text object
    // Add to canvas
    // Sync with project
  }
  
  addImageLayer(layer: ImageLayerConfig) {
    // Create Fabric.Image object
    // Add to canvas
    // Sync with project
  }
  
  deleteTextLayer(id: string) {
    // Find and remove from canvas
    // Update project
  }
  
  deleteImageLayer(id: string) {
    // Find and remove from canvas
    // Update project
  }
  
  setupEventHandlers() {
    // Drag events
    // Resize events
    // Rotate events
    // Selection events
  }
}
```

### 2. Enhanced LayerTab Component

```typescript
// src/components/AudioVisualizer/components/LayerTabEnhanced.tsx
export function LayerTabEnhanced({
  project,
  onAddTextLayer,
  onAddImageLayer,
  onDeleteTextLayer,
  onDeleteImageLayer,
  onUpdateTextLayer,
  onUpdateImageLayer,
  onSelectLayer,
  selectedLayerId,
}: LayerTabEnhancedProps) {
  return (
    <div>
      {/* Layer List */}
      <div>
        {project.textLayers.map(layer => (
          <LayerItem
            key={layer.id}
            layer={layer}
            type="text"
            onSelect={() => onSelectLayer(layer.id, 'text')}
            onDelete={() => onDeleteTextLayer(layer.id)}
            onUpdate={(updates) => onUpdateTextLayer(layer.id, updates)}
          />
        ))}
        {project.imageLayers?.map(layer => (
          <LayerItem
            key={layer.id}
            layer={layer}
            type="image"
            onSelect={() => onSelectLayer(layer.id, 'image')}
            onDelete={() => onDeleteImageLayer(layer.id)}
            onUpdate={(updates) => onUpdateImageLayer(layer.id, updates)}
          />
        ))}
      </div>
      
      {/* Add Buttons */}
      <button onClick={() => onAddTextLayer(createDefaultTextLayer())}>
        + Thêm Text
      </button>
      <button onClick={() => onAddImageLayer()}>
        + Thêm Ảnh
      </button>
    </div>
  )
}
```

### 3. Text Editor Component

```typescript
// src/components/AudioVisualizer/components/TextEditor.tsx
export function TextEditor({
  layer,
  onUpdate,
}: {
  layer: TextLayerConfig
  onUpdate: (updates: Partial<TextLayerConfig>) => void
}) {
  return (
    <div>
      <input
        type="text"
        value={layer.text}
        onChange={(e) => onUpdate({ text: e.target.value })}
      />
      <select
        value={layer.fontFamily}
        onChange={(e) => onUpdate({ fontFamily: e.target.value })}
      >
        {/* Font options */}
      </select>
      <input
        type="number"
        value={layer.fontSize}
        onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
      />
      <input
        type="color"
        value={layer.color}
        onChange={(e) => onUpdate({ color: e.target.value })}
      />
      {/* Shadow, Glow, Stroke, Gradient controls */}
    </div>
  )
}
```

## 📦 Dependencies

```json
{
  "dependencies": {
    "fabric": "^5.3.0",
    "react-dnd": "^16.0.1",
    "react-dnd-html5-backend": "^16.0.1"
  },
  "devDependencies": {
    "@types/fabric": "^5.3.0"
  }
}
```

## 🎨 UI Mockup

```
┌─────────────────────────────────────────────────────────┐
│  [Canvas Area]                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Visualizer Canvas (existing)                   │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │  Overlay Canvas (Fabric.js)                │   │   │
│  │  │  - Text Layers (draggable)                │   │   │
│  │  │  - Image Layers (draggable)                │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  [Layer Panel]                    [Properties Panel]    │
│  ┌──────────────────┐            ┌──────────────────┐ │
│  │ Layers:          │            │ Text Editor:      │ │
│  │ ☑ Text 1        │            │ [Text input]     │ │
│  │ ☑ Image 1       │            │ Font: [Select]   │ │
│  │ ☐ Text 2        │            │ Size: [Input]    │ │
│  │                  │            │ Color: [Picker]   │ │
│  │ [+ Thêm Text]    │            │ Shadow: [Toggle] │ │
│  │ [+ Thêm Ảnh]     │            │ ...              │ │
│  └──────────────────┘            └──────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## ✅ Checklist

### Phase 1: Setup
- [ ] Cài đặt Fabric.js
- [ ] Tạo LayerManagerService
- [ ] Tạo LayerTypes

### Phase 2: UI Components
- [ ] LayerPanelEnhanced
- [ ] TextEditor
- [ ] ImageUpload
- [ ] LayerPropertiesPanel

### Phase 3: Canvas Integration
- [ ] FabricCanvas setup
- [ ] TextLayerRenderer
- [ ] ImageLayerRenderer
- [ ] Drag & drop handlers

### Phase 4: Delete Functionality
- [ ] deleteTextLayer
- [ ] deleteImageLayer
- [ ] UI integration

### Phase 5: Text Effects
- [ ] Gradient text
- [ ] Stroke/outline
- [ ] Shadow
- [ ] Glow
- [ ] Animations

### Phase 6: Testing & Polish
- [ ] Testing
- [ ] Performance optimization
- [ ] UI/UX polish

## 🚀 Next Steps

1. **Review và approve kế hoạch**
2. **Cài đặt dependencies**
3. **Bắt đầu Phase 1: Setup & Infrastructure**
4. **Iterative development và testing**

## 📚 References

- Fabric.js Documentation: http://fabricjs.com/
- Konva.js Documentation: https://konvajs.org/
- React-DnD Documentation: https://react-dnd.github.io/react-dnd/


