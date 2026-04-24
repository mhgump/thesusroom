# Client HUD — Assumptions

- The joystick pad size is responsive (`clamp(120px, 20vw, 220px)`); the maximum knob displacement from centre is computed dynamically each time the pad is measured: `maxDist = padWidth * (1 − KNOB_FRACTION) / 2`, where `KNOB_FRACTION = 50 / 120`. Hard-coding 35 px would be wrong on any device that scales the pad past 120 px.
- Notification default duration is exactly `2000 ms` (`addNotification(message, durationMs = 2000)`). Instruction messages delivered via the Rule UX do not use notifications — they surface as a rule popup converted by `useWebSocket.ts`.
- The joystick knob position is updated via direct DOM mutation on every pointer/touch move event, not via React state, to avoid triggering re-renders at 60 Hz.
- `RuleLabel` has exactly three valid values: `'RULE'`, `'COMMAND'`, `'FACT'`. Instruction messages from the server are displayed using the label supplied by the instruction spec (typically `RULE`, `COMMAND`, or `FACT`).
- The rule popup is a dark-backdrop modal rendered at `z-index: 200`. Each card uses one of five fixed background colours cycling by card index. The close button is one interactive affordance; any keypress or backdrop click also dismisses.
- The loading overlay is owned by `App.tsx` (not `HUD.tsx`). It sits at `z-index: 1000` and fades out (`opacity` + `transition: 0.5s ease`) instead of unmounting, so the DOM tree beneath the Canvas is not disturbed once rendering begins.
