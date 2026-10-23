# PRATYAKSHA UI Design System — Hexagonal Vault

## Direction

The PRATYAKSHA extension user interface is built on the **Hexagonal Vault** aesthetic: a tactile warm stone canvas (`#e0dcd8`) illuminated by an interactive GPU-accelerated hexagonal wireframe lattice lit by soft, reactive neon light (`#5227FF` electric violet and `#ff2a7d` neon magenta) that follows the user's cursor.

Surfaces and dialogs utilize frosted warm porcelain glass (`rgba(255, 255, 255, 0.74–0.92)` with `backdrop-filter: blur(16–24px)`), razor-thin warm-charcoal keylines, deep slate typography, and vibrant electric violet to neon magenta gradients for actions, active badges, and focus rings.

## Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| `bg-main` | `#e0dcd8` | Base warm stone background |
| `surface` | `rgba(255, 255, 255, 0.74)` | Frosted glass containers and header |
| `surface-card` | `rgba(255, 255, 255, 0.88)` | Message bubbles, status cards, pre-task pills |
| `primary-violet` | `#5227FF` | Electric violet accent, primary controls, user bubble |
| `accent-magenta` | `#ff2a7d` | Neon magenta pulse, thinking status, gradient highlights |
| `text-main` | `#18181B` | Primary headings and high-contrast titles |
| `text-body` | `#27272A` | Standard conversational copy and body text |
| `text-secondary`| `#52525B` | Metadata, hints, and secondary descriptions |
| `border-subtle` | `rgba(70, 60, 55, 0.12)` | Subtle card outlines and quiet dividers |
| `border-color` | `rgba(82, 39, 255, 0.20)`| Interactive card outlines and focus states |
| `success` | `#059669` | On-device privacy protection status |
| `error` | `#E11D48` | Stop and error states |

## Hexagonal Vault Component Configuration

The engine implements the exact React Bits Pro specification:

```javascript
export const HEXAGONAL_VAULT_DEFAULTS = {
  colors: ["#5227FF", "#ff2a7d"],
  backgroundColor: "#e0dcd8",
  lineWidth: 0.6000000000000001,
  litWidth: 2.7,
  lattice: 1.4000000000000001,
  glowRadius: 0.9000000000000001,
  core: 0.75,
  trailLength: 2,
  follow: 0.65,
  flow: 0.68,
  speed: 1.1500000000000001,
  pulseSpeed: 1.1500000000000001
};
```

## Typography and Shape

- UI Fonts: Inter for UI and conversation, Outfit for brand titles and hero headings, JetBrains Mono for status and code blocks.
- Corner Radii: 8px compact, 12px controls, 18px cards/bubbles, full pill (9999px) for buttons and status indicators.
- Elevation: Soft diffuse ambient shadows with violet aura under glow elements.

## Implementation Map

- `sidepanel/hexagonal-vault.js`: Sovereign WebGL2 hexagonal lattice shader engine with pointer follow, trail decay, flow wave, and shockwave pulses.
- `sidepanel/panel.css`: Hexagonal Vault light stone theme tokens and frosted glass components.
- `sidepanel/panel.html`: Cockpit template with dark emblem logo and Hexagonal Vault canvas.
- `popup/popup.html` & `popup/popup.css`: Quick launcher popup matching the Hexagonal Vault aesthetic.
- `src/components/HexagonalVault.jsx`: React wrapper component for seamless React/shadcn integration.
- `demo/hexagonal-vault-preview.html`: Interactive preview stage with live parameter controls and extension mockup.
