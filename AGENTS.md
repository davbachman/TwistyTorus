# AGENTS.md

Guidance for future agents working in this repository.

## Project Summary

Twisty Torus is a static Three.js puzzle game in plain HTML/CSS/JS.

- Geometry: torus with `R=20`, `r=10`
- Grid: `U_CELLS=16`, `V_CELLS=8` (`128` regions total)
- State: sticker-based logical board with stable sticker IDs
- Rendering: each sticker is its own mesh; boundary arcs are separate line segments

Primary behavior:

- Region selection by pointer hit-test
- Ring rotation by direct drag (continuous during drag, snap on release)
- Camera orbit by right-drag / trackpad two-finger / mobile two-finger

## Key Files

- `index.html`
  - App shell, import map, cache-busted JS/CSS includes
- `styles.css`
  - Layout, responsive behavior
  - Mobile landscape fullscreen canvas mode (top/status UI hidden)
- `main.js`
  - Scene setup and puzzle logic
  - Input arbitration across desktop/mobile pointer paths
  - Public test hooks:
    - `window.render_game_to_text()`
    - `window.advanceTime(ms)`
- `progress.md`
  - Historical implementation notes

## Architecture Notes

### Puzzle Model

- `stickers[]` hold physical pieces (`id`, `iu`, `iv`, `colorIndex`, `mesh`, etc.)
- `board[iu][iv]` maps cell occupancy
- `selectedStickerId` tracks selected physical sticker

### Ring Drag Model

- Interaction state machine: `idle | ring_drag | orbit`
- Ring axis chosen from projected tangent alignment in current camera view
- During drag: active ring gets fractional parametric offset
- On release: `Math.round(offsetCells)` commits snapped whole-step move

### Camera/Responsive

- Base camera settings are desktop-first
- Mobile uses orientation-aware distance adjustments in `applyResponsiveCameraDistance`
- Mobile landscape uses fullscreen canvas CSS and hides top/status bars

## Testing and Verification

Minimum checks after meaningful changes:

1. Syntax:

```bash
node --check main.js
```

2. Manual local run:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/index.html`.

3. Behavior sanity:

- Desktop ring drag and right-drag orbit
- Mobile one-finger ring drag and two-finger orbit
- Reset and Scramble buttons
- Selected region boundary stays attached to selected sticker

If automated Playwright helpers are available in the environment, use them for quick screenshot/state regression.

## Repo Conventions

- Keep implementation vanilla (no framework/toolchain migration unless explicitly requested).
- Prefer targeted changes in `main.js` and `styles.css`.
- Preserve public hooks (`render_game_to_text`, `advanceTime`).
- When UI text/CSS/JS updates do not appear on device, increment cache-buster query params in `index.html`.

## Common Pitfalls

- Mobile browser caching can mask fresh JS/CSS.
- Touch-orbit path can break if `OrbitControls` is disabled without temporary re-enable around manual camera updates.
- Mobile landscape media queries may vary by device capability reporting; fallback conditions may be needed.
