import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/**
 * Final look pass: chromatic aberration, vignette, grain, plus the composition-level
 * effects (blur, tint, opacity, mirror, zoom) that the Effects panel drives.
 *
 * Runs right before OutputPass, so it works in linear space and every style gets the
 * same grade without touching their shaders.
 */
export const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.4 },
    uGrain: { value: 0.008 },
    uAberration: { value: 0.0006 },
    uBlur: { value: 0 },
    uAlpha: { value: 1 },
    uTint: { value: new THREE.Color(0xffffff) },
    uTintStrength: { value: 0 },
    uMirror: { value: 0 },
    uZoom: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uBlur;
    uniform float uAlpha;
    uniform vec3 uTint;
    uniform float uTintStrength;
    uniform float uMirror;
    uniform float uZoom;
    varying vec2 vUv;

    vec3 sampleBlur(vec2 uv) {
      if (uBlur <= 0.0005) return texture2D(tDiffuse, uv).rgb;
      // 9 taps in a ring: cheap, and enough for a soft "two pass" look at 1080p.
      vec2 step = vec2(uBlur) * (1.0 / 160.0);
      vec3 sum = texture2D(tDiffuse, uv).rgb * 0.25;
      sum += texture2D(tDiffuse, uv + vec2(step.x, 0.0)).rgb * 0.125;
      sum += texture2D(tDiffuse, uv - vec2(step.x, 0.0)).rgb * 0.125;
      sum += texture2D(tDiffuse, uv + vec2(0.0, step.y)).rgb * 0.125;
      sum += texture2D(tDiffuse, uv - vec2(0.0, step.y)).rgb * 0.125;
      sum += texture2D(tDiffuse, uv + step).rgb * 0.0625;
      sum += texture2D(tDiffuse, uv - step).rgb * 0.0625;
      sum += texture2D(tDiffuse, uv + vec2(step.x, -step.y)).rgb * 0.0625;
      sum += texture2D(tDiffuse, uv + vec2(-step.x, step.y)).rgb * 0.0625;
      return sum;
    }

    void main() {
      vec2 uv = vUv;
      if (uMirror > 0.5) uv.x = 1.0 - uv.x;
      if (abs(uZoom - 1.0) > 0.0001) uv = (uv - 0.5) / uZoom + 0.5;

      vec2 center = uv - 0.5;
      float dist = length(center);
      vec2 dir = dist > 0.0001 ? center / dist : vec2(0.0);
      float amount = uAberration * dist * 2.0;

      vec3 color;
      color.r = sampleBlur(uv + dir * amount).r;
      color.g = sampleBlur(uv).g;
      color.b = sampleBlur(uv - dir * amount).b;

      float vignette = smoothstep(1.05, 0.28, dist * 1.3);
      color *= mix(1.0, vignette, uVignette);

      if (uTintStrength > 0.0001) {
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(color, uTint * luma, uTintStrength);
      }
      color *= uAlpha;

      float noise = fract(sin(dot(uv * (uTime * 0.5 + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
      color += (noise - 0.5) * uGrain;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
}

export class FinishPass extends ShaderPass {
  constructor() {
    super(FinishShader)
  }

  set time(value: number) {
    this.uniforms.uTime.value = value
  }

  set aberration(value: number) {
    this.uniforms.uAberration.value = value
  }

  set vignette(value: number) {
    this.uniforms.uVignette.value = value
  }

  set grain(value: number) {
    this.uniforms.uGrain.value = value
  }

  set blur(value: number) {
    this.uniforms.uBlur.value = value
  }

  set alpha(value: number) {
    this.uniforms.uAlpha.value = value
  }

  set tint(hex: string) {
    ;(this.uniforms.uTint.value as THREE.Color).set(hex)
  }

  set tintStrength(value: number) {
    this.uniforms.uTintStrength.value = value
  }

  set mirror(value: boolean) {
    this.uniforms.uMirror.value = value ? 1 : 0
  }

  set zoom(value: number) {
    this.uniforms.uZoom.value = value
  }
}
