/**
 * PRATYAKSHA (प्रत्यक्ष) — Dynamic Cosmic Cyber Neural Background
 * Three.js High-Performance 3D Ambient Shader & Particle Matrix
 *
 * Implements:
 * - Ultra-sleek dark theme space / deep void styling (cosmic cyan, electric royal blue & starlight)
 * - 3D flowing neural synaptic particle field with distance connections
 * - Dynamic undulating hyperbolic grid ribbon plane
 * - Interactive 3D mouse parallax & cursor attraction / repulsion dynamics
 * - Fluid cognitive agent state transitions (idle, thinking, responding, error)
 * - Zero CPU waste: auto-pauses when sidepanel is occluded / tab hidden
 */

import * as THREE from './three.module.js';

export class DynamicCosmicBackground {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   */
  constructor(canvas, options = {}) {
    if (!canvas) throw new Error('DynamicCosmicBackground: canvas element required');

    this.canvas = canvas;
    this.options = {
      particleCount: 140,
      particleSpread: 120,
      maxConnectionDist: 26,
      gridSize: 90,
      gridDivisions: 40,
      ...options
    };

    this.destroyed = false;
    this.visible = true;
    this.clock = new THREE.Clock();
    this.time = 0;

    // Mouse Tracking in Normalized Device Coordinates & World Coordinates
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.targetMouseWorld = new THREE.Vector3(0, 0, 0);
    this.currentMouseWorld = new THREE.Vector3(0, 0, 0);
    this.mouseActive = 0;
    this.targetMouseActive = 0;

    // Cognitive State (0 = idle, 1 = thinking, 2 = responding, 3 = error)
    this.state = 'idle';
    this.stateNum = 0.0;
    this.targetSpeed = 1.0;
    this.currentSpeed = 1.0;

    // Color Palette per state
    this.palettes = {
      idle: {
        bg: 0x070B16,
        fog: 0x070B16,
        primary: new THREE.Color(0x00E5FF),
        secondary: new THREE.Color(0x315EF7),
        accent: new THREE.Color(0x6387FF),
        lines: 0x00E5FF,
        lineOpacity: 0.16
      },
      thinking: {
        bg: 0x080A1A,
        fog: 0x080A1A,
        primary: new THREE.Color(0x83E8FF),
        secondary: new THREE.Color(0x4F46E5),
        accent: new THREE.Color(0x9333EA),
        lines: 0x83E8FF,
        lineOpacity: 0.32
      },
      responding: {
        bg: 0x041315,
        fog: 0x041315,
        primary: new THREE.Color(0x10B981),
        secondary: new THREE.Color(0x06B6D4),
        accent: new THREE.Color(0x38BDF8),
        lines: 0x10B981,
        lineOpacity: 0.28
      },
      error: {
        bg: 0x150709,
        fog: 0x150709,
        primary: new THREE.Color(0xEF4444),
        secondary: new THREE.Color(0xF97316),
        accent: new THREE.Color(0xDC2626),
        lines: 0xEF4444,
        lineOpacity: 0.24
      }
    };

    this.init();
  }

  init() {
    const width = Math.max(this.canvas.clientWidth || window.innerWidth, 100);
    const height = Math.max(this.canvas.clientHeight || window.innerHeight, 100);

    // 1. Scene & Depth Fog
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x070B16, 0.012);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500);
    this.camera.position.set(0, 16, 68);
    this.camera.lookAt(0, 0, 0);

    // 3. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x070B16, 1);

    // 4. Raycaster & Tracking Plane
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    // 5. Build 3D Objects
    this.createNeuralParticleCloud();
    this.createCyberGridTerrain();
    this.createFloatingCosmicDust();

    // 6. Bind Events
    this.bindEvents();

    // 7. Start RAF
    this.animate = this.animate.bind(this);
    this.rafId = requestAnimationFrame(this.animate);
  }

  /**
   * 3D Neural Synapse Nodes + Dynamic Connecting Laser Filaments
   */
  createNeuralParticleCloud() {
    const count = this.options.particleCount;
    this.particleNodes = [];

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const basePrimary = this.palettes.idle.primary;
    const baseSecondary = this.palettes.idle.secondary;

    for (let i = 0; i < count; i++) {
      const spread = this.options.particleSpread;
      const x = (Math.random() - 0.5) * spread;
      const y = (Math.random() - 0.5) * (spread * 0.7);
      const z = (Math.random() - 0.5) * (spread * 0.5);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color lerp between primary cyan and secondary electric blue
      const lerpFactor = Math.random();
      const nodeCol = basePrimary.clone().lerp(baseSecondary, lerpFactor);

      colors[i * 3] = nodeCol.r;
      colors[i * 3 + 1] = nodeCol.g;
      colors[i * 3 + 2] = nodeCol.b;

      sizes[i] = (Math.random() * 3.5 + 2.0) * this.dpr;

      // Velocity for physics drift
      this.particleNodes.push({
        basePos: new THREE.Vector3(x, y, z),
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.08,
          (Math.random() - 0.5) * 0.08,
          (Math.random() - 0.5) * 0.06
        ),
        orbitRadius: Math.random() * 8 + 3,
        orbitSpeed: (Math.random() * 0.8 + 0.4) * (Math.random() > 0.5 ? 1 : -1),
        orbitPhase: Math.random() * Math.PI * 2
      });
    }

    // Custom circular glow texture
    const discTex = this.createDiscTexture();

    const geometry = new THREE.BufferGeometry();
    this.nodePositionAttr = new THREE.BufferAttribute(positions, 3);
    this.nodeColorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('position', this.nodePositionAttr);
    geometry.setAttribute('color', this.nodeColorAttr);
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size: 4.5 * this.dpr,
      vertexColors: true,
      map: discTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9
    });

    this.nodesMesh = new THREE.Points(geometry, material);
    this.scene.add(this.nodesMesh);

    // Dynamic Line Filaments between close nodes
    const maxLines = 360;
    this.linePositions = new Float32Array(maxLines * 2 * 3);
    this.lineColors = new Float32Array(maxLines * 2 * 3);

    const lineGeometry = new THREE.BufferGeometry();
    this.linePosAttr = new THREE.BufferAttribute(this.linePositions, 3);
    this.lineColAttr = new THREE.BufferAttribute(this.lineColors, 3);
    lineGeometry.setAttribute('position', this.linePosAttr);
    lineGeometry.setAttribute('color', this.lineColAttr);

    this.linesMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: this.palettes.idle.lineOpacity,
      depthWrite: false
    });

    this.linesMesh = new THREE.LineSegments(lineGeometry, this.linesMaterial);
    this.scene.add(this.linesMesh);
  }

  /**
   * 3D Cyber undulating undulating grid ribbon in the bottom hemisphere
   */
  createCyberGridTerrain() {
    const size = this.options.gridSize;
    const divisions = this.options.gridDivisions;

    const planeGeo = new THREE.PlaneGeometry(size, size, divisions, divisions);
    planeGeo.rotateX(-Math.PI / 2);

    this.gridInitialPos = new Float32Array(planeGeo.attributes.position.array);
    this.gridGeo = planeGeo;

    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x1E3A8A,
      wireframe: true,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending
    });

    this.gridMesh = new THREE.Mesh(planeGeo, gridMat);
    this.gridMesh.position.set(0, -18, -12);
    this.scene.add(this.gridMesh);
  }

  /**
   * 3D Floating Cosmic Dust / Stardust Cloud
   */
  createFloatingCosmicDust() {
    const dustCount = 200;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    const dustCols = new Float32Array(dustCount * 3);

    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 160;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 120;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 100;

      dustCols[i * 3] = 0.5 + Math.random() * 0.5;
      dustCols[i * 3 + 1] = 0.8 + Math.random() * 0.2;
      dustCols[i * 3 + 2] = 1.0;
    }

    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCols, 3));

    // Soft circular glowing dust sprite texture
    const dustTex = this.createDiscTexture();

    const dustMat = new THREE.PointsMaterial({
      size: 2.2 * this.dpr,
      vertexColors: true,
      map: dustTex,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.dustMesh = new THREE.Points(dustGeo, dustMat);
    this.scene.add(this.dustMesh);
  }

  createDiscTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(131, 232, 255, 0.85)');
    grad.addColorStop(0.5, 'rgba(49, 94, 247, 0.35)');
    grad.addColorStop(0.8, 'rgba(49, 94, 247, 0.08)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(c);
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  bindEvents() {
    this.onPointerMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      this.targetMouseActive = 1.0;

      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.mouseNDC.set(x, y);

      this.raycaster.setFromCamera(this.mouseNDC, this.camera);
      const hit = this.raycaster.ray.intersectPlane(this.plane, this.targetMouseWorld);
      if (!hit) {
        this.targetMouseWorld.set(x * 35, y * 25, 0);
      }
    };

    this.onPointerLeave = () => {
      this.targetMouseActive = 0.0;
    };

    this.onClick = (e) => {
      this.triggerShockwave();
    };

    this.onResize = () => {
      if (this.destroyed) return;
      const width = Math.max(this.canvas.clientWidth || window.innerWidth, 100);
      const height = Math.max(this.canvas.clientHeight || window.innerHeight, 100);

      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(width, height, false);
    };

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

  /**
   * Propagate an interactive ripple or burst on click / agent actions
   */
  triggerShockwave() {
    this.burstEnergy = 1.0;
  }

  /**
   * Set cognitive state
   * @param {'idle' | 'thinking' | 'responding' | 'error'} state
   */
  setState(state) {
    if (this.destroyed) return;
    this.state = state || 'idle';
    const pal = this.palettes[this.state] || this.palettes.idle;

    if (this.state === 'thinking') {
      this.stateNum = 1.0;
      this.targetSpeed = 2.4;
      this.triggerShockwave();
    } else if (this.state === 'responding') {
      this.stateNum = 2.0;
      this.targetSpeed = 1.6;
    } else if (this.state === 'error') {
      this.stateNum = 3.0;
      this.targetSpeed = 0.7;
      this.triggerShockwave();
    } else {
      this.stateNum = 0.0;
      this.targetSpeed = 1.0;
    }

    if (this.linesMaterial) {
      this.linesMaterial.opacity = pal.lineOpacity;
    }
  }

  animate() {
    if (this.destroyed) return;
    if (!this.visible) {
      this.rafId = null;
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.06);
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, this.targetSpeed, 0.08);
    this.time += delta * this.currentSpeed;

    // 1. Mouse Dampening (Spring / Lerp)
    this.currentMouseWorld.lerp(this.targetMouseWorld, 0.08);
    this.mouseActive = THREE.MathUtils.lerp(this.mouseActive, this.targetMouseActive, 0.08);

    // 2. Camera Parallax Drift
    const targetCamX = this.currentMouseWorld.x * 0.15;
    const targetCamY = 16 + this.currentMouseWorld.y * 0.12;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, 0.05);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, 0.05);
    this.camera.lookAt(0, 0, 0);

    // 3. Update Neural Particles & Compute Connecting Synaptic Filaments
    if (this.nodePositionAttr && this.particleNodes) {
      const posArr = this.nodePositionAttr.array;
      const count = this.particleNodes.length;
      let lineVertexIdx = 0;
      const maxDist = this.options.maxConnectionDist;
      const maxDistSq = maxDist * maxDist;

      const pal = this.palettes[this.state] || this.palettes.idle;
      const primCol = pal.primary;
      const secCol = pal.secondary;

      for (let i = 0; i < count; i++) {
        const n = this.particleNodes[i];

        // Orbit around base point
        const angle = this.time * n.orbitSpeed + n.orbitPhase;
        const ox = Math.cos(angle) * n.orbitRadius;
        const oy = Math.sin(angle * 1.2) * (n.orbitRadius * 0.7);
        const oz = Math.sin(angle) * (n.orbitRadius * 0.6);

        n.pos.x = n.basePos.x + ox;
        n.pos.y = n.basePos.y + oy;
        n.pos.z = n.basePos.z + oz;

        // Mouse attraction / repulsion
        if (this.mouseActive > 0.01) {
          const dx = n.pos.x - this.currentMouseWorld.x;
          const dy = n.pos.y - this.currentMouseWorld.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 1200) {
            const factor = (1.0 - Math.sqrt(distSq) / 35.0) * this.mouseActive * 0.8;
            n.pos.x += dx * factor;
            n.pos.y += dy * factor;
          }
        }

        posArr[i * 3] = n.pos.x;
        posArr[i * 3 + 1] = n.pos.y;
        posArr[i * 3 + 2] = n.pos.z;

        // Connect adjacent nodes
        for (let j = i + 1; j < count; j++) {
          if (lineVertexIdx >= 360 * 2) break;
          const n2 = this.particleNodes[j];
          const distSq = n.pos.distanceToSquared(n2.pos);

          if (distSq < maxDistSq) {
            const alpha = 1.0 - Math.sqrt(distSq) / maxDist;

            // Line vertex 1
            this.linePositions[lineVertexIdx * 3] = n.pos.x;
            this.linePositions[lineVertexIdx * 3 + 1] = n.pos.y;
            this.linePositions[lineVertexIdx * 3 + 2] = n.pos.z;

            this.lineColors[lineVertexIdx * 3] = primCol.r * alpha;
            this.lineColors[lineVertexIdx * 3 + 1] = primCol.g * alpha;
            this.lineColors[lineVertexIdx * 3 + 2] = primCol.b * alpha;
            lineVertexIdx++;

            // Line vertex 2
            this.linePositions[lineVertexIdx * 3] = n2.pos.x;
            this.linePositions[lineVertexIdx * 3 + 1] = n2.pos.y;
            this.linePositions[lineVertexIdx * 3 + 2] = n2.pos.z;

            this.lineColors[lineVertexIdx * 3] = secCol.r * alpha;
            this.lineColors[lineVertexIdx * 3 + 1] = secCol.g * alpha;
            this.lineColors[lineVertexIdx * 3 + 2] = secCol.b * alpha;
            lineVertexIdx++;
          }
        }
      }

      this.nodePositionAttr.needsUpdate = true;
      if (this.linePosAttr) {
        this.linePosAttr.needsUpdate = true;
        this.lineColAttr.needsUpdate = true;
        this.linesMesh.geometry.setDrawRange(0, lineVertexIdx);
      }
    }

    // 4. Undulate Cyber Grid Terrain
    if (this.gridGeo && this.gridInitialPos) {
      const pos = this.gridGeo.attributes.position;
      const arr = pos.array;
      const initial = this.gridInitialPos;
      const len = arr.length / 3;

      for (let i = 0; i < len; i++) {
        const ix = initial[i * 3];
        const iz = initial[i * 3 + 2];
        const dist = Math.sqrt(ix * ix + iz * iz);

        // Sinusoidal rolling waves in cyber dark plane
        const wave = Math.sin(ix * 0.12 + this.time * 1.5) * 2.2
                   + Math.cos(iz * 0.14 + this.time * 1.2) * 2.0
                   + Math.sin((ix + iz) * 0.08 - this.time * 1.8) * 1.4;

        arr[i * 3 + 1] = initial[i * 3 + 1] + wave;
      }
      pos.needsUpdate = true;
    }

    // 5. Slowly Drift Cosmic Dust Cloud
    if (this.dustMesh) {
      this.dustMesh.rotation.y = this.time * 0.035;
      this.dustMesh.rotation.x = Math.sin(this.time * 0.02) * 0.05;
    }

    // 6. Render
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

    if (this.nodesMesh) {
      this.scene.remove(this.nodesMesh);
      this.nodesMesh.geometry.dispose();
      this.nodesMesh.material.dispose();
    }
    if (this.linesMesh) {
      this.scene.remove(this.linesMesh);
      this.linesMesh.geometry.dispose();
      this.linesMesh.material.dispose();
    }
    if (this.gridMesh) {
      this.scene.remove(this.gridMesh);
      this.gridMesh.geometry.dispose();
      this.gridMesh.material.dispose();
    }
    if (this.dustMesh) {
      this.scene.remove(this.dustMesh);
      this.dustMesh.geometry.dispose();
      this.dustMesh.material.dispose();
    }

    this.renderer?.dispose();
  }
}
