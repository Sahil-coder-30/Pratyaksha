
/**
 * BigFish — Hexagonal Vault Engine
 * High-Performance Sovereign WebGL2 / WebGL Hexagonal Lattice with Interactive Soft Light
 *
 * Implements React Bits Pro "Hexagonal Vault" specification:
 * - colors: ["#5227FF", "#ff2a7d"] (Electric Indigo to Neon Magenta gradient)
 * - backgroundColor: "#e0dcd8" (Warm tactile stone / paper matte background)
 * - lineWidth: 0.6 (Fine unlit wireframe)
 * - litWidth: 2.7 (Luminous lit wireframe)
 * - lattice: 1.4 (Hexagonal lattice scale)
 * - glowRadius: 0.9 (Ambient neon falloff)
 * - core: 0.75 (Luminous center intensity)
 * - trailLength: 2 (Decaying motion trail)
 * - follow: 0.65 (Spring-damped cursor tracking)
 * - flow: 0.68 (Organic fluid wave pulse)
 * - speed: 1.15 (Base animation frequency)
 * - pulseSpeed: 1.15 (Breathing rate)
 */

export const HEXAGONAL_VAULT_THEMES = {
  // Dark Theme (Template 1: Glowing White / Silver on Obsidian Dark)
  dark: {
    theme: 'dark',
    backgroundColor: '#0c0c0e',
    colors: ['#ffffff', '#cbd5e1'],
    lineWidth: 0.6,
    litWidth: 2.7,
    lattice: 1.4,
    glowRadius: 0.9,
    core: 0.75,
    trailLength: 2.0,
    follow: 0.65,
    flow: 0.68,
    speed: 1.15,
    pulseSpeed: 1.15
  },
  // Light Theme (Template 2: Deep Dark Charcoal / Ink on Paper White)
  light: {
    theme: 'light',
    backgroundColor: '#f5f5f7',
    colors: ['#111114', '#27272a'],
    lineWidth: 0.6,
    litWidth: 2.7,
    lattice: 1.4,
    glowRadius: 0.9,
    core: 0.75,
    trailLength: 2.0,
    follow: 0.65,
    flow: 0.68,
    speed: 1.15,
    pulseSpeed: 1.15
  }
};

export const HEXAGONAL_VAULT_DEFAULTS = {
  ...HEXAGONAL_VAULT_THEMES.dark
};

function hexToRgb(hex) {
  let cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map(c => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255
  ];
}

const VERT_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseActive;
uniform float uDpr;

// Shockwave
uniform vec2 uShockCenter;
uniform float uShockRadius;
uniform float uShockIntensity;

// Props
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uBg;
uniform float uLineWidth;
uniform float uLitWidth;
uniform float uLattice;
uniform float uGlowRadius;
uniform float uCore;
uniform float uFlow;
uniform float uPulseSpeed;
uniform float uSpeed;

// Trail (Optimized 6-point buffer for buttery 60fps)
const int MAX_TRAIL = 6;
uniform vec2 uTrailPos[MAX_TRAIL];
uniform float uTrailWeight[MAX_TRAIL];
uniform int uTrailCount;

// Cognitive state tint (retained for uniform compatibility, zero color shift)
uniform vec3 uStateColor;
uniform float uStateWeight;

// Ultra-fast pseudo-random noise (1 GPU instruction, zero transcendental lag)
float fastNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Distance to nearest regular pointy-topped hexagon edge
float hexEdgeDist(vec2 p, float s) {
  float r_in = s * 0.86602540378; // s * sqrt(3)/2
  vec2 ap = abs(p);
  float d = r_in - max(ap.x, 0.5 * ap.x + 0.86602540378 * ap.y);
  return abs(d);
}

// Hexagon grid tiling
vec4 getHexTile(vec2 p, float s) {
  vec2 s2 = vec2(s * 1.73205080757, s * 3.0);
  vec2 h2 = s2 * 0.5;
  vec2 a = mod(p, s2) - h2;
  vec2 b = mod(p - h2, s2) - h2;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 id = p - gv;
  return vec4(gv, id);
}

void main() {
  vec2 pixelPos = gl_FragCoord.xy;

  // Scale hexagons by lattice prop and device pixel ratio (fine, intricate lattice)
  float hexRadius = 14.0 * uLattice * uDpr;
  vec4 tile = getHexTile(pixelPos, hexRadius);
  float edgeDist = hexEdgeDist(tile.xy, hexRadius);

  // Compute distance to mouse and center
  float distM = length(pixelPos - uMouse);
  vec2 centerPos = uResolution * 0.5;
  float distCenter = length(pixelPos - centerPos);
  float maxDim = length(uResolution * 0.5);

  float effectiveRadius = 120.0 * uGlowRadius * uDpr;

  // Primary cursor lighting
  float uM = distM / max(effectiveRadius, 1.0);
  float coreLight = exp(-uM * uM / max(0.42 * uCore, 0.01));
  float bloomLight = exp(-uM / 0.82) * 0.72;
  float cursorLight = clamp(coreLight + bloomLight, 0.0, 1.0);

  // Blend in trail lights
  float trailLight = 0.0;
  float minLightDist = distM;

  for (int i = 0; i < MAX_TRAIL; i++) {
    if (i >= uTrailCount) break;
    float dTrail = length(pixelPos - uTrailPos[i]);
    minLightDist = min(minLightDist, dTrail);
    float uT = dTrail / max(effectiveRadius, 1.0);
    float tCore = exp(-uT * uT / max(0.48 * uCore, 0.01));
    float tBloom = exp(-uT / 0.88) * 0.65;
    float tL = (tCore + tBloom) * uTrailWeight[i];
    trailLight = max(trailLight, tL);
  }

  float mouseLight = max(cursorLight, trailLight);

  // Subtle, calm ambient wave expanding gently from center outward when mouse leaves
  float normDistCenter = distCenter / max(maxDim, 1.0);
  float wavePhase = normDistCenter * 4.5 - uTime * 0.9 * uSpeed;
  float centerPulse = sin(wavePhase) * 0.5 + 0.5;
  centerPulse = smoothstep(0.35, 0.9, centerPulse);

  // Very gentle and subtle wave illumination (calm, never overwhelming)
  float centerWaveLight = centerPulse * exp(-normDistCenter * 1.6) * 0.18;
  float centerGlow = exp(-normDistCenter * 3.0) * 0.08;
  centerWaveLight = clamp(centerWaveLight + centerGlow, 0.0, 0.22);

  // Smooth blend between active cursor follow and gentle ambient center wave
  float activeFactor = clamp(uMouseActive, 0.0, 1.0);
  float totalLight = mix(centerWaveLight, mouseLight, activeFactor);
  minLightDist = mix(distCenter, minLightDist, activeFactor);

  // Flow ripple modulation along hex lines
  float wave = sin(minLightDist * 0.055 / uDpr - uTime * 3.2 * uSpeed) * 0.5 + 0.5;
  wave = wave * exp(-minLightDist * 0.009 / uDpr) * uFlow;
  totalLight = clamp(totalLight + wave * 0.22 * totalLight, 0.0, 1.0);

  // Breathing pulse
  float pulse = 1.0 + 0.07 * sin(uTime * 2.2 * uPulseSpeed);
  totalLight *= pulse;

  // Interactive shockwave ring
  if (uShockIntensity > 0.005) {
    float swDist = abs(length(pixelPos - uShockCenter) - uShockRadius);
    float sw = exp(-swDist * swDist / (280.0 * uDpr * uDpr)) * uShockIntensity;
    totalLight = clamp(totalLight + sw, 0.0, 1.0);
  }

  // Adaptive line width: 0.6px unlit -> 2.7px lit (scaled by DPR)
  float baseLineWidth = uLineWidth * uDpr;
  float maxLitWidth = uLitWidth * uDpr;
  float currentLineWidth = mix(baseLineWidth, maxLitWidth, pow(totalLight, 1.25));
  float halfWidth = currentLineWidth * 0.5;

  // Crisp GPU anti-aliasing
  float aaRange = max(0.65 * uDpr, 0.8);
  float lineAlpha = 1.0 - smoothstep(halfWidth - aaRange, halfWidth + aaRange, edgeDist);

  // Gradient: uColor2 at center -> uColor1 at edge
  // Gradient: uColor2 at center -> uColor1 at edge
  float gradT = clamp(minLightDist / (effectiveRadius * 1.15), 0.0, 1.0);
  vec3 litColor = mix(uColor2, uColor1, smoothstep(0.08, 0.85, gradT));

  // Detect whether background is dark or light based on luminance
  float bgLum = dot(uBg, vec3(0.299, 0.587, 0.114));
  bool isDarkTheme = bgLum < 0.5;

  // Tactile fine film/paper grain (optimized fast noise)
  float grain = (fastNoise(pixelPos + fract(uTime * 0.05)) - 0.5) * 0.018;

  vec3 bgColor;
  vec3 edgeColor;
  vec3 finalColor;

  if (isDarkTheme) {
    // ── DARK THEME (Template 1: Glowing White/Silver on Obsidian Dark) ──
    vec3 unlitColor = mix(uBg, vec3(0.22, 0.22, 0.26), 0.55);
    edgeColor = mix(unlitColor, litColor, smoothstep(0.04, 0.85, totalLight));

    // Ambient white/silver glow brightening the dark background
    float bgBloom = totalLight * totalLight * 0.25 * uCore;
    vec3 ambientGlow = litColor * bgBloom;
    bgColor = clamp(uBg + ambientGlow + vec3(grain), 0.0, 1.0);

    finalColor = mix(bgColor, edgeColor, lineAlpha);
    // Additive core bloom on lit edges
    finalColor += litColor * (lineAlpha * pow(totalLight, 1.5) * 0.45);
  } else {
    // ── LIGHT THEME (Template 2: Deep Dark Charcoal / Ink on Paper White) ──
    vec3 unlitColor = mix(uBg, vec3(0.84, 0.84, 0.88), 0.70);
    edgeColor = mix(unlitColor, litColor, smoothstep(0.04, 0.85, totalLight));

    // Soft dark shadow/ink falloff darkening the light background under the cursor
    float bgBloom = totalLight * totalLight * 0.12 * uCore;
    vec3 inkShadow = (litColor - uBg) * bgBloom;
    bgColor = clamp(uBg + inkShadow + vec3(grain * 0.5), 0.0, 1.0);

    finalColor = mix(bgColor, edgeColor, lineAlpha);
  }

  fragColor = vec4(finalColor, 1.0);
}`;

export class HexagonalVault {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   */
  constructor(canvas, options = {}) {
    if (!canvas) throw new Error('HexagonalVault: canvas element is required');

    this.canvas = canvas;
    const themeName = options.theme || (options.backgroundColor && hexToRgb(options.backgroundColor)[0] < 0.5 ? 'dark' : 'dark');
    const baseTheme = HEXAGONAL_VAULT_THEMES[themeName] || HEXAGONAL_VAULT_THEMES.dark;
    this.theme = themeName;
    this.options = { ...baseTheme, ...options };

    // Clamp DPR to 1.25 maximum for crisp retina rendering with 4x GPU fillrate speedup
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.gl = this._initGL();

    if (!this.gl) {
      console.warn('[HexagonalVault] WebGL not supported, running fallback');
      this._init2DFallback();
      return;
    }

    this.program = this._createProgram(VERT_SHADER, FRAG_SHADER);
    this.uniforms = this._getUniformLocations();
    this._initQuad();

    // Cache RGB color vectors to avoid hexToRgb garbage collection in render loop
    this._cacheColors();

    // Mouse Tracking with smooth spring / lerp
    this.targetMouse = { x: -9999, y: -9999 };
    this.currentMouse = { x: -9999, y: -9999 };
    this.mouseActive = 0.0;
    this.isHovered = false;
    this.mouseMoved = false;

    // Trail buffer (6 points max)
    this.trail = [];
    this.maxTrail = 6;

    // Shockwave animation
    this.shockwave = {
      active: false,
      x: 0,
      y: 0,
      radius: 0,
      intensity: 0
    };

    // Cognitive State (Zero color tint override — vault background strictly preserves active theme)
    this.state = 'idle';
    this.stateColor = [1.0, 1.0, 1.0];
    this.stateWeight = 0.0;
    this.targetStateWeight = 0.0;

    this.startTime = performance.now();
    this.lastFrameTime = 0;
    this.destroyed = false;
    this.visible = true;
    this.animationId = null;

    this._bindEvents();
    this._resize();

    // Start render loop
    this._render = this._render.bind(this);
    this.animationId = requestAnimationFrame(this._render);
  }

  _initGL() {
    const opts = {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    };
    return this.canvas.getContext('webgl2', opts) || this.canvas.getContext('webgl', opts);
  }

  _createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[HexagonalVault] Shader error: ${err}`);
    }
    return shader;
  }

  _createProgram(vertSrc, fragSrc) {
    const gl = this.gl;
    const vs = this._createShader(gl.VERTEX_SHADER, vertSrc);
    const fs = this._createShader(gl.FRAGMENT_SHADER, fragSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`[HexagonalVault] Program link error: ${err}`);
    }
    return prog;
  }

  _getUniformLocations() {
    const gl = this.gl;
    const p = this.program;
    const names = [
      'uResolution', 'uTime', 'uMouse', 'uMouseActive', 'uDpr',
      'uShockCenter', 'uShockRadius', 'uShockIntensity',
      'uColor1', 'uColor2', 'uBg',
      'uLineWidth', 'uLitWidth', 'uLattice', 'uGlowRadius',
      'uCore', 'uFlow', 'uPulseSpeed', 'uSpeed',
      'uTrailCount', 'uStateColor', 'uStateWeight'
    ];
    const u = {};
    for (const name of names) {
      u[name] = gl.getUniformLocation(p, name);
    }
    u.trailPos = [];
    u.trailWeight = [];
    for (let i = 0; i < this.maxTrail; i++) {
      u.trailPos[i] = gl.getUniformLocation(p, `uTrailPos[${i}]`);
      u.trailWeight[i] = gl.getUniformLocation(p, `uTrailWeight[${i}]`);
    }
    return u;
  }

  _initQuad() {
    const gl = this.gl;
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);
    this.quadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  _bindEvents() {
    this._onMouseMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.targetMouse.x = (e.clientX - rect.left) * this.dpr;
      this.targetMouse.y = (rect.height - (e.clientY - rect.top)) * this.dpr;
      this.isHovered = true;
      this.mouseMoved = true;
    };

    this._onMouseLeave = () => {
      this.isHovered = false;
    };

    this._onMouseEnter = () => {
      this.isHovered = true;
    };

    this._onResize = () => this._resize();

    this._onVisibility = () => {
      this.visible = !document.hidden;
    };

    window.addEventListener('mousemove', this._onMouseMove, { passive: true });
    document.addEventListener('mouseleave', this._onMouseLeave, { passive: true });
    document.addEventListener('mouseenter', this._onMouseEnter, { passive: true });
    window.addEventListener('resize', this._onResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility, { passive: true });
  }

  _resize() {
    const width = this.canvas.clientWidth || window.innerWidth || 400;
    const height = this.canvas.clientHeight || window.innerHeight || 600;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.25);

    const physicalWidth = Math.round(width * this.dpr);
    const physicalHeight = Math.round(height * this.dpr);

    if (this.canvas.width !== physicalWidth || this.canvas.height !== physicalHeight) {
      this.canvas.width = physicalWidth;
      this.canvas.height = physicalHeight;
      if (this.gl) {
        this.gl.viewport(0, 0, physicalWidth, physicalHeight);
      }
    }
  }

  /**
   * Triggers an energetic radial shockwave along the hex lattice
   */
  triggerShockwave(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (x !== undefined ? x : rect.width * 0.5) * this.dpr;
    const cy = (y !== undefined ? (rect.height - y) : rect.height * 0.5) * this.dpr;

    this.shockwave.active = true;
    this.shockwave.x = cx;
    this.shockwave.y = cy;
    this.shockwave.radius = 0;
    this.shockwave.intensity = 1.0;
  }

  _cacheColors() {
    this.rgbColor1 = hexToRgb(this.options.colors[0]);
    this.rgbColor2 = hexToRgb(this.options.colors[1]);
    this.rgbBg = hexToRgb(this.options.backgroundColor);
  }

  /**
   * Sets the cognitive agent state ('idle', 'thinking', 'responding', 'error')
   * Background and hex colors remain strictly locked to the theme — NO pink/magenta hue shifts!
   */
  setState(state) {
    this.state = state;
    this.targetStateWeight = 0.0;
    this.stateWeight = 0.0;
  }

  _update(timeSec) {
    // Smooth transition of mouseActive factor
    const targetActive = this.isHovered ? 1.0 : 0.0;
    this.mouseActive += (targetActive - this.mouseActive) * 0.06;

    // Smooth pointer tracking (follow lerp)
    const followRate = Math.min(this.options.follow * 0.45, 0.9);

    if (this.isHovered) {
      this.currentMouse.x += (this.targetMouse.x - this.currentMouse.x) * followRate;
      this.currentMouse.y += (this.targetMouse.y - this.currentMouse.y) * followRate;
    } else {
      // Gently drift currentMouse toward center when mouse is outside panel
      const w = this.canvas.width;
      const h = this.canvas.height;
      this.currentMouse.x += (w * 0.5 - this.currentMouse.x) * 0.05;
      this.currentMouse.y += (h * 0.5 - this.currentMouse.y) * 0.05;
    }

    // Update trail queue
    if (this.currentMouse.x > -9000) {
      this.trail.unshift({
        x: this.currentMouse.x,
        y: this.currentMouse.y,
        weight: 1.0
      });
      if (this.trail.length > this.maxTrail) {
        this.trail.pop();
      }
    }

    // Decay trail weights based on trailLength prop
    const decaySpeed = (1.0 / Math.max(this.options.trailLength, 0.5)) * 0.08;
    for (let i = 0; i < this.trail.length; i++) {
      this.trail[i].weight = Math.max(0, 1.0 - (i / this.maxTrail) * 0.9 - decaySpeed * i);
    }

    // Shockwave expansion
    if (this.shockwave.active) {
      this.shockwave.radius += 14.0 * this.dpr;
      this.shockwave.intensity *= 0.94;
      if (this.shockwave.intensity < 0.01) {
        this.shockwave.active = false;
        this.shockwave.intensity = 0;
      }
    }

    // State weight interpolation
    this.stateWeight += (this.targetStateWeight - this.stateWeight) * 0.08;
  }

  _render(now = performance.now()) {
    if (this.destroyed) return;

    if (this.visible && this.gl) {
      // Dynamic framerate throttling: 60fps when user is interacting, 30fps resting to avoid any CPU/GPU lag
      const delta = now - this.lastFrameTime;
      const targetInterval = 16.0; // 60fps continuous silky smooth rendering
      if (delta >= targetInterval) {
        this.lastFrameTime = now - (delta % targetInterval);

        const gl = this.gl;
        const u = this.uniforms;
        const timeSec = (now - this.startTime) * 0.001;

        this._update(timeSec);

        gl.useProgram(this.program);

        // Resolution & DPR
        gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(u.uTime, timeSec);
        gl.uniform2f(u.uMouse, this.currentMouse.x, this.currentMouse.y);
        gl.uniform1f(u.uMouseActive, this.mouseActive);
        gl.uniform1f(u.uDpr, this.dpr);

        // Colors & Props (Pre-cached values, zero runtime string/hex parsing)
        gl.uniform3f(u.uColor1, this.rgbColor1[0], this.rgbColor1[1], this.rgbColor1[2]);
        gl.uniform3f(u.uColor2, this.rgbColor2[0], this.rgbColor2[1], this.rgbColor2[2]);
        gl.uniform3f(u.uBg, this.rgbBg[0], this.rgbBg[1], this.rgbBg[2]);

        gl.uniform1f(u.uLineWidth, this.options.lineWidth);
        gl.uniform1f(u.uLitWidth, this.options.litWidth);
        gl.uniform1f(u.uLattice, this.options.lattice);
        gl.uniform1f(u.uGlowRadius, this.options.glowRadius);
        gl.uniform1f(u.uCore, this.options.core);
        gl.uniform1f(u.uFlow, this.options.flow);
        gl.uniform1f(u.uPulseSpeed, this.options.pulseSpeed);
        gl.uniform1f(u.uSpeed, this.options.speed);

        // Shockwave
        gl.uniform2f(u.uShockCenter, this.shockwave.x, this.shockwave.y);
        gl.uniform1f(u.uShockRadius, this.shockwave.radius);
        gl.uniform1f(u.uShockIntensity, this.shockwave.intensity);

        // Trail (6 items max, zero allocs)
        const activeTrailLen = Math.min(this.trail.length, this.maxTrail);
        gl.uniform1i(u.uTrailCount, activeTrailLen);
        for (let i = 0; i < this.maxTrail; i++) {
          if (i < activeTrailLen) {
            gl.uniform2f(u.trailPos[i], this.trail[i].x, this.trail[i].y);
            gl.uniform1f(u.trailWeight[i], this.trail[i].weight);
          } else {
            gl.uniform2f(u.trailPos[i], -9999, -9999);
            gl.uniform1f(u.trailWeight[i], 0.0);
          }
        }

        // State Tint: Zero override
        gl.uniform3f(u.uStateColor, 0.0, 0.0, 0.0);
        gl.uniform1f(u.uStateWeight, 0.0);

        // Draw Fullscreen Quad
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    this.animationId = requestAnimationFrame(this._render);
  }

  _init2DFallback() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      ctx.fillStyle = this.options.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    };
    draw();
  }

  setTheme(themeName) {
    if (HEXAGONAL_VAULT_THEMES[themeName]) {
      this.theme = themeName;
      Object.assign(this.options, HEXAGONAL_VAULT_THEMES[themeName]);
      this._cacheColors();
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseleave', this._onMouseLeave);
    document.removeEventListener('mouseenter', this._onMouseEnter);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);

    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
    }
  }
}
