/**
 * The 200-feature Ante round observation, read off the real `G`.
 *
 * A port of `rl/ante/observation.py`. The Python encoder reads a simulator whose state was built for
 * it; this one reads what a boardgame.io client is actually sent, so half the work is the translation
 * and the other half is the same arithmetic in the same order.
 *
 * **Nothing private is read, and that is structural rather than careful.** A bot is a client
 * (`src/bots/useBotSeats.ts`), so `playerView`'s `hideSecretState` has already replaced every card it
 * may not see with a hidden one. The visibility rule this file applies — a play's cards count as
 * known when the play is revealed or the viewer owns it — is therefore not a second enforcement but
 * the same rule stated where the arithmetic needs it, and it matches `hideSecretState`'s own
 * condition exactly. The `hidden information` check in `rl/ante_check.py` is what holds the Python
 * side to it; `scripts/check-ante-bot.ts` holds this one to the Python side.
 *
 * **The one thing `G` does not carry is the event ring.** `hideSecretState` empties `archive` for
 * every client, and `history` is prose. So the recent-events block is reconstructed from the table:
 * every play knows the turn it was made and the turn it was revealed, Ante has no skips so turn
 * numbers step one seat at a time, and a turn with no play on it was a pass. See
 * `reconstructEvents`.
 */
import {
  getActivePlayerIDs,
  getNextActivePlayerID,
  isJokerCard,
  type BlowCowCard,
  type BlowCowState,
  type BlowCowTablePlay,
} from '../../game/blowCowGame.ts'
import { getClientDefaultBSTargetSeatID } from '../../ui/bsTargeting.ts'
import { COPIES_PER_RANK, JOKER_COPIES, type AnteConfig } from './anteSpaces.ts'

export const RECENT_EVENTS = 8
const GLOBAL_WIDTH = 16
const TYPE_WIDTH = 7
const SEAT_WIDTH = 16
const EVENT_WIDTH = 6

/** `HONEST_PLAY_BIAS` in `rl/ante/game.py`. How much likelier than chance a trump holder is to play it. */
const HONEST_PLAY_BIAS = 4

export type AnteEvent = {
  seat: number
  kind: 'play' | 'pass' | 'reveal'
  size: number
}

/**
 * The round as one seat sees it, in the simulator's own terms.
 *
 * Seats are indexed in turn order from the viewer, so offset 1 is always whoever acts next. That is
 * the simulator's convention and the reason the per-seat rows mean the same thing whoever is looking.
 */
export type AnteRoundView = {
  /**
   * The **starting** shape of the match, never the current one.
   *
   * A network is built for one config and cannot be moved to another, so every width here — the type
   * rows, the seat rows, the action space, and the `deckSize`/`handSize` normalisers — is the size
   * the checkpoint was trained at and stays put for the whole match. What actually shrinks as seats
   * are eliminated is tracked beside it, in `numPlayers`, `activeRanks` and `copies`. That split is
   * `AnteConfig` versus `AnteRound.active_ranks` in the Python, and collapsing the two would change
   * the observation's width mid-match.
   */
  config: AnteConfig
  /** Seats still in the match this round — the simulator's `n`, not the config's. */
  numPlayers: number
  /** Standard ranks currently in the deck; shrinks as seats are eliminated. */
  activeRanks: number
  /** Copies of each card type in the deck **as it stands**, so trimmed ranks contribute nothing. */
  copies: number[]
  /** Always 0: the view is built from the viewer's seat. */
  viewer: number
  current: number
  /** Trump as a slot index, or null before one is chosen. */
  trump: number | null
  passStreak: number
  lastNonPassing: number | null
  /** Turns taken this round, 1-based, as the simulator counts them. */
  turn: number
  /** The viewer's hand as counts by card type. */
  hand: number[]
  handSizes: number[]
  table: { seat: number; types: number[] | null; size: number; revealed: boolean }[]
  events: AnteEvent[]
  /** Who the viewer may call BS on right now, or null. */
  bsTarget: number | null
}

// --------------------------------------------------------------------- translation

/**
 * The seat order starting at `viewer`, walked with the engine's own direction helper.
 *
 * Exported because the match block's rows are defined to be the same walk — offset 0 is the viewer,
 * offset k is whoever acts k turns later — and recomputing it there would let the two blocks disagree
 * about who sits where while both still looked correct in isolation.
 */
export function buildTurnOrder(state: BlowCowState, viewerID: string): string[] {
  const active = getActivePlayerIDs(state)
  const order: string[] = []
  let currentID: string | null = active.includes(viewerID) ? viewerID : active[0] ?? null
  while (currentID && order.length < active.length && !order.includes(currentID)) {
    order.push(currentID)
    currentID = getNextActivePlayerID(currentID, state.seatOrder, state.round.direction, active)
  }
  return order
}

/**
 * A card's type: its slot in `selectedRanks`, or the Joker's slot past the end.
 *
 * Returns null for a card the viewer may not see — `hideSecretState` replaced it with a hidden card,
 * whose rank is not a real one. Every caller treats null as "unknown", which is what keeps a masked
 * card out of the counting rather than counted as something.
 */
function cardType(card: BlowCowCard, rankSlots: Map<string, number>, config: AnteConfig): number | null {
  if (isJokerCard(card)) return config.jokerType
  const slot = rankSlots.get(card.rank as string)
  return slot === undefined ? null : slot
}

/**
 * The events of the last few turns, rebuilt from the table.
 *
 * Ante has no skips, no direction changes and no out-of-turn plays, so `ctx.turn` advances by exactly
 * one seat per turn and the seat that acted at turn `t` is `(now - t)` steps back in turn order. That
 * makes the whole sequence recoverable from data every client holds: a play records the turn it was
 * made and the turn it was revealed, and a turn carrying no play was a pass.
 *
 * `roundFirstTurn` is the one thing `G` does not say. `useBotSeats` tracks it — it is a single
 * integer, stamped when the round number changes — and passes it in. Without it the walk stops at the
 * earliest play of the round, which loses only passes made before the round's first play and only
 * while they are still inside the eight-event window.
 */
function reconstructEvents(
  state: BlowCowState,
  order: string[],
  currentTurn: number,
  roundFirstTurn: number | null,
  seatOf: Map<string, number>,
): AnteEvent[] {
  const roundNumber = state.round.roundNumber
  const plays = state.table.plays.filter((play) => play.playedAtRound === roundNumber)

  const earliestPlay = plays.reduce(
    (earliest, play) => Math.min(earliest, play.playedAtTurn),
    Number.POSITIVE_INFINITY,
  )
  const floor = roundFirstTurn
    ?? (Number.isFinite(earliestPlay) ? earliestPlay : currentTurn)
  // Only the newest eight are ever read, so the walk never needs to be longer than that.
  const from = Math.max(floor, currentTurn - RECENT_EVENTS - 1)

  const playsByTurn = new Map<number, BlowCowTablePlay>()
  const revealsByTurn = new Map<number, BlowCowTablePlay[]>()
  for (const play of plays) {
    playsByTurn.set(play.playedAtTurn, play)
    if (play.revealedAtTurn !== null) {
      const existing = revealsByTurn.get(play.revealedAtTurn)
      if (existing) existing.push(play)
      else revealsByTurn.set(play.revealedAtTurn, [play])
    }
  }

  const events: AnteEvent[] = []
  for (let turn = from; turn <= currentTurn; turn += 1) {
    // The Reveal Rule fires at the start of a turn, before the seat acts, so reveals go in first.
    for (const play of revealsByTurn.get(turn) ?? []) {
      const seat = seatOf.get(play.playerID)
      if (seat === undefined) continue
      events.push({ seat, kind: 'reveal', size: play.cards.length })
    }

    const play = playsByTurn.get(turn)
    if (play) {
      const seat = seatOf.get(play.playerID)
      if (seat !== undefined) events.push({ seat, kind: 'play', size: play.cards.length })
      continue
    }

    // No play on this turn. The current turn has not been acted on yet; an earlier one was a pass.
    if (turn === currentTurn) continue
    const stepsBack = currentTurn - turn
    const actorID = order[((order.length - (stepsBack % order.length)) % order.length)]
    const seat = seatOf.get(actorID)
    if (seat !== undefined) events.push({ seat, kind: 'pass', size: 0 })
  }

  return events
}

/**
 * Build the simulator-shaped view of the round from a client's `G`.
 *
 * `config` is the checkpoint's own, passed in rather than derived, so the observation keeps the width
 * the network was trained at even after an elimination has trimmed the deck.
 */
export function buildAnteRoundView(
  config: AnteConfig,
  state: BlowCowState,
  viewerID: string,
  currentPlayerID: string,
  roundFirstTurn: number | null,
  currentTurn: number,
): AnteRoundView | null {
  const order = buildTurnOrder(state, viewerID)
  if (order.length === 0 || order[0] !== viewerID) return null
  if (order.length > config.numPlayers) return null

  const selectedRanks = state.deckConfig.selectedRanks ?? []
  const activeRanks = selectedRanks.length
  if (activeRanks > config.numRanks) return null
  const rankSlots = new Map<string, number>(selectedRanks.map((rank, index) => [rank as string, index]))
  const seatOf = new Map<string, number>(order.map((playerID, index) => [playerID, index]))

  const trumpRank = state.round.trumpRank
  const trump = trumpRank === null
    ? null
    : rankSlots.get(trumpRank as string) ?? config.offDeckTrump

  const hand = new Array<number>(config.numTypes).fill(0)
  for (const card of state.players[viewerID]?.hand ?? []) {
    const type = cardType(card, rankSlots, config)
    if (type !== null) hand[type] += 1
  }

  const roundNumber = state.round.roundNumber
  const table = state.table.plays
    .filter((play) => play.playedAtRound === roundNumber)
    .map((play) => {
      const seat = seatOf.get(play.playerID)
      const revealed = play.revealedAtTurn !== null
      const visible = revealed || play.playerID === viewerID
      const types = visible
        ? play.cards.map((card) => cardType(card, rankSlots, config)).filter((type): type is number => type !== null)
        : null
      return { seat: seat ?? -1, types, size: play.cards.length, revealed }
    })
    .filter((play) => play.seat >= 0)

  const bsTargetID = getClientDefaultBSTargetSeatID(state, viewerID)

  // The deck as it stands: a rank slot an elimination trimmed away holds nothing, which is what keeps
  // `unaccounted` from crediting the table with cards that are no longer in the game.
  const copies = Array.from({ length: config.numTypes }, (_unused, type) => {
    if (type === config.jokerType) return JOKER_COPIES
    return type < activeRanks ? COPIES_PER_RANK : 0
  })

  return {
    config,
    numPlayers: order.length,
    activeRanks,
    copies,
    viewer: 0,
    current: seatOf.get(currentPlayerID) ?? 0,
    trump,
    passStreak: state.round.passStreak,
    lastNonPassing: state.round.lastNonPassingPlayerID
      ? seatOf.get(state.round.lastNonPassingPlayerID) ?? null
      : null,
    turn: roundFirstTurn === null ? 1 : Math.max(1, currentTurn - roundFirstTurn + 1),
    hand,
    handSizes: order.map((playerID) => state.players[playerID]?.hand.length ?? 0),
    table,
    events: reconstructEvents(state, order, currentTurn, roundFirstTurn, seatOf),
    bsTarget: bsTargetID ? seatOf.get(bsTargetID) ?? null : null,
  }
}

// --------------------------------------------------------------------- counting

/**
 * Copies of each card type the viewer cannot place: in another hand, or face down in front of
 * somebody else. `AnteRound.unaccounted`.
 *
 * A player can see their own face-down cards — they played them — so their own pile comes off along
 * with their hand.
 */
export function unaccounted(view: AnteRoundView): number[] {
  const counts = [...view.copies]
  for (let type = 0; type < counts.length; type += 1) counts[type] -= view.hand[type]
  for (const play of view.table) {
    if (play.types === null) continue
    for (const type of play.types) counts[type] -= 1
  }
  return counts
}

/** `lie_probability_from_counts`. The one hypergeometric the whole game turns on. */
export function lieProbabilityFromCounts(claimed: number, trumpLeft: number, unseen: number): number {
  if (claimed <= 0) return 0
  if (trumpLeft < claimed) return 1
  if (unseen <= 0) return 0

  let chanceAllTrump = 1
  for (let offset = 0; offset < claimed; offset += 1) {
    chanceAllTrump *= Math.max(0, trumpLeft - offset) / Math.max(1, unseen - offset)
  }
  return 1 - Math.min(1, chanceAllTrump * HONEST_PLAY_BIAS)
}

/** That seat's live claim: their most recent play still face down. `pending_play_index`. */
function pendingPlayIndex(view: AnteRoundView, seat: number): number | null {
  for (let index = view.table.length - 1; index >= 0; index -= 1) {
    const play = view.table[index]
    if (play.seat === seat && !play.revealed) return index
  }
  return null
}

function claimLieProbability(view: AnteRoundView, seat: number, counts: number[]): number {
  if (seat === view.viewer || view.trump === null) return 0
  const index = pendingPlayIndex(view, seat)
  if (index === null) return 0

  let trumpLeft = counts[view.config.jokerType]
  // A slot at or above `activeRanks` is a rank the deck does not hold, so only Jokers answer it.
  if (view.trump < view.activeRanks) trumpLeft += counts[view.trump]
  const unseen = counts.reduce((total, count) => total + count, 0)
  return lieProbabilityFromCounts(view.table[index].size, trumpLeft, unseen)
}

// --------------------------------------------------------------------- the encoder

export function observationSize(config: AnteConfig): number {
  return (
    GLOBAL_WIDTH
    + config.numTypes * TYPE_WIDTH
    + config.numPlayers * SEAT_WIDTH
    + RECENT_EVENTS * EVENT_WIDTH
  )
}

/** The 200 features, in the order `ObservationEncoder.encode` writes them. */
export function encodeAnteObservation(view: AnteRoundView): Float32Array {
  const config = view.config
  const out = new Float32Array(observationSize(config))
  const numPlayers = view.numPlayers
  const joker = config.jokerType
  const counts = unaccounted(view)
  const unseenTotal = counts.reduce((total, count) => total + count, 0)

  const faceDownCount = new Array<number>(numPlayers).fill(0)
  const faceUpCount = new Array<number>(numPlayers).fill(0)
  const faceUpByType = new Array<number>(config.numTypes).fill(0)
  let unknownTableCards = 0
  let knownTrumpOnTable = 0

  for (const play of view.table) {
    if (play.revealed) faceUpCount[play.seat] += play.size
    else faceDownCount[play.seat] += play.size

    if (play.types === null) {
      unknownTableCards += play.size
      continue
    }
    for (const type of play.types) {
      faceUpByType[type] += 1
      if (view.trump !== null && type === view.trump && type !== joker) knownTrumpOnTable += 1
    }
  }

  let cursor = 0

  // -- global ---------------------------------------------------------------
  out[cursor + 0] = view.trump !== null ? 1 : 0
  out[cursor + 1] = view.trump === config.offDeckTrump ? 1 : 0
  out[cursor + 2] = view.passStreak / numPlayers
  out[cursor + 3 + Math.min(view.passStreak, 4)] = 1
  // A rule rather than an inference: one short of `n`, passing ends the round and the passer wins it.
  out[cursor + 8] = view.passStreak === numPlayers - 1 ? 1 : 0
  out[cursor + 9] = view.table.reduce((total, play) => total + play.size, 0) / config.deckSize
  out[cursor + 10] = knownTrumpOnTable / 4
  out[cursor + 11] = knownTrumpOnTable >= 4 ? 1 : 0
  out[cursor + 12] = unknownTableCards / 10
  out[cursor + 13] = view.hand.reduce((total, count) => total + count, 0) / Math.max(1, config.handSize)
  out[cursor + 14] = unseenTotal / config.deckSize
  out[cursor + 15] = view.turn / 40
  cursor += GLOBAL_WIDTH

  // -- per card type --------------------------------------------------------
  for (let type = 0; type < config.numTypes; type += 1) {
    const isTrump = view.trump !== null && (type === joker || type === view.trump)
    out[cursor + 0] = isTrump ? 1 : 0
    out[cursor + 1] = type === joker ? 1 : 0
    out[cursor + 2] = view.hand[type] / 4
    out[cursor + 3] = view.hand[type] === 0 ? 1 : 0
    out[cursor + 4] = faceUpByType[type] / 4
    out[cursor + 5] = counts[type] / 4
    out[cursor + 6] = counts[type] === 0 ? 1 : 0
    cursor += TYPE_WIDTH
  }

  // -- per seat, ordered by how soon they act -------------------------------
  const revealedLies = new Array<number>(numPlayers).fill(0)
  const revealedHonest = new Array<number>(numPlayers).fill(0)
  for (const play of view.table) {
    if (!play.revealed || play.types === null) continue
    const honest = play.types.every(
      (type) => type === joker || (view.trump !== null && type === view.trump),
    )
    if (honest) revealedHonest[play.seat] += 1
    else revealedLies[play.seat] += 1
  }

  for (let offset = 0; offset < config.numPlayers; offset += 1) {
    if (offset >= numPlayers) {
      cursor += SEAT_WIDTH // No such seat this round; the row stays all-zero.
      continue
    }
    const seat = offset
    const claimIndex = pendingPlayIndex(view, seat)
    const handSize = view.handSizes[seat]
    out[cursor + 0] = offset === 0 ? 1 : 0
    out[cursor + 1] = seat === view.current ? 1 : 0
    out[cursor + 2] = handSize / Math.max(1, config.handSize)
    out[cursor + 3] = handSize === 0 ? 1 : 0
    out[cursor + 4] = handSize === 1 ? 1 : 0
    out[cursor + 5] = handSize === 2 ? 1 : 0
    out[cursor + 6] = faceDownCount[seat] / 4
    out[cursor + 7] = faceUpCount[seat] / 8
    out[cursor + 8] = seat === view.lastNonPassing ? 1 : 0
    out[cursor + 9] = seat === view.bsTarget ? 1 : 0
    out[cursor + 10] = claimIndex !== null ? 1 : 0
    out[cursor + 11] = claimIndex !== null ? view.table[claimIndex].size / 2 : 0
    out[cursor + 12] = claimLieProbability(view, seat, counts)
    out[cursor + 13] = revealedLies[seat] / 3
    out[cursor + 14] = revealedHonest[seat] / 3
    out[cursor + 15] = offset / numPlayers
    cursor += SEAT_WIDTH
  }

  // -- recent public events, newest first ------------------------------------
  const recent = view.events.slice(-RECENT_EVENTS)
  for (let slot = 0; slot < RECENT_EVENTS; slot += 1) {
    if (slot < recent.length) {
      const event = recent[recent.length - 1 - slot]
      out[cursor + 0] = 1
      // Seats are already indexed from the viewer, so the offset is the index itself.
      out[cursor + 1] = event.seat / numPlayers
      out[cursor + 2] = event.kind === 'play' ? 1 : 0
      out[cursor + 3] = event.kind === 'pass' ? 1 : 0
      out[cursor + 4] = event.kind === 'reveal' ? 1 : 0
      out[cursor + 5] = event.size / 2
    }
    cursor += EVENT_WIDTH
  }

  return out
}
