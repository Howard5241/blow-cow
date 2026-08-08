/*
 * The game's rules, serialized as cards. Each rule carries its own identity, copy, and the variants
 * it supports, so a rule can be shown to players and — eventually — removed or upgraded by a
 * character.
 *
 * `removed` is enforced: every rule that defines a removed variant has a matching branch at its
 * enforcement site in `blowCowGame.ts`, reached through `isRuleRemoved`. `upgraded` is not — those
 * variants are still display-only.
 */

export const BLOW_COW_RULE_IDS = [
  'reverse',
  'pass',
  'joker',
  'maxCardsOnTable',
  'maxCardsPerPlay',
  'directionChange',
  'passEnding',
  'reveal',
  'leaveGame',
  'finalRanking',
  'callReset',
  'rankChange',
  'noCheating',
  'status',
] as const

export type BlowCowRuleID = (typeof BLOW_COW_RULE_IDS)[number]

export const BLOW_COW_RULE_STATUSES = ['active', 'removed', 'upgraded'] as const

export type BlowCowRuleStatus = (typeof BLOW_COW_RULE_STATUSES)[number]

export type BlowCowRulesState = Record<BlowCowRuleID, BlowCowRuleStatus>

export type BlowCowRuleDefinition = {
  id: BlowCowRuleID
  /** Follows the matching `RULES.md` heading wherever one exists. */
  title: string
  description: string
  /** Absent means the rule cannot be removed. */
  removedDescription?: string
  /** Absent means the rule cannot be upgraded. */
  upgradedDescription?: string
}

/*
 * Removability and upgradability are derived from these two optional fields rather than declared
 * separately, so a variant can only exist once someone has written down what it does.
 */
export const BLOW_COW_RULE_DEFINITIONS: readonly BlowCowRuleDefinition[] = [
  {
    id: 'reverse',
    title: 'Reverse Rule',
    description:
      'After a BS call, once every card on the table is face up, count the cards of the round\'s trump rank. If there are 4 or more, the punishment is reversed and the other player takes the table instead. Jokers never count toward this.',
    removedDescription:
      'Punishment is never reversed. Whoever the BS resolution names takes the table, however many trump-rank cards are on it.',
  },
  {
    id: 'pass',
    title: 'Pass Rule',
    description: 'On your turn you may Pass, ending your turn without playing cards or calling anything.',
    removedDescription: 'Pass is not an available action. Every turn has to be resolved some other way.',
  },
  {
    id: 'joker',
    title: 'Joker Rule',
    description:
      'Jokers are wild. A Joker counts as the trump rank when a play is judged honest or a lie. Jokers never count toward the Reverse Rule or toward 4-of-a-kind scoring.',
    removedDescription:
      'Jokers have no rank at all, so any play containing one is always a lie.',
  },
  {
    id: 'maxCardsOnTable',
    title: 'Max Cards On Table Rule',
    description:
      'The table holds at most MaxCardsOnTable cards, set by how many players are still in the game: 2 players 10, 3 or 4 players 12, 5 players 15, 6 players 12, 7 players 14, 8 players 16. You may not play cards that would push the table past it.',
    removedDescription:
      'The table has no limit, and a play may push it to any size. Call Reset still unlocks at the original limit.',
    upgradedDescription: 'MaxCardsOnTable is doubled for every player count.',
  },
  {
    id: 'maxCardsPerPlay',
    title: 'Max Cards Per Play Rule',
    description: 'A play puts down at most 2 cards at a time.',
    upgradedDescription: 'A play puts down at most 3 cards at a time.',
  },
  {
    id: 'directionChange',
    title: 'Direction Change Rule',
    description: 'Direction flips to the opposite value every time a round ends.',
    removedDescription: 'Direction never changes on its own between rounds.',
    upgradedDescription:
      'Direction no longer flips on its own. It carries over from the last round, and the starting player sets it on their first turn by clicking the direction arrow.',
  },
  {
    id: 'passEnding',
    title: 'Pass Ending Rule',
    description:
      'If every player still in the game passes in a row, the round ends immediately. Each player takes back the cards in front of them, and the last player to pass starts the next round.',
    removedDescription: 'Consecutive passes never end a round.',
    upgradedDescription: 'The round ends after twice as many consecutive passes instead.',
  },
  {
    id: 'reveal',
    title: 'Reveal Rule',
    description:
      'At the start of your turn you flip whatever you played on your previous turn face up. This is mandatory and is not an action.',
    removedDescription: 'Played cards stay face down. Nothing is revealed at the start of a turn.',
  },
  {
    id: 'leaveGame',
    title: 'Leave Game Rule',
    description:
      'A player with no cards in hand leaves the game, either at the start of a new round before the first turn or at the start of their own turn. Cards they left on the table are removed from the game entirely. The game ends once one player remains.',
    upgradedDescription:
      'Running out of cards no longer removes you. You leave when you make a successful BS call while holding no cards. With an empty hand you may still take any action except Play. If every player starts a round with an empty hand, everyone leaves at once, in turn order starting from the player whose turn it is.',
  },
  {
    id: 'finalRanking',
    title: 'Final Ranking Rule',
    description:
      'Placements compare points first, where fewer is better, then leave order, where leaving earlier ranks higher.',
    upgradedDescription: 'Points are ignored. Placements compare leave order only, and leaving earlier ranks higher.',
  },
  {
    id: 'callReset',
    title: 'Call Reset Rule',
    description:
      'When the table reaches MaxCardsOnTable you may Call Reset. It ends the round: every table card is flipped face up, shuffled together, and dealt evenly to everyone still in the game, with any remainder going to the caller. The caller starts the next round.',
    upgradedDescription:
      'Reset no longer gathers and redistributes. Each player simply takes back the cards in front of them. The caller still starts the next round.',
  },
  {
    id: 'rankChange',
    title: 'Rank Change Rule',
    description: 'The trump rank chosen for a round may not be the same as the previous round\'s trump rank.',
    removedDescription: 'The same trump rank may be chosen in consecutive rounds.',
  },
  {
    id: 'noCheating',
    title: 'No Cheating Rule',
    description:
      'Nobody may break the rules of the game. Only a player permitted to cheat may be accused of cheating.',
    removedDescription:
      'Anyone may cheat, and anyone may be accused of it.',
  },
  {
    id: 'status',
    title: 'Status Rule',
    description:
      'Every status carries a counter. It goes down by 1 at the end of its owner\'s turn, and the status wears off when the counter reaches 0.',
    removedDescription:
      'Counters are still shown but never go down, so every status a player is given lasts for the rest of the match.',
  },
]

const ruleDefinitionsByID = new Map(BLOW_COW_RULE_DEFINITIONS.map((definition) => [definition.id, definition]))

export function isBlowCowRuleID(value: unknown): value is BlowCowRuleID {
  return typeof value === 'string' && BLOW_COW_RULE_IDS.some((ruleID) => ruleID === value)
}

export function isBlowCowRuleStatus(value: unknown): value is BlowCowRuleStatus {
  return typeof value === 'string' && BLOW_COW_RULE_STATUSES.some((status) => status === value)
}

export function getRuleDefinition(ruleID: BlowCowRuleID) {
  return ruleDefinitionsByID.get(ruleID) as BlowCowRuleDefinition
}

export function canRuleTakeStatus(ruleID: BlowCowRuleID, status: BlowCowRuleStatus) {
  const definition = ruleDefinitionsByID.get(ruleID)
  if (!definition) {
    return false
  }

  if (status === 'removed') {
    return definition.removedDescription !== undefined
  }

  if (status === 'upgraded') {
    return definition.upgradedDescription !== undefined
  }

  return true
}

export function getRuleStatusOptions(ruleID: BlowCowRuleID) {
  return BLOW_COW_RULE_STATUSES.filter((status) => canRuleTakeStatus(ruleID, status))
}

/** Every rule that defines a removed variant, and so is something The Broken could tear up. */
export function getRemovableRuleIDs() {
  return BLOW_COW_RULE_IDS.filter((ruleID) => canRuleTakeStatus(ruleID, 'removed'))
}

export function createDefaultRulesState(): BlowCowRulesState {
  return Object.fromEntries(BLOW_COW_RULE_IDS.map((ruleID) => [ruleID, 'active'])) as BlowCowRulesState
}

/**
 * The single sanitiser for rule selections. Unknown IDs are dropped and unsupported statuses fall
 * back to `active`, so a status a rule does not define can never reach `G` no matter which caller
 * built the selection.
 */
export function normalizeRulesSelection(value: unknown): BlowCowRulesState {
  const rules = createDefaultRulesState()

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return rules
  }

  for (const [ruleID, status] of Object.entries(value)) {
    if (isBlowCowRuleID(ruleID) && isBlowCowRuleStatus(status) && canRuleTakeStatus(ruleID, status)) {
      rules[ruleID] = status
    }
  }

  return rules
}

export function isDefaultRulesSelection(rules: BlowCowRulesState) {
  return BLOW_COW_RULE_IDS.every((ruleID) => rules[ruleID] === 'active')
}

/** Upgraded rules read as `Reverse Rule+`; every other status keeps the plain title. */
export function formatRuleTitle(definition: BlowCowRuleDefinition, status: BlowCowRuleStatus) {
  return status === 'upgraded' ? `${definition.title}+` : definition.title
}

export function getRuleDescription(definition: BlowCowRuleDefinition, status: BlowCowRuleStatus) {
  if (status === 'removed' && definition.removedDescription) {
    return definition.removedDescription
  }

  if (status === 'upgraded' && definition.upgradedDescription) {
    return definition.upgradedDescription
  }

  return definition.description
}
