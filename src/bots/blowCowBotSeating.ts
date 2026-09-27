/**
 * Whether this room is one a bot can play in, and why not when it is not.
 *
 * The classic bots implement the **vanilla** game and nothing else. That is the same scope the RL
 * work runs under (`rl/README.md`), and the reason is not laziness: a character rewrites the action
 * space a bot chooses from, an action rank changes what a revealed card does, a status can forbid the
 * very move a bot is about to make, and a removed rule card silently deletes an enforcement the bot
 * is counting on. A bot that ignored any of those would not misplay visibly — it would sit there
 * issuing moves the server refuses, which reads as a frozen table rather than as a weak opponent.
 *
 * Ante needs none of those clauses, because the mode forces all four off at staging, and gets a
 * different one instead: the learned agent is a fixed-width network and the table has to be the shape
 * it was trained on. See `canSeatAnteBots`.
 *
 * So the gate is deliberately strict and states its reason, rather than letting a host discover the
 * problem mid-match.
 */
import { BLOW_COW_RULE_IDS } from '../game/blowCowRules.ts'
import { getGameMode, type BlowCowState } from '../game/blowCowGame.ts'
import { ANTE_AGENT_SUPPORTED_SEATS, standardRankCount } from './ante/anteSpaces.ts'

export type BotSeatingBlock =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Ante's own gate. The learned agent is a fixed-width network — `AnteConfig` decides the observation
 * width, the action space and the seat rows together, and a checkpoint cannot be moved to another
 * config — so the table has to be a shape a network was trained for. That is one checkpoint per seat
 * count in `ANTE_AGENT_SUPPORTED_SEATS`; any other count is unbuilt, not unsupported.
 *
 * Everything else Ante already forces off at staging (`resolveUseCharacters` and friends), so there
 * is nothing here about characters, statuses or rule cards.
 */
function canSeatAnteBots(state: BlowCowState): BotSeatingBlock {
  const seats = state.seatOrder.length
  if (!ANTE_AGENT_SUPPORTED_SEATS.includes(seats)) {
    return {
      allowed: false,
      reason: `The Ante agent plays ${ANTE_AGENT_SUPPORTED_SEATS.join('- or ')}-seat tables only.`,
    }
  }

  // The rank count is fixed by the seat count (Ante's own table), so this only fails on a hand-made
  // room whose deck someone edited. `standardRankCount` is the same table the config was built from.
  const ranks = (state.deckConfig.selectedRanks ?? []).length
  const expectedRanks = standardRankCount(seats)
  if (ranks !== expectedRanks) {
    return {
      allowed: false,
      reason: `The Ante agent needs the standard ${expectedRanks}-rank deck for ${seats} seats.`,
    }
  }

  return { allowed: true }
}

export function canSeatBots(state: BlowCowState): BotSeatingBlock {
  if (getGameMode(state) === 'ante') {
    return canSeatAnteBots(state)
  }

  if (state.useCharacters) {
    return { allowed: false, reason: 'Bots cannot play with character cards enabled.' }
  }

  if ((state.deckConfig.specialRanks ?? []).length > 0) {
    return { allowed: false, reason: 'Bots cannot play with action ranks in the deck.' }
  }

  if ((state.initialStatuses ?? []).length > 0) {
    return { allowed: false, reason: 'Bots cannot play with starting statuses applied.' }
  }

  const rules = state.rules
  if (rules) {
    const changed = BLOW_COW_RULE_IDS.filter((ruleID) => (rules[ruleID] ?? 'active') !== 'active')
    if (changed.length > 0) {
      return { allowed: false, reason: 'Bots need every rule card left active.' }
    }
  }

  return { allowed: true }
}
