# Table Page

- Render condition: `App` shows the table shell when `activeRoom` exists, and `BlowCowBoard` renders this page when the in-room match state is active or finished.
- `App` provides `table-shell`; `BlowCowBoard` renders the live board inside it after the staging screen has been started by the host.
- Layout order: board hero, player info area, then the bottom play strip.

## Layout Tree

```text
main.app-shell.table-mode
  section.table-shell
    div.loading-card?
    section.table-board.game-board-layout
      div.endgame-overlay?
      div.character-card-overlay?
      div.board-error-toast?
      div.front-card-entry-layer?
      div.punishment-move-layer?
      div.board-hero
      div.player-info-layout
        section.game-table-shell
          div.character-strip-panel?
            div.character-strip?
        button.turn-direction-indicator
      section.bottom-play-strip
        div.hand-stage
          div.hand-scroll-viewport
            div.hand-scroll-animation-layer?
            div.hand-scroll-row
        aside.action-stage
          div.match-announcement.action-stage-announcement-overlay?
```

## UI Elements

| Alias | Primary HTML element | Main class / hook | Purpose | Relationship |
| --- | --- | --- | --- | --- |
| Table Page Shell | `main` | `app-shell table-mode` | Root in-room page container. | Parent of Table Shell. |
| Table Shell | `section` | `table-shell` | Frame for the boardgame.io client output, with a pronounced round-tinted ambient shell glow. | Parent of Loading Card or Board Root. |
| Loading Card | `div` | `loading-card` | Temporary loading state before the board is ready. | Conditional inside Table Shell. |
| Board Root | `section` | `table-board game-board-layout` | Main live-match surface. | Parent of all board content and overlays. |
| Endgame Overlay | `div` | `endgame-overlay` | Covers the board when the match is over. | Conditional child of Board Root. |
| Character Card Overlay | `div` | `character-card-overlay` | Enlarges the selected character card so the sprite text is readable. | Conditional child of Board Root. |
| Character Card Overlay Panel | `section` | `character-card-overlay-panel` | Holds the enlarged character card and close action. | Child of Character Card Overlay. |
| Endgame Panel | `section` | `endgame-panel` | Holds the winner summary, leave action, and results. | Child of Endgame Overlay. |
| Endgame Results Table | `table` | `endgame-table` | Lists final placement and match stats. | Main content in Endgame Panel. |
| Endgame Chart Panel | `section` | `endgame-chart-panel` | Holds the postgame hand-count chart and legend. | Rendered under Endgame Results Table inside Endgame Panel. |
| Endgame Chart | `svg` | `endgame-chart` | Shows each player's cards-in-hand line over the full match timeline. | Inside Endgame Chart Panel. |
| Endgame Chart Legend | `div` | `endgame-chart-legend` | Labels each player line and the final hand count at match end. | Below Endgame Chart inside Endgame Chart Panel. |
| Board Error Toast | `div` | `board-error-toast`, `error-banner` | Shows in-room sync or room errors. | Conditional overlay inside Board Root. |
| Front Card Entry Layer | `div` | `front-card-entry-layer` | Hosts animated card travel when a player's front-card row gains new cards. | Conditional overlay inside Board Root. |
| Front Card Entry Card | `div` | `front-card-entry-card` | Animates one newly added front card from that player's Hand Count Pill into the Front Card Row. | Repeated inside Front Card Entry Layer. |
| Punishment Move Layer | `div` | `punishment-move-layer` | Hosts animated table-card travel during BS punishment, all-pass returns, and Reset gather/deal sequences. | Conditional overlay inside Board Root. |
| Punishment Move Card | `div` | `punishment-move-card` | Animates one table card toward its current travel target during a BS, all-pass return, or Reset gather/deal sequence. | Repeated inside Punishment Move Layer. |
| Board Hero | `div` | `board-hero` | Holds room identity and top-level room actions. | First section inside Board Root. |
| Live Match Copy Block | `div` | `board-hero-copy-wrap` | Holds the `Live match` title, room-code tooltip, and copy action. | Left side of Board Hero. |
| Live Match Info Icon | `span` | `inline-info-trigger`, `inline-info-icon` | Shows the room code in a tooltip. | Beside the `Live match` title. |
| Copy Room Code Button | `button` | `inline-icon-button`, `copy-room-button` | Copies the room code to the clipboard. | Beside the `Live match` title. |
| Board Hero Actions | `div` | `board-hero-actions` | Holds socket state, server state, and leave-room action. | Right side of Board Hero. |
| Socket Status Pill | `span` | `status-pill` | Shows live socket connection state. | Inside Board Hero Actions. |
| Server Status Pill | `span` | `status-pill` | Shows server availability state. | Inside Board Hero Actions. |
| Leave Room Button | `button` | `secondary-button` | Leaves the room and returns to the lobby. | Final action in Board Hero Actions. |
| Player Info Layout | `div` | `player-info-layout` | Places the player info panel beside the direction indicator. | Middle board section. |
| Player Info Panel | `section` | `game-table-shell` | Holds the history area and player table. | Main panel in Player Info Layout. |
| Player Info Header | `div` | `table-board-header game-table-header` | Holds the title, table-status tooltip, history toggle, and trump badge. | First row of Player Info Panel. |
| Player Info Info Icon | `span` | `inline-info-trigger`, `inline-info-icon` | Shows `G.tableStatus` in a tooltip. | Beside the `Player Info` title. |
| History Toggle | `button` | `subtle-button history-toggle` | Opens or closes the history panel. | In Player Info Header. |
| History Count Pill | `span` | `history-count-pill` | Shows the number of history items. | Child of History Toggle. |
| Character Strip Toggle | `button` | `subtle-button character-strip-toggle` | Expands or hides the strip to save vertical space. | In Player Info Header actions beside History Toggle when character cards are enabled. |
| Trump Rank Badge | `div` | `trump-rank-inline` | Shows the selected or active trump rank. | In Player Info Header. |
| Character Strip Panel | `div` | `character-strip-panel` | Shows the public character cards assigned to each player when character cards are enabled. | Between Player Info Header and History Panel. |
| Character Strip | `div` | `character-strip` | Holds the scrollable row of public character cards. | Main content inside Character Strip Panel. |
| Character Card Item | `article` | `character-card-item` | Shows one player's public character card plus the external player label. | Repeated inside Character Strip. |
| Character Card Player Label | `div` | `character-card-player` | Shows the player name and seat label above the character art. | First block inside Character Card Item. |
| Character Card Trigger | `button` | `character-card-trigger` | Opens the enlarged character-card overlay. | Wraps Character Card Image inside Character Card Item. |
| Character Card Image | `img` | `character-card-image` | Shows the character card sprite. | Inside Character Card Trigger. |
| History Panel | `div` | `history-panel` | Shows the event log when open. | Conditional between the header and player table. |
| History Entry | `article` | `history-entry` | Shows one logged event. | Repeated inside History Panel. |
| Player Table Wrap | `div` | `player-table-wrap` | Enables horizontal scroll for the player table. | Wraps Player Table. |
| Hand Scroll Viewport | `div` | `hand-scroll-viewport` | Provides a non-clipping positioning layer for hand add/remove animations around the hand scroller. | Wraps the Hand Animation Layer and Hand Scroll Row. |
| Player Table | `table` | `player-table` | Shows one row per seat with points, hand count, and front cards. | Main data view in Player Info Panel. |
| Table Header Info Icon | `span` | `inline-info-trigger`, `inline-info-icon` | Shows tooltip help for `Player` and `Cards In Front`. | Nested in table headers. |
| Player Row | `tr` | `current-player-row`, `grandmaster-targetable-row`, `target-player-row`, `viewing-player-row` | Shows one seat with current-turn, target, and viewing-player states, and can become a click target for Grandmaster BS selection. | Repeated inside Player Table. |
| Player Identity Cell | `td` | `player-row-main`, `player-row-meta` | Shows the player name and seat/state tags. | First column of Player Row. |
| Player Action Callout | `span` | `player-play-callout` | Briefly shows the spoken claim or action line, such as `Two Kings`, `BS!`, `Reset!`, or `Pass`. | Overlays the full Player Identity Cell content for the player who just acted. |
| Player Name Anchor | `strong` | `data-punishment-target-name` | Displays the player name and anchors punishment-card travel. | Inside Player Identity Cell. |
| Seat / State Tag | `span` | `seat-tag` | Shows seat number or player state labels. | Repeated inside Player Identity Cell. |
| Points Pill | `span` | `hand-count-pill points-pill` | Shows the point total with scored ranks in a tooltip. | Inside the Points column; briefly pulses when that player gains a point. |
| Hand Count Pill | `span` | `hand-count-pill` | Shows cards remaining in hand. | Inside the Cards In Hand column. |
| Front Card Row | `div` | `front-card-row` | Shows the front-card stack for a seat in its natural table order. | Inside the Cards In Front column. |
| Front Card | `div` | `front-card` | Shows one visible or hidden front card and, during The Cat's turn, lets the active Cat player click any face-up table card to flip it face down. | Repeated inside Front Card Row. |
| Direction Indicator | `button` | `turn-direction-indicator` | Shows current table direction and becomes a clickable direction toggle for The Contrarian on that player's turn. | Side rail in Player Info Layout. |
| Bottom Play Strip | `section` | `bottom-play-strip` | Holds the hand panel and action panel. | Below Player Info Layout. |
| Hand Stage | `div` | `hand-stage` | Shows the local hand or spectator hand state. | Left side of Bottom Play Strip; briefly flashes red when the viewing player is punished. |
| Hand Stage Header | `div` | `table-board-header hand-stage-header` | Holds the hand title and tools. | First row of Hand Stage. |
| Hand Tools | `div` | `hand-stage-tools` | Shows selection count, sort label, and clear action. | In Hand Stage Header. |
| Hand Scroll Row | `div` | `hand-scroll-row` | Holds the local hand cards. | Main content area of Hand Stage. |
| Hand Animation Layer | `div` | `hand-scroll-animation-layer` | Temporarily shows departing hand cards during add/remove motion cues. | Conditional overlay inside Hand Scroll Viewport. |
| Hand Card Button | `button` | `hand-card-button` | Selects or deselects a card from hand. | Repeated inside Hand Scroll Row. |
| Hand Motion Card | `div` | `hand-motion-card` | Temporarily animates a card that just left the local hand area. | Repeated inside Hand Animation Layer. |
| Action Stage | `aside` | `action-stage` | Holds the legal move buttons. | Right side of Bottom Play Strip; briefly flashes red when the viewing player is punished. |
| Announcement Overlay | `div` | `match-announcement action-stage-announcement-overlay` | Shows staged BS or Reset announcements over the action panel. | Conditional child of Action Stage. |
| Action Stage Header | `div` | `action-stage-header` | Labels the action area. | First row of Action Stage. |
| Action Button List | `div` | `action-button-list` | Holds all visible action items. | Main content area of Action Stage. |
| Action Button Item | `div` | `action-button-item`, `trump-action-item`, `drunkard-random-item`, `foreigner-pass-item` | Wraps one action button and its tooltip; may also hold the inline trump selector, the Drunkard random-play selector, or the Foreigner pass selector. | Repeated inside Action Button List. |
| Trump Action Combo | `div` | `trump-action-combo` | Places the trump selector beside `Select Trump + Play`. | Used only for the select-trump action. |
| Trump Select | `select` | `trump-select`, `trump-action-select` | Chooses a trump rank before the opening play. | Inside Trump Action Combo. |
| Drunkard Random Combo | `div` | `drunkard-random-combo` | Places the Drunkard selectors beside `Play Random`. | Used only for the Drunkard random-play action. |
| Drunkard Random Select | `select` | `drunkard-random-select` | Chooses how many random cards The Drunkard should play. | Inside Drunkard Random Combo. |
| Foreigner Pass Combo | `div` | `foreigner-pass-combo` | Places the outside-card selector beside `Pass` for The Foreigner. | Used only for the Foreigner pass action. |
| Foreigner Pass Select | `select` | `foreigner-pass-select` | Chooses the outside card, Joker, or `None` before the Foreigner passes. | Inside Foreigner Pass Combo. |
| Action Button | `button` | `action-button` | Executes one move such as play, pass, BS, En Passant, or reset. | Main control inside Action Button Item. |
| Action Tooltip | `div` | `action-button-tooltip` | Explains the action or why it is disabled. | Paired with an Action Button Item. |

## Notes

- `board-error-toast`, `punishment-move-layer`, and `endgame-overlay` are board-level overlays.
- `character-card-overlay` is another board-level overlay and closes on backdrop click, close button, or `Escape`.
- `endgame-chart-panel` is populated from authoritative game telemetry stored in `G.telemetry.events`, not from ad hoc client-side reconstruction.
- `front-card-entry-layer` briefly animates new front cards from the owning row's Hand Count Pill into the Front Card Row.
- Reset now reveals hidden table cards, gathers the table into a shared pile, flips and shuffles that pile face down, then deals it back out across the active seats before the round advances.
- `front-card-row` keeps cards in their natural table order; face-up cards are not regrouped ahead of face-down cards.
- `character-strip-panel` is public to everyone during the match, but only renders when character cards are enabled for that room.
- `character-strip-toggle` lives in the Player Info header actions and can collapse the strip while keeping the count summary visible in the panel.
- Character descriptions are not repeated in separate text because they already exist inside the character card sprites.
- When the viewing player is The Cat and it is their turn, any face-up `front-card` becomes a click target that flips back face down for everyone without changing gameplay legality.
- When the viewing player is The Drunkard, the action strip can show a `Play Random` combo with a card-count selector and, before trump is live, the same trump selector used by the normal opening play.
- When the viewing player is The Foreigner, the `Pass` action can expose an inline selector for choosing an outside card, a Joker, or `None` before sending the pass move.
- When the viewing player is The Grandmaster and it is their turn, any `Player Row` with a hidden play becomes a click target that sets the BS target for `Call BS`.
- When the viewing player is The Pawn and it is their turn, the action strip can show `En Passant`, which calls BS on the hidden play immediately before the latest non-passing player's 2-card play.
- When the viewing player is The Contrarian and it is their turn, `turn-direction-indicator` becomes a hover-highlighted button that flips the current direction with an animated arrow turn.
- When the viewing player is The Dreamer and it is their turn, `turn-direction-indicator` also becomes clickable; changing direction counts as a Dreamer cheat if the turn ends with a different direction than it started, and BS can catch that hidden-play cheat.
- `action-stage-announcement-overlay` stays inside `action-stage`, so announcements do not change the board layout.
- `table-shell` keeps a persistent ambient tint and noise layer that changes to a different random palette at the start of each new round.
- When the viewing player is punished, the red flash is shown on `hand-stage` and `action-stage` instead of the whole board background.
- Punishment cards always animate toward `data-punishment-target-name` in the player table.
- The player-table callout is driven by the latest qualifying player action and fades out automatically after a short moment.
- The room code lives behind the info icon beside `Live match`, and the adjacent button copies it.
- Only one primary manual-play button is shown at a time: `Select Trump + Play` before trump is live, then `Play` afterward. The Drunkard may also see `Play Random` as a separate action.
- Table status and scored ranks are exposed through tooltips, not separate rows or banners.