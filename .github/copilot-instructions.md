# Project Guidelines

Workspace guidance for Copilot in this repo.

## Documentation Map

This file is deliberately short. The project's detailed guidance lives in four documents, each owning
its facts exactly once — read the relevant one rather than working from this summary:

| File | Owns |
| --- | --- |
| `RULES.md` | The vanilla game with a standard deck: what every player does regardless of character. Source of truth for rules. |
| `RULES-EXTENSIONS.md` | Optional additions on top of `RULES.md`: action ranks and statuses. |
| `CHARACTERS.md` | Per-character abilities, windows, limits, and their interactions with rules and statuses. |
| `Characters.csv` | The wording printed on the character card art. Authoring source for the art. |
| `CLAUDE.md` | Implementation notes: move names, state fields, enforcement sites, and why the code is shaped as it is. |

- Before changing gameplay, read `RULES.md` and `CHARACTERS.md`.
- Before changing anything under `src/game/`, read the Game Logic Conventions section of `CLAUDE.md`.
- Before frontend or layout changes, read the relevant page doc under `docs/ui-pages/`
  (`lobby-page.md`, `room-staging-page.md`, `table-page.md`).
- When a change alters a documented page's structure, major elements, element roles, or visible
  relationships, update the matching `docs/ui-pages/` file in the same task.

Do not restate a rule or an implementation note that one of those files already carries. Cross-
reference it instead.

## Product Goal

- Build Blow Cow, a turn-based online multiplayer browser card game inspired by BS.
- Use boardgame.io for game rules, turn flow, multiplayer state sync, and server authority.
- Target the web browser first. Support 2 to 8 players.

## Default Stack

- React 19 + TypeScript + Vite client. Prefer TypeScript and React for new code unless plain JS/HTML/CSS
  is explicitly requested.
- Prefer boardgame.io built-in client, lobby, and multiplayer patterns before custom networking.
- The local multiplayer server runs from `server/server.cjs` with `node --experimental-strip-types --watch`.

## Build and Run

- `npm run dev` — Vite client + local boardgame.io server together.
- `npm run dev:client` — client only (`http://localhost:5173`).
- `npm run dev:server` — server only, with watch (port `8000`).
- `npm run server` — server without watch.
- `npm run build` — `tsc -b` then the Vite production build.
- `npm run preview` — serve the production build locally.
- `npm run lint` — ESLint across the repo.
- `npm run check:gameplay` — targeted gameplay checks (`scripts/check-blowcow-gameplay.ts`).
- In PowerShell, if port `8000` is taken: `$env:PORT=8001; npm run dev:server`.
- Vite proxies `/games` and `/socket.io` to `http://localhost:8000`, so the client needs the server
  running for lobby and match traffic.

## Verifying Changes

- After changing anything under `src/game/`, run `npm run check:gameplay` and `npx tsc -b`. The check
  script is the only automated test harness in this repo.
- When a rule changes, add a matching check to `scripts/check-blowcow-gameplay.ts` and register it in
  the `checks` array at the bottom of that file.
- `npm run lint` currently reports pre-existing problems in `src/ui/BlowCowBoard.tsx` and `src/App.tsx`.
  Those are not caused by new work and should not be fixed unless asked.

## Architecture

- Keep all game rules deterministic and serializable; `G` must stay JSON-serializable.
- Put core game logic in boardgame.io `Game`, `moves`, `turn`, `phases`, and related helpers.
- No DOM access, React state, timers, or browser-only APIs inside game logic.
- Treat the server as authoritative. Do not trust client-side validation for move legality.
- Keep hidden information private through `playerView` and per-player data shaping.
- Use `random.Shuffle` rather than `Math.random`, so replays and server authority hold.

## Frontend Conventions

- Keep UI components focused on rendering state and dispatching boardgame.io moves or events.
- Build responsive layouts that work on desktop and mobile browsers.
- Prefer clear card, hand, table, turn, and player-status components over monolithic views.
- Character card sprites carry the name and ability as art, and are the only place a character's
  ability is written for a player. There is deliberately no description table in
  `src/game/blowCowCharacters.ts`. Do not reintroduce ability text in the UI unless explicitly
  requested — show the card instead. Rule cards are the exception: their illustrations carry no text,
  so the Rules panel renders the title and description itself.
- Sprite folders live at the repository root, not in `public/`, and load through `import.meta.glob`:
  `card_sprites/`, `rect_card_sprites/`, `character_card_sprites/`, `avatar_sprites/`,
  `rule_card_sprites/`, and `status_sprites/`.
- Sprite filename matching has two different rules for characters and rules; see Frontend Conventions
  in `CLAUDE.md` before touching either helper.

## Code Organization

- Prefer small focused modules, and keep shared types and constants in dedicated files.
- `src/game/` holds the game definition, characters, rule cards, statuses, and poker evaluation.
- `src/ui/` holds the board and sprite helpers.
- `src/App.tsx` and `src/config.ts` hold the lobby flow and client configuration.
- `server/server.cjs` is the local server runtime; `server/completedGameArchive.ts` archives finished
  matches to `data/completed-games/`.
- `scripts/check-blowcow-gameplay.ts` holds the gameplay checks.

## Implementation Priorities

- Add brief comments only where card rules, bluffing flow, or hidden-information handling would be
  non-obvious.
- Match the surrounding code's naming, comment density, and idiom.
- When asked to scaffold, default to a browser app using boardgame.io with React and TypeScript.

## Persistence and Archives

Live matches persist to `data/matches/` and finished matches are archived to `data/completed-games/`.
Both have constraints that are easy to break silently — see Match Persistence and Completed Match
Archives in `CLAUDE.md` before touching either.

## boardgame.io Notes

- `G` holds game data; `ctx` holds framework-managed turn metadata such as current player, turn
  number, and player count.
- Implement player actions as `moves` that deterministically update `G` without external state or
  browser-only side effects.
- Use framework `events` for turn and phase progression, `phases` for large rule changes, and `stages`
  for per-player substeps.
- Relevant docs areas: Multiplayer, Turn Order, Phases, Stages, Events, Secret State, Randomness,
  Testing, Deployment, Game, Client, Server, and Lobby.

## External References

- boardgame.io docs: https://boardgame.io/documentation/#/
- boardgame.io repo: https://github.com/boardgameio/boardgame.io — its `examples/`, `docs/`, and
  `packages/` directories are useful references. They belong to boardgame.io, not to this repository.
