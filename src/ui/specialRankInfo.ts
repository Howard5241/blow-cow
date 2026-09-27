import { BLOW_COW_SPECIAL_RANKS, type BlowCowSpecialRank } from '../game/blowCowGame.ts'
import type { TooltipContent } from './tooltipContext.ts'

/**
 * What each action rank does, written once for every surface that has to say it: the lobby's toggles,
 * a card in hand, and a card face up in front of a seat.
 *
 * The action rank sprites carry no text, and unlike a character card there is no full-size preview to
 * open, so this is the only place a player reads the effect in the app at all. `RULES-EXTENSIONS.md` is the
 * source of truth; this is the short form of it, and it says what one card does and stops there —
 * how several revealed together fan out across the table is left to the rules.
 */
const SPECIAL_RANK_EFFECTS: Record<BlowCowSpecialRank, string> = {
  Plague: 'On reveal, afflicts the next player with a random status for 2 turns.',
  Skip: "On reveal, takes the next player's turn away.",
  Peek: "On reveal, opens the next player's hand to you alone.",
}

/** The tooltip for the rank itself, as the lobby's icon-only toggles show it. */
export function getSpecialRankTooltip(specialRank: BlowCowSpecialRank): TooltipContent {
  return {
    title: specialRank,
    description: SPECIAL_RANK_EFFECTS[specialRank],
  }
}

/**
 * What the rank does, for the two card surfaces that compose a tooltip around it: a card's own title
 * is the card, and on the table it may have an action line under the effect as well.
 */
export function getSpecialRankEffect(specialRank: BlowCowSpecialRank) {
  return SPECIAL_RANK_EFFECTS[specialRank]
}

/** The action rank a sprite filename names, or null. Face-down and unreadable cards answer null. */
export function getSpecialRankFromSprite(filename: string): BlowCowSpecialRank | null {
  const rankSegment = filename.replace('.png', '').split('_')[1] ?? ''

  return BLOW_COW_SPECIAL_RANKS.find((specialRank) => specialRank.toLowerCase() === rankSegment) ?? null
}
