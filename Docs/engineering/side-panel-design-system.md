# PRATYAKSHA UI design system

## Direction

Use a light, neutral interface with white surfaces, quiet gray borders, readable charcoal text, and a restrained professional blue for actions and focus. The side panel contains only the product name, settings access, conversation, and prompt composer. Keep the browser page visually in control: during actions show one small pointer that travels smoothly to its target and ripples on click. Do not draw target rectangles, labels, badges, or floating text over the page.

## Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `bg-root` | `#F7F8FA` | Side-panel and popup background |
| `bg-header` | `#FFFFFF` | Header and fixed chrome |
| `bg-surface` | `#FFFFFF` | Cards, agent messages, drawers |
| `bg-card` | `#F1F4F8` | Subtle nested surfaces |
| `bg-input` | `#FFFFFF` | Prompt and form controls |
| `bg-hover` | `#E9EDF3` | Hovered controls |
| `text-main` | `#182230` | Primary copy |
| `text-body` | `#344054` | Body copy |
| `text-muted` | `#667085` | Hints and metadata |
| `accent` | `#315BD6` | Focus, selection, primary control |
| `accent-strong` | `#2449B8` | Primary button and active states |
| `success` | `#16805D` | Ready, privacy protection, successful action |
| `info` | `#2463B8` | Informational status |
| `danger` | `#B42318` | Stop and error |
| `border` | `#E1E6ED` | Quiet separators and card outlines |

## Typography and shape

- UI font: Inter, falling back to the native system sans-serif stack. Use 12–13 px for compact extension controls, 11–12 px for body copy, and 9–10 px for uppercase metadata.
- Use tabular or monospace numerals only for domains, IDs, and trace data.
- Corner radii: 6 px compact, 10 px control, 12–14 px panel/card.
- Keep surfaces flat with subtle borders; reserve shadows for overlays and key actions.

## Interaction

- Primary action: professional blue fill, white text, visible focus ring, and restrained hover lift.
- Ready/privacy state: green. Agent activity and focus: blue. Errors and stop: red. Retain labels and icons so color is not the only status cue.
- Keep internal traces, tool calls, metrics, status pills, and suggestion tiles out of the customer-facing chat.
- Motion: smooth ease-in/ease-out pointer travel, with duration based on travel distance; honor `prefers-reduced-motion`.
- Page interaction indicator: one compact forest-green pointer silhouette with a white keyline and a restrained green click ripple. Do not add a second shaft line or a trailing cursor effect. It is `aria-hidden`, pointer-events-none, and never blocks website controls.
- Progressive text entry uses a randomized 250–300 WPM pace (five characters per word), with short punctuation pauses.
- The cursor is an in-page visual indicator. Chrome content scripts cannot move the operating system’s real mouse pointer; actual activation still uses the extension’s page interaction code.

## Implementation map

- `sidepanel/panel.css`: light theme tokens and minimal chat components.
- `popup/popup.css`: matching quick-launcher surfaces and action treatment.
- `content/highlighter.css` and `content/dom-actions.js`: in-tab cursor animation and progressive typing; no target boxes or action badges.
