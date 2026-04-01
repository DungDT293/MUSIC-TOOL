# Phase 2: VisualizerTab Integration Guide

## Changes Needed in `src/features/visualizer/VisualizerTab.tsx`

### 1. Add imports at the top:

```typescript
import { ExportModal, type ExportSettings } from './components/ExportModal'
import { createCanvasExportScene } from './exportConverter'
```

### 2. Add state for ExportModal (around line 176, after `isExporting` state):

```typescript
const [isExporting, setIsExporting] = useState(false)
const [showExportModal, setShowExportModal] = useState(false) // ADD THIS
```

### 3. Replace `exportWebm` function (around line 2898) with Phase 2 handler:

```typescript
// OLD: const exportWebm = useCallback(async () => { ...
// NEW:
const handleOpenExportModal = useCallback(() => {
  // Open export modal instead of directly exporting
  setShowExportModal(true)
}, [])

const handleExportWithSettings = useCallback(async (settings: ExportSettings) => {
  console.log('[Phase 2 Export] Settings:', settings)
  
  // Close modal
  setShowExportModal(false)
  
  // Get current audio track
  const track = audioTracks.find((t) => t.id === primarySelectedTrackId)
  if (!track || !track.filePath) {
    alert('Vui lòng chọn audio trước khi xuất!')
    return
  }
  
  const audioPath = track.filePath
  const audioDuration = track.durationSec
  
  if (!audioDuration || audioDuration <= 0) {
    alert('Không xác định được thời lượng audio!')
    return
  }
  
  try {
    setIsExporting(true)
    
    if (settings.mode === 'wysiwyg') {
      // PHASE 2: WYSIWYG Export (canvas + layers)
      console.log('[Phase 2] Creating canvas export scene...')
      
      // Get current visualizer settings
      let currentPresetKey = presetKey
      let currentPresetName = getPresetDisplayName(currentPresetKey, presetKeys, presetDefs)
      
      // Create canvas export scene
      const scene = createCanvasExportScene({
        width: settings.resolution.width,
        height: settings.resolution.height,
        fps: settings.fps,
        durationSec: audioDuration,
        
        // Visualizer settings
        rendererMode,
        presetKey: currentPresetKey,
        butterchurnPresetName: rendererMode === 'butterchurn' ? currentPresetName : undefined,
        aveeSettings: rendererMode === 'avee' ? {
          waveColor,
          barCount: 64, // default
        } : undefined,
        wavejsSettings: rendererMode === 'wavejs' ? {
          presetId: waveJsPresetId || 'wave',
        } : undefined,
        beatIntensity,
        
        // Layers
        layers,
        
        // Audio
        audioPath,
        normalizeAudio: settings.normalizeAudio,
        audioCodec: undefined, // Let backend detect
      })
      
      console.log('[Phase 2] Scene created:', scene)
      console.log('[Phase 2] Layers count:', scene.layers.length)
      console.log('[Phase 2] Assets count:', Object.keys(scene.assets.images).length)
      
      // Call IPC to export
      const request = {
        requestId: `phase2-export-${Date.now()}`,
        audioSource: { type: 'file' as const, path: audioPath },
        videoSource: { type: 'folder' as const, path: '' }, // Not used in Phase 2
        outputFolder: settings.outputFolder,
        outputFilename: settings.outputFilename,
        shuffle: false,
        forceReencode: false,
        normalizeAudio: settings.normalizeAudio,
        useGpuEncoding: settings.encoder,
        qualityPreset: settings.qualityPreset,
        
        // PHASE 2: Include canvas scene
        canvasScene: scene,
      }
      
      console.log('[Phase 2] Sending export request with canvasScene')
      
      // TODO: Add proper IPC call
      // window.api.invoke('video:final-export:request', request)
      // For now, just log
      alert('Phase 2 Export - Request created! Check console for details.')
      
    } else {
      // LEGACY: Keep old export behavior
      console.log('[Legacy] Using old export pipeline...')
      alert('Legacy export not implemented in this modal yet. Use old button.')
    }
    
  } catch (error) {
    console.error('[Export] Failed:', error)
    alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  } finally {
    setIsExporting(false)
  }
}, [
  audioTracks,
  primarySelectedTrackId,
  rendererMode,
  presetKey,
  presetKeys,
  presetDefs,
  beatIntensity,
  waveColor,
  waveJsPresetId,
  layers,
])
```

### 4. Update VisualizerWorkspace props (around line 3396):

```typescript
<VisualizerWorkspace
  // ... existing props ...
  onExport={handleOpenExportModal} // CHANGE: from exportWebm to handleOpenExportModal
  // ... rest of props ...
/>
```

### 5. Add ExportModal at the end of JSX (before closing `</>`, around line 3537):

```typescript
      {/* Dev-only Group Transform QA overlay removed for production UI */}
      
      {/* PHASE 2: Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportWithSettings}
        defaultAudioPath={audioTracks.find((t) => t.id === primarySelectedTrackId)?.filePath}
        defaultDuration={audioTracks.find((t) => t.id === primarySelectedTrackId)?.durationSec}
      />
    </>
  )
}
```

## Summary of Changes

1. ✅ Import ExportModal and createCanvasExportScene
2. ✅ Add `showExportModal` state
3. ✅ Create `handleOpenExportModal` to open modal
4. ✅ Create `handleExportWithSettings` to process export with settings
5. ✅ Update `onExport` prop to use `handleOpenExportModal`
6. ✅ Add `<ExportModal>` component at end of JSX

## Testing

After integration:
1. Click "Xuất MP4" button in TopBar
2. ExportModal should open
3. Select settings (WYSIWYG, 1080p, 30fps, fast, auto)
4. Click "Xuất Video"
5. Check console logs for:
   - `[Phase 2] Creating canvas export scene...`
   - `[Phase 2] Scene created:`
   - `[Phase 2] Layers count:`
   - `[Phase 2] Sending export request with canvasScene`

## Next Steps

After manual verification:
1. Wire up actual IPC call to backend
2. Add progress dialog during export
3. Add success/error notifications
4. Test with different settings
5. Test legacy mode
