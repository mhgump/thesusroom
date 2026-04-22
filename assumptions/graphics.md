# Graphics — Assumptions

- The 12-colour player palette (in assignment-priority order): `#e74c3c`, `#2ecc71`, `#3498db`, `#f1c40f`, `#9b59b6`, `#e67e22`, `#1abc9c`, `#e91e63`, `#00bcd4`, `#8bc34a`, `#ff5722`, `#795548`.
- NPCs are assigned the fixed colour `#888888` and do not participate in the hue-distance palette rotation.
- The half-heart overlay uses an SVG `clipPath` to mask the right half of a full-heart shape; IDs are generated with React's `useId()` per instance to prevent multiple hearts sharing the same clip region.
