# Client HUD — Assumptions

- The joystick pad is 120 px across with a 50 px knob; the maximum knob displacement from centre is 35 px.
- The default action button background colour (for names absent from `ACTION_PALETTE`) is `rgba(255,255,255,0.2)`.
- Notification expiry is exactly `Date.now() + 2000 ms`. Instruction messages delivered via the Rule UX do not use notifications.
- The joystick knob position is updated via direct DOM mutation on every pointer/touch move event, not via React state, to avoid triggering re-renders at 60 Hz.
- `RuleLabel` has exactly three valid values: `'RULE'`, `'COMMAND'`, `'FACT'`. Instruction messages from the server are displayed as `COMMAND`-labelled rule cards.
- The rule popup is a dark-backdrop modal rendered at `z-index: 200`. Each card uses one of five fixed background colours cycling by card index. The dismiss button is the only interactive element inside the overlay.
