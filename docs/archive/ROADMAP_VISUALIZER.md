> ⚠️ **OUTDATED NOTICE** (Cập nhật: 2026-03-28)
>
> Roadmap này được viết **trước khi pivot** sang custom canvas pipeline (Jan 2025).
> - **Fabric.js KHÔNG được sử dụng** trong codebase hiện tại
> - **Hầu hết features Phase 1-8 đã SHIP** — xem `src/features/song-nhac/` để biết trạng thái thực
> - Roadmap này chỉ có giá trị lịch sử, KHÔNG phản ánh implementation hiện tại
>
> ---

# Roadmap Phát Triển Chức Năng Tạo Sóng Nhạc

## 📊 Tổng Quan

Dựa trên nghiên cứu các app nổi tiếng (Avee Player, Spotify Canvas, MilkDrop, GLava, AudioMotion) và các thư viện mã nguồn mở, đây là roadmap chi tiết để phát triển chức năng tạo sóng nhạc chuyên nghiệp.

## ✅ Đã Hoàn Thành

### Phase 1: Setup & Infrastructure ✅
- [x] Cài đặt Fabric.js, react-dnd
- [x] Tạo LayerManagerService
- [x] Thêm delete functions (deleteTextLayer, deleteImageLayer)
- [x] Tạo helper functions (createDefaultTextLayer, createDefaultImageLayer)

### Phase 2: UI Components ✅
- [x] LayerTabEnhanced component
- [x] Layer list với add/delete buttons
- [x] Layer visibility toggle
- [x] Selected layer highlighting
- [x] IPC integration (selectImageFile)

### Phase 3: Fabric.js Canvas Integration 🔄
- [x] FabricCanvasOverlay component
- [x] LayerManagerService integration
- [x] Basic canvas setup
- [ ] Sync với ProjectConfig (đang làm)
- [ ] Drag & drop handlers

## 🚧 Đang Phát Triển

### Phase 4: Drag & Drop trên Canvas
**Mục tiêu:** Cho phép drag & drop layers trực tiếp trên canvas như phần mềm edit chuyên nghiệp

**Tasks:**
- [ ] Implement drag handlers trong Fabric.js
- [ ] Sync position với ProjectConfig khi drag
- [ ] Visual feedback khi drag (highlight, guides)
- [ ] Snap to grid (optional)
- [ ] Multi-select layers (optional)

**Thời gian ước tính:** 2-3 ngày

### Phase 5: Text Editor Component
**Mục tiêu:** Text editor đầy đủ với nhiều kiểu chữ và hiệu ứng

**Tasks:**
- [ ] Text input component
- [ ] Font selector (Google Fonts, system fonts)
- [ ] Font size, weight, style controls
- [ ] Color picker
- [ ] Gradient editor
- [ ] Stroke/outline settings
- [ ] Shadow settings (multiple shadows)
- [ ] Glow settings
- [ ] Text alignment controls
- [ ] Letter spacing, line height

**Thời gian ước tính:** 3-4 ngày

### Phase 6: Image Upload & Management
**Mục tiêu:** Upload, preview, và quản lý image layers

**Tasks:**
- [ ] Image upload component
- [ ] Image preview
- [ ] Image properties editor
- [ ] Image transform controls (position, scale, rotation)
- [ ] Image effects (blur, brightness, contrast, saturation)
- [ ] Image masking (optional)

**Thời gian ước tính:** 2-3 ngày

## 📅 Kế Hoạch Các Phase Tiếp Theo

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

**Thời gian ước tính:** 4-5 ngày

### Phase 8: Advanced Visualizations
**Mục tiêu:** Thêm nhiều visualization modes và presets

**Features:**
- More visualization presets
- Custom visualization builder
- Shader-based effects (WebGL)
- Particle systems
- 3D visualizations
- Custom color schemes
- Gradient backgrounds

**Thư viện đề xuất:**
- Three.js cho 3D
- PixiJS cho WebGL 2D
- Custom shaders

**Thời gian ước tính:** 5-7 ngày

### Phase 9: Preset System
**Mục tiêu:** Hệ thống preset và template

**Features:**
- Preset library
- Custom preset creation
- Preset sharing (JSON export/import)
- Template system
- Quick apply presets
- Preset categories

**Thời gian ước tính:** 3-4 ngày

### Phase 10: Audio Features
**Mục tiêu:** Nâng cao tính năng audio

**Features:**
- Multiple audio sources
- Audio effects:
  - Reverb
  - Delay
  - Echo
  - Distortion
  - Filter
- Beat detection improvements
- Frequency band isolation
- Audio-reactive layer animations

**Thư viện đề xuất:**
- Web Audio API
- Tone.js (optional)

**Thời gian ước tính:** 4-5 ngày

### Phase 11: Performance Optimization
**Mục tiêu:** Tối ưu hiệu suất

**Tasks:**
- WebGL acceleration
- Canvas optimization
- Memory management
- Frame rate optimization
- GPU utilization
- Offscreen canvas for export
- Worker threads for heavy computations

**Thời gian ước tính:** 3-4 ngày

### Phase 12: Export Improvements
**Mục tiêu:** Cải thiện export

**Features:**
- Multiple export formats (MP4, WebM, GIF)
- Custom export settings
- Batch export
- Social media optimization
- Direct upload to platforms (optional)
- Export presets

**Thời gian ước tính:** 2-3 ngày

### Phase 13: UI/UX Polish
**Mục tiêu:** Cải thiện giao diện và trải nghiệm

**Features:**
- Layer panel improvements:
  - Drag & drop reordering
  - Layer thumbnails
  - Quick actions (duplicate, lock, hide)
  - Layer groups
- Properties panel:
  - Context-aware properties
  - Real-time preview
  - Keyboard shortcuts
  - Value sliders with live preview
- Canvas controls:
  - Zoom in/out
  - Pan
  - Grid overlay
  - Snap to grid
  - Rulers
- Timeline (future):
  - Animation timeline
  - Keyframe editing
  - Layer timing

**Thời gian ước tính:** 5-6 ngày

### Phase 14: Documentation & Testing
**Mục tiêu:** Tài liệu và testing

**Tasks:**
- Code documentation
- User guide
- API documentation
- Unit tests
- Integration tests
- E2E tests
- Performance tests

**Thời gian ước tính:** 4-5 ngày

## 🎯 Ưu Tiên Phát Triển

### High Priority (Q1 2025)
1. ✅ Phase 1-2: Setup & UI Components
2. 🔄 Phase 3-4: Canvas Integration & Drag & Drop
3. ⏳ Phase 5-6: Text Editor & Image Management
4. ⏳ Phase 7: Text Effects & Animations

### Medium Priority (Q2 2025)
5. Phase 8: Advanced Visualizations
6. Phase 9: Preset System
7. Phase 10: Audio Features

### Low Priority (Q3 2025)
8. Phase 11: Performance Optimization
9. Phase 12: Export Improvements
10. Phase 13: UI/UX Polish
11. Phase 14: Documentation & Testing

## 📚 Thư Viện & Công Cụ

### Đã Tích Hợp
- ✅ Butterchurn (MilkDrop visualizations)
- ✅ AudioMotion Analyzer (Spectrum analysis)
- ✅ Fabric.js (Canvas manipulation) - Đang tích hợp

### Cần Tích Hợp
- [ ] GSAP (Animations)
- [ ] Three.js (3D effects, optional)
- [ ] PixiJS (WebGL 2D, optional)
- [ ] react-dnd (UI drag & drop) - Đã cài

## 🎨 Tính Năng So Sánh Với Các App Nổi Tiếng

| Tính Năng | Avee Player | Spotify Canvas | MilkDrop | Chúng Ta |
|-----------|-------------|----------------|----------|----------|
| Multi-layer | ✅ | ✅ | ❌ | ✅ |
| Text Layers | ✅ | ✅ | ❌ | ✅ |
| Image Layers | ✅ | ✅ | ❌ | ✅ |
| Drag & Drop | ✅ | ❌ | ❌ | 🔄 |
| Text Effects | ✅ | ✅ | ❌ | ⏳ |
| Presets | ✅ | ❌ | ✅ | ⏳ |
| Export Video | ✅ | ❌ | ❌ | ✅ |
| Audio Effects | ❌ | ❌ | ❌ | ⏳ |
| 3D Effects | ✅ | ❌ | ✅ | ⏳ |

## 📝 Next Steps (Immediate)

1. **Hoàn thiện Fabric.js Integration**
   - Sync với ProjectConfig
   - Implement drag & drop handlers
   - Test với text và image layers

2. **Text Editor Component**
   - Tạo component với các controls cơ bản
   - Tích hợp với LayerTabEnhanced
   - Test với real-time preview

3. **Image Management**
   - Hoàn thiện upload component
   - Preview component
   - Properties editor

4. **Testing**
   - Test tất cả features
   - Fix bugs
   - Performance testing

## 🚀 Long-term Vision

Tạo một công cụ tạo sóng nhạc chuyên nghiệp với:
- ✅ Multi-layer support
- ✅ Rich text editing
- ✅ Image management
- ✅ Drag & drop
- ✅ Preset system
- ✅ High-quality export
- ✅ Performance optimization
- ✅ User-friendly UI

Cạnh tranh với các app thương mại như Avee Player nhưng với mã nguồn mở và tích hợp vào tool hiện tại.


