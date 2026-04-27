# Documentation Guidelines

## Structure

Documentation lives in the `spec/` directory. Each file covers one component.

### `spec/`
**What the system must do.** Written as a bulleted list of concise, precise statements. Each bullet describes one observable behavior, user experience, or system-level contract.

- Write in present tense: "The player receives…", "The server refuses…".
- State the behavior, not the mechanism. No file names, class names, or implementation details.
- If a behavior is conditional, state the condition explicitly: "At zero health, the local player sees…".
- Every bullet should be verifiable: a reader should be able to say whether it is satisfied or violated just by observing the running system.

---

## Components

Each component covers a distinct concern. Do not write the same fact in two components.

### `ux`
Player interactions and feedback: what the player can do and experience.
- Covers: movement, action input, touch notification timing, loading/ready transition, elimination state.
- Does not cover: HUD element appearance (→ `client-hud`), game rules (→ `game`), entity visuals (→ `graphics`).

### `client-hud`
Catalog of HUD elements: what can appear on the overlay, their layout, and their appearance.
- Covers: loading overlay, status bar, joystick pad, action buttons, notification pills, HP hearts, elimination overlay.
- Does not cover: what triggers an element to appear (→ `ux` or `game`), how world-space positions project to screen (→ `graphics`).

### `game`
Game mechanics: move physics, world events, HP/damage, per-player actions.
- Covers: touched event rules, HP system, elimination, per-player action management.
- Does not cover: how events travel over the network (→ `server-client`), entity visuals (→ `graphics`).

### `graphics`
3D entity visual representation: player shape, colour, and animation.
- Covers: capsule mesh, assigned colour, idle vs. walking appearance, blink animation, HP heart rendering mechanics.
- Does not cover: HUD element catalog (→ `client-hud`), HP rules (→ `game`).

### `scene`
3D world geometry: rooms, connections, camera, barriers, floor textures.
- Covers: room layout, BFS positioning, walkable area physics, camera constraint polygon, barrier segmentation.
- Does not cover: entity rendering (→ `graphics`), move physics constants (→ `game`).

### `server-client`
Network protocol and synchronization: messages, sequencing, prediction, remote interpolation.
- Covers: move/ack protocol, server time estimation, position buffering, 250 ms delay, connection flow.
- Does not cover: what game events mean (→ `game`, `graphics`), world geometry (→ `scene`).

### `npc`
NPC framework: entity registration, tick triggers, context API, action/helper system.
- Covers: NPC identity, trigger types, `allowedActions`/`allowedHelpers`, event emission, UX flags.
- Does not cover: game damage rules (→ `game`).

### `game_script`
Game script framework: one script per world, vote regions, instruction events, callbacks.
- Covers: `GameScript` interface, `GameScriptContext` API, vote region tracking, instruction delivery, `after` timer, `onVoteChanged` callback, `ToggleVoteRegionOn/Off` and `InstructionEvent` event types, `GameSpec` structure.
- Does not cover: player elimination mechanics (→ `game`), network delivery of instruction messages (→ `server-client`).

Concrete world and scenario configurations (the demo room, individual scenarios, specific NPC placements, vote region coordinates, script parameters) are not documented — they live in the `content/` directory and speak for themselves.

---

## When to Update Documentation

Update the spec whenever the code changes in a way that affects observable behavior. The test: if a developer read the old spec and wrote code to match it, would their code be wrong?

A spec change is warranted when the user-observable behavior changes — a new element can appear on the HUD, an event fires under different conditions, a message was added or removed.

Do not update documentation for internal refactors that preserve all observable behavior.

---

## Adding a New Component

1. Decide which of the existing components the new feature belongs to. Prefer extending an existing component over creating a new one.
2. If a new component is genuinely warranted, add an entry to `spec/`.
3. Add the component to the **Components** section above with a one-line description and explicit "does not cover" exclusions to prevent future overlap.
