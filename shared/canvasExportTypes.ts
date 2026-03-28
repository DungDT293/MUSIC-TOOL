/**
 * PHASE 2: Canvas Export Types
 * 
 * Defines the contract between Frontend (Visualizer canvas) and Backend (Export engine)
 * for rendering video with full layer compositing
 */

/**
 * Complete scene description for canvas export
 * Frontend should send this to backend for offline rendering
 */
export interface CanvasExportScene {
  // Output settings
  width: number
  height: number
  fps: number
  durationSec: number
  
  // Visualizer configuration
  visualizer: VisualizerConfig
  
  // Layers (images, text, shapes)
  layers: CanvasExportLayer[]
  
  // Asset manifest (images, fonts)
  assets: AssetManifest
  
  // Audio configuration
  audio: AudioConfig
}

/**
 * Visualizer renderer configuration
 */
export interface VisualizerConfig {
  mode: 'butterchurn' | 'avee' | 'wavejs'
  
  // Butterchurn-specific
  butterchurn?: {
    presetKey: string
    presetName: string
    // Could include preset JSON if needed
  }
  
  // Avee-specific
  avee?: {
    presetKey: string
    waveColor: string
    barCount: number
    // Add other Avee settings
  }
  
  // Wave.js-specific
  wavejs?: {
    presetId: string
    // Add other Wave.js settings
  }
  
  // Common settings
  beatIntensity?: number
  smoothing?: number
}

/**
 * Layer definition for export
 * Based on frontend Layer type but simplified for export
 */
export interface CanvasExportLayer {
  id: string
  type: 'image' | 'text' | 'group'
  visible: boolean
  locked: boolean
  
  // Timeline
  startTime?: number // seconds (undefined = always visible)
  endTime?: number   // seconds (undefined = visible until end)
  
  // Transform (canvas center coordinates)
  transform: {
    x: number          // center-relative (0 = canvas center)
    y: number          // center-relative (0 = canvas center)
    scaleX: number
    scaleY: number
    rotation: number   // radians
    anchorX: number    // 0-1 (0.5 = center)
    anchorY: number    // 0-1 (0.5 = center)
  }
  
  // Visual properties
  opacity: number      // 0-1
  blendMode?: string   // 'normal', 'multiply', 'screen', etc.
  
  // Image layer specific
  image?: {
    assetId: string    // Reference to AssetManifest
    width: number      // Original image width
    height: number     // Original image height
    maskShape?: 'none' | 'circle' | 'square' | 'triangle' | 'star' | 'hex'
    cornerRadius?: number
    
    // Filters
    filter?: {
      blur?: number
      brightness?: number
      contrast?: number
      saturation?: number
      hueRotate?: number
      grayscale?: boolean
    }
    
    // Beat zoom effect
    beatZoom?: {
      enabled: boolean
      strength: number  // 0-2, default 0.8
    }
  }
  
  // Text layer specific
  text?: {
    content: string
    fontSize: number
    fontFamily: string
    fontPath?: string  // Path to font file (if custom font)
    fontWeight: string // 'normal', 'bold', etc.
    color: string      // CSS color
    textAlign: 'left' | 'center' | 'right'
    letterSpacing?: number
    lineHeight?: number
    maxWidth?: number
    
    // Text effects
    stroke?: {
      color: string
      width: number
    }
    shadow?: {
      color: string
      blur: number
      offsetX: number
      offsetY: number
    }
  }
  
  // Group layer specific
  group?: {
    children: string[] // IDs of child layers
  }
  
  // Audio reactivity (PHASE 2.1 - not implemented in MVP)
  audioReactive?: {
    enabled: boolean
    pulseOnBeat?: boolean
    scaleWithAmplitude?: boolean
    rotateWithBass?: boolean
  }
}

/**
 * Asset manifest - maps asset IDs to file paths
 */
export interface AssetManifest {
  images: {
    [assetId: string]: {
      path: string       // Absolute path to image file
      width: number
      height: number
      format: string     // 'png', 'jpg', 'webp', etc.
    }
  }
  
  fonts?: {
    [fontFamily: string]: {
      path: string       // Absolute path to font file
      format: string     // 'ttf', 'otf', 'woff', etc.
    }
  }
}

/**
 * Audio configuration for export
 */
export interface AudioConfig {
  path: string           // Absolute path to audio file
  normalize: boolean     // Apply loudnorm filter
  codec?: string         // Detected codec (for smart copy)
  
  // Precomputed audio features (PHASE 2.1)
  features?: {
    waveform: number[][]    // Amplitude per frame
    spectrum: number[][]    // FFT per frame
    beats: number[]         // Beat timestamps
  }
}

/**
 * Render state at a specific time
 * Output of timelineResolver.evalAtTime()
 */
export interface RenderState {
  time: number           // Current time in seconds
  frameIndex: number     // Current frame number
  
  // Visualizer state
  visualizer: {
    mode: 'butterchurn' | 'avee' | 'wavejs'
    // Mode-specific state will be added as needed
  }
  
  // Active layers (filtered by time, sorted by z-order)
  activeLayers: CanvasExportLayer[]
  
  // Audio data at this time (if precomputed)
  audio?: {
    amplitude: number
    spectrum?: number[]
    beat?: number
  }
}

/**
 * Export progress event
 */
export interface CanvasExportProgress {
  phase: 'setup' | 'analyze' | 'render' | 'encode' | 'done'
  percent: number        // 0-100
  frameIndex?: number
  totalFrames?: number
  message?: string
}
