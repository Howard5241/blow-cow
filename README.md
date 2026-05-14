# Blow Cow

Blow Cow is a browser-first multiplayer card game inspired by BS. This repository contains the React client, a custom lobby flow, a local boardgame.io server, and a live in-game board backed by boardgame.io game state and multiplayer flow.

## Current Stack

- React 19 for the UI
- TypeScript for application code
- Vite 8 for client development and builds
- boardgame.io for game definitions, multiplayer transport, and lobby APIs
- Node.js CommonJS server entry for the local boardgame.io server
- ESLint for linting
- concurrently to run the client and server together during development

## Current Status

- Supports 2 to 8 players
- Includes a custom lobby to create rooms, join rooms, and view open tables
- Includes a local multiplayer server at `server/server.cjs`
- Includes a live in-game board with turn flow, hidden information, scoring, BS resolution, Reset resolution, and endgame results
- Uses server-authoritative boardgame.io moves and player-specific hidden state shaping for multiplayer play

See `RULES.md` for the current game rules draft.

## Scripts

- `npm run dev` starts the Vite client and the local boardgame.io server together
- `npm run dev:client` starts only the Vite client
- `npm run dev:server` starts only the local boardgame.io server with file watching
- `npm run build` runs the TypeScript build and the Vite production build
- `npm run lint` runs ESLint across the repo
- `npm run check:gameplay` runs the targeted gameplay verification script
- `npm run server` starts the boardgame.io server without watch mode
- `npm run preview` serves the production client build locally

## Project Structure

- `src/` contains the client application
- `src/game/` contains the current boardgame.io game definition
- `src/ui/` contains the game board UI and card sprite helpers
- `server/server.cjs` contains the local boardgame.io server runtime
- `data/completed-games/` is generated locally when finished matches are archived
- `.github/copilot-instructions.md` contains workspace guidance for Copilot in this repo

## Completed Match Archives

- Finished matches are archived locally under `data/completed-games/`
- `data/completed-games/matches/` stores one detailed JSON snapshot per completed match
- `data/completed-games/index/games.ndjson` stores one compact line per completed match
- `data/completed-games/index/player-games.ndjson` stores one compact line per player per completed match, including `lieRate` and other match stats for cross-game analysis

## Development Notes

- The current game definition is wired to real gameplay state, staged BS and Reset resolution flow, and endgame stats
- The server is intentionally running from a CommonJS entrypoint for local stability
- The real rules implementation should stay deterministic, serializable, and server-authoritative
