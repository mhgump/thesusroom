# Demo Scenarios — Spec

## Scenario 1: Find Your Circle

- The room contains four numbered, color-coded vote circles arranged in a horizontal row near one wall.
- All four vote circles are active from the moment the first player joins.
- When a player joins, they receive a "Find your circle" command instruction.
- The room accepts at most 4 players; once 4 are connected, no new players may join.
- The walls around each circle remain hidden until every circle contains exactly one player at the same moment.
- The moment every circle simultaneously holds exactly one player, walls materialize around all four circles, enclosing each player inside their chosen circle.
- When the walls appear, all connected players receive a "Vote called!" command instruction.
- After the walls appear, each player can only move within their enclosure and the narrow corridors between enclosures; the open floor that was previously accessible is no longer traversable.

## Scenario 2: Find Your Partner

- The room contains four labeled, color-coded vote circles arranged in a 2×2 grid.
- When a player joins, all four circles become active and the player receives a "Find your partner" command instruction.
- The room accepts at most 8 players; once 8 are connected, no new players may join.
- When the room fills, a countdown begins. After 20 seconds, all players receive a "10 seconds to vote!" command instruction.
- Ten seconds after that warning, vote assignments are resolved.
- Players are paired in the order they joined: the first to join is paired with the second, the third with the fourth, and so on.
- A pair survives if both players are standing inside the same vote circle at resolution time.
- A pair is eliminated — both players removed simultaneously — if the two players are in different circles, or if either player is in no circle at resolution time.

## Scenario 3: Buttons

- The room contains two pressable buttons: a red button on the left and a blue button on the right.
- The red button fires when one player steps onto its trigger area; pressing it sends a "Left pressed" notification to all players.
- The blue button fires when two players simultaneously occupy its trigger area; pressing it sends a "Right pressed" notification to all players.
- Both buttons reset immediately once the required occupants step off; neither button holds its pressed state or enforces a cooldown.
- When exactly one player stands on the blue button's trigger area, the button platform visually depresses as client-side tactile feedback, even though the server has not yet registered a press.
- When zero or two or more players stand on the blue button's trigger area, that solo tactile feedback is suppressed.
