# Client HUD — Spec

The following elements can appear on the HUD overlay:

- **Loading overlay**: full-screen; present while the scene initialises; disappears once the scene is ready.
- **Status bar**: top-right corner; contains a connection indicator dot and the current room name.
- **Settings button**: top-right corner, below the status bar; opens a settings panel.
- **Rules button**: top-right corner; shown only when at least one active rule is known; opens the rules panel.
- **Joystick pad**: fixed in the bottom-left corner; a circular pad with a movable knob; the knob tracks the input position clamped to the pad radius; returns to centre when input is released.
- **Notification pills**: small pills in a stacking column near the top-centre; each expires and disappears automatically; non-interactive.
- **HP heart overlays**: one per visible player, rendered in the 3D scene at the player's position. Full health (2) shows a full heart; half health (1) shows a half heart; zero health (0) shows no heart. NPCs with `has_health: false` show no heart regardless of HP.
- **Elimination overlay**: full-screen element shown to the local player when their HP reaches zero; renders above all other HUD elements; dismisses any active rule or choice popup on appearance.
- **Rule popup**: full-screen modal overlay showing one or more rule cards stacked vertically. Each card displays the rule text on the left and a small category label (`RULE`, `COMMAND`, or `FACT`) on the right, laid out side by side. The player dismisses the popup by tapping or clicking anywhere on the screen, by pressing the close button, or by pressing any key. At most one rule popup is visible at a time. Does not appear after the local player is eliminated.
- **Rules panel**: full-screen modal grid of all active rule texts (no labels); dismissed by tapping anywhere or pressing any key.
- **Settings panel**: modal overlay with sound toggle, input-mode selection (joystick / tap-to-move), and a respawn option; dismissed by tapping outside or pressing Escape.
- **Choice popup**: full-screen modal showing a row of option cards for a server-issued choice; selecting an option sends the choice back to the server and dismisses the popup.

All HUD elements respect device safe areas (notches, home indicators).
