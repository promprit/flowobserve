export const SNOISE = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;
const vbody = (decl: string, pos: string) => `
attribute vec3 position2; attribute float aT; attribute float aSeed;
uniform float uTime, uSize, uPhase, uLit, uReveal, uMorph;${decl}
varying float vA; varying float vSeed;
${SNOISE}
void main(){
  vec3 p = ${pos};
  vec4 wp = modelMatrix * vec4(p, 1.0);
  float n1 = snoise(vec3(wp.x*0.32, wp.z*0.32 + wp.y*0.2, uTime*0.16));
  float n2 = snoise(vec3(wp.y*0.40, wp.x*0.25, uTime*0.2));
  p += vec3(n2*0.07, n1*0.09, n1*0.05);
  float pulse = pow(0.5 + 0.5*sin(aT*16.0 - uPhase), 8.0);
  float drawn = 1.0 - smoothstep(uReveal - 0.012, uReveal, aT);
  vA = (0.14 + aSeed*0.14 + pulse*0.5*drawn + uLit*0.6*drawn) * mix(0.16, 1.0, drawn);
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (1.0 + pulse*0.8*drawn + uLit*0.9*drawn) * (64.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
export const VERT = vbody("", "mix(position, position2, uMorph)");
export const LANE_VERT = vbody(`
uniform vec3 uA0, uA1, uA2, uB0, uB1, uB2;
vec3 bz(vec3 a, vec3 b, vec3 c, float t){ float u = 1.0 - t; return u*u*a + 2.0*u*t*b + t*t*c; }`,
  "mix(bz(uA0, uA1, uA2, aT), bz(uB0, uB1, uB2, aT), uMorph) + position");
export const FRAG = `
uniform vec3 uColor, uPaper; uniform float uAlpha; varying float vA; varying float vSeed;
void main(){
  float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.06, r);
  gl_FragColor = vec4(mix(uColor, uPaper, vSeed*0.22), a * vA * uAlpha);
}`;

/** Shared by floor and wordmark: world to floor frame, and the ship ring wave. */
const FIELD_COMMON = `
uniform float uMorph; uniform vec3 uOrigin; uniform vec2 uPulseOrigin; uniform float uPulseT;
const float WAVE_R = 30.0;
vec2 toLocal(vec3 w){ vec3 d = w - uOrigin; return mix(d.xz, vec2(-d.y / 0.85, d.x / 1.1), uMorph); }
float ring(vec2 l){ if (uPulseT < 0.0) return 0.0; float d = length(l - uPulseOrigin) - uPulseT * WAVE_R; return exp(-d * d / 2.0) * (1.0 - uPulseT); }`;
export const FLOOR_VERT = `${FIELD_COMMON}
varying vec2 vL; varying float vWave;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vL = toLocal(w.xyz); vWave = ring(vL);
  w.xyz += normalize(mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), uMorph)) * vWave * 0.35;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const FLOOR_FRAG = `
uniform float uTime, uActivity; uniform vec4 uAttn[3]; uniform vec3 uAmber, uRed, uLine;
varying vec2 vL; varying float vWave;
float gridLine(vec2 p){ vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p); return 1.0 - min(min(g.x, g.y), 1.0); }
void main(){
  float fade = 1.0 - smoothstep(26.0, 110.0, length(vL));
  float breathe = uActivity * (0.5 + 0.5 * sin(6.2831853 * uTime / 6.0));
  float line = gridLine(vL) * (0.22 + 0.18 * breathe);
  vec3 col = uLine * (line + vWave * 0.6);
  float a = line + vWave * 0.25;
  for (int i = 0; i < 3; i++) {
    vec4 p = uAttn[i];
    if (p.w < 0.5) continue;
    float pool = (1.0 - smoothstep(0.0, p.z, length(vL - p.xy))) * 0.32;
    col += (p.w < 1.5 ? uAmber : uRed) * pool; a += pool;
  }
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * fade);
}`;
export const WORD_VERT = `${FIELD_COMMON}
varying vec2 vUv; varying float vWave;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWave = ring(toLocal(w.xyz)); gl_Position = projectionMatrix * viewMatrix * w; }`;
export const WORD_FRAG = `
uniform sampler2D uMap; uniform float uOpacity; varying vec2 vUv; varying float vWave;
void main(){ gl_FragColor = vec4(vec3(0.949, 0.941, 0.918), texture2D(uMap, vUv).a * uOpacity * (1.0 + 3.0 * vWave)); }`;
