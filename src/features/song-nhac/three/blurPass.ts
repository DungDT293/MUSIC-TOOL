import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/**
 * Separable Gaussian blur pass. Two instances (horizontal then vertical) give a much
 * cleaner result than sampling a single 2D kernel, which is what the reference editor
 * calls "two pass blur".
 */
export const BlurShader = {
  name: 'SongNhacBlurShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uRadius: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
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
    uniform vec2 uDirection;
    uniform float uRadius;
    uniform vec2 uResolution;
    varying vec2 vUv;

    void main() {
      if (uRadius <= 0.0001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 texel = (uDirection / uResolution) * uRadius;
      vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
      sum += texture2D(tDiffuse, vUv + texel * 1.3846).rgb * 0.316216;
      sum += texture2D(tDiffuse, vUv - texel * 1.3846).rgb * 0.316216;
      sum += texture2D(tDiffuse, vUv + texel * 3.2308).rgb * 0.070270;
      sum += texture2D(tDiffuse, vUv - texel * 3.2308).rgb * 0.070270;
      gl_FragColor = vec4(sum, 1.0);
    }
  `,
}

export class BlurPass extends ShaderPass {
  constructor() {
    super(BlurShader)
  }

  set direction(value: THREE.Vector2) {
    ;(this.uniforms.uDirection.value as THREE.Vector2).copy(value)
  }

  set radius(value: number) {
    this.uniforms.uRadius.value = value
  }

  set width(value: number) {
    ;(this.uniforms.uResolution.value as THREE.Vector2).x = value
  }

  set height(value: number) {
    ;(this.uniforms.uResolution.value as THREE.Vector2).y = value
  }
}
