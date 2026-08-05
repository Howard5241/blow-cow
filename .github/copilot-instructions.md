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
- Character sprites live under `character_card_sprites/` and rule illustrations under `rule_card_sprites/`. Character filename matching tolerates suffixes after the name, such as `The Cat 2.png`, where a suffix only means a newer revision. Rule sprites are the exception: a `Reverse Rule 2.png` beside a `Reverse Rule.png` is the upgraded illustration, so `getRuleCardSprite(title, isUpgraded)` looks the two up separately. A missing rule sprite renders a placeholder tile.
- Sprite folders live at the repository root, not in `public/`, and are loaded through `import.meta.glob`: `card_sprites/`, `rect_card_sprites/`, `character_card_sprites/`, `avatar_sprites/`, and `rule_card_sprites/`.
- Rule cards live in `src/game/blowCowRules.ts`: the game's rules serialized as data so they can be shown to players and changed by a character. Each rule's status is `active`, `removed`, or `upgraded`, stored on `G.rules`, and a rule may only take a status it defines a description for.
- `removed` is enforced through `isRuleRemoved(state, ruleID)`, which every enforcement site calls. `upgraded` is not enforced yet and stays display-only. The helper optional-chains `state.rules` because a match staged before rule cards existed restores without the field.
- The Broken removes one rule at the start of the game via the `breakRule` move. It is not turn-bound and has no deadline, so `G.rules` can change mid-turn; read it at the moment of enforcement rather than caching. `brokenRemovedRuleID` on the player is the spent flag.
- The Prototype destroys one hand card and one random rule card via the `defy` move, once per round, without ending the turn. It draws from the same `getBreakableRuleIDs` pool The Broken picks from and is refused when that pool is empty. `hasUsedDefyThisRound` is the spent flag, cleared by `beginNextRound`.
- The Mastermind opens another player's hand via the `conspire` move, once per round, and commits the turn to a play out of it. `G.conspiracy` is the live record; while it stands, `pass`, `callBS`, `callReset`, and `accuseDreamer` refuse for its owner, and `performPlay` takes the cards from `conspiracy.targetPlayerID`'s hand while the play still belongs to the mover. There is no cancel, so `hasUsedConspireThisRound` is spent at the peek. It is the one ability that widens `hideSecretState`: one extra hand, for one seat, until the play clears the conspiracy.
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
