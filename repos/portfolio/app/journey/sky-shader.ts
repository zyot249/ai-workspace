import {
  CLOUD_OCTAVE_SHIFT, CLOUD_OCTAVES, CLOUD_OPACITY, CLOUD_SCALE, CLOUD_SOFTNESS, COVER_THRESHOLDS,
  HORIZON_FLAT, SKY_MAX_LUMINANCE, type SkyVariant,
} from './sky-mirror'
import { glslFloat } from './shader-utils'

// The dome mesh is unrotated and centred on the camera, so the local vertex
// position is the view direction.
export const SKY_VERTEX_SHADER = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Mirrors sky-mirror.ts step by step; change both together.
export function skyFragmentShader(variant: SkyVariant): string {
  const t = COVER_THRESHOLDS[variant].map(glslFloat)
  const shift = `vec2(${glslFloat(CLOUD_OCTAVE_SHIFT[0])}, ${glslFloat(CLOUD_OCTAVE_SHIFT[1])})`
  return `precision highp float;
#define CLOUD_OCTAVES ${CLOUD_OCTAVES[variant]}
#define CLOUD_SELF_SHADOW ${variant === 'full' ? 1 : 0}
#define SKY_MAX_LUMINANCE ${glslFloat(SKY_MAX_LUMINANCE)}
#define HORIZON_FLAT ${glslFloat(HORIZON_FLAT)}
#define CLOUD_SCALE ${glslFloat(CLOUD_SCALE)}
#define CLOUD_SOFTNESS ${glslFloat(CLOUD_SOFTNESS)}
#define CLOUD_OPACITY ${glslFloat(CLOUD_OPACITY)}
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;
uniform float uCloudCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec2 uCloudOffset;
varying vec3 vDir;

float skyCurve(float x) {
  return pow(smoothstep(0.0, 1.0, clamp(x, 0.0, 1.0)), 1.2);
}

float cloudHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudFbm2(vec2 p) {
  float sum = 0.5 * cloudNoise(p);
  p = p * 2.0 + ${shift};
  sum += 0.25 * cloudNoise(p);
  return sum / 0.75;
}

#if CLOUD_OCTAVES == 4
float cloudFbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * cloudNoise(p);
    p = p * 2.0 + ${shift};
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}
#else
float cloudFbm(vec2 p) {
  return cloudFbm2(p);
}
#endif

float coverThreshold(float cover) {
  float c = clamp(cover, 0.0, 1.0) * 4.0;
  float i = min(3.0, floor(c));
  float f = c - i;
  if (i < 1.0) return mix(${t[0]}, ${t[1]}, f);
  if (i < 2.0) return mix(${t[1]}, ${t[2]}, f);
  if (i < 3.0) return mix(${t[2]}, ${t[3]}, f);
  return mix(${t[3]}, ${t[4]}, f);
}

vec2 horizontalOf(vec3 v) {
  return v.xz / max(length(v.xz), 1e-4);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float hh = max(h - HORIZON_FLAT, 0.0) / (1.0 - HORIZON_FLAT);
  vec3 low = mix(uHorizon, uMid, skyCurve(hh / 0.4));
  vec3 base = mix(low, uZenith, skyCurve((hh - 0.25) / 0.75));

  float vis = smoothstep(-0.3, 0.0, uSunDir.y);
  float env = smoothstep(0.01, 0.05, h);
  float s = max(dot(dir, uSunDir), 0.0);
  float glow = (pow(s, 8.0) * 0.5 + pow(s, 64.0) * 0.8) * uSunGlow * vis * env;
  float bandX = (h - 0.07) / 0.07;
  float facing = 0.5 + 0.5 * dot(horizontalOf(dir), horizontalOf(uSunDir));
  float band = 0.25 * uSunGlow * vis * env * exp(-bandX * bandX) * facing;
  vec3 glowTerm = uSunColor * (glow + band);

  vec2 uv = dir.xz / max(h, 0.05) * CLOUD_SCALE + uCloudOffset;
  float n = cloudFbm(uv);
  float threshold = coverThreshold(uCloudCover);
  float density = smoothstep(threshold, threshold + CLOUD_SOFTNESS, n) * smoothstep(0.02, 0.15, h);
  vec3 cloud = mix(uCloudLit, uCloudShade, smoothstep(0.55, 1.0, n));
#if CLOUD_SELF_SHADOW == 1
  float shadowNoise = cloudFbm2(uv + uSunDir.xz * 0.08);
  cloud = mix(cloud, uCloudShade, 0.5 * clamp((shadowNoise - n) * 4.0, 0.0, 1.0));
#endif

  vec3 col = mix(base + glowTerm, cloud + glowTerm * 0.4, density * CLOUD_OPACITY);
  float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= min(1.0, SKY_MAX_LUMINANCE / max(luminance, 1e-4));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
}
