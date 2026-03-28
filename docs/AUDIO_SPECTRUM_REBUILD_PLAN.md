# Kế Hoạch Rebuild Chức Năng Sóng Nhạc - Audio Spectrum Rendering UI

## Mục Tiêu
Xóa toàn bộ code cũ của chức năng sóng nhạc và thiết kế lại hoàn toàn theo UI design mới từ "Audio Spectrum Rendering UI" với:
- Layout "Holy Grail": Left Sidebar, Center Viewport, Right Sidebar, Bottom Timeline
- 3D Particle System với Three.js + React-Three-Fiber
- Custom GLSL Shaders cho visualization
- C++ Native Addon cho FFT analysis (hoặc Web Audio API tạm thời)
- Zustand cho state management
- TailwindCSS cho styling

## Backup
✅ **Đã backup:** `backup_v20251231_153213.zip` (1547.69 MB)

## Cấu Trúc Code Cũ Cần Xóa

### Files/Thư mục cần xóa:
1. `src/pages/Music/AudioVisualizerPage.tsx` - Main page (1808 lines)
2. `src/components/AudioVisualizer/` - Toàn bộ thư mục:
   - `WaveformVisualizer.tsx`
   - `CircularVisualizer.tsx`
   - `ParticlesVisualizer.tsx`
   - `SideBarsVisualizer.tsx`
   - `SpectrumBarsVisualizer.tsx`
   - `WaterRippleVisualizer.tsx`
   - `VisualizerControls.tsx`
   - `VisualizerPresetsPanel.tsx`
   - `visualizers/` - Tất cả visualizers cũ
   - `components/` - Tất cả components cũ
   - `hooks/` - Tất cả hooks cũ
   - `services/` - Tất cả services cũ
   - `parsers/` - Tất cả parsers cũ
   - `canvas/` - Fabric canvas overlay
   - `engine/` - Audio engine cũ
   - `core/` - Core registry cũ
   - `renderers/` - Renderers cũ
   - `audio/` - Audio processor cũ
   - `config/` - Config cũ
   - `controls/` - Controls cũ
   - `utils/` - Utils cũ
   - `types.ts`
   - `AudioAnalyzer.ts`
   - `GradientCache.ts`
   - `LayerPanel.tsx`
   - `useCanvasResize.ts`
   - `useVisualizerConfig.ts`

### Router cần cập nhật:
- `src/router.tsx` - Route `/music/visualizer` sẽ trỏ tới component mới

## Cấu Trúc Code Mới

### 1. Dependencies Cần Cài Đặt
```json
{
  "three": "^0.160.0",
  "@react-three/fiber": "^8.15.0",
  "@react-three/drei": "^9.92.0",
  "zustand": "^4.4.7",
  "framer-motion": "^10.16.16" // (nếu chưa có)
}
```

### 2. Cấu Trúc Thư Mục Mới
```
src/
├── pages/
│   └── Music/
│       └── AudioSpectrumPage.tsx          # Main page mới
└── components/
    └── AudioSpectrum/
        ├── layout/
        │   ├── LeftSidebar.tsx            # Layers/Library/Files tabs
        │   ├── RightSidebar.tsx           # Inspector panel
        │   ├── Viewport.tsx               # 3D Canvas container
        │   └── Timeline.tsx              # Bottom timeline
        ├── viewport/
        │   ├── Viewport3D.tsx             # Three.js Canvas
        │   ├── ParticleSphere.tsx         # 3D Particle Sphere component
        │   └── shaders/
        │       ├── particle.vert.glsl     # Vertex shader
        │       └── particle.frag.glsl     # Fragment shader
        ├── sidebar/
        │   ├── LayerPanel.tsx              # Layers tab
        │   ├── LibraryPanel.tsx           # Library tab
        │   ├── FilesPanel.tsx              # Files tab
        │   └── InspectorPanel.tsx         # Inspector controls
        ├── timeline/
        │   ├── TimelineControls.tsx       # Play/Pause/Skip
        │   ├── TimeRuler.tsx              # Time markers
        │   └── WaveformDisplay.tsx        # Audio waveform
        ├── store/
        │   └── useAudioSpectrumStore.ts   # Zustand store
        └── engine/
            ├── AudioEngine.ts             # Web Audio API wrapper
            ├── FFTProcessor.ts            # FFT analysis (Web Audio hoặc C++ bridge)
            └── native/
                └── fft-addon.cpp          # C++ Native Addon (tùy chọn)
```

## Implementation Plan

### Phase 1: Setup & Dependencies (30 phút)
1. ✅ Backup code hiện tại
2. Cài đặt dependencies: `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`
3. Kiểm tra TailwindCSS đã có chưa

### Phase 2: Xóa Code Cũ (15 phút)
1. Xóa `src/pages/Music/AudioVisualizerPage.tsx`
2. Xóa toàn bộ `src/components/AudioVisualizer/`
3. Cập nhật `src/router.tsx` để remove route cũ (tạm thời comment)

### Phase 3: Tạo Cấu Trúc Mới (20 phút)
1. Tạo thư mục `src/components/AudioSpectrum/`
2. Tạo các file cơ bản: `AudioSpectrumPage.tsx`, layout components
3. Setup Zustand store cơ bản

### Phase 4: UI Layout (2 giờ)
1. **LeftSidebar**: Tabs (Layers/Library/Files), Search bar, Grid list
2. **RightSidebar**: Inspector với controls (Bar Count, Bar Width, Spacing, Sensitivity)
3. **Viewport**: Container cho 3D Canvas
4. **Timeline**: Play/Pause controls, Time ruler, Waveform visualization

### Phase 5: Three.js Setup (1 giờ)
1. Setup React-Three-Fiber Canvas trong Viewport
2. Setup Camera, Lights, Scene
3. Test render cơ bản

### Phase 6: 3D Particle Sphere (3 giờ)
1. Tạo `ParticleSphere.tsx` component
2. Generate 10,000 points trên sphere
3. Tạo Custom ShaderMaterial với:
   - Vertex Shader: Displace vertices dựa trên frequency
   - Fragment Shader: Mix colors (Blue → Pink) dựa trên displacement
4. Pass uniforms: `u_frequency`, `u_sensitivity`

### Phase 7: Audio Engine Integration (2 giờ)
1. Tạo `AudioEngine.ts` với Web Audio API
2. FFT analysis để lấy frequency data
3. Kết nối frequency data với shader uniforms
4. Real-time update khi audio playing

### Phase 8: UI Controls Integration (1 giờ)
1. Kết nối Inspector controls với Zustand store
2. Pass store values vào shader uniforms
3. Test real-time updates

### Phase 9: Timeline & Waveform (2 giờ)
1. Implement Timeline với Play/Pause
2. Time ruler với markers
3. Waveform visualization từ audio data
4. Seek functionality

### Phase 10: Polish & Testing (1 giờ)
1. Theme colors: Dark (#1E1E1E), Neon Blue (#00E5FF), Neon Pink (#F43F5E)
2. Performance optimization
3. Testing với các file audio khác nhau

## Lưu Ý Quan Trọng

### Không Ảnh Hưởng Chức Năng Khác
- ✅ Chỉ xóa code trong `src/components/AudioVisualizer/` và `src/pages/Music/AudioVisualizerPage.tsx`
- ✅ Không động vào các chức năng khác
- ✅ Router sẽ được cập nhật để trỏ tới component mới

### C++ Native Addon (Tùy Chọn)
- Nếu chưa setup C++ compiler, có thể dùng Web Audio API tạm thời
- Cấu trúc code sẽ sẵn sàng để tích hợp C++ addon sau

### Performance
- 10,000 particles có thể nặng, cần optimize:
  - Use instanced rendering
  - LOD (Level of Detail)
  - Throttle updates nếu cần

## Timeline Tổng Thể
- **Phase 1-3**: 1 giờ 5 phút
- **Phase 4**: 2 giờ
- **Phase 5**: 1 giờ
- **Phase 6**: 3 giờ
- **Phase 7**: 2 giờ
- **Phase 8**: 1 giờ
- **Phase 9**: 2 giờ
- **Phase 10**: 1 giờ

**Tổng cộng:** ~13 giờ (có thể chia nhỏ theo từng phase)

## Next Steps
1. Bắt đầu Phase 1: Cài đặt dependencies
2. Phase 2: Xóa code cũ
3. Phase 3: Tạo cấu trúc mới
4. Tiếp tục các phase tiếp theo...



