/**
 * The 98 features a **match** policy sees on top of the round's 200.
 *
 * A port of `rl/ante/match_observation.py`, and deliberately an *append*: the round block is encoded
 * unchanged by `anteObservation.ts` and this writes after it, exactly as the Python does. That is
 * what lets one loader run both kinds of checkpoint — a one-round network reads the first 200
 * features and never sees this block, and `anteNet.ts` needs no branch because it copies the
 * observation's tail into the trunk wholesale.
 *
 * **Where the numbers come from.** Gold, elimination and the round number are already public in `G`.
 * The per-seat honesty record was not, and is now: `player.anteRecord` is written by the engine at
 * every round ending (`recordAnteRoundOutcome`) and read here through `getAnteSeatRecord`. It is kept
 * in `G` rather than accumulated in the browser because a client reconstructing it from state deltas
 * could not be checked against anything, would start blank for a bot seated mid-match, and would be
 * lost on reload — and a wrong honesty block does not crash, it just makes the bot play badly, which
 * is the one failure nothing else here would catch.
 */
import {
  getActivePlayerIDs,
  getAnteStartingGold,
  getPlayerGold,
  getRoundLimit,
  type BlowCowState,
} from '../../game/blowCowGame.ts'
import {
  getAnteRecordObservations,
  getAnteSeatRecord,
  type BlowCowAnteSeatRecord,
} from '../../game/blowCowAnte.ts'

/** Pseudo-counts for the shrunk lie rate. With nothing seen the estimate is 0.5. */
const LIE_RATE_PRIOR = 1.0
/** What a "confident" honesty record looks like, for the confidence feature's half-way point. */
const CONFIDENCE_SCALE = 6.0

/** 18 match globals. */
export const MATCH_GLOBAL_WIDTH = 18
/** 16 columns per seat row. */
export const MATCH_SEAT_WIDTH = 16

export function matchBlockWidth(numSeats: number): number {
  return MATCH_GLOBAL_WIDTH + numSeats * MATCH_SEAT_WIDTH
}

/**
 * One seat's row, already ordered. Offset 0 is the viewer and offset k is whoever acts k turns
 * later, matching the round block's rows; seats already eliminated have no place in that order and
 * fill the leftover rows, where `isEliminated` and the two global counts carry everything about them
 * a policy can use.
 */
export type AnteMatchSeatView = {
  gold: number
  isEliminated: boolean
  record: BlowCowAnteSeatRecord
}

export type AnteMatchView = {
  /** Seats the checkpoint was trained for — the row count, which never changes mid-match. */
  numSeats: number
  roundNumber: number
  roundLimit: number
  startingGold: number
  /** Rows in the order described on {@link AnteMatchSeatView}; always `numSeats` long. */
  seats: AnteMatchSeatView[]
  /**
   * The seat doing the looking, carried rather than inferred.
   *
   * Row 0 is the viewer *only* while they are seated in a live round, which is the one case a bot
   * ever encodes for itself. The Python encodes every seat's view of every position — including a
   * seat that has already gone bankrupt, whose row is not first and may not exist at all — and reads
   * `gold[viewer]` and `records[viewer]` directly throughout. Deriving those from `seats[0]` agreed
   * with it everywhere the round was live and silently disagreed everywhere else.
   */
  viewer: AnteMatchSeatView
  /**
   * Where the viewer sits in {@link seats}. It is 0 only while they are in the turn order the rows
   * are built from: an eliminated seat is not, and lands in the leftover rows after it. `-1` if they
   * have no row at all, which the seating gate should make unreachable.
   *
   * Only the "which other seats are there" counts read it. The self-blanked lie columns stay keyed
   * on row 0, because row 0 is what the Python's `offset > 0` blanks — not the viewer.
   */
  viewerRowIndex: number
}

function shrunkLieRate(record: BlowCowAnteSeatRecord): number {
  return (record.lies + LIE_RATE_PRIOR) / (getAnteRecordObservations(record) + 2.0 * LIE_RATE_PRIOR)
}

function rawLieRate(record: BlowCowAnteSeatRecord): number {
  const seen = getAnteRecordObservations(record)
  return seen === 0 ? 0.5 : record.lies / seen
}

/**
 * Build the match view from a client's `G`, for one seat.
 *
 * `turnOrder` is the active seats in turn order starting at the viewer — the same walk the round
 * block uses, passed in rather than recomputed so the two blocks can never disagree about who sits
 * where.
 */
export function buildAnteMatchView(
  state: BlowCowState,
  turnOrder: string[],
  numSeats: number,
  viewerPlayerID: string,
): AnteMatchView {
  const active = getActivePlayerIDs(state)
  const ordered = turnOrder.length > 0 ? turnOrder : active
  const rows: string[] = [...ordered]
  for (const playerID of state.seatOrder) {
    if (!rows.includes(playerID)) rows.push(playerID)
  }

  const describe = (playerID: string): AnteMatchSeatView => ({
    gold: getPlayerGold(state.players[playerID]),
    isEliminated: !active.includes(playerID),
    record: getAnteSeatRecord(state.players[playerID]),
  })
  const seats: AnteMatchSeatView[] = rows.slice(0, numSeats).map(describe)
  // A table smaller than the checkpoint's width should never reach here — the seating gate matches
  // the two — but padding keeps the encoder total-safe rather than writing past the block.
  while (seats.length < numSeats) {
    seats.push({
      gold: 0,
      isEliminated: true,
      record: getAnteSeatRecord(undefined),
    })
  }

  return {
    numSeats,
    roundNumber: state.round.roundNumber,
    roundLimit: getRoundLimit(state),
    startingGold: getAnteStartingGold(state),
    seats,
    viewer: describe(viewerPlayerID),
    viewerRowIndex: rows.slice(0, numSeats).indexOf(viewerPlayerID),
  }
}

/**
 * Write the match block into `out` at `offset`. Returns the number of features written.
 *
 * Kept as a writer into an existing array rather than returning its own, because the round block is
 * already sitting in front of it and one allocation per decision is enough.
 */
export function encodeAnteMatchBlock(
  view: AnteMatchView,
  out: Float32Array,
  offset: number,
): number {
  const { numSeats, seats, startingGold, roundLimit, viewer, viewerRowIndex } = view
  const starting = startingGold
  const roundsLeft = Math.max(0, roundLimit - view.roundNumber)

  const activeSeats = seats.filter((seat) => !seat.isEliminated)
  // The Python's `others` is every *active* seat that is not the viewer. When the viewer has been
  // eliminated they are in none of these rows, so every active seat counts as an other — which is
  // why this excludes a row index rather than assuming the viewer is row 0.
  const others = seats.filter((seat, index) => index !== viewerRowIndex && !seat.isEliminated)
  const bestOther = others.length > 0 ? Math.max(...others.map((seat) => seat.gold)) : viewer.gold
  const ahead = others.filter((seat) => seat.gold > viewer.gold).length
  const behind = others.filter((seat) => seat.gold < viewer.gold).length

  let tableObservations = 0
  let tableLies = 0
  for (const seat of seats) {
    tableObservations += getAnteRecordObservations(seat.record)
    tableLies += seat.record.lies
  }
  const tableLieRate = tableObservations === 0 ? 0.5 : tableLies / tableObservations

  const totalGold = seats.reduce((sum, seat) => sum + seat.gold, 0)
  const activeGold = activeSeats.reduce((sum, seat) => sum + seat.gold, 0)

  let cursor = offset
  out[cursor + 0] = view.roundNumber / roundLimit
  out[cursor + 1] = roundsLeft / roundLimit
  out[cursor + 2] = view.roundNumber <= 1 ? 1 : 0
  out[cursor + 3] = roundsLeft <= 1 ? 1 : 0
  out[cursor + 4] = viewer.gold / starting
  // One lost `Call BS` from leaving the game, which is the only cliff in the mode.
  out[cursor + 5] = viewer.gold === 1 ? 1 : 0
  out[cursor + 6] = viewer.gold === 2 ? 1 : 0
  out[cursor + 7] = ahead / Math.max(1, activeSeats.length - 1)
  out[cursor + 8] = ahead === 0 ? 1 : 0
  out[cursor + 9] = behind === 0 && activeSeats.length > 1 ? 1 : 0
  out[cursor + 10] = Math.max(-1, Math.min(1, (viewer.gold - bestOther) / starting))
  out[cursor + 11] = activeSeats.length / numSeats
  out[cursor + 12] = (numSeats - activeSeats.length) / numSeats
  out[cursor + 13] = totalGold / (numSeats * starting)
  out[cursor + 14] = activeGold / Math.max(1, activeSeats.length) / starting
  out[cursor + 15] = tableLieRate
  out[cursor + 16] = shrunkLieRate(viewer.record)
  out[cursor + 17] = viewer.record.callsWon / Math.max(1, viewer.record.callsMade)
  cursor += MATCH_GLOBAL_WIDTH

  const roundsSeen = Math.max(1, view.roundNumber - 1)
  for (let offsetIndex = 0; offsetIndex < numSeats; offsetIndex += 1) {
    const seat = seats[offsetIndex]
    const record = seat.record
    const seen = getAnteRecordObservations(record)
    out[cursor + 0] = 1
    out[cursor + 1] = seat.isEliminated ? 1 : 0
    out[cursor + 2] = seat.gold / starting
    out[cursor + 3] = seat.gold === 1 && !seat.isEliminated ? 1 : 0
    out[cursor + 4] = Math.max(-1, Math.min(1, (seat.gold - viewer.gold) / starting))
    out[cursor + 5] = seat.gold > viewer.gold ? 1 : 0
    if (offsetIndex > 0) {
      // Zero for the viewer's own row by construction, exactly as the round block's lie estimate is:
      // you do not need a read on your own honesty, and a self-read would be a different quantity
      // from the one every other row carries.
      out[cursor + 6] = shrunkLieRate(record)
      out[cursor + 7] = rawLieRate(record)
      out[cursor + 8] = shrunkLieRate(record) - tableLieRate
    }
    out[cursor + 9] = seen / (seen + CONFIDENCE_SCALE)
    out[cursor + 10] = Math.min(1, seen / 20)
    out[cursor + 11] = Math.min(1, record.lies / 10)
    out[cursor + 12] = Math.min(1, record.callsMade / roundsSeen)
    out[cursor + 13] = record.callsWon / Math.max(1, record.callsMade)
    out[cursor + 14] = Math.min(1, record.roundsWon / roundsSeen)
    out[cursor + 15] = Math.min(1, record.bsLosses / roundsSeen)
    cursor += MATCH_SEAT_WIDTH
  }

  return cursor - offset
}
