/**
 * Targeted checks for the practice bots in `src/bots/`.
 *
 * The point is not that the bots play *well* — three of the five deliberately do not. It is that
 * every move they choose is one the server accepts, and that a table of them finishes. A bot whose
 * move is refused is invisible in play: `INVALID_MOVE` is silent, so the seat simply never acts and
 * the table appears to freeze. That failure is exactly what these checks are here to catch.
 *
 * The whole game is driven through the real reducer, so nothing here re-implements a rule.
 */
import assert from 'node:assert/strict'
// The package exposes `internal` as a directory rather than an ESM entry point, so the built file is
// named directly. This is the same reducer the server runs, which is the whole point of using it.
import { InitializeGame, CreateGameReducer } from 'boardgame.io/dist/esm/internal.js'

import { BlowCowGame, type BlowCowState } from '../src/game/blowCowGame.ts'
import { decideBotMove } from '../src/bots/blowCowBotPolicy.ts'
import { canSeatBots } from '../src/bots/blowCowBotSeating.ts'
import { BLOW_COW_BOT_KINDS, type BlowCowBotKind } from '../src/bots/blowCowBotTypes.ts'

/** A deterministic RNG, so a failing check fails the same way twice. */
function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

/** The framework's own state, narrowed so `G` is this game's rather than `any`. */
type EngineState = ReturnType<typeof InitializeGame> & { G: BlowCowState }

type Store = {
  state: EngineState
  reducer: ReturnType<typeof CreateGameReducer>
}

function createStore(numPlayers: number, seed: number): Store {
  const state = InitializeGame({
    game: BlowCowGame,
    numPlayers,
    // `useCharacters` defaults to **true**, so this has to be explicit: without it these checks
    // would be exercising the bots in exactly the rooms `canSeatBots` refuses to seat them in.
    setupData: { rankSelectionMode: 'default', useCharacters: false },
  })
  return { state, reducer: CreateGameReducer({ game: BlowCowGame, isClient: false }), ...{ seed } }
}

/**
 * Applies a move and says whether the reducer accepted it.
 *
 * `_stateID` is the signal, and deliberately not a deep comparison of `G`: boardgame.io increments
 * it only when a move is actually applied, whereas `G` carries the history, archive and telemetry, so
 * serialising it twice per seat per step made this check take half an hour instead of seconds.
 */
function dispatch(store: Store, playerID: string, move: string, args: unknown[]) {
  const before = store.state._stateID
  store.state = store.reducer(store.state, {
    type: 'MAKE_MOVE',
    payload: { type: move, args, playerID, credentials: undefined },
  } as never)
  return store.state._stateID !== before
}

/**
 * Plays a whole match with every seat driven by `decideBotMove`, and reports what happened. A move
 * the reducer refuses leaves the state identical, which is what `stalled` counts.
 */
function playBotMatch(kinds: BlowCowBotKind[], seed: number, maxSteps = 1200) {
  const numPlayers = kinds.length
  const store = createStore(numPlayers, seed)
  const rng = makeRng(seed)

  // Staging: the host starts the match, exactly as the button does.
  dispatch(store, store.state.G.hostPlayerID, 'startMatch', [])
  assert.equal(store.state.G.gameStatus, 'active', 'the match should be active after startMatch')

  let steps = 0
  let moves = 0
  let rejected = 0

  while (steps < maxSteps && !store.state.ctx.gameover) {
    steps += 1
    let acted = false

    for (let seat = 0; seat < numPlayers; seat += 1) {
      const playerID = String(seat)
      const decision = decideBotMove(
        store.state.G,
        store.state.ctx.currentPlayer,
        playerID,
        kinds[seat],
        rng,
      )
      if (!decision) {
        continue
      }

      if (dispatch(store, playerID, decision.move, decision.args)) {
        moves += 1
        acted = true
        break
      }
      rejected += 1
    }

    if (!acted) {
      // A stall is the failure that matters, so say enough about it to debug without a rerun.
      const G = store.state.G
      const detail = [
        `current=${store.state.ctx.currentPlayer}`,
        `trump=${G.round.trumpRank}`,
        `table=${G.table.plays.length}`,
        `hands=${Object.keys(G.players).map((seatID) => G.players[seatID].hand.length).join('/')}`,
        `turnOpening=${G.turnOpening ? `${G.turnOpening.playerID}:${G.turnOpening.isTaken}` : 'none'}`,
        `bs=${G.bsResolution ? G.bsResolution.callerPlayerID : 'none'}`,
        `reset=${G.resetResolution ? `${G.resetResolution.callerPlayerID}:${G.resetResolution.kind}` : 'none'}`,
      ].join(' ')
      return {
        finished: Boolean(store.state.ctx.gameover), moves, rejected, stalled: true, steps, detail,
      }
    }
  }

  return {
    finished: Boolean(store.state.ctx.gameover),
    moves,
    rejected,
    stalled: false,
    detail: "",
    steps,
  }
}

function runBotsFinishMatchesCheck() {
  for (const kind of BLOW_COW_BOT_KINDS) {
    for (const numPlayers of [2, 4]) {
      const kinds = Array.from({ length: numPlayers }, () => kind)
      const result = playBotMatch(kinds, 17 + numPlayers)

      assert.equal(
        result.stalled,
        false,
        `a table of ${kind} bots at ${numPlayers} seats stalled after ${result.moves} moves (${result.rejected} refused): ${result.detail} — every seat declined to move, `
        + 'which on a real table is a frozen game rather than a weak opponent',
      )
      assert.equal(
        result.rejected,
        0,
        `${kind} at ${numPlayers} seats had ${result.rejected} move(s) refused by the reducer. `
        + 'A refused move is silent in play, so the seat would simply stop acting',
      )
      assert.ok(
        result.moves > 20,
        `${kind} at ${numPlayers} seats only made ${result.moves} moves`,
      )
      /*
       * Deliberately NOT asserting that every table finishes. `honest` and `liar` never challenge,
       * and a table where nobody challenges never resolves a round — the same property the Python
       * side measured as 57% truncation and 185 rounds a match. That is a fact about the matchup,
       * not a defect, and a bot that is bad in an interesting way is the point of offering it. What
       * matters is that no move is ever refused, which is asserted above.
       */
    }
  }
}

/** A mixed table is the case a human actually sits at, and the one that exercises every branch. */
function runMixedTableCheck() {
  const result = playBotMatch(['heuristic', 'honest', 'liar', 'caller'], 91)
  assert.equal(result.stalled, false, 'a mixed bot table stalled')
  assert.equal(result.rejected, 0, `a mixed bot table had ${result.rejected} refused move(s)`)
  assert.ok(result.finished, 'a mixed bot table never reached a gameover')
}

/**
 * The procedures a bot has to drive itself. `caller` challenges at every opportunity, so a table of
 * them is the shortest path to a BS walk that only a bot can advance — if the walk were left
 * un-driven the match would stall, which the assertions above would catch, but this states the
 * intent so a future change that breaks it fails for the right reason.
 */
function runBotDrivenProcedureCheck() {
  const result = playBotMatch(['caller', 'liar', 'caller', 'liar'], 5)
  assert.equal(result.stalled, false, 'a challenge-heavy table stalled mid-procedure')
  assert.ok(
    result.finished,
    'a challenge-heavy table never finished, so a bot-driven reveal walk is not being advanced',
  )
}

/** The vanilla gate. A bot must never be offered a room whose rules it does not implement. */
function runVanillaGateCheck() {
  const vanilla = InitializeGame({
    game: BlowCowGame,
    numPlayers: 4,
    // `useCharacters` defaults to **true**, so this has to be explicit: without it these checks
    // would be exercising the bots in exactly the rooms `canSeatBots` refuses to seat them in.
    setupData: { rankSelectionMode: 'default', useCharacters: false },
  }).G as BlowCowState
  assert.equal(canSeatBots(vanilla).allowed, true, 'a vanilla room should accept bots')

  const withCharacters = { ...vanilla, useCharacters: true }
  assert.equal(canSeatBots(withCharacters).allowed, false, 'characters should block bots')

  const withSpecialRanks = {
    ...vanilla,
    deckConfig: { ...vanilla.deckConfig, specialRanks: ['Plague'] },
  } as BlowCowState
  assert.equal(canSeatBots(withSpecialRanks).allowed, false, 'action ranks should block bots')

  const withRemovedRule = {
    ...vanilla,
    rules: { ...vanilla.rules, joker: 'removed' },
  } as BlowCowState
  assert.equal(canSeatBots(withRemovedRule).allowed, false, 'a removed rule card should block bots')

  const withStatuses = { ...vanilla, initialStatuses: ['blind'] } as BlowCowState
  assert.equal(canSeatBots(withStatuses).allowed, false, 'starting statuses should block bots')
}

const checks = [
  ['bots finish matches', runBotsFinishMatchesCheck],
  ['mixed bot table', runMixedTableCheck],
  ['bot-driven procedures', runBotDrivenProcedureCheck],
  ['vanilla gate', runVanillaGateCheck],
] as const

for (const [label, runCheck] of checks) {
  runCheck()
  console.log(`PASS ${label}`)
}

console.log('All Blow Cow bot checks passed.')
