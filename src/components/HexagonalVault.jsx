import React, { useEffect, useRef } from 'react';
import { HexagonalVault as HexagonalVaultEngine, HEXAGONAL_VAULT_DEFAULTS, HEXAGONAL_VAULT_THEMES } from '../../pratyaksha-extension/sidepanel/hexagonal-vault.js';

export function HexagonalVault({
  theme = 'dark',
  colors,
  backgroundColor,
  lineWidth = 0.6,
  litWidth = 2.7,
  lattice = 1.4,
  glowRadius = 0.9,
  core = 0.75,
  trailLength = 2,
  follow = 0.65,
  flow = 0.68,
  speed = 1.15,
  pulseSpeed = 1.15,
  className = '',
  style = {}
}) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const themeConfig = HEXAGONAL_VAULT_THEMES[theme] || HEXAGONAL_VAULT_THEMES.dark;
  const activeColors = colors || themeConfig.colors;
  const activeBg = backgroundColor || themeConfig.backgroundColor;

  useEffect(() => {
    if (!canvasRef.current) return;

    engineRef.current = new HexagonalVaultEngine(canvasRef.current, {
      theme,
      colors: activeColors,
      backgroundColor: activeBg,
      lineWidth,
      litWidth,
      lattice,
      glowRadius,
      core,
      trailLength,
      follow,
      flow,
      speed,
      pulseSpeed
    });

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [
    colors,
    backgroundColor,
    lineWidth,
    litWidth,
    lattice,
    glowRadius,
    core,
    trailLength,
    follow,
    flow,
    speed,
    pulseSpeed
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={`hexagonal-vault-canvas ${className}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        display: 'block',
        ...style
      }}
    />
  );
}

export default HexagonalVault;
