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
            div.room-staging-seat-list
            div.room-staging-bot-bay?  (host only; vanilla classic, or a supported-seat-count Ante)
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
| Roster Panel | `article` | `room-staging-panel` | Shows every room slot, including open seats and the host badge, and holds the Bot Bay beneath them. | Left panel of Room Staging Grid. |
| Bot Bay | `div` | `room-staging-bot-bay` | Host-only. Adds and removes practice bots. Sits inside the Roster Panel because adding a bot fills a seat, which is what the roster shows. | Below Room Slot Rows in Roster Panel. |
| Bot Kind Select | `select` | `text-input` | Chooses which bot to add, from the current mode's roster. Its description updates below. | Inside Bot Bay. |
| Add Bot Button | `button` | `secondary-button` | Joins a bot into an open seat. Disabled while the room is full or a bot request is in flight. | Beside Bot Kind Select. |
| Bot Seat Row | `div` | `room-staging-seat` | One added bot, with its description and a Remove button. | Repeated inside Bot Bay. |
| Bot Block Note | `p` | `room-note` | Replaces the whole control when the room is one bots cannot play, and says what is responsible. | Inside Bot Bay. |
| Room Slot Row | `div` | `room-staging-seat` | Shows one room slot before final seats are randomized. | Repeated inside Roster Panel. |
| Room Slot Badge Row | `div` | `room-staging-seat-badges` | Shows host and connection or waiting badges for a slot. | Right side of Room Slot Row. |
| Settings Panel | `article` | `room-staging-panel` | Summarizes game mode, speed, the mode's own settings, deck mode, and host start status. | Right panel of Room Staging Grid. |
| Setting Row | `div` | `room-staging-setting-row` | Shows one match setting summary line. Mode is always first; then Characters in Classic, or Rounds and Starting Gold in Ante. | Repeated inside Settings Panel. |
| Setting Note | `p` | `room-note room-staging-setting-note` | Spells the deck out: the ranks chosen, the 2 Jokers, and any action ranks the host added. The action-rank sentence is appended only when there are some, so a vanilla room reads exactly as before. An Ante room adds a second note describing the mode. | Below the Setting Rows. |
| Staging Status Copy | `p` | `room-staging-status-copy` | Explains whether the room is waiting for players or for the host to start. | Above the host action. |
| Start Game Button | `button` | `primary-button` | Starts the match for everyone when the host is present and the room is full. | Host-only action inside Settings Panel. |
| Waiting For Host Badge | `span` | `panel-badge` | Replaces the start button for non-host players. | Non-host action area inside Settings Panel. |

## Notes

- No cards are dealt while this page is visible.
- The host is the player who created the room.
- Character cards can be enabled or disabled only through the lobby create-room form; this page shows the chosen setting.
- The game mode is chosen in the lobby and cannot be changed here. An Ante room shows Rounds and
  Starting Gold in place of the Characters row, because Ante seats no characters and that row would
  otherwise read `Disabled` for a setting nobody was offered.
- When the host starts the match, all players are shuffled into random seats and the first shuffled seat becomes the starting player.
- This page still uses the same in-room `board-hero` actions for copying the room code and leaving the room.
- The Bot Bay is host-only, and which rooms it appears in depends on the mode. In **classic** it needs
  a vanilla room: characters off, no action ranks, no starting statuses, and every rule card left
  active. In **Ante** any seat count from 2 to 8 works, on that count's standard deck. Otherwise it renders
  a single note naming what blocked it. Both gates exist for the same reason — a bot that met a rule
  it did not know would issue moves the server refuses, which reads as a frozen table rather than as a
  weak opponent — but they check different things, because the Ante bot is a fixed-width network and
  the table has to be the shape it was trained on. See `src/bots/blowCowBotSeating.ts`.
- **The two modes offer different rosters,** and the Bot Kind Select shows only the current mode's.
  Classic offers the five scripted bots; Ante offers one, `The Student`, which is a trained policy run
  in the browser. Its weights are fetched on demand the first time a room seats one, so a room that
  never adds an Ante bot never downloads them.
- **`The Student` is two policies, and the room's own settings pick which one loads.** Both are
  fixed-width networks, so each exists once per seat count:
  - The **match** policy, when the room is staged at the config it was trained for — **20 rounds and
    5 starting gold**. It reads the round's features plus a match block (gold, standings, and every
    seat's cross-round honesty record), so it can price its last coin and remember who has been caught
    lying in earlier rounds. Shipped from `rl/runs/m-pl3-s3` at five seats, `rl/runs/m2-<n>p`
    elsewhere.
  - The **round** policy otherwise, which plays every round as if it were the only one and cannot see
    gold at all. `rl/runs/ante-s2-long` at five seats, `rl/runs/ante-<n>p-v1` elsewhere.

  The fallback is a real fallback rather than a failure: the round policy is the agent that shipped
  before the match ones and it plays every room legally. It is needed because the match block
  normalises `rounds_left` and every gold column by exactly 20 and 5, so a room staged at any other
  setting would feed that network numbers outside the range it was fitted on. `pickAnteWeights` in
  `src/bots/ante/anteWeights.ts` is where the choice lives, and it mirrors the refusal
  `rl/ante/match_agents.py` makes on the Python side. The decision is read off the match's own staged
  state rather than the lobby, so a rejoin loads the same network the first join did.
- A bot is a real player: it joins the match through the lobby, holds its own seat and credentials,
  and sees only its own `playerView`. It is driven by a headless boardgame.io client running in the
  host's browser tab, so **closing that tab stops the bots playing**, which the panel says. Their
  seats remain and the room survives.
- **The Bot Seat Rows belong to the room being shown, and only to it.** A bot's credentials are valid
  for the match it joined and no other, so leaving a room drops its bots from the list and releases
  their seats; the next room starts with an empty Bot Bay. Without that the rows accumulated a room at
  a time and `Remove` answered `403` on every one of them, since it was addressing the current match
  with a previous match's credentials. Closing the tab is still the other case and still behaves as
  described above — the seats remain and the room survives, because no cleanup runs.
- Bots press their own procedure buttons — Take Turn, the Reveal Rule walk, and the BS and Reset
  reveals they called themselves. Only the caller may drive a reveal walk, so a bot never advances a
  procedure a human started.
