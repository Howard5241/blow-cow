# Project Guidelines

Workspace guidance for Copilot in this repo. `CLAUDE.md` at the repository root is the Claude Code
counterpart; keep the two in sync when project-wide guidance changes.

## Product Goal
- Build Blow Cow, a turn-based online multiplayer browser card game inspired by BS.
- Use boardgame.io for game rules, turn flow, multiplayer state sync, and server authority.
- Target the web browser first.
- Support 2 to 8 players.
- See `RULES.md` for the current working rules.

## Default Stack
- Prefer TypeScript for new code unless JavaScript is explicitly requested.
- Prefer React for the frontend unless plain HTML and CSS is explicitly requested.
- Prefer boardgame.io built-in client, lobby, and multiplayer patterns before custom networking.
- The active client stack is React + TypeScript + Vite.
- The active local multiplayer server runs from `server/server.cjs` with `node --experimental-strip-types --watch`.

## Build and Run
- Start the full local website with `npm run dev`. This runs both the Vite client and the local boardgame.io server together.
- The Vite client normally serves the site at `http://localhost:5173`.
- The local multiplayer server normally runs on port `8000`.
- Start only the client with `npm run dev:client`.
- Start only the multiplayer server with `npm run dev:server`.
- Build the production website with `npm run build`.
- Preview the production build locally with `npm run preview`.
- Start the multiplayer server without watch mode with `npm run server`.
- Run ESLint across the repo with `npm run lint`.
- Run the targeted gameplay checks with `npm run check:gameplay`.
- After changing anything under `src/game/`, run `npm run check:gameplay` and `npx tsc -b`. The check script is the only automated test harness in this repo.
- When a rule changes, add a matching check to `scripts/check-blowcow-gameplay.ts` and register it in the `checks` array at the bottom of that file.
- In PowerShell, if port `8000` is already in use, start the server on a different port with `$env:PORT=8001; npm run dev:server`.
- Vite proxies `/games` and `/socket.io` to `http://localhost:8000`, so the client needs the server running for lobby and match traffic.

## Architecture
- Keep all game rules deterministic and serializable.
- Put core game logic in boardgame.io `Game`, `moves`, `turn`, `phases`, and related helpers.
- Do not put DOM access, React state, timers, or browser-only APIs inside game logic.
- Treat the server as authoritative. Do not trust client-side validation for legal moves.
- Keep hidden information private by using boardgame.io patterns such as `playerView` and per-player data shaping.

## Frontend Conventions
- Keep UI components focused on rendering state and dispatching boardgame.io moves or events.
- Separate game logic from presentation code.
- Build responsive layouts that work on desktop and mobile browsers.
- Use clear card, hand, discard, turn, and player-status components instead of large monolithic views.
- Keep preview-only UI behavior clearly separated from eventual boardgame.io move logic.
- Character card sprites already include the character name and description, so the UI should not duplicate that description text outside the sprite unless explicitly requested. Rule cards are the one exception: their illustrations carry no text, so the Rules panel renders the title and description itself.
- Character sprites live under `character_card_sprites/` and rule illustrations under `rule_card_sprites/`. Character filename matching tolerates suffixes after the name, such as `The Contrarian 2.png`, where a suffix only means a newer revision. A run numbered from `1`, such as `The Prototype 1/2/3.png`, is the one exception and means an animation, since a revision is never numbered 1. `getCharacterCardSpriteFrames` tells the two apart and `CharacterCardSpriteImage` plays a run at 300ms a frame wherever the card is shown large; `getCharacterCardSprite` still returns one still everywhere else. Rule sprites are the exception: a `Reverse Rule 2.png` beside a `Reverse Rule.png` is the upgraded illustration, so `getRuleCardSprite(title, isUpgraded)` looks the two up separately. A missing rule sprite renders a placeholder tile.
- Sprite folders live at the repository root, not in `public/`, and are loaded through `import.meta.glob`: `card_sprites/`, `rect_card_sprites/`, `character_card_sprites/`, `avatar_sprites/`, and `rule_card_sprites/`.
- Rule cards live in `src/game/blowCowRules.ts`: the game's rules serialized as data so they can be shown to players and changed by a character. Each rule's status is `active`, `removed`, or `upgraded`, stored on `G.rules`, and a rule may only take a status it defines a description for.
- `removed` is enforced through `isRuleRemoved(state, ruleID)`, which every enforcement site calls. `upgraded` is not enforced yet and stays display-only. The helper optional-chains `state.rules` because a match staged before rule cards existed restores without the field.
- The Broken removes one rule at the start of the game via the `breakRule` move. It is not turn-bound and has no deadline, so `G.rules` can change mid-turn; read it at the moment of enforcement rather than caching. `brokenRemovedRuleID` on the player is the spent flag.
- The Prototype destroys one heart from hand and one random rule card via the `defy` move, once per round, without ending the turn. It draws from the same `getBreakableRuleIDs` pool The Broken picks from and is refused when that pool is empty. The suit is one helper, `isDefyDestroyableCard`, read by both `canUseDefy` and `resolveDefy` — the latter before anything is removed, so a card of the wrong suit costs neither half nor the round's use. `hasUsedDefyThisRound` is the spent flag, cleared by `beginNextRound`.
- The Mastermind opens another player's hand via the `conspire` move, once per round, and commits the turn to a play out of it. `G.conspiracy` is the live record; while it stands, `pass`, `callBS`, `callReset`, and `accuseDreamer` refuse for its owner, and `performPlay` takes the cards from `conspiracy.targetPlayerID`'s hand while the play still belongs to the mover. There is no cancel, so `hasUsedConspireThisRound` is spent at the peek. It is the one ability that widens `hideSecretState`: one extra hand, for one seat, until the play clears the conspiracy.
- The Invisible Hand sets the round's trump rank and direction and hands the first turn to another player via the `manipulate` move. `canManipulate` gates it to the starting player on the round's very first turn, and unlimited use needs no spent flag because handing the round away is what ends being the starting player. `round.forcedPlayPlayerID` is the lock on the chosen player, enforced only against `pass` and lifted by `handleTurnStart` once any other turn begins. The move leaves `lastNonPassingPlayerID` null so the handed-over turn has nothing to call BS on, and the chosen rank obeys the Rank Change Rule through `getManipulableTrumpRanks`.
- Conspire and Manipulate are pressed on a player block rather than in the action row: `renderSeatTargetActions` carries them beside `Call BS` and `Accuse`, and the block being clicked is the target, so neither has a player dropdown. `getConspireFailure` and `getManipulateFailure` both check the turn, which the old action-row tooltips never had to, because a block is hoverable on anyone's turn. Manipulate's rank and direction selectors moved with it, so all three of its decisions are made in one bubble; they write one shared choice rather than one per block, and their wrapper stops click and key events because the block underneath is a click-and-Enter target of its own.
- The Gambler turns every Reset into a poker showdown: the weakest hand in front takes the whole table instead of it being shuffled and dealt. It is a rule imposed on the table rather than an action, so `isGamblerShowdownActive` reads the seating and not the caller, and an all-pass `roundReturn` is never a showdown. `createResetShowdown` builds the standings at call time and `hideSecretState` withholds them until the reveal is complete, exactly as it does a BS `punishment`, which is also why `callReset` is now a server-only move. The caller still opens the next round even when they are the one punished. `beginResetPunishment` splits from `finalizeResetResolution` like `beginBSPunishment` does and additionally carries the chosen seat, because a tie is the caller's to break; the server re-checks it against `weakestPlayerIDs`. The client reuses the BS punishment travel through `activePunishment` and bails the gather-shuffle-deal chain out.
- Poker evaluation lives in `src/game/blowCowPoker.ts`, outside the game module, taking cards and returning a comparable score with no state. Standard five-card categories, so four to a flush is not a flush and a short hand cannot reach the higher ones; nothing is padded to five. Ace is high only, Jokers are wild and spent once, The Confused's Jacks stay Jacks, card count is the last tiebreak, and a `comparePokerHands` of 0 is a real tie for the caller to settle.
- The Mime copies their next player's block via the `mimic` move, once per round, and flips a coin for the two seats. `G.mimicry` changes nothing the engine reads: it is a snapshot the *client* draws one block from, so hands, plays, points, and character all stay where they were. The snapshot is load-bearing rather than incidental — the board subtracts The Mime's own plays from the copied hand count and stacks them onto the copied pile, so the acting block loses cards and gains a pile whichever way the coin fell, while a live mirror would leak the answer. `swapSeatPositions` trades `seatOrder` and both `seatIndex` values together, keeping `seatIndex` equal to the position, which is what keeps every "Seat N" label on the chair rather than the player and so stops the swap renaming anything. The swap is permanent; the drawing is worn for the rest of the round, no turn start ending it, and `clearMimicry` drops it at every site that opens a procedure, on either party leaving, and again at `beginNextRound` as belt and braces — every way a round ends is one of those procedures, so a procedure is always what takes it off. `hasUsedMimicThisRound` is the spent flag. The Mimic history event is the one anonymous event in the game; `buildTurnStatus` drops to a bare table-and-chair line while a disguise stands, because the action space it recites is read off the acting player's own character; and the board seeds The Mime's block with the source's callout, but only when The Mime is not the one on the clock. It is a screen-level illusion and nothing more. The Reveal Rule is the one part that needed machinery rather than a snapshot: both blocks draw the same physical cards, so obeying it literally flips the borrowed pile on both at once, at whichever chair the source really sits in. `mimicry.revealedPlayerIDs` splits it per chair, holding back only `borrowedFaceDownCardIDs` and holding them back on the source's own block too; `mimicry.pendingHandoverPlayerID` discounts the turn a swap hands over, since from outside the ring the turn never moved, and it is the only field `hideSecretState` strips. `getDisplayedFrontCards` in `src/ui/tablePlays.ts` is the single source of truth for what each block draws, read by the seat rows and by the one flip watcher that replaced the two table-keyed ones, so a card can never be animated as flipping while it is drawn the other way up. `mime disguise symmetry` in the check script runs both branches side by side and compares the ring chair by chair through `playerView`. `G.mimicry` still names the disguised seat to anything reading state rather than screen. It hides nothing `playerView` was ever responsible for.
- The Clown's first play each round leaves the turn where it was, and one more action follows it — anything but another play. It is the only character with no move of its own: `performPlay` decides it, and `G.encore` is the live record, public and turn-bound and cleared by `handleTurnStart` exactly as a conspiracy is. `hasUsedClownEncoreThisRound` is spent by the play rather than by the action it buys, since an encore cannot be declined. Two things carry the weight. `encore.bsTargetPlayerID` remembers the BS target from before the play, because the play makes The Clown the latest non-passing player and `getDefaultBSTargetPlayerID` would otherwise answer "yourself" and close the very action the encore hands back; that fallback lives in the one helper, so `src/ui/bsTargeting.ts` imports `getEncoreBSTargetPlayerID` instead of mirroring it. And `isEncoreWorthTaking` refuses an encore that would buy nothing, since a play is the action it takes away and a kept turn with no Pass, no BS target and no full table would have no legal move left. There is no decline button: Pass is one, and it counts as an ordinary pass. `performPlay` also clears `round.forcedPlayPlayerID` now, because a lock still standing would take Pass off the encore of a player who has already done what it asked.
- The Cat owns the direction flip as well as the table-card flip. `resolveToggleDirection` reads `isCat`, and their own-turn flip is the only legal one; every other flip is a tamper, cheat licence or not. The Contrarian no longer touches the direction at all.
- The Contrarian is a second layer of the Reverse Rule, applied in `createBSResolution` and nowhere else. It is a layer rather than an override, so the two combine as `reverseRuleTriggered !== contrarianTriggered` and a call that trips both lands on the default punishment. It is bound to `callerPlayerID`, so being called on by a Contrarian does nothing. The UI needed no addition: `Punish` already renders on `punishment.punishedPlayerID`'s block, so moving that field moves the button. Read `contrarianTriggered` tolerantly — a match staged before it existed restores a punishment record without the field.
- Cheating is gated by one helper, `canCheat`: The Dreamer while the No Cheating Rule stands, and everybody once it is removed. All six cheats route through it, permission and detection alike, so the licence and the accusation window can never disagree about who is answerable. `isDreamer` survives only where the question really is "is this seat The Dreamer", which is archive labelling and nothing else. Removing the rule is the one removal that widens the game rather than narrowing it, and it leaves The Dreamer an ordinary seat.
- A direction flip writes no history event at all. It publishes `G.directionFlip`, naming the player who made it so each client can lean their block toward the hub, plus an anonymous telemetry line for the archive. `directionFlip` is the deliberate opposite of `directionTamper`: the flip record is public and says only who, the tamper record is stripped by `hideSecretState` and holds whether they were allowed to. Legal flips publish too, because nudging only the cheats would announce the verdict and nudging only the illegitimate flippers would say the same in reverse. `handleTurnStart` clears both together.
- The take-back (`takeBackCard` move) is the mirror of the sneak play: one of your own face-up cards goes back into your hand, on anybody's turn including your own, unlimited, and in the same silence — archive only, no history, no telemetry, and `tableStatus` deliberately left stale so nothing re-announces it. Face-down cards are refused, because those are still live claims and palming one would answer a BS call by deleting the evidence. It is the one cheat that leaves nothing on the table to inspect, which is why `G.takeBackTamper` has to exist for `getAccusableCheat` to read; a play emptied by it is dropped from `table.plays`, since `getLatestPlayForPlayer` and En Passant both walk that array by position. `hideSecretState` strips the record from everyone except its owner, which is the single asymmetry in that function: an opponent holding it would be checking the answer instead of gambling, its owner cannot, and their client is the only one that needs it, to serve `TAKE_BACK_ACTION_LOCK_MS`. That two-second lock over the whole action row and the seat buttons is client-side by construction, because a server-enforced deadline would be a wall clock in `G` and a wall clock in `G` is not replayable. It arms only on the cheat's own turn, and `id` changes per take-back so a run of them re-arms rather than coasting on the first.
- The No Cheating Rule card does not list the cheats it covers, and neither description mentions The Dreamer. `RULES.md` is where the six are written down; the card is what every seat can open.
- `BlowCowTablePlay.claimedRank` is nullable for exactly one case: a card sneaked onto the table before the round had a trump rank. `settleUnclaimedPlays` fills it in wherever `round.trumpRank` goes from null to a rank — the trump-selecting play and Manipulate — and counts the lie there, since until a rank exists there is nothing to have lied about. Nothing reads that null in between, but a new reader should still handle it rather than assume.
- `src/ui/RuleCardDeck.tsx` is the paged rule-card grid shared by the in-match Rules panel, the lobby's House Rules editor, and The Broken's picker, each passing a different `renderCardFooter`.

## UI Documentation
- Before making frontend or layout changes, read the relevant page docs under `docs/ui-pages/` to understand the current page structure, element aliases, and UI relationships.
- When a frontend change alters a documented page's structure, major UI elements, element roles, or visible relationships, update the matching file in `docs/ui-pages/` in the same task so the documentation stays in sync.
- If a new top-level page or equivalent major page state is added, create a matching Markdown document under `docs/ui-pages/`.

## Code Organization
- Prefer small focused modules.
- Put rules and helpers under a game-focused area such as `src/game/`.
- Put UI under a frontend-focused area such as `src/ui/`.
- Keep shared types and constants in dedicated files.
- Current layout: `src/game/` holds the game definition and characters, `src/ui/` holds the board and sprite helpers, `server/server.cjs` is the local server runtime, `server/completedGameArchive.ts` archives finished matches to `data/completed-games/`, and `scripts/check-blowcow-gameplay.ts` holds the gameplay checks.

## Implementation Priorities
- Add brief comments only where card rules, bluffing flow, or hidden-information handling would be non-obvious.
- When asked to scaffold, default to a browser app using boardgame.io with React and TypeScript.

## External References
- boardgame.io docs: https://boardgame.io/documentation/#/
- boardgame.io repo: https://github.com/boardgameio/boardgame.io

## boardgame.io Notes
- The framework centers game state around `G` for game data and `ctx` for framework-managed turn metadata such as current player, turn number, and player count.
- Keep `G` JSON-serializable because state is synchronized between client and server.
- Implement player actions as `moves` that deterministically update `G` without relying on external state or browser-only side effects.
- Use framework `events` for turn and phase progression such as ending turns or changing phases.
- Use `phases` for large rule changes across the game and `stages` for per-player substeps inside a turn.
- Relevant docs areas for this project: Multiplayer, Turn Order, Phases, Stages, Events, Secret State, Randomness, Testing, Deployment, Game, Client, Server, and Lobby.

## Upstream boardgame.io Notes
- boardgame.io is an engine for turn-based games that provides state management, realtime multiplayer sync, lobby support, storage integration, AI bots, logs, time travel, and plugins.
- Its README emphasizes that you describe state transitions as simple move functions while boardgame.io handles networking and storage.
- The upstream repository includes `examples/`, `docs/`, and `packages/`, which are useful references. Those directories belong to boardgame.io, not to this repository.
- The upstream project is TypeScript-heavy, so prefer TypeScript-first examples and patterns when choosing between JS and TS implementations.

## Repository Notes
- This repository uses `concurrently` to run the Vite client and local boardgame.io server together during development.
- The in-game screen is wired to real gameplay state and multiplayer flow, and page-level UI docs live under `docs/ui-pages/`.
- Finished matches are archived locally under `data/completed-games/`, with detailed snapshots in `matches/` and compact analysis lines in `index/games.ndjson` and `index/player-games.ndjson`.
- Live matches persist to `data/matches/` through boardgame.io's `FlatFile` store, so rooms survive crashes and `--watch` restarts. The store is asynchronous, so anything wrapping `server.db` must `await` it. Stale `isConnected` flags are cleared when the store opens, and matches nobody has touched for 24 hours are swept away.
- The client keeps its whole seat (match, player, credentials, name) in `localStorage`, so reloading a tab reconnects to the same table instead of returning to the lobby.
- Each lobby room has a Clear button that deletes it, allowed only when the game has ended or nobody is connected. `getRoomClearBlockReason` in `src/lobbyRooms.ts` is shared by the button and the server's `/clear` route, so room-level rules belong there rather than in both places.
- `npm run lint` currently reports pre-existing problems in `src/ui/BlowCowBoard.tsx` and `src/App.tsx`. Those are not caused by new work and should not be fixed unless asked.
