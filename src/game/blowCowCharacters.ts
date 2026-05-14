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