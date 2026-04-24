# Client HUD — Implementation

## Relevant Files

```
react-three-capacitor/src/
  App.tsx                 — Loading overlay (image + pulse keyframes) and Canvas/HUD root
  hud/
    HUD.tsx               — Root HUD container; mounts all sub-components
    Joystick.tsx          — Joystick pad with direct-DOM knob updates
    Notifications.tsx     — Stacking notification pills
    RulePopup.tsx         — One-shot rule overlay for `show_rule` events
    RulesPanel.tsx        — Scrolling grid of all active rule texts
    SettingsPanel.tsx     — Sound, input-mode, and respawn options
    ChoicePopup.tsx       — Multi-option choice overlay for `show_choice` events
    EliminationOverlay.tsx — Full-screen "ELIMINATED" / "DISCONNECTED" overlay
  store/
    gameStore.ts          — notifications, connection state; addNotification method
```

## HUD Container

`HUD.tsx` is a `position: fixed; inset: 0` div layered over the 3D canvas with `pointerEvents: none`. Individual interactive elements (joystick, settings button, rules button) opt back in with `pointerEvents: auto`. All edge-positioned elements use `env(safe-area-inset-*)` CSS variables. The HUD is not mounted until a `sceneReady` flag is set — the flag is raised one `requestAnimationFrame` after Three.js fires `onCreated`.

## Loading Overlay

The loading overlay lives in `App.tsx` (not `HUD.tsx`): a full-screen `<div>` at `z-index: 1000` covering the canvas with a centered `<img>` of the game logo. The image pulses via a `@keyframes pulse` animation (`2s ease-in-out infinite`) that toggles `opacity` and `transform: scale()`. Once `sceneReady` becomes true the overlay animates to `opacity: 0` over 0.5 s and drops `pointer-events`; it is never unmounted.

## Joystick

`Joystick.tsx` sizes the pad and knob using CSS `clamp(...)` so the pad is 120 px on phones and scales proportionally up to 220 px. The maximum knob displacement is computed from the pad's rendered width: `maxDist = padWidth * (1 − KNOB_FRACTION) / 2`, where `KNOB_FRACTION = 50 / 120` (the knob-to-pad ratio). On every pointer/touch move, the knob's CSS `transform: translate(...)` is updated via direct DOM mutation (bypassing React state) so the visual is synchronous at 60 Hz. The normalised direction and magnitude are written to the Zustand store on each move event. On release, the knob returns to centre via a 50 ms CSS ease-out transition and the store values are zeroed. Only one touch identifier is tracked simultaneously; a second simultaneous touch is ignored. When `selectInputBlocked` is true (local elimination, an open popup, etc.), all pointer and touch event handlers on the joystick are suppressed — no position updates or store writes occur.

## Notifications

`addNotification(message, durationMs = 2000)` in `gameStore.ts` appends `{ id, message, expiresAt: Date.now() + durationMs }` and schedules a `setTimeout` to remove the entry. The `Notifications` component is a pure renderer over the store array — it adds no timers. Pills use `backdrop-filter: blur(6px)`, bold white text, and `white-space: nowrap`.

## Rule Popup

`RulePopup.tsx` reads `activeRuleEvent` from the store. When non-null it renders a full-screen backdrop (`rgba(0,0,0,0.75)`, `z-index: 200`) with a centred column of cards (`width: min(640px, 90vw)`). Each card is a flex row (`alignItems: center`) with two children:
- The rule text on the left (`flex: 1`, `textAlign: left`, `fontSize: clamp(0.85rem, 2.2vw, 1.05rem)`, `line-height: 1.4`).
- The category label on the right (bordered pill, uppercase, `fontSize: clamp(0.55rem, 1.2vw, 0.65rem)`, `letterSpacing: 0.1em`).

Cards cycle through five dark background colours. A close button (`×`) in the top-right corner calls `dismissRule`. The full-screen backdrop itself also calls `dismissRule` on click or tap (any position). A `useEffect` attaches a `keydown` listener on `window` for the duration the popup is visible; any key press calls `dismissRule` and the listener is removed on cleanup.

`useWebSocket.ts` converts incoming `instruction` server messages into `showRule` calls with the supplied lines instead of routing them to `addNotification`.

## Rules Panel

`RulesPanel.tsx` reads `rulesOpen` and `activeRules` from the store. It renders a scrollable two-column grid of every active rule text, cycling the same five card background colours as `RulePopup`. Clicking the backdrop, pressing the close button, or pressing any key calls `setRulesOpen(false)`. The panel is opened by the `RULES` button in `HUD.tsx`, which is only rendered when `activeRules.length > 0`.

## Settings Panel

`SettingsPanel.tsx` is gated by `settingsOpen` in the store. It renders a small centered card with two views: the main view has `SETTINGS` and `RESPAWN` buttons (respawn navigates to `/`); the settings view exposes a sound checkbox (persisted via `getSoundEnabled` / `setSoundEnabled`) and a joystick / tap-to-move toggle (writes to the store's `inputMode`). An Escape-key listener closes the panel.

## Choice Popup

`ChoicePopup.tsx` reads `activeChoiceEvent` and renders a grid of option cards. Selecting an option sends a `choice` message via `sendChoice(eventId, optionId)` and dismisses the popup.

## Elimination Overlay

`EliminationOverlay.tsx` is mounted directly in `HUD.tsx` (not inside any player-specific HUD wrapper). It renders a `position: fixed` full-screen overlay at `z-index: 1000` when either the local player's HP is 0 or observer mode has ended. The overlay reads `#e74c3c` `ELIMINATED` or `DISCONNECTED` text and, for local eliminations, attaches a tap-to-reconnect handler that calls `reconnectWs`.

## Status Bar

A `div` fixed to the top-right reads `connected` from the store and shows the current room name. The dot is a small circle: `#22ee88` when connected, `#ee4444` otherwise. Below the status bar the top-right stack contains the `SETTINGS` button and (conditionally) the `RULES` button.
