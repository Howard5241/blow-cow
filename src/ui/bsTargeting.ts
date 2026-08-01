/**
 * Client mirror of the server's BS target rules.
 *
 * The server is authoritative — see `resolveBSTargetSelection` in
 * `src/game/blowCowGame.ts:1455`. Nothing here decides an outcome. It only decides whether
 * the board dispatches `callBS` or shows a fail message instead, because an `INVALID_MOVE`
 * returned by the server is silent and would otherwise look like a dead button.
 *
 * Every predicate below reads only fields that survive `hideSecretState`
 * (`blowCowGame.ts:2672`), which masks card identities but not `character`,
 * `wasTrumpSelection`, `claimedRank`, `declaredCardCount`, or `usedDreamerDirectionChange`.
 */
import { getTableCardCount, type BlowCowState } from '../game/blowCowGame.ts'
import {
  getDisplayedPlayCardCount,
  getHiddenOverlayCardIDs,
  getLatestHiddenPlay,
  type BlowCowTablePlay,
} from './tablePlays.ts'

export type ClientBSTargetKind = 'default' | 'pawnEnPassant' | 'grandmasterOverride'

export type ClientBSTargetSelection = {
  targetSeatID: string
  targetPlay: BlowCowTablePlay
  kind: ClientBSTargetKind
}

export type DreamerCheatKind = 'repeatTrump' | 'directionChange' | 'illegalCount'

/** Mirrors `getPendingPlay` (blowCowGame.ts:835). */
export function getClientPendingPlay(state: BlowCowState, seatID: string | null | undefined) {
  if (!seatID) {
    return null
  }

  const pendingRevealPlayID = state.players[seatID]?.pendingRevealPlayID ?? null
  const pendingRevealPlay = pendingRevealPlayID
    ? state.table.plays.find((play) => play.id === pendingRevealPlayID) ?? null
    : null

  if (pendingRevealPlay && getHiddenOverlayCardIDs(pendingRevealPlay).length > 0) {
    return pendingRevealPlay
  }

  return getLatestHiddenPlay(state.table.plays, seatID)
}

/** Mirrors `getDefaultBSTargetPlayerID` (blowCowGame.ts:1401). */
export function getClientDefaultBSTargetSeatID(state: BlowCowState, callerSeatID: string | null) {
  if (state.bsResolution) {
    return null
  }

  const targetSeatID = state.round.lastNonPassingPlayerID
  if (!state.round.trumpRank || !targetSeatID || targetSeatID === callerSeatID) {
    return null
  }

  return getClientPendingPlay(state, targetSeatID) ? targetSeatID : null
}

/** Mirrors `canUseGrandmasterBSOverride` (blowCowGame.ts:1362). */
export function canUseClientGrandmasterBSOverride(state: BlowCowState, seatID: string | null) {
  if (!seatID) {
    return false
  }

  const player = state.players[seatID]
  return player?.character === 'The Grandmaster' && !player.hasUsedGrandmasterBSOverride
}

/** Mirrors `getPawnEnPassantTargetSelection` (blowCowGame.ts:1415). */
export function getClientPawnEnPassantTarget(state: BlowCowState, callerSeatID: string | null) {
  if (!callerSeatID || state.players[callerSeatID]?.character !== 'The Pawn') {
    return null
  }

  if (state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const triggerSeatID = getClientDefaultBSTargetSeatID(state, callerSeatID)
  if (!triggerSeatID) {
    return null
  }

  const triggerPlay = getClientPendingPlay(state, triggerSeatID)
  if (!triggerPlay || triggerPlay.cards.length !== 2) {
    return null
  }

  const triggerPlayIndex = state.table.plays.findIndex((play) => play.id === triggerPlay.id)
  if (triggerPlayIndex <= 0) {
    return null
  }

  const targetPlay = state.table.plays[triggerPlayIndex - 1]
  if (getHiddenOverlayCardIDs(targetPlay).length === 0 || targetPlay.playerID === callerSeatID) {
    return null
  }

  const pendingTargetPlay = getClientPendingPlay(state, targetPlay.playerID)
  if (!pendingTargetPlay || pendingTargetPlay.id !== targetPlay.id) {
    return null
  }

  return {
    triggerSeatID,
    targetSeatID: targetPlay.playerID,
    targetPlay: pendingTargetPlay,
  }
}

/**
 * Mirrors `resolveBSTargetSelection` (blowCowGame.ts:1455), branch for branch. Returns null
 * when the server would reject the request.
 */
export function resolveClientBSTargetSelection(
  state: BlowCowState,
  callerSeatID: string | null,
  requestedTargetSeatID: string | null,
): ClientBSTargetSelection | null {
  if (!callerSeatID || state.bsResolution || !state.round.trumpRank) {
    return null
  }

  const defaultTargetSeatID = getClientDefaultBSTargetSeatID(state, callerSeatID)
  if (!requestedTargetSeatID || requestedTargetSeatID === defaultTargetSeatID) {
    const defaultTargetPlay = defaultTargetSeatID ? getClientPendingPlay(state, defaultTargetSeatID) : null
    return defaultTargetSeatID && defaultTargetPlay
      ? { targetSeatID: defaultTargetSeatID, targetPlay: defaultTargetPlay, kind: 'default' }
      : null
  }

  const pawnEnPassantTarget = getClientPawnEnPassantTarget(state, callerSeatID)
  if (pawnEnPassantTarget && requestedTargetSeatID === pawnEnPassantTarget.targetSeatID) {
    return {
      targetSeatID: pawnEnPassantTarget.targetSeatID,
      targetPlay: pawnEnPassantTarget.targetPlay,
      kind: 'pawnEnPassant',
    }
  }

  if (requestedTargetSeatID === callerSeatID || !canUseClientGrandmasterBSOverride(state, callerSeatID)) {
    return null
  }

  const requestedTargetPlay = getClientPendingPlay(state, requestedTargetSeatID)
  if (!requestedTargetPlay) {
    return null
  }

  return { targetSeatID: requestedTargetSeatID, targetPlay: requestedTargetPlay, kind: 'grandmasterOverride' }
}

/**
 * Mirrors the four Dreamer catch predicates used by `createBSResolution`
 * (blowCowGame.ts:1382-1399). Any non-null result means calling BS on this play also catches
 * the cheat, which overrides the Reverse Rule.
 */
export function getDreamerCheatForPlay(
  state: BlowCowState,
  play: BlowCowTablePlay | null,
): DreamerCheatKind | null {
  if (!play || state.players[play.playerID]?.character !== 'The Dreamer') {
    return null
  }

  if (
    play.wasTrumpSelection
    && state.round.previousTrumpRank !== null
    && play.claimedRank === state.round.previousTrumpRank
  ) {
    return 'repeatTrump'
  }

  if (play.usedDreamerDirectionChange) {
    return 'directionChange'
  }

  if (
    play.cards.length > getDisplayedPlayCardCount(play)
    || getTableCardCount(state.table) > state.round.maxCardsOnTable
  ) {
    return 'illegalCount'
  }

  return null
}

export function getDreamerCheatLabel(cheatKind: DreamerCheatKind) {
  if (cheatKind === 'repeatTrump') {
    return 'reused the previous round trump on the opening play'
  }

  if (cheatKind === 'directionChange') {
    return 'changed the turn direction during that hidden play'
  }

  return 'broke the normal card-count limits'
}
