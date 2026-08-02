export const BLOW_COW_CHARACTER_NAMES = [
  'The Dreamer',
  'The Believer',
  'The Cat',
  'The Contrarian',
  'The Confused',
  'The Deranged',
  'The Drunkard',
  'The Foreigner',
  'The Grandmaster',
  'The Invisible Hand',
  'The Philanthropist',
  'The Privileged',
  'The Rogue',
  'The Speedrunner',
  'The Spy',
  'The Streamer',
  'The Pacifist',
  'The Pawn',
] as const

export type BlowCowCharacterName = (typeof BLOW_COW_CHARACTER_NAMES)[number]

export const BLOW_COW_CHARACTER_DESCRIPTIONS: Record<BlowCowCharacterName, string> = {
  'The Dreamer': 'You may cheat. You will be punished if caught. Unlimited use.',
  'The Believer': 'No special ability.',
  'The Cat': 'On your turn, flip one revealed table card face down. Unlimited use.',
  'The Contrarian': 'On your turn, change the game direction. Unlimited use.',
  'The Confused': 'Jacks also function as Jokers.',
  'The Deranged': 'Whenever you score a point, remove up to two cards from your hand. Unlimited use.',
  'The Drunkard': 'You may play random cards. Lose 3 points on leaving if every play was random.',
  'The Foreigner': 'When you pass, add any card from outside the game to your hand. Unlimited use.',
  'The Grandmaster': 'Call BS on any player once per game.',
  'The Invisible Hand': 'Before starting a round, choose its rank, direction, and starting player once per game.',
  'The Philanthropist': 'As the starting player, declare that you may play three cards on any turn that round once per game.',
  'The Privileged': 'You are always the starting player unless another ability overrides it. Gain 1 point after leaving.',
  'The Rogue': 'At round start, show an all-Club hand to become the starting player. Unlimited use.',
  'The Speedrunner': 'If first to leave with exactly 2 points, leave with 0 points instead.',
  'The Spy': 'On your turn, reveal one random card from your previous play when it has at least two hidden cards. Unlimited use.',
  'The Streamer': 'Lose 2 points on leaving if you never passed.',
  'The Pacifist': 'Lose 1 point on leaving if you never called BS.',
  'The Pawn': 'Use En Passant to call BS on the player before the previous non-passing player when both played two cards. Unlimited use.',
}

export const BLOW_COW_IMPLEMENTED_CHARACTER_NAMES = [
  'The Dreamer',
  'The Believer',
  'The Cat',
  'The Contrarian',
  'The Confused',
  'The Drunkard',
  'The Foreigner',
  'The Grandmaster',
  'The Privileged',
  'The Spy',
  'The Speedrunner',
  'The Streamer',
  'The Pacifist',
  'The Pawn',
] as const satisfies readonly BlowCowCharacterName[]

export type BlowCowImplementedCharacterName = (typeof BLOW_COW_IMPLEMENTED_CHARACTER_NAMES)[number]

type BlowCowCharacterShuffle = <Value>(values: Value[]) => Value[]

export function isImplementedCharacterName(characterName: unknown): characterName is BlowCowImplementedCharacterName {
  return typeof characterName === 'string'
    && BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.some((implementedCharacterName) => implementedCharacterName === characterName)
}

function normalizeCharacterPool(characterPool?: readonly BlowCowImplementedCharacterName[]) {
  if (!Array.isArray(characterPool)) {
    return undefined
  }

  const requestedCharacterNames = new Set(characterPool.filter(isImplementedCharacterName))

  return BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.filter((characterName) => requestedCharacterNames.has(characterName))
}

export function getAvailableImplementedCharacterNames(
  selectedRanks: readonly string[],
  characterPool?: readonly BlowCowImplementedCharacterName[],
) {
  const availableCharacterNames = BLOW_COW_IMPLEMENTED_CHARACTER_NAMES.filter((characterName) => {
    return characterName !== 'The Confused' || selectedRanks.includes('J')
  })

  const normalizedCharacterPool = normalizeCharacterPool(characterPool)
  if (!normalizedCharacterPool) {
    return availableCharacterNames
  }

  const requestedCharacterNames = new Set(normalizedCharacterPool)

  return availableCharacterNames.filter((characterName) => requestedCharacterNames.has(characterName))
}

export function assignRandomImplementedCharacters(
  playerCount: number,
  selectedRanks: readonly string[],
  characterPool?: readonly BlowCowImplementedCharacterName[],
  shuffle?: BlowCowCharacterShuffle,
) {
  const availableCharacterNames = getAvailableImplementedCharacterNames(selectedRanks, characterPool)
  const assignments: BlowCowImplementedCharacterName[] = []

  if (availableCharacterNames.length === 0) {
    return assignments
  }

  while (assignments.length < playerCount) {
    assignments.push(...(shuffle ? shuffle([...availableCharacterNames]) : [...availableCharacterNames]))
  }

  return assignments.slice(0, playerCount)
}