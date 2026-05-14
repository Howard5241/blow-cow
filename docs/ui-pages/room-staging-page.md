# Room Staging Page

- Render condition: `App` shows the in-room shell when `activeRoom` exists, and `BlowCowBoard` renders this page while `G.gameStatus` is `staging`.
- Layout order: board hero, staging hero, then the two-panel staging grid.

## Layout Tree

```text
main.app-shell.table-mode
  section.table-shell
    div.loading-card?
    section.table-board.game-board-layout
      div.board-error-toast?
      div.board-hero
      section.room-staging-shell
        div.room-staging-hero
        div.room-staging-grid
          article.room-staging-panel   (roster)
          article.room-staging-panel   (settings + start control)
```

## UI Elements

| Alias | Primary HTML element | Main class / hook | Purpose | Relationship |
| --- | --- | --- | --- | --- |
| Room Staging Shell | `section` | `room-staging-shell` | Holds the in-room waiting experience before cards are dealt. | Main content below Board Hero. |
| Room Staging Hero | `div` | `room-staging-hero` | Explains the pregame state and reminds players that seats will be randomized on start. | First section inside Room Staging Shell. |
| Joined Count Pill | `span` | `room-count` | Shows how many seats are filled. | Inside Room Staging Hero. |
| Room Full Pill | `span` | `status-pill` | Shows whether the room is still waiting for players or is full. | Inside Room Staging Hero. |
| Room Staging Grid | `div` | `room-staging-grid` | Splits roster and match settings/start controls into two panels. | Main grid inside Room Staging Shell. |
| Roster Panel | `article` | `room-staging-panel` | Shows every room slot, including open seats and the host badge. | Left panel of Room Staging Grid. |
| Room Slot Row | `div` | `room-staging-seat` | Shows one room slot before final seats are randomized. | Repeated inside Roster Panel. |
| Room Slot Badge Row | `div` | `room-staging-seat-badges` | Shows host and connection or waiting badges for a slot. | Right side of Room Slot Row. |
| Settings Panel | `article` | `room-staging-panel` | Summarizes speed, character-card mode, deck mode, and host start status. | Right panel of Room Staging Grid. |
| Setting Row | `div` | `room-staging-setting-row` | Shows one match setting summary line. | Repeated inside Settings Panel. |
| Staging Status Copy | `p` | `room-staging-status-copy` | Explains whether the room is waiting for players or for the host to start. | Above the host action. |
| Start Game Button | `button` | `primary-button` | Starts the match for everyone when the host is present and the room is full. | Host-only action inside Settings Panel. |
| Waiting For Host Badge | `span` | `panel-badge` | Replaces the start button for non-host players. | Non-host action area inside Settings Panel. |

## Notes

- No cards are dealt while this page is visible.
- The host is the player who created the room.
- Character cards can be enabled or disabled only through the lobby create-room form; this page shows the chosen setting.
- When the host starts the match, all players are shuffled into random seats and the first shuffled seat becomes the starting player.
- This page still uses the same in-room `board-hero` actions for copying the room code and leaving the room.