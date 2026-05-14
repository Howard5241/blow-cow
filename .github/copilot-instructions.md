# Project Guidelines

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
- Run the targeted gameplay checks with `npm run check:gameplay`.
- In PowerShell, if port `8000` is already in use, start the server on a different port with `$env:PORT=8001; npm run dev:server`.

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
- Character card sprites already include the character name and description, so the UI should not duplicate that description text outside the sprite unless explicitly requested.
- Character sprites live under `character_card_sprites/`, and filename matching should tolerate suffixes after the character name, such as `The Cat 2.png`.

## UI Documentation
- Before making frontend or layout changes, read the relevant page docs under `docs/ui-pages/` to understand the current page structure, element aliases, and UI relationships.
- When a frontend change alters a documented page's structure, major UI elements, element roles, or visible relationships, update the matching file in `docs/ui-pages/` in the same task so the documentation stays in sync.
- If a new top-level page or equivalent major page state is added, create a matching Markdown document under `docs/ui-pages/`.

## Code Organization
- Prefer small focused modules.
- Put rules and helpers under a game-focused area such as `src/game/`.
- Put UI under a frontend-focused area such as `src/ui/` or `src/components/`.
- Keep shared types and constants in dedicated files.

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

## Repository Notes
- boardgame.io is an engine for turn-based games that provides state management, realtime multiplayer sync, lobby support, storage integration, AI bots, logs, time travel, and plugins.
- The repo README emphasizes that you describe state transitions as simple move functions and boardgame.io handles networking and storage.
- The repository includes `examples/`, `docs/`, and `packages/`, which are useful references when scaffolding this project.
- The upstream project is TypeScript-heavy, so prefer TypeScript-first examples and patterns when choosing between JS and TS implementations.
- The current repository uses `concurrently` to run the Vite client and local boardgame.io server together during development.
- The current in-game screen is wired to real gameplay state and multiplayer flow, and page-level UI docs live under `docs/ui-pages/`.