# Client HUD — Assumptions

- The joystick pad is 120 px across with a 50 px knob; the maximum knob displacement from centre is 35 px.
- The `SKIP` action button background colour is `rgba(0,200,200,0.65)`; any action name not present in `ACTION_PALETTE` falls back to `rgba(255,255,255,0.2)`.
- Notification expiry is exactly `Date.now() + 2000 ms`.
- The joystick knob position is updated via direct DOM mutation on every pointer/touch move event, not via React state, to avoid triggering re-renders at 60 Hz.
