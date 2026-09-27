# CLAUDE.md

Guidance for Claude Code when working in this repository, and the detailed reference that
`.github/copilot-instructions.md` defers to. That file is a short standalone brief and deliberately
does not duplicate this one — when project-wide guidance changes, change it here, and update the
Copilot brief only if a build command, a stack choice, or the documentation map itself moved.

## Product Goal

- Blow Cow is a turn-based online multiplayer browser card game inspired by BS.
- boardgame.io owns game rules, turn flow, multiplayer state sync, and server authority.
- Browser-first, 2 to 8 players.

### Where Things Are Written

Six documents, six jobs. Keep each fact in exactly one of them and cross-reference rather than
restate — if you find yourself writing a rule twice, one of the copies is wrong already.

| File | Owns |
| --- | --- |
| `RULES.md` | Classic Mode, the vanilla game with a standard deck: what every player does regardless of character. Source of truth for rules. |
| `RULES-EXTENSIONS.md` | Classic Mode's optional additions on top of `RULES.md`: action ranks and statuses. |
| `RULES-ANTE.md` | Ante Mode: only where it differs from `RULES.md`. Everything the two share stays in `RULES.md` and is referenced from here. |
| `CHARACTERS.md` | Per-character abilities, windows, limits, and their interactions with rules and statuses. |
| `Characters.csv` | The wording printed on the character card art. Authoring source for the art. |
| `CLAUDE.md` | Implementation only: move names, state fields, enforcement sites, and why the code is shaped as it is. |

Read `RULES.md` and `CHARACTERS.md` before changing gameplay, and `RULES-EXTENSIONS.md` before
touching action ranks or statuses. When a rule changes, update the rules
file first and the code second. Ante Mode carries no characters, so a change to `CHARACTERS.md` never
reaches it; a change to a shared rule in `RULES.md` usually does, and `RULES-ANTE.md` says which ones
it inherits.

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
- **Also run `npm run check:ante:bot:play` after any change to an Ante rule.** The browser agent plays
  through the real reducer, so an Ante rule change can silently make its move illegal — and the
  symptom is a frozen table, not a weaker opponent. `npm run check:ante:bot` is the companion and only
  needs running when something under `src/bots/ante/` or the exported weights moved.
- **Also run `npm run check:bots` after any change to a rule the bots touch.** They play through the
  real reducer, so a rule change can silently make a bot's move illegal — and an illegal move is
  refused in silence, which on a real table is a frozen game rather than a weak opponent. That check
  asserts no move is ever refused, which is the only symptom that failure has. It deliberately does
  *not* require every table to finish: `honest` and `liar` never challenge, and a table where nobody
  challenges never resolves a round.
- When you change or add a rule, add a matching targeted check to `scripts/check-blowcow-gameplay.ts`
  and register it in the `checks` array at the bottom of that file.
- Ante Mode's checks are the eight `ante *` entries in that same script. A change under `src/game/`
  that is gated on `isAnteMode` still needs the whole suite run, because the point of the gate is
  that the classic branches did not move.
- A change to an **Ante** rule the single-round subgame reaches — the three endings, the turn and
  reveal flow, `Call BS` and its Reverse Rule, the deal, or the action space — also needs
  `npm run check:rl:ante`, which replays rounds against the Python simulator in `rl/ante/` and will
  fail if the two have drifted. Fix the simulator in the same task: it is a transcription of this
  module and never an authority over it. If the change adds or removes a legal action, run
  `npm run check:rl:ante:env` as well, since that action space is a re-indexing of the list. The
  first needs only a Python interpreter and Node; the second needs numpy.
- A change to an Ante rule that only a **match** reaches — gold, elimination, `resizeAnteDeck`, the
  round-to-round hand-over, or `endAnteRound` itself — needs `npm run check:rl:ante:match` and
  `npm run check:rl:ante:match:env` instead, which drive whole matches rather than single rounds. The
  first runs at `--gold 1` on purpose: eliminating a seat costs five lost BS calls at the default, so
  at 5 gold the sweep and the resize are never reached and the run passes without testing them. It is
  the same code path, reached sooner, and the check now fails a multi-round run in which nobody went
  bankrupt.
- If the change touches anything the **vanilla classic** game reaches — the five actions, the turn and
  round flow, scoring, leaving, or either reveal walk — also run `npm run check:rl`. Ante never
  reaches it: the simulator in `rl/` transcribes the classic game only, and a change that is entirely
  behind `isAnteMode` cannot drift from it. That replays matches
  against the Python simulator in `rl/` and will fail if the two have drifted; fix the simulator in
  the same task, since it is a transcription of this module and never an authority over it. If the
  change adds or removes a legal action, run `npm run check:rl:env` as well, since the RL action
  space is a re-indexing of that list. Both need a Python interpreter; the second also needs numpy.
  `npm run check:rl:rnad` is the third and needs torch, but it checks R-NaD's own arithmetic rather
  than anything about the game, so a rule change never reaches it.
- When you add a character, give it a `## The X` section in `CHARACTERS.md` and a row in that file's
  roster table. The `character documentation` check fails without the section, the same way
  `character card art` fails without the sprite — an implemented character nobody can read the rules
  for is not finished.
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

**The rules themselves are not written here.** `RULES.md` and `CHARACTERS.md` are the source of truth
for what the game does; read them for behavior. This section covers only how that behavior is
implemented — move names, state fields, enforcement sites, and why the code is shaped the way it is.
Do not restate a rule here that either of those files already carries.

- The file is large and single-module by design; follow the existing helper-function style rather
  than splitting it up without being asked.
- **Game modes.** `G.gameMode` is `classic` or `ante`, decided at staging and never changed after.
  `isAnteMode` is the gate in front of every Ante branch, and `getGameMode` is its one reader, so a
  match staged before the field existed is decided to be classic in one place. Ante's constants,
  tables and sanitisers live in `src/game/blowCowAnte.ts`; the branches live here.
  - **Ante does not use the rule card system.** `G.rules` is left every-card-active there and nothing
    reads it, so a rule the two modes play differently asks `isAnteMode` rather than `isRuleRemoved`.
    Folding Ante into the rule cards was the obvious move and the wrong one: three of the rules it
    drops (`callReset`, `leaveGame`, `finalRanking`) define no `Removed` variant, and giving them one
    would hand The Broken three new rules to tear up in the classic game. The in-match Rules panel
    draws a written summary for Ante instead of the deck, because half those cards describe rules it
    does not play.
  - The mode forces four things off at `resolveDeckConfig`/`resolveUseCharacters`/`resolveRules`/
    `resolveInitialStatuses` rather than validating them away: characters, action ranks, statuses and
    rule-card edits. A host cannot reach those panels in the lobby, so this is about a hand-made room
    — and forcing them is what lets every branch downstream trust the mode alone.
  - `endAnteRound` is the single path out of an Ante round, shared by all three endings. Each caller
    decides who won, who lost and what to say; everything after — the gold, the archive line, the
    elimination sweep, the round-limit check, the deck resize, the redeal — is the same every time.
    It takes a `BlowCowHookContext` rather than a move context because one of its three callers is
    `handleTurnStart`, which is a hook.
  - The three endings are `finalizeBSResolution` (the only one that takes gold, and so the only one
    that can eliminate anybody), the `pass` move at `n` consecutive passes, and `handleTurnStart` on
    an empty hand. The last sits **above** the classic empty-hand leave branch and returns before
    `turnOpening` is written, so Take Turn is never pressed and that seat's own Reveal Rule never runs.
  - All three turn the table face up first, and the two that are not a BS call reach that through
    `beginAnteRoundEndReveal`, which raises the shared Reset walk under a new `kind` —
    `antePassEnding` or `anteEmptyHand` — with the round's winner as its `callerPlayerID`.
    `finalizeResetResolution` routes both to `endAnteRoundAfterReveal`, which is the only new exit.
    Reusing `G.resetResolution` rather than growing a third procedure is what gets the lead-in, the
    per-card flips, `hideSecretState`, the reconnect behaviour and the client's whole reveal UI for
    free; Ante has no `Call Reset`, so the field is free for it and `resolveReset` still refuses.
    The helper **refuses an empty walk**, for the reason `openTurnReveal` skips its own: a table with
    nothing face down has nothing a client can be asked to click, so the ending settles where it
    stands. That is the ordinary case for the pass ending — reaching `n` means every seat has taken a
    turn since its last play, so the Reveal Rule has already opened the whole table — and never the
    case for the empty-hand ending, whose winner's last play is by construction one the Reveal Rule
    could not reach. The pass ending therefore keeps its old immediate path as the live branch and
    writes history there; the walked branch writes telemetry at the pass and history at the finalize,
    exactly as the classic all-pass return splits them.
  - `dealAnteRound` writes no history line, because its two callers want different ones. It builds a
    fresh deck each round with a per-round `idPrefix`, since card ids are positional and two rounds
    sharing a prefix would hand the client the same id for different cards. `dealAnteHands` puts the
    remainder on the seats **latest** in turn order; see `RULES-ANTE.md` for why that direction.
  - `doesMatchScorePoints` is read by `addCardsToPlayerHand` and by `startMatchState`. Ante's rollback
    paths reach the first with a hand that was dealt without a four-of-a-kind check, so scoring on the
    way back in would delete four cards nobody played.
  - `resizeAnteDeck` only ever shrinks, and draws the ranks it keeps from the ranks currently in play,
    so a host's manual deck loses ranks from the deck they picked rather than being replaced.
  - `compareAntePlacements` inverts both of the classic terms: more gold is better, and leaving
    *later* is better, because here leaving means going bankrupt rather than shedding cards.
- Player-visible outcomes are recorded three ways, and most rule changes need all of them:
  - `appendHistoryEvent` for the in-game log (it also writes telemetry).
  - `appendArchiveTurnAction` for the replayable per-turn archive.
  - `appendTelemetryEvent` for non-history events such as `turn` and `game`.
- Adding a new archive action requires extending `BlowCowArchiveTurnActionKind`. Prefer reusing the
  existing generic fields (`cards`, `cardsByPlayer`, `detail`) over widening the schema.
- Characters live in `src/game/blowCowCharacters.ts`; their abilities are documented in
  `CHARACTERS.md`. Character-specific behavior is implemented as small predicates (`isDreamer`,
  `isPawn`, …) plus targeted branches, not subclassing.
- Rule cards live in `src/game/blowCowRules.ts`, serialized as data. Status is `active`, `removed`, or
  `upgraded` on `G.rules`, and a rule may only take a status it defines a description for.
  `normalizeRulesSelection` is the single sanitiser enforcing that, and every caller routes through it.
- **`removed` is enforced; `upgraded` is display-only.** Every removable rule has a branch at its
  enforcement site, all reached through `isRuleRemoved(state, ruleID)`. That helper optional-chains
  `state.rules` on purpose, because a match staged before rule cards existed restores without the
  field.
- The Broken (`breakRule` move): like The Seeker's pick it is not turn-bound and has no deadline, so
  `G.rules` can change mid-turn — read it at the moment of enforcement rather than caching a decision.
  `brokenRemovedRuleID` on the player is the spent flag, since breaking a rule leaves `character`
  alone.
- The Prototype (`defy` move) shares The Broken's pool through `getBreakableRuleIDs`, draws from it
  with `random.Shuffle`, and is refused when that pool is empty, so the action can never do only half
  of what its card says. The suit is one helper, `isDefyDestroyableCard`, read by both `canUseDefy`
  and `resolveDefy` — the latter before anything is removed, so a card of the wrong suit costs
  neither half nor the round's use. `hasUsedDefyThisRound` is the spent flag, cleared by
  `beginNextRound`.
- The Mastermind (`conspire` move): `G.conspiracy` is the live record; while it stands, `pass`,
  `callBS`, `callReset` and `accuseDreamer` all refuse for its owner, and `performPlay` reads the
  cards out of `conspiracy.targetPlayerID`'s hand instead of the mover's. Because there is no cancel,
  `hasUsedConspireThisRound` is spent at the peek, not at the play, and the table-room check happens
  in `resolveConspire` rather than being discovered afterwards: opening a hand that cannot be played
  out of would strand the turn with no legal move. It is the one ability that widens
  `hideSecretState` — one extra hand, for one seat, until the play clears the conspiracy.
- The Invisible Hand (`manipulate` move): `canManipulate` reads the window off `startingPlayerID`, a
  null `trumpRank`, a zero `passStreak`, and a null `lastNonPassingPlayerID` — any pass or play breaks
  all of them. Unlimited use needs no spent flag, because handing the round away is what stops the
  player being the starting player. `round.forcedPlayPlayerID` is the lock, enforced only against
  `pass` and lifted by `handleTurnStart` as soon as any other turn begins. The move leaves
  `lastNonPassingPlayerID` null on purpose, and the chosen rank obeys the Rank Change Rule through
  `getManipulableTrumpRanks`.
- Conspire and Manipulate are pressed on a player block, not in the action row: `renderSeatTargetActions`
  carries them beside `Call BS` and `Accuse`, and the block being clicked is the target. That is why
  neither has a player dropdown, and why `getConspireFailure` and `getManipulateFailure` both check
  the turn, which the old action-row tooltips never had to — a block is hoverable on anyone's turn.
  Manipulate's rank and direction selectors moved with it, so all three of its decisions are made in
  one bubble. They write one shared choice rather than one per block, and their wrapper stops click
  and key events, since the block underneath is a click-and-Enter target of its own.
- The Gambler is a rule imposed on the table rather than an action, so `isGamblerShowdownActive` reads
  the seating rather than the caller, and an all-pass `roundReturn` is never a showdown.
  `createResetShowdown` builds the standings at call time and `hideSecretState` withholds them until
  the reveal is complete, exactly as it does a BS `punishment` — which is also why `callReset` is now
  a server-only move. `beginResetPunishment` splits from `finalizeResetResolution` for the same reason
  `beginBSPunishment` does, and additionally carries the chosen seat, because a tie is the caller's to
  break; the server re-checks it against `weakestPlayerIDs`. On the client the showdown reuses the BS
  punishment travel through `activePunishment` and makes the gather-shuffle-deal chain bail out, since
  those animations belong to the redistribution it replaces.
- Poker evaluation lives in `src/game/blowCowPoker.ts`, deliberately outside the game module: it takes
  cards and returns a comparable score, with no state. `comparePokerHands` returning 0 is a real tie
  that the caller settles. The hand categories and tiebreaks are in `CHARACTERS.md`.
- The Mime (`mimic` move): `G.mimicry` changes nothing the engine reads. It is a snapshot the *client*
  draws one block from, so hands, plays, points and character all stay where they were. The snapshot is
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
- The Clown is the only character with no move of its own: `performPlay` decides the encore, and
  `G.encore` is the live record — public, turn-bound, and cleared by `handleTurnStart` exactly as a
  conspiracy is. `hasUsedClownEncoreThisRound` is spent by the play, not by the action it buys, since
  an encore cannot be declined. Two things carry the weight. `encore.bsTargetPlayerID` remembers the
  BS target from *before* the play, because the play
  makes The Clown the latest non-passing player and `getDefaultBSTargetPlayerID` would otherwise
  answer "yourself" and close the very action the encore hands back — that fallback lives in the one
  helper, so `bsTargeting.ts` imports `getEncoreBSTargetPlayerID` rather than mirroring it. And
  `isEncoreWorthTaking` refuses an encore that would buy nothing: a play is the action it takes away,
  so a kept turn with no Pass, no BS target and no full table would have no legal move left. There is
  no decline button — Pass is one, and it counts as an ordinary pass. `performPlay` also clears
  `round.forcedPlayPlayerID` now, because a lock still standing would take Pass off the encore of a
  player who has already done what it asked.
- The Thinker is a passive with no move, no limit and nothing to decline, so it hangs off
  `turn.onEnd` beside the status tick: a turn ends eleven ways and `handleTurnEnd` is where all of
  them meet. It sits **above** the `isRuleRemoved(G, 'status')` early return, because that rule
  governs the counter and not a character. `getThinkerPoints` is the whole rule, kept separate so the
  three branches can be read in the order the card writes them; a no-op is not logged. `hasLeft` is
  the one guard: a player who has left takes no further turns, so the only end this could still reach
  is the one straight after `markPlayerLeft`, and `applyLeaveCharacterEffect` is meant to have the
  last word on a final total. The archive kind is `recalculatePoints`; it moves `points` without
  touching `scoredSets`, so a Thinker's scored-ranks tooltip deliberately stops adding up to their
  total.
- Every other points-on-leaving character resolves in `applyLeaveCharacterEffect`, one early-returning
  branch each, so a seat takes at most one leave effect. `recordLeaveCharacterEffect` writes the delta
  and the label together, which is what stops the seat label and the results tooltip drifting.
- A turn no longer arrives ready to play. `handleTurnStart` writes `G.turnOpening` naming the seat on
  the clock, and the `takeTurn` move is what opens it. The record has two halves and they are read
  separately everywhere. Untaken, `isAwaitingTurnTake` refuses **that one seat's turn actions** —
  nine sites, all of which already checked `ctx.currentPlayer` — and nothing else: the cheats are
  defined by being out of turn, `Accuse` is not turn-bound, and a table cannot be made to wait on a
  button nobody has pressed yet. Taken with a live `reveal`, `isTurnRevealRunning` makes it a fourth
  procedure inside `isProcedureRunning`, holding the whole table exactly as a BS walk does. It is
  written last in `handleTurnStart`, after the empty-hand leave branch, so a seat that leaves at the
  start of its turn is never handed one.
- The Reveal Rule is performed by hand now. `openTurnReveal` decides what the turn owes **at the
  press** rather than at the turn's start, so a card palmed off the table in between is never one it
  asks for, and publishes `reveal.cardIDs` — exactly the cards the player may flip. For The Spy that
  is one card the server draws with `random.Shuffle`, which is what keeps their ability random rather
  than a choice, and why `takeTurn` is `client: false`. `revealTurnCard` flips one, `finalizeTurnReveal`
  is Continue and writes the history and archive entries through `completeTurnReveal`. Four cases skip
  the walk and write the same thing immediately: no pending play, the rule removed, a pile already
  face up, and a play The Mime's disguise is not drawing — a card that is not on screen is not one a
  client can be asked to click. The turn reveal is the one procedure that does **not** call
  `clearMimicry`: it is not raised by anybody, and a disguise that came off every turn would not be a
  disguise.
- On the client the walk reuses `focusedSeatID` and `.focused-seat`, with no lead-in — nothing is
  drawn between the press and the travel, and `isProcedureRunning` already refuses every move that
  could start a measuring sequence. Its Continue is a separate branch of `renderSeatRevealActions`
  with its own completion test, because it waits on the cards the turn owed rather than on everything
  the seat has face down. Blind is deliberately not lifted for it, unlike a BS or Reset reveal: there
  is no challenge to resolve, so a blind player opens their cards for the table and still cannot read
  them. `.take-turn-cover` is a sibling of `.hand-stage`, not a child, and `take-turn-open` lifts the
  whole strip above the ring — `.hand-stage` isolates its own stacking context, and the viewing
  player's block is dropped into this strip from above.
- The Cat owns the direction flip as well as the table-card flip. `resolveToggleDirection` reads
  `isCat`, and its own-turn flip is the only legal one — every other flip is a tamper, cheat licence
  or not. The Contrarian no longer touches the direction at all.
- The Privileged's claim runs through `getPrivilegedStartingPlayerID`, which reads
  `wasPunishedLastRound` so the seat that earned the start by beating them actually keeps it. That
  flag is read while the new round is being set up, so it measures the round that just ended.
- The Contrarian is applied in `createBSResolution` and nowhere else. It is a layer, not an override,
  so the two are combined as `reverseRuleTriggered !== contrarianTriggered`. It is bound to
  `callerPlayerID`. Nothing in the UI needed adding: `Punish` is already rendered on
  `punishment.punishedPlayerID`'s block, so moving that field moves the button. Keep
  `contrarianTriggered` optional-tolerant when reading it — a match staged before this existed
  restores a punishment record without the field.
- Cheating is gated by one helper, `canCheat`. Every one of the six cheats routes through it,
  permission and detection alike, so the licence and the accusation window can never disagree about
  who is answerable. `isDreamer` survives only where the question really is "is this seat The
  Dreamer" — archive labelling, and nothing else.
- The take-back (`takeBackCard` move) is recorded in the same silence as the sneak play: archive only,
  no history, no telemetry, and `tableStatus` deliberately left stale so nothing re-announces it. It
  is the one cheat that leaves *nothing* on the table to inspect, which is why `G.takeBackTamper` has
  to exist for `getAccusableCheat` to read; a
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
  Dreamer. That is deliberate — `RULES.md` is where the six are written down; the card is what every
  seat can open.
- `BlowCowTablePlay.claimedRank` is nullable for exactly one case: a card sneaked onto the table
  before the round had a trump rank. `settleUnclaimedPlays` fills it in wherever `round.trumpRank`
  goes from null to a rank — the trump-selecting play and Manipulate — and counts the lie there,
  since until a rank exists there is nothing to have lied about. Nothing reads that null in between:
  the play callout is already suppressed for a sneak, a BS call needs a live trump, and a sneak is
  never a pending reveal. A new reader of `claimedRank` should still handle null rather than assume
  those three hold.
- The action ranks (`BLOW_COW_SPECIAL_RANKS`) are the reason `BlowCowRank` still means the standard
  thirteen. Widening it was the obvious move and the wrong one: every reader of a trump rank —
  selection, Manipulate, the Rank Change Rule, `claimedRank`, `BlowCowMimicry.pointRanks` — is typed
  against it, so "these ranks can never be trump" is carried by the type instead of by a dozen
  filters. Only `card.rank` is `BlowCowCardRank`, which is wide enough to hold one. The one runtime
  guard that had to be added is in `validateCommonPlay`, which never checked that the rank it was
  handed was a rank at all; `resolveManipulate` always did.
- No-point removal is not a field. `doesScoredSetAwardPoint` reads it back off `scoredSet.rank`, which
  is what keeps a match archived before action ranks existed from needing a flag nobody wrote. Two
  readers care: `scoreHand`'s `pointsAwarded`, and `getPointScoringRanks` for the seat tooltip — the
  tooltip drops them, so it goes on being a reading of the number beside it.
- The three effects all fire from `applyRevealedSpecialCards`, called by `completeTurnReveal` and so
  reached by both the pressed walk and the automatic paths inside `openTurnReveal`. That single site
  is what makes "revealed by the Reveal Rule" the whole trigger: a BS walk, a Reset showdown, The Cat
  and an accusation all reach the table without passing through it, so none of them needs a check.
  It reads `reveal.cardIDs` rather than the pile, so a card already face up when the turn opened does
  nothing and The Spy's held-back card stays inert. Each rank counts its own targets through
  `getNextActivePlayerIDsInOrder`, independently of the others — which is why they need no resolution
  order — and that walk deliberately does not exclude the revealer, since on a two-player table the
  second seat round is them.
- `finalizeTurnReveal` is `client: false` now, for the two reasons `takeTurn` already was: Plague
  rolls its status out of `random`, and Peek unmasks hands the client's own `G` does not hold.
- `round.skippedPlayerIDs` is seats rather than a count, so the board can mark them and the log can
  name them. It is spent by `resolveSkippedTurnHandover` inside `advanceTurn` — the one hand-over a
  Skip buys — and cleared again by `handleTurnStart` for every other way a turn ends. `G.handPeek` is
  the second field the Reveal Rule writes, and the second place `hideSecretState` unmasks a hand that
  is not the viewer's; it is deliberately *not* a procedure, because nothing waits on it. Both are
  optional-tolerant for the usual restore reason.
- Gold is a third number on the seat block and nothing else yet. `BLOW_COW_STARTING_GOLD` is dealt
  with the seat in `createEmptyPlayerState`, and no move, rule, or character reads it back.
  `player.gold` is optional and `getPlayerGold` is its one reader, the way `getPlayerStatuses` is for
  `statuses`, so what a seat staged before the field existed is worth is decided in one place.
  `BlowCowMimicry` copies it beside the points — it buys nothing, but a disguise showing The Mime's
  own purse would be two blocks differing in exactly one number. It needs no `hideSecretState` branch
  and no archive change: it is public, and it never moves.
- Status effects live in `src/game/blowCowStatuses.ts`: temporary, public, per-player modifiers
  serialized as data, at most `BLOW_COW_MAX_STATUSES_PER_PLAYER` per seat, each carrying a counter.
  `normalizeStatusSelection` and `normalizeStatusTurns` are the single sanitisers, the way
  `normalizeRulesSelection` is for rule cards. Every enforcement site asks `hasStatus`, never
  `getPlayerStatuses` — that helper is the one reader of the optional `player.statuses` field, and
  keeping the question in one place is what stops what a status forbids and what the seat block draws
  from disagreeing. `addPlayerStatus` is the one door in, and it enforces the cap.
- The Tilted/Worried opposition lives in `getOpposedStatusID` as a two-way map and is enforced in
  `addPlayerStatus` **before** the cap, so an immunity and a full seat stay distinguishable.
  `startMatchState` deals the lobby's selection one status at a time through `addPlayerStatus` rather
  than assigning the array, so the opposition applies to the testing lever too.
- The status counter ticks on **`turn.onEnd`**, the only hook hanging off it and the only one in the
  game. `advanceTurn` covers just play and pass; a turn also ends through nine direct `events.endTurn`
  calls, and `onEnd` is where all of them meet. `G.round.startedTurnNumber`, stamped by
  `handleTurnStart`, is the guard: `startMatch` flips `gameStatus` to `active` and *then* ends the
  staging turn, so a turn that never opened must not spend a counter. `beginNextRound` deliberately
  leaves statuses alone — they are counted in turns, not rounds.
- The tick is the Status Rule, and `handleTurnEnd` is its one enforcement site. It is read at the tick
  rather than where a status is handed out, because the rule can be torn up mid-match and freezing
  whatever counters are standing at that moment is the whole effect.
- Each status is enforced at exactly one server site: Tilted in the `pass` move, Worried in
  `validateCommonPlay` (which is the gate in front of all three play moves, and deliberately not in
  front of the cheats), Mad and Nervous in `performPlay` right after `wasHonest` is computed —
  restoring the hand on refusal, the way the missing-rank branch above them does — and Broken inside
  `resolveDrunkardRandomPlay`, which it opens to a non-Drunkard and forces down to one card. Blind is
  the exception: it is a pure display effect in `BlowCowBoard.tsx`, swapping face-up table cards for
  `unknown.png` and lifted during BS and Reset reveals. Nothing secret is trusted to the client by
  it — those cards are already public to every other seat.
- `BlowCowMimicry` copies the source's `statuses` along with their hand count and points, because a
  disguise that showed The Mime's own status column would be two identical blocks differing in the
  one place the illusion has to hold.
- A revealed Plague is the one thing in the game that inflicts a status. Everything else comes from
  the lobby's Initial Statuses panel — a testing lever, carried by `initialStatuses` and
  `initialStatusTurns` on `BlowCowSetupData` and dealt out by `startMatchState`. Both go in through
  `addPlayerStatus`, so the cap and the Tilted/Worried opposition apply to the card as well; a roll
  that will not land is logged and not re-rolled.
- Removing a rule takes any ability built on it with it. That is a consequence of the removal, not a
  special case, so it needs no branch of its own — see the interaction list in `CHARACTERS.md`.

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
- Character card sprites already contain the character name and description, and are now the *only*
  place a character's ability is written for a player. There is no description table in
  `src/game/blowCowCharacters.ts` — it existed solely for a lobby tooltip that the full-size card
  preview replaced, and a second copy in code could drift from the art silently. `Characters.csv` and
  `CHARACTERS.md` are where the wording is authored. Do not reintroduce ability text in the UI unless
  explicitly requested; show the card instead. Because of that, shipping an implemented character
  without art leaves it unreadable rather than merely plain, which is what the `character card art`
  check guards. Rule cards are the one exception to all of this: their illustrations carry no text, so
  the Rules panel renders the title and description itself.
- Sprite folders live at the repo root, not in `public/`, and are loaded via `import.meta.glob`:
  `card_sprites/`, `rect_card_sprites/`, `character_card_sprites/`, `avatar_sprites/`,
  `rule_card_sprites/`, `status_sprites/`.
- **Tooltips are one shared layer, not a per-component pattern.** `src/ui/Tooltip.tsx` renders a
  single box portalled to `document.body`; `useTooltip` in `src/ui/tooltipContext.ts` returns a
  builder that turns any element into a trigger. Never write a `position: absolute` tooltip span with
  a `:hover` rule again — six of those existed, and the whole point of the layer is that a tooltip
  lives outside its opener's `overflow` and stacking context (`.hand-stage` was clipping the action
  row's) and is placed against the viewport rather than against whatever opened it.
  - Content is `{ title, description }` and nothing else. `description` is a `ReactNode`, which is how
    the seat status column keeps its sprite rows.
  - The builder is a builder because most triggers are inside a `.map`, and a hook cannot be called
    in a loop. `useTooltip()` once per component; `{...tooltip(content)}` as many times as needed.
    Passing null builds nothing, so a per-item decision needs no branch around the spread.
  - Attach it to the element the pointer reaches. A disabled `<button>` dispatches no pointer events,
    which is why the action row's tooltip is on `.action-button-item` rather than on the button — a
    disabled action is exactly when its description is worth reading.
  - It closes on scroll, resize, and a mouse `pointerdown`. The last one is load-bearing: an element
    removed while hovered never fires `pointerleave`, and playing a card out of the hand does that.
  - The box is always mounted so `aria-describedby` always resolves, and hidden with `visibility`
    rather than `display` so it can still be measured while closed.
- `src/ui/specialRankInfo.ts` is where an action rank's effect is written for players, and the only
  place in the app it is written at all — the sprites carry no text and there is no full-size preview
  the way a character card has. Three surfaces read it: the lobby's toggles, a card in hand, and a
  card face up in front of a seat. Both card surfaces derive the rank from the sprite filename
  through `getSpecialRankFromSprite`, which is what makes a face-down card and a Blind-masked one
  explain nothing without either having to check a flag.
- `src/ui/SeatStatusColumn.tsx` draws a seat's statuses beside its avatar. It is absolutely
  positioned inside `.seat-block-top` because the block's height feeds the ring radii, and its one
  tooltip covers the whole stack rather than one bubble per badge. It no longer places that tooltip
  itself: the shared layer measures the viewport, so the hub-facing `[data-seat-half]` rules it used
  to need are gone. The action bubble still stands down while the column is hovered, since both want
  that side.
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

- `src/game/` — rules, helpers, character definitions, rule card definitions, status definitions,
  poker evaluation, Ante Mode's constants and tables (`blowCowAnte.ts`).
- `src/ui/` — board UI and sprite helpers.
- `src/bots/` — the practice bots offered in room staging. `blowCowBotPolicy.ts` decides one move at
  a time and is a port of the *decisions* in `rl/blowcow/agents.py`, not of its flat action space;
  `blowCowBotSeating.ts` is the gate; `useBotSeats.ts` runs each bot as a headless
  boardgame.io client in the host's tab, so a bot is a real player with its own seat, credentials and
  `playerView` rather than privileged code inside the server.
  - **Seat repairs.** A seat can stop acting in ways the rules know nothing about, and `G` goes on
    dealing it turns in every one of them: there is no forfeit move, so an unplayed chair stalls the
    table rather than being skipped. Four repairs hang off the seat's own block on the table page,
    decided by `getSeatRepair` in `BlowCowBoard.tsx` off the **polled room roster** rather than off
    `G`, which cannot see any of this. All four are open to every player rather than to the host,
    whose tab is the likeliest one to have gone.
    - `refreshBot` — stop the headless client and start a new one on the same credentials. The cheap
      one and the first to reach for: it fixes the plumbing (a dropped socket, a stopped
      subscription, an Ante weight fetch that failed, a `lastSentKey` holding a move that never
      landed) and touches no server route, so it cannot fail or cost the seat. It fixes nothing about
      a policy that has no move for the state on the table, which makes it the diagnostic as well —
      a bot still frozen after a refresh is a `blowCowBotPolicy.ts` bug.
    - `replaceBot` — leave the seat and rejoin it in one step, seating a fresh bot of the same kind.
      The hard reset. It is one step on purpose: a bare kick leaves a chair that stalls the match, so
      the leave and the rejoin must not be separable in the UI.
    - `resumeBot` — take over a bot whose tab has gone, through the `/rejoin` route, which is the
      same one a human uses on their own chair and carries the same two protections (the name must
      match, the seat must actually be disconnected). The *kind* is the one thing that has to be
      recovered rather than restarted, and `getBotKindFromSeatName` reads it back off the seat name,
      which is why `getBotSeatName` encodes it there.
    - `seatBot` — claim an empty chair by its own `playerID`. The safety net under `replaceBot`, and
      also the fix for a human who left the room without leaving the game, which stalls a seat the
      same way. It names the bot off the seat number rather than off a roster count, since any tab
      can press it and two counting their own rosters would collide.
    - Nothing else has to be carried across any of these: a bot policy holds no state between
      decisions. Note that a player who resumes or seats bots and then presses `Leave Room` releases
      those seats outright, as a host always has — the teardown in `useBotSeats` leaves the match for
      every bot it is running.
- `src/bots/ante/` — the **Ante** bot, which runs a trained network in the browser rather than a
  scripted policy. The network is fixed-width, so there is one weight blob per seat count *per
  policy*, and `ANTE_AGENT_SUPPORTED_SEATS` in `anteSpaces.ts` names the counts that ship — currently
  all of 2-8. Six modules, and they split the way the Python does: `anteSpaces.ts` is `config.py` plus
  `spaces.py`, `anteObservation.ts` is `observation.py` reading a real `G`, `anteMatchObservation.ts`
  is `match_observation.py` doing the same for the match block, `anteNet.ts` is `nets.py`'s forward
  pass over `Float32Array`, `anteWeights.ts` registers the blobs and picks between them, and
  `anteBotPolicy.ts` turns a sampled action index into a move. Procedures are **not** re-implemented —
  `chooseProcedureMove` is exported from the classic policy and reused, because Take Turn and the
  reveal walks are not choices and Ante drives them through the same records.
  - **Two policies, and the staged room picks one.** `pickAnteWeights` returns the **match** network
    when the room is staged at the config it was trained for — 20 rounds and 5 starting gold — and the
    **round** network otherwise. That gate is not a nicety: the match block normalises `rounds_left`
    and every gold column by exactly those two numbers, so any other room would feed it inputs outside
    the range it was fitted on. It mirrors the refusal `rl/ante/match_agents.py` makes on the Python
    side, and the fallback is a real fallback — the round policy is what shipped before and plays every
    room legally. `loadAnteRoundNet` caches by asset rather than by seat count, so a tab holding two
    rooms at different configs keeps both.
  - Which checkpoint is behind each blob is stamped in its manifest's `source`, which is the thing to
    read rather than this list. Today: match is `rl/runs/_chal/chal-2p-s2` at 2 seats,
    `rl/runs/_lie_pool/lp-head-s2` at 5, `rl/runs/_lp2/lp2-4p-s2` at 4, `rl/runs/m3r-6p-s1` at 6,
    `rl/runs/m4-3p-s3` at 3, and `rl/runs/m2-<n>p` at 7 and 8; round is `rl/runs/ante-s2-long` at
    5 seats, `rl/runs/_round_fix/r{6-ctrl-s1,7-ctrl-s1,8-e04-s1}` at 6, 7 and 8, and
    `rl/runs/ante-<n>p-v1` elsewhere. The `m3r` arms — generation two plus 2M further decisions of
    their own recipe, warm-started from it rather than from the round agent — held 2 and 6 seats for
    a while and 6 still does, because
    they beat generation two in both head-to-head directions, kept the mixed table, and measured
    safer than it by more than the 2.1-gold exploiter noise floor: **+16.230** against +19.770 at 2,
    and **+1.510** against +6.614 at 6.
    **Two seats has since been replaced by the first arm carrying the *challenge* head**
    (`--challenge-coef`, "will the play I am about to make be challenged" — see `rl/ANTE.md`).
    `chal-2p-s2` beats `m3r-2p-s3` two-sided, beats its own same-seed ablation two-sided, and beats
    both rival candidates in a peer head-to-head (`chal-2p-s3` +3.778/−3.706, `_lp2/lp2-2p-s2`
    +2.485/−2.842) — which reversed the ranking those arms had against the incumbent, the sixth time
    a score against a shared reference has ranked candidates backwards here. Exploitability is a tie:
    +11.065 and +14.925 at two exploiter seeds against the old arm's +16.230, and **that 3.86-gold
    spread on one unchanged checkpoint is itself the finding** — the 2.1-gold floor quoted throughout
    is a *five-seat* number and is too small at two.
    **Five seats has since been replaced, and by the first arm in the package that carries the
    honesty head.** `lp-head-s2` is `m3r-5p-s2`'s own recipe with `--lie-coef 1.0` and a pool widened
    with **unrelated lineages** — five checkpoints sharing no ancestor with it, and deliberately not
    its own predecessor, which is the widening that failed as `m3-5p`. It beats `m3r-5p-s2` at all
    three seeds two-sided, wins both the bluffy and the low-bluff mixed table 6 of 6 where its own
    no-head control fails the second 2 of 6, and its exploitability is **+2.289** against the old
    arm's **+2.954** — a tie against the 2.1 floor, and a tie in the new arm's favour. (That old arm
    was recorded at +1.577; re-measuring found that figure came from an exploiter which bluffed 0.2%
    and had converged on nothing. Treat any exploitability row whose exploiter finished near 0%
    bluffing as unmeasured.) The head
    is **training-time only**: `lie_to_policy` is off, so `export_ante_round.py` drops the
    `lie_head.*` tensors and `anteNet.ts` needed nothing. Verified bit-identical on this checkpoint —
    600 positions, 0.0 change in logits and value. `rl/ANTE.md` has the cohort.
    **Both auxiliary heads are training-time only and neither reaches the browser.** The challenge
    head has no `lie_to_policy` equivalent at all — it feeds nothing by construction — so
    `export_ante_round.py` drops `challenge_head.*` the same way and `challenge head` in
    `ante_match_check.py` holds the network to being bit-identical in policy and value with it
    present. A new head therefore needs three edits and no browser change: build it in `AnteNet`,
    teach `infer_head_options` to read it back off the tensors, and add its prefix to the exporter's
    drop list. `dump_ante_bot_cases.py` builds its own `AnteNet` too and will refuse the checkpoint
    outright if it is forgotten there — which is the right place for that to surface.
    **Four seats has since been replaced too, by that same recipe transferred (`_lp2/`), and it is
    the cleanest shipping case in the package.** `lp2-4p-s2` beats the generation-two arm it replaces
    two-sided (+0.644 / −1.148), beats `m3r-4p-s1` — the strongest 4-seat checkpoint on disk — two-sided
    (+1.609 / −1.397), leads a peer table with the old arm removed, and is **+2.420 exploitable against
    `m2-4p`'s +6.822**, the only gain outside the 2.1 floor that cohort produced. `m2-4p` was the last
    generation-two arm anywhere in the ship list and was bankrupt in 11.8-19.8% of matches. One caveat
    worth knowing rather than hiding: a broad pool **sells** specialisation against the one-round agent
    — `lp2-4p-s2` is behind it attacking where `m2-4p` took +4.624 off it — which costs nothing at
    20 rounds / 5 gold, because `pickAnteWeights` seats the match network for every bot there and a
    round policy is never at that table.
    **Three seats shipped on a different reading, deliberately.** `m4-3p-s3` adds `xg2-3p` to the
    pool, and it is the first trained agent at that count to beat the *untrained* round agent
    two-sided, on top of beating generation two and the recursion and winning the mixed table. Its
    exploitability is 16.020 against `m2-3p`'s 15.578 — a 0.44-gold difference against a 2.1-gold
    floor, so a tie rather than the improvement the bar asks for. It ships because that clause
    exists to stop a bully being shipped on head-to-head strength alone, which is what `m2-5p` was
    at +13.578, and an agent that dominates on play while matching on risk is not that case. Do not
    read it as the bar being relaxed: at 3 seats exploitability looks structural — five procedures
    including no training at all land between 14.965 and 17.510 — so a future arm there should be
    expected to move play quality and not safety.
    Four, seven and eight seats trained three arms each and shipped none, which is the ordinary
    outcome and not a gap to be filled: 4 seats tied on exploitability, and 7 and 8 lost the mixed
    table with incumbents already at 1.174 and 3.726. `rl/ANTE.md` has the protocols and the
    per-count findings.
    **Do not read `_gen2/SHIPLIST.txt`'s 6-seat row.** It records `m2-6p` at −0.428 exploitability,
    the safest figure in the package, and that number came from an exploiter that collapsed —
    `xg2-6p` finished at 0.00% calling, 0.45% bluffing and `explained_variance` 0.19, losing to its
    own target. Re-measured it is +6.614. A negative `gold_edge` is a failed run rather than a sound
    target, and an exploiter that neither calls nor bluffs has measured nothing. The rest of that
    file re-measures fine: `m2-7p` and `m2-8p` were re-run on suspicion and came back at +1.174 and
    +3.726 against a recorded +1.778 and +3.776. `rl/ANTE.md` has the checks, including why low
    `explained_variance` on its own turned out not to be one.
    Two seats shipped the first-generation `rl/runs/m-2p` for a while, and it was a missed
    re-export rather than a choice: `m2-2p` beats it 95-96% of matches in both directions at two
    seeds, and `m-2p` goes bankrupt in ~8% of them where `m2-2p` goes bankrupt in none. That gap is
    the thin `--pool-init` the first generation was trained against, which is the same defect
    `rl/ANTE.md` records at every other count.
  - The weights live in `model_weights/`, produced by `rl/export_ante_round.py` — which exports both
    kinds, the match one carrying `extraWidth`, `valueScale`, `roundLimit` and `startingGold` where
    the round one writes `0`/`1.0`/`null`. `npm run rl:ante:export[:match][:<n>p]` wraps it for both.
    All of them are fetched on demand, so
    a room that seats no Ante bot never downloads any.
  - **The port is checked, not argued about, and both halves are.** `npm run check:ante:bot` holds the
    network, every observation feature and every mask bit to fixtures dumped from the Python
    (`npm run rl:ante:dump-bot-cases`); `npm run check:ante:bot:play` plays whole matches through the
    real reducer, handing each seat its own `playerView`, and asserts no move is ever refused. Run both
    after touching anything under `src/bots/ante/`, and regenerate the fixtures after retraining or
    re-exporting. The second is the only thing covering the `G`-to-observation adapter, which has no
    fixture: the failure it exists for is a bot that plays *legally and badly*, which nothing else
    would catch.
  - The `:match` variants of all four (`check:ante:bot:match[:<n>p]`,
    `check:ante:bot:play:match[:<n>p]`, `rl:ante:dump-match-cases[:<n>p]`) point the same three layers
    at the **match** blobs, and the fixture then carries a `match block` section holding
    `anteMatchObservation.ts`'s 98 features to `ante/match_observation.py`. Run the match variants for
    the seat counts a change reaches, not only the default five — the one bug this has caught so far
    was invisible at five seats and showed up at four.
  - That bug is worth knowing, because the shape of it recurs: the encoder's **row 0 is not the
    viewer**. It is only while the viewer is seated in a live round, which is the sole case a bot
    encodes for *itself* — so the port read `gold[viewer]` and `records[viewer]` off `seats[0]` and
    agreed with the Python everywhere a bot would ever look. The Python encodes every seat's view of
    every position, a bankrupt seat included, and there row 0 is somebody else. `AnteMatchView` now
    carries `viewer` and `viewerRowIndex` explicitly, and the fixture dumps both. The self-blanked lie
    columns stay keyed on **row 0** rather than on the viewer, because row 0 is what the Python's
    `offset > 0` blanks.
  - **There is no gold guard, and that is a measured decision rather than an omission.**
    `applyGoldGuard` used to decline any `Call BS` the policy was under 60% sure of while it held 2
    gold or less. `guard:<path>` and `guard-round:<path>` in `rl/ante/match_agents.py` transcribe it
    so it can be priced by seating a guarded copy beside a bare one: in front of a match policy it is
    a wash at every seat count, and in front of the round policy it is *worse than nothing* at four of
    six, raising bankruptcy from ~2% to 33-41% at five seats. Refusing to challenge closes the main
    route back up while leaving every route down open, so it made low gold an absorbing state. The
    `guard:` specs stay so a future variant can be measured the same way; do not add a clamp on that
    decision without doing so. `rl/ANTE.md` has the table.
- `src/App.tsx`, `src/config.ts` — lobby flow and client configuration.
- `server/server.cjs` — local server runtime, including the custom `/games/:name/:id/rejoin` route,
  the persistent match store, and the abandoned-match sweeper.
- `server/completedGameArchive.ts` — archives finished matches to `data/completed-games/`.
- `scripts/check-blowcow-gameplay.ts` — targeted gameplay checks.
- `rl/` — reinforcement learning for the **vanilla classic** game (characters off, no action ranks, no
  statuses, all rules active, and never Ante): a headless Python simulator, a self-play environment over it, two
  trainers, scripted baselines, and `rl/oracle/blowcow-oracle.ts`, a JSONL driver over the real
  engine. `rl/train_ppo.py` is PPO against a pool of frozen snapshots and also owns the `--exploiter`
  measurement; `rl/train_rnad.py` subclasses it for R-NaD, which is why `Trainer` carries the
  `_log_ratios`, `_regularise`, `_losses` and `_after_update` seams. Play-time search lives in
  `rl/blowcow/ismcts.py`; `rl/blowcow/lookahead.py` beside it is a recorded negative result, kept
  because a negative result is only worth keeping if the code behind it was correct. Four check
  scripts, each holding one layer to the one below it: `rl/conformance.py` plays the simulator and
  the engine in lockstep, `rl/check_env.py` holds the encoding to the simulator, `rl/check_rnad.py`
  holds R-NaD's transform and update to their closed forms, and `rl/check_ismcts.py` holds the search
  to being legal and read-only. It is a consumer of the game module and never a second source of
  truth for a rule; see `rl/README.md`.
- `rl/ante/` — the same idea for **Ante Mode at five seats**, kept in its own package because Ante
  drops characters, rule cards, statuses, action ranks, cheating, points, the table limit and
  `Call Reset`, so almost nothing in `rl/blowcow/` would have survived the trip. Its reward is
  `RULES-ANTE.md`'s own gold, so a round is terminal in a handful of turns — a direct attack on the
  credit-assignment bottleneck the classic work ended on. See `rl/ANTE.md`.
  - **One round** is `ante/game.py` plus `observation.py`/`env.py`/`agents.py`, checked by
    `ante_check.py` and trained by `ante_train.py`. That layer is **finished and frozen**: it is the
    control every multi-round result is read against, so do not edit it to serve the layer above.
  - **A whole match** is `ante/match.py` (gold, elimination, the deck resize, the cross-round public
    record) plus `match_observation.py`/`match_env.py`/`match_agents.py`, checked by
    `ante_match_check.py` and trained by `ante_match_train.py`. The match encoder **appends** its 98
    features after the round's 200 rather than reworking them, which is what keeps a one-round
    checkpoint loadable — `match_agents.RoundOnlyAgent` seats one by slicing that prefix, and the
    `round slice` check holds the two encoders to producing the identical block.
  - `ante_conformance.py` covers both: `--rounds 1` is the round, `--rounds N` drives whole matches
    including the elimination sweep and `resizeAnteDeck`.
  - `rl/oracle/blowcow-oracle.ts` is shared: it takes three optional Ante setup fields and emits two
    extra projection keys **only** for an Ante match, so the classic conformance run is untouched.
- `BlowCowEngine.clone` in `rl/blowcow/engine.py` is hand-rolled rather than `copy.deepcopy`, which
  profiling put at two thirds of an ISMCTS search. `_copy_record` walks `__slots__` so a field added
  to `rl/blowcow/state.py` is copied without anyone remembering it exists, and `PublicEvent` is
  frozen so the public trace can be shared rather than rebuilt — do not give it a mutating method.
  The `clone independence` check scrambles a clone to destruction and requires the original to be
  untouched; it also refuses to pass if a field was null in every sample, which is what stops it
  going quietly vacuous the way its first version did.
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
  They differ whenever The Broken removed a rule, so neither replaces the other. `initial.deckConfig`
  and `endgame.deckConfig` are the same pairing for the deck: only Ante ever moves it, trimming a
  rank count at every elimination, so in a classic match the two are identical.
- `gameMode`, `roundLimit`, `startingGold`, per-player `initialGold`/`gold`, and `goldByPlayer` are
  additive within `schemaVersion` 1. A reader that predates Ante Mode sees keys it does not know
  rather than a changed shape, and a classic match's gold is an untouched `5` throughout.
- Action ranks needed no archive change: `deckConfig` is cloned wholesale so `specialRanks` rides
  along, and a scored set's `rank` is spread rather than narrowed. Both are additive within
  `schemaVersion` 1 — a reader that predates them sees a key it does not know, not a changed shape.
- `bsTargetCount`/`bsTargetWinCount` on `matchStats` and `goldByPlayer` on a telemetry event are the
  same kind of addition. `matchStats` is cloned wholesale into the per-match snapshot, so only the
  compact `player-games.ndjson` line had to name the two new counters.

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
