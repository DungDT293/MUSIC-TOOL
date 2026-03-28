# Prompt cho Cursor: Implement .viz File Parser (Avee Player)

## Phân tích Format .viz

File .viz của Avee Player là **ZIP archive** chứa:
```
├── scene.json      # Main configuration (JSON)
├── 15662           # Image asset (JPEG, no extension)
├── 3884            # Image asset (JPEG, no extension)
└── ...             # Other assets
```

## Cấu trúc scene.json

```json
{
  "ver": "...",
  "template": "...",
  "objType": "Scene",
  "compositions": [
    {
      "elements": [
        { "objType": "AudioProvider", ... },
        { "objType": "Image", ... },
        { "objType": "Bars", ... },
        { "objType": "Particles", ... },
        { "objType": "BlurEffect", ... },
        { "objType": "AppLogo", ... }
      ]
    }
  ]
}
```

## Object Types cần support

### 1. AudioProvider (Audio Settings)
```json
{
  "objType": "AudioProvider",
  "sampleProvider": { "v": "Spectrum2" },        // Waveform | Spectrum | Spectrum2
  "sampleOutCount": { "v": 200 },                // FFT size (0-512)
  "lowerHz": { "v": 7.5 },                       // Min frequency
  "higherHz": { "v": 3840 },                     // Max frequency  
  "hzLinearFactor": { "v": 0.075 },              // Frequency scale
  "freqShift": { "v": 1 },                       // Shift (0-1)
  "mirrorSamples": { "v": 1 },                   // Boolean
  "repeatSamples": { "v": 1 },                   // 1-6
  "smooth": { "v": 1 },                          // Smoothing (0.1-1)
  "filterRadius": { "v": 17 },                   // Filter radius (0-20)
  "filterStrength": { "v": 1.4 },                // Filter strength (0.1-2)
  "beatSmooth": { "v": 0.4 },                    // Beat smoothing
  "beatRangeBarFirst": { "v": 0 },               // Beat range start
  "beatRangeBarLast": { "v": 0.15 },             // Beat range end
  "lowerFreqMagnitude": { "v": 0.275 },          // Bass boost
  "outputMultiplier": { "v": 0.463 }             // Output gain
}
```

### 2. Image Layer
```json
{
  "objType": "Image",
  "visible": { "v": 1 },                         // Boolean
  "blendMode": { "v": "Alpha" },                 // Alpha|PreMulAlpha|Screen|Add|AddAlpha
  "position": { "v": "0.500000 0.500000" },      // x y (0-1)
  "scale": { "v": "1.100000 1.100000" },         // scaleX scaleY
  "rotation": { "v": 0 },                        // Degrees
  "customImage": { "v": "local:3884" },          // Reference to asset file
  "keepAspectRatio": { "v": 1 },
  "blurredBorder": { "v": 1 },
  "Color": { "v": "0.0 0.0 0.564706 1.0" },      // HSLA
  "saturation": { "v": "Beat 2.0 1.0;Constant 1.0 0.0" },  // Audio reactive
  
  // Transform modifiers (audio reactive)
  "MeasurePos": {
    "measureWhat": { "v": "ConstantShake" },     // Nothing|Beat|TotalTime|ConstantShake|...
    "A": { "v": 0.5, "hint": "Amount" },
    "B": { "v": 0.2, "hint": "Speed" }
  },
  "measureScale": {
    "measureWhat": { "v": "Beat" },
    "A": { "v": 0.25, "hint": "X Amount" },
    "B": { "v": 0.25, "hint": "Y Amount" }
  },
  "measureRot": {
    "measureWhat": { "v": "ConstantShakeRotLess" },
    "A": { "v": 0.1, "hint": "Amount" },
    "B": { "v": 0.2, "hint": "Speed" }
  }
}
```

### 3. Bars Layer (Visualizer Bars)
```json
{
  "objType": "Bars",
  "_name": "Bars/Segments",
  "visible": { "v": 1 },
  "blendMode": { "v": "Alpha" },
  "position": { "v": "0.500000 0.500000" },
  "scale": { "v": "0.395000 0.395000" },
  "rotation": { "v": 0 },
  
  // Bars specific
  "flipInput": { "v": 0 },                       // Flip spectrum
  "heightScale": { "v": 5.5 },                   // Bar height multiplier
  "minHeightScale": { "v": 0.01 },               // Min height
  "maxHeightScale": { "v": 1 },                  // Max height
  
  // Shape path
  "ShapePath": {
    "v": "Circle",                               // HorizontalLine|Circle|SidedPolygon|Letter
    "radius": { "v": 1 },
    "gap": { "v": 0 }
  },
  
  // Softness & reaction
  "softness": { "v": 16 },                       // 0-20
  "reactionDelay": { "v": 12 },                  // 0-9
  
  // Segment styles
  "Segment1": {
    "v": "Line",                                 // None|Bars|Line|SharpBars|RoundBars
    "colorFrom": { "v": -1 },                    // ARGB int
    "colorTo": { "v": -1 },
    "fixedHeight": { "v": 0 },
    "barHeightMultiplier": { "v": 1 },
    "mirror": { "v": 0 },
    "flipEveryOther": { "v": 0 }
  },
  "Segment2": { "v": "None" },
  
  // Audio reactive scale
  "measureScale": {
    "measureWhat": { "v": "Beat" },
    "A": { "v": 0.25 },
    "B": { "v": 0.25 }
  }
}
```

### 4. Particles Layer
```json
{
  "objType": "Particles",
  "visible": { "v": 1 },
  "blendMode": { "v": "Add" },
  "position": { "v": "0.500000 0.500000" },
  "scale": { "v": "0.500000 0.500000" },
  
  // Particle settings
  "customImage": { "v": "internalres:particle_blur01" },
  "color": { "v": -1 },                          // ARGB
  "CountLimit": { "v": 1500 },                   // Max particles
  "particleScale": { "v": 2 },                   // Size multiplier
  "spawnTime": { "v": 0.02 },                    // Spawn interval
  
  // Movement
  "Speed": { "v": 100 },
  "speedRandom": { "v": 60 },
  "lifetime": { "v": 8 },
  "gravity": { "v": "0.0 0.0" },
  
  // Spawn area
  "SpawnArea": {
    "v": "Rectangle",                            // HorizontalLine|Rectangle
    "vectorAngle": { "v": 270 },
    "vectorAngleZ": { "v": 1 }
  },
  
  // Appearance
  "ColorFrom": { "v": "1.0 1.0 1.0 1.0" },       // HSLA
  "ColorTo": { "v": "0.0 0.0 0.5 0.5" },
  "fadeInAndOutTime": { "v": 0.1 },
  "startSize": { "v": 0 },
  "fadeInSize": { "v": 4 },
  "endSize": { "v": 4 },
  "endSizeRandom": { "v": 10 },
  
  // 3D perspective
  "perspectiveDepth": { "v": 900 },
  "perspectiveFov": { "v": 150 },
  
  // Audio reactive
  "MeasureOverallSpeed": {
    "measureWhat": { "v": "Beat" },
    "A": { "v": 1.5 },
    "B": { "v": 1.5 }
  }
}
```

### 5. BlurEffect
```json
{
  "objType": "BlurEffect",
  "visible": { "v": 1 },
  "blendMode": { "v": "Add" },
  "position": { "v": "0.500000 0.500000" },
  // ... similar transform properties
}
```

## Value Format Conventions

| Type | Format | Example |
|------|--------|---------|
| `v` | Actual value | `"v": 1` |
| `t` | Type hint + constraints | `"t": "f 0.0 1.0"` = float 0-1 |
| `o` | Order/index | `"o": 0` |
| `tag` | Category | `"tag": "0_general"` |

**Type hints:**
- `b` = boolean (0/1)
- `i min max` = integer range
- `f min max` = float range
- `f2 min max` = float2 (x y)
- `crgba` = color as ARGB int
- `chsla4f` = color as "H S L A" floats
- `sel opt1 opt2...` = enum selection
- `_child opt1 opt2...` = nested object type
- `img ...` = image reference
- `mvarf min max` = modulated value (audio reactive)

**Image references:**
- `local:3884` = asset file "3884" in zip
- `internalres:particle_blur01` = built-in resource
- `composition:0` = reference to composition

**Modulated values (mvarf):**
Format: `"Type Amount Offset;Type Amount Offset;..."`
- `Beat 2.0 1.0` = React to beat, amount 2, offset 1
- `Constant 1.0 0.0` = Constant value
- `TotalTime 0.5 0.0` = Animate over time

## Implementation Files

### 1. Tạo: src/components/AudioVisualizer/parsers/VizFileParser.ts

```typescript
import JSZip from 'jszip'

export interface VizProject {
  version: string
  template: string
  audioSettings: VizAudioSettings
  layers: VizLayer[]
  assets: Map<string, Blob>  // assetId -> image blob
}

export interface VizAudioSettings {
  sampleProvider: 'Waveform' | 'Spectrum' | 'Spectrum2'
  sampleOutCount: number
  lowerHz: number
  higherHz: number
  hzLinearFactor: number
  freqShift: number
  mirrorSamples: boolean
  repeatSamples: number
  smooth: number
  filterRadius: number
  filterStrength: number
  beatSmooth: number
  beatRangeBarFirst: number
  beatRangeBarLast: number
  lowerFreqMagnitude: number
  outputMultiplier: number
}

export interface VizLayer {
  id: number
  type: 'Image' | 'Bars' | 'Particles' | 'BlurEffect' | 'AppLogo'
  name: string
  visible: boolean
  blendMode: 'Alpha' | 'PreMulAlpha' | 'Screen' | 'Add' | 'AddAlpha'
  position: { x: number; y: number }
  scale: { x: number; y: number }
  rotation: number
  
  // Audio reactive modifiers
  measurePosition?: VizMeasure
  measureScale?: VizMeasure
  measureRotation?: VizMeasure
  
  // Type-specific properties
  image?: VizImageConfig
  bars?: VizBarsConfig
  particles?: VizParticlesConfig
}

export interface VizMeasure {
  type: 'Nothing' | 'Beat' | 'TotalTime' | 'ConstantShake' | 'BeatCamShake' | string
  amountX: number
  amountY: number
  speed?: number
}

export interface VizImageConfig {
  source: string  // asset id or internal resource
  keepAspectRatio: boolean
  blurredBorder: boolean
  color: { h: number; s: number; l: number; a: number }
  saturation: VizModulatedValue[]
}

export interface VizBarsConfig {
  shapePath: 'HorizontalLine' | 'Circle' | 'SidedPolygon' | 'Letter'
  radius: number
  gap: number
  heightScale: number
  minHeightScale: number
  maxHeightScale: number
  flipInput: boolean
  softness: number
  reactionDelay: number
  segments: VizBarSegment[]
}

export interface VizBarSegment {
  style: 'None' | 'Bars' | 'Line' | 'SharpBars' | 'RoundBars'
  colorFrom: number  // ARGB
  colorTo: number
  heightMultiplier: number
  mirror: boolean
  flipEveryOther: boolean
}

export interface VizParticlesConfig {
  image: string
  color: number
  countLimit: number
  particleScale: number
  spawnTime: number
  speed: number
  speedRandom: number
  lifetime: number
  gravity: { x: number; y: number }
  spawnArea: 'HorizontalLine' | 'Rectangle'
  colorFrom: { h: number; s: number; l: number; a: number }
  colorTo: { h: number; s: number; l: number; a: number }
  fadeInOutTime: number
  startSize: number
  endSize: number
  perspectiveDepth: number
  perspectiveFov: number
  measureSpeed?: VizMeasure
}

export interface VizModulatedValue {
  type: 'Beat' | 'Constant' | 'TotalTime' | string
  amount: number
  offset: number
}

export class VizFileParser {
  async parse(file: File): Promise<VizProject> {
    const zip = await JSZip.loadAsync(file)
    
    // Read scene.json
    const sceneFile = zip.file('scene.json')
    if (!sceneFile) throw new Error('Invalid .viz file: missing scene.json')
    
    const sceneJson = await sceneFile.async('string')
    const scene = JSON.parse(sceneJson)
    
    // Extract assets
    const assets = new Map<string, Blob>()
    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (filename !== 'scene.json' && !zipEntry.dir) {
        const blob = await (zipEntry as JSZip.JSZipObject).async('blob')
        assets.set(filename, blob)
      }
    }
    
    // Parse elements
    const elements = scene.compositions?.[0]?.elements || []
    
    return {
      version: scene.ver || '1.0',
      template: scene.template || '',
      audioSettings: this.parseAudioProvider(elements),
      layers: this.parseLayers(elements),
      assets
    }
  }
  
  private parseAudioProvider(elements: any[]): VizAudioSettings {
    const audio = elements.find(el => el.objType === 'AudioProvider')
    if (!audio) return this.getDefaultAudioSettings()
    
    return {
      sampleProvider: audio.sampleProvider?.v || 'Spectrum2',
      sampleOutCount: audio.sampleOutCount?.v || 200,
      lowerHz: audio.lowerHz?.v || 20,
      higherHz: audio.higherHz?.v || 20000,
      hzLinearFactor: audio.hzLinearFactor?.v || 0.5,
      freqShift: audio.freqShift?.v || 0,
      mirrorSamples: Boolean(audio.mirrorSamples?.v),
      repeatSamples: audio.repeatSamples?.v || 1,
      smooth: audio.smooth?.v || 0.5,
      filterRadius: audio.filterRadius?.v || 0,
      filterStrength: audio.filterStrength?.v || 1,
      beatSmooth: audio.beatSmooth?.v || 0.5,
      beatRangeBarFirst: audio.beatRangeBarFirst?.v || 0,
      beatRangeBarLast: audio.beatRangeBarLast?.v || 0.2,
      lowerFreqMagnitude: audio.lowerFreqMagnitude?.v || 0,
      outputMultiplier: audio.outputMultiplier?.v || 1
    }
  }
  
  private parseLayers(elements: any[]): VizLayer[] {
    return elements
      .filter(el => el.objType !== 'AudioProvider')
      .map((el, index) => this.parseLayer(el, index))
  }
  
  private parseLayer(el: any, index: number): VizLayer {
    const base: VizLayer = {
      id: el._id?.v || index,
      type: el.objType,
      name: el._name || el.objType,
      visible: Boolean(el.visible?.v),
      blendMode: el.blendMode?.v || 'Alpha',
      position: this.parseFloat2(el.position?.v, 0.5, 0.5),
      scale: this.parseFloat2(el.scale?.v, 1, 1),
      rotation: el.rotation?.v || 0,
      measurePosition: this.parseMeasure(el.MeasurePos),
      measureScale: this.parseMeasure(el.measureScale),
      measureRotation: this.parseMeasure(el.measureRot)
    }
    
    // Type-specific parsing
    switch (el.objType) {
      case 'Image':
        base.image = this.parseImageConfig(el)
        break
      case 'Bars':
        base.bars = this.parseBarsConfig(el)
        break
      case 'Particles':
        base.particles = this.parseParticlesConfig(el)
        break
    }
    
    return base
  }
  
  private parseFloat2(value: string | undefined, defaultX: number, defaultY: number) {
    if (!value) return { x: defaultX, y: defaultY }
    const parts = value.split(' ').map(parseFloat)
    return { x: parts[0] ?? defaultX, y: parts[1] ?? defaultY }
  }
  
  private parseMeasure(measure: any): VizMeasure | undefined {
    if (!measure || measure.measureWhat?.v === 'Nothing') return undefined
    return {
      type: measure.measureWhat?.v || 'Nothing',
      amountX: measure.A?.v || 0,
      amountY: measure.B?.v || 0,
      speed: measure.B?.v
    }
  }
  
  private parseImageConfig(el: any): VizImageConfig {
    return {
      source: el.customImage?.v || '',
      keepAspectRatio: Boolean(el.keepAspectRatio?.v),
      blurredBorder: Boolean(el.blurredBorder?.v),
      color: this.parseHSLA(el.Color?.v),
      saturation: this.parseModulatedValue(el.saturation?.v)
    }
  }
  
  private parseBarsConfig(el: any): VizBarsConfig {
    return {
      shapePath: el.ShapePath?.v || 'Circle',
      radius: el.ShapePath?.radius?.v || 1,
      gap: el.ShapePath?.gap?.v || 0,
      heightScale: el.heightScale?.v || 1,
      minHeightScale: el.minHeightScale?.v || 0,
      maxHeightScale: el.maxHeightScale?.v || 1,
      flipInput: Boolean(el.flipInput?.v),
      softness: el.softness?.v || 0,
      reactionDelay: el.reactionDelay?.v || 0,
      segments: [
        this.parseBarSegment(el.Segment1),
        this.parseBarSegment(el.Segment2)
      ].filter(s => s.style !== 'None')
    }
  }
  
  private parseBarSegment(seg: any): VizBarSegment {
    return {
      style: seg?.v || 'None',
      colorFrom: seg?.colorFrom?.v || -1,
      colorTo: seg?.colorTo?.v || -1,
      heightMultiplier: seg?.barHeightMultiplier?.v || 1,
      mirror: Boolean(seg?.mirror?.v),
      flipEveryOther: Boolean(seg?.flipEveryOther?.v)
    }
  }
  
  private parseParticlesConfig(el: any): VizParticlesConfig {
    return {
      image: el.customImage?.v || 'internalres:particle_blur01',
      color: el.color?.v || -1,
      countLimit: el.CountLimit?.v || 1000,
      particleScale: el.particleScale?.v || 1,
      spawnTime: el.spawnTime?.v || 0.02,
      speed: el.Speed?.v || 100,
      speedRandom: el.speedRandom?.v || 0,
      lifetime: el.lifetime?.v || 5,
      gravity: this.parseFloat2(el.gravity?.v, 0, 0),
      spawnArea: el.SpawnArea?.v || 'Rectangle',
      colorFrom: this.parseHSLA(el.ColorFrom?.v),
      colorTo: this.parseHSLA(el.ColorTo?.v),
      fadeInOutTime: el.fadeInAndOutTime?.v || 0.1,
      startSize: el.startSize?.v || 1,
      endSize: el.endSize?.v || 1,
      perspectiveDepth: el.perspectiveDepth?.v || 500,
      perspectiveFov: el.perspectiveFov?.v || 90,
      measureSpeed: this.parseMeasure(el.MeasureOverallSpeed)
    }
  }
  
  private parseHSLA(value: string | undefined) {
    if (!value) return { h: 0, s: 0, l: 1, a: 1 }
    const parts = value.split(' ').map(parseFloat)
    return {
      h: parts[0] || 0,
      s: parts[1] || 0,
      l: parts[2] || 1,
      a: parts[3] || 1
    }
  }
  
  private parseModulatedValue(value: string | undefined): VizModulatedValue[] {
    if (!value) return []
    // Format: "Type Amount Offset;Type Amount Offset"
    return value.split(';').map(part => {
      const [type, amount, offset] = part.trim().split(' ')
      return {
        type: type || 'Constant',
        amount: parseFloat(amount) || 0,
        offset: parseFloat(offset) || 0
      }
    })
  }
  
  private getDefaultAudioSettings(): VizAudioSettings {
    return {
      sampleProvider: 'Spectrum2',
      sampleOutCount: 128,
      lowerHz: 20,
      higherHz: 20000,
      hzLinearFactor: 0.5,
      freqShift: 0,
      mirrorSamples: false,
      repeatSamples: 1,
      smooth: 0.5,
      filterRadius: 0,
      filterStrength: 1,
      beatSmooth: 0.5,
      beatRangeBarFirst: 0,
      beatRangeBarLast: 0.2,
      lowerFreqMagnitude: 0,
      outputMultiplier: 1
    }
  }
}
```

### 2. Tạo: src/components/AudioVisualizer/parsers/VizToProjectConverter.ts

Convert VizProject sang internal project format của tool:

```typescript
import { VizProject, VizLayer, VizBarsConfig } from './VizFileParser'
import { ProjectConfig, LayerConfig } from '../types/ProjectConfig'

export class VizToProjectConverter {
  convert(viz: VizProject): ProjectConfig {
    return {
      name: viz.template || 'Imported Viz',
      resolution: { width: 1920, height: 1080 },
      fps: 60,
      
      // Map audio settings
      audioSettings: {
        fftSize: this.mapFFTSize(viz.audioSettings.sampleOutCount),
        smoothingTimeConstant: viz.audioSettings.smooth,
        minDecibels: -90,
        maxDecibels: -10,
        lowerHz: viz.audioSettings.lowerHz,
        higherHz: viz.audioSettings.higherHz,
        lowerFreqMagnitude: viz.audioSettings.lowerFreqMagnitude,
        filterRadius: viz.audioSettings.filterRadius,
        filterStrength: viz.audioSettings.filterStrength,
        mirrorSamples: viz.audioSettings.mirrorSamples,
        repeatSamples: viz.audioSettings.repeatSamples,
        freqShift: viz.audioSettings.freqShift,
        hzLinearFactor: viz.audioSettings.hzLinearFactor
      },
      
      // Map layers
      layers: viz.layers.map(layer => this.convertLayer(layer, viz.assets))
    }
  }
  
  private mapFFTSize(sampleCount: number): number {
    // Avee uses sampleOutCount, we need fftSize (power of 2)
    if (sampleCount <= 64) return 128
    if (sampleCount <= 128) return 256
    if (sampleCount <= 256) return 512
    if (sampleCount <= 512) return 1024
    return 2048
  }
  
  private convertLayer(layer: VizLayer, assets: Map<string, Blob>): LayerConfig {
    const base = {
      id: String(layer.id),
      name: layer.name,
      type: layer.type.toLowerCase(),
      visible: layer.visible,
      blendMode: this.mapBlendMode(layer.blendMode),
      transform: {
        x: layer.position.x,
        y: layer.position.y,
        scaleX: layer.scale.x,
        scaleY: layer.scale.y,
        rotation: layer.rotation
      },
      audioReactive: this.convertMeasures(layer)
    }
    
    // Type-specific conversion
    if (layer.bars) {
      return { ...base, bars: this.convertBarsConfig(layer.bars) }
    }
    if (layer.image) {
      return { 
        ...base, 
        image: {
          source: this.resolveImageSource(layer.image.source, assets),
          keepAspectRatio: layer.image.keepAspectRatio
        }
      }
    }
    if (layer.particles) {
      return { ...base, particles: this.convertParticlesConfig(layer.particles) }
    }
    
    return base
  }
  
  private mapBlendMode(mode: string): GlobalCompositeOperation {
    const map: Record<string, GlobalCompositeOperation> = {
      'Alpha': 'source-over',
      'PreMulAlpha': 'source-over',
      'Screen': 'screen',
      'Add': 'lighter',
      'AddAlpha': 'lighter'
    }
    return map[mode] || 'source-over'
  }
  
  private convertMeasures(layer: VizLayer) {
    const reactive: any = { enabled: false }
    
    if (layer.measureScale?.type === 'Beat') {
      reactive.enabled = true
      reactive.scaleOnBeat = {
        x: layer.measureScale.amountX,
        y: layer.measureScale.amountY
      }
    }
    
    if (layer.measureRotation?.type?.includes('Shake')) {
      reactive.enabled = true
      reactive.rotationShake = {
        amount: layer.measureRotation.amountX,
        speed: layer.measureRotation.speed || 0.2
      }
    }
    
    if (layer.measurePosition?.type?.includes('Shake')) {
      reactive.enabled = true
      reactive.positionShake = {
        amount: layer.measurePosition.amountX,
        speed: layer.measurePosition.speed || 0.2
      }
    }
    
    return reactive
  }
  
  private convertBarsConfig(bars: VizBarsConfig) {
    return {
      shape: bars.shapePath.toLowerCase(),
      radius: bars.radius,
      gap: bars.gap,
      barCount: 64,  // Will be determined by audio settings
      heightMultiplier: bars.heightScale,
      minHeight: bars.minHeightScale,
      maxHeight: bars.maxHeightScale,
      softness: bars.softness / 20,  // Normalize 0-20 to 0-1
      segments: bars.segments.map(seg => ({
        style: seg.style.toLowerCase(),
        colorFrom: this.argbToHex(seg.colorFrom),
        colorTo: this.argbToHex(seg.colorTo),
        mirror: seg.mirror
      }))
    }
  }
  
  private convertParticlesConfig(particles: any) {
    return {
      count: particles.countLimit,
      size: particles.particleScale,
      speed: particles.speed,
      lifetime: particles.lifetime,
      colorFrom: this.hslaToHex(particles.colorFrom),
      colorTo: this.hslaToHex(particles.colorTo)
    }
  }
  
  private resolveImageSource(source: string, assets: Map<string, Blob>): string {
    if (source.startsWith('local:')) {
      const assetId = source.replace('local:', '')
      const blob = assets.get(assetId)
      if (blob) {
        return URL.createObjectURL(blob)
      }
    }
    if (source.startsWith('internalres:')) {
      // Map to internal resources
      return `/assets/viz/${source.replace('internalres:', '')}.png`
    }
    return source
  }
  
  private argbToHex(argb: number): string {
    if (argb === -1) return '#ffffff'
    const a = (argb >> 24) & 0xff
    const r = (argb >> 16) & 0xff
    const g = (argb >> 8) & 0xff
    const b = argb & 0xff
    return `rgba(${r},${g},${b},${a/255})`
  }
  
  private hslaToHex(hsla: { h: number; s: number; l: number; a: number }): string {
    return `hsla(${hsla.h * 360}, ${hsla.s * 100}%, ${hsla.l * 100}%, ${hsla.a})`
  }
}
```

### 3. Sửa: AudioVisualizerPage.tsx

Thêm import .viz button:

```typescript
import { VizFileParser } from '../parsers/VizFileParser'
import { VizToProjectConverter } from '../parsers/VizToProjectConverter'

// Trong component:
const [vizAssets, setVizAssets] = useState<Map<string, Blob>>(new Map())

const handleImportViz = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (!file || !file.name.endsWith('.viz')) return
  
  try {
    const parser = new VizFileParser()
    const vizProject = await parser.parse(file)
    
    const converter = new VizToProjectConverter()
    const projectConfig = converter.convert(vizProject)
    
    // Store assets for image layers
    setVizAssets(vizProject.assets)
    
    // Apply to current project
    setProjectConfig(projectConfig)
    
    // Apply audio settings to AudioProcessor
    if (audioProcessorRef.current) {
      audioProcessorRef.current.updateConfig(projectConfig.audioSettings)
    }
    
    console.log('Imported .viz:', vizProject)
  } catch (error) {
    console.error('Failed to parse .viz file:', error)
  }
}

// JSX:
<input
  type="file"
  accept=".viz"
  onChange={handleImportViz}
  style={{ display: 'none' }}
  id="viz-import"
/>
<label htmlFor="viz-import">
  <Button component="span" startIcon={<UploadIcon />}>
    Import .viz
  </Button>
</label>
```

## Dependencies cần install

```bash
npm install jszip
npm install --save-dev @types/jszip
```

## Test với file mẫu

File RMN_18.viz chứa:
- 1 AudioProvider với Spectrum2
- 2 Image layers (background với shake effect)
- 1 Bars layer (Circle shape, Line segment, Beat reactive scale)
- 1 Particles layer (1500 particles, Beat reactive speed)
- 1 BlurEffect layer
- 1 AppLogo layer

Khi import:
1. Parse zip → extract scene.json + assets (2 JPEG images)
2. Map AudioProvider settings → AudioProcessor config
3. Convert layers → internal layer format
4. Load image assets → blob URLs
5. Render layers với audio reactive modifiers
```
