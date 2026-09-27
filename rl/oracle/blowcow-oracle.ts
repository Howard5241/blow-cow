/**
 * A headless JSONL driver over the real Blow Cow engine, used as the conformance oracle for the
 * Python vanilla simulator in `rl/blowcow/`.
 *
 * It is deliberately not a second implementation of anything. It imports `BlowCowGame` and does only
 * what the boardgame.io master would do around it: hold `G` and a `ctx`, call moves, and drain the
 * event queue those moves push. Every rule question is answered by the engine itself, which is the
 * whole point — if this file ever starts deciding something, the oracle has stopped being one.
 *
 * The turn loop is the one piece of framework behaviour reproduced here. boardgame.io queues
 * `events.endTurn` during a move and processes the queue afterwards, running `turn.onEnd` for the
 * seat that is leaving and `turn.onBegin` for the seat arriving; `onBegin` may itself queue another
 * end, which is the ordinary case in this game (a player who starts a turn with no cards leaves and
 * hands the turn straight on). So the drain is a loop rather than a single step.
 *
 * Protocol: one JSON object per line in, one per line out.
 *   {"cmd":"new","numPlayers":n,"selectedRanks":[...],"seed":s}  -> {"ok":true,"proj":{...}}
 *     `new` also takes the optional Ante Mode dials `gameMode`, `roundLimit` and `startingGold`,
 *     which `rl/ante_conformance.py` uses to open a one-round Ante match. They are additive: a
 *     classic `new` sends none of them and gets exactly the projection it always did.
 *   {"cmd":"apply","playerID":"0","move":"pass","args":{}}       -> {"ok":true,"invalid":false,"proj":{...}}
 *   {"cmd":"probe","playerID":"0","move":"play","args":{...}}    -> {"ok":true,"legal":true}
 *   {"cmd":"proj"}                                               -> {"ok":true,"proj":{...}}
 *   {"cmd":"quit"}                                               -> {"ok":true}
 *
 * `probe` runs the move against a structured clone and reports only whether the engine accepted it,
 * so the Python legal-action mask can be checked against the authority rather than against a second
 * reading of the rules.
 */
import { createInterface } from 'node:readline'
import { BlowCowGame } from '../../src/game/blowCowGame.ts'
import type {
  BlowCowGameOver,
  BlowCowRank,
  BlowCowState,
  BlowCowTablePlay,
} from '../../src/game/blowCowGame.ts'

const INVALID_MOVE = 'INVALID_MOVE'

type Shuffle = <Value>(values: Value[]) => Value[]

type OracleCtx = {
  currentPlayer: string
  turn: number
  numPlayers: number
}

type OracleEvents = {
  endGame: (gameover?: BlowCowGameOver) => void
  endTurn: (arg?: { next: string }) => void
}

type OracleContext = {
  G: BlowCowState
  ctx: OracleCtx
  events: OracleEvents
  playerID: string
  random?: { Shuffle?: Shuffle }
}

type MoveFn = (context: OracleContext, args?: unknown) => unknown

/**
 * xorshift32 plus a descending Fisher-Yates. Both halves are reimplemented byte for byte in
 * `rl/blowcow/rng.py`, which is what lets a match be dealt identically on both sides: the engine
 * takes its whole supply of randomness through `random.Shuffle`, so an identical stream of shuffles
 * is an identical match.
 */
function createRandomSource(seed: number) {
  let state = seed >>> 0
  if (state === 0) {
    state = 0x9e3779b9
  }

  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

function createShuffle(nextRandom: () => number): Shuffle {
  return <Value>(values: Value[]) => {
    const result = [...values]

    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(nextRandom() * (index + 1))
      const held = result[index]
      result[index] = result[swapIndex]
      result[swapIndex] = held
    }

    return result
  }
}

/** Probes must never draw from the match's stream, and nothing they can legally ask for shuffles. */
const identityShuffle: Shuffle = (values) => [...values]

function getMoveFn(moveName: string): MoveFn {
  const entry = (BlowCowGame.moves as Record<string, unknown>)[moveName]

  if (typeof entry === 'function') {
    return entry as MoveFn
  }

  const move = (entry as { move?: unknown } | undefined)?.move
  if (typeof move === 'function') {
    return move as MoveFn
  }

  throw new Error(`Unknown move: ${moveName}`)
}

const onTurnBegin = BlowCowGame.turn.onBegin as (context: Omit<OracleContext, 'playerID' | 'random'>) => unknown
const onTurnEnd = BlowCowGame.turn.onEnd as (context: Omit<OracleContext, 'playerID' | 'random'>) => unknown

type ProjectedPlay = {
  id: string
  playerID: string
  cards: number[]
  declaredCardCount: number
  revealedCardIDs: number[]
  claimedRank: BlowCowRank | null
  playedAtRound: number
  playedAtTurn: number
  revealedAtTurn: number | null
  wasTrumpSelection: boolean
}

function projectPlay(play: BlowCowTablePlay): ProjectedPlay {
  const orderByCardID = new Map(play.cards.map((card) => [card.id, card.deckOrder]))
  const revealedCardIDs = (play.revealedCardIDs ?? [])
    .map((cardID) => orderByCardID.get(cardID))
    .filter((deckOrder): deckOrder is number => deckOrder !== undefined)
    .sort((left, right) => left - right)

  return {
    id: play.id,
    playerID: play.playerID,
    cards: play.cards.map((card) => card.deckOrder),
    declaredCardCount: play.declaredCardCount ?? play.cards.length,
    revealedCardIDs,
    claimedRank: play.claimedRank,
    playedAtRound: play.playedAtRound,
    playedAtTurn: play.playedAtTurn,
    revealedAtTurn: play.revealedAtTurn,
    wasTrumpSelection: play.wasTrumpSelection,
  }
}

/**
 * The comparable shape. History, telemetry, archive and every rendered string are left out on
 * purpose: they are prose about the state rather than the state, and holding the Python simulator to
 * them would be holding it to the wording of a log line.
 */
function projectState(match: Match) {
  const { G, ctx } = match
  // Gold only exists as a moving quantity in Ante, and a key present on one side only is a diff. So
  // it rides along there and is absent everywhere else, which leaves the classic comparison byte for
  // byte what it was.
  const isAnte = G.gameMode === 'ante'
  const cardOrderByID = new Map<string, number>()

  for (const play of G.table.plays) {
    for (const card of play.cards) {
      cardOrderByID.set(card.id, card.deckOrder)
    }
  }

  return {
    turn: ctx.turn,
    currentPlayer: ctx.currentPlayer,
    gameStatus: G.gameStatus,
    // Ante only, for the same reason `gold` is. The deck is built rank-minor over this exact array,
    // so it is what turns a `deckOrder` back into a rank — and `normalizeSelectedRanks` sorts it, so
    // a caller that assumed its own order would be wrong in a way no state comparison could see.
    ...(isAnte ? { selectedRanks: G.deckConfig.selectedRanks } : {}),
    gameover: match.gameover
      ? {
          placements: match.gameover.placements,
          winnerID: match.gameover.winnerID,
          pointsByPlayer: match.gameover.pointsByPlayer,
        }
      : null,
    placements: G.placements,
    seatOrder: G.seatOrder,
    round: {
      roundNumber: G.round.roundNumber,
      status: G.round.status,
      direction: G.round.direction,
      startingPlayerID: G.round.startingPlayerID,
      trumpRank: G.round.trumpRank,
      previousTrumpRank: G.round.previousTrumpRank,
      passStreak: G.round.passStreak,
      lastNonPassingPlayerID: G.round.lastNonPassingPlayerID,
      maxCardsOnTable: G.round.maxCardsOnTable,
      startedTurnNumber: G.round.startedTurnNumber,
    },
    table: G.table.plays.map((play) => projectPlay(play)),
    players: Object.fromEntries(
      G.seatOrder.map((playerID) => {
        const player = G.players[playerID]
        return [
          playerID,
          {
            seatIndex: player.seatIndex,
            hand: player.hand.map((card) => card.deckOrder),
            points: player.points,
            scoredSets: player.scoredSets.map((scoredSet) => ({
              id: scoredSet.id,
              rank: scoredSet.rank,
              cards: scoredSet.cards.map((card) => card.deckOrder),
            })),
            pendingRevealPlayID: player.pendingRevealPlayID,
            hasLeft: player.hasLeft,
            leaveOrder: player.leaveOrder,
            ...(isAnte ? { gold: player.gold ?? null } : {}),
          },
        ]
      }),
    ),
    bs: G.bsResolution
      ? {
          id: G.bsResolution.id,
          callerPlayerID: G.bsResolution.callerPlayerID,
          targetPlayerID: G.bsResolution.targetPlayerID,
          targetPlayID: G.bsResolution.targetPlayID,
          targetDeclaredCardCount: G.bsResolution.targetDeclaredCardCount,
          trumpRank: G.bsResolution.trumpRank,
          punishmentCardCount: G.bsResolution.punishmentCardCount,
          revealOrder: G.bsResolution.revealOrder,
          revealStepIndex: G.bsResolution.revealStepIndex,
          isPunishing: G.bsResolution.isPunishing,
          targetWasHonest: G.bsResolution.targetVerdict?.targetWasHonest ?? null,
          reverseRuleTriggered: G.bsResolution.punishment?.reverseRuleTriggered ?? null,
          punishedPlayerID: G.bsResolution.punishment?.punishedPlayerID ?? null,
          unpunishedPlayerID: G.bsResolution.punishment?.unpunishedPlayerID ?? null,
        }
      : null,
    reset: G.resetResolution
      ? {
          id: G.resetResolution.id,
          callerPlayerID: G.resetResolution.callerPlayerID,
          kind: G.resetResolution.kind,
          revealOrder: G.resetResolution.revealOrder,
          revealStepIndex: G.resetResolution.revealStepIndex,
        }
      : null,
    turnOpening: G.turnOpening
      ? {
          id: G.turnOpening.id,
          playerID: G.turnOpening.playerID,
          turnNumber: G.turnOpening.turnNumber,
          isTaken: G.turnOpening.isTaken,
          reveal: G.turnOpening.reveal
            ? {
                playID: G.turnOpening.reveal.playID,
                cardIDs: G.turnOpening.reveal.cardIDs
                  .map((cardID) => cardOrderByID.get(cardID) ?? -1)
                  .sort((left, right) => left - right),
                isFullReveal: G.turnOpening.reveal.isFullReveal,
              }
            : null,
        }
      : null,
  }
}

type Match = {
  G: BlowCowState
  ctx: OracleCtx
  gameover: BlowCowGameOver | null
  pendingEndTurns: (string | null)[]
  shuffle: Shuffle
}

function createEvents(match: Match): OracleEvents {
  return {
    endGame: (gameover?: BlowCowGameOver) => {
      match.gameover = gameover ?? null
    },
    endTurn: (arg?: { next: string }) => {
      match.pendingEndTurns.push(arg?.next ?? null)
    },
  }
}

/**
 * The framework half of a turn hand-over, run after a move returns. `onEnd` sees the seat that is
 * leaving, then the turn counter moves, then `onBegin` sees the seat arriving — and may queue the
 * next hand-over itself, which is why this is a loop.
 */
function drainEvents(match: Match) {
  const events = createEvents(match)
  let guard = 0

  while (match.pendingEndTurns.length > 0 && !match.gameover) {
    guard += 1
    if (guard > 1024) {
      throw new Error('Turn hand-over did not settle')
    }

    const next = match.pendingEndTurns.shift() ?? null
    onTurnEnd({ G: match.G, ctx: match.ctx, events })

    match.ctx.turn += 1
    if (next) {
      match.ctx.currentPlayer = next
    }

    onTurnBegin({ G: match.G, ctx: match.ctx, events })
  }

  if (match.gameover) {
    match.pendingEndTurns.length = 0
  }
}

type AnteOptions = {
  gameMode?: 'classic' | 'ante'
  roundLimit?: number
  startingGold?: number
}

function createMatch(
  numPlayers: number,
  selectedRanks: BlowCowRank[],
  seed: number,
  ante: AnteOptions = {},
): Match {
  const shuffle = createShuffle(createRandomSource(seed))
  const setupData = {
    rankSelectionMode: 'manual' as const,
    selectedRanks,
    specialRanks: [] as never[],
    useCharacters: false,
    initialStatuses: [] as never[],
    // Spread rather than defaulted, so a classic `new` builds exactly the setup data it always did
    // and `resolveGameMode` sees no key at all.
    ...(ante.gameMode ? { gameMode: ante.gameMode } : {}),
    ...(ante.roundLimit !== undefined ? { roundLimit: ante.roundLimit } : {}),
    ...(ante.startingGold !== undefined ? { startingGold: ante.startingGold } : {}),
  }

  const setup = BlowCowGame.setup as (
    context: { ctx: { numPlayers: number }; random?: { Shuffle?: Shuffle } },
    setupData?: unknown,
  ) => BlowCowState

  const G = setup({ ctx: { numPlayers }, random: { Shuffle: shuffle } }, setupData)
  const match: Match = {
    G,
    ctx: { currentPlayer: '0', turn: 1, numPlayers },
    gameover: null,
    pendingEndTurns: [],
    shuffle,
  }

  // boardgame.io opens turn 1 before any move is possible. The game is still staging, so this is a
  // no-op here — it is run for faithfulness rather than effect.
  onTurnBegin({ G, ctx: match.ctx, events: createEvents(match) })
  applyMove(match, '0', 'startMatch', undefined)

  return match
}

function applyMove(match: Match, playerID: string, moveName: string, args: unknown) {
  const moveFn = getMoveFn(moveName)
  const context: OracleContext = {
    G: match.G,
    ctx: match.ctx,
    events: createEvents(match),
    playerID,
    random: { Shuffle: match.shuffle },
  }

  const result = moveFn(context, args)
  const invalid = result === INVALID_MOVE

  if (invalid) {
    // boardgame.io discards the whole move on INVALID_MOVE, queued events included.
    match.pendingEndTurns.length = 0
    return true
  }

  drainEvents(match)
  return false
}

/**
 * A clone stripped of the three write-only logs before copying. None of them is read by any legality
 * test, and by the middle of a match they are most of the state by volume — with them in, a probe
 * costs more to clone than the move it is asking about.
 */
function cloneForProbe(source: BlowCowState): BlowCowState {
  return structuredClone({
    ...source,
    history: [],
    telemetry: { events: [] },
    archive: { ...source.archive, turns: [] },
  }) as BlowCowState
}

function probeMove(match: Match, playerID: string, moveName: string, args: unknown) {
  const clone: Match = {
    G: cloneForProbe(match.G),
    ctx: { ...match.ctx },
    gameover: null,
    pendingEndTurns: [],
    shuffle: identityShuffle,
  }

  const moveFn = getMoveFn(moveName)
  const context: OracleContext = {
    G: clone.G,
    ctx: clone.ctx,
    events: createEvents(clone),
    playerID,
    random: { Shuffle: identityShuffle },
  }

  try {
    return moveFn(context, args) !== INVALID_MOVE
  } catch {
    return false
  }
}

let currentMatch: Match | null = null

function handleCommand(command: Record<string, unknown>) {
  const cmd = command.cmd

  if (cmd === 'new') {
    currentMatch = createMatch(
      command.numPlayers as number,
      command.selectedRanks as BlowCowRank[],
      command.seed as number,
      {
        gameMode: command.gameMode as AnteOptions['gameMode'],
        roundLimit: command.roundLimit as number | undefined,
        startingGold: command.startingGold as number | undefined,
      },
    )
    return { ok: true, proj: projectState(currentMatch) }
  }

  if (cmd === 'quit') {
    return { ok: true, bye: true }
  }

  if (!currentMatch) {
    return { ok: false, error: 'No match' }
  }

  if (cmd === 'proj') {
    return { ok: true, proj: projectState(currentMatch) }
  }

  if (cmd === 'apply') {
    const invalid = applyMove(
      currentMatch,
      command.playerID as string,
      command.move as string,
      command.args,
    )
    return { ok: true, invalid, proj: projectState(currentMatch) }
  }

  if (cmd === 'probe') {
    return {
      ok: true,
      legal: probeMove(
        currentMatch,
        command.playerID as string,
        command.move as string,
        command.args,
      ),
    }
  }

  // One round trip for a whole action mask. The harness asks about every candidate at a decision
  // point, and a line each turned the conformance run into an IPC benchmark.
  if (cmd === 'probeBatch') {
    const probes = command.probes as { playerID: string; move: string; args?: unknown }[]
    return {
      ok: true,
      legal: probes.map((probe) => probeMove(currentMatch!, probe.playerID, probe.move, probe.args)),
    }
  }

  return { ok: false, error: `Unknown command: ${String(cmd)}` }
}

const readline = createInterface({ input: process.stdin })

readline.on('line', (line) => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return
  }

  let response: Record<string, unknown>
  try {
    response = handleCommand(JSON.parse(trimmed) as Record<string, unknown>)
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  process.stdout.write(`${JSON.stringify(response)}\n`)

  if (response.bye) {
    readline.close()
  }
})
