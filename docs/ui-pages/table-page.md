# Table Page

- Render condition: `App` shows the table shell when `activeRoom` exists, and `BlowCowBoard` renders this page when the in-room match state is active or finished.
- `App` provides `table-shell`; `BlowCowBoard` renders the live board inside it after the staging screen has been started by the host.
- Layout order: board hero, player ring with its centre hub, then the bottom play strip.
- Players are arranged around a ring like seats at a real table. The ring is rotated so the viewing player owns the bottom angle, meaning the same physical seat appears at a different angle in each client. That bottom angle is then left empty, because the viewing player's own block is docked in the hand row to save vertical space.

## Layout Tree

```text
main.app-shell.table-mode
  section.table-shell
    div.loading-card?
    section.table-board.game-board-layout
      div.endgame-overlay?
      div.character-card-overlay?
      div.board-overlay.history-overlay?
      div.board-overlay.character-overlay?
      div.board-bs-flash?
      div.match-announcement.board-announcement?
      div.board-error-toast?
      div.front-card-entry-layer?
      div.punishment-move-layer?
      div.board-hero
      div.player-ring
        article.seat-block*
          div.seat-block-top
            img.seat-avatar-image
            button.seat-character-badge?
          div.seat-block-identity
            strong.seat-block-name
            div.seat-block-meta
            span.player-play-callout?
          div.seat-stat-row
            span.seat-stat.seat-stat-hand
            span.seat-stat.seat-stat-points
          div.seat-front-cards
            div.front-card-row?
          div.seat-target-actions?
        div.table-center-hub
          div.trump-rank-inline.hub-trump
          button.turn-direction-indicator
            img.turn-direction-arrow
          div.hub-table-meta
          div.board-fail-message?
      section.bottom-play-strip
        div.hand-stage
          div.hand-play-row
            div.hand-scroll-viewport
              div.hand-scroll-animation-layer?
              div.hand-scroll-row
            article.seat-block.docked-seat?
            div.hand-action-row
              div.action-button-item*
                button.action-button
                  img.action-button-icon?
                  span.action-button-label
```

## UI Elements

| Alias | Primary HTML element | Main class / hook | Purpose | Relationship |
| --- | --- | --- | --- | --- |
| Table Page Shell | `main` | `app-shell table-mode` | Root in-room page container. | Parent of Table Shell. |
| Table Shell | `section` | `table-shell` | Frame for the boardgame.io client output, with a fixed ambient rim glow. | Parent of Loading Card or Board Root. |
| Loading Card | `div` | `loading-card` | Temporary loading state before the board is ready. | Conditional inside Table Shell. |
| Board Root | `section` | `table-board game-board-layout` | Main live-match surface, on a flat mono felt with no accent tint. | Parent of all board content and overlays. |
| Board BS Flash | `div` | `board-bs-flash` | Washes the whole felt red while a BS call resolves, then fades back to the mono background. | Conditional child of Board Root, above the background and below all content. |
| Endgame Overlay | `div` | `endgame-overlay` | Covers the board when the match is over. | Conditional child of Board Root. |
| Endgame Panel | `section` | `endgame-panel` | Holds the winner summary, leave action, and results. | Child of Endgame Overlay. |
| Endgame Results Table | `table` | `endgame-table` | Lists final placement and match stats. | Main content in Endgame Panel. |
| Endgame Chart Panel | `section` | `endgame-chart-panel` | Holds the postgame hand-count chart and legend. | Rendered under Endgame Results Table inside Endgame Panel. |
| Endgame Chart | `svg` | `endgame-chart` | Shows each player's cards-in-hand line over the full match timeline. | Inside Endgame Chart Panel. |
| Endgame Chart Legend | `div` | `endgame-chart-legend` | Labels each player line and the final hand count at match end. | Below Endgame Chart inside Endgame Chart Panel. |
| Character Card Overlay | `div` | `character-card-overlay` | Enlarges one character card so the sprite text is readable. | Conditional child of Board Root; sits above the other overlays. |
| Character Card Overlay Panel | `section` | `character-card-overlay-panel` | Holds the enlarged character card and close action. | Child of Character Card Overlay. |
| Board Overlay | `div` | `board-overlay` | Shared modal backdrop for the History and Character Cards panels. | Conditional child of Board Root. |
| Board Overlay Panel | `section` | `board-overlay-panel` | Shared modal panel shell with a header, subtitle, and close action. | Child of Board Overlay. |
| History Overlay | `section` | `board-overlay-panel history-overlay-panel` | Shows the full event log. | Opened by History Toggle in Board Hero Actions. |
| History Entry | `article` | `history-entry` | Shows one logged event. | Repeated inside History Overlay. |
| Character Strip Overlay | `section` | `board-overlay-panel character-overlay-panel` | Shows every player's public character card. | Opened by Character Strip Toggle in Board Hero Actions. |
| Character Strip | `div` | `character-strip` | Holds the grid of public character cards. | Main content inside Character Strip Overlay. |
| Character Card Item | `article` | `character-card-item` | Shows one player's public character card plus the player label. | Repeated inside Character Strip. |
| Character Card Trigger | `button` | `character-card-trigger` | Opens the enlarged character-card overlay. | Wraps Character Card Image inside Character Card Item. |
| Board Error Toast | `div` | `board-error-toast`, `error-banner` | Shows in-room sync or room errors. | Conditional overlay inside Board Root. |
| Front Card Entry Layer | `div` | `front-card-entry-layer` | Hosts animated card travel when a seat's front-card row gains new cards. | Conditional overlay inside Board Root. |
| Front Card Entry Card | `div` | `front-card-entry-card` | Animates one newly added front card from that seat's Hand Stat Value into its Front Card Row. | Repeated inside Front Card Entry Layer. |
| Punishment Move Layer | `div` | `punishment-move-layer` | Hosts animated table-card travel during BS punishment, all-pass returns, and Reset gather/deal sequences. | Conditional overlay inside Board Root. |
| Punishment Move Card | `div` | `punishment-move-card` | Animates one table card toward its current travel target. | Repeated inside Punishment Move Layer. |
| Board Hero | `div` | `board-hero` | Holds room identity and top-level room actions. | First section inside Board Root. |
| Live Match Copy Block | `div` | `board-hero-copy-wrap` | Holds the `Live match` title, room-code tooltip, and copy action. | Left side of Board Hero. |
| Live Match Info Icon | `span` | `inline-info-trigger`, `inline-info-icon` | Shows the room code in a tooltip. | Beside the `Live match` title. |
| Copy Room Code Button | `button` | `inline-icon-button`, `copy-room-button` | Copies the room code to the clipboard. | Beside the `Live match` title. |
| Board Hero Actions | `div` | `board-hero-actions` | Holds the History and Characters toggles, socket state, server state, and leave-room action. | Right side of Board Hero. |
| History Toggle | `button` | `subtle-button history-toggle` | Opens the History Overlay. | First action in Board Hero Actions during a live match. |
| History Count Pill | `span` | `history-count-pill` | Shows the number of history items. | Child of History Toggle. |
| Character Strip Toggle | `button` | `subtle-button character-strip-toggle` | Opens the Character Strip Overlay. | Beside History Toggle when character cards are enabled. |
| Socket Status Pill | `span` | `status-pill` | Shows live socket connection state. | Inside Board Hero Actions. |
| Server Status Pill | `span` | `status-pill` | Shows server availability state. | Inside Board Hero Actions. |
| Leave Room Button | `button` | `secondary-button` | Leaves the room and returns to the lobby. | Final action in Board Hero Actions. |
| Player Ring | `div` | `player-ring` | Places one Seat Block per seat evenly around an ellipse, and hosts the Table Center Hub. The viewing player's own seat is skipped here and docked in the Hand Play Row instead, leaving the bottom of the ellipse empty. | Middle board section. |
| Seat Block | `article` | `seat-block`, `viewing-seat`, `acting-seat`, `target-seat`, `selectable-seat`, `selected-seat`, `left-seat`, `disconnected-seat` | Shows one seat and, on the viewing player's turn, becomes the click target for choosing who to challenge. | Repeated inside Player Ring, once per seat other than the viewing player's. |
| Docked Seat Block | `article` | `seat-block docked-seat viewing-seat` | The viewing player's own Seat Block, identical in structure but laid out in normal flow rather than on the ellipse. Never selectable, since a player cannot challenge themselves. | Between Hand Scroll Viewport and Hand Action Row. Absent for spectators. |
| Seat Block Top | `div` | `seat-block-top` | Holds the avatar and the character badge. | First block inside Seat Block. |
| Seat Avatar | `img` | `seat-avatar-image` | Shows the seat's avatar sprite. | Inside Seat Block Top. |
| Seat Character Badge | `button` | `seat-character-badge` | Opens the enlarged character-card overlay for that seat. | Corner of Seat Block Top when character cards are enabled. |
| Seat Identity | `div` | `seat-block-identity` | Holds the player name, state tags, and the action callout. | Second block inside Seat Block. |
| Player Name Anchor | `strong` | `seat-block-name`, `data-punishment-target-name` | Displays the player name and anchors punishment-card travel. | Inside Seat Identity. |
| Seat / State Tag | `span` | `seat-tag` | Shows the seat number and the connection state (`Connected`, `Offline`, or `Left`). There is no BS-target tag; the live target is shown only through the `target-seat` block highlight and the outlined front cards. | Repeated inside Seat Identity. |
| Player Action Callout | `span` | `player-play-callout` | Briefly shows the spoken claim or action line, such as `Two Kings`, `BS!`, `Reset!`, or `Pass`. | Overlays Seat Identity for the player who just acted. |
| Seat Stat Row | `div` | `seat-stat-row` | Holds the cards-in-hand and points readouts side by side. | Third block inside Seat Block. |
| Hand Stat | `span` | `seat-stat seat-stat-hand` | Shows the cards icon and the cards-in-hand count. | Left half of Seat Stat Row. |
| Points Stat | `span` | `seat-stat seat-stat-points` | Shows the point icon and the point total, with scored ranks in a tooltip. | Right half of Seat Stat Row. |
| Seat Stat Icon | `img` | `seat-stat-icon` | Shows `cards_icon.png` or `point_icon.png` to the left of its number. | First child of each Seat Stat. |
| Hand Count Value | `span` | `seat-stat-value` | Shows cards remaining in hand; also anchors the front-card entry animation. | Inside Hand Stat. |
| Points Pill | `span` | `seat-stat-value points-pill` | Shows the point total; briefly pulses when that player gains a point. | Inside Points Stat. |
| Seat Front Cards | `div` | `seat-front-cards` | Reserves the front-card area at the bottom of every Seat Block. | Fourth block inside Seat Block. |
| Front Card Row | `div` | `front-card-row` | Shows the front-card stack for a seat in its natural table order. Renders nothing at all when the seat has no cards in front. | Inside Seat Front Cards. |
| Front Card | `div` | `front-card` | Shows one visible or hidden front card and, during The Cat's turn, lets the active Cat player click any face-up table card to flip it face down. | Repeated inside Front Card Row. |
| Seat Target Actions | `div` | `seat-target-actions` | Holds the `Call BS` and `Accuse` buttons for the currently selected seat. | Conditional child of the selected Seat Block, pointing at the hub. |
| Call BS Button | `button` | `seat-target-button` | Challenges that seat's hidden play. | Inside Seat Target Actions. |
| Accuse Button | `button` | `seat-target-button accuse` | Accuses that seat of cheating as The Dreamer. | Inside Seat Target Actions. |
| Table Center Hub | `div` | `table-center-hub` | Holds trump, direction, table capacity, announcements, and the transient fail message. | Centre of Player Ring. |
| Trump Rank Badge | `div` | `trump-rank-inline hub-trump` | Shows the selected or active trump rank. | First item in Table Center Hub. |
| Direction Indicator | `button` | `turn-direction-indicator` | Shows current table direction and becomes a clickable direction toggle for The Contrarian and The Dreamer on that player's turn. Carries a `clockwise` or `counterclockwise` state class. | Second item in Table Center Hub. |
| Direction Arrow | `img` | `turn-direction-arrow` | Renders `Icon_sprites/clockwise_arrow_icon.png`; mirrored with `scaleX(-1)` when the direction is counterclockwise. | Only child of Direction Indicator. |
| Table Meta | `div` | `hub-table-meta` | Shows `cards on table / MaxCardsOnTable` plus the table-status and front-card tooltips. | Third item in Table Center Hub. |
| Announcement | `div` | `match-announcement board-announcement` | Shows staged BS or Reset announcements. | Conditional child of Board Root, floating over the middle of the felt. |
| Board Fail Message | `div` | `board-fail-message` | Briefly explains why a `Call BS` or `Accuse` attempt was not legal. | Conditional item in Table Center Hub, stacked above Announcement. |
| Bottom Play Strip | `section` | `bottom-play-strip` | Holds the hand panel. | Below Player Ring. |
| Hand Stage | `div` | `hand-stage` | Shows the local hand, its tools, and the remaining action buttons. | Only panel in Bottom Play Strip; briefly flashes red when the viewing player is punished. |
| Hand Play Row | `div` | `hand-play-row` | Places the hand scroller and the action row side by side. | Second row of Hand Stage. |
| Hand Scroll Viewport | `div` | `hand-scroll-viewport` | Provides a non-clipping positioning layer for hand add/remove animations around the hand scroller. | Wraps the Hand Animation Layer and Hand Scroll Row. |
| Hand Scroll Row | `div` | `hand-scroll-row` | Holds the local hand cards. | Main content area of Hand Scroll Viewport. |
| Hand Animation Layer | `div` | `hand-scroll-animation-layer` | Temporarily shows departing hand cards during add/remove motion cues. | Conditional overlay inside Hand Scroll Viewport. |
| Hand Card Button | `button` | `hand-card-button` | Selects or deselects a card from hand. | Repeated inside Hand Scroll Row. |
| Hand Motion Card | `div` | `hand-motion-card` | Temporarily animates a card that just left the local hand area. | Repeated inside Hand Animation Layer. |
| Hand Action Row | `div` | `hand-action-row` | Holds `Play` / `Select Trump + Play`, `Pass`, `Call Reset`, and any character-specific action. | Right side of Hand Play Row, after the Docked Seat Block. |
| Action Button Item | `div` | `action-button-item`, `trump-action-item`, `drunkard-random-item`, `foreigner-pass-item` | Wraps one action button and its tooltip; may also hold the inline trump selector, the Drunkard random-play selector, or the Foreigner pass selector. | Repeated inside Hand Action Row. |
| Trump Action Combo | `div` | `trump-action-combo` | Places the trump selector beside `Select Trump + Play`. | Used only for the select-trump action. |
| Trump Select | `select` | `trump-select`, `trump-action-select` | Chooses a trump rank before the opening play. | Inside Trump Action Combo. |
| Drunkard Random Combo | `div` | `drunkard-random-combo` | Places the Drunkard selectors beside `Play Random`. | Used only for the Drunkard random-play action. |
| Drunkard Random Select | `select` | `drunkard-random-select` | Chooses how many random cards The Drunkard should play. | Inside Drunkard Random Combo. |
| Foreigner Pass Combo | `div` | `foreigner-pass-combo` | Places the outside-card selector beside `Pass` for The Foreigner. | Used only for the Foreigner pass action. |
| Foreigner Pass Select | `select` | `foreigner-pass-select` | Chooses the outside card, Joker, or `None` before the Foreigner passes. | Inside Foreigner Pass Combo. |
| Action Button | `button` | `action-button` | Executes one move such as play, pass, or reset. | Main control inside Action Button Item. |
| Action Button Icon | `img` | `action-button-icon` | Shows the move's icon from `Icon_sprites/` to the left of its label. | First child of Action Button. |
| Action Button Label | `span` | `action-button-label` | The move's text label. | Second child of Action Button. |
| Action Tooltip | `div` | `action-button-tooltip` | Explains the action or why it is disabled. | Paired with an Action Button Item. |

## Notes

- The board is a flat mono felt. The per-round ambient accent that used to tint it in amber, coral, teal, cobalt, or lime is gone, along with its state, prop, and effect, so the only colour the board ever takes on is the BS flash.
- `board-bs-flash` is keyed on `G.bsResolution.id`, so a new call restarts its animation and the element unmounts when the resolution clears. That needs no state and no timeout.
- The announcement is rendered at board level and floats over the middle of the felt rather than sitting in the hub's column, so appearing and clearing never reflows the trump badge or the direction control. The transient fail message stays inside the hub.
- Hand Stage has no header row. There is no hand title, selection count, sort label, or clear action; the selection is cleared by clicking cards or by playing them.
- `turn-direction-arrow` is scaled up past its container with `transform`, because the glyph only fills the middle 58% x 52% of its 512px canvas. Only transparent padding overflows, and `pointer-events: none` stops that overflow from widening the button's click target.
- The seats and the Table Center Hub are both nudged down into the empty bottom slot, by `--seat-ring-shift-y` and `--hub-ring-shift-y`. Both are fractions of `--seat-block-height`, which lives on `player-ring` so the two shifts and the ellipse radii all derive from the same measure at every breakpoint.
- `turn-direction-indicator` is never disabled and always shows a pointer cursor. Clicking it simply does nothing unless the viewing player is The Contrarian or The Dreamer on their own turn.
- Seats are laid out on an ellipse by CSS alone. `PlayerRing` gives each Seat Block a single `--seat-angle` custom property and the transform is `translate()` only. A `rotate()` or `scale()` there would inflate `getBoundingClientRect()` and break every card-travel animation, so seat blocks must never be rotated.
- The ring keeps the fixed `G.seatOrder` regardless of turn direction; `turn-direction-indicator` communicates direction instead of reordering seats. Seats advance bottom to left to top to right, so the game's clockwise direction is also clockwise on screen and the arrow sprite can be read literally.
- The viewing player's own block is rendered in the Hand Play Row, horizontally between their hand and the action buttons, and carries `docked-seat` so it lays out in normal flow instead of on the ellipse. `PlayerRing` still maps over every seat and simply skips that one, so the remaining seats keep their true angles relative to the viewer rather than being redistributed. Spectators have no docked block and see every seat on the ring.
- Every ref inside the docked block is unchanged, and all travel animations measure it with `getBoundingClientRect`, so moving it out of the ring needs no animation changes.
- A player who leaves keeps their Seat Block in the ring, dimmed through `left-seat` and no longer selectable. Seat angles never change mid-match, so no animation anchor ever moves.
- Below `720px` the ring gives up on being a ring and becomes a plain grid with the viewing player last. Every ref still points at the same element and all animation geometry is measured with `getBoundingClientRect`, so the card-travel sequences keep working with no JS changes.
- `Call BS` and `Accuse` are not in the action row. The viewing player clicks another Seat Block to select it, and both buttons appear on that block, pointing at the hub. Clicking the block again or pressing `Escape` clears the selection.
- Any live opponent's block can be selected at any time, on or off the viewing player's turn. Being out of turn is reported by the buttons as a fail message rather than by the block refusing to be clicked. Only a selection made on the viewing player's own turn re-points the BS target highlight, so browsing blocks out of turn never makes another player look like the live target.
- Both buttons are always pressable and never render disabled. An illegal attempt is caught client-side, shows a `board-fail-message` in the hub, and dispatches nothing. This exists because an `INVALID_MOVE` returned by the server is silent.
- `src/ui/bsTargeting.ts` mirrors `resolveBSTargetSelection` in `src/game/blowCowGame.ts` so those messages match what the server would accept. The server stays authoritative; the mirror only decides dispatch versus message.
- `Accuse` dispatches the same `callBS` move as `Call BS`, but only when that seat's hidden play carries a catchable Dreamer cheat. Otherwise it shows the fail message.
- There is no `En Passant` button. The Pawn's en-passant target is one of the seats the server already accepts, so the Pawn clicks that Seat Block and presses `Call BS`.
- When the viewing player is The Grandmaster and it is their turn, any seat with a hidden play can be challenged once. Spending the override is reported through the fail message on later attempts.
- When the viewing player is The Cat and it is their turn, any face-up `front-card` in any Seat Block becomes a click target that flips back face down for everyone without changing gameplay legality.
- Every action button pairs an icon with its label: `play_icon.png` for `Play`, `Select Trump + Play`, and `Play Random`; `pass_icon.png` for `Pass`; `reset_icon.png` for `Call Reset`. The sprites are white glyphs, so they are filtered to black on the light enabled button and left white but dimmed on the dark disabled one.
- When the viewing player is The Drunkard, the action row can show a `Play Random` combo with a card-count selector and, before trump is live, the same trump selector used by the normal opening play.
- When the viewing player is The Foreigner, the `Pass` action can expose an inline selector for choosing an outside card, a Joker, or `None` before sending the pass move.
- When the viewing player is The Contrarian or The Dreamer and it is their turn, `turn-direction-indicator` becomes a hover-highlighted button that flips the current direction, mirroring the arrow sprite. For The Dreamer, changing direction counts as a cheat if the turn ends with a different direction than it started, and BS or Accuse can catch that hidden-play cheat.
- `front-card-row` keeps cards in their natural table order; face-up cards are not regrouped ahead of face-down cards. Cards overlap so a full row fits the block, but each card stays about half visible. Cards are never removed from the row, because their elements anchor the punishment and reset travel sequences.
- A seat with no cards in front renders no front-card markup at all. `seat-front-cards` keeps its reserved height, so every Seat Block stays the same size and the ring radii, which assume a fixed block height, do not shift.
- Character descriptions are not repeated in separate text because they already exist inside the character card sprites.
- Avatars come from `avatar_sprites/` and are picked from a seeded shuffle of `matchID` plus `playerID`, so they are unique within a match and identical in every client without entering game state.
- `front-card-entry-layer` briefly animates new front cards from the owning seat's Hand Count Value into its Front Card Row.
- Reset reveals hidden table cards, gathers the table into a pile at the Table Center Hub, flips and shuffles that pile face down, then deals it back out across the active seats before the round advances.
- Punishment cards always animate toward `data-punishment-target-name` on the Seat Block name.
- The seat callout is driven by the latest qualifying player action and fades out automatically after a short moment.
- `endgame-chart-panel` is populated from authoritative game telemetry stored in `G.telemetry.events`, not from ad hoc client-side reconstruction.
- `board-error-toast`, `punishment-move-layer`, `board-overlay`, `character-card-overlay`, and `endgame-overlay` are board-level overlays. `Escape` closes the topmost one, then falls through to clearing the seat selection.
- `table-shell` keeps a persistent ambient tint and noise layer that changes to a different random palette at the start of each new round.
- When the viewing player is punished, the red flash is shown on `hand-stage`.
- The room code lives behind the info icon beside `Live match`, and the adjacent button copies it.
- Only one primary manual-play button is shown at a time: `Select Trump + Play` before trump is live, then `Play` afterward. The Drunkard may also see `Play Random` as a separate action.
- Table status, who is acting, scored ranks, and table capacity are exposed through tooltips in the hub, not separate rows or banners.
