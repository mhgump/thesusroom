# Spec

## Player actions

- A player can move continuously in any direction by holding the joystick.
- A player can perform a discrete game action by tapping an action button. The available actions are determined by the current round. At most 3 actions are available at any time.
- The `SKIP` action is always available and is the default action in every round.
- A player can perform at most one action per button press; holding does not repeat.

## Game events (player perspective)

- A player is **touched** when their capsule overlaps another player's capsule for the first time during a move. Sustained overlap does not re-trigger the event; it fires again only after the players separate and re-contact.
- The local player receives a touch notification immediately when their own move causes the contact.
- The local player receives a touch notification with a short delay when another player's move causes the contact.
- A player's visual state transitions between **idle** (standing still) and **walking** (moving) based on whether the joystick is being held past a small dead-zone threshold.
- The current round number is always visible to the player.
- The player's connection status is always visible.

## Loading

- While the game scene is initialising, the player sees a full-screen black overlay with a centered spinning ring indicator.
- The spinner disappears and the game becomes playable once the scene has rendered its first frame.

## Connection status

- A small colored dot in the top-right corner indicates connection state: green when connected, red when not.
- The current round number is displayed next to the dot, prefixed with `R`.

## Joystick

- The joystick is a fixed circular pad in the bottom-left corner of the screen.
- The player drags within the pad to move. The knob visually tracks the finger position, clamped to the pad's radius.
- Releasing the joystick returns the knob to center and stops movement.
- The joystick works with touch on mobile and mouse on desktop.

## Action buttons

- Action buttons appear in the bottom-right corner, stacked vertically.
- Each button is large enough to tap comfortably on a small touchscreen.
- The `SKIP` button has a distinct cyan tint. Other actions use a neutral tint.
- Buttons have a frosted-glass appearance.

## Touch notifications

- When a touch event occurs, a notification reading `Touched!` appears near the top-center of the screen.
- Notifications stack vertically. Each expires and disappears after 2 seconds.
- Notifications are non-interactive and do not block input.

## Layout and safe areas

- All HUD elements respect device safe areas (notches, home indicators) so nothing is obscured on any supported device.

---

# Implementation

## HUD overlay

The HUD is a `position: fixed; inset: 0` div layered over the 3D canvas. The container has `pointerEvents: none` so all touches pass through to the game by default; individual interactive elements opt back in with `pointerEvents: auto`. All edge-positioned elements use `env(safe-area-inset-*)` CSS variables to stay clear of device notches and home indicators.

The HUD is not mounted until the scene has rendered its first frame. A `sceneReady` flag gates its appearance; the flag is set one `requestAnimationFrame` after Three.js fires `onCreated`.

## Loading spinner

A black overlay sits at `z-index: 100` above the canvas. It contains a 40 px ring animated with `@keyframes spin` (0.8s linear, infinite) rendered in CSS border form. The overlay unmounts as soon as `sceneReady` is true.

## Joystick

The joystick is 120 px across with a 50 px knob. Maximum knob displacement from center is 35 px. On each pointer or touch move the knob's CSS `transform: translate(...)` is updated directly (no React state) so the visual updates synchronously. The normalized direction and magnitude are written to the store on every move event. On release the knob returns to center via a 50 ms CSS ease-out transition and the store values are zeroed. Only one touch identifier is tracked at a time; a second simultaneous touch is ignored.

## Action buttons

`ActionButtons` renders the first three entries in `availableActions` from the store (set by `round_config`). Each button is 76 × 76 px with `border-radius: 14`, `backdrop-filter: blur(4px)`, and a semi-transparent border. A static `ACTION_PALETTE` record maps action names to background colors; `SKIP` maps to `rgba(0,200,200,0.65)` and any unmapped action falls back to `rgba(255,255,255,0.2)`. The action is sent to the server on `pointerdown`; `preventDefault()` suppresses duplicate click events on touch devices.

## Notifications

`addNotification` in the Zustand store appends `{ id, message, expiresAt: Date.now() + 2000 }` and schedules a `setTimeout` to remove the entry after 2 seconds. The `Notifications` component is a pure renderer — it maps over the store array and adds no timers of its own. Each pill is rendered as a dark rounded tag with `backdrop-filter: blur(6px)`, bold white text, and `white-space: nowrap`. New entries append at the bottom of the column (DOM order).

## Status bar

A single `div` fixed to the top-right reads `connected` and `currentRound` from the store. The dot is an 8 px circle; its `background` is `#22ee88` when connected and `#ee4444` otherwise. The round label is `R{currentRound}` at 12 px muted white.

---

# Expectations

- **New actions need a palette entry.** Add the action name and a background color to `ACTION_PALETTE` in `ActionButtons.tsx`. If omitted the button renders with the neutral fallback, which is acceptable but visually undifferentiated.

- **New game events that produce notifications call `addNotification` in the store.** The notification system is the only player-visible feedback channel for events. Do not render event feedback in other ways (alerts, console output, overlays) — keep all transient feedback through the notification queue so timing and expiry are consistent.

- **Action button count is capped at 3.** `ActionButtons` slices `availableActions` to 3. Adding more actions on the server side will silently drop the extras on the client. Extend the cap deliberately, accounting for the layout area on small screens.

- **Safe area insets are required on all HUD edge placements.** Never position HUD elements with a fixed pixel offset from an edge without including `env(safe-area-inset-*)`. Devices with notches, rounded corners, or home indicators will clip the element otherwise.

- **The joystick knob is updated via direct DOM mutation, not React state.** This is intentional — pointer move events fire at 60 Hz and React state updates at that rate would be excessive. Do not refactor the knob position into `useState`.

- **Notifications are self-expiring via `setTimeout` in the store.** The `Notifications` component does not manage timers. If you add a new notification type with a different duration, add a dedicated store action (e.g. `addNotification(message, durationMs)`) rather than scheduling expiry in the component.
