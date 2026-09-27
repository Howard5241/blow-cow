/**
 * Plays whole Ante matches with five learned bots, through the real reducer.
 *
 * `scripts/check-ante-bot.ts` holds the network, the encoder and the action space to the Python they
 * were ported from, using fixtures. What it cannot cover is the step in front of all three: turning a
 * boardgame.io `G` into the round view the encoder reads. Rank slots, seat order, the trump slot, the
 * reconstructed event ring — every one of those is engine-side and has no fixture. This is where they
 * are checked, by playing the actual game.
 *
 * Two properties, and the first is the one that matters:
 *
 * * **No move is ever refused.** `INVALID_MOVE` is silent, so a bot whose move is rejected does not
 *   play badly — it stops playing, and the table looks frozen. That is the failure mode this whole
 *   file exists for, and it is the same argument `scripts/check-blowcow-bots.ts` makes for the
 *   classic bots.
 * * **Matches finish.** Ante rounds terminate by arithmetic, so a table that does not reach a
 *   `gameover` is a bug in the driver or the bot, never a strategy that stalls.
 *
 * **The bots are handed `playerView`, not `G`.** In the browser a bot is a client and the masking is
 * done for it; here the harness has to do it, and doing it is half the point — an observation built
 * from the unmasked state would read every hand at the table, score better, and prove nothing about
 * what ships.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
// The package exposes `internal` as a directory rather than an ESM entry point, so the built file is
// named directly. This is the same reducer the server runs, which is the whole point of using it.
import { InitializeGame, CreateGameReducer } from 'boardgame.io/dist/esm/internal.js'

import { BlowCowGame, type BlowCowState } from '../src/game/blowCowGame.ts'
import { BlowCowGame as GameDefinition } from '../src/game/blowCowGame.ts'
import { decideAnteBotMove } from '../src/bots/ante/anteBotPolicy.ts'
import { canSeatBots } from '../src/bots/blowCowBotSeating.ts'
import { ANTE_AGENT_SUPPORTED_SEATS } from '../src/bots/ante/anteSpaces.ts'
import { createAnteRoundNet, type AnteRoundNet } from '../src/bots/ante/anteNet.ts'

/** Reads `--weights <prefix>` off argv, defaulting to the 5-seat pair. */
function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const WEIGHT_PREFIX = argValue('--weights', 'model_weights/ante-round')
const MANIFEST = resolve(process.cwd(), `${WEIGHT_PREFIX}.json`)
const WEIGHTS = resolve(process.cwd(), `${WEIGHT_PREFIX}.bin`)

function makeRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

type EngineState = ReturnType<typeof InitializeGame> & { G: BlowCowState }
type Store = { state: EngineState; reducer: ReturnType<typeof CreateGameReducer> }

function loadNet(): AnteRoundNet {
  if (!existsSync(WEIGHTS)) {
    console.error(`no weights at ${WEIGHTS}`)
    console.error(`run: python rl/export_ante_round.py --checkpoint <checkpoint> --out ${WEIGHT_PREFIX}`)
    process.exit(2)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'))
  const bytes = readFileSync(WEIGHTS)
  const blob = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  return createAnteRoundNet(manifest, blob)
}

function createAnteStore(numPlayers: number, roundLimit: number): Store {
  const state = InitializeGame({
    game: BlowCowGame,
    numPlayers,
    setupData: { rankSelectionMode: 'default', gameMode: 'ante', roundLimit },
  })
  return { state, reducer: CreateGameReducer({ game: BlowCowGame, isClient: false }) }
}

function dispatch(store: Store, playerID: string, move: string, args: unknown[]) {
  const before = store.state._stateID
  store.state = store.reducer(store.state, {
    type: 'MAKE_MOVE',
    payload: { type: move, args, playerID, credentials: undefined },
  } as never) as EngineState
  return store.state._stateID !== before
}

/** What seat `playerID` is actually sent. The masking the browser gets for free. */
function viewFor(store: Store, playerID: string): BlowCowState {
  const playerView = (GameDefinition as { playerView?: (arg: unknown) => BlowCowState }).playerView
  if (!playerView) throw new Error('the game has no playerView; this check would be meaningless')
  return playerView({ G: store.state.G, ctx: store.state.ctx, playerID })
}

type MatchResult = {
  finished: boolean
  moves: number
  rejected: number
  stalled: boolean
  rounds: number
  detail: string
}

function playAnteMatch(net: AnteRoundNet, seed: number, roundLimit: number, maxSteps = 6000): MatchResult {
  const numPlayers = net.config.numPlayers
  const store = createAnteStore(numPlayers, roundLimit)
  const rng = makeRng(seed)

  dispatch(store, store.state.G.hostPlayerID, 'startMatch', [])
  assert.equal(store.state.G.gameStatus, 'active', 'the match should be active after startMatch')

  // The runner tracks this in the browser; here the harness does, the same way and for the same
  // reason — `G` does not carry the turn a round opened on.
  const roundFirstTurn = new Map<string, number>()
  const seenRound = new Map<string, number>()

  let steps = 0
  let moves = 0
  let rejected = 0

  while (steps < maxSteps && !store.state.ctx.gameover) {
    steps += 1
    let acted = false

    for (let seat = 0; seat < numPlayers; seat += 1) {
      const playerID = String(seat)
      const view = viewFor(store, playerID)

      if (seenRound.get(playerID) !== view.round.roundNumber) {
        seenRound.set(playerID, view.round.roundNumber)
        roundFirstTurn.set(playerID, store.state.ctx.turn)
      }

      const decision = decideAnteBotMove(
        view,
        store.state.ctx.currentPlayer,
        playerID,
        net,
        roundFirstTurn.get(playerID) ?? null,
        store.state.ctx.turn,
        rng,
      )
      if (!decision) continue

      if (dispatch(store, playerID, decision.move, decision.args)) {
        moves += 1
        acted = true
        break
      }
      rejected += 1
      // Loud, because a refused move is the failure this file exists to catch and a count alone
      // would not say which one.
      console.log(
        `    refused ${decision.move}(${JSON.stringify(decision.args)}) `
        + `from seat ${playerID}: ${decision.reason}`,
      )
    }

    if (!acted) {
      const G = store.state.G
      const detail = [
        `current=${store.state.ctx.currentPlayer}`,
        `round=${G.round.roundNumber}`,
        `trump=${G.round.trumpRank}`,
        `passStreak=${G.round.passStreak}`,
        `table=${G.table.plays.length}`,
        `hands=${Object.keys(G.players).map((id) => G.players[id].hand.length).join('/')}`,
        `gold=${Object.keys(G.players).map((id) => G.players[id].gold).join('/')}`,
        `turnOpening=${G.turnOpening ? `${G.turnOpening.playerID}:${G.turnOpening.isTaken}` : 'none'}`,
        `reset=${G.resetResolution ? `${G.resetResolution.callerPlayerID}:${G.resetResolution.kind}` : 'none'}`,
      ].join(' ')
      return {
        finished: Boolean(store.state.ctx.gameover),
        moves, rejected, stalled: true, rounds: G.round.roundNumber, detail,
      }
    }
  }

  return {
    finished: Boolean(store.state.ctx.gameover),
    moves,
    rejected,
    stalled: false,
    rounds: store.state.G.round.roundNumber,
    detail: '',
  }
}

/**
 * The same driver, but only one seat is the agent and the rest play at random.
 *
 * This is the check that a legal bot is also the *right* bot. Every fixture above would still pass
 * if the observation were correct in isolation but assembled from the wrong seats — the features
 * would be valid numbers describing somebody else's position, the mask would still be legal, and the
 * agent would play legally and badly. Against random opponents a working policy wins by a wide
 * margin and a scrambled one does not, so this separates the two.
 *
 * Seats are rotated because Ante's chairs are not symmetric: seat 0 opens the round and the last seat
 * takes a free round if everyone passes. `rl/ANTE.md` measures a 0.57-gold spread by chair, which is
 * wider than the effect being looked for here.
 */
function playAgainstRandom(net: AnteRoundNet, seed: number, agentSeat: number, roundLimit: number) {
  const numPlayers = net.config.numPlayers
  const store = createAnteStore(numPlayers, roundLimit)
  const rng = makeRng(seed)
  dispatch(store, store.state.G.hostPlayerID, 'startMatch', [])

  const roundFirstTurn = new Map<string, number>()
  const seenRound = new Map<string, number>()
  let steps = 0

  while (steps < 6000 && !store.state.ctx.gameover) {
    steps += 1
    let acted = false
    for (let seat = 0; seat < numPlayers; seat += 1) {
      const playerID = String(seat)
      const view = viewFor(store, playerID)
      if (seenRound.get(playerID) !== view.round.roundNumber) {
        seenRound.set(playerID, view.round.roundNumber)
        roundFirstTurn.set(playerID, store.state.ctx.turn)
      }

      // Every seat runs the same policy code; the random ones simply sample the mask uniformly,
      // which `sampleAction` does at a temperature high enough to flatten the logits.
      const decision = decideAnteBotMove(
        view,
        store.state.ctx.currentPlayer,
        playerID,
        net,
        roundFirstTurn.get(playerID) ?? null,
        store.state.ctx.turn,
        rng,
        seat === agentSeat ? 1 : RANDOM_TEMPERATURE,
      )
      if (!decision) continue
      if (dispatch(store, playerID, decision.move, decision.args)) {
        acted = true
        break
      }
    }
    if (!acted) break
  }

  const gold = store.state.G.players[String(agentSeat)]?.gold ?? 0
  const others = Object.keys(store.state.G.players)
    .filter((id) => id !== String(agentSeat))
    .map((id) => store.state.G.players[id]?.gold ?? 0)
  return { gold, fieldMean: others.reduce((a, b) => a + b, 0) / others.length }
}

/** High enough that the softmax is effectively uniform over the legal set. */
const RANDOM_TEMPERATURE = 1e6

let failures = 0
function report(name: string, detail: string, ok: boolean) {
  console.log(`${ok ? '  ' : 'X '}${name.padEnd(24)} ${detail}`)
  if (!ok) failures += 1
}

function main() {
  const net = loadNet()
  console.log(`Ante bot play: ${net.config.numPlayers} seats, ${net.source} @ ${net.steps} steps`)

  // -- the gate ------------------------------------------------------------
  const seats = net.config.numPlayers
  const store = createAnteStore(seats, 5)
  const gate = canSeatBots(store.state.G)
  report('ante gate', gate.allowed ? `a ${seats}-seat Ante table seats bots` : `refused: ${gate.allowed === false ? gate.reason : ''}`, gate.allowed)

  // A seat count no network is registered for must be refused. Probe the smallest count in 2..8
  // that is not supported, so the check tracks the registry rather than a hardcoded count.
  const unsupported = [2, 3, 4, 5, 6, 7, 8].find((n) => !ANTE_AGENT_SUPPORTED_SEATS.includes(n))
  if (unsupported === undefined) {
    report('ante gate refuses', 'every seat count in 2..8 is supported; nothing to refuse', true)
  } else {
    const wrongGate = canSeatBots(createAnteStore(unsupported, 5).state.G)
    report(
      'ante gate refuses',
      wrongGate.allowed ? `a ${unsupported}-seat table was allowed, which no checkpoint can play` : `a ${unsupported}-seat table`,
      !wrongGate.allowed,
    )
  }

  // -- whole matches -------------------------------------------------------
  const results: MatchResult[] = []
  const matches = 12
  for (let seed = 1; seed <= matches; seed += 1) {
    results.push(playAnteMatch(net, seed * 7919, 5))
  }

  const rejectedTotal = results.reduce((total, result) => total + result.rejected, 0)
  const stalled = results.filter((result) => result.stalled)
  const finished = results.filter((result) => result.finished).length
  const totalMoves = results.reduce((total, result) => total + result.moves, 0)
  const totalRounds = results.reduce((total, result) => total + result.rounds, 0)

  report(
    'no move refused',
    `${totalMoves} moves over ${matches} matches, ${rejectedTotal} refused`,
    rejectedTotal === 0,
  )
  report(
    'matches finish',
    stalled.length === 0
      ? `${finished}/${matches} reached gameover, ${totalRounds} rounds played`
      : `stalled: ${stalled[0].detail}`,
    stalled.length === 0 && finished === matches,
  )

  // -- strength ------------------------------------------------------------
  let agentGold = 0
  let fieldGold = 0
  const trials = 20
  for (let index = 0; index < trials; index += 1) {
    // The chair rotates with the trial, so the score is the policy rather than the seat.
    const result = playAgainstRandom(net, 4111 + index * 131, index % net.config.numPlayers, 8)
    agentGold += result.gold
    fieldGold += result.fieldMean
  }
  const edge = (agentGold - fieldGold) / trials
  report(
    'beats random',
    `+${edge.toFixed(2)} gold over the field, ${trials} matches, seats rotated`,
    edge > 1,
  )

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed`)
    process.exit(1)
  }
  console.log('\nOK')
}

main()
