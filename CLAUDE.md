# CLAUDE.md

Guidance for Claude Code when working in this repository. This is the Claude counterpart to
`.github/copilot-instructions.md`; keep the two in sync when project-wide guidance changes.

## Product Goal

- Blow Cow is a turn-based online multiplayer browser card game inspired by BS.
- boardgame.io owns game rules, turn flow, multiplayer state sync, and server authority.
- Browser-first, 2 to 8 players.
- `RULES.md` is the source of truth for game rules. Read it before changing gameplay.

## Current Stack

- React 19 + TypeScript + Vite 8 client.
- boardgame.io for the game definition, multiplayer transport, and lobby APIs.
- Local boardgame.io server at `server/server.cjs`, run with `node --experimental-strip-types --watch`.
- ESLint for linting; `concurrently` runs client and server together in dev.
- Prefer TypeScript and React for new code unless plain JS/HTML/CSS is explicitly requested.
- Prefer boardgame.io built-in client, lobby, and multiplayer patterns before custom networking.

## Build and Run

- `npm run dev` — Vite client + local boardgame.io server together.
- `npm run dev:client` — client only (serves `http://localhost:5173`).
- `npm run dev:server` — server only, with watch (port `8000`).
- `npm run server` — server without watch.
- `npm run build` — `tsc -b` then the Vite production build.
- `npm run preview` — serve the production build locally.
- `npm run lint` — ESLint across the repo.
- `npm run check:gameplay` — targeted gameplay checks (`scripts/check-blowcow-gameplay.ts`).
- The dev server is Windows/PowerShell-first. If port `8000` is taken: `$env:PORT=8001; npm run dev:server`.
- Vite proxies `/games` and `/socket.io` to `http://localhost:8000`, so the client needs the server
  running for lobby and match traffic.

## Verifying Changes

- After any change under `src/game/`, run `npm run check:gameplay` and `npx tsc -b`. The check script
  is the only automated test harness in this repo.
- When you change or add a rule, add a matching targeted check to `scripts/check-blowcow-gameplay.ts`
  and register it in the `checks` array at the bottom of that file.
- `npm run lint` currently reports pre-existing errors and warnings in `src/ui/BlowCowBoard.tsx` and
  `src/App.tsx` (mostly `react-hooks/set-state-in-effect`). Do not treat those as caused by your
  change, and do not fix them unless asked.
- Prefer `createScenarioState()` helpers in the check script over hand-built state. Note that
  `createScenarioState` reuses a real initial state, so `state.archive.turns` may already contain
  entries from setup — filter archive assertions by `turnNumber` and `playerID`.

## Architecture

- Keep all game rules deterministic and serializable. `G` must stay JSON-serializable.
- Core game logic lives in the boardgame.io `Game`, `moves`, `turn`, `phases`, and their helpers in
  `src/game/blowCowGame.ts`.
- No DOM access, React state, timers, or browser-only APIs inside game logic.
- The server is authoritative. Never rely on client-side validation for move legality.
- Hidden information stays private through `playerView` (`hideSecretState`) and per-player shaping.
- Use framework `events` for turn and phase progression, `phases` for large rule changes, and
  `stages` for per-player substeps.

## Game Logic Conventions (`src/game/blowCowGame.ts`)

- The file is large and single-module by design; follow the existing helper-function style rather
  than splitting it up without being asked.
- Player-visible outcomes are recorded three ways, and most rule changes need all of them:
  - `appendHistoryEvent` for the in-game log (it also writes telemetry).
  - `appendArchiveTurnAction` for the replayable per-turn archive.
  - `appendTelemetryEvent` for non-history events such as `turn` and `game`.
- Adding a new archive action requires extending `BlowCowArchiveTurnActionKind`. Prefer reusing the
  existing generic fields (`cards`, `cardsByPlayer`, `detail`) over widening the schema.
- Characters live in `src/game/blowCowCharacters.ts`. Character-specific behavior is implemented as
  small predicates (`isDreamer`, `isPawn`, …) plus targeted branches, not subclassing.
- Rule cards live in `src/game/blowCowRules.ts`: the rules of the game serialized as data, so they
  can be shown to players and changed by a character. Each rule's status is
  `active`, `removed`, or `upgraded`, stored on `G.rules`. A rule may only take a status it defines
  a description for, which is what makes it removable or upgradable — `normalizeRulesSelection` is
  the single sanitiser enforcing that, and every caller routes through it.
- **`removed` is enforced; `upgraded` is not.** Every removable rule has a branch at its enforcement
  site, all reached through `isRuleRemoved(state, ruleID)`. That helper optional-chains `state.rules`
  on purpose, because a match staged before rule cards existed restores without the field. Upgraded
  variants stay display-only.
- The Broken (`breakRule` move) removes one rule at the start of the game. Like The Seeker's pick it
  is not turn-bound and has no deadline, so `G.rules` can change mid-turn — read it at the moment of
  enforcement rather than caching a decision. `brokenRemovedRuleID` on the player is the spent flag,
  since breaking a rule leaves `character` alone.
- The Prototype (`defy` move) destroys a heart from hand and a random rule card, once per round,
  without ending the turn. It shares The Broken's pool through `getBreakableRuleIDs`, draws from it
  with `random.Shuffle`, and is refused when that pool is empty, so the action can never do only half
  of what its card says. The suit is one helper, `isDefyDestroyableCard`, read by both `canUseDefy`
  and `resolveDefy` — the latter before anything is removed, so a card of the wrong suit costs
  neither half nor the round's use. `hasUsedDefyThisRound` is the spent flag, cleared by
  `beginNextRound`.
- The Mastermind (`conspire` move) opens another player's hand and commits the turn to a play out of
  it, once per round. `G.conspiracy` is the live record; while it stands, `pass`, `callBS`,
  `callReset` and `accuseDreamer` all refuse for its owner, and `performPlay` reads the cards out of
  `conspiracy.targetPlayerID`'s hand instead of the mover's. The play is still the mover's in every
  other respect — it lands in front of them, and they answer the BS call it draws. There is no
  cancel, so `hasUsedConspireThisRound` is spent at the peek, not at the play, and the table-room
  check happens in `resolveConspire` rather than being discovered afterwards: opening a hand that
  cannot be played out of would strand the turn with no legal move. It is the one ability that widens
  `hideSecretState` — one extra hand, for one seat, until the play clears the conspiracy.
- The Invisible Hand (`manipulate` move) sets the round's trump rank and direction and hands the
  first turn to another player, who may not pass on it. Its window is the starting player on the
  round's very first turn, which `canManipulate` reads off `startingPlayerID`, a null `trumpRank`, a
  zero `passStreak`, and a null `lastNonPassingPlayerID` — any pass or play breaks all of them.
  Unlimited use needs no spent flag: handing the round away is what stops the player being the
  starting player, and they may not name themselves. `round.forcedPlayPlayerID` is the lock,
  enforced only against `pass` and lifted by `handleTurnStart` as soon as any other turn begins.
  Manipulate leaves `lastNonPassingPlayerID` null on purpose, so the turn it hands over has nothing
  to call BS on.
- Conspire and Manipulate are pressed on a player block, not in the action row: `renderSeatTargetActions`
  carries them beside `Call BS` and `Accuse`, and the block being clicked is the target. That is why
  neither has a player dropdown, and why `getConspireFailure` and `getManipulateFailure` both check
  the turn, which the old action-row tooltips never had to — a block is hoverable on anyone's turn.
  Manipulate's rank and direction selectors moved with it, so all three of its decisions are made in
  one bubble. They write one shared choice rather than one per block, and their wrapper stops click
  and key events, since the block underneath is a click-and-Enter target of its own.
- The Gambler turns every Reset into a poker showdown: the weakest hand in front takes the whole
  table instead of it being shuffled and dealt. It is a rule imposed on the table, not an action, so
  `isGamblerShowdownActive` reads the seating rather than the caller, and an all-pass `roundReturn` is
  never a showdown because nobody called anything. `createResetShowdown` builds the standings at call
  time and `hideSecretState` withholds them until the reveal is complete, exactly as it does a BS
  `punishment` — which is also why `callReset` is now a server-only move. The caller still opens the
  next round, even when they are the one punished. `beginResetPunishment` splits from
  `finalizeResetResolution` for the same reason `beginBSPunishment` does, and additionally carries the
  chosen seat, because a tie is the caller's to break; the server re-checks it against
  `weakestPlayerIDs`. On the client the showdown reuses the BS punishment travel through
  `activePunishment` and makes the gather-shuffle-deal chain bail out, since those animations belong
  to the redistribution it replaces.
- Poker evaluation lives in `src/game/blowCowPoker.ts`, deliberately outside the game module: it takes
  cards and returns a comparable score, with no state. Standard five-card categories, so four to a
  flush is not a flush and a short hand simply cannot reach the higher ones — nothing is padded to
  five. Ace is high only. Jokers are wild and spent once; The Confused's Jacks stay Jacks. Card count
  is the last tiebreak, and `comparePokerHands` returning 0 is a real tie that the caller settles.
- The Mime (`mimic` move) copies their next player's block and flips a coin for the two seats, once
  per round. `G.mimicry` changes nothing the engine reads: it is a snapshot the *client* draws one
  block from, so hands, plays, points and character all stay where they were. The snapshot is
  load-bearing rather than incidental — the board subtracts The Mime's own plays from the copied hand
  count and stacks them onto the copied pile, so the acting block loses cards and gains a pile
  whichever way the coin fell, while a live mirror would leak the answer. `swapSeatPositions` trades
  `seatOrder` and both `seatIndex` values together, keeping `seatIndex` equal to the position, which
  is what keeps every "Seat N" label on the chair rather than the player and so stops the swap
  renaming anything. The swap is permanent; the drawing is worn for the rest of the round, no turn
  start ending it, and `clearMimicry` drops it at every site that opens a procedure, on either party
  leaving, and again at `beginNextRound` as belt and braces — every way a round ends is one of those
  procedures, so a procedure is always what takes it off. `hasUsedMimicThisRound` is the spent flag.
  The Mimic history event is the one anonymous event in the game; `buildTurnStatus` drops to a bare
  table-and-chair line while a disguise stands, because the action space it recites is read off the
  acting player's own character; and the board seeds The Mime's block with the source's callout, but
  only when The Mime is not the one on the clock. It is a screen-level illusion and nothing more.
  The Reveal Rule is the one part that needed machinery rather than a snapshot: both blocks draw the
  same physical cards, so obeying it literally flips the borrowed pile on both at once, at whichever
  chair the source really sits in. `mimicry.revealedPlayerIDs` splits it per chair, holding back only
  `borrowedFaceDownCardIDs` and holding them back on the source's own block too;
  `mimicry.pendingHandoverPlayerID` discounts the turn a swap hands over, since from outside the ring
  the turn never moved, and it is the only field `hideSecretState` strips. `getDisplayedFrontCards`
  in `src/ui/tablePlays.ts` is the single source of truth for what each block draws, read by the seat
  rows and by the one flip watcher that replaced the two table-keyed ones, so a card can never be
  animated as flipping while it is drawn the other way up. `mime disguise symmetry` in the check
  script runs both branches side by side and compares the ring chair by chair through `playerView`.
  `G.mimicry` still names the disguised seat to anything reading state rather than screen. It hides
  nothing `playerView` was ever responsible for.
- The Clown's first play each round leaves the turn where it was. It is the only character with no
  move of its own: `performPlay` decides it, and `G.encore` is the live record — public, turn-bound,
  and cleared by `handleTurnStart` exactly as a conspiracy is. `hasUsedClownEncoreThisRound` is spent
  by the play, not by the action it buys, since an encore cannot be declined. Two things carry the
  weight. `encore.bsTargetPlayerID` remembers the BS target from *before* the play, because the play
  makes The Clown the latest non-passing player and `getDefaultBSTargetPlayerID` would otherwise
  answer "yourself" and close the very action the encore hands back — that fallback lives in the one
  helper, so `bsTargeting.ts` imports `getEncoreBSTargetPlayerID` rather than mirroring it. And
  `isEncoreWorthTaking` refuses an encore that would buy nothing: a play is the action it takes away,
  so a kept turn with no Pass, no BS target and no full table would have no legal move left. There is
  no decline button — Pass is one, and it counts as an ordinary pass. `performPlay` also clears
  `round.forcedPlayPlayerID` now, because a lock still standing would take Pass off the encore of a
  player who has already done what it asked.
- The Cat owns the direction flip as well as the table-card flip. `resolveToggleDirection` reads
  `isCat`, and its own-turn flip is the only legal one — every other flip is a tamper, cheat licence
  or not. The Contrarian no longer touches the direction at all.
- The Contrarian is a second layer of the Reverse Rule, applied in `createBSResolution` and nowhere
  else. It is a layer, not an override, so the two are combined as `reverseRuleTriggered !==
  contrarianTriggered` and a call that trips both lands on the default punishment. It is bound to
  `callerPlayerID`, so being called on by a Contrarian does nothing. Nothing in the UI needed adding:
  `Punish` is already rendered on `punishment.punishedPlayerID`'s block, so moving that field moves
  the button. Keep `contrarianTriggered` optional-tolerant when reading it — a match staged before
  this existed restores a punishment record without the field.
- Cheating is gated by one helper, `canCheat`: The Dreamer while the No Cheating Rule stands, and
  everybody once it is removed. Every one of the six cheats routes through it, permission and
  detection alike, so the licence and the accusation window can never disagree about who is
  answerable. `isDreamer` survives only where the question really is "is this seat The Dreamer" —
  archive labelling, and nothing else. Removing the rule is the one removal that widens the game
  rather than narrowing it, and it leaves The Dreamer an ordinary seat.
- The take-back (`takeBackCard` move) is the mirror of the sneak play: one of your own face-up cards
  goes back into your hand, on anybody's turn including your own, unlimited, and in the same silence
  — archive only, no history, no telemetry, and `tableStatus` deliberately left stale so nothing
  re-announces it. Face-down cards are refused, because those are still live claims and palming one
  would answer a BS call by deleting the evidence. It is the one cheat that leaves *nothing* on the
  table to inspect, which is why `G.takeBackTamper` has to exist for `getAccusableCheat` to read; a
  play emptied by it is dropped from `table.plays`, since `getLatestPlayForPlayer` and En Passant
  both walk that array by position. `hideSecretState` strips the record from everyone **except its
  owner** — the single asymmetry in that function. An opponent holding it would be checking the
  answer instead of gambling; its owner cannot, and their client is the only one that needs it, to
  serve `TAKE_BACK_ACTION_LOCK_MS`. That two-second lock over the whole action row and the seat
  buttons is client-side by construction: a server-enforced deadline would be a wall clock in `G`,
  which is not replayable. It arms only on the cheat's own turn, and `id` changes per take-back so a
  run of them re-arms rather than coasting on the first.
- A direction flip writes no history event at all. It publishes `G.directionFlip`, which names the
  player who made it so each client can lean their block toward the hub, plus an anonymous telemetry
  line for the archive. `directionFlip` is the deliberate opposite of `directionTamper`: the flip
  record is public and says only *who*, the tamper record is stripped by `hideSecretState` and holds
  *whether they were allowed to*. Legal flips publish too — nudging only the cheats would announce
  the verdict, and nudging only the illegitimate flippers would say the same thing in reverse.
  `handleTurnStart` clears both together, so the tell dies with its accusation window.
- The No Cheating Rule card does not list the cheats it covers, and neither description mentions The
  Dreamer. `RULES.md` is where the six are written down; the card is what every seat can open.
- `BlowCowTablePlay.claimedRank` is nullable for exactly one case: a card sneaked onto the table
  before the round had a trump rank. `settleUnclaimedPlays` fills it in wherever `round.trumpRank`
  goes from null to a rank — the trump-selecting play and Manipulate — and counts the lie there,
  since until a rank exists there is nothing to have lied about. Nothing reads that null in between:
  the play callout is already suppressed for a sneak, a BS call needs a live trump, and a sneak is
  never a pending reveal. A new reader of `claimedRank` should still handle null rather than assume
  those three hold.
- Removing a rule takes any ability built on it with it: Pass removes The Foreigner's ability, Joker
  removes The Confused's, Reveal removes The Spy's, and a Dreamer cheat against a removed rule stops
  being a cheat. That is a consequence, not a special case — see the interaction list in `RULES.md`.

## Frontend Conventions

- UI components render state and dispatch boardgame.io moves or events; keep logic out of them.
- Responsive layouts for desktop and mobile browsers.
- Prefer clear card, hand, table, turn, and player-status components over monolithic views.
  `src/ui/BlowCowBoard.tsx` is already very large — add to it carefully and factor out where sensible.
- `src/ui/RuleCardDeck.tsx` is the paged rule-card grid, shared by three surfaces: the in-match Rules
  panel, the lobby's House Rules editor, and The Broken's picker. Each passes a different
  `renderCardFooter`, so one set of cards carries no controls, status buttons, or a Select button.
  Its page size of four is load-bearing: a second row overflows `board-overlay-panel` and brings back
  the scrollbar the paging exists to avoid.
- Character card sprites already contain the character name and description. Do not duplicate that
  description text in the UI unless explicitly requested. Rule cards are the one exception: their
  illustrations carry no text, so the Rules panel renders the title and description itself.
- Sprite folders live at the repo root, not in `public/`, and are loaded via `import.meta.glob`:
  `card_sprites/`, `rect_card_sprites/`, `character_card_sprites/`, `avatar_sprites/`,
  `rule_card_sprites/`.
- Character sprite filename matching tolerates suffixes after the name, such as `The Contrarian 2.png`,
  because there a suffix only ever means a newer revision of the same art. The one exception is a run
  numbered from `1` — `The Prototype 1/2/3.png` — which is an animation, since a revision is never
  numbered 1: the first of those is the unsuffixed file. `getCharacterCardSpriteFrames` is what tells
  the two apart, and `CharacterCardSpriteImage` plays a multi-frame run at 300ms a frame wherever the
  card is shown at readable size. `getCharacterCardSprite` still returns one still for everywhere
  else, the 30px seat badge included.
- Rule sprites are the exception: a `Reverse Rule 2.png` beside a `Reverse Rule.png` is the
  **upgraded** illustration, and every rule that ships one is a rule with an upgraded variant.
  `getRuleCardSprite(title, isUpgraded)` looks the two up separately for that reason; the tolerant
  prefix match survives only as a fallback for a rule whose base art is missing. A missing rule
  sprite renders a placeholder tile.

## UI Documentation

- Before frontend or layout changes, read the relevant page doc under `docs/ui-pages/`
  (`lobby-page.md`, `room-staging-page.md`, `table-page.md`) for page structure, element aliases, and
  UI relationships.
- When a change alters a documented page's structure, major elements, element roles, or visible
  relationships, update the matching `docs/ui-pages/` file in the same task.
- If a new top-level page or equivalent major page state is added, create a matching Markdown doc
  under `docs/ui-pages/`.

## Code Organization

- `src/game/` — rules, helpers, character definitions, rule card definitions, poker evaluation.
- `src/ui/` — board UI and sprite helpers.
- `src/App.tsx`, `src/config.ts` — lobby flow and client configuration.
- `server/server.cjs` — local server runtime, including the custom `/games/:name/:id/rejoin` route,
  the persistent match store, and the abandoned-match sweeper.
- `server/completedGameArchive.ts` — archives finished matches to `data/completed-games/`.
- `scripts/check-blowcow-gameplay.ts` — targeted gameplay checks.
- Keep modules small and focused; keep shared types and constants in dedicated files.

## Match Persistence

- Matches are stored with boardgame.io's `FlatFile` store under `data/matches/`, so rooms survive a
  crash, a reboot, and the routine `--watch` restarts that `npm run dev:server` performs whenever a
  file under `src/game/` changes. Override the location with `BLOW_COW_MATCH_DIR`.
- The store is asynchronous. Anything that wraps or reads `server.db` must `await` it —
  `db.fetch(...).state` on an unawaited Promise is `undefined`, which fails silently.
- `releaseStaleConnections` clears every `isConnected` flag when the store opens, before the server
  listens. A crashed process never runs the disconnect handler, so without this every restored room
  would look occupied and `/rejoin` would refuse it with a 409.
- `sweepAbandonedMatches` wipes matches untouched for `BLOW_COW_MATCH_TTL_MS` (24h default) that have
  nobody connected, on boot and every 15 minutes.
- The client stores its whole seat under `ACTIVE_ROOM_STORAGE_KEY`, so a reload reconnects with the
  same credentials rather than going back through the lobby.
- `POST /games/:name/:id/clear` deletes a room manually. `getRoomClearBlockReason` in
  `src/lobbyRooms.ts` is shared by that route and the lobby's Clear button, so keep new room-level
  rules there rather than writing them twice.

## Completed Match Archives

- Finished matches are written locally under `data/completed-games/`.
- `matches/` holds one detailed JSON snapshot per match; `index/games.ndjson` and
  `index/player-games.ndjson` hold compact per-match and per-player lines for analysis.
- Changing archive shapes affects those written files. Keep `schemaVersion` in mind before altering
  the emitted structure.
- `initial.rules` is the staged rule selection; `endgame.rules` is what the match finished under.
  They differ whenever The Broken removed a rule, so neither replaces the other.

## Implementation Priorities

- Add brief comments only where card rules, bluffing flow, or hidden-information handling would be
  non-obvious.
- Match the surrounding code's naming, comment density, and idiom.

## boardgame.io Notes

- `G` holds game data; `ctx` holds framework-managed turn metadata such as current player, turn
  number, and player count.
- Implement player actions as `moves` that deterministically update `G` with no external state or
  browser-only side effects.
- Use the framework's randomness plugin (`random.Shuffle`) rather than `Math.random`, so replays and
  server authority hold.
- Relevant docs areas: Multiplayer, Turn Order, Phases, Stages, Events, Secret State, Randomness,
  Testing, Deployment, Game, Client, Server, and Lobby.

## External References

- boardgame.io docs: https://boardgame.io/documentation/#/
- boardgame.io repo: https://github.com/boardgameio/boardgame.io — the upstream repo's `examples/`,
  `docs/`, and `packages/` directories are useful references. They are not part of this repository.
