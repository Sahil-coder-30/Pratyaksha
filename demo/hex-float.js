/**
 * PRATYAKSHA (प्रत्यक्ष) — HexFloat WebGL2 Floor Engine
 * Sovereign On-Device Canvas UI
 *
 * Implements:
 * - 3D Perspective Raymarched Floating Hex Tile Floor
 * - 2D Navier-Stokes Fluid Dynamics (Advection, Curl, Vorticity, Divergence, Pressure, Splat)
 * - Specular Iridescent Highlights & Beveled Rims
 * - Dynamic Cursor Fluid Splats that flatten tiles into a readable window
 * - Bloom & Film Grain Post-Processing Passes
 */

const canvasDimensionLimits = new WeakMap();

/** Keep existing DPR budget, then account for browser pinch zoom */
function getCanvasPixelRatio(element, context) {
  const scale = window.visualViewport?.scale || 1;
  const requested = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const width = Math.max(element.clientWidth, 1);
  const height = Math.max(element.clientHeight, 1);
  let maxDimension = 8192;
  if (context) {
    let limit = canvasDimensionLimits.get(context);
    if (limit === undefined) {
      limit = Math.min(
        maxDimension,
        context.getParameter(context.MAX_TEXTURE_SIZE),
        context.getParameter(context.MAX_RENDERBUFFER_SIZE)
      );
      canvasDimensionLimits.set(context, limit);
    }
    maxDimension = limit;
  }
  return Math.min(
    requested,
    maxDimension / Math.max(width, height),
    Math.sqrt(16777216 / (width * height))
  );
}

function createCanvasResizeObserver(onResize) {
  const viewport = window.visualViewport;
  let frame = 0;
  let disconnected = false;
  const schedule = () => {
    if (frame || disconnected) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onResize();
    });
  };
  const observer = new ResizeObserver(schedule);
  window.addEventListener('resize', schedule, { passive: true });
  viewport?.addEventListener('resize', schedule, { passive: true });
  return {
    observe(element, options) {
      observer.observe(element, options);
    },
    unobserve(element) {
      observer.unobserve(element);
    },
    disconnect() {
      disconnected = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
    }
  };
}

export const HEX_FLOAT_DEFAULTS = {
  size: 80, // Sized perfectly for the sidepanel viewport
  gap: 0,
  bevel: 1.5,
  tilt: 24,
  perspective: 0.5,
  float: 0.25, // Gentle bobbing float
  speed: 1,
  shine: 0.65,
  lift: 0.15,
  radius: 800,
  flow: 1.0, // Cursor pushes fluid around
  swirl: 2.5, // Fluid vorticity creates gentle swirling eddies
  trail: 0.35, // Linger before healing
  iridescence: 1.2,
  bloom: 0.15,
  grain: 0.45,
  gapColor: 'auto'
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform vec2 uRes;
uniform float uSize;
uniform float uGap;
uniform float uBevel;
uniform float uTilt;
uniform float uDist;
uniform float uFloat;
uniform float uShine;
uniform float uLift;
uniform float uIrid;
uniform sampler2D uFlow;
uniform vec2 uScroll;
uniform float uTime;
uniform float uHasContent;
uniform float uMaxX;
uniform vec3 uBg;
uniform vec3 uGapColor;

const float TAU = 6.2831853;
const float SQ3 = 1.7320508;

float hash12 (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hextile (inout vec2 p) {
  const vec2 sz = vec2(1.0, SQ3);
  const vec2 hsz = 0.5 * sz;
  vec2 p1 = mod(p, sz) - hsz;
  vec2 p2 = mod(p - hsz, sz) - hsz;
  vec2 p3 = dot(p1, p1) < dot(p2, p2) ? p1 : p2;
  vec2 n = (p3 - p + hsz) / sz;
  p = p3;
  n -= vec2(0.5);
  return round(n * 2.0) * 0.5;
}

float hexDist (vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

float flowAt (vec2 xy) {
  vec2 uv = (xy * uSize - uScroll) / uRes;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return clamp(texture(uFlow, uv).r, 0.0, 4.0);
}

float tileZ (vec2 center, float f) {
  vec2 id = center * vec2(1.0, 1.0 / SQ3);
  float h = hash12(id * 7.31 + 3.7);
  float focus = smoothstep(0.18, 0.85, f);
  float ring = smoothstep(0.02, 0.14, f) * (1.0 - smoothstep(0.14, 0.6, f));
  float bob = uFloat * 0.4 * sin(uTime * 1.4 + h * TAU) * (1.0 - focus);
  float lift = uLift * ring;
  return -(bob + lift * 1.2);
}

vec4 page (vec2 px) {
  vec2 p = px / uRes;
  if (p.x < 0.0 || p.x > uMaxX || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
  return texture(uContent, p);
}

vec4 shade (vec2 sUv) {
  float cell = max(uSize, 8.0);
  float hw = max(0.5 - (uGap / cell) * 0.5, 0.15);
  float bevW = clamp(uBevel / cell, 0.0, hw - 0.1);
  float th = 0.09;

  float aspect = uRes.x / uRes.y;
  vec2 ndc = vec2((sUv.x * 2.0 - 1.0) * aspect, sUv.y * 2.0 - 1.0);

  float sa = sin(uTilt);
  float ca = cos(uTilt);
  vec3 fwd = vec3(0.0, -sa, ca);
  vec3 upv = vec3(0.0, ca, sa);
  float H = uRes.y / cell;
  float D = H * uDist;
  float focal = (D + sqrt(D * D + H * H * sa * sa)) / (H * ca);
  float dy = 0.5 * H - sa * D
    - ca * D * (ca - focal * sa) / (sa + focal * ca);
  vec3 la = vec3(uScroll.x / cell + 0.5 * uRes.x / cell,
                 uScroll.y / cell + 0.5 * H + dy, 0.0);
  vec3 ro = la - fwd * D;
  vec3 rd = normalize(vec3(ndc.x, 0.0, 0.0) + ndc.y * upv + focal * fwd);

  vec3 seam = uGapColor;

  if (rd.z < 0.02) {
    return uHasContent > 0.5 ? vec4(uBg, 1.0) : vec4(uBg, 0.95);
  }

  float maxUp = uFloat * 0.4 + uLift * 1.2 + th;
  float floorZ = th + 0.06;
  float tFloor = (floorZ - ro.z) / rd.z;
  float t0 = max((-maxUp - ro.z) / rd.z, 0.0);

  vec2 oxy = ro.xy;
  vec2 rxy = rd.xy;
  vec2 sp = oxy + rxy * t0;
  vec2 local = sp;
  hextile(local);
  vec2 center = sp - local;

  vec2 N0 = vec2(1.0, 0.0);
  vec2 N1 = vec2(0.5, 0.8660254);
  vec2 N2 = vec2(-0.5, 0.8660254);

  bool hit = false;
  bool onTop = false;
  float tHit = 0.0;
  vec3 n = vec3(0.0, 0.0, -1.0);
  float zc = 0.0;

  float hwc = hw;
  float fCell = 0.0;
  for (int i = 0; i < 64; i++) {
    fCell = flowAt(center);
    zc = tileZ(center, fCell);
    hwc = mix(hw, 0.502, smoothstep(0.18, 0.85, fCell));
    float zTop = zc - th;
    float tZin = (zTop - ro.z) / rd.z;
    float tZout = (zc + th - ro.z) / rd.z;

    float tIn = -1.0e9;
    float tOut = 1.0e9;
    vec2 inN = vec2(0.0);
    bool empty = false;
    for (int k = 0; k < 3; k++) {
      vec2 Nk = k == 0 ? N0 : (k == 1 ? N1 : N2);
      float d = dot(rxy, Nk);
      float o = dot(oxy - center, Nk);
      if (abs(d) < 1.0e-6) {
        if (abs(o) > hwc) { empty = true; break; }
      } else {
        float ta = (-hwc - o) / d;
        float tb = (hwc - o) / d;
        float lo = min(ta, tb);
        float hi = max(ta, tb);
        if (lo > tIn) { tIn = lo; inN = -sign(d) * Nk; }
        tOut = min(tOut, hi);
      }
    }

    if (!empty) {
      float lo = max(tIn, tZin);
      float hi = min(tOut, tZout);
      if (lo <= hi && hi > 0.0) {
        tHit = max(lo, 0.0);
        onTop = tZin >= tIn;
        n = onTop ? vec3(0.0, 0.0, -1.0) : vec3(inN, 0.0);
        hit = true;
        break;
      }
    }

    float tExit = 1.0e9;
    vec2 step2 = vec2(0.0);
    for (int k = 0; k < 3; k++) {
      vec2 Nk = k == 0 ? N0 : (k == 1 ? N1 : N2);
      float d = dot(rxy, Nk);
      if (abs(d) < 1.0e-6) continue;
      float o = dot(oxy - center, Nk);
      float te = (0.5 * sign(d) - o) / d;
      if (te < tExit) { tExit = te; step2 = sign(d) * Nk; }
    }
    if (tExit >= tFloor || step2 == vec2(0.0)) break;
    center += step2;
  }

  vec3 Ld = normalize(vec3(-0.35, -0.5, -0.78));

  if (!hit) {
    vec2 fl = (oxy + rxy * tFloor);
    vec2 fLocal = fl;
    hextile(fLocal);
    float open = smoothstep(hw, hw + 0.22, hexDist(fLocal));
    return vec4(seam * mix(0.72, 1.0, open), 0.95);
  }

  vec3 p = ro + rd * tHit;
  float fc = smoothstep(0.18, 0.85, fCell);

  if (onTop) {
    vec2 lp = p.xy - center;
    float e = hwc - hexDist(lp);
    if (e < bevW) {
      float ax = abs(lp.x);
      float a1 = abs(dot(lp, N1));
      float a2 = abs(dot(lp, N2));
      vec2 dir = ax > a1 && ax > a2 ? N0 : (a1 > a2 ? N1 : N2);
      dir *= sign(dot(lp, dir));
      float k = (1.0 - smoothstep(0.0, max(bevW, 1.0e-4), e)) * (1.0 - fc);
      n = normalize(mix(vec3(0.0, 0.0, -1.0), vec3(dir * 0.85, -0.6), k));
    }
  }

  float diff = max(dot(n, Ld), 0.0);
  vec3 refl = reflect(rd, n);
  vec3 Ld2 = normalize(vec3(0.55, -0.25, -0.8));
  float glintL = pow(max(dot(refl, Ld), 0.0), 120.0);
  float sheenL = pow(max(dot(refl, Ld2), 0.0), 8.0) * 0.35;
  float spec = (glintL + sheenL) * uShine * (1.0 - fc);
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * (1.0 - fc);
  float iridPh = dot(n, -rd) * 2.2 + (p.x + p.y) * 0.22;
  vec3 iridTint = 1.0 + uIrid * 0.3 * cos(vec3(0.0, 2.094, 4.188) + iridPh * 3.5);
  vec3 specCol = spec * iridTint;
  float raised = clamp(-zc, -0.6, 1.4);

  if (onTop) {
    vec4 c = uHasContent > 0.5 ? page(p.xy * cell - uScroll) : vec4(0.0);
    vec3 tileColor = mix(uBg, vec3(0.96, 0.975, 1.0), 0.5);
    vec3 face = mix(tileColor, c.rgb, c.a);
    vec3 lit = face * (0.86 + 0.14 * diff + raised * 0.08)
      + specCol * 0.95 + fres * iridTint * 0.16 * uShine;
    return vec4(mix(lit, face, fc * 0.85), 0.96);
  }

  float wallAo = 1.0 - smoothstep(zc - th, floorZ, p.z) * 0.4;
  vec3 wallCol = seam * mix(0.55, 1.0, diff) * wallAo
    + specCol * 1.3 + fres * iridTint * 0.28 * uShine;
  return vec4(wallCol, 0.98);
}

void main () {
  vec2 sUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 px = 1.0 / uRes;
  vec4 a = shade(sUv + vec2( 0.125,  0.375) * px);
  vec4 b = shade(sUv + vec2(-0.125, -0.375) * px);
  vec4 c = a + b;
  if (dot(abs(a - b), vec4(1.0)) > 0.02) {
    c += shade(sUv + vec2(-0.375,  0.125) * px)
       + shade(sUv + vec2( 0.375, -0.125) * px);
    outColor = c * 0.25;
  } else {
    outColor = c * 0.5;
  }
}`;

const SIM_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SPLAT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec3 uColor;
uniform vec2 uPoint;
uniform float uRadius;
void main () {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
  vec3 base = texture(uTarget, vUv).xyz;
  outColor = vec4(base + splat, 1.0);
}`;

const FRAG_ADVECT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float uDt;
uniform float uDissipation;
void main () {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * texelSize;
  outColor = uDissipation * texture(uSource, coord);
  outColor.a = 1.0;
}`;

const FRAG_CLEAR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTexture;
uniform float uValue;
void main () {
  outColor = uValue * texture(uTexture, vUv);
}`;

const FRAG_DIVERGENCE = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  float div = 0.5 * (R - L + T - B);
  outColor = vec4(div, 0.0, 0.0, 1.0);
}`;

const FRAG_CURL = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  outColor = vec4(vorticity, 0.0, 0.0, 1.0);
}`;

const FRAG_VORTICITY = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L)) * 0.5;
  force /= length(force) + 1.0;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy;
  outColor = vec4(velocity + force * uDt, 0.0, 1.0);
}`;

const FRAG_PRESSURE = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  outColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const FRAG_GRADIENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

const FRAG_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
void main () {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  outColor = vec4(c * smoothstep(0.55, 0.95, l), 1.0);
}`;

const FRAG_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uDir;
void main () {
  vec3 c = texture(uScene, vUv).rgb * 0.227027;
  c += texture(uScene, vUv + uDir * 1.3846154).rgb * 0.3162162;
  c += texture(uScene, vUv - uDir * 1.3846154).rgb * 0.3162162;
  c += texture(uScene, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture(uScene, vUv - uDir * 3.2307692).rgb * 0.0702703;
  outColor = vec4(c, 1.0);
}`;

const FRAG_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloomTex;
uniform float uBloomAmt;
uniform float uGrainAmt;
uniform float uTime;
void main () {
  vec4 scene = texture(uScene, vUv);
  vec3 bloom = texture(uBloomTex, vUv).rgb * uBloomAmt;
  vec3 col = scene.rgb + bloom;
  float g = fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 61.7, uTime * 123.4),
    vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += g * uGrainAmt * 0.14;
  float ba = dot(bloom, vec3(0.333));
  outColor = vec4(col, clamp(scene.a + ba, 0.0, 1.0));
}`;

const SIM_RES = 96;
const FLOW_RES = 256;
const SIM_DT = 1 / 60;
const VELOCITY_DISSIPATION = 0.985;
const PRESSURE_DECAY = 0.8;
const PRESSURE_ITERATIONS = 4;

export function createHexFloat(outputCanvas, options = {}) {
  const config = { ...HEX_FLOAT_DEFAULTS, ...options };
  const output = outputCanvas;

  const gl = output.getContext('webgl2', {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true
  });
  if (!gl || gl.isContextLost()) {
    console.warn('[HexFloat] WebGL2 not supported or context lost');
    return null;
  }

  const supportsFloatTargets = Boolean(
    gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')
  );
  if (!supportsFloatTargets) {
    console.warn('[HexFloat] Float render targets not supported');
    return null;
  }

  function compile(type, text) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('HexFloat shader error:', gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const supportsLinear = Boolean(gl.getExtension('OES_texture_float_linear'));
  const filtering = supportsLinear ? gl.LINEAR : gl.NEAREST;

  const simShaders = [];
  const simPrograms = [];

  function compileSim(type, text) {
    const shader = compile(type, text);
    simShaders.push(shader);
    return shader;
  }

  const simVertexShader = compileSim(gl.VERTEX_SHADER, SIM_VERT);

  function createSimProgram(fragSource) {
    const prog = gl.createProgram();
    gl.attachShader(prog, simVertexShader);
    gl.attachShader(prog, compileSim(gl.FRAGMENT_SHADER, fragSource));
    gl.linkProgram(prog);
    simPrograms.push(prog);
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { program: prog, uniforms: u };
  }

  const splatProgram = createSimProgram(FRAG_SPLAT);
  const advectProgram = createSimProgram(FRAG_ADVECT);
  const clearProgram = createSimProgram(FRAG_CLEAR);
  const divergenceProgram = createSimProgram(FRAG_DIVERGENCE);
  const curlProgram = createSimProgram(FRAG_CURL);
  const vorticityProgram = createSimProgram(FRAG_VORTICITY);
  const pressureProgram = createSimProgram(FRAG_PRESSURE);
  const gradientProgram = createSimProgram(FRAG_GRADIENT);

  function createTarget(size, internalFormat, format, filter) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, size, size, 0, format, gl.HALF_FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, texture, width: size, height: size };
  }

  function createDoubleTarget(size, internalFormat, format, filter) {
    let read = createTarget(size, internalFormat, format, filter);
    let write = createTarget(size, internalFormat, format, filter);
    return {
      get read() { return read; },
      get write() { return write; },
      swap() {
        const t = read;
        read = write;
        write = t;
      }
    };
  }

  const velocity = createDoubleTarget(SIM_RES, gl.RG16F, gl.RG, filtering);
  const flow = createDoubleTarget(FLOW_RES, gl.R16F, gl.RED, filtering);
  const divergence = createTarget(SIM_RES, gl.R16F, gl.RED, gl.NEAREST);
  const curl = createTarget(SIM_RES, gl.R16F, gl.RED, gl.NEAREST);
  const pressure = createDoubleTarget(SIM_RES, gl.R16F, gl.RED, gl.NEAREST);
  const simTexel = 1 / SIM_RES;

  function releaseSim() {
    [
      velocity.read, velocity.write,
      flow.read, flow.write,
      pressure.read, pressure.write,
      divergence, curl
    ].forEach(t => {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.texture);
    });
    simPrograms.forEach(p => gl.deleteProgram(p));
    simShaders.forEach(s => gl.deleteShader(s));
  }

  function blit(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function bindSimTexture(texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return unit;
  }

  function applySplat(x, y, dx, dy, dye) {
    const aspect = output.clientWidth / Math.max(output.clientHeight, 1);
    const rUv = Math.max(config.radius, 40) / Math.max(output.clientHeight, 1);
    const radius = rUv * rUv * 0.28;

    gl.useProgram(splatProgram.program);
    gl.uniform1f(splatProgram.uniforms.uAspect, aspect);
    gl.uniform2f(splatProgram.uniforms.uPoint, x, y);
    gl.uniform1f(splatProgram.uniforms.uRadius, radius);
    gl.uniform1i(splatProgram.uniforms.uTarget, bindSimTexture(velocity.read.texture, 0));
    gl.uniform3f(splatProgram.uniforms.uColor, dx, dy, 0);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatProgram.uniforms.uTarget, bindSimTexture(flow.read.texture, 0));
    gl.uniform3f(splatProgram.uniforms.uColor, dye, 0, 0);
    blit(flow.write);
    flow.swap();
  }

  function stepSim(delta) {
    gl.disable(gl.BLEND);

    gl.useProgram(curlProgram.program);
    gl.uniform2f(curlProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(curlProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 0));
    blit(curl);

    gl.useProgram(vorticityProgram.program);
    gl.uniform2f(vorticityProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, bindSimTexture(curl.texture, 1));
    gl.uniform1f(vorticityProgram.uniforms.uCurlStrength, Math.max(config.swirl, 0));
    gl.uniform1f(vorticityProgram.uniforms.uDt, SIM_DT);
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(divergenceProgram.program);
    gl.uniform2f(divergenceProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 0));
    blit(divergence);

    gl.useProgram(clearProgram.program);
    gl.uniform1i(clearProgram.uniforms.uTexture, bindSimTexture(pressure.read.texture, 0));
    gl.uniform1f(clearProgram.uniforms.uValue, Math.pow(PRESSURE_DECAY, delta * 60));
    blit(pressure.write);
    pressure.swap();

    gl.useProgram(pressureProgram.program);
    gl.uniform2f(pressureProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, bindSimTexture(divergence.texture, 0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, bindSimTexture(pressure.read.texture, 1));
      blit(pressure.write);
      pressure.swap();
    }

    gl.useProgram(gradientProgram.program);
    gl.uniform2f(gradientProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(gradientProgram.uniforms.uPressure, bindSimTexture(pressure.read.texture, 0));
    gl.uniform1i(gradientProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 1));
    blit(velocity.write);
    velocity.swap();

    gl.useProgram(advectProgram.program);
    gl.uniform2f(advectProgram.uniforms.texelSize, simTexel, simTexel);
    gl.uniform1i(advectProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 0));
    gl.uniform1i(advectProgram.uniforms.uSource, bindSimTexture(velocity.read.texture, 0));
    gl.uniform1f(advectProgram.uniforms.uDt, SIM_DT);
    gl.uniform1f(advectProgram.uniforms.uDissipation, Math.pow(VELOCITY_DISSIPATION, delta * 60));
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(advectProgram.uniforms.uVelocity, bindSimTexture(velocity.read.texture, 0));
    gl.uniform1i(advectProgram.uniforms.uSource, bindSimTexture(flow.read.texture, 1));
    const flowDissipation = 0.9 + Math.min(Math.max(config.trail, 0), 1) * 0.08;
    gl.uniform1f(advectProgram.uniforms.uDissipation, Math.pow(flowDissipation, delta * 60));
    blit(flow.write);
    flow.swap();
  }

  function createPostProgram(fragSource) {
    const prog = gl.createProgram();
    gl.attachShader(prog, vertexShader);
    gl.attachShader(prog, compileSim(gl.FRAGMENT_SHADER, fragSource));
    gl.linkProgram(prog);
    simPrograms.push(prog);
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i);
      u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { program: prog, uniforms: u };
  }

  const brightProgram = createPostProgram(FRAG_BRIGHT);
  const blurProgram = createPostProgram(FRAG_BLUR);
  const compositeProgram = createPostProgram(FRAG_COMPOSITE);

  let sceneTarget = null;
  let bloomA = null;
  let bloomB = null;

  function createPostTarget(width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return { fbo, texture, width, height };
  }

  function releasePost() {
    [sceneTarget, bloomA, bloomB].forEach(t => {
      if (!t) return;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.texture);
    });
    sceneTarget = null;
    bloomA = null;
    bloomB = null;
  }

  function ensurePost() {
    const w = output.width;
    const h = output.height;
    if (sceneTarget && sceneTarget.width === w && sceneTarget.height === h) {
      return;
    }
    releasePost();
    sceneTarget = createPostTarget(w, h);
    const bw = Math.max(1, w >> 2);
    const bh = Math.max(1, h >> 2);
    bloomA = createPostTarget(bw, bh);
    bloomB = createPostTarget(bw, bh);
  }

  const contentTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([245, 247, 252, 255]));

  let bg = [0.96, 0.968, 0.988]; // #F5F7FC PRATYAKSHA surface theme

  function syncCanvasSize() {
    const dpr = getCanvasPixelRatio(output, gl);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
  }

  syncCanvasSize();

  let time = 0;
  let pointerOn = false;
  let pointerClientX = 0;
  let pointerClientY = 0;
  let prevFlowX = 0;
  let prevFlowY = 0;
  let hasPrevFlow = false;
  let simActiveUntil = 0;

  function gapColor() {
    if (config.gapColor !== 'auto') return config.gapColor;
    const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    const k = lum > 0.5 ? 0.72 : 0.35;
    return [bg[0] * k, bg[1] * k, bg[2] * k];
  }

  function render() {
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const seam = gapColor();
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, contentTexture);
    gl.uniform1i(uniforms.uContent, 0);
    gl.uniform2f(uniforms.uRes, output.width, output.height);
    gl.uniform1f(uniforms.uSize, Math.max(config.size, 8) * dpr);
    gl.uniform1f(uniforms.uGap, Math.max(config.gap, 0) * dpr);
    gl.uniform1f(uniforms.uBevel, Math.max(config.bevel, 0) * dpr);
    gl.uniform1f(uniforms.uTilt, (Math.min(Math.max(config.tilt, -30), 30) * Math.PI) / 180);
    gl.uniform1f(uniforms.uDist, 2.6 - Math.min(Math.max(config.perspective, 0), 1) * 2.2);
    gl.uniform1f(uniforms.uFloat, Math.max(config.float, 0));
    gl.uniform1f(uniforms.uShine, Math.max(config.shine, 0));
    gl.uniform1f(uniforms.uLift, Math.max(config.lift, 0));
    gl.uniform1f(uniforms.uIrid, Math.max(config.iridescence, 0));
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, flow.read.texture);
    gl.uniform1i(uniforms.uFlow, 1);
    gl.uniform2f(uniforms.uScroll, 0, 0);
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform1f(uniforms.uHasContent, 0.0);
    gl.uniform1f(uniforms.uMaxX, 1.0);
    gl.uniform3f(uniforms.uBg, bg[0], bg[1], bg[2]);
    gl.uniform3f(uniforms.uGapColor, seam[0], seam[1], seam[2]);

    const bloomOn = config.bloom > 0.001;
    const usePost = bloomOn || config.grain > 0.001;
    if (!usePost) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, output.width, output.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    ensurePost();
    blit(sceneTarget);

    if (bloomOn) {
      gl.useProgram(brightProgram.program);
      gl.uniform1i(brightProgram.uniforms.uScene, bindSimTexture(sceneTarget.texture, 0));
      blit(bloomA);

      gl.useProgram(blurProgram.program);
      gl.uniform1i(blurProgram.uniforms.uScene, bindSimTexture(bloomA.texture, 0));
      gl.uniform2f(blurProgram.uniforms.uDir, 1 / bloomA.width, 0);
      blit(bloomB);
      gl.uniform1i(blurProgram.uniforms.uScene, bindSimTexture(bloomB.texture, 0));
      gl.uniform2f(blurProgram.uniforms.uDir, 0, 1 / bloomA.height);
      blit(bloomA);
    }

    gl.useProgram(compositeProgram.program);
    gl.uniform1i(compositeProgram.uniforms.uScene, bindSimTexture(sceneTarget.texture, 0));
    gl.uniform1i(compositeProgram.uniforms.uBloomTex, bindSimTexture((bloomA ?? sceneTarget).texture, 1));
    gl.uniform1f(compositeProgram.uniforms.uBloomAmt, bloomOn ? Math.min(Math.max(config.bloom, 0), 1) * 1.4 : 0);
    gl.uniform1f(compositeProgram.uniforms.uGrainAmt, Math.min(Math.max(config.grain, 0), 1));
    gl.uniform1f(compositeProgram.uniforms.uTime, time);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, output.width, output.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  function frame(now) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min(Math.max((now - lastTime) / 1000, 0), 1 / 30);
    lastTime = now;
    time += delta * Math.max(config.speed, 0);

    if (pointerOn) {
      const rect = output.getBoundingClientRect();
      const fx = Math.min(Math.max((pointerClientX - rect.left) / (rect.width || 1), 0), 1);
      const fy = Math.min(Math.max((pointerClientY - rect.top) / (rect.height || 1), 0), 1);
      const w = Math.max(output.clientWidth, 1);
      const h = Math.max(output.clientHeight, 1);
      const dx = hasPrevFlow ? (fx - prevFlowX) * w : 0;
      const dy = hasPrevFlow ? (fy - prevFlowY) * h : 0;
      const push = 1.6 * Math.max(config.flow, 0.4);
      applySplat(fx, 1.0 - fy, dx * push, -dy * push, 10 * delta);
      prevFlowX = fx;
      prevFlowY = fy;
      hasPrevFlow = true;
      simActiveUntil = now + 4000;
    }

    if (now < simActiveUntil || pointerOn) stepSim(delta);

    render();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  start();

  function onPointerMove(event) {
    pointerClientX = event.clientX;
    pointerClientY = event.clientY;
    pointerOn = true;
    simActiveUntil = performance.now() + 4000;
    start();
  }

  function onPointerLeave() {
    pointerOn = false;
    hasPrevFlow = false;
    start();
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave, { passive: true });

  const observer = createCanvasResizeObserver(() => {
    syncCanvasSize();
    start();
  });
  observer.observe(output);

  const intersection = new IntersectionObserver(entries => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  return {
    setOptions(next) {
      Object.assign(config, next);
      start();
    },
    injectSplat(x, y, dx = 0, dy = 0, dye = 2.0) {
      applySplat(x, y, dx, dy, dye);
      simActiveUntil = performance.now() + 4000;
      start();
    },
    resize() {
      syncCanvasSize();
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      observer.disconnect();
      intersection.disconnect();
      gl.deleteTexture(contentTexture);
      releaseSim();
      releasePost();
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(quad);
    }
  };
}
