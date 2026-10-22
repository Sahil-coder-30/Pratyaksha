/**
 * PRATYAKSHA (प्रत्यक्ष) — 3D Interactive Particle Wave Terrain
 * High-Performance Three.js Bioluminescent Neural Mesh with Mouse Hover Flare
 *
 * Implements:
 * - 3D Undulating wave terrain of glowing cyber particles (GPU vertex shader)
 * - Real-time 3D mouse hover tracking (Raycaster plane intersection)
 * - Mouse hover dynamic uplift, ripple, and electric cyan illumination
 * - 3D Holographic cursor targeting reticle & glowing anamorphic lens flare
 * - Click shockwave expansion across the 3D particle grid
 * - Adaptive cognitive states (idle, thinking, responding, error)
 */

import * as THREE from './three.module.js';

export class ParticleWave3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   */
  constructor(canvas, options = {}) {
    if (!canvas) throw new Error('ParticleWave3D: canvas element required');

    this.canvas = canvas;
    this.options = {
      gridWidth: 140,
      gridDepth: 140,
      cols: 110,
      rows: 110,
      waveSpeed: 1.1,
      waveHeight: 6.5,
      hoverRadius: 36.0,
      hoverStrength: 1.35,
      ...options
    };

    this.destroyed = false;
    this.visible = true;
    this.time = 0;
    this.clock = new THREE.Clock();

    // Mouse Tracking State
    this.mouseNDC = new THREE.Vector2(-9999, -9999);
    this.mouseWorld = new THREE.Vector3(0, 0, 0);
    this.targetMouseWorld = new THREE.Vector3(0, 0, 0);
    this.mouseActive = false;
    this.targetMouseActive = 0;
    this.currentMouseActive = 0;

    // Shockwave click state
    this.clickRippleTime = -1.0;
    this.clickOrigin = new THREE.Vector3(0, 0, 0);

    // Agent Cognitive State: 0 = idle, 1 = thinking, 2 = responding, 3 = error
    this.currentStateNum = 0;

    this.init();
  }

  init() {
    const width = Math.max(this.canvas.clientWidth || window.innerWidth, 100);
    const height = Math.max(this.canvas.clientHeight || window.innerHeight, 100);

    // 1. Scene & Camera
    this.scene = new THREE.Scene();
    // Deep cosmic dark space fog
    this.scene.fog = new THREE.FogExp2(0x080e1c, 0.0075);

    this.camera = new THREE.PerspectiveCamera(54, width / height, 0.1, 400);
    // Camera looking down across perspective wave terrain
    this.camera.position.set(0, 48, 88);
    this.camera.lookAt(0, -4, -18);

    // 2. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x080e1c, 1.0);

    // 3. Raycaster & Invisible Intersection Plane
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // 4. Build 3D Particle Wave Field
    this.createParticleMesh();

    // 5. Build 3D Holographic Cursor Targeting Reticle & Flare
    this.createHoverReticle();

    // 6. Event Listeners
    this.bindEvents();

    // 7. Start Animation Loop
    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  createParticleMesh() {
    const { gridWidth, gridDepth, cols, rows } = this.options;
    const count = cols * rows;

    const positions = new Float32Array(count * 3);
    const initialPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const halfW = gridWidth / 2;
    const halfD = gridDepth / 2;
    const stepX = gridWidth / (cols - 1);
    const stepZ = gridDepth / (rows - 1);

    let idx = 0;
    const centerVec = new THREE.Vector2(0, 0);

    for (let i = 0; i < cols; i++) {
      const x = -halfW + i * stepX;
      for (let j = 0; j < rows; j++) {
        const z = -halfD + j * stepZ;
        const y = 0;

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = z;

        initialPositions[idx * 3] = x;
        initialPositions[idx * 3 + 1] = y;
        initialPositions[idx * 3 + 2] = z;

        // Distance from center for radial color gradient
        const distFromCenter = centerVec.distanceTo(new THREE.Vector2(x, z));
        const normDist = Math.min(distFromCenter / halfW, 1.0);

        // Core colors: Bioluminescent cyan/sky-blue in center to deep electric royal blue at edges
        const r = THREE.MathUtils.lerp(0.04, 0.12, normDist);
        const g = THREE.MathUtils.lerp(0.72, 0.38, normDist);
        const b = THREE.MathUtils.lerp(1.0, 0.95, normDist);

        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;

        idx++;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aInitialPosition', new THREE.BufferAttribute(initialPositions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    // Custom Shader Material for 60-120fps GPU Particle Wave
    const uniforms = {
      uTime: { value: 0.0 },
      uMouse: { value: new THREE.Vector3(0, 0, 0) },
      uMouseActive: { value: 0.0 },
      uHoverRadius: { value: this.options.hoverRadius },
      uHoverStrength: { value: this.options.hoverStrength },
      uWaveSpeed: { value: this.options.waveSpeed },
      uWaveHeight: { value: this.options.waveHeight },
      uClickRipple: { value: -1.0 },
      uClickOrigin: { value: new THREE.Vector3(0, 0, 0) },
      uState: { value: 0.0 },
      uPixelRatio: { value: this.dpr }
    };

    const vertexShader = `
      uniform float uTime;
      uniform vec3 uMouse;
      uniform float uMouseActive;
      uniform float uHoverRadius;
      uniform float uHoverStrength;
      uniform float uWaveSpeed;
      uniform float uWaveHeight;
      uniform float uClickRipple;
      uniform vec3 uClickOrigin;
      uniform float uState;
      uniform float uPixelRatio;

      attribute vec3 aInitialPosition;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vHover;
      varying float vAlpha;

      void main() {
        vec3 pos = aInitialPosition;
        float x = pos.x;
        float z = pos.z;
        float t = uTime * uWaveSpeed;

        // 1. Organic Undulating 3D Ocean Waves
        float wave = sin(x * 0.075 + t * 1.4) * 4.6
                   + cos(z * 0.065 + t * 1.15) * 4.0
                   + sin((x * 0.65 + z * 0.75) * 0.045 + t * 0.85) * 3.4
                   + cos(length(pos.xz) * 0.055 - t * 1.6) * 2.6;

        pos.y += wave * (uWaveHeight / 6.0);

        // 2. Interactive 3D Mouse Hover Uplift & Harmonic Ripples
        float distToMouse = length(pos.xz - uMouse.xz);
        float hoverFactor = clamp(1.0 - distToMouse / uHoverRadius, 0.0, 1.0);
        float smoothHover = smoothstep(0.0, 1.0, hoverFactor) * uMouseActive;

        // Elevation dome + localized ripples around the cursor
        float cursorRipple = sin(distToMouse * 0.32 - uTime * 4.2) * 0.5 + 0.5;
        pos.y += smoothHover * (13.5 + cursorRipple * 5.5) * uHoverStrength;

        // 3. Click Shockwave Propagation
        if (uClickRipple > 0.0 && uClickRipple < 2.2) {
          float ripDist = length(pos.xz - uClickOrigin.xz);
          float waveFront = uClickRipple * 75.0;
          float diff = abs(ripDist - waveFront);
          if (diff < 16.0) {
            float ripAmp = (1.0 - diff / 16.0) * max(0.0, 1.0 - uClickRipple / 2.2);
            pos.y += sin(diff * 0.38) * ripAmp * 13.0;
          }
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        // 4. Perspective Point Size
        float size = (30.0 * uPixelRatio) / -mvPosition.z;
        // Enlarge particles around the mouse hover
        size *= (1.0 + smoothHover * 1.45);
        gl_PointSize = clamp(size, 2.0, 36.0 * uPixelRatio);

        // 5. Dynamic Bioluminescent Color Interpolation
        vec3 col = aColor;

        // Cognitive State Color Modification
        if (uState > 2.5) {
          // Warning/Error State: Crimson & Ember glow
          col = mix(col, vec3(1.0, 0.28, 0.28), 0.75);
        } else if (uState > 1.5) {
          // Responding State: Cyan-Aqua Stream
          col = mix(col, vec3(0.1, 0.95, 0.8), 0.55);
        } else if (uState > 0.5) {
          // Thinking State: Hyper-Electric Violet & Cyan
          col = mix(col, vec3(0.45, 0.65, 1.0), 0.65);
        }

        // Intense Electric Cyan & White Highlight on Hover
        vec3 neonCyan = vec3(0.0, 0.95, 1.0);
        vec3 whitePeak = vec3(0.85, 0.98, 1.0);
        col = mix(col, neonCyan, smoothHover * 0.88);
        col = mix(col, whitePeak, pow(smoothHover, 2.6) * 0.92);

        vColor = col;
        vHover = smoothHover;

        // Distance fog fade-out
        float depth = -mvPosition.z;
        vAlpha = smoothstep(190.0, 32.0, depth) * (0.55 + smoothHover * 0.45);
      }
    `;

    const fragmentShader = `
      varying vec3 vColor;
      varying float vHover;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        if (d > 0.5) discard;

        // Glowing core with smooth radiant falloff
        float core = smoothstep(0.18, 0.0, d);
        float halo = 1.0 - smoothstep(0.0, 0.5, d);

        vec3 finalColor = vColor + core * 0.42;
        float alpha = (halo * 0.75 + core * 0.25) * vAlpha;

        gl_FragColor = vec4(finalColor, alpha);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.particleMesh = new THREE.Points(geometry, material);
    this.scene.add(this.particleMesh);
    this.particleMaterial = material;
  }

  createHoverReticle() {
    // Holographic targeting group following the 3D mouse on the wave surface
    this.reticleGroup = new THREE.Group();
    this.reticleGroup.visible = false;
    this.reticleGroup.position.set(0, 0, 0);

    // 1. Procedural Concentric Targeting Ring Texture
    const reticleCanvas = document.createElement('canvas');
    reticleCanvas.width = 256;
    reticleCanvas.height = 256;
    const ctx = reticleCanvas.getContext('2d');
    if (ctx) {
      const cx = 128;
      const cy = 128;

      // Outer dashed ring
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, 100, 0, Math.PI * 2);
      ctx.stroke();

      // Middle thin solid ring
      ctx.strokeStyle = 'rgba(79, 172, 254, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, 74, 0, Math.PI * 2);
      ctx.stroke();

      // Inner reticle ticks (crosshair notches)
      ctx.strokeStyle = 'rgba(0, 245, 255, 0.85)';
      ctx.lineWidth = 2.5;
      const ticks = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      ticks.forEach(ang => {
        const x1 = cx + Math.cos(ang) * 58;
        const y1 = cy + Math.sin(ang) * 58;
        const x2 = cx + Math.cos(ang) * 82;
        const y2 = cy + Math.sin(ang) * 82;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Central ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 32, 0, Math.PI * 2);
      ctx.stroke();
    }

    const reticleTex = new THREE.CanvasTexture(reticleCanvas);
    const reticleMat = new THREE.SpriteMaterial({
      map: reticleTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
      depthWrite: false
    });
    this.reticleSprite = new THREE.Sprite(reticleMat);
    this.reticleSprite.scale.set(24, 24, 1);
    this.reticleGroup.add(this.reticleSprite);

    // 2. Glowing Center Flare Star Sprite
    const flareCanvas = document.createElement('canvas');
    flareCanvas.width = 256;
    flareCanvas.height = 256;
    const fCtx = flareCanvas.getContext('2d');
    if (fCtx) {
      const cx = 128;
      const cy = 128;

      // Radial bright core
      const grad = fCtx.createRadialGradient(cx, cy, 0, cx, cy, 110);
      grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
      grad.addColorStop(0.12, 'rgba(131, 232, 255, 0.95)');
      grad.addColorStop(0.35, 'rgba(49, 94, 247, 0.65)');
      grad.addColorStop(0.65, 'rgba(0, 163, 255, 0.25)');
      grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');

      fCtx.fillStyle = grad;
      fCtx.beginPath();
      fCtx.arc(cx, cy, 120, 0, Math.PI * 2);
      fCtx.fill();

      // Horizontal Anamorphic Streak
      const beamGrad = fCtx.createLinearGradient(0, cy, 256, cy);
      beamGrad.addColorStop(0.0, 'rgba(0, 229, 255, 0)');
      beamGrad.addColorStop(0.35, 'rgba(131, 232, 255, 0.5)');
      beamGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
      beamGrad.addColorStop(0.65, 'rgba(131, 232, 255, 0.5)');
      beamGrad.addColorStop(1.0, 'rgba(0, 229, 255, 0)');

      fCtx.fillStyle = beamGrad;
      fCtx.fillRect(0, cy - 3, 256, 6);
    }

    const flareTex = new THREE.CanvasTexture(flareCanvas);
    const flareMat = new THREE.SpriteMaterial({
      map: flareTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      depthWrite: false
    });
    this.flareSprite = new THREE.Sprite(flareMat);
    this.flareSprite.scale.set(16, 16, 1);
    this.reticleGroup.add(this.flareSprite);

    this.scene.add(this.reticleGroup);
  }

  bindEvents() {
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onResize = this.onResize.bind(this);

    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    window.addEventListener('click', this.onClick, { passive: true });

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.canvas);
    if (this.canvas.parentElement) {
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries[entries.length - 1]?.isIntersecting ?? true;
      if (this.visible && !this.rafId && !this.destroyed) {
        this.clock.start();
        this.rafId = requestAnimationFrame(this.animate);
      }
    });
    this.intersectionObserver.observe(this.canvas);
  }

  onPointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Check if pointer is anywhere near window
    this.mouseActive = true;
    this.targetMouseActive = 1.0;

    // Convert screen coordinates to NDC [-1, 1]
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.mouseNDC.set(x, y);

    // Raycast onto 3D wave plane (y = 0)
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const intersectionPoint = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, intersectionPoint);

    if (hit) {
      // Clamp to bounds of the wave mesh
      const maxW = this.options.gridWidth * 0.48;
      const maxD = this.options.gridDepth * 0.48;
      intersectionPoint.x = THREE.MathUtils.clamp(intersectionPoint.x, -maxW, maxW);
      intersectionPoint.z = THREE.MathUtils.clamp(intersectionPoint.z, -maxD, maxD);
      this.targetMouseWorld.copy(intersectionPoint);
    }
  }

  onPointerLeave() {
    this.mouseActive = false;
    this.targetMouseActive = 0.0;
  }

  onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (
      e.clientX >= rect.left - 40 &&
      e.clientX <= rect.right + 40 &&
      e.clientY >= rect.top - 40 &&
      e.clientY <= rect.bottom + 40
    ) {
      this.triggerShockwave(this.mouseWorld.x, this.mouseWorld.z);
    }
  }

  /**
   * Inject a 3D ripple shockwave expanding from (x, z)
   */
  triggerShockwave(worldX = 0, worldZ = 0) {
    this.clickRippleTime = 0.001;
    this.clickOrigin.set(worldX, 0, worldZ);
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uClickOrigin.value.copy(this.clickOrigin);
      this.particleMaterial.uniforms.uClickRipple.value = 0.001;
    }
  }

  onResize() {
    if (this.destroyed) return;
    const width = Math.max(this.canvas.clientWidth || window.innerWidth, 100);
    const height = Math.max(this.canvas.clientHeight || window.innerHeight, 100);

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);

    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uPixelRatio.value = this.dpr;
    }
  }

  /**
   * Sync with AI agent state
   * @param {'idle' | 'thinking' | 'responding' | 'error'} state
   */
  setState(state) {
    if (this.destroyed || !this.particleMaterial) return;

    if (state === 'thinking') {
      this.currentStateNum = 1.0;
      this.particleMaterial.uniforms.uWaveSpeed.value = 2.2;
      this.particleMaterial.uniforms.uWaveHeight.value = 9.0;
      this.triggerShockwave(0, 0);
    } else if (state === 'responding') {
      this.currentStateNum = 2.0;
      this.particleMaterial.uniforms.uWaveSpeed.value = 1.5;
      this.particleMaterial.uniforms.uWaveHeight.value = 7.0;
    } else if (state === 'error') {
      this.currentStateNum = 3.0;
      this.particleMaterial.uniforms.uWaveSpeed.value = 0.6;
      this.particleMaterial.uniforms.uWaveHeight.value = 5.0;
      this.triggerShockwave(0, 0);
    } else {
      // Default / Idle
      this.currentStateNum = 0.0;
      this.particleMaterial.uniforms.uWaveSpeed.value = this.options.waveSpeed;
      this.particleMaterial.uniforms.uWaveHeight.value = this.options.waveHeight;
    }

    this.particleMaterial.uniforms.uState.value = this.currentStateNum;
  }

  animate() {
    if (this.destroyed) return;
    if (!this.visible) {
      this.rafId = null;
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.06);
    this.time += delta;

    // 1. Smoothly interpolate mouse position (Spring / Lerp dampening)
    this.mouseWorld.lerp(this.targetMouseWorld, 0.12);
    this.currentMouseActive = THREE.MathUtils.lerp(this.currentMouseActive, this.targetMouseActive, 0.1);

    // 2. Update Shader Uniforms
    if (this.particleMaterial) {
      this.particleMaterial.uniforms.uTime.value = this.time;
      this.particleMaterial.uniforms.uMouse.value.copy(this.mouseWorld);
      this.particleMaterial.uniforms.uMouseActive.value = this.currentMouseActive;

      // Advance click shockwave
      if (this.clickRippleTime >= 0.0) {
        this.clickRippleTime += delta * 1.15;
        this.particleMaterial.uniforms.uClickRipple.value = this.clickRippleTime;
        if (this.clickRippleTime > 2.2) {
          this.clickRippleTime = -1.0;
          this.particleMaterial.uniforms.uClickRipple.value = -1.0;
        }
      }
    }

    // 3. Update 3D Holographic Reticle & Flare
    if (this.reticleGroup) {
      if (this.currentMouseActive > 0.02) {
        this.reticleGroup.visible = true;

        // Calculate surface elevation at mouse position
        const mx = this.mouseWorld.x;
        const mz = this.mouseWorld.z;
        const t = this.time * (this.particleMaterial?.uniforms.uWaveSpeed.value || 1.1);
        const surfaceY = Math.sin(mx * 0.075 + t * 1.4) * 4.6
                       + Math.cos(mz * 0.065 + t * 1.15) * 4.0
                       + Math.sin((mx * 0.65 + mz * 0.75) * 0.045 + t * 0.85) * 3.4
                       + 10.0 * this.currentMouseActive;

        this.reticleGroup.position.set(this.mouseWorld.x, surfaceY + 2.5, this.mouseWorld.z);

        // Smooth rotation
        if (this.reticleSprite) {
          this.reticleSprite.material.rotation += delta * 0.65;
          this.reticleSprite.material.opacity = this.currentMouseActive * 0.85;
          const pulse = 1.0 + Math.sin(this.time * 3.5) * 0.08;
          this.reticleSprite.scale.set(24 * pulse, 24 * pulse, 1);
        }

        if (this.flareSprite) {
          this.flareSprite.material.opacity = this.currentMouseActive * (0.8 + Math.sin(this.time * 6.0) * 0.15);
          const fPulse = 1.0 + Math.cos(this.time * 4.5) * 0.12;
          this.flareSprite.scale.set(16 * fPulse, 16 * fPulse, 1);
        }
      } else {
        this.reticleGroup.visible = false;
      }
    }

    // 4. Subtle Ambient Camera Drift
    const camAngle = this.time * 0.12;
    this.camera.position.x = Math.sin(camAngle) * 5.0;
    this.camera.lookAt(0, -4, -18);

    // 5. Render Scene
    this.renderer.render(this.scene, this.camera);

    this.rafId = requestAnimationFrame(this.animate);
  }

  destroy() {
    this.destroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('click', this.onClick);

    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.intersectionObserver) this.intersectionObserver.disconnect();

    if (this.particleMesh) {
      this.scene.remove(this.particleMesh);
      this.particleMesh.geometry.dispose();
      this.particleMesh.material.dispose();
    }

    if (this.reticleGroup) {
      this.scene.remove(this.reticleGroup);
      this.reticleSprite?.material.map?.dispose();
      this.reticleSprite?.material.dispose();
      this.flareSprite?.material.map?.dispose();
      this.flareSprite?.material.dispose();
    }

    this.renderer?.dispose();
  }
}
