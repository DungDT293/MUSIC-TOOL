import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/**
 * Final look pass: radial chromatic aberration, vignette and a light film grain.
 *
 * Runs right before OutputPass, so it works in linear space and every style gets the
 * same "grade" without touching their shaders. Values are intentionally subtle —
 * the point is a finished look, not a filter you can see.
 */
export const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.4 },
    uGrain: { value: 0.008 },
    uAberration: { value: 0.0006 },
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
    varying vec2 vUv;

    void main() {
      vec2 center = vUv - 0.5;
      float dist = length(center);
      vec2 dir = dist > 0.0001 ? center / dist : vec2(0.0);
      float amount = uAberration * dist * 2.0;

      vec3 color;
      color.r = texture2D(tDiffuse, vUv + dir * amount).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - dir * amount).b;

      float vignette = smoothstep(1.05, 0.28, dist * 1.3);
      color *= mix(1.0, vignette, uVignette);

      float noise = fract(sin(dot(vUv * (uTime * 0.5 + 1.0), vec2(12.9898, 78.233))) * 43758.5453);
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
}
