# Lobby Page

- Render condition: `App` shows this page when `activeRoom` is `null`.
- Successful create or join moves the user to the Room Staging Page.
- Layout order: hero, page status, then the two-panel lobby grid.

## Layout Tree

```text
main.app-shell
  section.hero-panel
    p.eyebrow
    div.hero-header
      div
        h1
        p.hero-copy
      span.status-pill
  section.status-banner
  p.error-banner?
  section.lobby-grid
    article.panel.stack-gap      (player setup + create room)
    article.panel.stack-gap      (join by code + room list)
  aside.character-preview?             (hovered character's card art)
  div.board-overlay.lobby-overlay?     (house rules editor)
    section.board-overlay-panel.rules-overlay-panel
      div.board-overlay-header
      div.rule-card-grid
        article.rule-card*
          div.rule-card-footer
            div.rule-status-options
      div.rule-card-pager
```

## UI Elements

| Alias | Primary HTML element | Main class / hook | Purpose | Relationship |
| --- | --- | --- | --- | --- |
| App Shell | `main` | `app-shell` | Root lobby container. | Parent of all lobby sections. |
| Hero Panel | `section` | `hero-panel` | Lobby header with title, copy, and server state. | First page section. |
| Hero Eyebrow | `p` | `eyebrow` | Shows `Blow Cow Multiplayer Lobby`. | Child of Hero Panel. |
| Hero Header | `div` | `hero-header` | Groups the heading/copy block and the server status pill. | Main row inside Hero Panel. |
| Server Status Pill | `span` | `status-pill` | Shows lobby availability. | Beside the hero copy. |
| Status Banner | `section` | `status-banner` | Shows the current lobby status message and refresh action. | Between Hero Panel and Lobby Grid. |
| Refresh Rooms Button | `button` | `secondary-button` | Refreshes the open room list. | Action inside Status Banner. |
| Error Banner | `p` | `error-banner` | Shows page-level request or server errors. | Conditional below Status Banner. |
| Lobby Grid | `section` | `lobby-grid` | Splits setup/create and join/browse into two panels. | Main working area. |
| Player Setup Panel | `article` | `panel stack-gap` | Holds the display-name field and create-room form. | Left column of Lobby Grid. |
| Display Name Field | `label` + `input` | `field` | Sets the local player name. | First control in Player Setup Panel. |
| Create Room Form | `form` | `stack-gap` | Groups seats, speed, character-card mode, optional character pool selection, house rules, starting statuses, rank mode, optional manual ranks, and the create action. | Below Display Name Field. |
| Seats Selector | `label` + `select` | `field` | Chooses room size. | First selector in Create Room Form. |
| Game Speed Selector | `label` + `select` | `field` | Chooses the room speed multiplier. | After Seats Selector. |
| Character Cards Group | `fieldset` | `deck-mode-group` | Lets the room creator enable or disable character cards for the match. | After Game Speed Selector. |
| Character Mode Option | `label` + `input[type=radio]` | `deck-mode-option` | Selects `Enabled` or `Disabled` for character cards. | Repeated inside Character Cards Group. |
| Character Pool Panel | `div` | `manual-rank-panel` | Shows the active character-card pool when characters are enabled. | Conditional below Character Cards Group. |
| Character Pool Count | `span` | `rank-selection-count` | Shows how many eligible characters are currently in the pool. | Right side of Character Pool Panel header. |
| Character Chip Grid | `div` | `character-chip-grid` | Holds the character-pool buttons. | Main area inside Character Pool Panel. |
| Character Chip | `button` | `character-chip` | Toggles one implemented character in or out of the pool, and opens the Character Preview on hover or focus. Carries no tooltip of its own. | Repeated inside Character Chip Grid. |
| Character Preview | `aside` | `character-preview` | Shows the hovered or focused character's full-size card art, pinned to the right of the viewport. Animated when that character's art ships more than one frame. | Rendered at the end of App Shell while a chip is hovered or focused. |
| Character Pool Hint | `p` | `character-pool-hint` | Explains why `The Confused` is unavailable without `J` in a manual deck. | Conditional below Character Chip Grid. |
| House Rules Panel | `div` | `manual-rank-panel` | Collapsed entry point for the rule cards. | Below Character Pool Panel, always shown. |
| Changed Rule Count | `span` | `rank-selection-count` | Shows how many rule cards are not `Active`. | Right side of House Rules Panel header. |
| House Rules Summary | `div` | `house-rules-summary` | Names the changed rules, or says every card is active, beside the button that opens the editor. | Body of House Rules Panel. |
| Rule Status Hint | `p` | `rule-status-hint` | Carries the summary text. | Left side of House Rules Summary. |
| Open Rule Cards Button | `button` | `secondary-button` | Opens the House Rules Overlay. | Right side of House Rules Summary. |
| House Rules Overlay | `div` + `section` | `board-overlay lobby-overlay`, `board-overlay-panel rules-overlay-panel` | Centred modal holding the rule-card editor. Closes on Escape, on the Close button, or on a backdrop click. | Rendered at the end of App Shell when open. |
| Rule Card Deck | shared component | `rule-card-grid`, `rule-card-pager` | The same paged deck of illustrated rule cards the in-match Rules panel uses, four to a page. | Body of House Rules Overlay. |
| Rule Status Options | `div` | `rule-status-options` | Groups the status buttons a rule supports. | Footer of each rule card in the deck. |
| Rule Status Option | `button` | `rule-status-option`, `selected` | Selects one status. Only the statuses that rule defines are rendered, so a rule that cannot be removed shows no `Removed` button at all. | Repeated inside Rule Status Options. |
| Initial Statuses Panel | `div` | `manual-rank-panel` | Testing lever that starts every player under the same statuses. Nothing in the game inflicts one yet, so this is the only source. | Below House Rules Panel, always shown. |
| Initial Status Count | `span` | `rank-selection-count` | Shows `n/2 selected`, the per-player cap. | Right side of Initial Statuses Panel header. |
| Status Chip | `button` | `character-chip status-chip` | Toggles one status on or off and shows its sprite beside its name. Unselected chips are disabled once two are picked, so the cap can never be exceeded rather than being silently truncated by the server. Its effect text is carried by the shared Character Chip Tooltip. | Repeated inside the panel's Character Chip Grid. |
| Status Turns Field | `label` + `input[type=number]` | `status-turns-field` | Sets the starting counter shared by every selected status, from 1 to 20. Disabled while nothing is selected. | Below the status chips. |
| Standard Ranks Group | `fieldset` | `deck-mode-group` | Switches between default and manual rank selection. | After Game Speed Selector. |
| Rank Mode Option | `label` + `input[type=radio]` | `deck-mode-option` | Selects `Default` or `Manual` rank mode. | Repeated inside Standard Ranks Group. |
| Rank Mode Tooltip | `span` | `deck-mode-tooltip` | Shows the mode description on hover or focus. | Nested inside each Rank Mode Option. |
| Manual Rank Panel | `div` | `manual-rank-panel` | Shows the manual rank picker when manual mode is active. | Conditional below Standard Ranks Group. |
| Rank Selection Count | `span` | `rank-selection-count` | Shows how many standard ranks are selected. | Right side of Manual Rank Panel header. |
| Rank Chip Grid | `div` | `rank-chip-grid` | Holds the manual rank buttons. | Main area inside Manual Rank Panel. |
| Rank Chip | `button` | `rank-chip` | Toggles one standard rank. | Repeated inside Rank Chip Grid. |
| Create Room Button | `button` | `primary-button` | Creates the room with the selected settings. | Final action in Create Room Form. |
| Join Panel | `article` | `panel stack-gap` | Holds the direct room-code join form and room list. | Right column of Lobby Grid. |
| Room Code Form | `form` | `stack-gap` | Accepts a room code and submits a join request. | First form in Join Panel. |
| Room Code Field | `label` + `input` | `field` | Accepts the match ID to join. | Inside Room Code Form. |
| Join Room Button | `button` | `primary-button` | Joins the typed room code. | Final action in Room Code Form. |
| Room List Header | `div` | `room-list-header` | Labels the open-room list and shows the count. | Above Room List. |
| Room Count Pill | `span` | `room-count` | Shows the number of returned rooms. | Right side of Room List Header. |
| Room List | `div` | `room-list` | Shows the empty state or the room cards. | Main content in Join Panel. |
| Empty Room State | `div` | `empty-room-state` | Shown when there are no open rooms. | Conditional inside Room List. |
| Room Card | `article` | `room-card` | Summarizes one open room. | Repeated inside Room List. |
| Room Card Top | `div` | `room-card-top` | Shows the room code and open-seat count. | First row of Room Card. |
| Room Code Label | `p` + `strong` | `room-label`, `room-id` | Labels and displays the match ID. | Left side of Room Card Top. |
| Open Seats Pill | `span` | `seat-pill` | Shows available seats, or `Game over` in the `finished` variant once the room's match has ended. | Right side of Room Card Top. |
| Seat Row | `div` | `seat-row` | Shows one chip per room seat. | Middle row of Room Card. |
| Seat Chip | `span` | `seat-chip` | Shows a filled, offline, or open seat. | Repeated inside Seat Row. |
| Room Card Footer | `div` | `room-card-footer` | Shows the last update time and the room's actions. | Final row of Room Card. |
| Room Card Actions | `div` | `room-card-actions` | Groups the clear and quick-join buttons so they stay together when the footer stacks. | Right side of Room Card Footer. |
| Clear Room Button | `button` | `subtle-button clear-room-button` | Deletes the room from the lobby. Disabled, with the reason as its tooltip, whenever the room may not be cleared. | First action inside Room Card Actions. |
| Quick Join Button | `button` | `subtle-button` | Joins an open seat or reclaims the matching offline seat represented by the card. | Second action inside Room Card Actions. |

## Notes

- `status-banner` and `error-banner` are page-level state, not panel-local state.
- Create-room order is: seats, game speed, character cards, optional character pool selection, house rules, rank mode, then optional manual rank selection.
- The character pool defaults to all implemented characters and only narrows when the creator deselects specific cards.
- House rules default to every rule card `Active`, and `rules` is omitted from `setupData` entirely while that holds, the same way a full character pool is.
- A rule card only offers the statuses it defines. `removedDescription` and `upgradedDescription` in `src/game/blowCowRules.ts` are what make a variant exist, so an undescribed variant cannot be selected here and cannot reach the server.
- The rule cards live behind a button rather than inline. A dozen-odd illustrated tiles made the left column several screens tall, and the overlay is the same `rules-overlay-panel` the match uses, so a host sees the cards exactly as the players will.
- `Removed` is enforced during the match. `Upgraded` is not yet — the card's `+` title and upgraded description are shown to players, but the game still plays the rule as written, which is what the overlay's subtitle says.
- Character abilities are shown only as card art. The sprites already print each character's name and
  ability, so `src/game/blowCowCharacters.ts` holds no description table and the chips carry no
  tooltip; `Characters.csv` and `RULES.md` are where the wording is authored. The `character card art`
  check in `scripts/check-blowcow-gameplay.ts` is what stops an implemented character shipping with no
  art, which would now leave it with nothing a player can read.
- The preview is `position: fixed` and `pointer-events: none`, so it follows the viewport rather than
  the scroll and never intercepts a click meant for the Join panel it overlaps. It cannot be hovered
  either, which is what stops it holding itself open. Below 980px the lobby is one column, so it
  centres instead of pinning right rather than shrinking into a corner too small to read.
- Each chip clears the preview only when it is still the one showing, because moving between two chips
  fires the new chip's `mouseenter` before the old chip's `mouseleave`.
- A disabled chip fires no pointer events, so `The Confused` has no preview while `J` is out of a
  manual deck. The Character Pool Hint below the grid is what explains it in that state.
- In manual-rank mode, `The Confused` is unavailable until `J` is part of the selected deck.
- Room-code join and quick join both reclaim an offline seat instead of taking a new one when the local display name exactly matches that offline player.
- Offline claimed seats are labeled directly in the room list so players can see when a name-based reclaim is possible.
- A room may be cleared when its game has ended, or while nobody is connected to it. Anything else is
  a table with players at it and is never anyone else's to delete. `getRoomClearBlockReason` in
  `src/lobbyRooms.ts` is the single source of that rule: the button's disabled state and its tooltip
  come from it, and so does the server's 409, so the lobby can never offer a clear that is refused.
- Clearing takes two presses. The first arms that one card's button, which relabels to `Confirm
  Clear`; arming a different room disarms the first. Clearing deletes a stored match with no undo,
  and the room list is a column of near-identical cards.
- Clearing needs no credentials. The rule is about the room's state rather than who is asking, and
  requiring credentials would leave the abandoned rooms nobody can authenticate for as exactly the
  ones nobody can clear.
- A player still sitting on a finished game's results when someone clears that room is returned to
  the Lobby by Leave Room, rather than being told the leave failed.
- The Lobby page is skipped entirely when the browser has a stored seat. `ACTIVE_ROOM_STORAGE_KEY`
  holds the whole seat — match, player, credentials, name — so a reload after a server restart or a
  dropped connection reconnects directly to the table without the room list, the room code, or the
  rejoin route.
- A restored seat is verified once, in the background, while the table is already rendering. It is
  dropped back to the Lobby only when the server positively reports the match gone (404) or the seat
  now carries a different name. An unreachable server is never treated as a missing room, since that
  is the case the restore exists for.