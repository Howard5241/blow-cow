/**
 * What a bot seat does next, as a move name plus arguments, or null for "nothing to do".
 *
 * Ported from the scripted agents in `rl/blowcow/agents.py`. The port is of the *decisions*, not of
 * the machinery around them: the Python side works through a flat action space over a canonical rank
 * relabelling, because a network needs fixed-width inputs. Here the real `G` is in hand, so the same
 * choices are expressed directly over cards and ranks.
 *
 * **Nothing here decides an outcome.** The server is authoritative and every move below is validated
 * there; an illegal one is refused as `INVALID_MOVE`, which is silent. So this file's job is to be
 * right about legality rather than to be trusted about it, and `chooseTurnAction` mirrors
 * `validateCommonPlay` for that reason.
 *
 * Vanilla only. Characters, action ranks, statuses and removed rule cards are gated off before a bot
 * can be seated (`canSeatBots` in `blowCowBotSeating.ts`), so no branch here reads a character, a
 * status, or a rule status.
 */
import {
  BLOW_COW_RANKS,
  getActivePlayerIDs,
  getTableCardCount,
  isCardFaceUpOnTable,
  isTrumpCardInMatch,
  type BlowCowCard,
  type BlowCowRank,
  type BlowCowState,
} from '../game/blowCowGame.ts'
import { getClientDefaultBSTargetSeatID, getClientPendingPlay } from '../ui/bsTargeting.ts'
import { getFaceDownOverlayCardIDs } from '../ui/tablePlays.ts'
import type { BlowCowBotKind } from './blowCowBotTypes.ts'

export type BotMove = {
  move: string
  args: unknown[]
  /** Why the bot did it, for dev logging only. Never shown to a player. */
  reason: string
}

type Rng = () => number

const SUITS_PER_RANK = 4
const JOKER_COUNT = 2

/** A card that would be honest against `trumpRank`. `isTrumpCardInMatch` already covers Jokers. */
function isHonestCard(state: BlowCowState, card: BlowCowCard, trumpRank: BlowCowRank | null) {
  return trumpRank !== null && isTrumpCardInMatch(state, card, trumpRank)
}

function countByRank(hand: BlowCowCard[]) {
  const counts = new Map<string, number>()
  for (const card of hand) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1)
  }
  return counts
}

/**
 * Copies of each rank the viewer cannot see: opponents' hands and their face-down piles. Mirrors
 * `unaccounted_by_type`, over the real deck composition rather than a canonical tally — the deck is
 * `deckConfig.selectedRanks` in four suits plus two Jokers, and is derived rather than stored.
 */
function countUnaccounted(state: BlowCowState, viewerID: string) {
  const counts = new Map<string, number>()
  for (const rank of state.deckConfig.selectedRanks) {
    counts.set(rank, SUITS_PER_RANK)
  }
  for (const rank of state.deckConfig.specialRanks ?? []) {
    counts.set(rank, SUITS_PER_RANK)
  }
  counts.set('Joker', JOKER_COUNT)

  const subtract = (rank: string, amount = 1) => {
    counts.set(rank, (counts.get(rank) ?? 0) - amount)
  }

  const viewer = state.players[viewerID]
  for (const card of viewer?.hand ?? []) {
    subtract(card.rank)
  }

  for (const play of state.table.plays) {
    const faceDown = new Set(getFaceDownOverlayCardIDs(play))
    for (const card of play.cards) {
      // Face-up is public; the viewer's own face-down pile is known to the viewer.
      if (!faceDown.has(card.id) || play.playerID === viewerID) {
        subtract(card.rank)
      }
    }
  }

  // A scored set is four cards of one rank, gone from play rather than hidden.
  for (const player of Object.values(state.players)) {
    for (const scoredSet of player.scoredSets ?? []) {
      subtract(scoredSet.rank, SUITS_PER_RANK)
    }
  }

  for (const [rank, value] of counts) {
    counts.set(rank, Math.max(0, value))
  }
  return counts
}

/**
 * Chance the target's hidden claim is a lie, by counting. Mirrors `lie_probability_from_counts` in
 * `rl/blowcow/observation.py`, including the 4x honesty bias: a player holding trump plays it far
 * more often than a blind draw would.
 */
function probabilityClaimIsALie(state: BlowCowState, viewerID: string, targetID: string) {
  const trumpRank = state.round.trumpRank
  if (!trumpRank) {
    return 0
  }

  const play = getClientPendingPlay(state, targetID)
  if (!play) {
    return 0
  }

  const claimed = getFaceDownOverlayCardIDs(play).length
  if (claimed === 0) {
    return 0
  }

  const unaccounted = countUnaccounted(state, viewerID)
  let unseen = 0
  for (const value of unaccounted.values()) {
    unseen += value
  }
  const trumpLeft = (unaccounted.get(trumpRank) ?? 0) + (unaccounted.get('Joker') ?? 0)

  if (trumpLeft < claimed) {
    return 1 // They cannot be telling the truth; the cards are not there to be held.
  }
  if (unseen <= 0) {
    return 0
  }

  let chanceAllTrump = 1
  for (let offset = 0; offset < claimed; offset += 1) {
    chanceAllTrump *= Math.max(0, trumpLeft - offset) / Math.max(1, unseen - offset)
  }
  return 1 - Math.min(1, chanceAllTrump * 4)
}

/** Face-up trump on the table. Four or more arms the Reverse Rule, which inverts a challenge. */
function countFaceUpTrump(state: BlowCowState) {
  const trumpRank = state.round.trumpRank
  if (!trumpRank) {
    return 0
  }

  let total = 0
  for (const play of state.table.plays) {
    const faceDown = new Set(getFaceDownOverlayCardIDs(play))
    for (const card of play.cards) {
      if (!faceDown.has(card.id) && isTrumpCardInMatch(state, card, trumpRank)) {
        total += 1
      }
    }
  }
  return total
}

/** Every card subset the bot may legally put down, capped at the two a non-cheat is allowed. */
function enumeratePlayableGroups(state: BlowCowState, hand: BlowCowCard[]) {
  const room = state.round.maxCardsOnTable - getTableCardCount(state.table)
  const limit = Math.max(0, Math.min(2, room))
  if (limit === 0) {
    return []
  }

  const groups: BlowCowCard[][] = []
  for (let index = 0; index < hand.length; index += 1) {
    groups.push([hand[index]])
    if (limit < 2) {
      continue
    }
    for (let other = index + 1; other < hand.length; other += 1) {
      groups.push([hand[index], hand[other]])
    }
  }
  return groups
}

/**
 * The Python `_score_choice`, in the same order: honest first, then dumping from a rank the bot
 * already holds three of, then sheer count. A fourth card completes a set, a completed set is a
 * point, and points are what lose this game.
 */
function scoreGroup(
  state: BlowCowState,
  group: BlowCowCard[],
  counts: Map<string, number>,
  trumpRank: BlowCowRank | null,
) {
  const honest = group.every((card) => isHonestCard(state, card, trumpRank))
  const avoidsSet = group.filter((card) => (counts.get(card.rank) ?? 0) === 3).length
  return (honest ? 1_000_000 : 0) + avoidsSet * 1_000 + group.length
}

function pickBestGroup(
  state: BlowCowState,
  groups: BlowCowCard[][],
  counts: Map<string, number>,
  trumpRank: BlowCowRank | null,
) {
  let best: BlowCowCard[] | null = null
  let bestScore = -Infinity
  for (const group of groups) {
    const score = scoreGroup(state, group, counts, trumpRank)
    if (score > bestScore) {
      best = group
      bestScore = score
    }
  }
  return best
}

/** Trump ranks the bot may open a round with, honouring the Rank Change Rule. */
function chooseTrumpRank(state: BlowCowState, hand: BlowCowCard[], rng: Rng) {
  const blocked = state.round.previousTrumpRank
  const options = (state.deckConfig.selectedRanks.length
    ? state.deckConfig.selectedRanks
    : [...BLOW_COW_RANKS]
  ).filter((rank) => rank !== blocked)

  if (options.length === 0) {
    return null
  }

  const counts = countByRank(hand)
  let best = options[0]
  let bestCount = -1
  for (const rank of options) {
    const held = counts.get(rank) ?? 0
    if (held > bestCount) {
      best = rank
      bestCount = held
    }
  }
  // A rank nobody holds is as good as any other opener, so break that tie at random rather than
  // always opening on the lowest — a predictable opener is a free read for a human.
  return bestCount > 0 ? best : options[Math.floor(rng() * options.length)] ?? best
}

/** Whether this bot would challenge, given its kind. */
function wantsToCallBS(state: BlowCowState, kind: BlowCowBotKind, playerID: string, rng: Rng) {
  const targetID = getClientDefaultBSTargetSeatID(state, playerID)
  if (!targetID) {
    return false
  }

  if (kind === 'caller') {
    return true
  }
  if (kind === 'honest' || kind === 'liar') {
    return false
  }
  if (kind === 'random') {
    return rng() < 0.15
  }

  // The Reverse Rule is the interesting part: four or more face-up trump flips the punishment, so
  // once armed the profitable challenge is against a player believed *honest*.
  const lie = probabilityClaimIsALie(state, playerID, targetID)
  return countFaceUpTrump(state) >= 4 ? lie < 0.35 : lie > 0.55
}

/** The bot's action on its own turn: a play, a pass, or a challenge. */
function chooseTurnAction(
  state: BlowCowState,
  kind: BlowCowBotKind,
  playerID: string,
  rng: Rng,
): BotMove | null {
  const player = state.players[playerID]
  if (!player) {
    return null
  }

  const hand = player.hand ?? []
  const counts = countByRank(hand)
  const trumpRank = state.round.trumpRank

  /*
   * The Final Two Players Rule. With two left and the BS target's hand empty, `validateCommonPlay`
   * refuses Play *and* Pass — challenging is the only action that can still stop them leaving, so it
   * is the only one offered. Every bot takes it regardless of kind, because the alternative is a seat
   * that issues refused moves until the table freezes. Hand *counts* are public, so this is a legal
   * thing for a client to know.
   */
  const activeIDs = getActivePlayerIDs(state)
  const bsTargetID = getClientDefaultBSTargetSeatID(state, playerID)
  if (activeIDs.length === 2 && bsTargetID && (state.players[bsTargetID]?.hand.length ?? 0) === 0) {
    return { move: 'callBS', args: [{}], reason: 'forced to challenge by the Final Two rule' }
  }

  if (wantsToCallBS(state, kind, playerID, rng)) {
    return { move: 'callBS', args: [{}], reason: 'challenged the standing claim' }
  }

  const groups = enumeratePlayableGroups(state, hand)

  // No trump yet: this play sets it, and the bot must name a rank.
  if (trumpRank === null) {
    const nextTrump = chooseTrumpRank(state, hand, rng)
    if (nextTrump && groups.length > 0) {
      const honestFirst = groups.filter((group) =>
        group.every((card) => isHonestCard(state, card, nextTrump)))
      const pool = kind === 'liar' ? groups : (honestFirst.length ? honestFirst : groups)
      const chosen = kind === 'random'
        ? pool[Math.floor(rng() * pool.length)]
        : pickBestGroup(state, pool, counts, nextTrump)
      if (chosen) {
        return {
          move: 'selectTrumpAndPlay',
          args: [{ trumpRank: nextTrump, cardIDs: chosen.map((card) => card.id) }],
          reason: `opened the round on ${nextTrump}`,
        }
      }
    }
    // Nothing playable and no trump: passing is all that is left.
    return { move: 'pass', args: [{}], reason: 'could not open the round' }
  }

  if (groups.length > 0) {
    const honestGroups = groups.filter((group) =>
      group.every((card) => isHonestCard(state, card, trumpRank)))

    if (kind === 'random') {
      const chosen = groups[Math.floor(rng() * groups.length)]
      return {
        move: 'play',
        args: [{ cardIDs: chosen.map((card) => card.id) }],
        reason: 'played at random',
      }
    }

    if (kind === 'liar') {
      const chosen = pickBestGroup(state, groups, counts, trumpRank)
      if (chosen) {
        return {
          move: 'play',
          args: [{ cardIDs: chosen.map((card) => card.id) }],
          reason: 'dumped cards regardless of the truth',
        }
      }
    }

    if (honestGroups.length > 0) {
      const chosen = pickBestGroup(state, honestGroups, counts, trumpRank)
      if (chosen) {
        return {
          move: 'play',
          args: [{ cardIDs: chosen.map((card) => card.id) }],
          reason: 'played trump honestly',
        }
      }
    }

    // `heuristic` bluffs only while the table is cheap, or when its hand is nearly empty — running
    // out is how a player leaves, and a player who has left can never be given another point.
    if (kind === 'heuristic') {
      const fill = getTableCardCount(state.table) / Math.max(1, state.round.maxCardsOnTable)
      if (fill < 0.6 || hand.length <= 2) {
        const chosen = pickBestGroup(state, groups, counts, trumpRank)
        if (chosen) {
          return {
            move: 'play',
            args: [{ cardIDs: chosen.map((card) => card.id) }],
            reason: 'bluffed while the table was cheap',
          }
        }
      }
    }

    if (kind === 'caller') {
      const chosen = groups[0]
      return {
        move: 'play',
        args: [{ cardIDs: chosen.map((card) => card.id) }],
        reason: 'played with nothing to challenge',
      }
    }
  }

  return { move: 'pass', args: [{}], reason: 'passed' }
}

/**
 * The procedures a bot has to drive itself, before any decision about the game.
 *
 * Only the *caller* may drive a BS or Reset walk (`getDrivableResolution`), and only the seat on the
 * clock may drive its own turn reveal, so a bot never blocks a procedure a human started — it drives
 * exactly the ones it is responsible for. Without this a bot-called challenge would freeze the table
 * on an animation nobody can advance.
 */
/**
 * Exported because the Ante bot reuses it verbatim. A procedure is not a choice — Take Turn, the
 * Reveal Rule walk and the round-end reveal are button presses the rules oblige — and Ante drives
 * them through the very same records, so a second copy could only ever drift from this one.
 */
export function chooseProcedureMove(state: BlowCowState, playerID: string): BotMove | null {
  const turnOpening = state.turnOpening ?? null

  // Take Turn. The turn cannot be spent until it is opened. Every move in this procedure carries the
  // id of the record it acts on, so a stale click from a previous turn is refused rather than applied.
  if (turnOpening && turnOpening.playerID === playerID && !turnOpening.isTaken) {
    return {
      move: 'takeTurn',
      args: [{ openingID: turnOpening.id }],
      reason: 'took its turn',
    }
  }

  // The Reveal Rule walk this turn owes, flipped one card at a time then confirmed.
  const reveal = turnOpening?.reveal ?? null
  if (turnOpening && turnOpening.playerID === playerID && turnOpening.isTaken && reveal) {
    /*
     * `isCardFaceUpOnTable` and not one of the display helpers in `tablePlays.ts`. Those answer
     * "what should this element draw", which folds in Cat-rehidden overlays and the disguise, and is
     * deliberately not the same question the server asks here. Asking the wrong one produced a bot
     * that pressed Continue while the server still considered a card face down, and was refused.
     */
    const play = state.table.plays.find((tablePlay) => tablePlay.id === reveal.playID) ?? null
    const owed = reveal.cardIDs ?? []
    const next = play
      ? owed.find((cardID) => !isCardFaceUpOnTable(play, cardID))
      : undefined
    if (next) {
      return {
        move: 'revealTurnCard',
        args: [{ openingID: turnOpening.id, cardID: next }],
        reason: 'revealed a card it owed',
      }
    }
    return {
      move: 'finalizeTurnReveal',
      args: [{ openingID: turnOpening.id }],
      reason: 'finished its reveal',
    }
  }

  const bs = state.bsResolution
  if (bs && bs.callerPlayerID === playerID) {
    return driveRevealWalk(state, bs.id, bs.revealOrder, bs.revealStepIndex, {
      reveal: 'revealBSCard',
      advance: 'advanceBSReveal',
      finalize: 'finalizeBSResolution',
      // A BS challenge always has a punishment; it takes no target, since the verdict decides it.
      punish: bs.isPunishing ? null : { move: 'beginBSPunishment' },
    })
  }

  const reset = state.resetResolution
  if (reset && reset.callerPlayerID === playerID) {
    /*
     * A reset walk only has a punishment step when a Gambler showdown produced one, and `isPunishing`
     * lives on that showdown rather than on the resolution. In vanilla there is never a showdown — an
     * all-pass `roundReturn` least of all — so the walk goes straight from the last reveal to the
     * finalize, and pressing Punish is refused.
     */
    const showdown = reset.showdown ?? null
    return driveRevealWalk(state, reset.id, reset.revealOrder, reset.revealStepIndex, {
      reveal: 'revealResetCard',
      advance: 'advanceResetReveal',
      finalize: 'finalizeResetResolution',
      punish: showdown && !showdown.isPunishing && showdown.weakestPlayerIDs?.length
        ? { move: 'beginResetPunishment', punishedPlayerID: showdown.weakestPlayerIDs[0] }
        : null,
    })
  }

  return null
}

/**
 * One step of a caller-driven table reveal, shared by the BS walk and both Reset walks: flip every
 * face-down card in front of the focused seat, confirm the step, then punish and finalize.
 */
function driveRevealWalk(
  state: BlowCowState,
  resolutionID: string,
  revealOrder: string[],
  revealStepIndex: number,
  moves: {
    reveal: string
    advance: string
    finalize: string
    /** Null when this walk has no punishment step left to press, which is the vanilla reset case. */
    punish: { move: string; punishedPlayerID?: string } | null
  },
): BotMove | null {
  if (revealStepIndex < revealOrder.length) {
    const focusedPlayerID = revealOrder[revealStepIndex]
    for (const play of state.table.plays) {
      if (play.playerID !== focusedPlayerID) {
        continue
      }
      // The same predicate the walk itself uses, for the reason given on the turn reveal above.
      const next = play.cards.find((card) => !isCardFaceUpOnTable(play, card.id))?.id
      if (next) {
        return {
          move: moves.reveal,
          args: [{ resolutionID, cardID: next }],
          reason: `revealed a card in front of seat ${focusedPlayerID}`,
        }
      }
    }
    return {
      move: moves.advance,
      args: [{ resolutionID }],
      reason: 'advanced the reveal',
    }
  }

  if (moves.punish) {
    const args: Record<string, unknown> = { resolutionID }
    if (moves.punish.punishedPlayerID) {
      args.punishedPlayerID = moves.punish.punishedPlayerID
    }
    return { move: moves.punish.move, args: [args], reason: 'began the punishment' }
  }

  return { move: moves.finalize, args: [{ resolutionID }], reason: 'finalized the resolution' }
}

/**
 * The bot's next move, or null when it is not this seat's move to make.
 *
 * Order matters: procedures first, because a live one blocks every ordinary action anyway, and an
 * un-driven one blocks the whole table.
 */
export function decideBotMove(
  state: BlowCowState,
  currentPlayerID: string,
  playerID: string,
  kind: BlowCowBotKind,
  rng: Rng = Math.random,
): BotMove | null {
  if (state.gameStatus !== 'active') {
    return null
  }

  const player = state.players[playerID]
  if (!player || player.hasLeft) {
    return null
  }

  const procedure = chooseProcedureMove(state, playerID)
  if (procedure) {
    return procedure
  }

  // A procedure somebody else is driving holds the whole table, this seat included.
  if (state.bsResolution || state.resetResolution || state.accusation) {
    return null
  }

  if (currentPlayerID !== playerID) {
    return null
  }

  // The turn has to be open before it can be spent; `chooseProcedureMove` opens it.
  if (state.turnOpening && state.turnOpening.playerID === playerID && !state.turnOpening.isTaken) {
    return null
  }

  return chooseTurnAction(state, kind, playerID, rng)
}
