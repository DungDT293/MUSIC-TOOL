/**
 * ThreeJS Engine Presets — 5 visual styles for the 3D spectrum visualizer.
 *
 * Each preset defines:
 * - Fragment shaders for bars and ground plane
 * - Bloom/post-processing parameters
 * - Fog, lighting, camera, and particle color palettes
 * - Scene atmosphere (clear color, fog color/density)
 *
 * Presets: neon-cyberpunk | crystal-glass | holographic | particle-universe | inferno
 */

export type ThreeJsPresetId = 'neon-cyberpunk' | 'crystal-glass' | 'holographic' | 'particle-universe' | 'inferno' | 'circuit-board'

export interface ThreeJsPreset {
  id: ThreeJsPresetId
  label: string
  description: string

  // Scene
  clearColor: number
  fogColor: number
  fogDensity: number
  ambientLightColor: number
  ambientLightIntensity: number
  pointLightColor: number
  pointLightIntensity: number

  // Bloom defaults
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  // Bloom audio reactivity multipliers
  bloomBassMultiplier: number
  bloomPeakMultiplier: number

  // Camera
  cameraOrbitSpeed: number
  cameraHeightBase: number
  cameraBassLift: number

  // Tone mapping
  toneMappingExposure: number

  // Bar fragment shader (replaces main() body)
  barFragShader: string

  // Ground fragment shader
  groundFragShader: string

  // Reflection opacity and color multiplier
  reflectionOpacity: number
  reflectionColorMul: number
  reflectionFadeRange: number

  // Particle color palette (arrays of [r,g,b] in 0–1 range)
  particleColors: readonly (readonly [number, number, number])[]
  particleSizeMultiplier: number
  particleSpeedMultiplier: number
}

// ════════════════════════════════════════════════════════════════════
// Shared GLSL functions (injected before main() in all presets)
// ════════════════════════════════════════════════════════════════════

const GLSL_COSINE_PALETTE = /* glsl */ `
vec3 cosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}
`

// ════════════════════════════════════════════════════════════════════
//  PRESET 1: NEON CYBERPUNK
//  - Hot neon pinks/cyans/purples
//  - Strong bloom, additive glow
//  - Dark background with colored fog
//  - Grid floor with laser lines
// ════════════════════════════════════════════════════════════════════

const neonCyberpunkBarFrag = /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.06 + uBass * 0.25 + uMid * 0.1;

  // Triple neon palette: hot pink → electric cyan → violet → orange
  vec3 neon1 = cosinePalette(
    t + hueShift,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 1.0, 0.5),
    vec3(0.80, 0.20, 0.50)
  );

  vec3 neon2 = cosinePalette(
    t + hueShift + 0.5,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(1.0, 0.7, 0.4),
    vec3(0.00, 0.15, 0.65)
  );

  vec3 neon3 = cosinePalette(
    t + hueShift + 0.33,
    vec3(0.5, 0.5, 0.5),
    vec3(0.5, 0.5, 0.5),
    vec3(0.8, 1.2, 0.6),
    vec3(0.50, 0.80, 0.10)
  );

  // Triple-blend based on frequency + treble
  vec3 color = mix(neon1, neon2, freq * 0.5 + uTreble * 0.3);
  color = mix(color, neon3, uMid * 0.3 + freq * 0.15);

  // Height gradient: bottom deep dark → top blazing neon
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));
  color *= 0.25 + heightFactor * 1.3;

  // Top cap glow: brilliant white-pink tip
  float topGlow = smoothstep(0.85, 1.0, heightFactor) * freq;
  color += topGlow * vec3(1.0, 0.7, 0.9) * 2.5;

  // View-dependent iridescent Fresnel rim
  vec3 viewDir = normalize(vec3(sin(uTime * 0.12) * 0.4, 0.15, 1.0));
  float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim = pow(rim, 1.8);
  vec3 rimColor = mix(vec3(1.0, 0.2, 0.8), vec3(0.2, 0.6, 1.0), sin(t * 6.28 + uTime * 0.5) * 0.5 + 0.5);
  color += rim * 0.9 * rimColor;

  // Aggressive emissive: bars glow intensely
  float brightness = 0.7 + freq * 1.6;
  float emissive = 1.2 + uBass * 3.5 + freq * 2.5 + uPeak * 1.0;
  color *= brightness * emissive;

  // Bass pulse: wave of brightness on bass hits
  float bassPulse = smoothstep(0.35, 0.75, uBass) * sin(uTime * 10.0 + t * 3.14) * 0.2;
  color += bassPulse * color;

  // Multi-frequency sparkle cascade
  float sparkle1 = step(0.75, freq) * (sin(uTime * 20.0 + vInstanceId * 13.7) * 0.5 + 0.5) * 0.5;
  float sparkle2 = step(0.85, freq) * (sin(uTime * 28.0 + vInstanceId * 7.1) * 0.5 + 0.5) * 0.4;
  float sparkle3 = step(0.93, freq) * (cos(uTime * 35.0 + vInstanceId * 3.3) * 0.5 + 0.5) * 0.6;
  color += (sparkle1 + sparkle2 + sparkle3) * vec3(1.0, 0.5, 1.0);

  // Inner glow: self-illumination based on energy
  float innerGlow = freq * freq * 0.25;
  color += innerGlow * neon1;

  gl_FragColor = vec4(color, 1.0);
}
`

const neonCyberpunkGroundFrag = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Laser grid lines with bass-reactive brightness
  float gridX = smoothstep(0.94, 1.0, abs(sin(vWorldPos.x * 3.14159 * 2.5)));
  float gridZ = smoothstep(0.94, 1.0, abs(sin(vWorldPos.z * 3.14159 * 2.5)));
  float grid = max(gridX, gridZ);

  // Neon grid color: cycling pink/cyan with treble-reactive hue
  float gridHue = sin(uTime * 0.3 + vWorldPos.x * 0.1) * 0.5 + 0.5;
  vec3 gridColor = mix(vec3(1.0, 0.1, 0.6), vec3(0.1, 0.8, 1.0), gridHue);
  vec3 color = gridColor * grid * (0.15 + uBass * 0.18);

  // Base dark purple
  color += vec3(0.02, 0.01, 0.04);

  // Expanding energy rings from center on bass hits
  float ringDist = length(vWorldPos.xz);
  float ringPhase1 = fract(uTime * 0.4) * 25.0;
  float ringPhase2 = fract(uTime * 0.4 + 0.5) * 25.0;
  float ring1 = smoothstep(0.3, 0.0, abs(ringDist - ringPhase1)) * smoothstep(25.0, 10.0, ringPhase1);
  float ring2 = smoothstep(0.3, 0.0, abs(ringDist - ringPhase2)) * smoothstep(25.0, 10.0, ringPhase2);
  color += vec3(1.0, 0.2, 0.7) * (ring1 + ring2) * 0.12 * (0.5 + uBass * 1.0);

  // Bass pulse from center — radial glow
  float centerGlow = (1.0 - dist) * uBass * 0.18;
  color += vec3(0.8, 0.1, 0.5) * centerGlow;

  // Subtle moving caustic pattern on floor
  float caustic = sin(vWorldPos.x * 3.0 + uTime * 0.8) * cos(vWorldPos.z * 2.5 - uTime * 0.6);
  caustic = max(0.0, caustic) * 0.03 * (0.5 + uBass * 0.5);
  color += vec3(0.5, 0.2, 0.8) * caustic;

  // Radial fade
  float alpha = smoothstep(1.0, 0.12, dist) * 0.78;

  gl_FragColor = vec4(color, alpha);
}
`

// ════════════════════════════════════════════════════════════════════
//  PRESET 2: CRYSTAL GLASS
//  - Transparent/frosted look with white/ice-blue tones
//  - Subtle bloom, soft refraction-like effect
//  - Clean white/silver aesthetic
//  - Soft ambient atmosphere
// ════════════════════════════════════════════════════════════════════

const crystalGlassBarFrag = /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.025;

  // Triple crystal palette: ice white → pale blue → soft violet → warm pearl
  vec3 crystal1 = cosinePalette(
    t + hueShift,
    vec3(0.85, 0.88, 0.95),
    vec3(0.15, 0.15, 0.2),
    vec3(1.0, 1.0, 1.0),
    vec3(0.10, 0.20, 0.35)
  );

  vec3 crystal2 = cosinePalette(
    t + hueShift + 0.4,
    vec3(0.9, 0.85, 0.95),
    vec3(0.1, 0.15, 0.2),
    vec3(0.8, 1.2, 0.6),
    vec3(0.30, 0.10, 0.50)
  );

  vec3 crystal3 = cosinePalette(
    t + hueShift + 0.7,
    vec3(0.95, 0.92, 0.88),
    vec3(0.1, 0.12, 0.15),
    vec3(1.0, 0.8, 1.2),
    vec3(0.05, 0.35, 0.15)
  );

  vec3 crystalColor = mix(crystal1, crystal2, freq * 0.4 + uTreble * 0.2);
  crystalColor = mix(crystalColor, crystal3, uMid * 0.25);

  // Height-based gradient (bottom frosted → top brilliant)
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));
  crystalColor *= 0.65 + heightFactor * 0.6;

  // Top cap glow: diamond-like brilliant peak
  float topGlow = smoothstep(0.88, 1.0, heightFactor) * freq;
  crystalColor += topGlow * vec3(1.0, 0.98, 0.95) * 1.8;

  // Iridescent Fresnel for glass refraction aesthetic
  vec3 viewDir = normalize(vec3(sin(uTime * 0.08) * 0.2, 0.3, 1.0));
  float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim = pow(rim, 2.5);
  vec3 rimColor = vec3(0.6, 0.8, 1.0) + 0.3 * sin(vec3(0.0, 2.1, 4.2) + t * 6.28 + uTime * 0.5);
  crystalColor += rim * 0.7 * rimColor;

  // Layered internal refraction caustics
  float caustic1 = sin(vWorldPos.y * 8.0 + uTime * 2.0 + t * 12.0) * 0.5 + 0.5;
  float caustic2 = sin(vWorldPos.y * 3.0 - uTime * 1.5 + t * 7.0) * 0.5 + 0.5;
  float caustic3 = sin(vWorldPos.y * 15.0 + uTime * 3.0 + t * 20.0) * 0.5 + 0.5;
  float caustic = caustic1 * caustic2 * 0.8 + caustic3 * 0.2;
  crystalColor += caustic * 0.12 * vec3(0.5, 0.7, 1.0) * freq;

  // Soft emissive with bass reactivity
  float brightness = 0.85 + freq * 0.6;
  float emissive = 0.8 + uBass * 1.2 + freq * 0.9 + uPeak * 0.4;
  crystalColor *= brightness * emissive;

  // Bass pulse: soft wave of light
  float bassPulse = smoothstep(0.3, 0.7, uBass) * sin(uTime * 6.0 + t * 2.0) * 0.08;
  crystalColor += bassPulse * vec3(0.7, 0.85, 1.0);

  // Multi-layer diamond sparkle at peaks
  float sparkle1 = step(0.78, freq) * pow(sin(uTime * 25.0 + vInstanceId * 17.3) * 0.5 + 0.5, 4.0) * 0.6;
  float sparkle2 = step(0.88, freq) * pow(cos(uTime * 33.0 + vInstanceId * 11.1) * 0.5 + 0.5, 5.0) * 0.5;
  float sparkle3 = step(0.95, freq) * pow(sin(uTime * 41.0 + vInstanceId * 5.7) * 0.5 + 0.5, 6.0) * 0.8;
  crystalColor += (sparkle1 + sparkle2 + sparkle3) * vec3(1.0, 1.0, 1.0);

  // Inner glow: soft prismatic self-illumination
  float innerGlow = freq * freq * 0.2;
  crystalColor += innerGlow * crystal1;

  vec3 color = crystalColor;
  gl_FragColor = vec4(color, 1.0);
}
`

const crystalGlassGroundFrag = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Multi-layer frost pattern (noise approximation)
  float frost1 = sin(vWorldPos.x * 5.0 + uTime * 0.3) * cos(vWorldPos.z * 4.0 - uTime * 0.2);
  float frost2 = sin(vWorldPos.x * 8.0 - uTime * 0.5) * cos(vWorldPos.z * 7.0 + uTime * 0.4);
  float frost3 = sin(vWorldPos.x * 12.0 + uTime * 0.7) * cos(vWorldPos.z * 10.0 - uTime * 0.6);
  float frost = (frost1 + frost2 * 0.6 + frost3 * 0.3) * 0.02;

  // Clean white/blue ground
  vec3 color = vec3(0.06, 0.07, 0.10) + frost;

  // Soft radial light with audio reactivity
  float centerGlow = (1.0 - dist * dist) * 0.06;
  color += vec3(0.4, 0.6, 0.9) * centerGlow * (1.0 + uBass * 0.6);

  // Concentric ripple waves from center — bass-reactive
  float ringDist = length(vWorldPos.xz);
  float ripple1 = sin(ringDist * 12.0 - uTime * 2.0) * 0.5 + 0.5;
  float ripple2 = sin(ringDist * 8.0 - uTime * 1.3 + 1.5) * 0.5 + 0.5;
  float rippleIntensity = smoothstep(0.7, 1.0, ripple1) * 0.04 + smoothstep(0.8, 1.0, ripple2) * 0.03;
  rippleIntensity *= (1.0 - dist * 0.6) * (0.5 + uBass * 0.8);
  color += vec3(0.5, 0.7, 1.0) * rippleIntensity;

  // Caustic light patterns (light refracting through crystal bars)
  float caustic = sin(vWorldPos.x * 4.0 + uTime * 1.2) * cos(vWorldPos.z * 3.5 - uTime * 0.8);
  caustic = max(0.0, caustic * caustic) * 0.04 * (0.3 + uBass * 0.4);
  color += vec3(0.6, 0.8, 1.0) * caustic;

  // Expanding bass ring
  float bassRing = fract(uTime * 0.3) * 20.0;
  float bassRingFade = smoothstep(0.25, 0.0, abs(ringDist - bassRing)) * smoothstep(20.0, 8.0, bassRing);
  color += vec3(0.4, 0.6, 1.0) * bassRingFade * 0.08 * uBass;

  float alpha = smoothstep(1.0, 0.25, dist) * 0.55;

  gl_FragColor = vec4(color, alpha);
}
`

// ════════════════════════════════════════════════════════════════════
//  PRESET 3: HOLOGRAPHIC FUTURISTIC
//  - Wireframe aesthetic with scan lines
//  - Green/teal sci-fi color scheme
//  - Matrix/digital rain atmosphere
//  - Glitch effects on peaks
// ════════════════════════════════════════════════════════════════════

const holographicBarFrag = /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.035;

  // Triple holographic palette: teal → mint → electric blue → golden
  vec3 holo1 = cosinePalette(
    t + hueShift,
    vec3(0.3, 0.5, 0.5),
    vec3(0.3, 0.4, 0.4),
    vec3(1.0, 1.0, 0.5),
    vec3(0.15, 0.40, 0.55)
  );

  vec3 holo2 = cosinePalette(
    t + hueShift + 0.33,
    vec3(0.4, 0.5, 0.4),
    vec3(0.3, 0.3, 0.5),
    vec3(1.2, 0.8, 1.0),
    vec3(0.30, 0.55, 0.20)
  );

  vec3 holo3 = cosinePalette(
    t + hueShift + 0.66,
    vec3(0.35, 0.45, 0.55),
    vec3(0.25, 0.35, 0.3),
    vec3(0.8, 1.0, 1.2),
    vec3(0.10, 0.25, 0.70)
  );

  vec3 holoColor = mix(holo1, holo2, freq * 0.4 + uTreble * 0.25);
  holoColor = mix(holoColor, holo3, uMid * 0.3);

  // Height-based: bottom solid → top wireframe-like
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));

  // Horizontal scan lines (holographic effect) — more layers
  float scanLine1 = sin(vWorldPos.y * 40.0 + uTime * 3.0) * 0.5 + 0.5;
  float scanLine2 = sin(vWorldPos.y * 80.0 - uTime * 5.0) * 0.5 + 0.5;
  float scanIntensity = 0.6 + smoothstep(0.3, 0.7, scanLine1) * 0.25 + smoothstep(0.5, 0.9, scanLine2) * 0.15;
  holoColor *= scanIntensity;

  // Top cap glow: holographic bright tip
  float topGlow = smoothstep(0.87, 1.0, heightFactor) * freq;
  holoColor += topGlow * vec3(0.3, 1.0, 0.7) * 2.0;

  // Data stream effect: vertical lines that scroll
  float dataStream = sin(vInstanceId * 2.1 + uTime * 5.0) * 0.5 + 0.5;
  dataStream = step(0.85, dataStream) * 0.25;
  holoColor += vec3(0.0, 1.0, 0.5) * dataStream * freq;

  // View-dependent iridescent wireframe edge glow
  vec3 viewDir = normalize(vec3(sin(uTime * 0.15) * 0.3, 0.2, 1.0));
  float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim = pow(rim, 1.3);
  vec3 rimColor = mix(vec3(0.0, 1.0, 0.8), vec3(0.3, 0.8, 1.0), sin(t * 8.0 + uTime * 0.4) * 0.5 + 0.5);
  holoColor += rim * 0.8 * rimColor;

  // Emissive with wider dynamic range
  float brightness = 0.55 + freq * 0.9;
  float emissive = 1.0 + uBass * 2.2 + freq * 1.6 + uPeak * 0.6;
  holoColor *= brightness * emissive;

  // Bass pulse: digital flicker
  float bassPulse = smoothstep(0.4, 0.7, uBass) * sin(uTime * 12.0 + t * 5.0) * 0.12;
  holoColor += bassPulse * vec3(0.1, 0.8, 0.5);

  // Advanced glitch effect on strong beats — multiple layers
  float glitchBase = step(0.65, uBass);
  float glitch1 = glitchBase * step(0.8, fract(sin(floor(uTime * 10.0) * 127.1 + vInstanceId) * 43758.5453));
  float glitch2 = glitchBase * step(0.9, fract(cos(floor(uTime * 15.0) * 91.3 + vInstanceId * 3.0) * 28461.7123));
  holoColor += glitch1 * vec3(0.0, 2.0, 1.0) * 0.4;
  holoColor += glitch2 * vec3(0.5, 0.0, 2.0) * 0.3;

  // Multi-layer sparkle
  float sparkle1 = step(0.80, freq) * pow(sin(uTime * 18.0 + vInstanceId * 9.3) * 0.5 + 0.5, 3.0) * 0.4;
  float sparkle2 = step(0.90, freq) * pow(cos(uTime * 27.0 + vInstanceId * 5.1) * 0.5 + 0.5, 4.0) * 0.5;
  holoColor += (sparkle1 + sparkle2) * vec3(0.3, 1.0, 0.8);

  // Height fade + inner glow
  holoColor *= 0.45 + heightFactor * 0.85;
  float innerGlow = freq * freq * 0.2;
  holoColor += innerGlow * holo1;

  vec3 color = holoColor;
  gl_FragColor = vec4(color, 1.0);
}
`

const holographicGroundFrag = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Matrix-style hex grid with bass-reactive glow
  float hexX = sin(vWorldPos.x * 4.0) * cos(vWorldPos.z * 4.0);
  float hexGrid = smoothstep(0.91, 1.0, abs(hexX));

  // Concentric radar rings — multiple layers
  float ringDist = length(vWorldPos.xz);
  float rings1 = sin(ringDist * 18.0 - uTime * 2.0) * 0.5 + 0.5;
  float rings2 = sin(ringDist * 12.0 - uTime * 1.5 + 2.0) * 0.5 + 0.5;
  float ringsIntensity = smoothstep(0.7, 1.0, rings1) * 0.08 + smoothstep(0.8, 1.0, rings2) * 0.05;

  // Base dark with green tint
  vec3 color = vec3(0.01, 0.03, 0.02);
  color += vec3(0.0, 0.18, 0.10) * hexGrid * (0.35 + uBass * 0.35);
  color += vec3(0.0, 0.22, 0.12) * ringsIntensity;

  // Scanning line that sweeps across (radar sweep)
  float scanAngle = atan(vWorldPos.z, vWorldPos.x) + 3.14159;
  float scanT = mod(uTime * 0.5, 6.28318);
  float scanDelta = abs(mod(scanAngle - scanT + 3.14159, 6.28318) - 3.14159);
  float scanBeam = smoothstep(0.3, 0.0, scanDelta) * 0.12 * (1.0 - dist * 0.5);
  color += vec3(0.0, 1.0, 0.5) * scanBeam;

  // Second scan beam (counter-rotating)
  float scanT2 = mod(-uTime * 0.35 + 1.0, 6.28318);
  float scanDelta2 = abs(mod(scanAngle - scanT2 + 3.14159, 6.28318) - 3.14159);
  float scanBeam2 = smoothstep(0.2, 0.0, scanDelta2) * 0.06 * (1.0 - dist * 0.5);
  color += vec3(0.3, 0.8, 1.0) * scanBeam2;

  // Expanding energy ring from center on bass
  float bassRing = fract(uTime * 0.35) * 22.0;
  float bassRingFade = smoothstep(0.3, 0.0, abs(ringDist - bassRing)) * smoothstep(22.0, 8.0, bassRing);
  color += vec3(0.0, 1.0, 0.6) * bassRingFade * 0.1 * (0.4 + uBass * 1.2);

  // Digital noise pattern (data floor)
  float noise = fract(sin(floor(vWorldPos.x * 8.0) * 127.1 + floor(vWorldPos.z * 8.0) * 311.7 + floor(uTime * 2.0) * 73.13) * 43758.5453);
  color += vec3(0.0, 0.15, 0.08) * step(0.92, noise) * (0.3 + uBass * 0.2);

  // Center pulse
  float centerGlow = (1.0 - dist) * uBass * 0.1;
  color += vec3(0.0, 0.9, 0.5) * centerGlow;

  float alpha = smoothstep(1.0, 0.12, dist) * 0.7;

  gl_FragColor = vec4(color, alpha);
}
`

// ════════════════════════════════════════════════════════════════════
//  PRESET DEFINITIONS
// ════════════════════════════════════════════════════════════════════

export const THREEJS_PRESETS: Record<ThreeJsPresetId, ThreeJsPreset> = {
  'neon-cyberpunk': {
    id: 'neon-cyberpunk',
    label: 'Neon Cyberpunk',
    description: 'Thanh neon rực rỡ, sàn laser, particles lấp lánh — phong cách Avee Player / CapCut premium',

    clearColor: 0x08030f,
    fogColor: 0x08030f,
    fogDensity: 0.02,
    ambientLightColor: 0x220033,
    ambientLightIntensity: 0.4,
    pointLightColor: 0xff44aa,
    pointLightIntensity: 2.0,

    bloomStrength: 2.0,
    bloomRadius: 0.5,
    bloomThreshold: 0.08,
    bloomBassMultiplier: 3.0,
    bloomPeakMultiplier: 1.5,

    cameraOrbitSpeed: 0.1,
    cameraHeightBase: 5.5,
    cameraBassLift: 2.0,

    toneMappingExposure: 1.2,

    barFragShader: neonCyberpunkBarFrag,
    groundFragShader: neonCyberpunkGroundFrag,

    reflectionOpacity: 0.4,
    reflectionColorMul: 0.6,
    reflectionFadeRange: -3.0,

    particleColors: [
      [1.0, 0.2, 0.6],  // hot pink
      [0.3, 0.6, 1.0],  // electric blue
      [0.8, 0.1, 1.0],  // violet
      [0.0, 0.9, 0.9],  // cyan
      [1.0, 0.4, 0.1],  // orange
    ],
    particleSizeMultiplier: 1.3,
    particleSpeedMultiplier: 1.2,
  },

  'crystal-glass': {
    id: 'crystal-glass',
    label: 'Crystal Glass',
    description: 'Thanh pha lê trong suốt, ánh sáng khúc xạ, hiệu ứng frosted glass sang trọng',

    clearColor: 0x0a0c14,
    fogColor: 0x0a0c14,
    fogDensity: 0.018,
    ambientLightColor: 0x334466,
    ambientLightIntensity: 0.5,
    pointLightColor: 0x88bbff,
    pointLightIntensity: 1.8,

    bloomStrength: 1.2,
    bloomRadius: 0.6,
    bloomThreshold: 0.15,
    bloomBassMultiplier: 1.5,
    bloomPeakMultiplier: 0.8,

    cameraOrbitSpeed: 0.06,
    cameraHeightBase: 6.0,
    cameraBassLift: 1.0,

    toneMappingExposure: 1.3,

    barFragShader: crystalGlassBarFrag,
    groundFragShader: crystalGlassGroundFrag,

    reflectionOpacity: 0.5,
    reflectionColorMul: 0.7,
    reflectionFadeRange: -2.5,

    particleColors: [
      [0.8, 0.9, 1.0],  // ice white
      [0.5, 0.7, 1.0],  // pale blue
      [0.7, 0.8, 0.95], // silver
      [0.6, 0.85, 1.0], // sky blue
      [0.9, 0.9, 1.0],  // diamond
    ],
    particleSizeMultiplier: 0.8,
    particleSpeedMultiplier: 0.7,
  },

  'holographic': {
    id: 'holographic',
    label: 'Holographic',
    description: 'Hologram wireframe, scan lines, hiệu ứng glitch — phong cách sci-fi tương lai',

    clearColor: 0x020805,
    fogColor: 0x020805,
    fogDensity: 0.022,
    ambientLightColor: 0x003322,
    ambientLightIntensity: 0.35,
    pointLightColor: 0x00ffaa,
    pointLightIntensity: 1.6,

    bloomStrength: 1.8,
    bloomRadius: 0.45,
    bloomThreshold: 0.1,
    bloomBassMultiplier: 2.5,
    bloomPeakMultiplier: 1.2,

    cameraOrbitSpeed: 0.07,
    cameraHeightBase: 5.0,
    cameraBassLift: 1.5,

    toneMappingExposure: 1.1,

    barFragShader: holographicBarFrag,
    groundFragShader: holographicGroundFrag,

    reflectionOpacity: 0.3,
    reflectionColorMul: 0.4,
    reflectionFadeRange: -2.0,

    particleColors: [
      [0.0, 1.0, 0.6],  // neon green
      [0.0, 0.8, 0.5],  // emerald
      [0.2, 0.9, 1.0],  // teal
      [0.0, 0.6, 0.3],  // dark green
      [0.5, 1.0, 0.7],  // mint
    ],
    particleSizeMultiplier: 1.0,
    particleSpeedMultiplier: 1.0,
  },

  // ════════════════════════════════════════════════════════════════════
  //  PRESET 4: PARTICLE UNIVERSE
  //  - Deep space nebula colors (purple, teal, star white)
  //  - Cosmic dust and star sparkle effects
  //  - Slow camera orbit for grand scale feeling
  //  - Moderate bloom with soft glow
  // ════════════════════════════════════════════════════════════════════

  'particle-universe': {
    id: 'particle-universe',
    label: 'Particle Universe',
    description: 'Vũ trụ hạt sao — nebula tím xanh, lấp lánh ánh sao, không gian vô tận',

    clearColor: 0x020108,
    fogColor: 0x020108,
    fogDensity: 0.015,
    ambientLightColor: 0x150830,
    ambientLightIntensity: 0.4,
    pointLightColor: 0x6644aa,
    pointLightIntensity: 1.5,

    bloomStrength: 1.8,
    bloomRadius: 0.55,
    bloomThreshold: 0.08,
    bloomBassMultiplier: 2.0,
    bloomPeakMultiplier: 1.0,

    cameraOrbitSpeed: 0.05,
    cameraHeightBase: 6.5,
    cameraBassLift: 1.2,

    toneMappingExposure: 1.15,

    barFragShader: /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

// Simple noise for star sparkle
float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.025;

  // Deep space nebula palette: purple → teal → midnight blue
  vec3 nebula1 = cosinePalette(
    t + hueShift,
    vec3(0.3, 0.2, 0.4),
    vec3(0.4, 0.3, 0.5),
    vec3(1.0, 0.8, 0.5),
    vec3(0.70, 0.30, 0.60)
  );

  vec3 nebula2 = cosinePalette(
    t + hueShift + 0.4,
    vec3(0.2, 0.3, 0.4),
    vec3(0.3, 0.4, 0.4),
    vec3(0.5, 1.0, 1.0),
    vec3(0.20, 0.50, 0.60)
  );

  vec3 color = mix(nebula1, nebula2, freq * 0.6 + uMid * 0.3);

  // Height: cosmic gradient from dark (bottom) to star-bright (top)
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));
  color *= 0.15 + heightFactor * 1.3;

  // Star sparkle noise
  float starSeed = hash(vInstanceId * 17.3 + floor(uTime * 8.0));
  float sparkle = step(0.92, starSeed) * freq * 2.0;
  color += vec3(1.0, 0.95, 0.85) * sparkle;

  // Nebula rim glow (soft purple/teal edge)
  float rim = 1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
  rim = pow(rim, 2.0);
  vec3 rimColor = mix(vec3(0.4, 0.1, 0.7), vec3(0.0, 0.6, 0.5), t);
  color += rim * rimColor * 1.0;

  // Top cap glow: starlight tip
  float topGlow = smoothstep(0.88, 1.0, heightFactor) * freq;
  color += topGlow * vec3(0.9, 0.85, 1.0) * 2.0;

  // View-dependent nebula rim
  vec3 viewDir = normalize(vec3(sin(uTime * 0.08) * 0.25, 0.25, 1.0));
  float rim2 = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim2 = pow(rim2, 2.2);
  vec3 nebulaRim = mix(vec3(0.4, 0.1, 0.7), vec3(0.1, 0.6, 0.8), sin(t * 4.0 + uTime * 0.3) * 0.5 + 0.5);
  color += rim2 * 0.5 * nebulaRim;

  // Emissive: cosmic glow that rises with audio
  float emissive = 0.7 + freq * 2.2 + uBass * 2.0 + uPeak * 0.6;
  color *= emissive;

  // Bass pulse: nebula pulsation
  float bassPulse = smoothstep(0.35, 0.7, uBass) * sin(uTime * 7.0 + t * 2.5) * 0.12;
  color += bassPulse * nebula1;

  // Supernova flash on strong beats
  float nova = step(0.65, uBass) * step(0.8, freq);
  color += vec3(1.0, 0.6, 0.2) * nova * 2.0;

  // Multi-frequency star sparkle
  float sparkle2 = step(0.85, freq) * (sin(uTime * 22.0 + vInstanceId * 11.3) * 0.5 + 0.5) * 0.4;
  float sparkle3 = step(0.92, freq) * (cos(uTime * 30.0 + vInstanceId * 5.7) * 0.5 + 0.5) * 0.6;
  color += (sparkle2 + sparkle3) * vec3(1.0, 0.95, 0.9);

  // Inner glow
  float innerGlow = freq * freq * 0.2;
  color += innerGlow * nebula1;

  gl_FragColor = vec4(color, 1.0);
}
`,

    groundFragShader: /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Deep space base
  vec3 color = vec3(0.01, 0.005, 0.025);

  // Star field on ground
  float starField = hash2(floor(vWorldPos.xz * 6.0));
  float star = smoothstep(0.97, 0.99, starField);
  float twinkle = sin(uTime * 3.0 + starField * 100.0) * 0.5 + 0.5;
  color += vec3(0.7, 0.75, 1.0) * star * twinkle * 0.4;

  // Nebula clouds
  float cloud = sin(vWorldPos.x * 0.4 + uTime * 0.1) * cos(vWorldPos.z * 0.5 + uTime * 0.08);
  cloud = cloud * 0.5 + 0.5;
  vec3 nebulaColor = mix(vec3(0.1, 0.02, 0.2), vec3(0.02, 0.08, 0.15), cloud);
  color += nebulaColor * 0.15 * (1.0 + uBass * 0.5);

  // Expanding nebula rings from center
  float ringDist = length(vWorldPos.xz);
  float nebRing = fract(uTime * 0.25) * 20.0;
  float nebRingFade = smoothstep(0.3, 0.0, abs(ringDist - nebRing)) * smoothstep(20.0, 8.0, nebRing);
  color += vec3(0.3, 0.1, 0.5) * nebRingFade * 0.1 * (0.5 + uBass * 1.0);

  // Center glow — brighter
  float centerGlow = (1.0 - dist) * 0.1 * (1.0 + uBass * 2.5);
  color += vec3(0.2, 0.08, 0.35) * centerGlow;

  // Subtle concentric pulsar rings
  float pulsar = sin(ringDist * 10.0 - uTime * 1.5) * 0.5 + 0.5;
  pulsar = smoothstep(0.8, 1.0, pulsar) * 0.04 * (1.0 - dist * 0.5);
  color += vec3(0.2, 0.1, 0.4) * pulsar;

  float alpha = smoothstep(1.0, 0.12, dist) * 0.6;
  gl_FragColor = vec4(color, alpha);
}
`,

    reflectionOpacity: 0.35,
    reflectionColorMul: 0.5,
    reflectionFadeRange: -2.8,

    particleColors: [
      [0.5, 0.2, 0.8],  // purple
      [0.2, 0.5, 0.7],  // teal
      [0.8, 0.8, 1.0],  // star white
      [0.3, 0.1, 0.6],  // deep purple
      [0.0, 0.7, 0.6],  // emerald teal
      [1.0, 0.7, 0.3],  // supernova gold
    ],
    particleSizeMultiplier: 1.2,
    particleSpeedMultiplier: 0.6,
  },

  // ════════════════════════════════════════════════════════════════════
  //  PRESET 5: INFERNO
  //  - Fire/lava colors: red → orange → yellow → white hot
  //  - Aggressive bloom for fiery glow
  //  - Ember particles, volcanic floor
  //  - High energy, bass-reactive
  // ════════════════════════════════════════════════════════════════════

  'inferno': {
    id: 'inferno',
    label: 'Inferno',
    description: 'Ngọn lửa rực cháy — dung nite hồi sinh, thanh lửa bùng nổ theo bass',

    clearColor: 0x0a0200,
    fogColor: 0x0a0200,
    fogDensity: 0.02,
    ambientLightColor: 0x331100,
    ambientLightIntensity: 0.4,
    pointLightColor: 0xff4400,
    pointLightIntensity: 2.5,

    bloomStrength: 2.2,
    bloomRadius: 0.5,
    bloomThreshold: 0.06,
    bloomBassMultiplier: 3.5,
    bloomPeakMultiplier: 1.8,

    cameraOrbitSpeed: 0.09,
    cameraHeightBase: 5.0,
    cameraBassLift: 2.5,

    toneMappingExposure: 1.3,

    barFragShader: /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));

  // Fire color ramp: dark red (bottom) → orange → yellow → white hot (top)
  vec3 darkRed = vec3(0.3, 0.02, 0.0);
  vec3 fireOrange = vec3(1.0, 0.35, 0.0);
  vec3 fireYellow = vec3(1.0, 0.8, 0.1);
  vec3 whiteHot = vec3(1.0, 1.0, 0.7);

  vec3 color;
  if (heightFactor < 0.3) {
    color = mix(darkRed, fireOrange, heightFactor / 0.3);
  } else if (heightFactor < 0.65) {
    color = mix(fireOrange, fireYellow, (heightFactor - 0.3) / 0.35);
  } else {
    color = mix(fireYellow, whiteHot, (heightFactor - 0.65) / 0.35);
  }

  // Flickering (noise-based turbulence)
  float flicker = hash(vInstanceId * 7.3 + floor(uTime * 25.0));
  float turbulence = 0.85 + flicker * 0.3;
  color *= turbulence;

  // Heat wave distortion (subtle color shift)
  float heatWave = sin(vWorldPos.y * 12.0 + uTime * 4.0 + t * 8.0) * 0.5 + 0.5;
  color = mix(color, color * vec3(1.1, 0.9, 0.7), heatWave * 0.2);

  // Rim glow: hot orange/red edge
  float rim = 1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
  rim = pow(rim, 1.5);
  color += rim * vec3(1.0, 0.3, 0.0) * 0.8;

  // Emissive: VERY aggressive, fire needs to burn bright
  float emissive = 1.5 + freq * 3.5 + uBass * 4.0;
  color *= emissive;

  // Explosion flash on bass drops
  float explosion = step(0.75, uBass) * step(0.7, freq);
  color += whiteHot * explosion * 2.0;

  // Top cap glow: white-hot tip
  float topGlow = smoothstep(0.82, 1.0, heightFactor) * freq;
  color += topGlow * whiteHot * 2.5;

  // View-dependent heat rim
  vec3 viewDir = normalize(vec3(sin(uTime * 0.15) * 0.3, 0.2, 1.0));
  float rim2 = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim2 = pow(rim2, 2.0);
  color += rim2 * 0.5 * vec3(1.0, 0.4, 0.1);

  // Bass pulse: fire surge
  float bassPulse = smoothstep(0.3, 0.7, uBass) * sin(uTime * 12.0 + t * 4.0) * 0.2;
  color += bassPulse * fireOrange;

  // Multi-layer ember sparkle
  float ember1 = step(0.85, freq) * hash(vInstanceId * 13.7 + floor(uTime * 15.0));
  float ember2 = step(0.90, freq) * hash(vInstanceId * 7.1 + floor(uTime * 22.0));
  float ember3 = step(0.95, freq) * hash(vInstanceId * 3.3 + floor(uTime * 30.0));
  color += vec3(1.0, 0.7, 0.2) * ember1 * 1.2;
  color += vec3(1.0, 0.5, 0.1) * ember2 * 1.0;
  color += whiteHot * ember3 * 1.5;

  // Inner fire glow
  float innerGlow = freq * freq * 0.3;
  color += innerGlow * fireOrange;

  gl_FragColor = vec4(color, 1.0);
}
`,

    groundFragShader: /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Volcanic / lava floor
  float lava1 = sin(vWorldPos.x * 2.0 + uTime * 0.4) * cos(vWorldPos.z * 1.8 - uTime * 0.3);
  float lava2 = sin(vWorldPos.x * 3.5 - uTime * 0.5) * cos(vWorldPos.z * 3.0 + uTime * 0.6);
  float lava = (lava1 + lava2) * 0.5 + 0.5;
  lava = pow(lava, 2.0);

  // Cracks of lava light
  float crackX = smoothstep(0.96, 1.0, abs(sin(vWorldPos.x * 4.0 + uTime * 0.3)));
  float crackZ = smoothstep(0.96, 1.0, abs(sin(vWorldPos.z * 3.5 - uTime * 0.2)));
  float cracks = max(crackX, crackZ);

  // Dark volcanic rock base
  vec3 color = vec3(0.03, 0.01, 0.005);

  // Lava glow in cracks
  vec3 lavaColor = mix(vec3(0.6, 0.1, 0.0), vec3(1.0, 0.5, 0.0), lava);
  color += lavaColor * cracks * (0.3 + uBass * 0.6);

  // Ember glow from center
  float centerGlow = (1.0 - dist) * 0.15 * (1.0 + uBass * 3.0);
  color += vec3(1.0, 0.3, 0.05) * centerGlow;

  // Expanding heat wave rings
  float ringDist = length(vWorldPos.xz);
  float heatRing1 = fract(uTime * 0.3) * 20.0;
  float heatRing2 = fract(uTime * 0.3 + 0.5) * 20.0;
  float hr1 = smoothstep(0.3, 0.0, abs(ringDist - heatRing1)) * smoothstep(20.0, 8.0, heatRing1);
  float hr2 = smoothstep(0.3, 0.0, abs(ringDist - heatRing2)) * smoothstep(20.0, 8.0, heatRing2);
  color += vec3(1.0, 0.3, 0.0) * (hr1 + hr2) * 0.12 * (0.5 + uBass * 1.5);

  // Heat shimmer: multi-frequency
  float shimmer1 = sin(dist * 20.0 + uTime * 2.0) * 0.5 + 0.5;
  float shimmer2 = sin(dist * 12.0 - uTime * 1.3) * 0.5 + 0.5;
  float shimmer = smoothstep(0.7, 1.0, shimmer1) * 0.05 + smoothstep(0.8, 1.0, shimmer2) * 0.03;
  color += vec3(1.0, 0.5, 0.05) * shimmer * (1.0 - dist);

  float alpha = smoothstep(1.0, 0.12, dist) * 0.78;
  gl_FragColor = vec4(color, alpha);
}
`,

    reflectionOpacity: 0.45,
    reflectionColorMul: 0.6,
    reflectionFadeRange: -3.0,

    particleColors: [
      [1.0, 0.4, 0.0],  // fire orange
      [1.0, 0.2, 0.0],  // deep red
      [1.0, 0.7, 0.1],  // yellow flame
      [1.0, 0.9, 0.5],  // white hot
      [0.8, 0.1, 0.0],  // ember red
      [1.0, 0.6, 0.0],  // golden flame
    ],
    particleSizeMultiplier: 1.4,
    particleSpeedMultiplier: 1.5,
  },

  // ════════════════════════════════════════════════════════════════════
  //  PRESET 6: CIRCUIT BOARD
  //  - Inspired by professional tech/cyberpunk logo design
  //  - Dark navy background with glowing cyan/teal circuit traces
  //  - Neon circuit nodes at junctions that pulse with bass
  //  - PCB trace patterns on the ground plane
  //  - Metallic bar shading with inner circuit glow
  //  - Professional electronic/tech aesthetic
  // ════════════════════════════════════════════════════════════════════

  'circuit-board': {
    id: 'circuit-board',
    label: 'Circuit Board',
    description: 'Bảng mạch phát sáng — đường mạch neon cyan, nút sáng, phong cách công nghệ chuyên nghiệp',

    clearColor: 0x040810,
    fogColor: 0x040810,
    fogDensity: 0.016,
    ambientLightColor: 0x0a1830,
    ambientLightIntensity: 0.45,
    pointLightColor: 0x00ddcc,
    pointLightIntensity: 2.2,

    bloomStrength: 1.9,
    bloomRadius: 0.55,
    bloomThreshold: 0.09,
    bloomBassMultiplier: 2.5,
    bloomPeakMultiplier: 1.3,

    cameraOrbitSpeed: 0.065,
    cameraHeightBase: 5.8,
    cameraBassLift: 1.5,

    toneMappingExposure: 1.25,

    barFragShader: /* glsl */ `
uniform float uBarCount;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uPeak;
uniform sampler2D uFreqTexture;
varying float vInstanceId;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;

${GLSL_COSINE_PALETTE}

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  float t = vInstanceId / uBarCount;
  float freq = texture2D(uFreqTexture, vec2(t, 0.0)).r;
  float hueShift = uTime * 0.03;

  // Circuit color palette: dark teal → bright cyan → electric blue → white
  vec3 circuit1 = cosinePalette(
    t + hueShift,
    vec3(0.15, 0.35, 0.4),
    vec3(0.25, 0.45, 0.5),
    vec3(1.0, 1.0, 0.8),
    vec3(0.10, 0.45, 0.55)
  );

  vec3 circuit2 = cosinePalette(
    t + hueShift + 0.35,
    vec3(0.1, 0.25, 0.45),
    vec3(0.3, 0.4, 0.5),
    vec3(0.8, 1.0, 1.2),
    vec3(0.20, 0.55, 0.65)
  );

  vec3 circuit3 = cosinePalette(
    t + hueShift + 0.65,
    vec3(0.2, 0.3, 0.5),
    vec3(0.2, 0.35, 0.4),
    vec3(1.0, 0.8, 0.6),
    vec3(0.15, 0.35, 0.50)
  );

  vec3 color = mix(circuit1, circuit2, freq * 0.5 + uTreble * 0.2);
  color = mix(color, circuit3, uMid * 0.25 + freq * 0.15);

  // Height gradient: bottom = dark metallic base, top = glowing cyan
  float heightFactor = smoothstep(0.0, 1.0, vWorldPos.y / max(vHeight, 0.01));

  // Metallic base color (dark gunmetal)
  vec3 metalBase = vec3(0.08, 0.1, 0.14);
  color = mix(metalBase, color, 0.3 + heightFactor * 0.7);

  // Circuit trace lines running up the bars (horizontal bands)
  float traceFreq1 = sin(vWorldPos.y * 25.0 + t * 30.0) * 0.5 + 0.5;
  float traceFreq2 = sin(vWorldPos.y * 50.0 - t * 15.0 + uTime * 1.5) * 0.5 + 0.5;
  float trace = smoothstep(0.88, 1.0, traceFreq1) + smoothstep(0.92, 1.0, traceFreq2) * 0.6;
  color += vec3(0.0, 0.9, 0.8) * trace * (0.3 + freq * 0.5);

  // Circuit node glow at specific heights (junction points)
  float nodePhase = fract(vWorldPos.y * 5.0 + t * 3.0);
  float node = smoothstep(0.03, 0.0, abs(nodePhase - 0.5)) * freq;
  color += vec3(0.0, 1.0, 0.9) * node * 1.5;

  // Top cap glow: bright cyan-white tip
  float topGlow = smoothstep(0.85, 1.0, heightFactor) * freq;
  color += topGlow * vec3(0.6, 1.0, 0.95) * 2.2;

  // Fresnel rim: electric blue edge highlight
  vec3 viewDir = normalize(vec3(sin(uTime * 0.1) * 0.3, 0.2, 1.0));
  float rim = 1.0 - abs(dot(normalize(vNormal), viewDir));
  rim = pow(rim, 2.0);
  vec3 rimColor = mix(vec3(0.0, 0.7, 1.0), vec3(0.0, 1.0, 0.8), sin(t * 6.28 + uTime * 0.4) * 0.5 + 0.5);
  color += rim * 0.8 * rimColor;

  // Emissive boost
  float brightness = 0.5 + freq * 1.0;
  float emissive = 0.9 + uBass * 2.5 + freq * 1.8 + uPeak * 0.7;
  color *= brightness * emissive;

  // Data pulse: traveling light along the bar ring
  float dataPulse = sin(t * 6.28 * 3.0 + uTime * 4.0) * 0.5 + 0.5;
  dataPulse = smoothstep(0.85, 1.0, dataPulse) * freq * 0.3;
  color += vec3(0.0, 0.8, 1.0) * dataPulse;

  // Bass pulse: circuit power surge
  float bassPulse = smoothstep(0.4, 0.8, uBass) * sin(uTime * 8.0 + t * 3.14) * 0.15;
  color += bassPulse * vec3(0.0, 0.6, 0.5);

  // Sparkle nodes at peak frequencies
  float sparkle1 = step(0.82, freq) * (sin(uTime * 18.0 + vInstanceId * 11.3) * 0.5 + 0.5) * 0.4;
  float sparkle2 = step(0.90, freq) * (cos(uTime * 27.0 + vInstanceId * 7.7) * 0.5 + 0.5) * 0.5;
  float sparkle3 = step(0.95, freq) * (sin(uTime * 35.0 + vInstanceId * 3.1) * 0.5 + 0.5) * 0.7;
  color += (sparkle1 + sparkle2 + sparkle3) * vec3(0.5, 1.0, 1.0);

  // PCB solder point flash on bass
  float solderFlash = step(0.7, uBass) * step(0.85, freq) * hash(vInstanceId * 19.7 + floor(uTime * 12.0));
  color += vec3(0.8, 1.0, 0.9) * solderFlash * 2.0;

  // Inner glow: circuit board energy
  float innerGlow = freq * freq * 0.2;
  color += innerGlow * circuit1;

  gl_FragColor = vec4(color, 1.0);
}
`,

    groundFragShader: /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uPeak;

varying vec2 vUv;
varying vec3 vWorldPos;

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float dist = length(vUv - 0.5) * 2.0;

  // Dark PCB substrate base
  vec3 color = vec3(0.02, 0.035, 0.05);

  // ── CIRCUIT TRACE GRID ──
  // Main traces (thick, orthogonal)
  float traceX1 = smoothstep(0.955, 1.0, abs(sin(vWorldPos.x * 3.14159 * 1.5)));
  float traceZ1 = smoothstep(0.955, 1.0, abs(sin(vWorldPos.z * 3.14159 * 1.5)));
  float mainTrace = max(traceX1, traceZ1);

  // Secondary traces (thinner, offset grid)
  float traceX2 = smoothstep(0.975, 1.0, abs(sin(vWorldPos.x * 3.14159 * 4.0 + 0.7)));
  float traceZ2 = smoothstep(0.975, 1.0, abs(sin(vWorldPos.z * 3.14159 * 4.0 + 0.7)));
  float subTrace = max(traceX2, traceZ2) * 0.5;

  // Diagonal traces (for PCB routing feel)
  float diagTrace = smoothstep(0.97, 1.0, abs(sin((vWorldPos.x + vWorldPos.z) * 3.14159 * 2.5)));
  diagTrace += smoothstep(0.97, 1.0, abs(sin((vWorldPos.x - vWorldPos.z) * 3.14159 * 2.5))) * 0.5;
  diagTrace *= 0.35;

  float allTraces = mainTrace + subTrace + diagTrace;

  // Trace color: glowing cyan/teal with bass reactivity
  vec3 traceColor = mix(vec3(0.0, 0.5, 0.5), vec3(0.0, 1.0, 0.9), sin(uTime * 0.2) * 0.3 + 0.5);
  color += traceColor * allTraces * (0.12 + uBass * 0.15);

  // ── CIRCUIT NODES (junction points) ──
  // Compute grid cell
  vec2 cellId = floor(vWorldPos.xz * 1.5);
  float nodeHash = hash2(cellId);
  vec2 cellCenter = (cellId + 0.5) / 1.5;
  float nodeDist = length(vWorldPos.xz - cellCenter);

  // Only some cells have nodes (pseudo-random selection)
  float hasNode = step(0.65, nodeHash);
  float nodeGlow = hasNode * smoothstep(0.3, 0.0, nodeDist) * 0.12;
  // Node core (bright)
  float nodeCore = hasNode * smoothstep(0.08, 0.0, nodeDist) * 0.5;

  // Node pulsation: each node pulses at a different phase
  float nodePulse = sin(uTime * 2.5 + nodeHash * 20.0) * 0.3 + 0.7;
  nodeGlow *= nodePulse * (1.0 + uBass * 1.5);
  nodeCore *= nodePulse;

  color += vec3(0.0, 0.9, 0.85) * nodeGlow;
  color += vec3(0.5, 1.0, 0.95) * nodeCore;

  // ── DATA FLOW ANIMATION ──
  // Traveling light pulses along main traces
  float dataFlow1 = sin(vWorldPos.x * 8.0 + uTime * 3.0) * 0.5 + 0.5;
  dataFlow1 = smoothstep(0.88, 1.0, dataFlow1) * mainTrace;
  float dataFlow2 = sin(vWorldPos.z * 8.0 - uTime * 2.5) * 0.5 + 0.5;
  dataFlow2 = smoothstep(0.88, 1.0, dataFlow2) * mainTrace;
  color += vec3(0.2, 1.0, 0.9) * (dataFlow1 + dataFlow2) * 0.18 * (0.5 + uBass * 0.8);

  // ── EXPANDING POWER RINGS ──
  float ringDist = length(vWorldPos.xz);
  float powerRing1 = fract(uTime * 0.3) * 22.0;
  float powerRing2 = fract(uTime * 0.3 + 0.5) * 22.0;
  float pr1 = smoothstep(0.25, 0.0, abs(ringDist - powerRing1)) * smoothstep(22.0, 10.0, powerRing1);
  float pr2 = smoothstep(0.25, 0.0, abs(ringDist - powerRing2)) * smoothstep(22.0, 10.0, powerRing2);
  color += vec3(0.0, 0.6, 0.7) * (pr1 + pr2) * 0.1 * (0.5 + uBass * 1.2);

  // ── COMPONENT PADS (IC chip outlines) ──
  vec2 padCell = floor(vWorldPos.xz * 0.8);
  float padHash = hash2(padCell * 3.7);
  vec2 padCenter = (padCell + 0.5) / 0.8;
  vec2 padDelta = abs(vWorldPos.xz - padCenter);
  float padSize = 0.3 + padHash * 0.15;
  float padOutline = step(padDelta.x, padSize) * step(padDelta.y, padSize);
  float padEdge = padOutline * (1.0 - step(padDelta.x, padSize - 0.02) * step(padDelta.y, padSize - 0.02));
  padEdge *= step(0.82, padHash); // Only some cells
  color += vec3(0.0, 0.4, 0.45) * padEdge * 0.08;

  // ── CENTER PROCESSOR GLOW ──
  float cpuGlow = (1.0 - dist) * 0.1 * (1.0 + uBass * 2.0);
  color += vec3(0.0, 0.5, 0.6) * cpuGlow;

  // Signal pulse from center on bass
  float signalPulse = smoothstep(0.02, 0.0, abs(ringDist - fract(uTime * 0.6 + uBass * 0.3) * 15.0));
  signalPulse *= smoothstep(15.0, 5.0, fract(uTime * 0.6) * 15.0) * uBass;
  color += vec3(0.0, 1.0, 0.85) * signalPulse * 0.15;

  // ── SUBTLE COPPER LAYER ──
  float copper = sin(vWorldPos.x * 1.5 + uTime * 0.1) * cos(vWorldPos.z * 1.2 - uTime * 0.08);
  copper = max(0.0, copper) * 0.015;
  color += vec3(0.15, 0.08, 0.02) * copper;

  // Radial fade to darkness at edges
  float alpha = smoothstep(1.0, 0.15, dist) * 0.72;

  gl_FragColor = vec4(color, alpha);
}
`,

    reflectionOpacity: 0.35,
    reflectionColorMul: 0.5,
    reflectionFadeRange: -2.5,

    particleColors: [
      [0.0, 0.9, 0.8],  // bright teal
      [0.0, 0.7, 1.0],  // electric cyan
      [0.2, 1.0, 0.9],  // mint glow
      [0.0, 0.5, 0.6],  // dark teal
      [0.5, 0.9, 1.0],  // pale cyan
      [0.0, 1.0, 0.7],  // green-teal
    ],
    particleSizeMultiplier: 0.9,
    particleSpeedMultiplier: 0.8,
  },
}

export const DEFAULT_THREEJS_PRESET: ThreeJsPresetId = 'neon-cyberpunk'

export const THREEJS_PRESET_LIST = Object.values(THREEJS_PRESETS)
