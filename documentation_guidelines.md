# Documentation Guidelines

## Structure

Documentation lives in three directories. Each directory contains one file per component.

### `spec/`
**What the system must do.** Written as a bulleted list of concise, precise statements. Each bullet describes one observable behavior, user experience, or system-level contract.

- Write in present tense: "The player receives…", "The server refuses…".
- State the behavior, not the mechanism. No file names, class names, or implementation details.
- If a behavior is conditional, state the condition explicitly: "At zero health, the local player sees…".
- Every bullet should be verifiable: a reader should be able to say whether it is satisfied or violated just by observing the running system.

### `assumptions/`
**Concrete facts about the current implementation that are not derivable from the spec alone**, but are necessary to reproduce identical behavior. Written as a bulleted list.

- Only include facts that are both non-obvious and load-bearing. If the value could be anything reasonable and the spec would still be satisfied, it belongs here.
- Be fully precise: exact numbers, exact string values, exact data structure choices.
- A good assumption is one where knowing it prevents a subtle bug or a behavioral divergence. If it wouldn't cause a problem to get it wrong, it's not an assumption worth recording.

### `implementation/`
**How the current implementation achieves the spec.** Written as organized markdown with sections and file references.

- Always name the files involved. A reader should be able to find every relevant file directly from this document.
- Explain the approach and any non-obvious design decisions. Do not re-state the spec.
- Include enough detail that a developer can understand correctness: what invariants hold, what order things run in, what would break if the design changed.
- Do not document things that are obvious from reading the code.

---

## The Three-Way Split in Practice

The same feature will often have entries in all three layers. Here are examples showing how to split correctly.

**Example: touch detection**
- Spec: "A `touched` event fires when two players' capsules first overlap during a move (leading edge only)."
- Assumption: "The `touched` world event fires only on first contact; an NPC that needs to re-detect contact after separation must track its own per-player contact state."
- Implementation: "Touch pairs are tracked in a `Set` with canonical keys (`smallerId:largerId`) in `World.ts`. A pair is cleared only when `setPlayerPosition` is called for either player."

**Example: heart display**
- Spec: "Full health (2) shows a full heart; half health (1) shows a half heart; zero health (0) shows no heart."  *(in `client-hud`)*
- Assumption: "The half-heart uses an SVG `clipPath` to mask the right half of a full-heart shape; IDs are generated with `useId()` per instance to prevent multiple hearts sharing the same clip region."  *(in `graphics`)*
- Implementation: "Heart overlays are HTML `<div>`s outside the Canvas, registered in `hudRegistry`. Position is written as a CSS `transform` each frame after camera projection in `PlayerHudOverlay.tsx`."  *(in `graphics`)*

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
- Does not cover: specific NPC behavior in the demo world (→ `demo_world`), game damage rules (→ `game`).

### `demo_world` *(assumptions only)*
Concrete configuration of the default world: room dimensions, connections, NPC specs, routing policy.
- Covers: Room 1/2/3 sizes, door widths, StillDamager behavior, player spawn point, world routing.
- Has no `spec/` or `implementation/` counterpart; all content lives in `assumptions/demo_world.md`.

---

## When to Update Documentation

Update documentation whenever the code changes in a way that affects observable behavior, concrete values, or the implementation approach. The test: if a developer read the old doc and wrote code to match it, would their code be wrong?

- **Spec change**: the user-observable behavior changed — a new element can appear on the HUD, an event fires under different conditions, a message was added or removed.
- **Assumption change**: a concrete value changed (a threshold, a color, a buffer size), a data structure choice changed, an edge-case rule changed.
- **Implementation change**: a significant refactor — files renamed or restructured, a new caching strategy, a change to execution order or component lifecycle.

Do not update documentation for internal refactors that preserve all observable behavior and all concrete values.

---

## Adding a New Component

1. Decide which of the existing components the new feature belongs to. Prefer extending an existing component over creating a new one.
2. If a new component is genuinely warranted, add entries to all three directories (`spec/`, `assumptions/`, `implementation/`) unless one layer has nothing to say.
3. Add the component to the **Components** section above with a one-line description and explicit "does not cover" exclusions to prevent future overlap.
