# Client HUD — Spec

The following elements can appear on the HUD overlay:

- **Loading overlay**: full-screen; present while the scene initialises; disappears once the scene is ready.
- **Status bar**: top-right corner; contains a connection indicator dot and the current round label.
- **Joystick pad**: fixed in the bottom-left corner; a circular pad with a movable knob; the knob tracks the input position clamped to the pad radius; returns to centre when input is released.
- **Action buttons**: up to 3 buttons stacked vertically in the bottom-right corner; the `SKIP` button has a distinct cyan tint, other actions use a neutral tint; all buttons have a frosted-glass appearance; each is large enough to tap comfortably on a small touchscreen.
- **Touch notifications**: small pills in a stacking column near the top-centre; each expires and disappears automatically; non-interactive.
- **HP heart overlays**: one per visible player, projected from world-space position to screen coordinates and rendered at the player's feet. Full health (2) shows a full heart; half health (1) shows a half heart; zero health (0) shows no heart. NPCs with `has_health: false` show no heart regardless of HP.
- **Elimination overlay**: full-screen element shown to the local player when their HP reaches zero.

All HUD elements respect device safe areas (notches, home indicators).
