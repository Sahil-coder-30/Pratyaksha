/**
 * PRATYAKSHA (प्रत्यक्ष) — High-Performance 3D Multi-Orb Engine
 * Sovereign On-Device 3D Canvas Visualizer
 *
 * Features:
 * - Volumetric Ray-Shaded 3D Central Glass/Energy Sphere
 * - 4 Multi-Axis 3D Orbiting Satellite Orbs with True Z-Depth Sorting & Occlusion
 * - 3D Gyroscopic Orbital Energy Rings with Depth Trailing
 * - 32-Node 3D Spherical Quantum Particle Cloud
 * - Interactive Mouse/Pointer Parallax & Perspective Tilt
 * - Dynamic State Engine (idle, thinking, responding, error)
 * - Automatic HiDPI/Retina Display Crispness
 */

export class Orb3DController {
  constructor(canvas, options = {}) {
    if (!canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;

    this.options = options;
    this.state = canvas.dataset.state || options.state || 'idle';
    this.animId = null;
    this.destroyed = false;

    // Time & dynamics
    this.time = 0;
    this.lastTimestamp = performance.now();
    this.pulse = 0;
    this.burstEnergy = 0;

    // 3D Camera / Perspective rotation
    this.rotX = 0.18;
    this.rotY = 0.0;
    this.targetRotX = 0.18;
    this.targetRotY = 0.0;
    this.mouseOffsetX = 0;
    this.mouseOffsetY = 0;

    // Configuration
    this.baseRadius = options.baseRadius || 34;
    this.colorThemes = {
      idle: {
        core: '#FFFFFF',
        specular: '#A6F2FF',
        primary: '#315EF7',
        secondary: '#6387FF',
        deep: '#0D2062',
        rim: 'rgba(131, 232, 255, 0.65)',
        halo: 'rgba(99, 135, 255, 0.28)',
        sat1: { core: '#FFFFFF', mid: '#83E8FF', edge: '#315EF7' },
        sat2: { core: '#FFFFFF', mid: '#6387FF', edge: '#1638A0' },
        sat3: { core: '#F0FAFF', mid: '#9EE6FF', edge: '#2352E0' },
        sat4: { core: '#FFFFFF', mid: '#C4F4FF', edge: '#4F77FF' },
        speed: 1.0,
        corePulseSpeed: 2.2
      },
      thinking: {
        core: '#FFFFFF',
        specular: '#83E8FF',
        primary: '#2452F5',
        secondary: '#57B5FF',
        deep: '#0A1A54',
        rim: 'rgba(131, 232, 255, 0.95)',
        halo: 'rgba(49, 94, 247, 0.42)',
        sat1: { core: '#FFFFFF', mid: '#9BF2FF', edge: '#1D45DB' },
        sat2: { core: '#FFFFFF', mid: '#6BB6FF', edge: '#102F94' },
        sat3: { core: '#FFFFFF', mid: '#B6EEFF', edge: '#1D45DB' },
        sat4: { core: '#FFFFFF', mid: '#E0F8FF', edge: '#3B6BF8' },
        speed: 2.3,
        corePulseSpeed: 5.5
      },
      responding: {
        core: '#FFFFFF',
        specular: '#B8F7FF',
        primary: '#10B981',
        secondary: '#38BDF8',
        deep: '#064E3B',
        rim: 'rgba(56, 189, 248, 0.85)',
        halo: 'rgba(16, 185, 129, 0.35)',
        sat1: { core: '#FFFFFF', mid: '#6EE7B7', edge: '#059669' },
        sat2: { core: '#FFFFFF', mid: '#38BDF8', edge: '#0284C7' },
        sat3: { core: '#F0FDF4', mid: '#A7F3D0', edge: '#047857' },
        sat4: { core: '#FFFFFF', mid: '#BAE6FD', edge: '#0369A1' },
        speed: 1.5,
        corePulseSpeed: 3.2
      },
      error: {
        core: '#FFFFFF',
        specular: '#FECDD3',
        primary: '#EF4444',
        secondary: '#F87171',
        deep: '#7F1D1D',
        rim: 'rgba(248, 113, 113, 0.85)',
        halo: 'rgba(239, 68, 68, 0.35)',
        sat1: { core: '#FFFFFF', mid: '#FCA5A5', edge: '#DC2626' },
        sat2: { core: '#FFFFFF', mid: '#F87171', edge: '#991B1B' },
        sat3: { core: '#FFF1F2', mid: '#FECDD3', edge: '#B91C1C' },
        sat4: { core: '#FFFFFF', mid: '#FDA4AF', edge: '#E11D48' },
        speed: 0.9,
        corePulseSpeed: 2.0
      }
    };

    // 4 Distinct 3D Orbiting Satellite Orbs ("Orbs")
    this.satellites = [
      {
        id: 1,
        radius: 6.8,
        semiMajor: 62,
        semiMinor: 42,
        speed: 1.35,
        angle: 0.8,
        tiltX: 0.58,
        tiltZ: 0.32,
        colorKey: 'sat1',
        trail: []
      },
      {
        id: 2,
        radius: 5.4,
        semiMajor: 76,
        semiMinor: 34,
        speed: -0.95,
        angle: 2.6,
        tiltX: -0.68,
        tiltZ: -0.42,
        colorKey: 'sat2',
        trail: []
      },
      {
        id: 3,
        radius: 4.4,
        semiMajor: 88,
        semiMinor: 52,
        speed: 1.7,
        angle: 4.2,
        tiltX: 0.82,
        tiltZ: -0.22,
        colorKey: 'sat3',
        trail: []
      },
      {
        id: 4,
        radius: 3.6,
        semiMajor: 52,
        semiMinor: 50,
        speed: -2.1,
        angle: 1.5,
        tiltX: 1.15,
        tiltZ: 0.75,
        colorKey: 'sat4',
        trail: []
      }
    ];

    // 32-Node 3D Ambient Quantum Dust Sphere
    this.particles = [];
    for (let i = 0; i < 32; i++) {
      const phi = Math.acos(-1 + (2 * i) / 32);
      const theta = Math.sqrt(32 * Math.PI) * phi;
      const dist = 52 + (i % 5) * 11 + Math.random() * 8;
      this.particles.push({
        x: dist * Math.sin(phi) * Math.cos(theta),
        y: dist * Math.sin(phi) * Math.sin(theta),
        z: dist * Math.cos(phi),
        baseSize: 1.2 + Math.random() * 1.6,
        alpha: 0.35 + Math.random() * 0.55,
        pulseOffset: Math.random() * Math.PI * 2
      });
    }

    this._bindEvents();
    this._resize();
    this.start();
  }

  _bindEvents() {
    this._onPointerMove = (e) => {
      try {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        this.mouseOffsetX = Math.max(-1, Math.min(1, x / (rect.width / 2)));
        this.mouseOffsetY = Math.max(-1, Math.min(1, y / (rect.height / 2)));
        this.targetRotY = this.mouseOffsetX * 0.45;
        this.targetRotX = 0.18 + this.mouseOffsetY * 0.38;
      } catch (_) {}
    };

    this._onPointerLeave = () => {
      this.targetRotY = 0;
      this.targetRotX = 0.18;
      this.mouseOffsetX = 0;
      this.mouseOffsetY = 0;
    };

    this._onClick = () => {
      this.burstEnergy = 1.0;
    };

    try {
      const container = this.canvas.parentElement || this.canvas;
      container.addEventListener('pointermove', this._onPointerMove, { passive: true });
      container.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
      container.addEventListener('click', this._onClick);

      this._onResize = () => this._resize();
      window.addEventListener('resize', this._onResize, { passive: true });
    } catch (err) {
      console.warn('[PRATYAKSHA] Orb3D bindEvents warning:', err);
    }
  }

  _resize() {
    try {
      if (!this.canvas || !this.ctx) return;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(60, rect.width || 200);
      const h = Math.max(60, rect.height || 200);

      this.width = w;
      this.height = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      if (typeof this.ctx.setTransform === 'function') {
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    } catch (err) {
      console.warn('[PRATYAKSHA] Orb3D resize error:', err);
    }
  }

  setState(newState) {
    try {
      if (newState && this.colorThemes[newState]) {
        this.state = newState;
      }
    } catch (_) {}
  }

  start() {
    if (this.animId) return;
    this.lastTimestamp = performance.now();
    const loop = (now) => {
      if (this.destroyed) return;
      try {
        const dt = Math.min(Math.max(0, (now - this.lastTimestamp) / 1000), 0.1);
        this.lastTimestamp = now;
        this._update(dt);
        this._render();
      } catch (err) {
        console.warn('[PRATYAKSHA] Orb3D frame render error:', err);
      }
      if (!this.destroyed) {
        this.animId = requestAnimationFrame(loop);
      }
    };
    this.animId = requestAnimationFrame(loop);
  }

  stop() {
    try {
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
    } catch (_) {}
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    try {
      const container = this.canvas?.parentElement || this.canvas;
      if (container) {
        if (this._onPointerMove) container.removeEventListener('pointermove', this._onPointerMove);
        if (this._onPointerLeave) container.removeEventListener('pointerleave', this._onPointerLeave);
        if (this._onClick) container.removeEventListener('click', this._onClick);
      }
      if (this._onResize) window.removeEventListener('resize', this._onResize);
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────
  // 3D Coordinate Projection Math
  // ─────────────────────────────────────────────────────────────
  _project3D(x, y, z, cx, cy) {
    try {
      // 1. Rotate around Y axis (horizontal yaw)
      const cosY = Math.cos(this.rotY);
      const sinY = Math.sin(this.rotY);
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;

      // 2. Rotate around X axis (vertical pitch)
      const cosX = Math.cos(this.rotX);
      const sinX = Math.sin(this.rotX);
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      // 3. Perspective scaling (focal length = 340) with defensive divisor
      const fov = 340;
      const denom = Math.max(20, fov + z2);
      const scale = Math.max(0.05, Math.min(3.0, fov / denom));

      return {
        x: cx + x1 * scale,
        y: cy + y2 * scale,
        z: z2,
        scale: scale
      };
    } catch (_) {
      return { x: cx, y: cy, z: 0, scale: 1 };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Update Physics & Orbits
  // ─────────────────────────────────────────────────────────────
  _update(dt) {
    const theme = this.colorThemes[this.state] || this.colorThemes.idle;
    const speedMult = theme.speed * (1 + this.burstEnergy * 0.8);
    this.time += dt * speedMult;

    // Dampen mouse parallax rotation smoothly
    this.rotX += (this.targetRotX - this.rotX) * 0.08;
    this.rotY += (this.targetRotY - this.rotY) * 0.08;

    // Burst energy recovery
    if (this.burstEnergy > 0) {
      this.burstEnergy = Math.max(0, this.burstEnergy - dt * 1.8);
    }

    // Update satellite orbits in 3D
    for (const sat of this.satellites) {
      sat.angle += dt * sat.speed * speedMult * 0.95;

      // Unrotated position on orbital ellipse
      const rawX = Math.cos(sat.angle) * (sat.semiMajor + this.burstEnergy * 14);
      const rawY = Math.sin(sat.angle) * (sat.semiMinor + this.burstEnergy * 10);

      // Tilt orbital plane in 3D (pitch & roll)
      const cosTX = Math.cos(sat.tiltX);
      const sinTX = Math.sin(sat.tiltX);
      const cosTZ = Math.cos(sat.tiltZ);
      const sinTZ = Math.sin(sat.tiltZ);

      // Apply orbital inclination
      const y1 = rawY * cosTX;
      const z1 = rawY * sinTX;

      const x2 = rawX * cosTZ - y1 * sinTZ;
      const y2 = rawX * sinTZ + y1 * cosTZ;
      const z2 = z1;

      sat.worldX = x2;
      sat.worldY = y2;
      sat.worldZ = z2;

      // Append trail point for luminescence
      if (sat.trail.length > 5) sat.trail.shift();
      sat.trail.push({ x: x2, y: y2, z: z2, time: this.time });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Render 3D Scene with Full Z-Sorting
  // ─────────────────────────────────────────────────────────────
  _render() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2 - 2;

    ctx.clearRect(0, 0, w, h);

    const theme = this.colorThemes[this.state] || this.colorThemes.idle;

    // Floating central altitude
    const hoverY = Math.sin(this.time * 2.2) * 5.5;
    const mainSphereProj = this._project3D(0, hoverY, 0, cx, cy);

    // 1. Soft Dynamic Ground Contact Shadow
    const groundY = cy + 62;
    const shadowDist = (mainSphereProj.y - cy);
    const shadowScale = Math.max(0.72, Math.min(1.15, 1 - shadowDist * 0.025));
    const shadowGrad = ctx.createRadialGradient(cx, groundY, 4, cx, groundY, 42 * shadowScale);
    shadowGrad.addColorStop(0, 'rgba(30, 58, 138, 0.28)');
    shadowGrad.addColorStop(0.5, 'rgba(49, 94, 247, 0.12)');
    shadowGrad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.fillStyle = shadowGrad;
    ctx.beginPath();
    ctx.ellipse(cx, groundY, 44 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Prepare Renderable Queue for Z-Sorting
    const renderQueue = [];

    // Queue Item: Main Central Sphere
    renderQueue.push({
      type: 'main_sphere',
      z: 0,
      proj: mainSphereProj
    });

    // Queue Items: Orbiting Satellite Orbs
    for (const sat of this.satellites) {
      const proj = this._project3D(sat.worldX, sat.worldY + hoverY, sat.worldZ, cx, cy);
      renderQueue.push({
        type: 'satellite',
        z: proj.z,
        sat: sat,
        proj: proj
      });
    }

    // Queue Items: Orbital Gyro Rings (Divided into Back-Arc z<0 and Front-Arc z>0)
    renderQueue.push({
      type: 'ring_back',
      z: -18,
      hoverY: hoverY
    });
    renderQueue.push({
      type: 'ring_front',
      z: 18,
      hoverY: hoverY
    });

    // Queue Items: Ambient 3D Quantum Dust
    for (const p of this.particles) {
      const pProj = this._project3D(p.x, p.y + hoverY, p.z, cx, cy);
      renderQueue.push({
        type: 'dust',
        z: pProj.z,
        p: p,
        proj: pProj
      });
    }

    // SORT BY Z COORDINATE (Lowest Z = farthest back in 3D space)
    renderQueue.sort((a, b) => a.z - b.z);

    // 3. Render In Depth-Sorted Order
    for (const item of renderQueue) {
      switch (item.type) {
        case 'ring_back':
          this._drawOrbitalRings(ctx, cx, cy, item.hoverY, true, theme);
          break;
        case 'dust':
          this._drawDustParticle(ctx, item.p, item.proj, theme);
          break;
        case 'satellite':
          this._drawSatellite(ctx, item.sat, item.proj, theme);
          break;
        case 'main_sphere':
          this._drawMainSphere(ctx, item.proj, theme);
          break;
        case 'ring_front':
          this._drawOrbitalRings(ctx, cx, cy, item.hoverY, false, theme);
          break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Draw Main 3D Sphere (Volumetric Glass & Quantum Core)
  // ─────────────────────────────────────────────────────────────
  _drawMainSphere(ctx, proj, theme) {
    const r = this.baseRadius * proj.scale;
    const px = proj.x;
    const py = proj.y;

    // A. Diffuse Back Glow Aura
    const auraGrad = ctx.createRadialGradient(px, py, r * 0.6, px, py, r * 1.85);
    auraGrad.addColorStop(0, theme.halo);
    auraGrad.addColorStop(0.6, 'rgba(49, 94, 247, 0.08)');
    auraGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(px, py, r * 1.85, 0, Math.PI * 2);
    ctx.fill();

    // B. Main Volumetric Sphere Shading (Dynamic Light Source)
    const lx = px - r * 0.32 + this.mouseOffsetX * 6;
    const ly = py - r * 0.36 + this.mouseOffsetY * 6;

    const sphereGrad = ctx.createRadialGradient(lx, ly, 1, px, py, r);
    sphereGrad.addColorStop(0.0, theme.core);
    sphereGrad.addColorStop(0.16, theme.specular);
    sphereGrad.addColorStop(0.42, theme.secondary);
    sphereGrad.addColorStop(0.72, theme.primary);
    sphereGrad.addColorStop(0.92, theme.deep);
    sphereGrad.addColorStop(1.0, '#06133E');

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = sphereGrad;
    ctx.shadowColor = 'rgba(49, 94, 247, 0.32)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fill();
    ctx.restore();

    // C. Internal Translucent Pulsating Quantum Energy Core
    const pulseFactor = 0.88 + Math.sin(this.time * theme.corePulseSpeed) * 0.14 + this.burstEnergy * 0.25;
    const coreR = r * 0.44 * pulseFactor;
    const coreGrad = ctx.createRadialGradient(px, py, 0, px, py, coreR);
    coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    coreGrad.addColorStop(0.4, theme.specular);
    coreGrad.addColorStop(0.85, 'rgba(49, 94, 247, 0.45)');
    coreGrad.addColorStop(1, 'transparent');

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.arc(px, py, coreR, 0, Math.PI * 2);
    ctx.fillStyle = coreGrad;
    ctx.fill();
    ctx.restore();

    // D. Subsurface Refraction Caustic Rim (Bottom-Right Crescent Light)
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r - 1.5, 0, Math.PI * 2);
    ctx.clip();

    const causticGrad = ctx.createRadialGradient(px + r * 0.4, py + r * 0.45, r * 0.15, px, py, r);
    causticGrad.addColorStop(0, 'rgba(131, 232, 255, 0.45)');
    causticGrad.addColorStop(0.45, 'rgba(99, 135, 255, 0.15)');
    causticGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = causticGrad;
    ctx.beginPath();
    ctx.arc(px + r * 0.3, py + r * 0.35, r * 0.75, 0, Math.PI * 2);
    ctx.fill();

    // E. Crisp Specular Gloss Reflection (Top-Left Pill Reflection)
    const specX = lx - r * 0.08;
    const specY = ly - r * 0.06;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.ellipse(specX, specY, r * 0.28, r * 0.15, -0.62, 0, Math.PI * 2);
    ctx.fill();

    // F. Inner Fresnel Rim Ring (Cyan Glass Edge Light)
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = theme.rim;
    ctx.beginPath();
    ctx.arc(px, py, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────
  // Draw 3D Satellite Orb with Volumetric Lighting & Trail
  // ─────────────────────────────────────────────────────────────
  _drawSatellite(ctx, sat, proj, theme) {
    const r = Math.max(2, sat.radius * proj.scale);
    const px = proj.x;
    const py = proj.y;
    const isBehind = proj.z < 0;

    const satColor = theme[sat.colorKey] || theme.sat1;

    // A. Draw Luminescent Motion Trail
    if (sat.trail.length > 1) {
      ctx.save();
      for (let i = 0; i < sat.trail.length - 1; i++) {
        const t1 = this._project3D(sat.trail[i].x, sat.trail[i].y, sat.trail[i].z, this.width / 2, this.height / 2 - 2);
        const t2 = this._project3D(sat.trail[i + 1].x, sat.trail[i + 1].y, sat.trail[i + 1].z, this.width / 2, this.height / 2 - 2);
        const alpha = ((i + 1) / sat.trail.length) * (isBehind ? 0.25 : 0.65);
        ctx.strokeStyle = `rgba(131, 232, 255, ${alpha.toFixed(2)})`;
        ctx.lineWidth = Math.max(1, (r * 0.5) * ((i + 1) / sat.trail.length));
        ctx.beginPath();
        ctx.moveTo(t1.x, t1.y);
        ctx.lineTo(t2.x, t2.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // B. Satellite Glow Aura
    const glowR = r * 2.2;
    const auraGrad = ctx.createRadialGradient(px, py, r * 0.5, px, py, glowR);
    auraGrad.addColorStop(0, isBehind ? 'rgba(99, 135, 255, 0.4)' : 'rgba(131, 232, 255, 0.7)');
    auraGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(px, py, glowR, 0, Math.PI * 2);
    ctx.fill();

    // C. 3D Spherical Satellite Body
    const lx = px - r * 0.35 + this.mouseOffsetX * 2;
    const ly = py - r * 0.35 + this.mouseOffsetY * 2;
    const bodyGrad = ctx.createRadialGradient(lx, ly, 0, px, py, r);
    bodyGrad.addColorStop(0, satColor.core);
    bodyGrad.addColorStop(0.35, satColor.mid);
    bodyGrad.addColorStop(0.9, satColor.edge);
    bodyGrad.addColorStop(1.0, '#06133E');

    ctx.save();
    if (isBehind) {
      ctx.globalAlpha = 0.65; // Soft depth fog when behind central sphere
    }
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.shadowColor = satColor.mid;
    ctx.shadowBlur = isBehind ? 4 : 10;
    ctx.fill();

    // D. Crisp Glint Specular Point
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(0.8, r * 0.28), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────
  // Draw 3D Gyroscopic Orbital Energy Rings
  // ─────────────────────────────────────────────────────────────
  _drawOrbitalRings(ctx, cx, cy, hoverY, isBackArc, theme) {
    const rings = [
      { a: 66, b: 46, tiltX: 0.58, tiltZ: 0.32, color: 'rgba(131, 232, 255, ' },
      { a: 80, b: 38, tiltX: -0.68, tiltZ: -0.42, color: 'rgba(99, 135, 255, ' },
      { a: 92, b: 56, tiltX: 0.82, tiltZ: -0.22, color: 'rgba(49, 94, 247, ' }
    ];

    ctx.save();
    for (const ring of rings) {
      const steps = 44;
      ctx.lineWidth = isBackArc ? 0.9 : 1.3;

      for (let i = 0; i < steps; i++) {
        const theta1 = (i / steps) * Math.PI * 2;
        const theta2 = ((i + 1) / steps) * Math.PI * 2;

        const p1 = this._getRingPoint(ring, theta1, hoverY, cx, cy);
        const p2 = this._getRingPoint(ring, theta2, hoverY, cx, cy);

        const avgZ = (p1.z + p2.z) / 2;
        if (isBackArc && avgZ >= 0) continue;
        if (!isBackArc && avgZ < 0) continue;

        const depthAlpha = isBackArc ? 0.22 : 0.65;
        ctx.strokeStyle = `${ring.color}${depthAlpha})`;

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _getRingPoint(ring, theta, hoverY, cx, cy) {
    const rawX = Math.cos(theta) * ring.a;
    const rawY = Math.sin(theta) * ring.b;

    const cosTX = Math.cos(ring.tiltX);
    const sinTX = Math.sin(ring.tiltX);
    const cosTZ = Math.cos(ring.tiltZ);
    const sinTZ = Math.sin(ring.tiltZ);

    const y1 = rawY * cosTX;
    const z1 = rawY * sinTX;

    const x2 = rawX * cosTZ - y1 * sinTZ;
    const y2 = rawX * sinTZ + y1 * cosTZ;
    const z2 = z1;

    return this._project3D(x2, y2 + hoverY, z2, cx, cy);
  }

  // ─────────────────────────────────────────────────────────────
  // Draw 3D Ambient Quantum Dust Particles
  // ─────────────────────────────────────────────────────────────
  _drawDustParticle(ctx, p, proj, theme) {
    const size = Math.max(0.6, p.baseSize * proj.scale);
    const pulse = 0.7 + Math.sin(this.time * 3 + p.pulseOffset) * 0.3;
    const isBehind = proj.z < 0;
    const alpha = (p.alpha * pulse * (isBehind ? 0.35 : 0.85)).toFixed(2);

    ctx.fillStyle = `rgba(131, 232, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
