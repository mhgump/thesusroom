# UX — Spec

- The player moves their character continuously in any direction by holding the joystick; releasing stops movement.
- The player performs a game action by tapping an action button; one action fires per press, holding does not repeat.
- The player's character transitions between idle and walking states as the joystick is held past or released below a small dead-zone threshold.
- When a touch occurs from the local player's own move, a notification appears immediately.
- When a touch occurs from another player's move, the notification appears with a short delay, coinciding with when that player's movement becomes visible.
- The game is not interactive while the scene is initialising; a loading indicator is shown.
- The game becomes interactive once the scene has rendered its first frame.
- The player can always see their current connection status.
- At zero health, the local player sees an elimination overlay; movement input is disabled and the joystick no longer responds to touch or mouse events.
- The joystick accepts touch input on mobile and mouse input on desktop.
