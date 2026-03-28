# Execution Plan - Audio Spectrum Rebuild

## ✅ Completed
1. ✅ Backup code hiện tại: `backup_v20251231_153213.zip`
2. ✅ Cài đặt dependencies: `three`, `@react-three/fiber@8.15.0`, `@react-three/drei@9.92.0`, `zustand`, `lucide-react`, `vite-plugin-glsl`
3. ✅ Xóa code cũ: `AudioVisualizerPage.tsx` và toàn bộ thư mục `AudioVisualizer/`
4. ✅ Tạo cấu trúc mới: `src/components/AudioSpectrum/` với đầy đủ layout, viewport, sidebar, store, engine
5. ✅ Implement UI Layout:
   - ✅ LeftSidebar với 3 tabs: Layers, Library, Files
   - ✅ RightSidebar (Inspector) với controls
   - ✅ Viewport với 3D Canvas
   - ✅ Timeline với Play/Pause, Time Ruler, Waveform
6. ✅ Setup Three.js + React-Three-Fiber
7. ✅ Implement 3D Particle Sphere với Custom Shaders (10,000 particles)
8. ✅ Audio Engine với Web Audio API và FFT analysis
9. ✅ Kết nối Audio Engine với Visualization
10. ✅ Kết nối UI Controls với Zustand Store và Shader Uniforms
11. ✅ Cấu hình Vite cho GLSL shader loading

## 📁 Cấu Trúc Đã Tạo

```
src/components/AudioSpectrum/
├── layout/
│   ├── LeftSidebar.tsx
│   ├── RightSidebar.tsx
│   ├── Viewport.tsx
│   └── Timeline.tsx
├── sidebar/
│   ├── LayerPanel.tsx
│   ├── LibraryPanel.tsx
│   ├── FilesPanel.tsx
│   └── InspectorPanel.tsx
├── viewport/
│   ├── Viewport3D.tsx
│   ├── ParticleSphere.tsx
│   └── shaders/
│       ├── particle.vert.glsl
│       └── particle.frag.glsl
├── store/
│   └── useAudioSpectrumStore.ts
├── engine/
│   └── AudioEngine.ts
└── hooks/
    └── useAudioEngine.ts

src/pages/Music/
└── AudioSpectrumPage.tsx (NEW - thay thế AudioVisualizerPage.tsx)
```

## 🔄 Next Steps (Optional Enhancements)

### Step 1: Xóa Code Cũ
**Files cần xóa:**
- `src/pages/Music/AudioVisualizerPage.tsx`
- `src/components/AudioVisualizer/` (toàn bộ thư mục)

**Router update:**
- Comment route cũ trong `src/router.tsx`:
  ```tsx
  // <Route path="/music/visualizer" element={<AudioVisualizerPage />} />
  ```

### Step 2: Tạo Cấu Trúc Mới
**Tạo thư mục:**
```
src/components/AudioSpectrum/
├── layout/
├── viewport/
├── sidebar/
├── timeline/
├── store/
└── engine/
```

### Step 3: Tạo Main Page
**File:** `src/pages/Music/AudioSpectrumPage.tsx`
- Import layout components
- Setup Zustand store
- Render Holy Grail layout

### Step 4: Implement Layout Components
1. **LeftSidebar** - Layers/Library/Files tabs
2. **RightSidebar** - Inspector panel với controls
3. **Viewport** - 3D Canvas container
4. **Timeline** - Play/Pause, Time ruler, Waveform

### Step 5: Three.js Setup
- React-Three-Fiber Canvas
- Camera, Lights, Scene
- Basic render test

### Step 6: 3D Particle Sphere
- Custom ShaderMaterial
- Vertex & Fragment shaders
- 10,000 particles
- Frequency-based displacement

### Step 7: Audio Integration
- Web Audio API
- FFT analysis
- Real-time frequency data
- Connect to shader uniforms

### Step 8: UI Controls Integration
- Zustand store
- Inspector controls → store → shader uniforms

### Step 9: Timeline & Waveform
- Play/Pause controls
- Time ruler
- Waveform visualization
- Seek functionality

## ⚠️ Important Notes

1. **Không xóa code cho đến khi bạn xác nhận**
2. **Backup đã được tạo**, có thể restore nếu cần
3. **Router sẽ được cập nhật** để trỏ tới component mới
4. **Các chức năng khác không bị ảnh hưởng**

## 🎯 Ready to Proceed?

Bạn có muốn tôi tiếp tục với việc:
1. Xóa code cũ?
2. Tạo cấu trúc mới?
3. Implement từng component theo kế hoạch?

Hay bạn muốn xem lại kế hoạch trước?


