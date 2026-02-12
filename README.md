# Twisty Torus

Play here: [https://davbachman.github.io/TwistyTorus/](https://davbachman.github.io/TwistyTorus/)

Twisty Torus is a browser puzzle game inspired by twisty puzzles, played on a torus surface.

The torus is split into 128 regions (16 x 8). You select a region and rotate either its meridional ring or longitudinal ring.

## Controls

### Desktop

- Left-click drag on a region: select it and rotate its ring
- Right-click drag: rotate the torus (camera orbit)
- Two-finger trackpad swipe: rotate the torus (camera orbit)
- Arrow keys: rotate selected ring (fallback controls)

### Mobile (Portrait)

- One-finger drag on a region: select it and rotate its ring
- Two-finger drag: rotate the torus (camera orbit)

### Mobile (Landscape)

- One-finger drag on a region: select it and rotate its ring
- Two-finger drag: rotate the torus (camera orbit)
- UI chrome (title, buttons, instructions) is hidden for full-screen canvas play

## Buttons

- `Scramble`: applies a random scramble sequence
- `Reset`: restores the initial solved coloring/layout

## Repository Layout

- `index.html` - app shell and script/style includes
- `styles.css` - responsive layout and mobile fullscreen behavior
- `main.js` - Three.js scene, puzzle state, input controls, rendering
- `progress.md` - development notes and handoff history
