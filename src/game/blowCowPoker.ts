import type { BlowCowCard, BlowCowCardSuit, BlowCowRank } from './blowCowGame.ts'

/**
 * Poker hand evaluation for The Gambler's Reset showdown, and nothing else. It is kept out of
 * `blowCowGame.ts` because it needs none of that module's state: it takes cards and returns a
 * comparable score, so it can be reasoned about and checked entirely on its own.
 *
 * The hands it scores are not poker hands. A Reset showdown ranks whatever each player happens to
 * have in front of them, which is anywhere from nothing to six or more cards, so the two rules that
 * make this work are that categories are the standard five-card ones — four to a flush is not a
 * flush — and that a short hand simply cannot reach the higher ones. Nobody is padded out to five.
 */

export const BLOW_COW_POKER_CATEGORIES = [
  'none',
  'highCard',
  'pair',
  'twoPair',
  'threeOfAKind',
  'straight',
  'flush',
  'fullHouse',
  'fourOfAKind',
  'straightFlush',
] as const

export type BlowCowPokerCategory = (typeof BLOW_COW_POKER_CATEGORIES)[number]

export type BlowCowPokerHand = {
  category: BlowCowPokerCategory
  /** Index into `BLOW_COW_POKER_CATEGORIES`. Higher is stronger. */
  categoryRank: number
  /**
   * Ranks that separate two hands of the same category, most significant first: the trips rank
   * before the kickers, the pair rank before its kicker, and so on. Compared element by element.
   */
  tiebreakers: number[]
  cardCount: number
  /** Player-facing, and the only thing the log and the seat bubble print. */
  label: string
}

const POKER_HAND_SIZE = 5

/**
 * Ace is high and only high. A wheel (A-2-3-4-5) is not a straight here, because the ace already
 * ranks above the king everywhere else in this game — 4-of-a-kind scoring, trump comparisons — and
 * one card changing value inside one ability is the kind of exception players lose track of.
 */
const POKER_RANK_VALUES: Record<BlowCowRank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
}

const POKER_RANK_LABELS: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace',
}

const POKER_RANK_PLURAL_LABELS: Record<number, string> = {
  2: '2s',
  3: '3s',
  4: '4s',
  5: '5s',
  6: '6s',
  7: '7s',
  8: '8s',
  9: '9s',
  10: '10s',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces',
}

type ConcreteCard = {
  value: number
  suit: BlowCowCardSuit
}

function formatRank(value: number) {
  return POKER_RANK_LABELS[value] ?? String(value)
}

function formatRankPlural(value: number) {
  return POKER_RANK_PLURAL_LABELS[value] ?? `${value}s`
}

/**
 * Jokers are wild, which is the Joker Rule's own first line. A wild card is not scored; it is
 * substituted for a real one, so evaluation splits into concrete cards plus a count of blanks to
 * fill. The Confused's Jacks are deliberately not wild here: that ability makes Jacks answer trump
 * checks, and the same card is still a Jack for 4-of-a-kind scoring, so it stays a Jack in a
 * showdown too.
 */
function partitionCards(cards: readonly BlowCowCard[]) {
  const concreteCards: ConcreteCard[] = []
  let wildCount = 0

  for (const card of cards) {
    if (card.rank === 'Joker') {
      wildCount += 1
      continue
    }

    concreteCards.push({ value: POKER_RANK_VALUES[card.rank], suit: card.suit })
  }

  return { concreteCards, wildCount }
}

function compareDescending(left: number, right: number) {
  return right - left
}

/**
 * The best straight the given values can reach with `wildCount` cards to spare, as its high card, or
 * null. Runs the five-card window down from the top so the first hit is already the strongest.
 */
function findStraightHighCard(values: readonly number[], wildCount: number) {
  const distinctValues = new Set(values)

  for (let highCard = POKER_RANK_VALUES.A; highCard >= POKER_RANK_VALUES['2'] + POKER_HAND_SIZE - 1; highCard -= 1) {
    let missingCount = 0

    for (let offset = 0; offset < POKER_HAND_SIZE; offset += 1) {
      if (!distinctValues.has(highCard - offset)) {
        missingCount += 1
      }
    }

    if (missingCount <= wildCount) {
      return highCard
    }
  }

  return null
}

function buildHand(
  category: BlowCowPokerCategory,
  tiebreakers: number[],
  cardCount: number,
  label: string,
): BlowCowPokerHand {
  return {
    category,
    categoryRank: BLOW_COW_POKER_CATEGORIES.indexOf(category),
    tiebreakers,
    cardCount,
    label,
  }
}

/**
 * Every flush-and-better reading the cards can support, strongest first. Separated from the
 * rank-only categories because a wild card can only be spent once: a joker that completes a flush is
 * not also available to complete the trips, so each branch is evaluated against the same budget and
 * the best complete answer wins.
 */
function evaluateSuitedHands(concreteCards: readonly ConcreteCard[], wildCount: number, cardCount: number) {
  const hands: BlowCowPokerHand[] = []

  for (const suit of new Set(concreteCards.map((card) => card.suit))) {
    const suitedValues = concreteCards
      .filter((card) => card.suit === suit)
      .map((card) => card.value)
      .sort(compareDescending)

    if (suitedValues.length + wildCount < POKER_HAND_SIZE) {
      continue
    }

    const straightFlushHighCard = findStraightHighCard(suitedValues, wildCount)

    if (straightFlushHighCard !== null) {
      hands.push(buildHand(
        'straightFlush',
        [straightFlushHighCard],
        cardCount,
        `${formatRank(straightFlushHighCard)}-high straight flush`,
      ))
    }

    /*
     * Wilds spent on the flush count as aces above whatever is really there, since a wild card is
     * free to be the one card that beats every kicker it is compared against.
     */
    const flushValues = [
      ...Array.from({ length: Math.max(0, POKER_HAND_SIZE - suitedValues.length) }, () => POKER_RANK_VALUES.A),
      ...suitedValues,
    ].sort(compareDescending).slice(0, POKER_HAND_SIZE)

    hands.push(buildHand(
      'flush',
      flushValues,
      cardCount,
      `${formatRank(flushValues[0])}-high flush`,
    ))
  }

  return hands
}

/**
 * The rank-only categories: quads down to high card, plus the unsuited straight. Wilds are poured
 * into the largest group first, which is always at least as good as spreading them, because every
 * category above two pair is decided by group size before it is decided by rank.
 */
function evaluateRankHands(concreteCards: readonly ConcreteCard[], wildCount: number, cardCount: number) {
  const countsByValue = new Map<number, number>()

  for (const card of concreteCards) {
    countsByValue.set(card.value, (countsByValue.get(card.value) ?? 0) + 1)
  }

  const groups = [...countsByValue.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || right.value - left.value)

  const hands: BlowCowPokerHand[] = []
  const allValues = concreteCards.map((card) => card.value).sort(compareDescending)
  const straightHighCard = findStraightHighCard(allValues, wildCount)

  if (straightHighCard !== null) {
    hands.push(buildHand(
      'straight',
      [straightHighCard],
      cardCount,
      `${formatRank(straightHighCard)}-high straight`,
    ))
  }

  /*
   * With no concrete card at all the wilds have nothing to pair with, so a hand of pure jokers is
   * scored as the highest cards it could be rather than as a group.
   */
  if (groups.length === 0) {
    if (wildCount === 0) {
      return hands
    }

    const wildValues = Array.from({ length: Math.min(wildCount, POKER_HAND_SIZE) }, () => POKER_RANK_VALUES.A)

    hands.push(buildHand('highCard', wildValues, cardCount, `${formatRank(POKER_RANK_VALUES.A)} high`))

    return hands
  }

  const bestGroup = groups[0]
  const boostedCount = Math.min(bestGroup.count + wildCount, 4)
  const remainingWilds = wildCount - (boostedCount - bestGroup.count)
  const secondGroup = groups[1]
  const boostedSecondCount = secondGroup
    ? Math.min(secondGroup.count + remainingWilds, boostedCount)
    : remainingWilds > 0
    ? Math.min(remainingWilds, boostedCount)
    : 0
  const secondValue = secondGroup?.value ?? POKER_RANK_VALUES.A
  const groupKickers = allValues.filter((value) => value !== bestGroup.value)
  const kickers = groupKickers.filter((value) => value !== secondGroup?.value)

  if (boostedCount >= 4) {
    hands.push(buildHand(
      'fourOfAKind',
      [bestGroup.value, ...groupKickers.slice(0, 1)],
      cardCount,
      `Four ${formatRankPlural(bestGroup.value)}`,
    ))
  }

  if (boostedCount >= 3 && boostedSecondCount >= 2) {
    hands.push(buildHand(
      'fullHouse',
      [bestGroup.value, secondValue],
      cardCount,
      `${formatRankPlural(bestGroup.value)} full of ${formatRankPlural(secondValue)}`,
    ))
  }

  if (boostedCount === 3) {
    hands.push(buildHand(
      'threeOfAKind',
      [bestGroup.value, ...groupKickers.slice(0, 2)],
      cardCount,
      `Three ${formatRankPlural(bestGroup.value)}`,
    ))
  }

  if (boostedCount === 2 && boostedSecondCount === 2) {
    const highPair = Math.max(bestGroup.value, secondValue)
    const lowPair = Math.min(bestGroup.value, secondValue)

    hands.push(buildHand(
      'twoPair',
      [highPair, lowPair, ...kickers.slice(0, 1)],
      cardCount,
      `${formatRankPlural(highPair)} and ${formatRankPlural(lowPair)}`,
    ))
  }

  if (boostedCount === 2) {
    hands.push(buildHand(
      'pair',
      [bestGroup.value, ...groupKickers.slice(0, 3)],
      cardCount,
      `Pair of ${formatRankPlural(bestGroup.value)}`,
    ))
  }

  hands.push(buildHand(
    'highCard',
    allValues.slice(0, POKER_HAND_SIZE),
    cardCount,
    `${formatRank(allValues[0])} high`,
  ))

  return hands
}

/**
 * The strongest hand these cards can make. Cards beyond five are read as the best five, and fewer
 * than five is scored as it stands rather than being padded, so a two-card hand is capped at a pair
 * by arithmetic instead of by a special case.
 */
export function evaluatePokerHand(cards: readonly BlowCowCard[]): BlowCowPokerHand {
  if (cards.length === 0) {
    return buildHand('none', [], 0, 'Nothing in front')
  }

  const { concreteCards, wildCount } = partitionCards(cards)
  const candidateHands = [
    ...evaluateSuitedHands(concreteCards, wildCount, cards.length),
    ...evaluateRankHands(concreteCards, wildCount, cards.length),
  ]

  if (candidateHands.length === 0) {
    return buildHand('none', [], cards.length, 'Nothing in front')
  }

  return candidateHands.reduce((best, hand) => (comparePokerHands(hand, best) > 0 ? hand : best))
}

/**
 * Positive when `left` is the stronger hand, negative when `right` is, zero when they are genuinely
 * tied. Card count is the last word before a tie is declared, so between two identical readings the
 * player who committed fewer cards to the table is the weaker one — and a real tie is left to the
 * Reset caller to break, which is why this reports it rather than inventing a winner.
 */
export function comparePokerHands(left: BlowCowPokerHand, right: BlowCowPokerHand) {
  if (left.categoryRank !== right.categoryRank) {
    return left.categoryRank - right.categoryRank
  }

  const tiebreakerCount = Math.max(left.tiebreakers.length, right.tiebreakers.length)

  for (let index = 0; index < tiebreakerCount; index += 1) {
    const leftValue = left.tiebreakers[index] ?? 0
    const rightValue = right.tiebreakers[index] ?? 0

    if (leftValue !== rightValue) {
      return leftValue - rightValue
    }
  }

  return left.cardCount - right.cardCount
}
