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
- The Prototype (`defy` move) destroys a hand card and a random rule card, once per round, without
  ending the turn. It shares The Broken's pool through `getBreakableRuleIDs`, draws from it with
  `random.Shuffle`, and is refused when that pool is empty, so the action can never do only half of
  what its card says. `hasUsedDefyThisRound` is the spent flag, cleared by `beginNextRound`.
- The Mastermind (`conspire` move) opens another player's hand and commits the turn to a play out of
  it, once per round. `G.conspiracy` is the live record; while it stands, `pass`, `callBS`,
  `callReset` and `accuseDreamer` all refuse for its owner, and `performPlay` reads the cards out of
  `conspiracy.targetPlayerID`'s hand instead of the mover's. The play is still the mover's in every
  other respect — it lands in front of them, and they answer the BS call it draws. There is no
  cancel, so `hasUsedConspireThisRound` is spent at the peek, not at the play, and the table-room
  check happens in `resolveConspire` rather than being discovered afterwards: opening a hand that
  cannot be played out of would strand the turn with no legal move. It is the one ability that widens
  `hideSecretState` — one extra hand, for one seat, until the play clears the conspiracy.
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
- Character sprite filename matching tolerates suffixes after the name, such as `The Cat 2.png`,
  because there a suffix only ever means a newer revision of the same art.
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

- `src/game/` — rules, helpers, character definitions, rule card definitions.
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
