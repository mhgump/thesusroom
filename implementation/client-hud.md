# Client HUD — Implementation

## Relevant Files

```
src/hud/
  HUD.tsx              — Root HUD container; mounts all sub-components
  PlayerHudOverlay.tsx — HP hearts and elimination overlay (see implementation/graphics.md)
  ChoicePopup.tsx      — Choice UI popup
  RulePopup.tsx        — Rule display popup
src/store/
  gameStore.ts         — notifications, availableActions, connection state; addNotification action
```

## HUD Container

`HUD.tsx` is a `position: fixed; inset: 0` div layered over the 3D canvas with `pointerEvents: none`. Individual interactive elements (joystick, action buttons) opt back in with `pointerEvents: auto`. All edge-positioned elements use `env(safe-area-inset-*)` CSS variables. The HUD is not mounted until a `sceneReady` flag is set — the flag is raised one `requestAnimationFrame` after Three.js fires `onCreated`.

## Loading Overlay

A black overlay at `z-index: 100` contains a 40 px ring animated with a `@keyframes spin` CSS animation (0.8 s linear infinite) drawn using CSS border styling. The overlay unmounts when `sceneReady` becomes true.

## Joystick

The pad is 120 px across with a 50 px knob. On every pointer/touch move, the knob's CSS `transform: translate(...)` is updated via direct DOM mutation (bypassing React state) so the visual is synchronous at 60 Hz. The normalised direction and magnitude are written to the Zustand store on each move event. On release, the knob returns to centre via a 50 ms CSS ease-out transition and the store values are zeroed. Only one touch identifier is tracked simultaneously; a second simultaneous touch is ignored. When the local player is eliminated (`localPlayerHp === 0`), all pointer and touch event handlers on the joystick are suppressed — no position updates or store writes occur.

## Action Buttons

`ActionButtons` renders the `availableActions` array from the store. Each button is 76 × 76 px with `border-radius: 14`, `backdrop-filter: blur(4px)`, and a semi-transparent border. A static `ACTION_PALETTE` record maps action names to background colours; unlisted names fall back to a neutral tint. The action is dispatched on `pointerdown`; `preventDefault()` suppresses duplicate click events on touch devices.

## Notifications

`addNotification` in `gameStore.ts` appends `{ id, message, expiresAt: Date.now() + 2000 }` and schedules a `setTimeout` to remove the entry. The `Notifications` component is a pure renderer over the store array — it adds no timers. Pills use `backdrop-filter: blur(6px)`, bold white text, and `white-space: nowrap`.

## Rule Popup

`RulePopup.tsx` reads `activeRuleEvent` from the store. When non-null it renders a full-screen backdrop (`rgba(0,0,0,0.75)`, `z-index: 200`) with a centred column of cards (`width: min(640px, 90vw)`). Each card shows two lines:
- A small header: `0.65 rem`, bold, `letter-spacing: 0.12em`, uppercase, `opacity: 0.7` — the `label` field (`RULE`, `COMMAND`, or `FACT`).
- The rule text: `1 rem`, `line-height: 1.4`.

Cards cycle through five dark background colours. A close button (`×`) in the top-right corner calls `dismissRule`.

`useWebSocket.ts` converts incoming `instruction` server messages into `showRule` calls with a single `COMMAND`-labelled card instead of routing them to `addNotification`.

## Status Bar

A `div` fixed to the top-right reads `connected` from the store. The dot is an 8 px circle: `#22ee88` when connected, `#ee4444` otherwise.
