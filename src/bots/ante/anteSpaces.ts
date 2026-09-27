/**
 * The Ante agent's card types, trump slots and flat action space.
 *
 * A direct port of `rl/ante/config.py` and `rl/ante/spaces.py`. Pure arithmetic over two integers —
 * no state, no engine types — which is what makes it checkable against the Python side by
 * enumeration rather than by argument. `scripts/check-ante-bot.ts` does exactly that.
 *
 * **Card types, not cards.** A card is its rank slot `0..R-1`, or the Joker at `R`. Suits do nothing
 * in Ante — no characters, no action ranks, no cheats — so two cards of one rank are interchangeable
 * everywhere and a hand is a vector of counts.
 *
 * **Which rank is slot 0 does not matter, and that is load-bearing.** The network is structurally
 * indifferent to rank identity: `rank relabelling` in `rl/ante_check.py` proves the observation only
 * permutes its per-type rows when the ranks are permuted. So any consistent bijection between the
 * match's selected ranks and `0..R-1` serves, and this file uses the order `deckConfig.selectedRanks`
 * already has. It must only be *consistent within a round*, which it is, because that array does not
 * move until the deck is resized between rounds.
 */

/** Standard ranks in the real game's pool. Only the count matters here. */
export const TOTAL_STANDARD_RANKS = 13
export const COPIES_PER_RANK = 4
export const JOKER_COPIES = 2

export type AnteConfig = {
  numPlayers: number
  numRanks: number
  /** Card type of the Joker: one past the last standard rank. */
  jokerType: number
  /** Standard ranks plus the Joker. */
  numTypes: number
  /**
   * The single representative of every standard rank the deck does not hold. All `13 - R` of them
   * are the same move — every play becomes a lie unless it is a Joker, and the Reverse Rule can
   * never arm — so offering each separately would split the policy across identical actions.
   *
   * Numerically equal to `jokerType`, which is a coincidence of two different spaces sharing an
   * index: slot `R` means "a rank not in the deck", type `R` means "the Joker".
   */
  offDeckTrump: number
  numTrumpSlots: number
  deckSize: number
  /** Copies of each card type in the deck, indexed by type. */
  copies: number[]
  /** The smallest hand dealt. Only 4 and 8 seats fail to divide, and both leave 2 over. */
  handSize: number
}

/**
 * The seat counts a trained Ante network is shipped for. Kept here, in the module with no asset
 * imports, so the seating gate and the Node checks can read it without pulling in the weight
 * manifests. `anteWeights.ts` holds the matching weight files and asserts the two agree.
 */
export const ANTE_AGENT_SUPPORTED_SEATS: readonly number[] = [2, 3, 4, 5, 6, 7, 8]

/** `getAnteStandardRankCount` in `src/game/blowCowAnte.ts`, kept here so this module stands alone. */
export function standardRankCount(numPlayers: number): number {
  if (numPlayers <= 2) return 3
  if (numPlayers === 3) return 4
  if (numPlayers === 4) return 6
  if (numPlayers === 5 || numPlayers === 6) return 7
  if (numPlayers === 7) return 10
  return 12
}

export function createAnteConfig(numPlayers: number, numRanks: number): AnteConfig {
  const jokerType = numRanks
  const hasOffDeck = numRanks < TOTAL_STANDARD_RANKS
  const deckSize = COPIES_PER_RANK * numRanks + JOKER_COPIES
  return {
    numPlayers,
    numRanks,
    jokerType,
    numTypes: numRanks + 1,
    offDeckTrump: numRanks,
    numTrumpSlots: numRanks + (hasOffDeck ? 1 : 0),
    deckSize,
    copies: [...Array<number>(numRanks).fill(COPIES_PER_RANK), JOKER_COPIES],
    handSize: Math.floor(deckSize / numPlayers),
  }
}

export const PASS_INDEX = 0
export const CALL_BS_INDEX = 1
const FIRST_PLAY_INDEX = 2

/**
 * Every multiset of one or two card types, in a fixed order: singles first, then pairs.
 *
 * A pair of one type means two cards of that rank. The order is the one `build_choices` produces and
 * must not be rearranged — a choice's position *is* its action index.
 */
export function buildChoices(numTypes: number): number[][] {
  const choices: number[][] = []
  for (let cardType = 0; cardType < numTypes; cardType += 1) choices.push([cardType])
  for (let left = 0; left < numTypes; left += 1) {
    for (let right = left; right < numTypes; right += 1) choices.push([left, right])
  }
  return choices
}

export type AnteActionSpace = {
  config: AnteConfig
  choices: number[][]
  numChoices: number
  playOffset: number
  trumpOffset: number
  size: number
  /** For each choice, the `(type, count)` pairs it spends. Precomputed for the mask loop. */
  choiceNeeds: { cardType: number; count: number }[][]
}

export function createActionSpace(config: AnteConfig): AnteActionSpace {
  const choices = buildChoices(config.numTypes)
  const numChoices = choices.length
  const choiceNeeds = choices.map((choice) => {
    const counts = new Map<number, number>()
    for (const cardType of choice) counts.set(cardType, (counts.get(cardType) ?? 0) + 1)
    return [...counts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([cardType, count]) => ({ cardType, count }))
  })

  return {
    config,
    choices,
    numChoices,
    playOffset: FIRST_PLAY_INDEX,
    trumpOffset: FIRST_PLAY_INDEX + numChoices,
    size: FIRST_PLAY_INDEX + numChoices + config.numTrumpSlots * numChoices,
    choiceNeeds,
  }
}

export type AnteAction =
  | { kind: 'pass' }
  | { kind: 'callBS' }
  | { kind: 'play'; trumpSlot: number | null; choice: number[] }

/** The factored view of a flat index. `decompose` in `spaces.py`. */
export function decomposeAction(space: AnteActionSpace, index: number): AnteAction {
  if (index === PASS_INDEX) return { kind: 'pass' }
  if (index === CALL_BS_INDEX) return { kind: 'callBS' }
  if (index < space.trumpOffset) {
    return { kind: 'play', trumpSlot: null, choice: space.choices[index - space.playOffset] }
  }
  const offset = index - space.trumpOffset
  const trumpSlot = Math.floor(offset / space.numChoices)
  const choiceIndex = offset % space.numChoices
  return { kind: 'play', trumpSlot, choice: space.choices[choiceIndex] }
}

/**
 * The static `(slot, choice)` table the action head gates over: how honest each trump-selecting play
 * would be, and what it spends. `build_static_table` in `rl/ante/nets.py`.
 *
 * Rebuilt here rather than shipped with the weights on purpose. It is a pure function of the config
 * on both sides, and a buffer shipped as data can silently disagree with the code consuming it while
 * one derived from the same arithmetic cannot.
 *
 * Returned flat, indexed `(slot * numChoices + choice) * STATIC_FEATURES + feature`.
 */
export const STATIC_FEATURES = 6

export function buildStaticTable(config: AnteConfig, space: AnteActionSpace): Float32Array {
  const table = new Float32Array(config.numTrumpSlots * space.numChoices * STATIC_FEATURES)
  for (let slot = 0; slot < config.numTrumpSlots; slot += 1) {
    const offDeck = slot === config.offDeckTrump
    for (let choiceIndex = 0; choiceIndex < space.numChoices; choiceIndex += 1) {
      const choice = space.choices[choiceIndex]
      let trumpCards = 0
      let jokers = 0
      for (const cardType of choice) {
        if (cardType === config.jokerType) {
          trumpCards += 1
          jokers += 1
        } else if (!offDeck && cardType === slot) {
          trumpCards += 1
        }
      }
      const base = (slot * space.numChoices + choiceIndex) * STATIC_FEATURES
      table[base + 0] = trumpCards / 2
      table[base + 1] = trumpCards === choice.length ? 1 : 0
      table[base + 2] = trumpCards === 0 ? 1 : 0
      table[base + 3] = choice.length / 2
      table[base + 4] = offDeck ? 1 : 0
      table[base + 5] = jokers / 2
    }
  }
  return table
}

/** The `(left, right)` type indices behind each pair choice, in choice order. */
export function buildPairIndices(numTypes: number): { left: Int32Array; right: Int32Array } {
  const left: number[] = []
  const right: number[] = []
  for (let a = 0; a < numTypes; a += 1) {
    for (let b = a; b < numTypes; b += 1) {
      left.push(a)
      right.push(b)
    }
  }
  return { left: Int32Array.from(left), right: Int32Array.from(right) }
}
