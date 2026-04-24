# UX — Spec

- The player moves their character continuously in any direction by holding the joystick; releasing stops movement.
- The player's character transitions between idle and walking states as the joystick is held past or released below a small dead-zone threshold.
- The game is not interactive while the scene is initialising; a loading indicator is shown.
- The game becomes interactive once the scene has rendered its first frame.
- Once the loading indicator has dismissed and the WebSocket connection has delivered the welcome message, the client signals ready to the server once per session. This signal is what lets scenarios gate their main sequence on "all players loaded".
- The player can always see their current connection status.
- At zero health, the local player sees an elimination overlay; movement input is disabled and the joystick no longer responds to touch or mouse events.
- At the moment of elimination, any open instruction or rule popup is immediately dismissed. No new popups or notifications appear after elimination.
- The joystick accepts touch input on mobile and mouse input on desktop.
