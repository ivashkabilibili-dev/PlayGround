// GLSL for AETHER's procedural worlds. Kept as plain strings so the whole
// renderer stays offline and dependency-free beyond three.js itself.

export const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(11.7, 5.3, 9.1);
    a *= 0.5;
  }
  return s;
}
float fbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec3(4.7, 8.3, 2.9);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    s += a * n * n;
    p = p * 2.1 + vec3(7.3, 3.1, 5.7);
    a *= 0.5;
  }
  return s;
}
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    vec2 i2 = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(fract(sin(dot(i2, vec2(127.1, 311.7))) * 43758.5453),
          fract(sin(dot(i2 + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453), f.x),
      mix(fract(sin(dot(i2 + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453),
          fract(sin(dot(i2 + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453), f.x), f.y);
    s += a * n;
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return s;
}
`;

export const PLANET_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PLANET_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uBaseA;
uniform vec3 uBaseB;
uniform vec3 uBaseC;
uniform vec3 uWater;
uniform vec3 uAtmo;
uniform vec3 uCloud;
uniform vec3 uIce;
uniform float uWaterLevel;
uniform float uCloudCover;
uniform float uCity;
uniform float uEmissive;
uniform float uScale;
uniform float uSeed;
uniform float uTime;
uniform float uType;
uniform float uBands;
uniform float uAtmoDensity;
uniform float uTidal;
uniform vec4 uCraters[12];
uniform int uCraterCount;
uniform vec4 uVolcanoes[5];
uniform int uVolcanoCount;

${NOISE}

vec3 planetColor(vec3 p, float h, float detail, float ice, out float isLand, out float isWater) {
  isLand = 0.0;
  isWater = 0.0;
  vec3 col = uBaseA;

  if (uType < 0.5 || (uType > 0.5 && uType < 1.5)) {
    // terrestrial / ocean
    float shore = smoothstep(uWaterLevel - 0.06, uWaterLevel + 0.02, h);
    float deep = smoothstep(0.0, uWaterLevel, h);
    vec3 ocean = mix(uWater * 0.35, uWater, deep);
    vec3 land = mix(uBaseA, uBaseB, smoothstep(0.48, 0.7, h + detail * 0.18));
    land = mix(land, uBaseC, smoothstep(0.7, 0.92, h));
    // beaches
    land = mix(land, uBaseC * 1.08, smoothstep(uWaterLevel, uWaterLevel + 0.028, h) * (1.0 - smoothstep(uWaterLevel + 0.03, uWaterLevel + 0.075, h)) * 0.7);
    col = mix(ocean, land, shore);
    isLand = shore;
    isWater = 1.0 - shore;
  } else if (uType < 2.5) {
    // desert
    float dune = ridged(p * vec3(4.0, 10.0, 4.0) + uSeed);
    col = mix(uBaseA, uBaseB, smoothstep(0.35, 0.7, h * 0.7 + dune * 0.45));
    col = mix(col, uBaseC, smoothstep(0.62, 0.9, h + dune * 0.2));
    col = mix(col, uBaseA * 0.72, smoothstep(0.4, 0.15, h) * 0.5);
    isLand = 1.0;
  } else if (uType < 3.5) {
    // frozen
    float crack = smoothstep(0.62, 0.78, ridged(p * 7.0 + uSeed));
    col = mix(uBaseA, uBaseB, smoothstep(0.25, 0.8, h));
    col = mix(col, uBaseC, smoothstep(0.55, 0.9, h + detail * 0.3));
    col = mix(col, uWater * 0.75, crack * 0.5);
    isLand = 1.0;
  } else if (uType < 4.5) {
    // lava
    float crust = fbm(p * uScale + uSeed);
    float crack = smoothstep(0.55, 0.78, ridged(p * 5.0 + uSeed * 1.7));
    col = mix(uBaseA, uBaseB, crust);
    col = mix(col, uBaseC, smoothstep(0.6, 0.85, crust) * 0.5);
    col = mix(col, uWater * 2.2, crack * 0.85);
    isLand = 1.0;
  } else if (uType < 5.5) {
    // gas giant
    float band = sin(p.y * uBands + fbm(p * 2.6 + uSeed) * 3.2);
    float swirl = fbm(p * vec3(3.0, 9.0, 3.0) + vec3(uTime * 0.008, 0.0, 0.0));
    col = mix(uBaseA, uBaseB, band * 0.5 + 0.5);
    col = mix(col, uBaseC, smoothstep(0.55, 0.85, swirl) * 0.65);
    col = mix(col, uBaseA * 0.75, smoothstep(0.0, 0.25, abs(band)) * 0.18);
    // great spot
    float lon = atan(p.z, p.x);
    float spot = exp(-pow((p.y + 0.28) * 9.0, 2.0) - pow((lon - 1.9) * 2.2, 2.0));
    col = mix(col, uWater * 1.5, spot * 0.65);
    isLand = 1.0;
  } else if (uType < 6.5) {
    // ice giant
    float band = sin(p.y * uBands + fbm(p * 2.0 + uSeed) * 2.0);
    col = mix(uBaseA, uBaseB, band * 0.5 + 0.5);
    col = mix(col, uBaseC, smoothstep(0.55, 0.9, fbm(p * 5.0 + uSeed)) * 0.35);
    isLand = 1.0;
  } else if (uType < 7.5) {
    // brown dwarf
    float band = sin(p.y * uBands + fbm(p * 3.0 + uSeed) * 2.6);
    col = mix(uBaseA, uBaseB, band * 0.5 + 0.5);
    col = mix(col, uBaseC, smoothstep(0.6, 0.9, fbm(p * 6.0 + uSeed * 2.0)) * 0.5);
    isLand = 1.0;
  } else if (uType < 8.5) {
    // carbon
    float strata = ridged(p * vec3(6.0, 2.0, 6.0) + uSeed);
    col = mix(uBaseA, uBaseB, smoothstep(0.3, 0.8, h * 0.6 + strata * 0.5));
    col = mix(col, uBaseC, smoothstep(0.7, 0.95, strata) * 0.5);
    isLand = 1.0;
  } else if (uType < 9.5) {
    // iron
    float strata = ridged(p * vec3(5.0, 3.0, 5.0) + uSeed);
    col = mix(uBaseA, uBaseB, smoothstep(0.25, 0.75, h));
    col = mix(col, uBaseC, smoothstep(0.6, 0.9, strata) * 0.7);
    isLand = 1.0;
  } else {
    // airless / scorched
    col = mix(uBaseA, uBaseB, smoothstep(0.3, 0.75, h));
    col = mix(col, uBaseC, smoothstep(0.7, 0.92, h) * 0.7);
    isLand = 1.0;
  }
  col = mix(col, uIce, ice);
  return col;
}

void main() {
  vec3 p = normalize(vPos);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uLightDir);

  float lat = abs(p.y);
  float h = fbm(p * uScale + uSeed * 0.37) * 0.72 + fbm3(p * uScale * 3.7 + 9.0) * 0.28;
  float detail = fbm3(p * uScale * 9.0 + uSeed);
  float ice = 0.0;
  if (uType < 4.5) ice = smoothstep(0.72, 0.93, lat + (detail - 0.5) * 0.22) * (uType < 2.5 ? 0.7 : 1.0);

  // deterministic impact craters
  for (int i = 0; i < 12; i++) {
    if (i >= uCraterCount) break;
    vec4 c = uCraters[i];
    float d = distance(p, c.xyz);
    float rr = c.w;
    float q = clamp(d / rr, 0.0, 1.0);
    h -= (1.0 - q * q) * 0.045 * c.z;
    h += smoothstep(rr * 1.15, rr * 0.92, d) * smoothstep(rr * 0.82, rr * 0.92, d) * 0.018;
  }

  // volcanic centres
  for (int i = 0; i < 5; i++) {
    if (i >= uVolcanoCount) break;
    vec4 v = uVolcanoes[i];
    float d = distance(p, v.xyz);
    h += smoothstep(v.w, v.w * 0.1, d) * 0.035;
  }

  float isLand = 0.0;
  float isWater = 0.0;
  vec3 col = planetColor(p, h, detail, ice, isLand, isWater);

  // tiny-scale albedo variation
  col *= 0.9 + 0.2 * fbm3(p * 40.0 + uSeed);

  vec3 Np = N;
  float ndl = dot(N, L);
  float day = smoothstep(-0.18, 0.22, ndl);
  float wrap = max(0.0, (ndl + 0.28) / 1.28);
  float diff = 0.045 + 1.18 * pow(wrap, 1.15);

  // ocean specular
  if (isWater > 0.5) {
    vec3 R = reflect(-L, N);
    float spec = pow(max(dot(R, V), 0.0), 90.0);
    col += vec3(1.0, 0.9, 0.7) * spec * 0.7;
    col *= 0.92;
  }

  vec3 lit = col * diff;

  // lava / brown dwarf self-emission
  if (uEmissive > 0.5) {
    float glow = smoothstep(0.5, 0.85, ridged(p * 5.0 + uSeed * 1.7));
    lit += uWater * glow * (0.45 + 0.8 * (1.0 - day)) * 1.6;
    lit += uWater * 0.08;
  }
  if (uType > 6.5 && uType < 7.5) {
    lit += col * 0.35;
  }

  // atmospheric limb scattering
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += uAtmo * fres * uAtmoDensity * (0.25 + 0.75 * day) * 1.1;

  // city lights on the night side
  float night = 1.0 - day;
  float cityMask = smoothstep(0.55, 0.72, fbm(p * 23.0 + uSeed * 3.0)) *
                   smoothstep(uWaterLevel + 0.012, uWaterLevel + 0.07, h) *
                   (1.0 - ice);
  lit += vec3(1.0, 0.68, 0.32) * cityMask * night * uCity * 2.6;

  // polar haze
  lit = mix(lit, uAtmo * 0.35, ice * 0.18);

  gl_FragColor = vec4(lit, 1.0);
}
`;

export const CLOUD_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uCover;
uniform float uSeed;
uniform float uTime;
uniform float uOpacity;
${NOISE}
void main() {
  vec3 p = normalize(vPos);
  float n = fbm(p * 3.1 + vec3(uTime * 0.006, uTime * 0.002, uSeed));
  float n2 = fbm3(p * 8.0 - uTime * 0.004 + uSeed);
  float n3 = fbm3(p * 21.0 + uSeed * 3.7);
  float a = smoothstep(0.55 - uCover * 0.22, 0.74, n * 0.62 + n2 * 0.26 + n3 * 0.12);
  if (a < 0.02) discard;
  vec3 N = normalize(vNormalW);
  float day = smoothstep(-0.2, 0.35, dot(N, normalize(uLightDir)));
  vec3 col = uColor * (0.06 + 0.94 * day);
  col += uColor * pow(1.0 - abs(dot(N, normalize(cameraPosition - vWorldPos))), 2.0) * 0.12;
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

export const CLOUD_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATMO_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormalW;
varying vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uStrength;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - abs(dot(N, V)), 2.4);
  float sun = max(dot(N, normalize(uLightDir)), 0.0);
  float a = rim * uStrength * (0.12 + 0.88 * sun);
  gl_FragColor = vec4(uColor, a);
}
`;

export const ATMO_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uSeed;
uniform float uType;
${NOISE}
void main() {
  vec3 p = normalize(vPos);
  float gran = fbm(p * 13.0 + vec3(uTime * 0.02, uSeed, 0.0));
  float fine = fbm3(p * 38.0 + uTime * 0.012);
  float spots = smoothstep(0.68, 0.88, fbm(p * 3.4 + uSeed * 2.0));
  vec3 col = mix(uColorA, uColorB, gran * 0.7 + fine * 0.3);
  col = mix(col, uColorA * 0.35, spots * 0.35);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = abs(dot(normalize(vNormalW), V));
  col *= 0.38 + 0.82 * pow(mu, 0.38);
  col *= 1.85;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const STAR_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const POINTS_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio * uScale * (900.0 / max(1.0, -mv.z)), 1.0, 20.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const POINTS_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float a = exp(-d * d * 3.4);
  gl_FragColor = vec4(vColor * a, a);
}
`;

export const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;
uniform float uTime;
uniform float uOpacity;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 3.2 + uSeed;
  float n = fbm2(p + vec2(uTime * 0.003, -uTime * 0.002));
  float n2 = fbm2(p * 2.4 + 4.1 - uTime * 0.0015);
  float a = smoothstep(0.34, 0.86, n * 0.68 + n2 * 0.32);
  float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x) *
               smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.2, 0.8, n2));
  col *= 0.65 + 0.7 * n;
  gl_FragColor = vec4(col, a * edge * uOpacity);
}
`;

export const RING_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform float uOpacity;
uniform float uSeed;
uniform float uInner;
uniform float uOuter;
${NOISE}
void main() {
  float r = length(vPos.xz);
  float t = (r - uInner) / max(0.0001, uOuter - uInner);
  float bands = fbm2(vec2(t * 26.0, uSeed)) * 0.6 + fbm2(vec2(t * 70.0, uSeed * 2.0)) * 0.4;
  float edge = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.92, t);
  float a = edge * uOpacity * (0.35 + 0.65 * smoothstep(0.2, 0.7, bands));
  // Cassini-like gaps
  a *= 0.55 + 0.45 * smoothstep(0.48, 0.52, abs(bands - 0.5));
  float lit = 0.45 + 0.55 * abs(dot(normalize(vPos), normalize(uLightDir)));
  gl_FragColor = vec4(uColor * lit, a);
}
`;

export const RING_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LENSING_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;
uniform float uActive;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 d = uv - uCenter;
  d.x *= uAspect;
  float r = length(d);
  vec2 dir = d / max(0.00001, r);
  float bend = uStrength * (uRadius * uRadius) / (r * r + uRadius * uRadius * 0.22);
  vec2 suv = uv - vec2(dir.x / uAspect, dir.y) * bend * 0.035 * uActive;
  vec4 col = texture2D(tDiffuse, clamp(suv, 0.001, 0.999));
  float ring = exp(-pow((r - uRadius * 0.98) / (uRadius * 0.055), 2.0));
  col.rgb += vec3(1.0, 0.78, 0.52) * ring * 0.42 * uActive;
  col.rgb *= 1.0 - smoothstep(uRadius * 0.55, uRadius * 0.98, r) * 0.35 * uActive;
  gl_FragColor = col;
}
`;

export const LENSING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const DISK_FRAG = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
uniform float uSeed;
uniform float uInner;
uniform float uOuter;
${NOISE}
void main() {
  float r = length(vPos.xz);
  float ang = atan(vPos.z, vPos.x);
  float t = (r - uInner) / max(0.001, uOuter - uInner);
  float swirl = fbm2(vec2(ang * 4.0 + t * 9.0, t * 18.0 - uTime * 0.08) + uSeed);
  float a = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.72, t);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 1.0, t));
  float doppler = 0.55 + 1.05 * smoothstep(-1.0, 1.0, cos(ang));
  col *= (0.7 + 0.8 * swirl) * doppler;
  gl_FragColor = vec4(col, a * 0.9);
}
`;

export const DISK_VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uHaze;
${NOISE}
void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 420.0) * 4.0;
  col += uSunColor * pow(sun, 7.0) * 0.28;
  float band = smoothstep(0.0, 0.35, dir.y) * (1.0 - smoothstep(0.55, 1.0, dir.y));
  float cloud = smoothstep(0.48, 0.76, fbm(dir * 4.2 + vec3(1.3, 2.7, 0.4)));
  cloud += smoothstep(0.56, 0.84, fbm(dir * 9.0 + vec3(8.1, 4.4, 2.2))) * 0.55;
  cloud += smoothstep(0.6, 0.82, fbm(vec3(dir.x * 3.0, dir.y * 13.0, dir.z * 3.0) + vec3(2.2, 7.1, 4.4))) * 0.35;
  cloud = clamp(cloud, 0.0, 1.0);
  vec3 cloudCol = mix(uHorizon * 1.35, uSunColor * 0.9, pow(sun, 3.0) * 0.35);
  col = mix(col, cloudCol, cloud * uHaze * band * 0.7);
  col += uSunColor * pow(sun, 26.0) * 0.12 * uHaze;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uWater;
uniform vec3 uSky;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uFogNear;
uniform float uFogFar;
${NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = length(cameraPosition - vWorldPos);
  float w1 = sin(vWorldPos.x * 0.075 + uTime * 0.55) * 0.55;
  float w2 = sin(vWorldPos.z * 0.11 - uTime * 0.42) * 0.45;
  float w3 = sin((vWorldPos.x + vWorldPos.z) * 0.21 + uTime * 0.9) * 0.22;
  float w4 = vnoise(vec3(vWorldPos.x * 0.35, uTime * 0.35, vWorldPos.z * 0.35)) - 0.5;
  vec3 N = normalize(vec3((w1 + w3) * 0.045, 1.0, (w2 + w3) * 0.045 + w4 * 0.03));
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);
  vec3 col = mix(uWater * 0.55, uSky * 0.95, fres * 0.72);
  vec3 H = normalize(normalize(uSunDir) + V);
  float spec = pow(max(dot(N, H), 0.0), 260.0);
  col += uSunColor * spec * 2.2;
  float glitter = smoothstep(0.72, 0.96, vnoise(vec3(vWorldPos.x * 0.55, uTime * 0.5, vWorldPos.z * 0.55)));
  col += uSunColor * glitter * 0.045;
  float fog = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fog * 0.92);
  gl_FragColor = vec4(col, mix(0.86, 1.0, fres));
}
`;

export const LAVA_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uFogNear;
uniform float uFogFar;
${NOISE}
void main() {
  vec3 p = vec3(vWorldPos.x * 0.035, uTime * 0.11, vWorldPos.z * 0.035);
  float n = fbm(p);
  float n2 = fbm3(p * 2.7 + 4.2);
  float heat = smoothstep(0.38, 0.78, n * 0.7 + n2 * 0.3);
  float crust = smoothstep(0.3, 0.62, n2);
  vec3 col = mix(uColorA, uColorB, heat);
  col = mix(col, uColorB * 1.7, pow(heat, 4.0) * 0.9);
  col *= 0.55 + crust * 0.55;
  float dist = length(cameraPosition - vWorldPos);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fog * 0.9);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const WATER_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
